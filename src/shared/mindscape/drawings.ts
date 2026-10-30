// Mindscape desenho — reducers of the owner's drawings. Same rules as the
// reducers of model.ts: never mutate, "nothing changed" returns the same
// document. Types and the disk guard live in model.ts. Design:
// docs/design/mindscape-desenho.md, "Modelo de dados".

import type { ItemIds } from './geometry';
import {
  archiveCard,
  DRAWING_STROKES,
  OWNER_COLORS,
  parseDrawing,
  type DrawingColor,
  type DrawingStroke,
  type MindscapeBoard,
  type MindscapeDoc,
  type MindscapeDrawing,
} from './model';

/** Stroke width in board units. */
export const STROKE_WIDTH: Readonly<Record<DrawingStroke, number>> = { thin: 1.5, medium: 3, thick: 5 };

/** A box drawn from bottom right to top left comes with a negative w/h: make it positive. */
function normalized(drawing: MindscapeDrawing): MindscapeDrawing {
  if (drawing.kind === 'line') return drawing;
  const { x, y, w, h } = drawing;
  return { ...drawing, x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

function withDrawings(doc: MindscapeDoc, board: MindscapeBoard, drawings: MindscapeDrawing[]): MindscapeDoc {
  return { ...doc, boards: { ...doc.boards, [board.projectPath]: { ...board, drawings } } };
}

function sameDrawing(a: MindscapeDrawing, b: MindscapeDrawing): boolean {
  const keys = Object.keys(a) as (keyof MindscapeDrawing)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Puts the drawing on top of the others (end of the array). Missing board, id
 * in use or a drawing the disk guard would drop → same document.
 */
export function addDrawing(doc: MindscapeDoc, projectPath: string, drawing: MindscapeDrawing): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  const valid = parseDrawing(normalized(drawing));
  if (!valid || board.drawings.some((existing) => existing.id === valid.id)) return doc;
  return withDrawings(doc, board, [...board.drawings, valid]);
}

/**
 * Fatia 03 — a drawing changed by a handle: replaces the one with the same id,
 * in the same layer, through the disk guard. Unknown id, an equal drawing or
 * an invalid one → same document.
 */
export function updateDrawing(doc: MindscapeDoc, projectPath: string, drawing: MindscapeDrawing): MindscapeDoc {
  const board = doc.boards[projectPath];
  const index = board ? board.drawings.findIndex((existing) => existing.id === drawing.id) : -1;
  if (!board || index < 0) return doc;
  const valid = parseDrawing(normalized(drawing));
  if (!valid || sameDrawing(valid, board.drawings[index]!)) return doc;
  const drawings = [...board.drawings];
  drawings[index] = valid;
  return withDrawings(doc, board, drawings);
}

/** Tenth of a unit: what the file keeps. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The drawing shifted by (dx, dy), in board units. */
export function translateDrawing(drawing: MindscapeDrawing, dx: number, dy: number): MindscapeDrawing {
  if (drawing.kind === 'line') {
    return { ...drawing, x1: round(drawing.x1 + dx), y1: round(drawing.y1 + dy), x2: round(drawing.x2 + dx), y2: round(drawing.y2 + dy) };
  }
  return { ...drawing, x: round(drawing.x + dx), y: round(drawing.y + dy) };
}

/**
 * Fatia 03 — drag of the selection: cards and drawings move together by (dx,
 * dy), one entry of the history. No offset, a non-finite one, no known id or a
 * missing board → same document.
 */
export function moveItems(doc: MindscapeDoc, projectPath: string, ids: ItemIds, dx: number, dy: number): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board || !Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return doc;
  const cardIds = ids.cards.filter((id) => board.cards[id]);
  const drawingIds = new Set(ids.drawings);
  const touchesDrawing = board.drawings.some((drawing) => drawingIds.has(drawing.id));
  if (cardIds.length === 0 && !touchesDrawing) return doc;
  const cards = { ...board.cards };
  for (const id of cardIds) {
    const card = cards[id]!;
    cards[id] = { ...card, x: round(card.x + dx), y: round(card.y + dy) };
  }
  const drawings = touchesDrawing ? board.drawings.map((drawing) => (drawingIds.has(drawing.id) ? translateDrawing(drawing, dx, dy) : drawing)) : board.drawings;
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, cards, drawings } } };
}

/**
 * Fatia 03 — Delete on the selection: drawings go away; the owner's post-it
 * and the one written by the session are archived (`archiveCard`, links
 * included); a session post-it is ignored (it follows the tab). Nothing
 * removable → same document.
 */
export function removeItems(doc: MindscapeDoc, projectPath: string, ids: ItemIds): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  let next = doc;
  for (const id of ids.cards) {
    const card = board.cards[id];
    if (card && card.kind !== 'session') next = archiveCard(next, projectPath, id);
  }
  const drawingIds = new Set(ids.drawings);
  const current = next.boards[projectPath]!;
  const drawings = current.drawings.filter((drawing) => !drawingIds.has(drawing.id));
  return drawings.length === current.drawings.length ? next : withDrawings(next, current, drawings);
}

export interface DrawingStyleInput {
  readonly color?: DrawingColor;
  readonly stroke?: DrawingStroke;
}

/**
 * Fatia 03 — color and/or stroke of the bar applied to the selected drawings.
 * A style that is not one of the bar, or nothing to change → same document.
 */
export function setDrawingsStyle(doc: MindscapeDoc, projectPath: string, drawingIds: readonly string[], style: DrawingStyleInput): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  if (style.color !== undefined && !OWNER_COLORS.includes(style.color)) return doc;
  if (style.stroke !== undefined && !DRAWING_STROKES.includes(style.stroke)) return doc;
  const ids = new Set(drawingIds);
  let changed = false;
  const drawings = board.drawings.map((drawing) => {
    if (!ids.has(drawing.id)) return drawing;
    const color = style.color ?? drawing.color;
    const stroke = style.stroke ?? drawing.stroke;
    if (color === drawing.color && stroke === drawing.stroke) return drawing;
    changed = true;
    return { ...drawing, color, stroke };
  });
  return changed ? withDrawings(doc, board, drawings) : doc;
}

function restack(doc: MindscapeDoc, projectPath: string, drawingIds: readonly string[], toFront: boolean): MindscapeDoc {
  const board = doc.boards[projectPath];
  if (!board) return doc;
  const ids = new Set(drawingIds);
  const group = board.drawings.filter((drawing) => ids.has(drawing.id));
  const rest = board.drawings.filter((drawing) => !ids.has(drawing.id));
  const drawings = toFront ? [...rest, ...group] : [...group, ...rest];
  return drawings.every((drawing, index) => drawing === board.drawings[index]) ? doc : withDrawings(doc, board, drawings);
}

/** Fatia 03 — the selected drawings go to the top, keeping their relative order. Already there → same document. */
export function bringToFront(doc: MindscapeDoc, projectPath: string, drawingIds: readonly string[]): MindscapeDoc {
  return restack(doc, projectPath, drawingIds, true);
}

/** Fatia 03 — the selected drawings go to the back, keeping their relative order. Already there → same document. */
export function sendToBack(doc: MindscapeDoc, projectPath: string, drawingIds: readonly string[]): MindscapeDoc {
  return restack(doc, projectPath, drawingIds, false);
}
