import * as path from 'path';
import * as vscode from 'vscode';
import { computeChange } from './textDiff';

/** Messages the webview sends to the extension. */
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'markdown'; requestId: number; text: string | null }
  | { type: 'upload'; requestId: number; name: string; mime: string; data: unknown }
  | { type: 'openLink'; href: string };

interface WebviewConfig {
  maxWidth: number;
  tableOfContents: boolean;
  toolbar: boolean;
}

const MARKDOWN_FILE = /\.(md|markdown)$/i;
/** onWillSaveTextDocument participants get ~1.5s before VS Code gives up on them. */
const SAVE_FLUSH_TIMEOUT_MS = 1000;

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'mdWysiwyg.editor';

  private readonly sessions = new Set<EditorSession>();

  static register(context: vscode.ExtensionContext): MarkdownEditorProvider {
    const provider = new MarkdownEditorProvider(context);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
        supportsMultipleEditorsPerDocument: true,
      }),
      vscode.workspace.onWillSaveTextDocument((e) => provider.onWillSave(e)),
    );
    return provider;
  }

  private constructor(private readonly context: vscode.ExtensionContext) {}

  /** Brings edits that the webviews showing `uri` haven't reported yet into the document. */
  async sync(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    for (const session of this.sessions) {
      if (session.document.uri.toString() === key) {
        await session.sync();
      }
    }
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const session = new EditorSession(this.context.extensionUri, document, panel);
    this.sessions.add(session);
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      session.dispose();
    });
  }

  /**
   * The webview reports edits on a short debounce, so the last keystrokes may
   * not have reached the TextDocument yet when a save starts. Pull them in.
   */
  private onWillSave(e: vscode.TextDocumentWillSaveEvent): void {
    const key = e.document.uri.toString();
    const sessions = [...this.sessions]
      .filter((s) => s.document.uri.toString() === key)
      .sort((a, b) => Number(b.panel.active) - Number(a.panel.active));
    if (sessions.length > 0) {
      e.waitUntil(collectSaveEdits(sessions));
    }
  }
}

async function collectSaveEdits(sessions: EditorSession[]): Promise<vscode.TextEdit[]> {
  for (const session of sessions) {
    const edits = await session.flush();
    if (edits.length > 0) {
      return edits;
    }
  }
  return [];
}

