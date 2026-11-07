// Cadeiras, fatia 1 (docs/planos/cadeiras-arquitetura.md) — the "Cadeiras" lens of the Mindscape: the board's
// places grouped into chairs (one chair per role on the board), the path of the work between chairs (the links
// between their places), a health per chair and the layout of the schema (prototype F2a, owner 06/11).
//
// DERIVED, never stored: nothing here writes the document, so the lens adds no field to `mindscape.json` and the
// `schemaVersion` stays. The stored chair (rig, pod, own position, `papel@rig`) is a later slice that bumps it.
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

export interface ChairsLayout {
  /** Center of each chair, in board units. */
  readonly centers: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly rig: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * Column = longest path from a chair nobody points at, after dropping the edges that close a cycle (Dev ⇄ Revisor
 * keeps the busier direction). Rows follow the chairs' order. The rig stands to the left of `content` (the
 * bounding box of everything on the board), top-aligned with it, so it never covers the owner's drawing.
 */
export function layoutChairs(view: ChairsView, content: { readonly x: number; readonly y: number } | null): ChairsLayout {
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

  const rows = new Map<number, number>();
  const local: Record<string, { x: number; y: number }> = {};
  let maxColumn = 0;
  let maxRow = 0;
  for (const id of ids) {
    const col = column.get(id)!;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    maxColumn = Math.max(maxColumn, col);
    maxRow = Math.max(maxRow, row);
    local[id] = { x: RIG_PAD_X + CHAIR_NODE / 2 + col * COLUMN_GAP, y: RIG_PAD_TOP + CHAIR_NODE / 2 + row * ROW_GAP };
  }
  const w = Math.max(2 * RIG_PAD_X + CHAIR_NODE + maxColumn * COLUMN_GAP, 720);
  const h = RIG_PAD_TOP + CHAIR_NODE + maxRow * ROW_GAP + RIG_PAD_BOTTOM;
  const x = content ? content.x - RIG_MARGIN - w : 40;
  const y = content ? content.y : 40;
  const centers: Record<string, { x: number; y: number }> = {};
  for (const id of ids) centers[id] = { x: x + local[id]!.x, y: y + local[id]!.y };
  return { centers, rig: { x, y, w, h } };
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
