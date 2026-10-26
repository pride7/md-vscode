# Markdown WYSIWYG (Milkdown)

English | [简体中文](README.zh-CN.md)

Edit Markdown files in VS Code the way you would in Typora: what you see is what you get. The editor is built on [Milkdown Crepe](https://milkdown.dev) (ProseMirror + remark).

## Installation

Search for "Markdown WYSIWYG (Milkdown)" in the Extensions view, or press `Ctrl+P` to open Quick Open and run:

```
ext install pride7.markdown-wysiwyg-milkdown
```

## Features

- **WYSIWYG editing**: headings, lists, task lists, blockquotes, tables, links and images are edited the way they render
- **Slash menu**: type `/` to insert headings, lists, code blocks, tables, math, images and more
- **Formatting toolbar**: appears when you select text, with bold, italic, strikethrough, inline code and links
- **Drag handles**: hover to the left of a paragraph to drag the whole block, or insert a new block below it
- **Code blocks**: CodeMirror with syntax highlighting and a language picker
- **Math**: inline `$...$` and block `$$...$$`, rendered with KaTeX. Block math shows the rendered result; click it (or move into it with the arrow keys) to edit the source, and it collapses again when the cursor leaves
- **Mermaid diagrams**: ```` ```mermaid ```` code blocks show as diagrams and are edited the same way as block math
- **Floating table of contents**: as in Notion, short lines at the right edge of the editor stand for the headings. Hover them to expand a table of contents, click a heading to jump to it, and the current section is highlighted
- **Paste or drop images**: images are saved to an `assets/` folder next to the Markdown file and inserted with a relative path
- **Follows your VS Code theme**: light, dark and high-contrast themes are all supported
- **Two-way sync with the source**: open the same file in a regular text editor side by side, and edits on either side show up in the other right away
- **Front matter is kept**: YAML (`---`) or TOML (`+++`) metadata at the top of the file is preserved as is

## Usage

| Action | How |
| --- | --- |
| Switch between source and WYSIWYG | Press `Ctrl+E` (`Cmd+E` on macOS), or click the 👁 / `</>` button at the top right of the editor |
| Open in WYSIWYG mode | You can also right-click a file in the Explorer → "Open in WYSIWYG Editor" |
| Open to the side | Command Palette → "Markdown WYSIWYG: Open WYSIWYG Editor to the Side" |
| Follow a link | Hold `Ctrl` (`Cmd` on macOS) and click the link. Relative links to `.md` files open in this editor |

`Ctrl+E` only works in Markdown editors. To use a different key, search for "Toggle Source / WYSIWYG" in Keyboard Shortcuts. Inline code has no shortcut in WYSIWYG mode; use the formatting toolbar or type `` `code` `` directly.

### Make it the default editor for Markdown

By default the extension does not change how `.md` files open. To open them in WYSIWYG mode when you double-click them, add this to `settings.json`:

```json
"workbench.editorAssociations": {
  "*.md": "mdWysiwyg.editor"
}
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mdWysiwyg.imageFolder` | `assets` | Folder, relative to the Markdown file, where pasted or dropped images are saved. Leave empty to save them next to the file |
| `mdWysiwyg.maxWidth` | `0` | Maximum width of the editing area in pixels. `0` uses the full width |
| `mdWysiwyg.tableOfContents` | `true` | Show the floating table of contents at the right edge of the editor (it appears only when there are at least two headings) |

## Known limitations

The WYSIWYG editor parses Markdown into a document tree and turns it back into Markdown when you save. So **the first time you edit a file in WYSIWYG mode**, some syntax is rewritten into a standard form (the content and how it renders stay the same):

- Reference-style links (with the URL written at the end of the file) become inline links
- Indented code blocks become ```` ``` ```` fenced code blocks
- Table columns are realigned
- Some special characters are escaped (for example, `2 * 3` becomes `2 \* 3`)

Files you only open without editing are never changed, and edits in the source editor never trigger this rewriting. Front matter can only be edited in source mode.

## Development

```bash
npm install
npm run build          # build into dist/
npm run watch          # rebuild on file changes
npm run typecheck      # type-check
npm test               # unit tests
npm run test:e2e       # integration tests in a real VS Code
npm run package        # package as a .vsix
npm run install-local  # package and install into your local VS Code (replaces an installed copy of the same version)
```

After `install-local`, run `Developer: Reload Window` in any VS Code window that is already open, or click "Restart Extensions" in the Extensions view, for the new build to take effect.

Press `F5` in VS Code to open a new window with the extension loaded and the `samples/` folder open.

`test:e2e` downloads a copy of VS Code by default. To use the VS Code installed on your machine instead, set the `VSCODE_EXECUTABLE` environment variable to the path of `Code.exe`.

### Project structure

```
src/                       extension side (runs in the VS Code extension host)
  extension.ts             entry point, registers the editor and commands
  markdownEditorProvider.ts  custom editor: syncs the webview with the TextDocument, saving, images, links
  textDiff.ts              shrinks a whole-document replacement into the smallest edit
webview/                   editor page (runs in the webview)
  main.ts                  creates the Milkdown editor and handles messages from the extension
  markdownFormat.ts        Markdown output tweaks and front matter handling
  style.css                maps VS Code theme colors onto the editor
  i18n.ts                  UI strings (Chinese / English)
test/                      unit and integration tests
samples/                   sample documents
```

## License

[MIT](LICENSE)
