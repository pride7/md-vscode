/** Images rendered by the editor: Crepe's image blocks and inline images. */
const IMAGE_SELECTOR = '.milkdown-image-block .image-wrapper > img, .milkdown-image-inline > img';

/** Returns the editor image an event happened on, if any. */
export function imageAt(target: EventTarget | null): HTMLImageElement | null {
  const element = target as Element | null;
  // A selected image block is covered by a highlight drawn by its wrapper.
  const img = element?.matches?.('.milkdown-image-block .image-wrapper')
    ? element.querySelector(':scope > img')
    : element?.closest?.(IMAGE_SELECTOR);
  return img instanceof HTMLImageElement && img.getAttribute('src') ? img : null;
}

/**
 * Shows an image over the editor, scaled down to fit the window. Clicking a
 * scaled-down image toggles its actual size; clicking anywhere else or
 * pressing Escape closes the preview.
 */
export function showImagePreview(source: HTMLImageElement): void {
  if (document.getElementById('image-preview')) {
    return;
  }
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'image-preview';
  overlay.tabIndex = -1;
  const img = document.createElement('img');
  img.src = source.currentSrc || source.src;
  img.alt = source.alt;
  img.draggable = false;
  overlay.append(img);

  const actualSize = () => overlay.classList.contains('actual-size');
  const updateZoomable = () => {
    const scaledDown = img.naturalWidth > img.clientWidth + 1 || img.naturalHeight > img.clientHeight + 1;
    img.classList.toggle('zoomable', actualSize() || scaledDown);
  };
  const close = () => {
    overlay.remove();
    window.removeEventListener('resize', updateZoomable);
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus({ preventScroll: true });
    }
  };

  img.addEventListener('load', updateZoomable);
  window.addEventListener('resize', updateZoomable);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && (e.offsetX >= overlay.clientWidth || e.offsetY >= overlay.clientHeight)) {
      // A click on the scrollbar.
      return;
    }
    if (e.target !== img || !img.classList.contains('zoomable')) {
      close();
      return;
    }
    const before = img.getBoundingClientRect();
    overlay.classList.toggle('actual-size');
    // Keep the clicked point of the image under the pointer.
    const after = img.getBoundingClientRect();
    overlay.scrollBy(
      after.left + ((e.clientX - before.left) / before.width) * after.width - e.clientX,
      after.top + ((e.clientY - before.top) / before.height) * after.height - e.clientY,
    );
    updateZoomable();
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  // A fitted image has nothing to scroll, and the page underneath must stay put.
  overlay.addEventListener(
    'wheel',
    (e) => {
      if (!actualSize()) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  document.body.append(overlay);
  overlay.focus({ preventScroll: true });
  if (img.complete) {
    updateZoomable();
  }
}
