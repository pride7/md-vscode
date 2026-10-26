import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = MarkdownEditorProvider.register(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('mdWysiwyg.openEditor', (uri?: vscode.Uri) =>
      reopenWith(provider, uri, MarkdownEditorProvider.viewType),
    ),
    vscode.commands.registerCommand('mdWysiwyg.openSource', (uri?: vscode.Uri) => reopenWith(provider, uri, 'default')),
    vscode.commands.registerCommand('mdWysiwyg.toggleEditor', (uri?: vscode.Uri) => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const inWysiwyg = input instanceof vscode.TabInputCustom && input.viewType === MarkdownEditorProvider.viewType;
      return reopenWith(provider, uri, inWysiwyg ? 'default' : MarkdownEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('mdWysiwyg.openEditorToSide', async (uri?: vscode.Uri) => {
      const target = uri instanceof vscode.Uri ? uri : activeResource();
      if (target) {
        await vscode.commands.executeCommand('vscode.openWith', target, MarkdownEditorProvider.viewType, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
        });
      }
    }),
  );
}

export function deactivate(): void {}

/**
 * Opens `uri` with the given editor in the current group and closes the tab it
 * replaces, so switching between source and WYSIWYG feels like a toggle.
 */
async function reopenWith(provider: MarkdownEditorProvider, uri: vscode.Uri | undefined, viewType: string): Promise<void> {
  const target = uri instanceof vscode.Uri ? uri : activeResource();
  if (!target) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Open a Markdown file first.'));
    return;
  }

  const group = vscode.window.tabGroups.activeTabGroup;
  const previous = group.activeTab;
  // Keystrokes from just before the switch may not have reached the document,
  // and the WYSIWYG tab holding them is about to close.
  await provider.sync(target);
  await vscode.commands.executeCommand('vscode.openWith', target, viewType, { viewColumn: group.viewColumn });

  // Only close a clean tab: closing a dirty one could prompt to save or discard.
  if (previous && !previous.isDirty && previous !== group.activeTab && tabResource(previous)?.toString() === target.toString()) {
    await vscode.window.tabGroups.close(previous, true);
  }
}

function activeResource(): vscode.Uri | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return (tab && tabResource(tab)) ?? vscode.window.activeTextEditor?.document.uri;
}

function tabResource(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}
