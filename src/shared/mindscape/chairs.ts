// Cadeiras, fatia 1 (docs/planos/cadeiras-arquitetura.md) — the "Cadeiras" lens of the Mindscape: the board's
// places grouped into chairs (one chair per role on the board), the path of the work between chairs (the links
// between their places), a health per chair and the layout of the schema (prototype F2a, owner 06/11).
//
// The chairs are DERIVED, never stored: a chair is a role on the board (owner, 07/11). What the board stores for them
// is only the owner's pods (`mindscape.json` v6, fatia 4, in model.ts); this file lays the pods out, it never writes.
// Pure: no React, no Electron.

import type { SessionAxes } from './sessionAxes';
import type { MindscapeShortcut } from './shortcuts';
import type { MindscapeBoard, MindscapeLink, SessionPlaceCard } from './model';

/** Health of a chair, the four numbers of the band (prototype: problema · atenção · bem · sem sinal). */
export type ChairHealth = 'problema' | 'atencao' | 'bem' | 'sem-sinal';

export const CHAIR_HEALTHS: readonly ChairHealth[] = ['problema', 'atencao', 'bem', 'sem-sinal'];

/** Id of the chair of the places with no role. */
export const NO_ROLE_CHAIR = '-';

export interface Chair {
  /** The role id; `NO_ROLE_CHAIR` for the places with no role. */
  readonly id: string;
  readonly roleId?: string;
  /** Every place of the chair, in the board's order. */
  readonly placeIds: readonly string[];
  /** Places whose session is open now (the "sentados"). */
  readonly seated: readonly string[];
  /** Places whose conversation is closed (who sat here before). */
  readonly closed: readonly string[];
  /** Places that have not started yet. */
  readonly pending: readonly string[];
  readonly health: ChairHealth;
}

export interface ChairEdge {
  readonly from: string;
  readonly to: string;
  /** How many links between the places of the two chairs. */
  readonly count: number;
  /** At least one of them is an arrow. */
  readonly arrow: boolean;
}

export interface ChairsInput {
  readonly places: readonly SessionPlaceCard[];
  readonly links: readonly MindscapeLink[];
  /** The axes of every place whose tab is open, by place id. */
  readonly liveAxes: ReadonlyMap<string, SessionAxes>;
  /** The roles in the owner's order (the column order of the schema). */
  readonly roleOrder: readonly string[];
}

export interface ChairsView {
  readonly chairs: readonly Chair[];
  readonly edges: readonly ChairEdge[];
  readonly counts: Readonly<Record<ChairHealth, number>>;
}

/**
 * Provisional rule (PDA item 06 decides the real one): an open session with an error or the usage limit is a
 * problem; one that needs the owner (permission, question, plan) is attention; seated and quiet is fine; nobody
 * seated is no signal.
 */
function healthOf(seatedAxes: readonly SessionAxes[]): ChairHealth {
  if (seatedAxes.some((axes) => axes.needs.includes('erro') || axes.needs.includes('limite de uso'))) return 'problema';
  if (seatedAxes.some((axes) => axes.needs.length > 0)) return 'atencao';
  return seatedAxes.length > 0 ? 'bem' : 'sem-sinal';
}

