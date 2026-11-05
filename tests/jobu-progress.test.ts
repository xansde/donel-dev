// Painel de progresso do Jobu — the estimate the owner reads: the bar, the end date and where it came from.
import { describe, expect, it } from 'vitest';
import { applyLedgerOp, emptyLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp } from '../src/shared/ledger/contract';
import { dueEndsAt, jobuProgress, PROGRESS_DONE_KEEP_MS } from '../src/shared/pet/progress';

const H = 60 * 60 * 1000;
const T0 = new Date(2026, 10, 5, 9, 0).getTime();
const lider: LedgerActor = { kind: 'lugar', placeId: 'lider', roleId: 'lider' };
const dev: LedgerActor = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' };

function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, now: number, id = 't-1'): LedgerDoc {
  const result = applyLedgerOp(doc, actor, op, { now, newId: () => id });
  if (!result.ok) throw new Error(result.reason);
  return result.doc;
}

function created(due: string, id = 't-1', projectPath = '/w/atlas'): LedgerDoc {
  return run(emptyLedgerDoc(), lider, { op: 'criar', projectPath, request: 'Fazer X', doneWhen: 'X feito', due, ownerPlaceId: 'place:dev', risk: 'alto' }, T0, id);
}

describe('jobuProgress', () => {
  it('a task nobody took ends at its deadline, with no step counted', () => {
    const task = jobuProgress(created('2026-11-07'), T0 + H).boards[0]!.tasks[0]!;
    expect(task.steps).toBe(0);
    expect(task.endsAt).toBe(dueEndsAt('2026-11-07'));
    expect(task.late).toBe(false);
    expect(task.source).toMatch(/prazo/);
  });

  it('a task under way ends by the pace of the steps it walked, and says when that passes the deadline', () => {
    let doc = run(created('2026-11-05'), dev, { op: 'assumir', id: 't-1' }, T0 + H);
    // 1 of 3 steps in 4 h → 8 h more: 21:00 of the same day, before the end of the deadline day.
    let task = jobuProgress(doc, T0 + 4 * H).boards[0]!.tasks[0]!;
    expect(task.steps).toBe(1);
    expect(task.endsAt).toBe(T0 + 12 * H);
    expect(task.late).toBe(false);
    expect(task.places).toEqual(['lider', 'dev']);
    // 1 of 3 in 8 h → 16 h more: tomorrow, after the deadline.
    task = jobuProgress(doc, T0 + 8 * H).boards[0]!.tasks[0]!;
    expect(task.late).toBe(true);
    expect(task.source).toMatch(/passa do prazo/);

    doc = run(doc, dev, { op: 'entregar', id: 't-1', proofs: [{ kind: 'texto', text: 'ok' }] }, T0 + 9 * H);
    doc = run(doc, { kind: 'dono' }, { op: 'rejeitar', id: 't-1', reason: 'faltou Y' }, T0 + 10 * H);
    task = jobuProgress(doc, T0 + 10 * H).boards[0]!.tasks[0]!;
    // A rejected delivery goes back to 1 of 3: the work has to be redone.
    expect(task.steps).toBe(1);
    expect(task.source).toMatch(/refazendo/);
  });

  it('an accepted task is full, ends when accepted, and leaves the panel a day later', () => {
    let doc = run(created('2026-11-07'), dev, { op: 'assumir', id: 't-1' }, T0 + H);
    doc = run(doc, dev, { op: 'entregar', id: 't-1', proofs: [{ kind: 'texto', text: 'ok' }] }, T0 + 2 * H);
    doc = run(doc, { kind: 'dono' }, { op: 'aceitar', id: 't-1' }, T0 + 3 * H);
    const board = jobuProgress(doc, T0 + 4 * H).boards[0]!;
    expect(board.tasks[0]!.steps).toBe(3);
    expect(board.endsAt).toBe(T0 + 3 * H);
    expect(board.done).toBe(1);
    expect(jobuProgress(doc, T0 + 3 * H + PROGRESS_DONE_KEEP_MS).boards).toEqual([]);
  });

  it('a board sums its tasks and ends with the last task left', () => {
    let doc = created('2026-11-07', 't-1');
    doc = run(doc, lider, { op: 'criar', projectPath: '/w/atlas', request: 'Fazer Z', doneWhen: 'Z feito', due: '2026-11-09', ownerPlaceId: 'place:dev', risk: 'baixo' }, T0, 't-2');
    doc = run(doc, dev, { op: 'assumir', id: 't-1' }, T0 + H);
    const board = jobuProgress(doc, T0 + 2 * H).boards[0]!;
    expect(board.title).toBe('atlas');
    expect([board.steps, board.totalSteps]).toEqual([1, 6]);
    expect(board.endsAt).toBe(dueEndsAt('2026-11-09'));
  });
});
