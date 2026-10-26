import { Crepe, type CrepeConfig } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import './style.css';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { inlineCodeKeymap } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { syntaxHighlighting } from '@codemirror/language';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { getStrings, type Strings } from './i18n';
import { configureMarkdown, splitFrontMatter } from './markdownFormat';

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface WebviewConfig {
  maxWidth: number;
}

/** Messages the extension sends to the webview. */
type HostMessage =
  | { type: 'init'; text: string; language: string; config: WebviewConfig }
  | { type: 'update'; text: string }
  | { type: 'getMarkdown'; requestId: number }
  | { type: 'uploadResult'; requestId: number; url?: string; error?: string }
  | { type: 'config'; config: WebviewConfig };

const vscode = acquireVsCodeApi();

let crepe: Crepe | undefined;
let initializing = false;
/** The editor document as of the last sync with the extension, in either direction. */
let syncedDoc: ProseNode | undefined;
/** An external update that arrived before the editor finished starting. */
let pendingText: string | undefined;
/** Front matter is kept out of the editor and written back verbatim. */
let frontMatter = '';
let strings: Strings = getStrings('en');

let nextUploadId = 1;
const pendingUploads = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      void init(msg.text, msg.language, msg.config);
      break;
    case 'update':
      applyExternalText(msg.text);
      break;
    case 'getMarkdown':
      vscode.postMessage({ type: 'markdown', requestId: msg.requestId, text: takeUnsyncedMarkdown() });
      break;
    case 'uploadResult': {
      const upload = pendingUploads.get(msg.requestId);
      pendingUploads.delete(msg.requestId);
      if (msg.url !== undefined) {
        upload?.resolve(msg.url);
      } else {
        upload?.reject(new Error(msg.error ?? 'Upload failed'));
      }
      break;
    }
    case 'config':
      applyConfig(msg.config);
      break;
  }
});

installKeyboardGuards();
installLinkHandler();
vscode.postMessage({ type: 'ready' });

async function init(text: string, language: string, config: WebviewConfig): Promise<void> {
  if (crepe || initializing) {
    return;
  }
  initializing = true;
  applyConfig(config);
  strings = getStrings(language);

  const { frontMatter: initialFrontMatter, body } = splitFrontMatter(text);
  setFrontMatter(initialFrontMatter);
  const editor = new Crepe({
    root: document.getElementById('app'),
    defaultValue: body,
    featureConfigs: featureConfigs(strings),
  });
  configureMarkdown(editor.editor);
  // Ctrl/Cmd+E switches to the source view. Keys reach VS Code's keybindings
  // even when the editor handles them, so it must not also toggle inline code.
  editor.editor.config((ctx) => {
    ctx.update(inlineCodeKeymap.key, (prev) => ({
      ...prev,
      ToggleInlineCode: { ...prev.ToggleInlineCode, shortcuts: [] },
    }));
  });
  editor.on((listener) => {
    listener.markdownUpdated(() => sendLocalChanges());
  });
  await editor.create();

  crepe = editor;
  initializing = false;
  syncedDoc = view().state.doc;
  if (pendingText !== undefined) {
    const queued = pendingText;
    pendingText = undefined;
    applyExternalText(queued);
  }
}

function featureConfigs(t: Strings): CrepeConfig['featureConfigs'] {
  return {
    [Crepe.Feature.Placeholder]: { text: t.placeholder },
    [Crepe.Feature.CodeMirror]: {
      theme: [codeMirrorTheme, syntaxHighlighting(classHighlighter)],
      searchPlaceholder: t.searchLanguage,
      noResultText: t.noResult,
      copyText: t.copy,
      previewLabel: t.preview,
      previewLoading: t.loading,
      previewToggleText: (previewOnly) => (previewOnly ? t.edit : t.hide),
      renderPreview: renderMermaid,
    },
    [Crepe.Feature.ImageBlock]: {
      onUpload: uploadImage,
      blockUploadButton: t.uploadFile,
      inlineUploadButton: t.upload,
      blockUploadPlaceholderText: t.orPasteLink,
      inlineUploadPlaceholderText: t.orPasteLink,
      blockCaptionPlaceholderText: t.caption,
    },
    [Crepe.Feature.LinkTooltip]: {
      inputPlaceholder: t.linkPlaceholder,
      onCopyLink: (link) => void navigator.clipboard?.writeText(link),
    },
    [Crepe.Feature.BlockEdit]: {
      textGroup: {
        label: t.textGroup,
        text: { label: t.text },
        h1: { label: t.heading(1) },
        h2: { label: t.heading(2) },
        h3: { label: t.heading(3) },
        h4: { label: t.heading(4) },
        h5: { label: t.heading(5) },
        h6: { label: t.heading(6) },
        quote: { label: t.quote },
        divider: { label: t.divider },
      },
      listGroup: {
        label: t.listGroup,
        bulletList: { label: t.bulletList },
        orderedList: { label: t.orderedList },
        taskList: { label: t.taskList },
      },
      advancedGroup: {
        label: t.advancedGroup,
        image: { label: t.image },
        codeBlock: { label: t.codeBlock },
        table: { label: t.table },
        math: { label: t.math },
      },
    },
  };
}

function view(): EditorView {
  return crepe!.editor.ctx.get(editorViewCtx);
}

