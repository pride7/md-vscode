import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

interface Heading {
  level: number;
  text: string;
  pos: number;
}

/** A document needs at least this many headings for an outline to be worth showing. */
const MIN_HEADINGS = 2;

/**
 * A Notion-style outline floating at the right edge: one short dash per heading,
 * expanding into a list of heading titles on hover. Clicking a title scrolls to
 * it, and the heading of the section being read stays highlighted.
 */
export class TableOfContents {
  private readonly root = document.createElement('nav');
  private readonly rail = document.createElement('div');
  private readonly panel = document.createElement('div');
  private view: EditorView | undefined;
  private headings: Heading[] = [];
  private signature = '';
  private active = -1;
  /**
   * Where the page was left by a jump from the list. Until it scrolls away, the
   * picked heading stays highlighted, even if it can't reach the top of the page.
   */
  private pinnedScrollY: number | undefined;
  private enabled = true;
  private refreshFrame = 0;
  private scrollFrame = 0;

  readonly plugin = $prose(
    () =>
      new Plugin({
        view: (view) => {
          this.view = view;
          this.scheduleRefresh();
          return {
            update: (view, prevState) => {
              if (view.state.doc !== prevState.doc) {
                this.scheduleRefresh();
              }
            },
            destroy: () => {
              this.view = undefined;
            },
          };
        },
      }),
  );

  constructor(label: string) {
    this.root.id = 'toc';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', label);
    this.rail.className = 'toc-rail';
    this.rail.setAttribute('aria-hidden', 'true');
    this.panel.className = 'toc-panel';
    this.root.append(this.rail, this.panel);
    document.body.append(this.root);

    // Keep focus (and the cursor) in the editor when a title is clicked.
    this.panel.addEventListener('mousedown', (e) => e.preventDefault());
    this.panel.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('.toc-item');
      if (item) {
        this.scrollTo(Number(item.dataset.index));
      }
    });
    this.root.addEventListener('mouseenter', () => this.revealActiveItem());

    window.addEventListener('scroll', () => this.scheduleActiveUpdate(), { passive: true });
    window.addEventListener('resize', () => this.scheduleActiveUpdate(), { passive: true });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateVisibility();
    this.updateActive();
  }

  private scheduleRefresh(): void {
    cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = requestAnimationFrame(() => this.refresh());
  }

  private scheduleActiveUpdate(): void {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => this.updateActive());
  }

  private refresh(): void {
    if (!this.view) {
      return;
    }
    const headings: Heading[] = [];
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') {
        return true;
      }
      const text = node.textContent.trim();
      if (text) {
        headings.push({ level: node.attrs.level as number, text, pos });
      }
      return false;
    });
    this.headings = headings;

    // Edits outside headings only shift positions; leave the rendered list alone.
    const signature = headings.map((h) => `${h.level} ${h.text}`).join('\n');
    if (signature !== this.signature) {
      this.signature = signature;
      this.pinnedScrollY = undefined;
      this.active = -1;
      this.render();
    }
    this.updateActive();
  }

  private render(): void {
    const topLevel = Math.min(...this.headings.map((h) => h.level));
    const dashes = this.headings.map((h) => {
      const dash = document.createElement('div');
      dash.className = 'toc-dash';
      dash.style.setProperty('--toc-depth', String(h.level - topLevel));
      return dash;
    });
    const items = this.headings.map((h, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'toc-item';
      item.dataset.index = String(index);
      item.style.setProperty('--toc-depth', String(h.level - topLevel));
      item.textContent = h.text;
      item.title = h.text;
      return item;
    });
    this.rail.replaceChildren(...dashes);
    this.panel.replaceChildren(...items);
    this.updateVisibility();
  }

  private updateVisibility(): void {
    this.root.hidden = !this.enabled || this.headings.length < MIN_HEADINGS;
  }

  /** Highlights the last heading scrolled past the top quarter of the viewport. */
  private updateActive(): void {
    if (!this.view || this.root.hidden) {
      return;
    }
    if (this.pinnedScrollY !== undefined) {
      if (Math.abs(window.scrollY - this.pinnedScrollY) < 1) {
        return;
      }
      this.pinnedScrollY = undefined;
    }
    const scroller = document.documentElement;
    const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 1;
    if (atBottom) {
      // The last sections may be too short to ever reach the top of the viewport.
      this.setActive(this.headings.length - 1);
      return;
    }
    const line = window.innerHeight / 4;
    let active = -1;
    for (let i = 0; i < this.headings.length; i++) {
      const el = this.headingElement(i);
      if (!el || el.getBoundingClientRect().top > line) {
        break;
      }
      active = i;
    }
    this.setActive(active);
  }

  private setActive(index: number): void {
    if (index === this.active) {
      return;
    }
    this.rail.children[this.active]?.classList.remove('active');
    this.panel.children[this.active]?.removeAttribute('aria-current');
    this.active = index;
    this.rail.children[index]?.classList.add('active');
    this.panel.children[index]?.setAttribute('aria-current', 'location');
    this.revealActiveItem();
  }

  private scrollTo(index: number): void {
    const el = this.headingElement(index);
    if (!el) {
      return;
    }
    // Not smooth: code blocks only take their real height once scrolled into view,
    // so they would push the heading away while the animation runs.
    el.scrollIntoView({ block: 'start' });
    this.setActive(index);
    this.pinnedScrollY = window.scrollY;
  }

  /** Scrolls the list so the highlighted title is visible. */
  private revealActiveItem(): void {
    const item = this.panel.children[this.active] as HTMLElement | undefined;
    if (!item) {
      return;
    }
    const { scrollTop, clientHeight } = this.panel;
    if (item.offsetTop < scrollTop || item.offsetTop + item.offsetHeight > scrollTop + clientHeight) {
      this.panel.scrollTop = item.offsetTop - (clientHeight - item.offsetHeight) / 2;
    }
  }

  private headingElement(index: number): HTMLElement | null {
    const heading = this.headings[index];
    const dom = heading && this.view?.nodeDOM(heading.pos);
    return dom instanceof HTMLElement ? dom : null;
  }
}
