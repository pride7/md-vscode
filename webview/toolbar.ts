import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  hrSchema,
  inlineCodeSchema,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  strongSchema,
} from '@milkdown/kit/preset/commonmark';
import { createTable, strikethroughSchema, tableSchema } from '@milkdown/kit/preset/gfm';
import { setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import type { Mark, MarkType, Node as ProseNode, NodeType, ResolvedPos } from '@milkdown/kit/prose/model';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { Plugin, Selection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { insertPoint, liftTarget } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { Strings } from './i18n';

interface Action {
  label: string;
  icon: string;
  /** Applies the action. Called without `dispatch`, it only tells whether the action applies. */
  command: Command;
  isActive?: (state: EditorState) => boolean;
}

interface Actions {
  /** Groups of buttons, separated by dividers. */
  groups: Action[][];
  /** Less common actions, under the "more" button. */
  more: Action[];
}

/**
 * A formatting toolbar pinned to the top of the page: block types, inline
 * marks, lists, and less common inserts under a "more" menu. Buttons reflect
 * the formatting at the cursor.
 */
export class Toolbar {
  private readonly root = document.createElement('div');
  private readonly row = document.createElement('div');
  private readonly moreButton = document.createElement('button');
  private readonly menu = document.createElement('div');
  private view: EditorView | undefined;
  private buttons: { element: HTMLButtonElement; action: Action }[] = [];
  private moreActions: Action[] = [];

  readonly plugin = $prose(
    (ctx) =>
      new Plugin({
        view: (view) => {
          this.view = view;
          this.render(createActions(ctx, this.strings));
          return {
            update: () => this.update(),
            destroy: () => {
              this.view = undefined;
            },
          };
        },
      }),
  );

  constructor(private readonly strings: Strings) {
    this.root.id = 'toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', strings.toolbar);
    this.row.className = 'toolbar-row';
    this.root.append(this.row);
    document.body.prepend(this.root);

    this.moreButton.type = 'button';
    this.moreButton.className = 'toolbar-button';
    this.moreButton.title = strings.more;
    this.moreButton.setAttribute('aria-label', strings.more);
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.innerHTML = ICONS.more;
    this.menu.className = 'toolbar-menu';
    this.menu.hidden = true;

    // Keep focus (and the selection) in the editor when a button is clicked.
    this.root.addEventListener('mousedown', (e) => e.preventDefault());
    this.root.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target.closest('.toolbar-more > .toolbar-button')) {
        this.setMenuOpen(this.menu.hidden);
        return;
      }
      const element = target.closest<HTMLButtonElement>('button[data-index]');
      const entry = element && this.buttons[Number(element.dataset.index)];
      if (entry && element.getAttribute('aria-disabled') !== 'true') {
        this.setMenuOpen(false);
        this.run(entry.action);
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !(e.target as Element).closest?.('.toolbar-more')) {
        this.setMenuOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) {
        this.setMenuOpen(false);
      }
    });

    // Headings scrolled to (from the table of contents) must clear the toolbar.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--toolbar-height', `${this.root.offsetHeight}px`);
    }).observe(this.root);
  }

  setEnabled(enabled: boolean): void {
    this.root.hidden = !enabled;
    this.setMenuOpen(false);
    this.update();
  }

  private render({ groups, more }: Actions): void {
    this.buttons = [];
    const children: HTMLElement[] = [];
    for (const group of groups) {
      if (children.length > 0) {
        const separator = document.createElement('span');
        separator.className = 'toolbar-separator';
        separator.setAttribute('role', 'separator');
        children.push(separator);
      }
      children.push(...group.map((action) => this.createButton(action, 'toolbar-button')));
    }

    this.moreActions = more;
    this.menu.replaceChildren(
      ...more.map((action) => {
        const item = this.createButton(action, 'toolbar-menu-item');
        // The item shows its label.
        item.removeAttribute('title');
        item.removeAttribute('aria-label');
        const label = document.createElement('span');
        label.textContent = action.label;
        item.append(label);
        return item;
      }),
    );
    const moreGroup = document.createElement('div');
    moreGroup.className = 'toolbar-more';
    moreGroup.append(this.moreButton, this.menu);
    children.push(moreGroup);

    this.row.replaceChildren(...children);
    this.update();
  }

  private createButton(action: Action, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.index = String(this.buttons.length);
    button.title = action.label;
    button.setAttribute('aria-label', action.label);
    button.innerHTML = action.icon;
    this.buttons.push({ element: button, action });
    return button;
  }

  private update(): void {
    const state = this.view?.state;
    if (!state || this.root.hidden) {
      return;
    }
    for (const { element, action } of this.buttons) {
      const active = action.isActive?.(state) ?? false;
      if (action.isActive) {
        element.setAttribute('aria-pressed', String(active));
      }
      element.setAttribute('aria-disabled', String(!active && !action.command(state)));
    }
    const moreActive = this.moreActions.some((action) => action.isActive?.(state));
    this.moreButton.classList.toggle('active', moreActive);
  }

  private run(action: Action): void {
    const view = this.view;
    if (!view) {
      return;
    }
    action.command(view.state, view.dispatch, view);
    view.focus();
  }

  private setMenuOpen(open: boolean): void {
    this.menu.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
  }
}