/** Sends the document to the extension if it changed locally since the last sync. */
function sendLocalChanges(): void {
  const text = takeUnsyncedMarkdown();
  if (text !== null) {
    vscode.postMessage({ type: 'edit', text });
  }
}

function takeUnsyncedMarkdown(): string | null {
  if (!crepe) {
    return null;
  }
  const doc = view().state.doc;
  if (syncedDoc && doc.eq(syncedDoc)) {
    return null;
  }
  syncedDoc = doc;
  return frontMatter + crepe.getMarkdown();
}

/**
 * Replaces the editor content with text that changed outside the webview.
 * Only the differing range is replaced so the cursor and scroll position
 * survive, and the transaction stays out of the undo history.
 */
function applyExternalText(text: string): void {
  if (!crepe) {
    pendingText = text;
    return;
  }
  const editorView = view();
  const { frontMatter: nextFrontMatter, body } = splitFrontMatter(text);
  setFrontMatter(nextFrontMatter);
  let next: ProseNode | undefined;
  try {
    next = crepe.editor.ctx.get(parserCtx)(body);
  } catch (err) {
    console.error('[md-wysiwyg] failed to parse markdown', err);
    return;
  }
  if (!next) {
    return;
  }

  const { state } = editorView;
  const start = state.doc.content.findDiffStart(next.content);
  if (start !== null) {
    let { a: endA, b: endB } = state.doc.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    editorView.dispatch(state.tr.replace(start, endA, next.slice(start, endB)).setMeta('addToHistory', false));
  }
  // Read back after dispatch: plugins may have appended their own changes.
  syncedDoc = editorView.state.doc;
}

/** Shows front matter read-only above the editor; it can be edited in the source view. */
function setFrontMatter(value: string): void {
  frontMatter = value;
  let panel = document.getElementById('front-matter') as HTMLDetailsElement | null;
  if (!value) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('details');
    panel.id = 'front-matter';
    panel.append(document.createElement('summary'), document.createElement('pre'));
    document.getElementById('app')!.before(panel);
  }
  panel.querySelector('summary')!.textContent = strings.frontMatter;
  panel.querySelector('pre')!.textContent = value.trimEnd();
}

function applyConfig(config: WebviewConfig): void {
  const width = config.maxWidth > 0 ? `${config.maxWidth}px` : 'none';
  document.documentElement.style.setProperty('--md-max-width', width);
}

function uploadImage(file: File): Promise<string> {
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise<string>((resolve, reject) => {
        const requestId = nextUploadId++;
        pendingUploads.set(requestId, { resolve, reject });
        vscode.postMessage({
          type: 'upload',
          requestId,
          name: file.name,
          mime: file.type,
          data: new Uint8Array(buffer),
        });
      }),
  );
}

/**
 * The editor keeps its own undo history, which tracks the cursor and is far
 * finer-grained than the TextDocument's. Keep undo/redo keys from also
 * reaching VS Code, which would undo the document a second time.
 */
function installKeyboardGuards(): void {
  document.getElementById('app')!.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) {
      return;
    }
    const key = e.key.toLowerCase();
    const isUndoRedo = key === 'z' || (key === 'y' && !e.shiftKey);
    if (!isUndoRedo) {
      return;
    }
    e.stopPropagation();
    // Text inputs (link editor, language search...) use the browser's own undo.
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
    }
  });
}

/** Links never navigate the webview; Ctrl/Cmd+click opens them through VS Code. */
function installLinkHandler(): void {
  document.addEventListener(
    'click',
    (e) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href]');
      if (!anchor) {
        return;
      }
      e.preventDefault();
      const insideEditor = !!anchor.closest('.ProseMirror');
      if (insideEditor && !(e.ctrlKey || e.metaKey)) {
        return;
      }
      vscode.postMessage({ type: 'openLink', href: anchor.getAttribute('href') ?? '' });
    },
    true,
  );
}

const codeMirrorTheme = CodeMirrorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editor-foreground)',
  },
  '.cm-content': {
    caretColor: 'var(--vscode-editorCursor-foreground)',
    fontFamily: 'var(--crepe-font-code)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--vscode-editorCursor-foreground)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
    },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editorLineNumber-foreground)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editorLineNumber-activeForeground)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--vscode-editorBracketMatch-background)',
    outline: '1px solid var(--vscode-editorBracketMatch-border)',
  },
});

type MermaidApi = (typeof import('mermaid'))['default'];
let mermaidLoader: Promise<MermaidApi> | undefined;
let mermaidRenderCount = 0;

/** Renders ```mermaid code blocks as diagrams; mermaid itself is loaded on first use. */
function renderMermaid(
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
): null | undefined {
  if (language.toLowerCase() !== 'mermaid' || !content.trim()) {
    return null;
  }
  mermaidLoader ??= import('mermaid').then((m) => m.default);
  void mermaidLoader
    .then(async (mermaid) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDarkTheme() ? 'dark' : 'default' });
      const { svg } = await mermaid.render(`mermaid-${++mermaidRenderCount}`, content);
      applyPreview(svg);
    })
    .catch((err: unknown) => {
      const message = document.createElement('pre');
      message.className = 'mermaid-error';
      message.textContent = err instanceof Error ? err.message : String(err);
      applyPreview(message);
    });
  return undefined;
}

function isDarkTheme(): boolean {
  const classes = document.body.classList;
  return (
    classes.contains('vscode-dark') ||
    (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light'))
  );
}
