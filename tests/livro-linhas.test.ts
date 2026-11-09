import { describe, expect, it } from 'vitest';
import { emptyLedgerDoc, LEDGER_SCHEMA_VERSION, type LedgerDoc, type LedgerTask, type LedgerTaskState } from '../src/shared/ledger/contract';
import { addPlace, emptyMindscapeDoc, setPlaceConversation } from '../src/shared/mindscape/model';
import { linhasPorQuadro } from '../src/shared/livro/linhas';

// F8 (docs/planos/ledger-bom.md) — the lines in progress per board, in the three definitions the letter puts to the
// owner. What would break without the owner noticing: a closed session still counted as a running line (the pull
// would never free a slot).

const T0 = Date.UTC(2026, 10, 8, 12);

function task(id: string, projectPath: string, ownerPlaceId: string, state: LedgerTaskState): LedgerTask {
  return { id, projectPath, request: id, doneWhen: 'x', due: '2026-11-09', ownerPlaceId, risk: 'baixo', state, createdAt: T0, events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }] };
}

function ledgerOf(tasks: LedgerTask[]): LedgerDoc {
  return { ...emptyLedgerDoc(), schemaVersion: LEDGER_SCHEMA_VERSION, startedAt: T0, tasks: Object.fromEntries(tasks.map((each) => [each.id, each])) };
}

describe('linhas em andamento por quadro (F8)', () => {
  it('counts the three definitions per board and drops a closed session from the live-session count at once', () => {
    let boards = emptyMindscapeDoc();
    for (const id of ['place:a', 'place:b', 'place:c']) boards = addPlace(boards, 'P', { id, roleId: 'dev' });
    boards = setPlaceConversation(boards, 'P', 'place:a', 'conv-a');
    boards = setPlaceConversation(boards, 'P', 'place:b', 'conv-b');
    const ledger = ledgerOf([
      task('t-1', 'P', 'place:a', 'em-execucao'),
      task('t-2', 'P', 'place:a', 'aberta'),
      task('t-3', 'P', 'place:b', 'em-execucao'),
      task('t-4', 'P', 'place:c', 'aberta'), // place:c never started: no live session
      task('t-5', 'P', 'place:b', 'aceita'), // closed: no line
      task('t-6', 'Q', 'place:x', 'em-execucao'),
    ]);
    const capacidade = { ramTotalMb: 32_000, reservaMb: 4_000, picoVerifyMb: 3_000, ramPorSessaoMb: 350 };

    const before = linhasPorQuadro({ ledger, boards, liveSessionIds: new Set(['conv-a', 'conv-b']), capacidade });
    expect(before.find((row) => row.quadro === 'P')).toMatchObject({ emExecucao: 2, sessaoViva: 2, pedidoRaiz: 4, cabem: 71 });
    expect(before.find((row) => row.quadro === 'Q')).toMatchObject({ emExecucao: 1, sessaoViva: 0, pedidoRaiz: 1 });

    // conv-b closes: definition 2 drops by one now; the other two do not depend on sessions.
    const after = linhasPorQuadro({ ledger, boards, liveSessionIds: new Set(['conv-a']), capacidade });
    expect(after.find((row) => row.quadro === 'P')).toMatchObject({ emExecucao: 2, sessaoViva: 1, pedidoRaiz: 4 });

    // A task grouped under a parent is not a root line of its own.
    const grouped = linhasPorQuadro({ ledger, boards, liveSessionIds: new Set(['conv-a']), capacidade, paiDe: (id) => (id === 't-2' ? 't-1' : undefined) });
    expect(grouped.find((row) => row.quadro === 'P')?.pedidoRaiz).toBe(3);
  });
});
