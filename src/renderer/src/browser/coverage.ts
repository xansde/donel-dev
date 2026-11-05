import type { BrowserRect } from '../../../shared/browser/ipc';

// Navegador interno — the `WebContentsView` is drawn ABOVE the whole page of the app, so a React menu, popover,
// modal or a screen that slides over the center (Mindscape, Esteira) would be hidden behind it. The panel asks
// the page itself: at a few points of the viewport, is the topmost element still the viewport (or something
// inside it)? If anything else is on top, the view is hidden and a print takes its place.

/** Inset from the edges: a 1px border or a scrollbar never counts as "covered". */
const INSET = 8;

/** Points sampled over the viewport: the center and one near each corner. */
export function coverSamplePoints(rect: BrowserRect): Array<{ x: number; y: number }> {
  const inset = Math.min(INSET, rect.width / 4, rect.height / 4);
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  return [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ];
}

/** `true` when any sampled point has something on top of `viewport` that is not part of it. */
export function isViewportCovered(
  viewport: Element,
  rect: BrowserRect,
  elementFromPoint: (x: number, y: number) => Element | null = (x, y) => document.elementFromPoint(x, y),
): boolean {
  for (const point of coverSamplePoints(rect)) {
    const hit = elementFromPoint(point.x, point.y);
    // null = the point is outside the window (panel partly scrolled out): nothing covers it.
    if (hit !== null && hit !== viewport && !viewport.contains(hit)) return true;
  }
  return false;
}
