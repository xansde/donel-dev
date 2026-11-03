import { describe, expect, it } from 'vitest';
import { classifyBoardSessions, closedLabel, dormantSessionName, OLD_SESSION_MS } from '../src/shared/mindscape/dormant';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import type { SessionRegistry } from '../src/shared/sessionRegistry';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const PROJECT = 'C:\\proj\\atlas';

function session(id: string): MindscapeCard {
  return { kind: 'session', id: `session:${id}`, sessionId: id, x: 0, y: 0 };
}
function note(id: string, writtenAt: number, sessionName = 'atlas'): MindscapeCard {
  return { kind: 'session-note', id: `note:${id}`, sessionId: id, sessionName, text: 'feito', writtenAt, x: 0, y: 0 };
}
function boardOf(cards: MindscapeCard[]): MindscapeBoard {
  return { projectPath: PROJECT, pan: { x: 0, y: 0 }, zoom: 1, cards: Object.fromEntries(cards.map((card) => [card.id, card])), links: [], drawings: [] };
}
function registered(id: string, lastActivityAt: number, pinned = false, label = 'rótulo'): SessionRegistry {
  return { [id]: { sessionId: id, projectPath: PROJECT, label, lastActivityAt, pinned } };
}

describe('classifyBoardSessions', () => {
  it('a session with an open tab is live, never dormant nor old', () => {
    const board = boardOf([session('a'), note('a', NOW - 30 * DAY)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(['a']), registry: {}, now: NOW });
    expect(view.dormant).toEqual([]);
    expect(view.oldSessionIds.size).toBe(0);
  });

  it('a closed session with a recent note is dormant, dated by the note', () => {
    const board = boardOf([session('a'), note('a', NOW - DAY)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: {}, now: NOW });
    expect(view.dormant).toEqual([{ sessionId: 'a', lastActivityAt: NOW - DAY, pinned: false }]);
    expect(view.oldSessionIds.size).toBe(0);
  });

  it('the date is the newest of the note and the registry', () => {
    const board = boardOf([session('a'), note('a', NOW - 10 * DAY)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: registered('a', NOW - 2 * DAY), now: NOW });
    expect(view.dormant[0]?.lastActivityAt).toBe(NOW - 2 * DAY);
  });

  it('closed for more than 7 days, or with no date at all, is old', () => {
    const board = boardOf([session('a'), note('a', NOW - OLD_SESSION_MS - 1), session('b')]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: {}, now: NOW });
    expect(view.dormant).toEqual([]);
    expect([...view.oldSessionIds].sort()).toEqual(['a', 'b']);
    // Unfolded on demand: the ones with a card, newest first (no date last).
    expect(view.old).toEqual([
      { sessionId: 'a', lastActivityAt: NOW - OLD_SESSION_MS - 1, pinned: false },
      { sessionId: 'b', lastActivityAt: null, pinned: false },
    ]);
  });

  it('exactly 7 days is still recent', () => {
    const board = boardOf([session('a'), note('a', NOW - OLD_SESSION_MS)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: {}, now: NOW });
    expect(view.dormant.map((entry) => entry.sessionId)).toEqual(['a']);
  });

  it('a favorite (pinned) is never old, even with no date', () => {
    const board = boardOf([session('a')]);
    const registry: SessionRegistry = { a: { sessionId: 'a', projectPath: PROJECT, label: 'x', lastActivityAt: NOW - 90 * DAY, pinned: true } };
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry, now: NOW });
    expect(view.dormant).toEqual([{ sessionId: 'a', lastActivityAt: NOW - 90 * DAY, pinned: true }]);
    expect(view.oldSessionIds.size).toBe(0);
  });

  it('a note whose session card is gone follows its own date', () => {
    const board = boardOf([note('a', NOW - 20 * DAY), note('b', NOW - DAY)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: {}, now: NOW });
    expect([...view.oldSessionIds]).toEqual(['a']);
    expect(view.dormant).toEqual([]);
  });

  it('dormant sessions come newest first', () => {
    const board = boardOf([session('a'), note('a', NOW - 3 * DAY), session('b'), note('b', NOW - DAY)]);
    const view = classifyBoardSessions({ board, liveSessionIds: new Set(), registry: {}, now: NOW });
    expect(view.dormant.map((entry) => entry.sessionId)).toEqual(['b', 'a']);
  });
});

describe('dormantSessionName', () => {
  it('the tab name wins, then the note, then the registry, then "Sessão"', () => {
    expect(dormantSessionName({ stored: 'radar', noteName: 'atlas', registryLabel: 'reg' })).toBe('radar');
    expect(dormantSessionName({ stored: null, noteName: 'atlas', registryLabel: 'reg' })).toBe('atlas');
    expect(dormantSessionName({ stored: '  ', noteName: undefined, registryLabel: 'reg' })).toBe('reg');
    expect(dormantSessionName({ stored: null, noteName: undefined, registryLabel: undefined })).toBe('Sessão');
  });
});

describe('closedLabel', () => {
  it('local day/month and hour:minute, or just "Fechada"', () => {
    expect(closedLabel(new Date(2026, 9, 31, 13, 6).getTime())).toBe('Fechada · 31/10 13:06');
    expect(closedLabel(null)).toBe('Fechada');
  });
});
