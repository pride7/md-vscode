import { remarkStringifyOptionsCtx, type Editor } from '@milkdown/kit/core';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import type { NodeSchema } from '@milkdown/kit/transformer';

/**
 * Tunes Milkdown's markdown output toward the most common conventions, so a
 * small edit doesn't rewrite unrelated parts of the file.
 */
export function configureMarkdown(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({
      ...prev,
      bullet: '-' as const,
      rule: '-' as const,
    }));
    // Pad table columns by display width, so CJK text and emoji line up.
    ctx.update(remarkGFMPlugin.options.key, (prev) => ({ ...prev, stringLength: displayWidth }));
    ctx.update(imageBlockSchema.key, (prev) => (schemaCtx) => preserveImageAlt(prev(schemaCtx)));
  });
}

/**
 * Milkdown's image block stores its resize ratio in the alt text (`![1.00](src)`),
 * which destroys real alt text. Keep alt text, and only fall back to writing the
 * ratio when an image has none.
 */
function preserveImageAlt(base: NodeSchema): NodeSchema {
  return {
    ...base,
    attrs: { ...base.attrs, alt: { default: '', validate: 'string' } },
    parseDOM: base.parseDOM?.map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement) => {
        const attrs = rule.getAttrs ? rule.getAttrs(dom) : {};
        return attrs ? { ...attrs, alt: dom.getAttribute('alt') ?? '' } : attrs;
      },
    })),
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        const alt = typeof node.alt === 'string' ? node.alt : '';
        const isRatio = /^\d+(\.\d+)?$/.test(alt) && Number(alt) > 0;
        state.addNode(type, {
          src: (node.url as string) ?? '',
          caption: (node.title as string) ?? '',
          ratio: isRatio ? Number(alt) : 1,
          alt: isRatio ? '' : alt,
        });
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const { src, caption, ratio, alt } = node.attrs;
        const ratioValue = Number.parseFloat(ratio);
        const altText = alt || (ratioValue && ratioValue !== 1 ? ratioValue.toFixed(2) : '');
        state.openNode('paragraph');
        state.addNode('image', undefined, undefined, { title: caption, url: src, alt: altText });
        state.closeNode();
      },
    },
  };
}

/** Width of a string in monospace columns: East Asian wide characters and emoji count as two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (isZeroWidth(code)) {
      continue;
    }
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isZeroWidth(code: number): boolean {
  return (
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0x1f3fb && code <= 0x1f3ff)
  );
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd) ||
    WIDE_SYMBOLS.has(code)
  );
}

/** Emoji below U+1F000 that terminals and editors render two columns wide. */
const WIDE_SYMBOLS = new Set([
  0x231a, 0x231b, 0x23e9, 0x23ea, 0x23eb, 0x23ec, 0x23f0, 0x23f3, 0x25fd, 0x25fe, 0x2614, 0x2615, 0x267f, 0x2693,
  0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa,
  0x26fd, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797,
  0x27b0, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55, 0x1f004, 0x1f0cf, 0x1f18e, 0x1f201, 0x1f21a, 0x1f22f,
  ...range(0x2648, 0x2653),
  ...range(0x1f191, 0x1f19a),
  ...range(0x1f232, 0x1f236),
  ...range(0x1f238, 0x1f23a),
  ...range(0x1f680, 0x1f6ff),
]);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const FRONT_MATTER = /^(?:---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)|\+\+\+[ \t]*\r?\n[\s\S]*?\r?\n\+\+\+)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

/**
 * Splits YAML (`---`) or TOML (`+++`) front matter off the top of a document.
 * The editor has no front matter support and would turn it into a rule and a
 * setext heading, so it is kept aside verbatim, trailing blank lines included.
 */
export function splitFrontMatter(text: string): { frontMatter: string; body: string } {
  const match = FRONT_MATTER.exec(text);
  return match ? { frontMatter: match[0], body: text.slice(match[0].length) } : { frontMatter: '', body: text };
}
