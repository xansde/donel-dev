import { describe, expect, it } from 'vitest';
import type { LedgerActor } from '../src/shared/ledger/contract';
import { filaDoQuadro } from '../src/shared/livro/fila';
import { appendEntry, type EntryInput, type JournalLine } from '../src/shared/livro/formato';
import { projectJournal } from '../src/shared/livro/projecao';

// F9 (docs/planos/ledger-bom.md) — priority, parent and board limit as entries of the journal. What would break
// without the owner noticing: an older priority winning over his newest one, a task silently moved from one parent
// to another, or an undo that erases history.

const T0 = Date.UTC(2026, 10, 8, 12);
const dono: LedgerActor = { kind: 'dono' };
let n = 0;
const input = (tipo: EntryInput['tipo'], tarefa: string, dados: Record<string, unknown>): EntryInput => ({ id: `l-${++n}`, em: T0 + n, quem: dono, tipo, tarefa, dados, chave: `k-${n}` });
const criar = (tarefa: string): EntryInput => input('criar', tarefa, { projectPath: 'P', request: tarefa, doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:a', risk: 'baixo' });

function journal(inputs: readonly EntryInput[]): JournalLine[] {
  return inputs.reduce<JournalLine[]>((lines, each) => {
    const result = appendEntry(lines, each);
    if (!result.ok) throw new Error(result.reason);
    return result.lines;
  }, []);
}

const tasks = [criar('t-1'), criar('t-2'), criar('t-3')];

describe('prioridade, pai e limite no diário (F9)', () => {
  it('the last priority wins and both stay in the journal; undo is a new entry', () => {
    const lines = journal([...tasks, input('priorizada', 't-3', { quadro: 'P', posicao: 1 }), input('priorizada', 't-2', { quadro: 'P', posicao: 2 }), input('priorizada', 't-3', { quadro: 'P', posicao: 3 })]);
    const projected = projectJournal(lines);
    expect(projected.fila.prioridade.get('t-3')).toMatchObject({ posicao: 3, seq: 6 });
    expect(lines.filter((line) => line.kind === 'entry' && line.tipo === 'priorizada' && line.tarefa === 't-3')).toHaveLength(2);
    expect(filaDoQuadro(projected.doc, projected.fila, 'P')).toEqual(['t-2', 't-3', 't-1']);

    const undone = projectJournal(journal([...tasks, input('priorizada', 't-2', { quadro: 'P', posicao: 2 }), input('priorizada', 't-3', { quadro: 'P', posicao: 3 }), input('priorizada', 't-3', { quadro: 'P', posicao: null })]));
    expect(undone.fila.prioridade.has('t-3')).toBe(false);
    expect(filaDoQuadro(undone.doc, undone.fila, 'P')).toEqual(['t-2', 't-1', 't-3']);
  });

  it('refuses grouping a task already grouped, with the reason; ungrouping is a new entry; the board limit is the last one', () => {
    const lines = journal([...tasks, input('agrupada', 't-2', { pai: 't-1' }), input('agrupada', 't-2', { pai: 't-3' })]);
    const projected = projectJournal(lines);
    // The refused entry stays in the journal as refused and changes nothing.
    expect(projected.steps.at(-1)).toMatchObject({ seq: 5, status: 'recusado', reason: expect.stringMatching(/já está agrupada sob t-1/) });
    expect(projected.fila.pais.get('t-2')).toBe('t-1');
    expect(filaDoQuadro(projected.doc, projected.fila, 'P')).toEqual(['t-1', 't-3']);

    const regrouped = projectJournal(journal([...tasks, input('agrupada', 't-2', { pai: 't-1' }), input('agrupada', 't-2', { pai: null }), input('agrupada', 't-2', { pai: 't-3' })]));
    expect(regrouped.fila.pais.get('t-2')).toBe('t-3');
    expect(regrouped.steps.every((step) => step.status === 'aplicado')).toBe(true);

    const limits = projectJournal(journal([input('limite-do-quadro', 'P', { limite: 4 }), input('limite-do-quadro', 'P', { limite: 2 }), input('limite-do-quadro', 'P', { limite: 3, extra: 1 })]));
    expect(limits.fila.limites.get('P')).toBe(2);
    expect(limits.steps.at(-1)).toMatchObject({ status: 'recusado', reason: expect.stringMatching(/campo desconhecido/) });
  });
});