class EditorSession implements vscode.Disposable {
  /** The text that the webview and the TextDocument last agreed on. */
  private lastSynced: string;
  /** Serializes edits coming from the webview so they never interleave. */
  private editQueue: Promise<void> = Promise.resolve();
  /** Until the webview script runs there are no local edits, and requests would go unanswered. */
  private webviewReady = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, (text: string | null) => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
  ) {
    this.lastSynced = document.getText();

    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
    webview.html = this.renderHtml();

    this.disposables.push(
      webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.onDocumentChanged(e);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mdWysiwyg', document.uri)) {
          void this.post({ type: 'config', config: this.readConfig() });
        }
      }),
    );
  }

  dispose(): void {
    for (const resolve of this.pendingRequests.values()) {
      resolve(null);
    }
    this.pendingRequests.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** Returns the edits that bring unsynced webview changes into the document. */
  async flush(): Promise<vscode.TextEdit[]> {
    await this.editQueue;
    const text = await this.requestMarkdown();
    // An edit the webview sent before answering may still be in the queue.
    await this.editQueue;
    if (text === null) {
      return [];
    }
    const normalized = this.toDocumentEol(text);
    const current = this.document.getText();
    this.lastSynced = normalized;
    const change = computeChange(current, normalized);
    if (!change) {
      return [];
    }
    const range = new vscode.Range(this.document.positionAt(change.start), this.document.positionAt(change.end));
    return [vscode.TextEdit.replace(range, change.text)];
  }

  /** Applies edits the webview has made but not reported yet, e.g. before its tab closes. */
  async sync(): Promise<void> {
    if (!this.webviewReady) {
      return;
    }
    const text = await this.requestMarkdown();
    if (text !== null) {
      this.enqueueEdit(text);
    }
    await this.editQueue;
  }

  private onMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case 'ready':
        this.webviewReady = true;
        this.lastSynced = this.document.getText();
        void this.post({
          type: 'init',
          text: this.lastSynced,
          language: vscode.env.language,
          config: this.readConfig(),
        });
        break;
      case 'edit':
        this.enqueueEdit(msg.text);
        break;
      case 'markdown':
        this.pendingRequests.get(msg.requestId)?.(msg.text);
        break;
      case 'upload':
        void this.handleUpload(msg);
        break;
      case 'openLink':
        void this.openLink(msg.href);
        break;
    }
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) {
      return;
    }
    const text = this.document.getText();
    if (text === this.lastSynced) {
      // Our own edit coming back.
      return;
    }
    // Changed elsewhere: text editor, undo from the Edit menu, git, revert...
    this.lastSynced = text;
    void this.post({ type: 'update', text });
  }

  private enqueueEdit(text: string): void {
    this.editQueue = this.editQueue
      .then(async () => {
        const normalized = this.toDocumentEol(text);
        const change = computeChange(this.document.getText(), normalized);
        // Set before applying so the resulting change event is recognized as ours.
        this.lastSynced = normalized;
        if (!change) {
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        const range = new vscode.Range(this.document.positionAt(change.start), this.document.positionAt(change.end));
        edit.replace(this.document.uri, range, change.text);
        await vscode.workspace.applyEdit(edit);
      })
      .catch((err) => {
        console.error('[md-wysiwyg] failed to apply edit', err);
      });
  }

  private requestMarkdown(): Promise<string | null> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), SAVE_FLUSH_TIMEOUT_MS);
      const finish = (text: string | null) => {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve(text);
      };
      this.pendingRequests.set(requestId, finish);
      void this.post({ type: 'getMarkdown', requestId });
    });
  }

  private async handleUpload(msg: Extract<WebviewMessage, { type: 'upload' }>): Promise<void> {
    try {
      const url = await this.saveImage(msg.name, msg.mime, toBytes(msg.data));
      void this.post({ type: 'uploadResult', requestId: msg.requestId, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(vscode.l10n.t('Failed to save image: {0}', message));
      void this.post({ type: 'uploadResult', requestId: msg.requestId, error: message });
    }
  }

  /** Saves image bytes next to the document and returns the relative link to use in markdown. */
  private async saveImage(name: string, mime: string, data: Uint8Array): Promise<string> {
    if (this.document.isUntitled) {
      throw new Error(vscode.l10n.t('Save the document before inserting images.'));
    }
    const folderSetting = vscode.workspace
      .getConfiguration('mdWysiwyg', this.document.uri)
      .get<string>('imageFolder', 'assets')
      .trim();
    const docDir = vscode.Uri.joinPath(this.document.uri, '..');
    const folder = folderSetting ? vscode.Uri.joinPath(docDir, folderSetting) : docDir;
    await vscode.workspace.fs.createDirectory(folder);

    const target = await uniqueUri(folder, imageFileName(name, mime));
    await vscode.workspace.fs.writeFile(target, data);

    const relative = path.posix.relative(docDir.path, target.path);
    return relative.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  private async openLink(href: string): Promise<void> {
    href = href.trim();
    if (!href || href.startsWith('#')) {
      return;
    }
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href);
    if (hasScheme) {
      const uri = vscode.Uri.parse(href);
      if (uri.scheme !== 'file') {
        await vscode.env.openExternal(uri);
        return;
      }
      await openResource(uri);
      return;
    }

    let filePath = href.replace(/[?#].*$/, '');
    try {
      filePath = decodeURIComponent(filePath);
    } catch {
      // Keep it as written.
    }
    const uri =
      path.isAbsolute(filePath) && this.document.uri.scheme === 'file'
        ? vscode.Uri.file(filePath)
        : vscode.Uri.joinPath(this.document.uri, '..', filePath);
    await openResource(uri);
  }

  private readConfig(): WebviewConfig {
    const config = vscode.workspace.getConfiguration('mdWysiwyg', this.document.uri);
    return {
      maxWidth: config.get<number>('maxWidth', 0),
      tableOfContents: config.get<boolean>('tableOfContents', true),
      toolbar: config.get<boolean>('toolbar', true),
    };
  }

  private post(message: unknown): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  private toDocumentEol(text: string): string {
    return this.document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
  }

  private resourceRoots(): vscode.Uri[] {
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist')];
    if (!this.document.isUntitled) {
      roots.push(vscode.Uri.joinPath(this.document.uri, '..'));
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    return roots;
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.css'));
    const nonce = createNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `media-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      // Module chunks are loaded with import(), so the extension's own origin must be allowed too.
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');
    // Relative image links resolve against the document's folder.
    const base = this.document.isUntitled
      ? ''
      : `<base href="${webview.asWebviewUri(vscode.Uri.joinPath(this.document.uri, '..'))}/">`;

    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${base}
  <link rel="stylesheet" href="${styleUri}">
  <title>Verso</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function openResource(uri: vscode.Uri): Promise<void> {
  if (MARKDOWN_FILE.test(uri.path)) {
    await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
  } else {
    await vscode.commands.executeCommand('vscode.open', uri);
  }
}

/** Webview messages may deliver binary data as a typed array, an ArrayBuffer or a plain array. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }
  if (data && typeof data === 'object') {
    return Uint8Array.from(Object.values(data as Record<string, number>));
  }
  throw new Error('Unsupported image data');
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
};

function imageFileName(name: string, mime: string): string {
  const originalExt = path.extname(name);
  const ext = originalExt.toLowerCase() || MIME_EXTENSIONS[mime] || '.png';
  let base = path
    .basename(name, originalExt)
    .replace(/[\s\\/:*?"<>|#%&{}$!'@`=+]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Pasted screenshots are usually just called "image.png".
  if (!base || /^image$/i.test(base)) {
    base = `image-${timestamp()}`;
  }
  return base + ext;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function uniqueUri(folder: vscode.Uri, fileName: string): Promise<vscode.Uri> {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = vscode.Uri.joinPath(folder, i === 0 ? fileName : `${base}-${i}${ext}`);
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch {
      return candidate;
    }
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
