import { describe, expect, it } from 'vitest';
import { emptyLedgerDoc, type LedgerDoc, type LedgerTask } from '../src/shared/ledger/contract';
import { filaDoQuadro, projetarFila, recusaFila, type LancamentoFila } from '../src/shared/livro/fila';

// F9 (docs/planos/ledger-bom.md) — priority, parent and board limit as entries of the journal. What would break
// without the owner noticing: an older priority winning over his newest one, a task silently moved from one parent
// to another, or an undo that erases history.

const T0 = Date.UTC(2026, 10, 8, 12);
let seq = 0;
const entry = (tipo: LancamentoFila['tipo'], tarefa: string | undefined, dados: Record<string, unknown>): LancamentoFila => ({ seq: ++seq, em: T0 + seq, quem: 'dono', tipo, ...(tarefa ? { tarefa } : {}), dados });

function task(id: string, createdAt: number): LedgerTask {
  return { id, projectPath: 'P', request: id, doneWhen: 'x', due: '2026-11-09', ownerPlaceId: 'place:a', risk: 'baixo', state: 'aberta', createdAt, events: [{ kind: 'criada', at: createdAt, by: { kind: 'dono' } }] };
}
const ledger: LedgerDoc = { ...emptyLedgerDoc(), startedAt: T0, tasks: { 't-1': task('t-1', T0), 't-2': task('t-2', T0 + 1), 't-3': task('t-3', T0 + 2) } };

describe('prioridade, pai e limite no diário (F9)', () => {
  it('the last priority wins and both stay in the journal; undo is a new entry', () => {
    const journal = [entry('priorizada', 't-3', { quadro: 'P', posicao: 1 }), entry('priorizada', 't-2', { quadro: 'P', posicao: 2 }), entry('priorizada', 't-3', { quadro: 'P', posicao: 3 })];
    const state = projetarFila(journal);
    expect(state.prioridade.get('t-3')).toMatchObject({ posicao: 3, seq: journal[2]!.seq });
    expect(journal.filter((each) => each.tarefa === 't-3')).toHaveLength(2);
    expect(filaDoQuadro(ledger, state, 'P')).toEqual(['t-2', 't-3', 't-1']);

    const undone = [...journal, entry('priorizada', 't-3', { quadro: 'P', posicao: null })];
    expect(projetarFila(undone).prioridade.has('t-3')).toBe(false);
    expect(filaDoQuadro(ledger, projetarFila(undone), 'P')).toEqual(['t-2', 't-1', 't-3']);
  });

  it('refuses grouping a task already grouped, with the reason; ungrouping is a new entry; the board limit is the last one', () => {
    const grouped = [entry('agrupada', 't-2', { pai: 't-1' })];
    const again = entry('agrupada', 't-2', { pai: 't-3' });
    expect(recusaFila(projetarFila(grouped), again)).toMatch(/já está agrupada sob t-1/);

    // A refused entry stays in the journal as refused and changes nothing.
    const state = projetarFila([...grouped, again]);
    expect(state.pais.get('t-2')).toBe('t-1');
    expect(state.recusados).toEqual([{ seq: again.seq, motivo: expect.stringMatching(/já está agrupada sob t-1/) }]);
    expect(filaDoQuadro(ledger, state, 'P')).toEqual(['t-1', 't-3']);

    const ungrouped = projetarFila([...grouped, again, entry('agrupada', 't-2', { pai: null }), entry('agrupada', 't-2', { pai: 't-3' })]);
    expect(ungrouped.pais.get('t-2')).toBe('t-3');
    expect(ungrouped.recusados).toHaveLength(1);

    const limits = projetarFila([entry('limite-do-quadro', undefined, { quadro: 'P', limite: 4 }), entry('limite-do-quadro', undefined, { quadro: 'P', limite: 2 })]);
    expect(limits.limites.get('P')).toBe(2);
    expect(recusaFila(limits, entry('limite-do-quadro', undefined, { quadro: 'P', limite: 2, extra: 1 }))).toMatch(/campo desconhecido/);
  });
});
