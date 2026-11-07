import { describe, expect, it } from 'vitest';
import { escapeClosesChairScreen } from '../src/shared/chair-sheet';

// Cadeiras, fatia 2 (Revisor, #282): after "Recolher ›" the focused button went away, the focus fell on the page and
// Esc stopped closing the chair screen. Esc must close it from the page too, and never from the Papéis dialog over it.

const base = { key: 'Escape', defaultPrevented: false, focusInScreen: false, focusOnPage: false };

describe('Esc on the chair screen', () => {
  it('closes it after the focused button folded away (focus on the page)', () => {
    expect(escapeClosesChairScreen({ ...base, focusOnPage: true })).toBe(true);
  });

  it('closes it with the focus inside the screen', () => {
    expect(escapeClosesChairScreen({ ...base, focusInScreen: true })).toBe(true);
  });

  it('leaves it open when the focus is in a dialog over it, when another key is pressed or when someone took the key', () => {
    expect(escapeClosesChairScreen(base)).toBe(false);
    expect(escapeClosesChairScreen({ ...base, key: 'Enter', focusInScreen: true })).toBe(false);
    expect(escapeClosesChairScreen({ ...base, defaultPrevented: true, focusOnPage: true })).toBe(false);
  });
});
