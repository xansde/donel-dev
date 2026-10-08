import { describe, expect, it } from 'vitest';
import { failureLabel, groupActions, groupLabel } from '../src/shared/chat/grouping';
import type { ActionCategory, ActionRow, ConversationRow, ThinkingRow } from '../src/shared/chat/rows';

let seq = 0;
function action(
  id: string,
  category: ActionCategory = 'read',
  over: Partial<ActionRow> = {},
): ActionRow {
  seq += 1;
  return {
    kind: 'action',
    id,
    toolUseId: id,
    turnId: 't1',
    at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    scope: 'main',
    tool: category,
    category,
    summary: { verb: 'Leu', target: id },
    status: 'ok',
    ...over,
  };
}
function thinking(id: string, over: Partial<ThinkingRow> = {}): ThinkingRow {
  return { kind: 'thinking', id, turnId: 't1', at: '2026-01-01T00:00:00Z', scope: 'main', hasText: true, ...over };
}
function assistant(id: string): ConversationRow {
  return { kind: 'assistant', id, turnId: 't1', at: '2026-01-01T00:00:00Z', scope: 'main', markdown: 'ok', blockIndex: 0, messageId: 'm' };
}
function subagent(id: string): ConversationRow {
  return {
    kind: 'subagent', id, turnId: 't1', at: '2026-01-01T00:00:00Z', scope: 'main', agentId: 'a', toolUseId: 'x',
    description: 'd', agentType: 'beacon', status: 'running', startedAt: '2026-01-01T00:00:00Z', background: true, depth: 0,
  };
}
const ids = (rows: readonly ConversationRow[]) => rows.map((r) => r.id);

describe('groupActions — when a group forms', () => {
  it('leaves a single action alone', () => {
    const rows = [assistant('a1'), action('x1'), assistant('a2')];
    expect(ids(groupActions(rows))).toEqual(['a1', 'x1', 'a2']);
  });

  it('groups two or more consecutive actions', () => {
    const out = groupActions([assistant('a1'), action('x1'), action('x2'), action('x3'), assistant('a2')]);
    expect(ids(out)).toEqual(['a1', 'group:x1', 'a2']);
    const g = out[1]!;
    expect(g.kind).toBe('action-group');
    if (g.kind === 'action-group') {
      expect(g.children).toEqual(['x1', 'x2', 'x3']);
      expect(g.turnId).toBe('t1');
      expect(g.scope).toBe('main');
      expect(g.counts.read).toBe(3);
    }
  });

  it('keeps the same id while the group grows (stable group:<first toolUseId>)', () => {
    const two = groupActions([action('x1'), action('x2')]);
    const three = groupActions([action('x1'), action('x2'), action('x3')]);
    expect(ids(two)).toEqual(['group:x1']);
    expect(ids(three)).toEqual(['group:x1']);
  });

  it('is idempotent on already-grouped output', () => {
    const once = groupActions([action('x1'), action('x2'), assistant('a')]);
    expect(ids(groupActions(once))).toEqual(ids(once));
  });
});

describe('groupActions — thinking', () => {
  it('absorbs thinking between actions (does not break the group)', () => {
    const out = groupActions([action('x1'), thinking('th1'), action('x2')]);
    expect(ids(out)).toEqual(['group:x1']);
    const g = out[0]!;
    if (g.kind === 'action-group') expect(g.children).toEqual(['x1', 'th1', 'x2']);
  });

  it('does not count thinking as an action', () => {
    const g = groupActions([action('x1'), thinking('th1'), action('x2')])[0]!;
    if (g.kind === 'action-group') {
      expect(Object.values(g.counts).reduce((a, b) => a + b, 0)).toBe(2);
    }
  });

  it('keeps leading and trailing thinking outside the group', () => {
    const out = groupActions([thinking('t0'), action('x1'), action('x2'), thinking('t9'), assistant('a')]);
    expect(ids(out)).toEqual(['t0', 'group:x1', 't9', 'a']);
  });

  it('keeps thinking next to a lone action', () => {
    expect(ids(groupActions([action('x1'), thinking('th1'), assistant('a')]))).toEqual(['x1', 'th1', 'a']);
  });
});

