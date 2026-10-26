const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'mdWysiwyg.editor';

// Content the editor's serializer would rewrite (CRLF, `*` bullets, reference
// links), so any unwanted round trip through the webview shows up on disk.
const ORIGINAL = ['# Title', '', '* star bullet', '* another', '', 'Text with [a reference][r].', '', '[r]: https://example.com', ''].join('\r\n');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(description, predicate, timeout = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await sleep(50);
  }
}

function tabsFor(uri) {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input && tab.input.uri && tab.input.uri.toString() === uri.toString());
}

const isCustomTab = (tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
const isTextTab = (tab) => tab.input instanceof vscode.TabInputText;

function createFile(name, content) {
  const dir = process.env.MD_WYSIWYG_WORKSPACE;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return vscode.Uri.file(file);
}

test('opens a markdown file in the WYSIWYG editor', async () => {
  const uri = createFile('open.md', ORIGINAL);
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  await waitFor('custom editor tab', () => tabsFor(uri).some(isCustomTab));
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('external edits save byte-for-byte, and the webview answers the save flush', async () => {
  const uri = createFile('save.md', ORIGINAL);
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  await waitFor('custom editor tab', () => tabsFor(uri).some(isCustomTab));
  // Give the webview time to load its bundle and start the editor.
  await sleep(4000);

  const document = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 7), ' Edited');
  assert.ok(await vscode.workspace.applyEdit(edit));
  // Let the update reach the webview; it must not echo a reformatted copy back.
  await sleep(1500);
  assert.equal(document.getText(), ORIGINAL.replace('# Title', '# Title Edited'));

  const start = Date.now();
  assert.ok(await document.save());
  const elapsed = Date.now() - start;

  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), ORIGINAL.replace('# Title', '# Title Edited'));
  // The flush request times out after 1s when the webview script isn't running.
  assert.ok(elapsed < 900, `save took ${elapsed}ms; the webview did not answer the flush request`);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('toggles between source and WYSIWYG in place', async () => {
  const uri = createFile('toggle.md', ORIGINAL);
  await vscode.window.showTextDocument(uri);
  await waitFor('text editor tab', () => tabsFor(uri).some(isTextTab));

  await vscode.commands.executeCommand('mdWysiwyg.openEditor', uri);
  await waitFor('only the WYSIWYG tab', () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && isCustomTab(tabs[0]);
  });

  await vscode.commands.executeCommand('mdWysiwyg.openSource', uri);
  await waitFor('only the source tab', () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && isTextTab(tabs[0]);
  });
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('the toggle command switches either way without touching the document', async () => {
  const uri = createFile('toggle-command.md', ORIGINAL);
  await vscode.window.showTextDocument(uri);
  await waitFor('text editor tab', () => tabsFor(uri).some(isTextTab));

  await vscode.commands.executeCommand('mdWysiwyg.toggleEditor');
  await waitFor('only the WYSIWYG tab', () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && isCustomTab(tabs[0]);
  });
  // Give the webview time to start, so switching back has to ask it for unsynced edits.
  await sleep(4000);

  const start = Date.now();
  await vscode.commands.executeCommand('mdWysiwyg.toggleEditor');
  const elapsed = Date.now() - start;
  await waitFor('only the source tab', () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && isTextTab(tabs[0]);
  });
  // The sync request times out after 1s when the webview doesn't answer.
  assert.ok(elapsed < 900, `switching took ${elapsed}ms; the webview did not answer the sync request`);

  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.isDirty, false);
  assert.equal(document.getText(), ORIGINAL);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('reopening the WYSIWYG editor does not modify the document', async () => {
  const uri = createFile('reopen.md', ORIGINAL);
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  await sleep(3000);
  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.isDirty, false);
  assert.equal(document.getText(), ORIGINAL);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

exports.run = async function run() {
  const extension = vscode.extensions.all.find((ext) => ext.packageJSON.name === 'markdown-wysiwyg-milkdown');
  assert.ok(extension, 'extension under test is not loaded');
  await extension.activate();

  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (err) {
      failures++;
      console.error(`  ✘ ${name}\n${err && err.stack ? err.stack : err}`);
    }
  }
  console.log(`${tests.length - failures} passed, ${failures} failed`);
  if (failures > 0) {
    throw new Error(`${failures} test(s) failed`);
  }
};