export function deriveChairs({ places, links, liveAxes, roleOrder }: ChairsInput): ChairsView {
  const byChair = new Map<string, SessionPlaceCard[]>();
  const chairOfPlace = new Map<string, string>();
  for (const place of places) {
    const id = place.roleId ?? NO_ROLE_CHAIR;
    chairOfPlace.set(place.id, id);
    const list = byChair.get(id);
    if (list) list.push(place);
    else byChair.set(id, [place]);
  }
  const rank = (id: string): number => {
    const index = roleOrder.indexOf(id);
    return id === NO_ROLE_CHAIR ? Number.MAX_SAFE_INTEGER : index < 0 ? roleOrder.length : index;
  };
  const ids = [...byChair.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const chairs: Chair[] = ids.map((id) => {
    const list = byChair.get(id)!;
    const seated = list.filter((place) => liveAxes.get(place.id)?.process === 'aberta');
    const seatedIds = new Set(seated.map((place) => place.id));
    return {
      id,
      ...(id === NO_ROLE_CHAIR ? {} : { roleId: id }),
      placeIds: list.map((place) => place.id),
      seated: seated.map((place) => place.id),
      closed: list.filter((place) => place.sessionId !== undefined && !seatedIds.has(place.id)).map((place) => place.id),
      pending: list.filter((place) => place.sessionId === undefined).map((place) => place.id),
      health: healthOf(seated.map((place) => liveAxes.get(place.id)!)),
    };
  });

  const edgeMap = new Map<string, { from: string; to: string; count: number; arrow: boolean }>();
  for (const link of links) {
    const from = chairOfPlace.get(link.from);
    const to = chairOfPlace.get(link.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    const edge = edgeMap.get(key);
    if (edge) {
      edge.count += 1;
      edge.arrow ||= link.arrow;
    } else edgeMap.set(key, { from, to, count: 1, arrow: link.arrow });
  }
  const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count || rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to));

  const counts: Record<ChairHealth, number> = { problema: 0, atencao: 0, bem: 0, 'sem-sinal': 0 };
  for (const chair of chairs) counts[chair.health] += 1;
  return { chairs, edges, counts };
}

// ---------------------------------------------------------------------------
// Layout of the schema: columns follow the path of the work (who opens whom), left to right.
// ---------------------------------------------------------------------------

/** Diameter of a chair node (prototype F2a: 116 px). */
export const CHAIR_NODE = 116;
const COLUMN_GAP = 290;
const ROW_GAP = 230;
const RIG_PAD_X = 110;
const RIG_PAD_TOP = 130;
const RIG_PAD_BOTTOM = 100;
/** Space between the rig and the rest of the board (it stands to the left of everything). */
const RIG_MARGIN = 160;

/**
 * A pod as the layout sees it, whatever its source: the owner's pods on the board (`mindscape.json` v6) or a rig file
 * kept by someone else. `at` is the pod's corner relative to the rig's corner; absent = the layout places it.
 */
export interface PodShape {
  readonly id: string;
  readonly name: string;
  readonly mission?: string;
  /** Chair ids (role ids). A chair that is not on the board is skipped. */
  readonly chairIds: readonly string[];
  readonly at?: { readonly x: number; readonly y: number };
}

export interface PodBox {
  readonly id: string;
  /** Board units. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ChairsLayout {
  /** Center of each chair, in board units. */
  readonly centers: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly rig: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The pods, in the order given. */
  readonly pods: readonly PodBox[];
}

/** Inside a pod: room for its header and around its chairs. */
const POD_PAD_X = 70;
const POD_PAD_TOP = 70;
const POD_PAD_BOTTOM = 60;
const POD_MIN_W = 320;
const POD_GAP = 40;
/** Where the first pod (or the chairs with no pod) starts inside the rig, below the rig's header. */
const RIG_INNER_TOP = 64;
const RIG_INNER_LEFT = 24;

/**
 * Column = longest path from a chair nobody points at, after dropping the edges that close a cycle (Dev ⇄ Revisor
 * keeps the busier direction).
 */