describe('groupActions — what breaks a group', () => {
  it.each([
    ['assistant', () => assistant('b')],
    ['subagent', () => subagent('b')],
    [
      'notice',
      (): ConversationRow => ({ kind: 'notice', id: 'b', turnId: 't1', at: 'x', scope: 'main', notice: 'compact', params: {} }),
    ],
    [
      'skill',
      (): ConversationRow => ({ kind: 'skill', id: 'b', turnId: 't1', at: 'x', scope: 'main', name: 's', how: 'used-by-claude' }),
    ],
    [
      'question',
      (): ConversationRow => ({ kind: 'question', id: 'b', turnId: 't1', at: 'x', scope: 'main', questions: [], answers: {} }),
    ],
    [
      'plan',
      (): ConversationRow => ({ kind: 'plan', id: 'b', turnId: 't1', at: 'x', scope: 'main', markdown: 'p', outcome: 'pending' }),
    ],
    [
      'user',
      (): ConversationRow => ({ kind: 'user', id: 'b', turnId: 't1', at: 'x', scope: 'main', text: 'oi', attachments: [] }),
    ],
  ])('%s between actions splits the run', (_name, make) => {
    const out = groupActions([action('x1'), action('x2'), make(), action('x3'), action('x4')]);
    expect(ids(out)).toEqual(['group:x1', 'b', 'group:x3']);
  });

  it('a different turn splits the run', () => {
    const out = groupActions([action('x1'), action('x2'), action('x3', 'read', { turnId: 't2' }), action('x4', 'read', { turnId: 't2' })]);
    expect(ids(out)).toEqual(['group:x1', 'group:x3']);
  });

  it('a different scope (subagent) splits the run', () => {
    const sub = { agentId: 'ag1' } as const;
    const out = groupActions([
      action('x1'),
      action('x2'),
      action('s1', 'read', { scope: sub }),
      action('s2', 'read', { scope: sub }),
      action('s3', 'read', { scope: { agentId: 'ag2' } }),
    ]);
    expect(ids(out)).toEqual(['group:x1', 'group:s1', 's3']);
  });
});

describe('groupLabel', () => {
  const counts = (o: Partial<Record<ActionCategory, number>>) =>
    ({ read: 0, edit: 0, write: 0, bash: 0, search: 0, web: 0, agent: 0, skill: 0, mcp: 0, task: 0, other: 0, ...o }) as Record<ActionCategory, number>;

  it('formats "N ações — leu a, editou b, rodou c"', () => {
    expect(groupLabel(counts({ read: 3, edit: 1, bash: 2 }))).toBe('6 ações — leu 3, rodou 2, editou 1');
  });

  it('shows at most three categories and folds the rest into "e mais k"', () => {
    const label = groupLabel(counts({ read: 4, edit: 3, bash: 2, search: 1, web: 1 }));
    expect(label).toBe('11 ações — leu 4, editou 3, rodou 2 e mais 2');
  });

  it('breaks ties by the fixed category order', () => {
    expect(groupLabel(counts({ bash: 1, read: 1 }))).toBe('2 ações — leu 1, rodou 1');
  });

  it('the group row carries the counts the label needs', () => {
    const g = groupActions([action('x1', 'read'), action('x2', 'bash'), action('x3', 'bash')])[0]!;
    if (g.kind !== 'action-group') throw new Error('expected group');
    expect(groupLabel(g.counts)).toBe('3 ações — rodou 2, leu 1');
  });
});

describe('failures in the collapsed header', () => {
  it('lists failed action ids on the group', () => {
    const g = groupActions([
      action('x1', 'read'),
      action('x2', 'bash', { status: 'error', summary: { verb: 'Rodou', target: 'npm test' } }),
      action('x3', 'read'),
    ])[0]!;
    if (g.kind !== 'action-group') throw new Error('expected group');
    expect(g.failed).toEqual(['x2']);
  });

  it('formats "1 falhou: Rodou `npm test`"', () => {
    const failed = action('x2', 'bash', { status: 'error', summary: { verb: 'Rodou', target: 'npm test' } });
    expect(failureLabel([failed])).toBe('1 falhou: Rodou `npm test`');
  });

  it('formats several failures and no failures', () => {
    const a = action('a', 'bash', { status: 'error', summary: { verb: 'Rodou', target: 'npm test' } });
    const b = action('b', 'edit', { status: 'error', summary: { verb: 'Editou', target: 'App.tsx' } });
    expect(failureLabel([a, b])).toBe('2 falharam: Rodou `npm test`, Editou `App.tsx`');
    expect(failureLabel([])).toBe('');
  });

  it('does not treat denied or interrupted as failed', () => {
    const g = groupActions([
      action('x1', 'bash', { status: 'denied' }),
      action('x2', 'bash', { status: 'interrupted' }),
    ])[0]!;
    if (g.kind !== 'action-group') throw new Error('expected group');
    expect(g.failed).toEqual([]);
  });
});
