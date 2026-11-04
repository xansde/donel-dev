import { describe, expect, it } from 'vitest';
import {
  addLink,
  addPlace,
  appendConversation,
  emptyMindscapeDoc,
  parseMindscapeDoc,
  placeSessionCard,
  placeSessionCards,
  roleOfSession,
  setPlaceConversation,
  setPlaceRole,
  writeSessionNote,
} from '../src/shared/mindscape/model';

// Item 12a — the session card is a PLACE: the conversation changes, the card stays, and its role
// is fixed once it started. These are the cases that would lose the owner's board (or swap a role
// under him) without him noticing. Refinement: docs/refinamentos/mindscape-lugar-papel.md.

const ATLAS = 'C:/atlas';

describe('migration of mindscape.json to v3 — nothing is lost', () => {
  it('a v2 session card becomes a place with the same id, spot, post-it and links', () => {
    const v2 = {
      schemaVersion: 2,
      boards: {
        [ATLAS]: {
          projectPath: ATLAS,
          pan: { x: 10, y: 20 },
          zoom: 1.5,
          cards: {
            'session:s1': { kind: 'session', id: 'session:s1', sessionId: 's1', x: 40, y: 50 },
            'note:s1': { kind: 'session-note', id: 'note:s1', sessionId: 's1', sessionName: 'atlas', text: 'feito', writtenAt: 7, x: 300, y: 50 },
            o1: { kind: 'owner', id: 'o1', text: 'ideia', color: 'accent', createdAt: 3, x: 600, y: 80 },
          },
          links: [{ id: 'l1', from: 'session:s1', to: 'o1', arrow: true }],
          drawings: [],
        },
      },
    };
    const doc = parseMindscapeDoc(v2);
    expect(doc.schemaVersion).toBe(3);
    const board = doc.boards[ATLAS]!;
    expect(board.cards['session:s1']).toEqual({ kind: 'session', id: 'session:s1', sessionId: 's1', previous: [], x: 40, y: 50 });
    expect(board.cards['note:s1']).toMatchObject({ text: 'feito', x: 300, y: 50 });
    expect(board.cards.o1).toMatchObject({ text: 'ideia', x: 600, y: 80 });
    expect(board.links).toEqual([{ id: 'l1', from: 'session:s1', to: 'o1', arrow: true }]);
    expect(board).toMatchObject({ pan: { x: 10, y: 20 }, zoom: 1.5 });
  });

  it('a v3 place keeps its conversations and role through a save and a load', () => {
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:p1', roleId: 'revisor' });
    doc = setPlaceConversation(doc, ATLAS, 'place:p1', 'a');
    doc = appendConversation(doc, 'a', 'b');
    const reloaded = parseMindscapeDoc(JSON.parse(JSON.stringify(doc)));
    expect(reloaded.boards[ATLAS]!.cards['place:p1']).toMatchObject({ sessionId: 'b', previous: ['a'], roleId: 'revisor' });
    // A place that has not started yet survives too.
    const pending = parseMindscapeDoc(JSON.parse(JSON.stringify(addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:p2' }))));
    expect(pending.boards[ATLAS]!.cards['place:p2']).toMatchObject({ kind: 'session', previous: [] });
    expect(pending.boards[ATLAS]!.cards['place:p2']).not.toHaveProperty('sessionId');
  });
});

describe('the conversation changes, the place stays', () => {
  it('a renewal adds the conversation to the same place; post-it and links follow', () => {
    let doc = placeSessionCard(emptyMindscapeDoc(), ATLAS, 'old', 'dev');
    doc = writeSessionNote(doc, ATLAS, { sessionId: 'old', sessionName: 'atlas', text: 'feito', writtenAt: 1 });
    doc = placeSessionCard(doc, ATLAS, 'beacon');
    doc = addLink(doc, ATLAS, { id: 'l1', from: 'session:old', to: 'session:beacon' });
    doc = addLink(doc, ATLAS, { id: 'l2', from: 'session:old', to: 'note:old' });
    const before = doc.boards[ATLAS]!.cards;

    const after = appendConversation(doc, 'old', 'new').boards[ATLAS]!;
    expect(after.cards['session:old']).toEqual({ ...before['session:old'], sessionId: 'new', previous: ['old'], roleId: 'dev' });
    expect(after.cards['note:old']).toBeUndefined();
    expect(after.cards['note:new']).toMatchObject({ sessionId: 'new', text: 'feito', x: before['note:old']!.x, y: before['note:old']!.y });
    expect(after.links).toEqual([
      { id: 'l1', from: 'session:old', to: 'session:beacon', arrow: true },
      { id: 'l2', from: 'session:old', to: 'note:new', arrow: true },
    ]);
    expect(roleOfSession(appendConversation(doc, 'old', 'new'), 'old')).toBe('dev');
    expect(appendConversation(doc, 'ghost', 'new')).toBe(doc);
  });

  it('a place that had not started takes its first conversation in place, no second card', () => {
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:p1', roleId: 'pesquisa' });
    const spot = doc.boards[ATLAS]!.cards['place:p1']!;
    doc = setPlaceConversation(doc, ATLAS, 'place:p1', 's1');
    doc = placeSessionCards(doc, [{ projectPath: ATLAS, sessionId: 's1' }]);
    const cards = doc.boards[ATLAS]!.cards;
    expect(Object.keys(cards)).toEqual(['place:p1']);
    expect(cards['place:p1']).toMatchObject({ sessionId: 's1', previous: [], roleId: 'pesquisa', x: spot.x, y: spot.y });
  });

  it('an older conversation resumed from the list comes back to its place, unless the place is busy', () => {
    let doc = placeSessionCard(emptyMindscapeDoc(), ATLAS, 'a');
    doc = appendConversation(doc, 'a', 'b');
    const back = placeSessionCards(doc, [{ projectPath: ATLAS, sessionId: 'a' }]).boards[ATLAS]!;
    expect(Object.keys(back.cards)).toEqual(['session:a']);
    expect(back.cards['session:a']).toMatchObject({ sessionId: 'a', previous: ['b'] });

    const both = placeSessionCards(doc, [
      { projectPath: ATLAS, sessionId: 'b' },
      { projectPath: ATLAS, sessionId: 'a' },
    ]).boards[ATLAS]!;
    expect(both.cards['session:a']).toMatchObject({ sessionId: 'b' });
    expect(both.cards['session:a~2']).toMatchObject({ sessionId: 'a', previous: [] });
  });
});

describe('the role is fixed once the place started', () => {
  it('changes only while the place has not started', () => {
    let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:p1', roleId: 'dev' });
    doc = setPlaceRole(doc, ATLAS, 'place:p1', 'revisor');
    expect(doc.boards[ATLAS]!.cards['place:p1']).toMatchObject({ roleId: 'revisor' });

    const started = setPlaceConversation(doc, ATLAS, 'place:p1', 's1');
    expect(setPlaceRole(started, ATLAS, 'place:p1', 'dev')).toBe(started);
    expect(setPlaceRole(started, ATLAS, 'place:p1', undefined)).toBe(started);
    // A place born from a conversation (Launcher, resume) has started from birth.
    const born = placeSessionCard(emptyMindscapeDoc(), ATLAS, 's2', 'pesquisa');
    expect(setPlaceRole(born, ATLAS, 'session:s2', 'dev')).toBe(born);
  });
});
