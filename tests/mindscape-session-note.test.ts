import { describe, expect, it } from 'vitest';
import {
  archiveCard,
  emptyMindscapeDoc,
  findSessionBoard,
  MAX_SESSION_NOTE_CHARS,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  noteCardId,
  placeSessionCard,
  SESSION_CARD_HEIGHT,
  SESSION_CARD_WIDTH,
  sessionCardId,
  writeSessionNote,
  type MindscapeCard,
  type MindscapeDoc,
} from '../src/shared/mindscape/model';

// Mindscape, fatia 03 — the post-it written by the session at each end of turn:
// one per session, overwritten every turn, kept when the tab closes, until the
// owner archives it.

const VEGA = 'C:/work/vega';

function footprint(card: MindscapeCard): { w: number; h: number } {
  return card.kind === 'session-note' ? { w: NOTE_CARD_WIDTH, h: NOTE_CARD_HEIGHT } : { w: SESSION_CARD_WIDTH, h: SESSION_CARD_HEIGHT };
}

function overlaps(a: MindscapeCard, b: MindscapeCard): boolean {
  const fa = footprint(a);
  const fb = footprint(b);
  return a.x < b.x + fb.w && b.x < a.x + fa.w && a.y < b.y + fb.h && b.y < a.y + fa.h;
}

function withSessions(...sessionIds: string[]): MindscapeDoc {
  return sessionIds.reduce((doc, id) => placeSessionCard(doc, VEGA, id), emptyMindscapeDoc());
}

describe('writeSessionNote', () => {
  it('creates note:<sessionId> the first time, next to the session card', () => {
    const doc = writeSessionNote(withSessions('s1'), VEGA, { sessionId: 's1', sessionName: 'vega', text: 'Pronto.', writtenAt: 1000 });
    const board = doc.boards[VEGA]!;
    const note = board.cards[noteCardId('s1')];
    const session = board.cards[sessionCardId('s1')]!;
    expect(note).toMatchObject({ kind: 'session-note', id: 'note:s1', sessionId: 's1', sessionName: 'vega', text: 'Pronto.', writtenAt: 1000 });
    expect(overlaps(note!, session)).toBe(false);
    // "Ao lado": same row, right after the session card.
    expect(note!.y).toBe(session.y);
    expect(note!.x).toBeGreaterThan(session.x);
  });

  it('overwrites text and time on the next turns, keeping the position', () => {
    const first = writeSessionNote(withSessions('s1'), VEGA, { sessionId: 's1', sessionName: 'vega', text: 'um', writtenAt: 1000 });
    const before = first.boards[VEGA]!.cards[noteCardId('s1')]!;
    const second = writeSessionNote(first, VEGA, { sessionId: 's1', sessionName: 'vega', text: 'dois', writtenAt: 2000 });
    const after = second.boards[VEGA]!.cards[noteCardId('s1')]!;
    expect(after).toMatchObject({ text: 'dois', writtenAt: 2000, x: before.x, y: before.y });
    expect(Object.keys(second.boards[VEGA]!.cards)).toHaveLength(2);
  });

  it('cuts the text at 4.000 characters', () => {
    const long = 'x'.repeat(MAX_SESSION_NOTE_CHARS + 500);
    const doc = writeSessionNote(withSessions('s1'), VEGA, { sessionId: 's1', sessionName: 'vega', text: long, writtenAt: 1 });
    const note = doc.boards[VEGA]!.cards[noteCardId('s1')];
    expect(MAX_SESSION_NOTE_CHARS).toBe(4000);
    expect(note?.kind === 'session-note' ? note.text.length : -1).toBe(4000);
  });

  it('does not overlap other cards (two sessions side by side)', () => {
    let doc = withSessions('s1', 's2', 's3');
    doc = writeSessionNote(doc, VEGA, { sessionId: 's1', sessionName: 'a', text: 'a', writtenAt: 1 });
    doc = writeSessionNote(doc, VEGA, { sessionId: 's2', sessionName: 'b', text: 'b', writtenAt: 1 });
    const cards = Object.values(doc.boards[VEGA]!.cards);
    for (const a of cards) for (const b of cards) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it('a session placed after a note does not land on it', () => {
    let doc = withSessions('s1');
    doc = writeSessionNote(doc, VEGA, { sessionId: 's1', sessionName: 'a', text: 'a', writtenAt: 1 });
    doc = placeSessionCard(doc, VEGA, 's2');
    const cards = Object.values(doc.boards[VEGA]!.cards);
    for (const a of cards) for (const b of cards) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it('creates the board when missing (session card absent: free slot)', () => {
    const doc = writeSessionNote(emptyMindscapeDoc(), VEGA, { sessionId: 's1', sessionName: 'vega', text: 't', writtenAt: 1 });
    expect(doc.boards[VEGA]!.cards[noteCardId('s1')]).toBeDefined();
  });
});

describe('archiveCard', () => {
  it('removes the card and the links that touch it', () => {
    let doc = writeSessionNote(withSessions('s1', 's2'), VEGA, { sessionId: 's1', sessionName: 'a', text: 'a', writtenAt: 1 });
    const board = doc.boards[VEGA]!;
    doc = {
      ...doc,
      boards: {
        [VEGA]: {
          ...board,
          links: [
            { id: 'l1', from: noteCardId('s1'), to: sessionCardId('s1'), arrow: true },
            { id: 'l2', from: sessionCardId('s2'), to: noteCardId('s1'), arrow: false },
            { id: 'l3', from: sessionCardId('s1'), to: sessionCardId('s2'), arrow: true },
          ],
        },
      },
    };
    const archived = archiveCard(doc, VEGA, noteCardId('s1'));
    expect(archived.boards[VEGA]!.cards[noteCardId('s1')]).toBeUndefined();
    expect(archived.boards[VEGA]!.links.map((link) => link.id)).toEqual(['l3']);
  });

  it('missing card or board → same document', () => {
    const doc = withSessions('s1');
    expect(archiveCard(doc, VEGA, 'note:nope')).toBe(doc);
    expect(archiveCard(doc, 'C:/work/atlas', noteCardId('s1'))).toBe(doc);
  });
});

describe('findSessionBoard', () => {
  it('returns the project of the board that has the session card or its note', () => {
    const doc = withSessions('s1');
    expect(findSessionBoard(doc, 's1')).toBe(VEGA);
    expect(findSessionBoard(doc, 'other')).toBeUndefined();
  });
});
