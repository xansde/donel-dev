// Navegador integrado — where each element of the page is, as the agent's read sees it (V2, docs/design/navegador-interno.md).
// Pure, no I/O.
//
// Input: one CDP `DOMSnapshot.captureSnapshot` (one per CDP session: the page, and one per iframe of another origin)
// taken with `includePaintOrder` + `includeDOMRects` and the computed styles of `SNAPSHOT_COMPUTED_STYLES`.
// Output: for a `backendNodeId`, whether the element is on screen, scrolled away (above / below / beside), hidden
// by CSS, or covered by something painted on top of it.
//
// Idea from browser-use (MIT, github.com/browser-use/browser-use): `dom/enhanced_snapshot.py` (snapshot indexes ->
// backend node id), `dom/service.py` (`is_element_visible_according_to_all_parents`: CSS + viewport of every frame
// of the chain) and `dom/serializer/paint_order.py` (top-down paint order with a union of opaque rectangles). Two
// changes here: what is off screen is counted instead of silently dropped, and an element is never "covered" by its
// own descendants (an opaque span filling a button does not hide the button).
//
// Coordinates, as measured in Electron 43 (03/11): snapshot bounds and scroll offsets are in device pixels and
// relative to their own document; the result here is CSS pixels of the top-level viewport.

/** Computed styles asked to `captureSnapshot`, in this order (the snapshot answers by position). */
export const SNAPSHOT_COMPUTED_STYLES = ['display', 'visibility', 'opacity', 'background-color', 'border-left-width', 'border-top-width', 'padding-left', 'padding-top'] as const;

const STYLE = { display: 0, visibility: 1, opacity: 2, background: 3, borderLeft: 4, borderTop: 5, paddingLeft: 6, paddingTop: 7 } as const;

export interface RareIntegerDataLike {
  readonly index: readonly number[];
  readonly value: readonly number[];
}

export interface NodeTreeSnapshotLike {
  readonly parentIndex?: readonly number[];
  readonly nodeType?: readonly number[];
  readonly nodeName?: readonly number[];
  readonly backendNodeId?: readonly number[];
  readonly attributes?: readonly (readonly number[])[];
  readonly contentDocumentIndex?: RareIntegerDataLike;
}

export interface LayoutTreeSnapshotLike {
  readonly nodeIndex: readonly number[];
  readonly styles: readonly (readonly number[])[];
  readonly bounds: readonly (readonly number[])[];
  readonly paintOrders?: readonly number[];
}

export interface DocumentSnapshotLike {
  readonly scrollOffsetX?: number;
  readonly scrollOffsetY?: number;
  readonly nodes: NodeTreeSnapshotLike;
  readonly layout: LayoutTreeSnapshotLike;
}

