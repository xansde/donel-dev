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

// t-66ee824e — a decision of the owner that stopped where he never looks: an andamento "precisa-do-dono", a task left
// with the Líder único, a high-risk task stopped with someone who does not do the work (a board's Líder, a service).
describe('caixa: decisão do dono parada fora de uma carta', () => {
  const lider = { kind: 'lugar', placeId: 'place:lider-q', roleId: 'lider' } as const;
  const progress = (at: number, estado: string, by: LedgerEvent['by'] = dev, precisa?: string): LedgerEvent => ({
    kind: 'comentada',
    at,
    by,
    text: `⟦andamento⟧ estado: ${estado}${precisa ? `\nprecisa: ${precisa}` : ''}`,
  });
  const tasks = [
    task('pede-o-dono', { state: 'em-execucao', events: [born, progress(NOW - HOUR, 'precisa-do-dono', dev, 'ok para apagar'), progress(NOW - 30 * 60_000, 'turno-encerrado')] }),
    task('com-o-lider-unico', { ownerPlaceId: 'lider', events: [born] }),
    task('alto-com-o-lider', { risk: 'alto', ownerPlaceId: 'place:lider-q', events: [born, { kind: 'comentada', at: T0 + HOUR, by: lider, text: 'vejo depois' }] }),
    task('alto-com-servico', { risk: 'alto', ownerPlaceId: 'servico:vigia', events: [born] }),
    // Out: a Dev doing high-risk work, a precisa-do-dono already answered, the Líder único holding it for a moment.
    task('dev-fazendo-alto', { risk: 'alto', state: 'em-execucao', events: [born, { kind: 'assumida', at: T0 + HOUR, by: dev }] }),
    task('ja-respondido', { state: 'em-execucao', events: [born, progress(NOW - 3 * HOUR, 'precisa-do-dono'), progress(NOW - HOUR, 'trabalhando')] }),
    task('de-outro-dono', { state: 'aberta', ownerPlaceId: 'place:novo', events: [born, progress(NOW - 3 * HOUR, 'precisa-do-dono'), { kind: 'criada', at: NOW - HOUR, by: lider, text: '⟦transferida de place:dev para place:novo⟧ decidido' }] }),
    task('lider-unico-agora', { ownerPlaceId: 'lider', events: [{ kind: 'criada', at: NOW - 30 * 60_000, by: { kind: 'dono' } }] }),
  ];

  it('enters the box as a blocking item with why, and pushes like any other', () => {
    const items = ownerInbox(doc(...tasks), BOARD, NOW, new Map([[BOARD, new Map([['place:dev', 'trabalhando'], ['place:lider-q', 'trabalhando'], ['place:novo', 'trabalhando']])]]));
    expect(Object.fromEntries(items.map((item) => [item.task.id, item.kind]))).toEqual({
      'pede-o-dono': 'decisao-parada',
      'com-o-lider-unico': 'decisao-parada',
      'alto-com-o-lider': 'decisao-parada',
      'alto-com-servico': 'decisao-parada',
    });
    expect(items.every((item) => item.blocks)).toBe(true);
    expect(items.find((item) => item.task.id === 'pede-o-dono')!.why).toContain('ok para apagar');
  });
});
