import { describe, expect, it } from 'vitest';
import { sessionHighlight } from '../src/shared/mindscape/highlight';

// Mindscape, fatia 02 — how a session post-it looks on the board: highlighted
// when it has news since the owner last visited it, dimmed when it has none,
// normal while it works (rule 3 of the spec).

describe('sessionHighlight', () => {
  it('a working session is always normal', () => {
    expect(sessionHighlight('working', 500, 100)).toBe('normal');
    expect(sessionHighlight('working', 100, 500)).toBe('normal');
    expect(sessionHighlight('working', 100, undefined)).toBe('normal');
  });

  it.each(['waiting', 'done', 'error', 'permission'] as const)('%s entered after the last visit is highlighted', (state) => {
    expect(sessionHighlight(state, 200, 100)).toBe('highlighted');
  });

  it.each(['waiting', 'done', 'error', 'permission'] as const)('%s entered before (or at) the last visit is dimmed', (state) => {
    expect(sessionHighlight(state, 100, 200)).toBe('dimmed');
    expect(sessionHighlight(state, 200, 200)).toBe('dimmed');
  });

  it('a session never visited counts its last visit as 0', () => {
    expect(sessionHighlight('waiting', 1, undefined)).toBe('highlighted');
    expect(sessionHighlight('waiting', 0, undefined)).toBe('dimmed');
  });
});