export interface DomSnapshotLike {
  readonly documents: readonly DocumentSnapshotLike[];
  readonly strings: readonly string[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where an element is for the agent. Only `visible` elements get a number in `navegador_ler`. */
export type Placement = 'visible' | 'above' | 'below' | 'beside' | 'hidden' | 'covered';

export interface PlacedNode {
  readonly placement: Placement;
  /** Border box in CSS pixels of the top-level viewport (`null` when the element has no box at all). */
  readonly rect: Rect | null;
}

/** How the root document of a snapshot sits in the top-level viewport. */
export interface SnapshotFrameContext {
  /** Device pixels per CSS pixel. */
  readonly scale: number;
  /** Top-left of this document's viewport, in CSS pixels of the top-level viewport. */
  readonly origin: { readonly x: number; readonly y: number };
  /** The part of the top-level viewport where this document can show (the frame chain, intersected). */
  readonly clip: Rect;
  /** The frame element itself is not visible: everything inside it inherits this. */
  readonly inherited?: Placement;
}

/** For `navegador_extrair`: which nodes of a snapshot have a layout box (`false` = in the DOM but not rendered). */
export function layoutPresence(snapshot: DomSnapshotLike): (backendNodeId: number) => boolean | undefined {
  const known = new Set<number>();
  const laidOut = new Set<number>();
  for (const doc of snapshot.documents) {
    const ids = doc.nodes.backendNodeId;
    if (!ids) continue;
    for (const id of ids) known.add(id);
    for (const node of doc.layout.nodeIndex) {
      const id = ids[node];
      if (id !== undefined) laidOut.add(id);
    }
  }
  return (backendNodeId) => (laidOut.has(backendNodeId) ? true : known.has(backendNodeId) ? false : undefined);
}

const ELEMENT_NODE = 1;
const MAX_PIECES = 256;
const MAX_ANCESTOR_WALK = 1024;
const MAX_DESCENDANT_WALK = 400;
/** Below this (CSS px) an element is not checked for cover: visually-hidden inputs are 1x1 under their label. */
const MIN_COVER_CHECK_SIZE = 4;
const REPLACED_OPAQUE = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']);
const FORM_CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** `a` minus `b`: up to four rectangles (b assumed to intersect a). From browser-use's `RectUnionPure._split_diff`. */
function subtract(a: Rect, b: Rect): Rect[] {
  const out: Rect[] = [];
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  if (a.y < b.y) out.push({ x: a.x, y: a.y, width: a.width, height: b.y - a.y });
  if (bBottom < aBottom) out.push({ x: a.x, y: bBottom, width: a.width, height: aBottom - bBottom });
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(aBottom, bBottom);
  if (bottom > top) {
    if (a.x < b.x) out.push({ x: a.x, y: top, width: b.x - a.x, height: bottom - top });
    if (bRight < aRight) out.push({ x: bRight, y: top, width: aRight - bRight, height: bottom - top });
  }
  return out;
}

function px(value: string | undefined): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

/** Alpha of a computed `background-color` (`rgb(...)` = 1, `rgba(..., a)` = a, `transparent` = 0). */
function backgroundAlpha(value: string | undefined): number {
  if (!value || value === 'transparent') return 0;
  const match = /rgba?\(([^)]*)\)/i.exec(value);
  if (!match) return 1;
  const parts = match[1].split(/[\s,/]+/).filter((part) => part !== '');
  if (parts.length < 4) return 1;
  const alpha = Number.parseFloat(parts[3]);
  if (!Number.isFinite(alpha)) return 1;
  return parts[3].endsWith('%') ? alpha / 100 : alpha;
}

interface Coverer {
  readonly node: number;
  readonly paintOrder: number;
  readonly rect: Rect;
}

interface DocIndex {
  readonly doc: DocumentSnapshotLike;
  readonly layoutOf: Map<number, number>;
  children: Map<number, number[]> | null;
  coverers: Coverer[] | null;
  ctx: SnapshotFrameContext | null;
}

/** The placement of the elements of one CDP session's snapshot. Computed lazily, only for the elements asked. */
export class SnapshotPlacements {
  private readonly docs: DocIndex[];
  private readonly byBackend = new Map<number, { doc: number; node: number }>();
  /** child document -> the frame element (in another document of this snapshot) that shows it. */
  private readonly ownerOf = new Map<number, { doc: number; node: number }>();
  private readonly memo = new Map<number, PlacedNode>();

  constructor(
    private readonly snapshot: DomSnapshotLike,
    private readonly root: SnapshotFrameContext,
  ) {
    this.docs = snapshot.documents.map((doc, d) => {
      const layoutOf = new Map<number, number>();
      doc.layout.nodeIndex.forEach((node, layoutIndex) => {
        if (!layoutOf.has(node)) layoutOf.set(node, layoutIndex);
      });
      doc.nodes.backendNodeId?.forEach((backendNodeId, node) => {
        if (!this.byBackend.has(backendNodeId)) this.byBackend.set(backendNodeId, { doc: d, node });
      });
      const content = doc.nodes.contentDocumentIndex;
      if (content) content.index.forEach((node, i) => this.ownerOf.set(content.value[i], { doc: d, node }));
      return { doc, layoutOf, children: null, coverers: null, ctx: null };
    });
  }

  has(backendNodeId: number): boolean {
    return this.byBackend.has(backendNodeId);
  }

  placementOf(backendNodeId: number): PlacedNode | undefined {
    const cached = this.memo.get(backendNodeId);
    if (cached) return cached;
    const where = this.byBackend.get(backendNodeId);
    if (!where) return undefined;
    const placed = this.place(where.doc, where.node);
    this.memo.set(backendNodeId, placed);
    return placed;
  }