function chairColumns(view: ChairsView): Map<string, number> {
  const ids = view.chairs.map((chair) => chair.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of view.edges) out.get(edge.from)?.push(edge.to);
  const incoming = new Set(view.edges.map((edge) => edge.to));

  // DFS from the sources (then from what is left) marks the edges that go back up the path: those are dropped.
  const state = new Map<string, 'open' | 'done'>();
  const kept: Array<[string, string]> = [];
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const next of out.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === 'open') continue;
      kept.push([id, next]);
      if (!seen) visit(next);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!incoming.has(id) && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);

  const column = new Map<string, number>(ids.map((id) => [id, 0]));
  // Longest path over the kept edges (a DAG now): relax until stable, at most one pass per chair.
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const [from, to] of kept) {
      const next = column.get(from)! + 1;
      if (next > column.get(to)!) {
        column.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return column;
}

/** A block of chairs in columns (the global ones, packed) and rows: centers relative to the block's corner, and its size. */
function blockOf(ids: readonly string[], column: ReadonlyMap<string, number>, padX: number, padTop: number, padBottom: number): { centers: Record<string, { x: number; y: number }>; w: number; h: number } {
  const used = [...new Set(ids.map((id) => column.get(id) ?? 0))].sort((a, b) => a - b);
  const rows = new Map<number, number>();
  const centers: Record<string, { x: number; y: number }> = {};
  let maxRow = 0;
  for (const id of ids) {
    const col = used.indexOf(column.get(id) ?? 0);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    maxRow = Math.max(maxRow, row);
    centers[id] = { x: padX + CHAIR_NODE / 2 + col * COLUMN_GAP, y: padTop + CHAIR_NODE / 2 + row * ROW_GAP };
  }
  const cols = Math.max(used.length, 1);
  return { centers, w: 2 * padX + CHAIR_NODE + (cols - 1) * COLUMN_GAP, h: padTop + CHAIR_NODE + maxRow * ROW_GAP + padBottom };
}

/**
 * The schema: with no pod, the chairs fill the rig in columns along the path of the work. With pods (dono, 07/11:
 * the pod arranges its own chairs), each pod lays out its chairs the same way inside its frame, at the corner the
 * owner dragged it to (or in a row, left to right, when it has none); the chairs with no pod go to the left of the
 * pods. The rig stands to the left of `content` (the bounding box of everything on the board), top-aligned with it,
 * so it never covers the owner's drawing.
 */
export function layoutChairs(view: ChairsView, content: { readonly x: number; readonly y: number } | null, pods: readonly PodShape[] = []): ChairsLayout {
  const column = chairColumns(view);
  const order = view.chairs.map((chair) => chair.id);
  const podded = new Set<string>();
  const blocks = pods.map((pod) => {
    const ids = order.filter((id) => pod.chairIds.includes(id) && !podded.has(id));
    ids.forEach((id) => podded.add(id));
    const block = blockOf(ids, column, POD_PAD_X, POD_PAD_TOP, POD_PAD_BOTTOM);
    const w = Math.max(block.w, POD_MIN_W);
    return { pod, ids, block, w, h: ids.length > 0 ? block.h : POD_PAD_TOP + POD_PAD_BOTTOM + 40, shift: (w - block.w) / 2 };
  });
  const loose = order.filter((id) => !podded.has(id));
  const looseBlock = pods.length === 0 ? blockOf(loose, column, RIG_PAD_X, RIG_PAD_TOP, RIG_PAD_BOTTOM) : loose.length > 0 ? blockOf(loose, column, POD_PAD_X, POD_PAD_TOP, POD_PAD_BOTTOM) : null;

  const centers: Record<string, { x: number; y: number }> = {};
  const boxes: PodBox[] = [];
  const place = (ids: readonly string[], block: { centers: Record<string, { x: number; y: number }> }, x: number, y: number, shift = 0): void => {
    for (const id of ids) centers[id] = { x: x + shift + block.centers[id]!.x, y: y + block.centers[id]!.y };
  };

  if (pods.length === 0) {
    // No pod: the chairs fill the rig, which stands left of everything on the board.
    const w = Math.max(looseBlock!.w, 720);
    const h = looseBlock!.h;
    const x = content ? content.x - RIG_MARGIN - w : 40;
    const y = content ? content.y : 40;
    place(loose, looseBlock!, x, y);
    return { centers, rig: { x, y, w, h }, pods: [] };
  }

  // Pods the owner placed keep their corner (board units); the others follow in a row, then the chairs with no pod.
  const placed = blocks.filter((entry) => entry.pod.at);
  const autoWidth = blocks.filter((entry) => !entry.pod.at).reduce((sum, entry) => sum + entry.w + POD_GAP, 0);
  let rowX: number;
  let rowY: number;
  if (placed.length > 0) {
    rowX = Math.max(...placed.map((entry) => entry.pod.at!.x + entry.w)) + POD_GAP;
    rowY = Math.min(...placed.map((entry) => entry.pod.at!.y));
  } else {
    rowX = content ? content.x - RIG_MARGIN - RIG_INNER_LEFT - autoWidth : 40 + RIG_INNER_LEFT;
    rowY = (content ? content.y : 40) + RIG_INNER_TOP;
  }
  for (const entry of blocks) {
    const at = entry.pod.at ?? { x: rowX, y: rowY };
    if (!entry.pod.at) rowX += entry.w + POD_GAP;
    place(entry.ids, entry.block, at.x, at.y, entry.shift);
    boxes.push({ id: entry.pod.id, x: at.x, y: at.y, w: entry.w, h: entry.h });
  }
  const frames: Array<{ x: number; y: number; w: number; h: number }> = [...boxes];
  if (looseBlock && loose.length > 0) {
    // The chairs with no pod stand LEFT of the pods: the pods stand left of the owner's drawing, so this never covers it.
    const at = { x: Math.min(...boxes.map((box) => box.x)) - POD_GAP - looseBlock.w, y: Math.min(...boxes.map((box) => box.y)) };
    place(loose, looseBlock, at.x, at.y);
    frames.push({ x: at.x, y: at.y, w: looseBlock.w, h: looseBlock.h });
  }
  const left = Math.min(...frames.map((frame) => frame.x)) - RIG_INNER_LEFT;
  const top = Math.min(...frames.map((frame) => frame.y)) - RIG_INNER_TOP;
  const right = Math.max(...frames.map((frame) => frame.x + frame.w)) + RIG_INNER_LEFT;
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.h)) + RIG_INNER_LEFT;
  return { centers, rig: { x: left, y: top, w: Math.max(right - left, 720), h: bottom - top }, pods: boxes };
}

