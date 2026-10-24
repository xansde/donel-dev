import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLink,
  addOwnerCard,
  archiveCard,
  emptyMindscapeDoc,
  placeSessionCard,
  removeLink,
  sessionCardId,
  toggleLinkArrow,
  visibleLinks,
  type MindscapeDoc,
} from '../src/shared/mindscape/model';
import { cardOutlinePath, clearRoughCache, linkEndpoints, linkPath } from '../src/renderer/src/Mindscape/roughShapes';

// Mindscape, fatia 05 — links between two post-its of the same board, with an
// arrow that can be switched on and off, drawn in a hand-made stroke (roughjs)
// that does not "shake" at every render (seed fixed by id).

const ATLAS = 'C:/work/atlas';
const SESSION = sessionCardId('s1');

function board(): MindscapeDoc {
  const withSession = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1');
  return addOwnerCard(addOwnerCard(withSession, ATLAS, { id: 'o1', createdAt: 1 }), ATLAS, { id: 'o2', createdAt: 2 });
}

function linked(): MindscapeDoc {
  return addLink(board(), ATLAS, { id: 'l1', from: 'o1', to: SESSION });
}

describe('addLink', () => {
  it('links two cards of the board, with the arrow on', () => {
    const doc = linked();
    expect(doc.boards[ATLAS]!.links).toEqual([{ id: 'l1', from: 'o1', to: SESSION, arrow: true }]);
  });

  it('refuses a link from a card to itself', () => {
    const doc = board();
    expect(addLink(doc, ATLAS, { id: 'l1', from: 'o1', to: 'o1' })).toBe(doc);
  });

  it('refuses a link between cards missing from the board', () => {
    const doc = board();
    expect(addLink(doc, ATLAS, { id: 'l1', from: 'o1', to: 'ghost' })).toBe(doc);
    expect(addLink(doc, ATLAS, { id: 'l1', from: 'ghost', to: 'o1' })).toBe(doc);
    expect(addLink(doc, 'C:/work/beacon', { id: 'l1', from: 'o1', to: 'o2' })).toBe(doc);
  });

  it('refuses an id in use and a pair already linked (either way)', () => {
    const doc = linked();
    expect(addLink(doc, ATLAS, { id: 'l1', from: 'o1', to: 'o2' })).toBe(doc);
    expect(addLink(doc, ATLAS, { id: 'l2', from: 'o1', to: SESSION })).toBe(doc);
    expect(addLink(doc, ATLAS, { id: 'l2', from: SESSION, to: 'o1' })).toBe(doc);
  });
});

describe('toggleLinkArrow', () => {
  it('flips arrow back and forth', () => {
    const off = toggleLinkArrow(linked(), ATLAS, 'l1');
    expect(off.boards[ATLAS]!.links[0]!.arrow).toBe(false);
    expect(toggleLinkArrow(off, ATLAS, 'l1').boards[ATLAS]!.links[0]!.arrow).toBe(true);
  });

  it('missing link → same document', () => {
    const doc = linked();
    expect(toggleLinkArrow(doc, ATLAS, 'nope')).toBe(doc);
  });
});

describe('removeLink', () => {
  it('removes only the target link', () => {
    const two = addLink(linked(), ATLAS, { id: 'l2', from: 'o1', to: 'o2' });
    const doc = removeLink(two, ATLAS, 'l1');
    expect(doc.boards[ATLAS]!.links.map((link) => link.id)).toEqual(['l2']);
    expect(doc.boards[ATLAS]!.cards).toBe(two.boards[ATLAS]!.cards);
  });

  it('missing link → same document', () => {
    const doc = linked();
    expect(removeLink(doc, ATLAS, 'nope')).toBe(doc);
  });
});

describe('archiveCard and links', () => {
  it('removes the links of the archived card and keeps the others', () => {
    const two = addLink(linked(), ATLAS, { id: 'l2', from: 'o2', to: SESSION });
    const doc = archiveCard(two, ATLAS, 'o1');
    expect(doc.boards[ATLAS]!.links.map((link) => link.id)).toEqual(['l2']);
  });
});

describe('visibleLinks', () => {
  it('draws only links whose two ends are on screen (session without open tab → hidden, kept)', () => {
    const links = linked().boards[ATLAS]!.links;
    expect(visibleLinks(links, new Set(['o1', 'o2']))).toEqual([]);
    expect(visibleLinks(links, new Set(['o1', 'o2', SESSION]))).toEqual(links);
  });
});

describe('roughShapes', () => {
  beforeEach(() => clearRoughCache());

  const A = { x: 0, y: 0, w: 100, h: 50 };
  const B = { x: 300, y: 0, w: 100, h: 50 };

  it('cuts the line at the border of each card', () => {
    expect(linkEndpoints(A, B)).toEqual({ x1: 100, y1: 25, x2: 300, y2: 25 });
  });

  it('no line when the cards overlap', () => {
    expect(linkEndpoints(A, { x: 20, y: 10, w: 100, h: 50 })).toBeNull();
  });

  it('gives the same d for the same id and geometry, even without the cache', () => {
    const first = linkPath('l1', A, B, true);
    clearRoughCache();
    const second = linkPath('l1', A, B, true);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first!.line).toMatch(/^M/);
    expect(first!.head).toMatch(/^M/);
  });

  it('another id gives another stroke; no arrow gives no head', () => {
    expect(linkPath('l2', A, B, true)!.line).not.toBe(linkPath('l1', A, B, true)!.line);
    expect(linkPath('l1', A, B, false)!.head).toBeNull();
  });

  it('card outline is stable per id and size', () => {
    const first = cardOutlinePath('o1', 230, 96);
    clearRoughCache();
    expect(cardOutlinePath('o1', 230, 96)).toBe(first);
    expect(cardOutlinePath('o1', 230, 120)).not.toBe(first);
  });
});
