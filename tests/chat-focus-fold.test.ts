import { describe, expect, it } from 'vitest';
import { foldForFocus } from '../src/shared/chat/focusFold';
import type { ActionCategory, ConversationRow, FocusItem, Turn } from '../src/shared/chat/rows';

const base = { turnId: 't1', at: '2026-01-01T00:00:00Z', scope: 'main' as const };
const user = (id: string, turnId = 't1'): ConversationRow => ({ ...base, turnId, kind: 'user', id, text: 'oi', attachments: [] });
const note = (id: string, markdown = 'andando', turnId = 't1'): ConversationRow => ({
  ...base, turnId, kind: 'assistant', id, markdown, blockIndex: 0, messageId: `m-${id}`,
});
const act = (id: string, turnId = 't1'): ConversationRow => ({
  ...base, turnId, kind: 'action', id, toolUseId: id, tool: 'Read', category: 'read', summary: { verb: 'Leu' }, status: 'ok',
});
const think = (id: string): ConversationRow => ({ ...base, kind: 'thinking', id, hasText: true });
const sub = (id: string): ConversationRow => ({
  ...base, kind: 'subagent', id, agentId: id, toolUseId: `tu-${id}`, description: 'd', agentType: 'beacon',
  status: 'running', startedAt: base.at, background: true, depth: 0,
});
const group = (id: string, counts: Partial<Record<ActionCategory, number>>): ConversationRow => ({
  ...base, kind: 'action-group', id, children: [], failed: [],
  counts: { read: 0, edit: 0, write: 0, bash: 0, search: 0, web: 0, agent: 0, skill: 0, mcp: 0, task: 0, other: 0, ...counts },
});
const turn = (rows: ConversationRow[], over: Partial<Turn> = {}): Turn => ({
  turnId: 't1', opener: 'human', rows: rows.map((r) => r.id), complete: true, finalRowId: null, ...over,
});
const row = (rowId: string): FocusItem => ({ kind: 'row', rowId });
const shownIds = (out: readonly FocusItem[]) => out.filter((i) => i.kind === 'row').map((i) => (i as { rowId: string }).rowId);

describe('foldForFocus — per turn', () => {
  it('shows the owner message and the final row, folding the rest', () => {
    const rows = [user('u'), note('n1'), act('a1'), act('a2'), note('n2'), note('fin', 'pronto')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out).toEqual([
      row('u'),
      { kind: 'folded', actions: 2, notes: 2, hasQuestion: false, rows: ['n1', 'a1', 'a2', 'n2'] },
      row('fin'),
    ]);
  });

  it('counts the actions inside action-group rows', () => {
    const rows = [user('u'), group('group:a1', { read: 2, bash: 1 }), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out[1]).toMatchObject({ kind: 'folded', actions: 3, notes: 0, rows: ['group:a1'] });
  });

  it('emits no folded item when nothing is hidden', () => {
    const rows = [user('u'), note('fin')];
    expect(foldForFocus([turn(rows, { finalRowId: 'fin' })], rows)).toEqual([row('u'), row('fin')]);
  });

  it('folds thinking rows without counting them as notes or actions', () => {
    const rows = [user('u'), think('th'), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out[1]).toMatchObject({ kind: 'folded', actions: 0, notes: 0, rows: ['th'] });
  });

  it('handles several turns in order', () => {
    const r1 = [user('u1'), act('a1'), note('f1')];
    const r2 = [user('u2', 't2'), act('a2', 't2'), note('f2', 'ok', 't2')];
    const out = foldForFocus(
      [turn(r1, { finalRowId: 'f1' }), turn(r2, { turnId: 't2', finalRowId: 'f2' })],
      [...r1, ...r2],
    );
    expect(out.map((i) => (i.kind === 'row' ? i.rowId : 'folded'))).toEqual(['u1', 'folded', 'f1', 'u2', 'folded', 'f2']);
  });
});

