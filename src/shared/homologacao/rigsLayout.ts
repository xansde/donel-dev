// Mindscape de homologação, fatia 2 — where the rigs of the factory stand on the board (prototype 1-topologia):
// the first rig on the left, "fora das duas cadeias" in the middle (with "Você", who only receives), the second rig
// on the right. Inside each rig, the chairs and pods are laid out by the Cadeiras lens's own layout (`layoutChairs`
// with `PodShape`, the same drawing as the owner's pods): columns follow the path of the work inside each pod.
// DERIVED, never stored (the `mindscape.json` does not change). Pure: no React, no Electron.

import { CHAIR_NODE, layoutChairs, type Chair, type ChairEdge, type ChairsView, type PodBox, type PodShape } from '../mindscape/chairs';
import { OWNER_TARGET, type Rig, type RigsShape } from './rigs';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RigBox extends Box {
  readonly id: string;
  readonly pods: readonly PodBox[];
}

export interface RigsLayout {
  /** Center of each chair, and of `OWNER_TARGET` when an arrow reaches the owner; board units. */
  readonly centers: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly rigs: readonly RigBox[];
  /** The pods of each rig as the lens's layout sees them (same order as `rigs`). */
  readonly pods: readonly (readonly PodShape[])[];
  /** The middle column ("fora das duas cadeias"). */
  readonly middle: Box;
  /** Everything above, for the lens's first view. */
  readonly bounds: Box;
}

const SLOT_H = 230;
const MIDDLE_W = 260;
const MIDDLE_TOP = 90;
const GAP = 40;
/** Space between the rigs and the rest of the board (they stand to the left of everything). */
const MARGIN = 160;

/** A rig's pods in the lens's vocabulary. */
export function podShapesOf(rig: Rig): PodShape[] {
  return rig.pods.map((pod) => ({ id: pod.id, name: pod.nome, ...(pod.missao ? { mission: pod.missao } : {}), chairIds: pod.cadeiras }));
}

/** The lens's layout of one rig: its chairs (the ones its pods hold) and the arrows between them. */
function layoutRig(rig: Rig, shape: RigsShape): { centers: Record<string, { x: number; y: number }>; box: Box; pods: readonly PodBox[]; shapes: PodShape[] } {
  const shapes = podShapesOf(rig);
  const ids = shapes.flatMap((pod) => pod.chairIds);
  const inside = new Set(ids);
  const chairs: Chair[] = ids.map((id) => ({ id, placeIds: [], seated: [], closed: [], pending: [], health: 'sem-sinal' }));
  const edges: ChairEdge[] = shape.ligacoes
    .filter((link) => inside.has(link.de) && inside.has(link.para) && link.de !== link.para)
    .map((link) => ({ from: link.de, to: link.para, count: 1, arrow: true }));
  const view: ChairsView = { chairs, edges, counts: { problema: 0, atencao: 0, bem: 0, 'sem-sinal': chairs.length } };
  const layout = layoutChairs(view, null, shapes);
  return { centers: { ...layout.centers }, box: layout.rig, pods: layout.pods, shapes };
}

/**
 * The rigs stand to the left of `content` (the top-left of everything on the board), top-aligned with it, so they
 * never cover the owner's drawing or post-its; `null` content puts them at the origin.
 */
export function layoutRigs(
  shape: RigsShape,
  content: { readonly x: number; readonly y: number } | null,
  /** Chairs of roles the file does not draw ("fora do desenho"): they stand in the middle column, under "Você". */
  outsideDrawing: readonly string[] = [],
): RigsLayout {
  const laid = shape.rigs.map((rig) => layoutRig(rig, shape));
  const ownerReached = shape.ligacoes.some((link) => link.para === OWNER_TARGET);
  const middleIds = [...shape.foraDosRigs, ...(ownerReached ? [OWNER_TARGET] : []), ...outsideDrawing];
  const height = Math.max(MIDDLE_TOP + middleIds.length * SLOT_H + 40, ...laid.map((rig) => rig.box.h));

  const centers: Record<string, { x: number; y: number }> = {};
  const rigs: RigBox[] = [];
  let x = 0;
  const placeRig = (index: number): void => {
    const entry = laid[index]!;
    const dx = x - entry.box.x;
    const dy = -entry.box.y;
    for (const [id, point] of Object.entries(entry.centers)) centers[id] = { x: point.x + dx, y: point.y + dy };
    rigs.push({
      id: shape.rigs[index]!.id,
      x,
      y: 0,
      w: entry.box.w,
      h: height,
      pods: entry.pods.map((pod) => ({ ...pod, x: pod.x + dx, y: pod.y + dy })),
    });
    x += entry.box.w + GAP;
  };

  if (laid[0]) placeRig(0);
  const middle: Box = { x, y: 0, w: MIDDLE_W, h: height };
  middleIds.forEach((id, index) => {
    centers[id] = { x: x + MIDDLE_W / 2, y: MIDDLE_TOP + index * SLOT_H + CHAIR_NODE / 2 };
  });
  x += MIDDLE_W + GAP;
  if (laid[1]) placeRig(1);
  const width = x - GAP;

  const originX = content ? content.x - MARGIN - width : 40;
  const originY = content ? content.y : 40;
  const shift = <T extends Box>(box: T): T => ({ ...box, x: box.x + originX, y: box.y + originY });
  for (const point of Object.values(centers)) {
    point.x += originX;
    point.y += originY;
  }
  return {
    centers,
    rigs: rigs.map((rig) => ({ ...shift(rig), pods: rig.pods.map(shift) })),
    pods: laid.map((entry) => entry.shapes),
    middle: shift(middle),
    bounds: { x: originX, y: originY, w: width, h: height },
  };
}
