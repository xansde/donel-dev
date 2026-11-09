// Livro — F5 (faxina por lançamento) e F7 (pedidos repetidos e tarefa-pai), só simulação (docs/planos/ledger-bom.md).
// Guarded here: the cleanup proposes a destination with a reason for EVERY orphan, stale delivery and old open task,
// never closes a high-risk task by itself, never touches the input, and the repeat detector groups the same request of
// the same board inside the window with the oldest as root.

import { describe, expect, it } from 'vitest';
import { LEADER_OF_BOARD, simularFaxina, type FaxinaView } from '../src/shared/ledger/faxina-simulada';
import { repeatGroups, type PedidoView } from '../src/shared/ledger/repetidas';
import { viewsFromListing } from '../src/shared/ledger/simulacao-entrada';
import type { LedgerDoc } from '../src/shared/ledger/contract';

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 10, 9, 1, 0);

const pedido = (id: string, request: string, createdAt: number | null, board: string | null = '/p/atlas'): PedidoView => ({ id, board, request, createdAt });

describe('F7 — pedidos repetidos e tarefa-pai', () => {
  it('five copies of one request become one root (the oldest) and four children, whatever the input order', () => {
    const text = 'Preciso rodar esse processo na nossa nova VPS e não no servidor antigo';
    const items = [3, 1, 4, 0, 2].map((n) => pedido(`t-${n}`, text, NOW - 10 * H + n * H));
    const groups = repeatGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.root).toBe('t-0');
    expect([...groups[0]!.children].sort()).toEqual(['t-1', 't-2', 't-3', 't-4']);
    expect(groups[0]!.sameText).toBe(true);
  });

  it('a request that only differs in case, accents, punctuation or after its long head is the same request', () => {
    const head = 'Lucas Araújo, DM, 05/11/2026 15:58 — «O PR já está pronto para revisão, ' + 'com as telas conferidas uma a uma e o banco de teste montado, '.repeat(4);
    const groups = repeatGroups([
      pedido('t-a', `${head} Se até lá eu não tiver retorno, sigo com o merge.`, NOW - 5 * H),
      pedido('t-b', `${head.toUpperCase().replace(/á/g, 'a')} Qualquer dificuldade, me fala.`, NOW - 4 * H),
      pedido('t-c', 'Lucas Araujo, DM, outro assunto curto', NOW - 3 * H),
    ]);
    expect(groups).toEqual([{ root: 't-a', children: ['t-b'], board: '/p/atlas', sameText: false }]);
  });

  it('another board or more than 72 h after the root is not the same request; an unknown board can join', () => {
    const text = 'Arruma o aviso que some do celular';
    const groups = repeatGroups([
      pedido('t-1', text, NOW - 10 * DAY),
      pedido('t-2', text, NOW - 2 * DAY),
      pedido('t-3', text, NOW - 2 * DAY - H, '/p/beacon'),
      pedido('t-4', text, null, null),
    ]);
    expect(groups).toEqual([{ root: 't-2', children: ['t-4'], board: '/p/atlas', sameText: true }]);
  });
});

const view = (id: string, over: Partial<FaxinaView> = {}): FaxinaView => ({
  id,
  board: '/p/atlas',
  request: `pedido único ${id}`,
  createdAt: NOW - 5 * DAY,
  state: 'aberta',
  closed: false,
  orphan: false,
  risk: 'baixo',
  ownerPlaceId: `place:${id}`,
  lastWorkAt: NOW - 5 * DAY,
  slack: false,
  ...over,
});