type ListKind = 'bullet' | 'ordered' | 'task';

function createActions(ctx: Ctx, t: Strings): Actions {
  const paragraph = paragraphSchema.type(ctx);
  const heading = headingSchema.type(ctx);
  const blockquote = blockquoteSchema.type(ctx);
  const codeBlock = codeBlockSchema.type(ctx);
  const link = linkSchema.type(ctx);

  const headingAction = (level: number, icon: string): Action => {
    const isActive = (state: EditorState) => isHeading(state, heading, level);
    return {
      label: t.heading(level),
      icon,
      isActive,
      // Clicking the heading level the block already has turns it back into a paragraph.
      command: (state, dispatch) =>
        (isActive(state) ? setBlockType(paragraph) : setBlockType(heading, { level }))(state, dispatch),
    };
  };
  const markAction = (label: string, icon: string, type: MarkType): Action => ({
    label,
    icon,
    isActive: (state) => isMarkActive(state, type),
    command: toggleMark(type),
  });
  const listAction = (label: string, icon: string, kind: ListKind): Action => ({
    label,
    icon,
    isActive: (state) => listAt(ctx, state)?.kind === kind,
    command: toggleList(ctx, kind),
  });

  return {
    groups: [
      [
        {
          label: t.text,
          icon: ICONS.paragraph,
          isActive: (state) => state.selection.$from.parent.type === paragraph,
          command: setBlockType(paragraph),
        },
        headingAction(1, ICONS.h1),
        headingAction(2, ICONS.h2),
        headingAction(3, ICONS.h3),
      ],
      [
        markAction(t.bold, ICONS.bold, strongSchema.type(ctx)),
        markAction(t.italic, ICONS.italic, emphasisSchema.type(ctx)),
        markAction(t.strikethrough, ICONS.strikethrough, strikethroughSchema.type(ctx)),
      ],
      [
        listAction(t.bulletList, ICONS.bulletList, 'bullet'),
        listAction(t.orderedList, ICONS.orderedList, 'ordered'),
        listAction(t.taskList, ICONS.taskList, 'task'),
      ],
      [
        {
          label: t.quote,
          icon: ICONS.quote,
          isActive: (state) => hasAncestor(state, blockquote),
          command: (state, dispatch) =>
            (hasAncestor(state, blockquote) ? liftOutOf(blockquote) : wrapIn(blockquote))(state, dispatch),
        },
        {
          label: t.link,
          icon: ICONS.link,
          isActive: (state) => isMarkActive(state, link),
          command: (state, dispatch) => {
            if (!toggleMark(link)(state)) {
              return false;
            }
            if (dispatch) {
              editLink(ctx, state, link);
            }
            return true;
          },
        },
        {
          label: t.image,
          icon: ICONS.image,
          command: insertBlock(imageBlockSchema.type(ctx)),
        },
      ],
    ],
    more: [
      markAction(t.inlineCode, ICONS.inlineCode, inlineCodeSchema.type(ctx)),
      {
        label: t.codeBlock,
        icon: ICONS.codeBlock,
        isActive: (state) => state.selection.$from.parent.type === codeBlock,
        command: (state, dispatch) =>
          setBlockType(state.selection.$from.parent.type === codeBlock ? paragraph : codeBlock)(state, dispatch),
      },
      {
        label: t.math,
        icon: ICONS.math,
        command: insertBlock(codeBlock, () => codeBlock.create({ language: 'LaTeX' })),
      },
      {
        label: t.table,
        icon: ICONS.table,
        command: insertBlock(tableSchema.type(ctx), () => createTable(ctx, 3, 3)),
      },
      {
        label: t.divider,
        icon: ICONS.divider,
        command: insertBlock(hrSchema.type(ctx)),
      },
    ],
  };
}

