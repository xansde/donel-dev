// Ledger v5, fatia 1 — the "Esperando você" box is a pure reading of the v4 ledger. An item that falls out of it is
// something waiting for the owner that he never sees (a letter accepted and never sent, a send nobody confirmed, a
// task whose place closed), so each kind is checked here, with its order, and what must stay out.

import { describe, expect, it } from 'vitest';
import { LEDGER_SCHEMA_VERSION, SEND_ANSWER, AGENT_BOT_MARK, type LedgerDoc, type LedgerEvent, type LedgerTask } from '../src/shared/ledger/contract';
import { inboxSummary, ownerInbox, type PlaceStates } from '../src/shared/ledger/inbox';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 5, 12);
const NOW = T0 + 48 * HOUR;
const BOARD = 'C:\\Users\\x\\seazone\\Donel Dev';
const OTHER = 'C:\\Users\\x\\seazone\\BizOps';
const dev = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' } as const;
const revisor = { kind: 'lugar', placeId: 'place:rev', roleId: 'revisor' } as const;
const proofs = [{ kind: 'texto', text: 'ok' }] as const;

function task(id: string, over: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id,
    projectPath: BOARD,
    title: `Tarefa ${id}`,
    request: 'Põe o botão verde',
    doneWhen: 'print',
    due: '2026-11-10',
    ownerPlaceId: 'place:dev',
    risk: 'baixo',
    state: 'aberta',
    createdAt: T0,
    events: [{ kind: 'criada', at: T0, by: { kind: 'dono' } }],
    ...over,
  };
}

const born: LedgerEvent = { kind: 'criada', at: T0, by: dev };
const delivered = (at: number): LedgerEvent => ({ kind: 'entregue', at, by: dev, proofs });
const accepted = (at: number, by: LedgerEvent['by'] = { kind: 'dono' }): LedgerEvent => ({ kind: 'aceita', at, by });
const sent = (at: number, text?: string): LedgerEvent => ({ kind: 'enviada', at, by: dev, ...(text ? { text } : {}) });
const slack = { destination: 'C123', destinationLabel: '#produto', text: 'Oi, time', reason: 'aviso' };
const letter = (id: string, events: LedgerEvent[], over: Partial<LedgerTask> = {}): LedgerTask =>
  task(id, { risk: 'alto', state: 'aceita', slack, events: [born, delivered(T0), ...events], ...over });

const doc = (...tasks: LedgerTask[]): LedgerDoc => ({ schemaVersion: LEDGER_SCHEMA_VERSION, startedAt: T0, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) });

describe('caixa "Esperando você": every kind derivable from v4, in order', () => {
  const tasks = [
    // Blocks someone: a decision, a letter to approve, a low-risk delivery stopped for a day, an orphan, a letter
    // accepted and never sent. Among them: due first, then age.
    task('decidir', { risk: 'alto', state: 'entregue', due: '2026-11-08', events: [born, delivered(T0 + 40 * HOUR)] }),
    task('aprovar', { risk: 'alto', state: 'entregue', due: '2026-11-09', slack, events: [born, delivered(T0 + 47 * HOUR)] }),
    task('parada', { state: 'entregue', due: '2026-11-09', events: [born, delivered(T0 + 10 * HOUR)] }),
    task('orfa', { state: 'em-execucao', ownerPlaceId: 'place:gone', due: '2026-11-10', events: [born, { kind: 'assumida', at: T0 + 3 * HOUR, by: dev }] }),
    letter('carta-parada', [accepted(T0 + 2 * HOUR)], { due: '2026-11-10' }),
    // Does not block: sends to check (no answer, an explicit failure, a bot post that failed), the daily sample.
    letter('sem-confirmacao', [accepted(T0 + HOUR), sent(T0 + HOUR)], { due: '2026-11-05' }),
    letter('falhou', [accepted(T0 + 3 * HOUR), sent(T0 + 3 * HOUR), sent(T0 + 3 * HOUR, `${SEND_ANSWER.failed}: canal arquivado`)], { due: '2026-11-05' }),
    task('bot', {
      state: 'aceita',
      due: '2026-11-06',
      request: `${AGENT_BOT_MARK} Mensagem no Slack para C9, por bot (post), sem carta.`,
      events: [born, { kind: 'entregue', at: T0 + 5 * HOUR, by: dev, proofs, text: `${AGENT_BOT_MARK} o envio falhou: fetch failed.` }],
    }),
    task('amostra', { state: 'aceita', due: '2026-11-07', events: [born, delivered(T0 + 20 * HOUR), accepted(T0 + 21 * HOUR, revisor)] }),

    // Out of the box.
    task('viva', { state: 'em-execucao', events: [born, { kind: 'assumida', at: T0 + HOUR, by: dev }] }),
    task('entregue-agora', { state: 'entregue', events: [born, delivered(NOW - HOUR)] }),
    task('aceita', { state: 'aceita', events: [born, delivered(T0), accepted(T0 + HOUR)] }),
    letter('confirmada', [accepted(T0 + HOUR), sent(T0 + HOUR), sent(T0 + HOUR, SEND_ANSWER.confirmed)]),
    letter('cancelada', [{ kind: 'rejeitada', at: T0 + HOUR, by: { kind: 'dono' }, text: '⟦cancelada⟧ substituída' }], { state: 'rejeitada' }),
    letter('acabou-de-sair', [accepted(NOW - 60_000), sent(NOW - 60_000)]),
    letter('aceita-agora', [accepted(NOW - 60_000)]),
    task('bot-ok', {
      state: 'aceita',
      request: `${AGENT_BOT_MARK} Mensagem no Slack para C9, por bot (post), sem carta.`,
      events: [born, { kind: 'entregue', at: T0, by: dev, proofs, text: `${AGENT_BOT_MARK} o Slack confirmou.` }],
    }),
    task('outro-quadro', { projectPath: OTHER, risk: 'alto', state: 'entregue', events: [born, delivered(T0)] }),
  ];
  const places: PlaceStates = new Map([[BOARD, new Map([['place:dev', 'trabalhando']])]]);

  it('lists each kind once, with its kind, blocking first, then due, then age', () => {
    const items = ownerInbox(doc(...tasks), BOARD, NOW, places);
    expect(items.map((item) => [item.task.id, item.kind])).toEqual([
      ['decidir', 'decidir-entrega'],
      ['parada', 'entrega-parada'],
      ['aprovar', 'aprovar-carta'],
      ['carta-parada', 'carta-parada'],
      ['orfa', 'para-repassar'],
      ['sem-confirmacao', 'conferir-envio'],
      ['falhou', 'conferir-envio'],
      ['bot', 'conferir-envio'],
      ['amostra', 'amostra-revisor'],
    ]);
    expect(inboxSummary(items)).toEqual({ total: 9, oldestSince: T0 + HOUR });
  });

  it('every board when no board is given; no orphan when the places are unknown', () => {
    const items = ownerInbox(doc(...tasks), null, NOW);
    expect(items.map((item) => item.task.id)).toContain('outro-quadro');
    expect(items.map((item) => item.task.id)).not.toContain('orfa');
  });
});