/** Top-left of everything on the board (cards and drawings), board units; `null` on an empty board. */
export function boardContentOrigin(board: MindscapeBoard): { x: number; y: number } | null {
  let x = Infinity;
  let y = Infinity;
  const take = (px: number, py: number): void => {
    x = Math.min(x, px);
    y = Math.min(y, py);
  };
  for (const card of Object.values(board.cards)) take(card.x, card.y);
  for (const drawing of board.drawings) {
    if (drawing.kind === 'pencil') for (let index = 0; index + 1 < drawing.points.length; index += 2) take(drawing.points[index]!, drawing.points[index + 1]!);
    else if (drawing.kind === 'line') take(Math.min(drawing.x1, drawing.x2), Math.min(drawing.y1, drawing.y2));
    else take(drawing.x, drawing.y);
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// ---------------------------------------------------------------------------
// The lens never touches what the owner cannot see (Revisor, #278): with "Seu desenho: Oculto" the board only moves.
// ---------------------------------------------------------------------------

export type LensOwnerMode = 'over' | 'dim' | 'hidden';

/** The chairs lens with the owner's layer hidden: nothing on the board may change (he would not see it happen). */
export function lensLocksBoard(chairsOn: boolean, ownerMode: LensOwnerMode): boolean {
  return chairsOn && ownerMode === 'hidden';
}

/** With the board locked, only Esc passes: select-all, delete, undo, redo and the layer keys are dropped. */
export function shortcutInLens(shortcut: MindscapeShortcut | null, locked: boolean): MindscapeShortcut | null {
  if (!shortcut || !locked) return shortcut;
  return shortcut.type === 'escape' ? shortcut : null;
}

/** The one door of the owner's actions in the lens: locked → the reducer never reaches the document. */
export function guardBoardAction<T>(locked: boolean, reducer: (doc: T) => T): ((doc: T) => T) | null {
  return locked ? null : reducer;
}
