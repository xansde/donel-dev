// Mindscape desenho — reducers of the owner's drawings. Same rules as the
// reducers of model.ts: never mutate, "nothing changed" returns the same
// document. Types and the disk guard live in model.ts. Design:
// docs/design/mindscape-desenho.md, "Modelo de dados".

import { parseDrawing, type DrawingStroke, type MindscapeDoc, type MindscapeDrawing } from './model';

/** Stroke width in board units. */
export const STROKE_WIDTH: Readonly<Record<DrawingStroke, number>> = { thin: 1.5, medium: 3, thick: 5 };

/** A box drawn from bottom right to top left comes with a negative w/h: make it positive. */
function normalized(drawing: MindscapeDrawing): MindscapeDrawing {
  if (drawing.kind === 'line') return drawing;
  const { x, y, w, h } = drawing;
  return { ...drawing, x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
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
  return { ...doc, boards: { ...doc.boards, [projectPath]: { ...board, drawings: [...board.drawings, valid] } } };
}