function isHeading(state: EditorState, type: NodeType, level: number): boolean {
  const block = state.selection.$from.parent;
  return block.type === type && block.attrs.level === level;
}

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    return !!type.isInSet(state.storedMarks ?? $from.marks());
  }
  return state.doc.rangeHasMark(from, to, type);
}

function hasAncestor(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === type) {
      return true;
    }
  }
  return false;
}

/** Lifts the selected blocks out of the nearest ancestor of the given type. */
function liftOutOf(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, (node) => node.type === type);
    const target = range && liftTarget(range);
    if (!range || target == null) {
      return false;
    }
    dispatch?.(state.tr.lift(range, target).scrollIntoView());
    return true;
  };
}

/** The innermost list around the cursor, and what kind of list its item at the cursor is in. */
function listAt(ctx: Ctx, state: EditorState): { node: ProseNode; pos: number; kind: ListKind } | undefined {
  const bulletList = bulletListSchema.type(ctx);
  const orderedList = orderedListSchema.type(ctx);
  const { $from } = state.selection;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === bulletList || node.type === orderedList) {
      const item = $from.node(depth + 1);
      const kind = item.attrs.checked != null ? 'task' : node.type === orderedList ? 'ordered' : 'bullet';
      return { node, pos: $from.before(depth), kind };
    }
  }
  return undefined;
}

/**
 * Takes the selected items out of a list of this kind, turns the list around
 * the cursor into this kind, or wraps the selected blocks in a new list.
 */
function toggleList(ctx: Ctx, kind: ListKind): Command {
  return (state, dispatch) => {
    const listItem = listItemSchema.type(ctx);
    const listType = kind === 'ordered' ? orderedListSchema.type(ctx) : bulletListSchema.type(ctx);
    const list = listAt(ctx, state);
    if (list?.kind === kind) {
      return liftListItem(listItem)(state, dispatch);
    }
    if (list) {
      if (dispatch) {
        const tr = state.tr.setNodeMarkup(list.pos, listType, { spread: list.node.attrs.spread });
        list.node.forEach((item, offset, index) => {
          tr.setNodeMarkup(list.pos + 1 + offset, undefined, {
            ...item.attrs,
            // The list order plugin turns a bullet list back into an ordered one by these.
            listType: kind === 'ordered' ? 'ordered' : 'bullet',
            label: kind === 'ordered' ? `${index + 1}.` : '•',
            checked: kind === 'task' ? (item.attrs.checked ?? false) : null,
          });
        });
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (kind !== 'task') {
      return wrapInList(listType)(state, dispatch);
    }
    return wrapInList(listType)(state, dispatch && ((tr: Transaction) => dispatch(uncheckItems(tr, listItem))));
  };
}

/** Turns the list items in the selection into unchecked task items. */
function uncheckItems(tr: Transaction, listItem: NodeType): Transaction {
  const { from, to } = tr.selection;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === listItem && node.attrs.checked == null) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
    }
  });
  return tr;
}

