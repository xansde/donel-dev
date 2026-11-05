import { describe, expect, it } from 'vitest';
import { contextMenuAllowed, draggedPan, isDrag, LEFT_BUTTON, pressActionFor, RIGHT_BUTTON } from '../src/shared/mindscape/pointer';

// Right button on the Mindscape (owner, 05/11): a right drag moves the view with any tool, like the
// hand; a right click that stays put does not move it and still opens the context menu; the left
// button keeps doing what the tool does (V selects).

const origin = { x: 100, y: 50 };
const start = { x: 400, y: 300 };

describe('right button moves the view', () => {
  it('a right drag in selection mode moves the view by the pointer travel, as the hand does', () => {
    expect(pressActionFor(RIGHT_BUTTON, 'select', false)).toBe('pan');
    expect(pressActionFor(LEFT_BUTTON, 'hand', false)).toBe('pan');
    const last = { x: 430.6, y: 280.2 };
    expect(isDrag(start, last)).toBe(true);
    expect(draggedPan(origin, start, last)).toEqual({ x: 131, y: 30 });
    expect(contextMenuAllowed(isDrag(start, last))).toBe(false);
  });

  it('a right click that stays under the threshold does not move the view and lets the menu open', () => {
    const last = { x: 402, y: 302 };
    expect(isDrag(start, last)).toBe(false);
    expect(contextMenuAllowed(isDrag(start, last))).toBe(true);
  });

  it('the left button in selection mode still runs the tool (selection), and other buttons do nothing', () => {
    expect(pressActionFor(LEFT_BUTTON, 'select', false)).toBe('tool');
    expect(pressActionFor(LEFT_BUTTON, 'select', true)).toBe('pan');
    expect(pressActionFor(1, 'select', false)).toBe('none');
  });
});
