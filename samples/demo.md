# Markdown 所见即所得编辑器

这是一个**示例文档**，用来体验插件的各项功能。可以直接在这里修改，*所见即所得*。

输入 `/` 可以唤出命令菜单；选中文字会弹出格式工具栏；鼠标移到段落左侧可以拖动整个块。

## 列表

- 无序列表
- 支持 **粗体**、*斜体*、~~删除线~~ 和 `行内代码`
  - 嵌套列表

1. 有序列表
2. 第二项

- [x] 已完成的任务
- [ ] 未完成的任务

## 引用与链接

> 引用块：好的工具让人专注于内容本身。

按住 Ctrl（macOS 上是 Cmd）点击链接即可打开：[VS Code 官网](https://code.visualstudio.com)

## 表格

| 功能     | 支持情况 | 备注              |
| :------- | :------: | ----------------: |
| 表格     |    ✅    |  可增删行列       |
| 代码高亮 |    ✅    |  基于 CodeMirror  |
| 数学公式 |    ✅    |  基于 KaTeX       |

## 代码块

```ts
function greet(name: string): string {
  // 代码块内是完整的 CodeMirror 编辑器
  return `Hello, ${name}!`;
}
```

## 数学公式

行内公式：$E = mc^2$

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## Mermaid 图表

```mermaid
graph LR
  A[Markdown 文件] --> B(所见即所得编辑)
  B --> C{保存}
  C -->|Ctrl+S| A
```

## 图片

![示例图片](assets/sample.svg)

---

直接粘贴或拖入图片，会自动保存到 `assets/` 文件夹。