describe('foldForFocus — hasQuestion', () => {
  const run = (markdown: string) => {
    const rows = [user('u'), note('n', markdown), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    const folded = out.find((i) => i.kind === 'folded');
    return folded && folded.kind === 'folded' ? folded.hasQuestion : undefined;
  };

  it('is true when a folded note ends in a question mark', () => {
    expect(run('Posso seguir assim?')).toBe(true);
  });
  it('ignores trailing spaces and markdown punctuation', () => {
    expect(run('Posso seguir **assim?**  \n')).toBe(true);
    expect(run('Qual deles (a ou b?)')).toBe(true);
    expect(run('Isso `faz sentido?`')).toBe(true);
  });
  it('is false when the question mark is not at the end', () => {
    expect(run('Será? Vou ver.')).toBe(false);
    expect(run('Vou seguir.')).toBe(false);
  });
  it('does not look at the final row (it is not folded)', () => {
    const rows = [user('u'), note('n', 'ok'), note('fin', 'E agora?')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out[1]).toMatchObject({ kind: 'folded', hasQuestion: false });
  });
});

describe('foldForFocus — turn in progress', () => {
  it('shows the owner message and a partial folded block; the final waits for the turn to close', () => {
    const rows = [user('u'), act('a1'), note('n1', 'preciso de algo?')];
    const out = foldForFocus([turn(rows, { complete: false, finalRowId: null })], rows);
    expect(out).toEqual([
      row('u'),
      { kind: 'folded', actions: 1, notes: 1, hasQuestion: true, rows: ['a1', 'n1'] },
    ]);
  });

  it('ignores a finalRowId on an incomplete turn', () => {
    const rows = [user('u'), note('n1')];
    const out = foldForFocus([turn(rows, { complete: false, finalRowId: 'n1' })], rows);
    expect(out.map((i) => i.kind)).toEqual(['row', 'folded']);
  });

  it('a complete turn without a final row folds everything but the owner message', () => {
    const rows = [user('u'), act('a1')];
    const out = foldForFocus([turn(rows, { finalRowId: null })], rows);
    expect(out).toEqual([row('u'), { kind: 'folded', actions: 1, notes: 0, hasQuestion: false, rows: ['a1'] }]);
  });
});

describe('foldForFocus — opened by notification', () => {
  it('has no owner message: only the folded block and the final row', () => {
    const rows = [act('a1'), note('fin')];
    const out = foldForFocus([turn(rows, { opener: 'notification', finalRowId: 'fin' })], rows);
    expect(out).toEqual([
      { kind: 'folded', actions: 1, notes: 0, hasQuestion: false, rows: ['a1'] },
      row('fin'),
    ]);
  });
});

describe('foldForFocus — subagents stay outside the fold (D-C19)', () => {
  it('keeps the launching message and the subagent rows in place', () => {
    const rows = [user('u'), act('a1'), note('launch', 'Vou lançar agentes'), sub('s1'), sub('s2'), act('a2'), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out).toEqual([
      row('u'),
      { kind: 'folded', actions: 1, notes: 0, hasQuestion: false, rows: ['a1'] },
      row('launch'),
      row('s1'),
      row('s2'),
      { kind: 'folded', actions: 1, notes: 0, hasQuestion: false, rows: ['a2'] },
      row('fin'),
    ]);
  });

  it('keeps them outside while the turn is still running', () => {
    const rows = [user('u'), note('launch'), sub('s1')];
    const out = foldForFocus([turn(rows, { complete: false })], rows);
    expect(out).toEqual([row('u'), row('launch'), row('s1')]);
  });

  it('a launching message is not counted as a folded note and does not flag a question', () => {
    const rows = [user('u'), note('launch', 'Lanço agora?'), sub('s1'), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(out.some((i) => i.kind === 'folded')).toBe(false);
  });

  it('thinking between the message and the subagent does not detach them', () => {
    const rows = [user('u'), note('launch'), think('th'), sub('s1'), note('fin')];
    const out = foldForFocus([turn(rows, { finalRowId: 'fin' })], rows);
    expect(shownIds(out)).toEqual(['u', 'launch', 's1', 'fin']);
  });
});
