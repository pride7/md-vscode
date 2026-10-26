# Markdown 所见即所得编辑器

在 VS Code 里像 Typora 一样，所见即所得地编辑 Markdown 文件。编辑器内核是 [Milkdown Crepe](https://milkdown.dev)（基于 ProseMirror + remark）。

## 功能

- **所见即所得编辑**：标题、列表、任务列表、引用、表格、链接、图片等都直接以渲染后的样子编辑
- **斜杠菜单**：输入 `/` 插入标题、列表、代码块、表格、公式、图片等
- **格式工具栏**：选中文字后弹出，可设置粗体、斜体、删除线、行内代码和链接
- **拖动块**：鼠标移到段落左侧，可以拖动整块内容，或在下方插入新块
- **代码块**：基于 CodeMirror，支持语法高亮，可切换语言
- **数学公式**：行内 `$...$` 和块级 `$$...$$`，基于 KaTeX。块级公式直接显示渲染结果，点击公式（或用方向键移进去）即可编辑源码，光标离开后自动收起
- **Mermaid 图表**：```` ```mermaid ```` 代码块直接显示为图表，编辑方式同块级公式
- **图片粘贴/拖入**：自动保存到 Markdown 文件旁边的 `assets/` 文件夹，并插入相对路径
- **跟随 VS Code 主题**：浅色、深色和高对比度主题自动适配
- **与源码双向同步**：可以和普通文本编辑器并排打开同一个文件，两边的修改实时同步
- **保留 Front Matter**：文件开头的 YAML（`---`）或 TOML（`+++`）元数据会原样保留

## 使用方法

| 操作 | 方式 |
| --- | --- |
| 在源码和所见即所得之间切换 | 按 `Ctrl+E`（macOS 上是 `Cmd+E`），或点击编辑器右上角的 👁 / `</>` 按钮 |
| 用所见即所得模式打开 | 也可以在资源管理器中右键 → “在所见即所得编辑器中打开” |
| 在侧边打开 | 命令面板 → “Markdown WYSIWYG: 在侧边打开所见即所得编辑器” |
| 打开链接 | 按住 `Ctrl`（macOS 上是 `Cmd`）点击链接。相对路径的 `.md` 文件会用本编辑器打开 |

`Ctrl+E` 只在 Markdown 编辑器里生效，可以在“键盘快捷方式”中搜索“切换源码 / 所见即所得”改成别的键。所见即所得模式下行内代码没有快捷键，用格式工具栏或直接输入 `` `代码` ``。

### 设为 Markdown 的默认编辑器

插件默认不接管 `.md` 文件的打开方式。如果希望双击 `.md` 文件时直接进入所见即所得模式，在 `settings.json` 中加入：

```json
"workbench.editorAssociations": {
  "*.md": "mdWysiwyg.editor"
}
```

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `mdWysiwyg.imageFolder` | `assets` | 粘贴/拖入的图片保存到哪个文件夹（相对于 Markdown 文件）。留空则与文件保存在同一目录 |
| `mdWysiwyg.maxWidth` | `0` | 编辑区域最大宽度（像素），`0` 表示占满整个宽度 |

## 已知限制

所见即所得编辑器先把 Markdown 解析成文档结构，保存时再重新生成 Markdown。所以**在所见即所得模式下第一次修改文件时**，一些写法会被统一成标准格式（内容和渲染效果不变）：

- 引用式链接（链接地址写在文末的写法）会被改写成行内链接
- 缩进式代码块会被改写成 ```` ``` ```` 围栏代码块
- 表格的列宽会被重新对齐
- 部分特殊字符会被转义（例如 `2 * 3` 变成 `2 \* 3`）

只打开、不修改的文件不会有任何变化；在源码编辑器中的修改也不会触发格式化。Front Matter 只能在源码模式下编辑。

## 开发

```bash
npm install
npm run build       # 构建到 dist/
npm run watch       # 监听文件变化自动构建
npm run typecheck   # 类型检查
npm test            # 单元测试
npm run test:e2e    # 在真实 VS Code 中跑集成测试
npm run package     # 打包成 .vsix
```

在 VS Code 中按 `F5` 会启动一个加载了本插件的新窗口，并打开 `samples/` 示例文件夹。

`test:e2e` 默认会下载一份 VS Code。如果想用本机已安装的 VS Code，设置环境变量 `VSCODE_EXECUTABLE` 指向 `Code.exe`。

### 目录结构

```
src/                       插件端（运行在 VS Code 扩展进程中）
  extension.ts             入口，注册编辑器和命令
  markdownEditorProvider.ts  自定义编辑器：webview 与 TextDocument 的同步、保存、图片、链接
  textDiff.ts              把整篇文本替换压缩成最小编辑范围
webview/                   编辑器页面（运行在 webview 中）
  main.ts                  创建 Milkdown 编辑器，处理与插件端的消息
  markdownFormat.ts        Markdown 输出格式调整、Front Matter 处理
  style.css                把 VS Code 主题颜色映射到编辑器
  i18n.ts                  界面文字（中/英）
test/                      单元测试和集成测试
samples/                   示例文档
```
