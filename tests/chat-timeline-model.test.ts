import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  foldKey,
  formatElapsed,
  foldLabel,
  type TimelineItem,
  type TimelineOptions,
} from '../src/renderer/src/chat/timelineModel';
import type { ActionCategory, ConversationRow, LiveState } from '../src/shared/chat/rows';

let clock = 0;
const at = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++ * 10)).toISOString();
const base = (turnId: string | null) => ({ turnId, at: at(), scope: 'main' as const });
const user = (id: string, turnId = 't1'): ConversationRow => ({ ...base(turnId), kind: 'user', id, text: 'oi', attachments: [] });
const note = (id: string, markdown = 'andando', turnId = 't1'): ConversationRow => ({
  ...base(turnId), kind: 'assistant', id, markdown, blockIndex: 0, messageId: `m-${id}`,
});
const act = (id: string, turnId = 't1'): ConversationRow => ({
  ...base(turnId), kind: 'action', id, toolUseId: id, tool: 'Read', category: 'read', summary: { verb: 'Leu' }, status: 'ok',
});
const sub = (id: string, turnId = 't1'): ConversationRow => ({
  ...base(turnId), kind: 'subagent', id, agentId: id, toolUseId: `tu-${id}`, description: 'd', agentType: 'beacon',
  status: 'running', startedAt: '2026-01-01T00:00:00Z', background: true, depth: 0,
});
const switchNotice = (): ConversationRow => ({ ...base(null), kind: 'notice', id: 'app:conversation-switch:s2', notice: 'conversation-switch', params: {} });
const group = (id: string, counts: Partial<Record<ActionCategory, number>>, turnId = 't1'): ConversationRow => ({
  ...base(turnId), kind: 'action-group', id, children: [], failed: [],
  counts: { read: 0, edit: 0, write: 0, bash: 0, search: 0, web: 0, agent: 0, skill: 0, mcp: 0, task: 0, other: 0, ...counts },
});

const live = (over: Partial<LiveState> = {}): LiveState => ({
  status: 'idle', currentAction: null, pendings: [], sends: [], activeSubagents: [], terminalNeeded: null, ...over,
});
const opts = (over: Partial<TimelineOptions> = {}): TimelineOptions => ({
  focusMode: true, live: live(), expanded: new Set<string>(), ...over,
});

const flat = (rounds: ReturnType<typeof buildTimeline>): TimelineItem[] => rounds.flatMap((r) => r.items);
const ids = (items: TimelineItem[]) => items.map((i) => (i.kind === 'row' ? i.row.id : i.key));

describe('buildTimeline - Focus Mode off', () => {
  it('shows every row, in order, grouped in one round per turn', () => {
    const rows = [user('u1'), note('n1'), act('a1'), user('u2', 't2'), note('n2', 'x', 't2')];
    const rounds = buildTimeline(rows, opts({ focusMode: false }));
    expect(rounds.map((r) => r.items.map((i) => (i.kind === 'row' ? i.row.id : '?')))).toEqual([
      ['u1', 'n1', 'a1'],
      ['u2', 'n2'],
    ]);
  });

  it('keeps a loose (turnId null) row with the round it sits in', () => {
    const rows = [switchNotice(), user('u1'), note('n1')];
    const rounds = buildTimeline(rows, opts({ focusMode: false }));
    expect(flat(rounds).length).toBe(3);
    expect(ids(flat(rounds))).toEqual(['app:conversation-switch:s2', 'u1', 'n1']);
  });
});