describe('F5 — faxina por lançamento (simulação)', () => {
  const items: FaxinaView[] = [
    view('raiz-viva', { request: 'pedido repetido', createdAt: NOW - 3 * H, lastWorkAt: NOW - 3 * H, state: 'em-execucao' }),
    view('repetida', { request: 'pedido repetido', createdAt: NOW - 2 * H, lastWorkAt: NOW - 2 * H, orphan: true }),
    view('raiz-feita', { request: 'pedido feito', createdAt: NOW - 3 * DAY, state: 'aceita', closed: true }),
    view('repetida-de-feita', { request: 'pedido feito', createdAt: NOW - 3 * DAY + H, orphan: true }),
    view('repetida-em-execucao', { request: 'pedido feito', createdAt: NOW - 3 * DAY + 2 * H, orphan: true, state: 'em-execucao' }),
    view('raiz-cancelada', { request: 'pedido trocado', createdAt: NOW - 4 * H, state: 'cancelada', closed: true }),
    view('repetida-de-cancelada', { request: 'pedido trocado', createdAt: NOW - 3 * H, lastWorkAt: NOW - 3 * H, orphan: true }),
    view('orfa-velha', { orphan: true }),
    view('orfa-velha-alto', { orphan: true, risk: 'alto' }),
    view('orfa-em-execucao', { orphan: true, state: 'em-execucao' }),
    view('orfa-nova', { orphan: true, lastWorkAt: NOW - 2 * H, createdAt: NOW - 2 * H, board: '/p/sem-acima' }),
    view('entregue-parada', { state: 'entregue', lastWorkAt: NOW - 30 * H }),
    view('entregue-recente', { state: 'entregue', lastWorkAt: NOW - 2 * H }),
    view('aberta-velha', { lastWorkAt: NOW - 3 * DAY }),
    view('aberta-recente', { lastWorkAt: NOW - 2 * H, createdAt: NOW - 2 * H }),
    view('fechada', { state: 'cancelada', closed: true, orphan: false }),
  ].map((item) => Object.freeze(item));
  const above = (item: FaxinaView): string | null => (item.board === '/p/atlas' ? 'place:acima' : null);
  const result = simularFaxina(Object.freeze(items), { now: NOW, abovePlace: above });
  const byId = new Map(result.propostas.map((p) => [p.id, p]));

  it('every orphan, delivered and open task has exactly one destination or one reason to stay; closed ones never', () => {
    const seen = [...result.propostas.map((p) => p.id), ...result.ficam.map((f) => f.id)];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(items.filter((i) => !i.closed && (i.orphan || i.state === 'entregue' || i.state === 'aberta')).map((i) => i.id).sort());
    expect(result.ficam.map((f) => f.id).sort()).toEqual(['aberta-recente', 'entregue-recente']);
    for (const p of result.propostas) expect(p.motivo.length).toBeGreaterThan(10);
    expect(result.contagens).toMatchObject({ orfas: 8, entregues: 2, abertas: 8, abertasOrfas: 6, abertasVelhas: 1, abertasRecentes: 1 });
  });

  it('a repeated request joins its live root; a repeat of an accepted one is archived unless in progress', () => {
    expect(byId.get('repetida')).toMatchObject({ categoria: 'orfa', destino: 'juntar', para: 'raiz-viva', lancamento: { tipo: 'agrupar', tarefa: 'repetida', dados: { pai: 'raiz-viva' }, chave: 'faxina:repetida:juntar:2026-11-09' } });
    expect(byId.get('repetida-de-feita')).toMatchObject({ destino: 'arquivar', lancamento: { tipo: 'cancelar' } });
    expect(byId.get('repetida-de-feita')!.motivo).toContain('raiz-feita');
    expect(byId.get('repetida-em-execucao')).toMatchObject({ destino: 'juntar', para: 'raiz-feita' });
    expect(byId.get('repetida-de-cancelada')).toMatchObject({ destino: 'repassar', para: 'place:acima' });
  });

  it('an old low-risk orphan is archived by age; high risk and work in progress are never archived by themselves', () => {
    expect(byId.get('orfa-velha')).toMatchObject({ destino: 'arquivar', lancamento: { tipo: 'cancelar' } });
    expect(byId.get('orfa-velha')!.motivo).toMatch(/5 dias/);
    expect(byId.get('orfa-velha-alto')).toMatchObject({ destino: 'repassar', para: 'place:acima', lancamento: { tipo: 'transferir', dados: { to: 'place:acima' } } });
    expect(byId.get('orfa-em-execucao')).toMatchObject({ destino: 'repassar', para: 'place:acima' });
    expect(byId.get('orfa-nova')).toMatchObject({ destino: 'devolver-ao-lider', para: LEADER_OF_BOARD });
  });

  it('a stale delivery and an old open task go back to the Líder of the board', () => {
    expect(byId.get('entregue-parada')).toMatchObject({ categoria: 'entregue-parada', destino: 'devolver-ao-lider', para: LEADER_OF_BOARD });
    expect(byId.get('aberta-velha')).toMatchObject({ categoria: 'aberta-velha', destino: 'devolver-ao-lider' });
  });
});

describe('entrada da simulação — a lista do dia com a cópia v4', () => {
  it('takes board and dates from the copy, the orphan mark from the list, and a lower bound for tasks born after it', () => {
    const copyAt = NOW - 30 * H;
    const copy = {
      schemaVersion: 4,
      startedAt: copyAt - DAY,
      tasks: {
        't-velha': {
          id: 't-velha', projectPath: '/p/atlas', request: 'r', doneWhen: 'd', due: '2026-11-07', ownerPlaceId: 'place:x', risk: 'baixo', state: 'aberta',
          createdAt: copyAt - DAY, events: [{ kind: 'criada', at: copyAt - DAY, by: { kind: 'dono' } }],
        },
      },
    } as unknown as LedgerDoc;
    const listing = {
      tarefas: [
        { id: 't-velha', estado: 'aberta', pedido: 'r', dono: 'place:x', risco: 'baixo', orfa: 'o lugar dono está fechado' },
        { id: 't-nova', estado: 'entregue', pedido: 'n', dono: 'place:y', risco: 'alto', entrega: { em: new Date(NOW - 3 * H).toISOString() } },
        { id: 't-carta', estado: 'rejeitada', pedido: 'c', dono: 'place:z', risco: 'baixo', cartaSlack: { destino: 'D1' } },
      ],
    };
    const views = viewsFromListing(listing, copy);
    expect(views[0]).toMatchObject({ id: 't-velha', board: '/p/atlas', createdAt: copyAt - DAY, lastWorkAt: copyAt - DAY, orphan: true, closed: false });
    expect(views[1]).toMatchObject({ id: 't-nova', board: null, createdAt: null, lastWorkAt: NOW - 3 * H, orphan: false, risk: 'alto' });
    expect(views[2]).toMatchObject({ closed: true, slack: true });
  });
});
