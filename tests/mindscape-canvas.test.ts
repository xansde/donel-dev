import { describe, expect, it } from 'vitest';
import {
  addOwnerCard,
  editOwnerCard,
  emptyMindscapeDoc,
  moveCard,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  parseMindscapeDoc,
  placeSessionCard,
  sessionCardId,
  setBoardView,
  setOwnerColor,
  type MindscapeCard,
  type MindscapeDoc,
} from '../src/shared/mindscape/model';

// Mindscape, fatia 04 — free canvas: move any card, move the view (pan) and the
// owner's own post-its ("✎ você"), with editable text and a 3-color palette.

const ATLAS = 'C:/work/atlas';
const BEACON = 'C:/work/beacon';

function ownerCard(doc: MindscapeDoc, id: string): Extract<MindscapeCard, { kind: 'owner' }> {
  const card = doc.boards[ATLAS]?.cards[id];
  if (!card || card.kind !== 'owner') throw new Error(`no owner card ${id}`);
  return card;
}

function withOwner(id = 'o1'): MindscapeDoc {
  return addOwnerCard(placeSessionCard(emptyMindscapeDoc(), ATLAS, 's1'), ATLAS, { id, createdAt: 1000 });
}

describe('moveCard', () => {
  it('changes only x/y of the target card', () => {
    const doc = withOwner();
    const session = doc.boards[ATLAS]!.cards[sessionCardId('s1')]!;
    const moved = moveCard(doc, ATLAS, sessionCardId('s1'), 500, 320);
    expect(moved.boards[ATLAS]!.cards[sessionCardId('s1')]).toEqual({ ...session, x: 500, y: 320 });
    expect(moved.boards[ATLAS]!.cards.o1).toBe(doc.boards[ATLAS]!.cards.o1);
    expect(moved.boards[ATLAS]!.pan).toEqual(doc.boards[ATLAS]!.pan);
  });

  it('returns the same document for a missing card, a missing board, the same position or a non-finite position', () => {
    const doc = withOwner();
    const card = doc.boards[ATLAS]!.cards.o1!;
    expect(moveCard(doc, ATLAS, 'nope', 1, 1)).toBe(doc);
    expect(moveCard(doc, BEACON, 'o1', 1, 1)).toBe(doc);
    expect(moveCard(doc, ATLAS, 'o1', card.x, card.y)).toBe(doc);
    expect(moveCard(doc, ATLAS, 'o1', Number.NaN, 1)).toBe(doc);
  });
});

// Desenho, fatia 05 — setBoardPan became setBoardView (pan + zoom); the pan keeps the same rules.
describe('setBoardView (the pan)', () => {
  it('stores the pan of the board and is a no-op for the same pan', () => {
    const doc = withOwner();
    const panned = setBoardView(doc, ATLAS, { pan: { x: -120, y: 45 }, zoom: 1 });
    expect(panned.boards[ATLAS]!.pan).toEqual({ x: -120, y: 45 });
    expect(panned.boards[ATLAS]!.cards).toBe(doc.boards[ATLAS]!.cards);
    expect(setBoardView(panned, ATLAS, { pan: { x: -120, y: 45 }, zoom: 1 })).toBe(panned);
    expect(setBoardView(doc, BEACON, { pan: { x: 1, y: 1 }, zoom: 1 })).toBe(doc);
  });
});

describe('addOwnerCard', () => {
  it('creates the owner card with its id, createdAt, empty text and color none', () => {
    const doc = withOwner('o1');
    expect(ownerCard(doc, 'o1')).toMatchObject({ kind: 'owner', id: 'o1', text: '', color: 'none', createdAt: 1000 });
  });

  it('keeps ids unique: two ids give two cards, an existing id gives the same document back', () => {
    const one = withOwner('o1');
    const two = addOwnerCard(one, ATLAS, { id: 'o2', createdAt: 2000 });
    expect(Object.keys(two.boards[ATLAS]!.cards).filter((key) => two.boards[ATLAS]!.cards[key]!.kind === 'owner')).toEqual(['o1', 'o2']);
    expect(addOwnerCard(two, ATLAS, { id: 'o1', createdAt: 3000 })).toBe(two);
    expect(addOwnerCard(two, ATLAS, { id: sessionCardId('s1'), createdAt: 3000 })).toBe(two);
  });

  it('lands on a free spot without covering the session card, starting from the given origin', () => {
    const doc = withOwner('o1');
    const session = doc.boards[ATLAS]!.cards[sessionCardId('s1')]!;
    const owner = ownerCard(doc, 'o1');
    const apart = owner.x >= session.x + 230 || owner.y >= session.y + 96 || owner.x + NOTE_CARD_WIDTH <= session.x || owner.y + NOTE_CARD_HEIGHT <= session.y;
    expect(apart).toBe(true);

    const far = addOwnerCard(doc, ATLAS, { id: 'o2', createdAt: 2000, origin: { x: 900, y: 700 } });
    expect(ownerCard(far, 'o2')).toMatchObject({ x: 900, y: 700 });
  });

  it('creates the board when the project has none', () => {
    const doc = addOwnerCard(emptyMindscapeDoc(), ATLAS, { id: 'o1', createdAt: 1 });
    expect(doc.boards[ATLAS]!.cards.o1!.kind).toBe('owner');
  });
});

describe('editOwnerCard', () => {
  it('replaces the text of an owner card', () => {
    const doc = editOwnerCard(withOwner(), ATLAS, 'o1', 'Lembrar do deploy');
    expect(ownerCard(doc, 'o1').text).toBe('Lembrar do deploy');
  });

  it('is a no-op for the same text and for cards that are not the owner’s', () => {
    const doc = editOwnerCard(withOwner(), ATLAS, 'o1', 'x');
    expect(editOwnerCard(doc, ATLAS, 'o1', 'x')).toBe(doc);
    expect(editOwnerCard(doc, ATLAS, sessionCardId('s1'), 'y')).toBe(doc);
    expect(editOwnerCard(doc, ATLAS, 'nope', 'y')).toBe(doc);
  });
});

describe('setOwnerColor', () => {
  it('accepts the three owner colors', () => {
    let doc = withOwner();
    for (const color of ['accent', 'donel-accent', 'none'] as const) {
      doc = setOwnerColor(doc, ATLAS, 'o1', color);
      expect(ownerCard(doc, 'o1').color).toBe(color);
    }
  });

  it('ignores permission (red is not an owner color — rule 6) and non-owner cards', () => {
    const doc = setOwnerColor(withOwner(), ATLAS, 'o1', 'accent');
    expect(setOwnerColor(doc, ATLAS, 'o1', 'permission' as never)).toBe(doc);
    expect(setOwnerColor(doc, ATLAS, sessionCardId('s1'), 'accent')).toBe(doc);
    expect(setOwnerColor(doc, ATLAS, 'o1', 'accent')).toBe(doc);
  });
});

describe('parseMindscapeDoc keeps the canvas', () => {
  it('preserves owner cards and the pan through a JSON round trip', () => {
    let doc = withOwner('o1');
    doc = editOwnerCard(doc, ATLAS, 'o1', 'Texto do dono');
    doc = setOwnerColor(doc, ATLAS, 'o1', 'donel-accent');
    doc = moveCard(doc, ATLAS, 'o1', 610, 420);
    doc = setBoardView(doc, ATLAS, { pan: { x: -80, y: 30 }, zoom: 1 });
    expect(parseMindscapeDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});
