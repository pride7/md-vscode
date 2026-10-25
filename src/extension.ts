import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    MarkdownEditorProvider.register(context),
    vscode.commands.registerCommand('mdWysiwyg.openEditor', (uri?: vscode.Uri) =>
      reopenWith(uri, MarkdownEditorProvider.viewType),
    ),
    vscode.commands.registerCommand('mdWysiwyg.openSource', (uri?: vscode.Uri) => reopenWith(uri, 'default')),
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
async function reopenWith(uri: vscode.Uri | undefined, viewType: string): Promise<void> {
  const target = uri instanceof vscode.Uri ? uri : activeResource();
  if (!target) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Open a Markdown file first.'));
    return;
  }

  const group = vscode.window.tabGroups.activeTabGroup;
  const previous = group.activeTab;
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