/**
 * Opens the link editor: for the link at the cursor, or to add a link to the
 * selection. A selection that has a link loses it, like the selection toolbar's button.
 */
function editLink(ctx: Ctx, state: EditorState, type: MarkType): void {
  const api = ctx.get(linkTooltipAPI.key);
  const { from, to, empty, $from } = state.selection;
  const mark = empty ? type.isInSet($from.marks()) : undefined;
  if (mark) {
    const range = markRange($from, mark);
    api.editLink(mark, range.from, range.to);
  } else if (state.doc.rangeHasMark(from, to, type)) {
    api.removeLink(from, to);
  } else {
    api.addLink(from, to);
  }
}

/** The extent of the run of text around a position that has the mark. */
function markRange($pos: ResolvedPos, mark: Mark): { from: number; to: number } {
  const parent = $pos.parent;
  let startIndex = $pos.index();
  let endIndex = $pos.indexAfter();
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex--;
  }
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    endIndex++;
  }
  let from = $pos.start();
  for (let i = 0; i < startIndex; i++) {
    from += parent.child(i).nodeSize;
  }
  let to = from;
  for (let i = startIndex; i < endIndex; i++) {
    to += parent.child(i).nodeSize;
  }
  return { from, to };
}

/**
 * Inserts a block in place of the empty block at the cursor, or else after the
 * block at the cursor rather than splitting it. The cursor moves into the new block.
 */
function insertBlock(type: NodeType, create: () => ProseNode = () => type.create()): Command {
  return (state, dispatch) => {
    const range = insertionRange(state, type);
    if (!range) {
      return false;
    }
    if (dispatch) {
      const node = create();
      const tr = state.tr.replaceWith(range.from, range.to, node);
      let cursor = range.from + 1;
      if (node.isAtom) {
        // Nothing to type in a divider or an image: leave a paragraph after it.
        const end = range.from + node.nodeSize;
        const $end = tr.doc.resolve(end);
        const filler = $end.parent.contentMatchAt($end.index()).defaultType?.createAndFill();
        if (filler && !$end.nodeAfter?.isTextblock) {
          tr.insert(end, filler);
        }
        cursor = end + 1;
      }
      tr.setSelection(Selection.near(tr.doc.resolve(cursor)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function insertionRange(state: EditorState, type: NodeType): { from: number; to: number } | undefined {
  const { $from, $to } = state.selection;
  const block = $from.parent;
  if (
    $from.sameParent($to) &&
    block.isTextblock &&
    block.content.size === 0 &&
    $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type)
  ) {
    return { from: $from.before(), to: $from.after() };
  }
  const pos = insertPoint(state.doc, $to.parent.isTextblock ? $to.after() : $to.pos, type);
  return pos == null ? undefined : { from: pos, to: pos };
}

function icon(body: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const HEADING_BAR = '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/>';

/** Icons from Lucide (https://lucide.dev), ISC License. */
const ICONS = {
  paragraph: icon('<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>'),
  h1: icon(`${HEADING_BAR}<path d="m17 12 3-2v8"/>`),
  h2: icon(`${HEADING_BAR}<path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>`),
  h3: icon(
    `${HEADING_BAR}<path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>`,
  ),
  bold: icon('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>'),
  italic: icon('<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>'),
  strikethrough: icon('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><path d="M4 12h16"/>'),
  bulletList: icon(
    '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  ),
  orderedList: icon(
    '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  ),
  taskList: icon(
    '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  ),
  quote: icon(
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  ),
  link: icon(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  ),
  image: icon(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  ),
  more: icon('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  inlineCode: icon('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  codeBlock: icon('<path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/><rect x="3" y="3" width="18" height="18" rx="2"/>'),
  math: icon(
    '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>',
  ),
  table: icon('<path d="M12 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'),
  divider: icon('<path d="M3 12h18"/>'),
};