describe('buildTimeline - Focus Mode on', () => {
  it('folds the work between the owner message and the final answer (done turn)', () => {
    const rows = [user('u'), note('n1'), act('a1'), act('a2'), note('fin', 'pronto')];
    const items = flat(buildTimeline(rows, opts()));
    expect(items.map((i) => i.kind)).toEqual(['row', 'fold', 'row']);
    const fold = items[1] as Extract<TimelineItem, { kind: 'fold' }>;
    expect(fold.state).toBe('done');
    expect(fold.label).toBe('trabalhou — 2 ações, 1 nota');
    expect(fold.rows.map((r) => r.id)).toEqual(['n1', 'a1', 'a2']);
    expect(fold.expanded).toBe(false);
    expect(fold.key).toBe(foldKey('n1'));
  });

  it('G1: the fold of the turn still in progress says "trabalhando" and shows no final row', () => {
    const rows = [user('u'), note('n1'), act('a1')];
    const items = flat(buildTimeline(rows, opts({ live: live({ status: 'working' }) })));
    const fold = items[1] as Extract<TimelineItem, { kind: 'fold' }>;
    expect(items.map((i) => i.kind)).toEqual(['row', 'fold']);
    expect(fold.state).toBe('working');
    expect(fold.label).toBe('trabalhando — 1 ação, 1 nota');
  });

  it('G1: an open pending turns the live fold into "esperando você"', () => {
    const rows = [user('u'), note('n1', 'qual das duas?'), act('a1')];
    const pending = { id: 'p1', kind: 'question' } as unknown as LiveState['pendings'][number];
    const items = flat(buildTimeline(rows, opts({ live: live({ status: 'waiting-you', pendings: [pending] }) })));
    const fold = items[1] as Extract<TimelineItem, { kind: 'fold' }>;
    expect(fold.state).toBe('waiting');
    expect(fold.label).toBe('esperando você — 1 ação, 1 nota');
    expect(fold.hasQuestion).toBe(true);
  });

  it('only the LAST fold of an unfinished turn is live; earlier ones are done', () => {
    const rows = [user('u'), act('a0'), note('n1'), sub('s1'), note('n2'), act('a2')];
    const items = flat(buildTimeline(rows, opts({ live: live({ status: 'working' }) })));
    const folds = items.filter((i): i is Extract<TimelineItem, { kind: 'fold' }> => i.kind === 'fold');
    expect(folds.map((f) => f.state)).toEqual(['done', 'working']);
  });

  it('a turn that is not the last one is done even if the live status is working', () => {
    const rows = [user('u1'), note('n1'), act('a1'), note('f1'), user('u2', 't2'), note('n2', 'x', 't2'), act('a2', 't2')];
    const items = flat(buildTimeline(rows, opts({ live: live({ status: 'working' }) })));
    const folds = items.filter((i): i is Extract<TimelineItem, { kind: 'fold' }> => i.kind === 'fold');
    expect(folds.map((f) => f.state)).toEqual(['done', 'working']);
  });

  it('decision 1 / D-C19: the message that launches subagents and their rows stay outside the fold', () => {
    const rows = [user('u'), note('n0'), note('launch', 'vou levantar o impacto'), sub('s1'), sub('s2'), note('fin', 'pronto')];
    const items = flat(buildTimeline(rows, opts()));
    expect(ids(items)).toEqual(['u', foldKey('n0'), 'launch', 's1', 's2', 'fin']);
  });

  it('counts the actions inside action-group rows', () => {
    const rows = [user('u'), group('g1', { read: 3, bash: 1 }), note('fin')];
    const fold = flat(buildTimeline(rows, opts())).find((i) => i.kind === 'fold') as Extract<TimelineItem, { kind: 'fold' }>;
    expect(fold.label).toBe('trabalhou — 4 ações');
  });

  it('marks an expanded fold from the expanded set', () => {
    const rows = [user('u'), note('n1'), note('fin')];
    const items = flat(buildTimeline(rows, opts({ expanded: new Set([foldKey('n1')]) })));
    expect((items[1] as Extract<TimelineItem, { kind: 'fold' }>).expanded).toBe(true);
  });

  it('keeps a loose notice visible where it is', () => {
    const rows = [switchNotice(), user('u'), note('n1'), note('fin')];
    const items = flat(buildTimeline(rows, opts()));
    expect(ids(items)).toEqual(['app:conversation-switch:s2', 'u', foldKey('n1'), 'fin']);
  });

  it('treats an unknown live state (still loading) as finished', () => {
    const rows = [user('u'), note('n1'), note('fin')];
    const items = flat(buildTimeline(rows, opts({ live: null })));
    expect((items[1] as Extract<TimelineItem, { kind: 'fold' }>).state).toBe('done');
  });

  it('gives the done fold its duration from the timestamps of the folded rows', () => {
    const rows = [user('u'), note('n1'), act('a1'), note('fin')];
    const fold = flat(buildTimeline(rows, opts())).find((i) => i.kind === 'fold') as Extract<TimelineItem, { kind: 'fold' }>;
    expect(fold.startedAt).toBe(rows[1]!.at);
    expect(fold.endedAt).toBe(rows[3]!.at);
  });
});

describe('foldLabel', () => {
  it('pluralises in Portuguese', () => {
    expect(foldLabel('done', 1, 1, 0)).toBe('trabalhou — 1 ação, 1 nota');
    expect(foldLabel('done', 9, 2, 0)).toBe('trabalhou — 9 ações, 2 notas');
  });
  it('omits a zero count and falls back to the number of steps', () => {
    expect(foldLabel('done', 0, 2, 2)).toBe('trabalhou — 2 notas');
    expect(foldLabel('done', 0, 0, 3)).toBe('trabalhou — 3 etapas');
    expect(foldLabel('working', 0, 0, 1)).toBe('trabalhando — 1 etapa');
  });
});

describe('formatElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsed(41_000)).toBe('41 s');
    expect(formatElapsed(161_000)).toBe('2 min 41 s');
    expect(formatElapsed(120_000)).toBe('2 min');
    expect(formatElapsed(0)).toBe('0 s');
  });
  it('rounds down sub-second values and clamps negatives', () => {
    expect(formatElapsed(900)).toBe('0 s');
    expect(formatElapsed(-5)).toBe('0 s');
  });
});