  /** The context of the document shown by a frame element of this snapshot (for an iframe of another origin). */
  frameContextOf(ownerBackendNodeId: number): SnapshotFrameContext | null {
    const where = this.byBackend.get(ownerBackendNodeId);
    return where ? this.contentContext(where.doc, where.node) : null;
  }

  private str(index: number | undefined): string | undefined {
    return index === undefined || index < 0 ? undefined : this.snapshot.strings[index];
  }

  private style(d: number, layoutIndex: number, which: number): string | undefined {
    return this.str(this.docs[d].doc.layout.styles[layoutIndex]?.[which]);
  }

  private nodeName(d: number, node: number): string {
    return this.str(this.docs[d].doc.nodes.nodeName?.[node]) ?? '';
  }

  private ctxOf(d: number): SnapshotFrameContext {
    const index = this.docs[d];
    if (index.ctx) return index.ctx;
    const owner = this.ownerOf.get(d);
    // Cycle guard: mark root while computing.
    index.ctx = this.root;
    index.ctx = owner ? this.contentContext(owner.doc, owner.node) : this.root;
    return index.ctx;
  }

  /** Context of the document inside the frame element `node` of document `d`. */
  private contentContext(d: number, node: number): SnapshotFrameContext {
    const parent = this.ctxOf(d);
    const owner = this.place(d, node);
    const layoutIndex = this.docs[d].layoutOf.get(node);
    if (!owner.rect || layoutIndex === undefined) return { ...parent, inherited: 'hidden' };
    const offsetX = px(this.style(d, layoutIndex, STYLE.borderLeft)) + px(this.style(d, layoutIndex, STYLE.paddingLeft));
    const offsetY = px(this.style(d, layoutIndex, STYLE.borderTop)) + px(this.style(d, layoutIndex, STYLE.paddingTop));
    const content: Rect = { x: owner.rect.x + offsetX, y: owner.rect.y + offsetY, width: Math.max(0, owner.rect.width - 2 * offsetX), height: Math.max(0, owner.rect.height - 2 * offsetY) };
    const clip = intersect(parent.clip, content) ?? { x: content.x, y: content.y, width: 0, height: 0 };
    return {
      scale: parent.scale,
      origin: { x: content.x, y: content.y },
      clip,
      ...(owner.placement === 'visible' ? {} : { inherited: owner.placement }),
    };
  }

  private ownRect(d: number, node: number): Rect | null {
    const index = this.docs[d];
    const layoutIndex = index.layoutOf.get(node);
    if (layoutIndex === undefined) return null;
    const bounds = index.doc.layout.bounds[layoutIndex];
    if (!bounds || bounds.length < 4) return null;
    const ctx = this.ctxOf(d);
    const scale = ctx.scale > 0 ? ctx.scale : 1;
    return {
      x: ctx.origin.x + (bounds[0] - (index.doc.scrollOffsetX ?? 0)) / scale,
      y: ctx.origin.y + (bounds[1] - (index.doc.scrollOffsetY ?? 0)) / scale,
      width: bounds[2] / scale,
      height: bounds[3] / scale,
    };
  }

  /** Own box, or the union of the boxes below it (an element with `display: contents` has none of its own). */
  private rectOf(d: number, node: number): Rect | null {
    const own = this.ownRect(d, node);
    if (own) return own;
    const children = this.childrenOf(d);
    let union: { x1: number; y1: number; x2: number; y2: number } | null = null;
    const queue = [...(children.get(node) ?? [])];
    for (let seen = 0; queue.length > 0 && seen < MAX_DESCENDANT_WALK; seen += 1) {
      const child = queue.shift()!;
      const rect = this.ownRect(d, child);
      if (rect && rect.width > 0 && rect.height > 0) {
        union = union
          ? { x1: Math.min(union.x1, rect.x), y1: Math.min(union.y1, rect.y), x2: Math.max(union.x2, rect.x + rect.width), y2: Math.max(union.y2, rect.y + rect.height) }
          : { x1: rect.x, y1: rect.y, x2: rect.x + rect.width, y2: rect.y + rect.height };
      } else {
        queue.push(...(children.get(child) ?? []));
      }
    }
    return union ? { x: union.x1, y: union.y1, width: union.x2 - union.x1, height: union.y2 - union.y1 } : null;
  }

