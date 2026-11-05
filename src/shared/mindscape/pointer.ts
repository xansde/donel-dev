// Mindscape — what a press on the board starts, by mouse button. The left
// button runs the tool (V selects, H and space move the view, the rest draw or
// erase); the right button moves the view with any tool, like the hand, and a
// right press that did not travel is still a plain right click (its context
// menu opens). Pure, so the rule is tested without the DOM.

import type { MindscapeTool } from './shortcuts';
import type { Point } from './view';

/** Pointer travel (px) before a press becomes a drag — below it, click and double click stay intact; a shorter drawing is dropped. */
export const DRAG_THRESHOLD = 4;

/** `MouseEvent.button`: main (left) and secondary (right). */
export const LEFT_BUTTON = 0;
export const RIGHT_BUTTON = 2;

/** `tool`: the left button with the current tool; `pan`: move the view; `none`: the board ignores the press. */
export type PressAction = 'tool' | 'pan' | 'none';

export function pressActionFor(button: number, tool: MindscapeTool, panMode: boolean): PressAction {
  if (button === RIGHT_BUTTON) return 'pan';
  if (button !== LEFT_BUTTON) return 'none';
  return panMode || tool === 'hand' ? 'pan' : 'tool';
}

/** The pointer went past the threshold since the press (Manhattan distance, as the board always measured it). */
export function isDrag(start: Point, last: Point): boolean {
  return Math.abs(last.x - start.x) + Math.abs(last.y - start.y) > DRAG_THRESHOLD;
}

/** The pan after dragging the view from `start` to `last` (whole pixels: pointer coordinates are fractional under display scaling). */
export function draggedPan(origin: Point, start: Point, last: Point): Point {
  return { x: origin.x + Math.round(last.x - start.x), y: origin.y + Math.round(last.y - start.y) };
}

/** The context menu after a right press: only when it did not become a drag of the view. */
export function contextMenuAllowed(rightPressDragged: boolean): boolean {
  return !rightPressDragged;
}