  private childrenOf(d: number): Map<number, number[]> {
    const index = this.docs[d];
    if (index.children) return index.children;
    const children = new Map<number, number[]>();
    index.doc.nodes.parentIndex?.forEach((parent, node) => {
      if (parent < 0) return;
      const list = children.get(parent);
      if (list) list.push(node);
      else children.set(parent, [node]);
    });
    index.children = children;
    return children;
  }

  private place(d: number, node: number): PlacedNode {
    const ctx = this.ctxOf(d);
    const rect = this.rectOf(d, node);
    if (ctx.inherited) return { placement: ctx.inherited, rect };
    const layoutIndex = this.docs[d].layoutOf.get(node);
    if (layoutIndex !== undefined) {
      if (this.style(d, layoutIndex, STYLE.display) === 'none' || this.style(d, layoutIndex, STYLE.visibility) === 'hidden') return { placement: 'hidden', rect };
      // `opacity: 0` hides, except a form control laid over a styled look-alike (custom checkbox, file input).
      const opacity = this.style(d, layoutIndex, STYLE.opacity);
      if (opacity !== undefined && px(opacity) <= 0 && !FORM_CONTROLS.has(this.nodeName(d, node))) {
        return { placement: 'hidden', rect };
      }
    }
    if (!rect) return { placement: 'hidden', rect };
    const clip = ctx.clip;
    if (rect.y + rect.height <= clip.y) return { placement: 'above', rect };
    if (rect.y >= clip.y + clip.height) return { placement: 'below', rect };
    const shown = intersect(rect, clip);
    if (!shown) return { placement: 'beside', rect };
    if (layoutIndex !== undefined && shown.width >= MIN_COVER_CHECK_SIZE && shown.height >= MIN_COVER_CHECK_SIZE && this.isCovered(d, node, layoutIndex, shown)) {
      return { placement: 'covered', rect };
    }
    return { placement: 'visible', rect };
  }

  private coverersOf(d: number): Coverer[] {
    const index = this.docs[d];
    if (index.coverers) return index.coverers;
    const out: Coverer[] = [];
    const { layout, nodes } = index.doc;
    const paintOrders = layout.paintOrders;
    if (paintOrders) {
      layout.nodeIndex.forEach((node, layoutIndex) => {
        if (nodes.nodeType?.[node] !== ELEMENT_NODE) return;
        const name = this.nodeName(d, node);
        if (name === 'HTML' || name === 'BODY') return;
        if (this.style(d, layoutIndex, STYLE.visibility) === 'hidden') return;
        const opacity = this.style(d, layoutIndex, STYLE.opacity);
        if (opacity !== undefined && px(opacity) < 0.8) return;
        if (!REPLACED_OPAQUE.has(name) && backgroundAlpha(this.style(d, layoutIndex, STYLE.background)) < 0.8) return;
        const rect = this.ownRect(d, node);
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        out.push({ node, paintOrder: paintOrders[layoutIndex], rect });
      });
    }
    index.coverers = out;
    return out;
  }

  private isDescendant(d: number, node: number, ancestor: number): boolean {
    const parents = this.docs[d].doc.nodes.parentIndex;
    if (!parents) return false;
    let current = parents[node];
    for (let i = 0; current !== undefined && current >= 0 && i < MAX_ANCESTOR_WALK; i += 1) {
      if (current === ancestor) return true;
      current = parents[current];
    }
    return false;
  }

  /** `true` when the shown part of the element is entirely under opaque boxes painted after it (not its own). */
  private isCovered(d: number, node: number, layoutIndex: number, shown: Rect): boolean {
    const paintOrder = this.docs[d].doc.layout.paintOrders?.[layoutIndex];
    if (paintOrder === undefined) return false;
    let pieces: Rect[] = [shown];
    for (const coverer of this.coverersOf(d)) {
      if (coverer.paintOrder <= paintOrder || coverer.node === node) continue;
      if (!pieces.some((piece) => intersect(piece, coverer.rect))) continue;
      if (this.isDescendant(d, coverer.node, node)) continue;
      const next: Rect[] = [];
      for (const piece of pieces) {
        if (intersect(piece, coverer.rect)) next.push(...subtract(piece, coverer.rect));
        else next.push(piece);
      }
      pieces = next.filter((piece) => piece.width > 0.5 && piece.height > 0.5);
      if (pieces.length === 0) return true;
      if (pieces.length > MAX_PIECES) return false;
    }
    return false;
  }
}
