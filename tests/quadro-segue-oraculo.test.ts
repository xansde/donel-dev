// Quadro de tarefas (t-8406f473, recado r-a01b8ca6 do Líder único, 20/11): o cartão de uma tarefa do Oráculo segue a
// tarefa. O que quebra sem o dono perceber: o cartão preso com o dono antigo (a sessão que recebeu a tarefa não consegue
// mover o cartão: "o cartão é de lider"), o cartão de tarefa aceita ou cancelada parado em A fazer para sempre, e uma
// ronda que regrava o mesmo cartão a cada 15 min (versão subindo à toa quebra o compare-and-swap de quem leu o cartão).
//
// As fixtures são os 8 casos reais de 20/11 (board.sqlite e ledger.sqlite da VPS, lidos só leitura): os campos que a
// regra lê, com o texto do pedido trocado por um genérico.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LedgerActor, LedgerEvent, LedgerTask } from '../src/shared/ledger/contract';
import { planTaskFollow, ORACULO_ACTOR, type FollowCard } from '../src/shared/board/task-follow';
import { planVigia, type CronCard } from '../src/shared/board/cron';
import { createBoardSqlite, type BoardSqliteStore } from '../src/oraculo/board-sqlite';
import { applyOracleSync, planOracleSync } from '../src/board-cron/segue-oraculo';
import { SEED_ACTOR } from '../src/board-cron/semente';

const dirs: string[] = [];
const stores: BoardSqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEV = 'session:4457731e-e13f-42a9-ac15-a9ac9c6db0a2';
const DEV_SID = '4457731e-e13f-42a9-ac15-a9ac9c6db0a2';
const REVISOR: LedgerActor = { kind: 'lugar', placeId: 'session:9bddc486-4f2c-48d4-9af6-d5045f59a734', roleId: 'revisor' };
const LIDER: LedgerActor = { kind: 'lugar', placeId: 'lider', roleId: 'lider' };
const DEV_ACTOR: LedgerActor = { kind: 'lugar', placeId: DEV, roleId: 'dev' };
const OLD_PLACE = 'place:bb9bfae3-65bd-428e-9574-700bbcbcdd38';
const at = (iso: string): number => Date.parse(iso);
/** The seed ran at 11:42 UTC of 20/11; the round runs after the last event. */
const SEEDED = at('2026-11-20T11:42:14.576Z');
const NOW = at('2026-11-20T20:00:00Z');

const ev = (kind: LedgerEvent['kind'], iso: string, by: LedgerActor, text?: string): LedgerEvent => ({ kind, at: at(iso), by, ...(text ? { text } : {}) });
const transfer = (iso: string, from: string, to: string, why: string, by: LedgerActor = LIDER): LedgerEvent => ev('criada', iso, by, `⟦transferida de ${from} para ${to}⟧ ${why}`);

function task(id: string, state: LedgerTask['state'], ownerPlaceId: string, events: LedgerEvent[]): LedgerTask {
  return { id, projectPath: 'C:\\Users\\dono\\seazone\\Donel Dev', title: `tarefa ${id}`, request: 'pedido genérico', doneWhen: 'critério', due: '2026-11-21', ownerPlaceId, risk: 'baixo', state, createdAt: events[0]!.at, events };
}

/** The 5 accepted ones: transferred by the Líder to the Dev at 15:53, assumed, delivered and accepted by the Revisor. */
const accepted = (id: string, acceptedAt: string): LedgerTask =>
  task(id, 'aceita', DEV, [
    ev('criada', '2026-11-16T17:51:26.760Z', { kind: 'lugar', placeId: OLD_PLACE, roleId: 'lider' }, '⟦pedido por dono⟧'),
    transfer('2026-11-17T20:26:21.149Z', OLD_PLACE, 'lider', 'passada sozinha', { kind: 'lugar', placeId: OLD_PLACE }),
    transfer('2026-11-20T15:53:00.344Z', 'lider', DEV, 'Backlog real da faixa preta'),
    ev('assumida', '2026-11-20T15:56:07.822Z', DEV_ACTOR),
    ev('entregue', '2026-11-20T16:45:33.135Z', DEV_ACTOR, 'feito'),
    ev('aceita', acceptedAt, REVISOR),
  ]);

/** The real cards (board.sqlite) and their tasks (ledger.sqlite), 20/11. */
const CASES = [
  { card: 'c-c4ff0a43a0ce', task: accepted('t-f3e944ae', '2026-11-20T16:49:37.903Z') },
  {
    card: 'c-120e625f43b0',
    // delivered, sent back by the Revisor, redone and accepted
    task: task('t-c1b710c2', 'aceita', DEV, [
      ev('criada', '2026-11-17T18:48:28.622Z', { kind: 'lugar', placeId: 'place:d652c7e6-6fdd-4bde-813b-6ea16422dc88', roleId: 'dev' }, '⟦pedido por Revisor 0abd7b62⟧'),
      transfer('2026-11-18T06:05:16.096Z', 'place:d652c7e6-6fdd-4bde-813b-6ea16422dc88', 'lider', 'Reconciliador: o lugar dono fechou', { kind: 'lugar', placeId: 'servico:reconciliador', roleId: 'servico' }),
      transfer('2026-11-20T15:53:03.947Z', 'lider', DEV, 'Backlog real da faixa preta'),
      ev('assumida', '2026-11-20T15:56:09.878Z', DEV_ACTOR),
      ev('entregue', '2026-11-20T16:51:23.552Z', DEV_ACTOR, 'PR mesclado'),
      ev('rejeitada', '2026-11-20T16:54:56.787Z', REVISOR, 'falha no caso combinado'),
      ev('assumida', '2026-11-20T17:12:14.718Z', DEV_ACTOR),
      ev('entregue', '2026-11-20T17:12:21.710Z', DEV_ACTOR, 'corrigida a devolução'),
      ev('aceita', '2026-11-20T17:12:47.193Z', REVISOR),
    ]),
  },
  { card: 'c-4e594170cc26', task: accepted('t-6ee72efc', '2026-11-20T17:49:49.938Z') },
  { card: 'c-4c4360532904', task: accepted('t-b9877007', '2026-11-20T17:52:48.608Z') },
  { card: 'c-bae5a79c7919', task: accepted('t-4beea80e', '2026-11-20T17:50:55.290Z') },
  {
    card: 'c-71b7620fa906',
    // a duplicate: cancelled by the Líder while it was his
    task: task('t-99300c4f', 'rejeitada', 'lider', [
      ev('criada', '2026-11-17T20:40:40.498Z', { kind: 'lugar', placeId: 'place:0abd7b62-be80-4634-af72-01b906d792bd', roleId: 'revisor' }, '⟦pedido por Revisor 0abd7b62⟧'),
      transfer('2026-11-18T06:05:12.317Z', 'place:d652c7e6-6fdd-4bde-813b-6ea16422dc88', 'lider', 'Reconciliador', { kind: 'lugar', placeId: 'servico:reconciliador', roleId: 'servico' }),
      ev('rejeitada', '2026-11-20T17:13:40.568Z', LIDER, '⟦cancelada⟧ Duplicada: é a mesma tarefa da t-6b1fc5e0 (vigia de saída não derruba o editor)'),
    ]),
  },
  {
    card: 'c-9475a4063daf',
    // the Dev's, assumed and waiting (andamento "esperando")
    task: task('t-6b1fc5e0', 'em-execucao', DEV, [
      ev('criada', '2026-11-17T20:45:42.602Z', { kind: 'lugar', placeId: 'place:d652c7e6-6fdd-4bde-813b-6ea16422dc88', roleId: 'dev' }),
      transfer('2026-11-18T06:05:12.753Z', 'place:d652c7e6-6fdd-4bde-813b-6ea16422dc88', 'lider', 'Reconciliador', { kind: 'lugar', placeId: 'servico:reconciliador', roleId: 'servico' }),
      transfer('2026-11-20T17:13:38.227Z', 'lider', DEV, 'Backlog real (faixa preta)'),
      ev('assumida', '2026-11-20T17:13:51.492Z', DEV_ACTOR),
      ev('comentada', '2026-11-20T17:56:51.932Z', DEV_ACTOR, '⟦andamento⟧ estado: esperando precisa: PC ligado'),
    ]),
  },
  {
    card: 'c-186a4798c61b',
    task: task('t-b3f48bf5', 'em-execucao', DEV, [
      ev('criada', '2026-11-17T12:49:32.388Z', LIDER, '⟦pedido por dono⟧'),
      transfer('2026-11-17T20:26:29.539Z', OLD_PLACE, 'lider', 'passada sozinha', { kind: 'lugar', placeId: OLD_PLACE }),
      transfer('2026-11-20T17:13:39.600Z', 'lider', DEV, 'Backlog real (faixa preta)'),
      ev('assumida', '2026-11-20T17:51:03.487Z', DEV_ACTOR),
      ev('comentada', '2026-11-20T19:31:23.655Z', DEV_ACTOR, '⟦andamento⟧ estado: esperando precisa: Dono escolher a direção'),
    ]),
  },
] as const;

const TASKS = new Map<string, LedgerTask>(CASES.map(({ task: t }) => [t.id, t]));
/** The session resolver of the round: the Dev's place is held by its session, alive here. */
const sessionOf = (_project: string, place: string): string | undefined => (place === DEV ? DEV_SID : undefined);

/** As the seed left them: A fazer, place `lider` (the owner at 11:42), no session, version 2. */
const seeded = (taskId: string, id = 'c-x'): FollowCard => ({ id, projectId: 'donel-dev', stage: 'todo', stageSince: SEEDED, placeId: 'lider', sessionId: null, version: 2, oraculoId: taskId });

describe('o cartão segue a tarefa do Oráculo (função pura)', () => {
  it('as 5 aceitas vão a Feito "aceita no Oráculo", com o dono da tarefa como lugar', () => {
    for (const { card, task: t } of CASES.filter((c) => c.task.state === 'aceita')) {
      expect(planTaskFollow(seeded(t.id, card), t, sessionOf), card).toMatchObject({ cardId: card, from: 'todo', to: 'done', place: DEV, doneSummary: 'aceita no Oráculo', expectedVersion: 2 });
    }
  });

  it('a cancelada vai a Feito com o motivo: o quadro não tem coluna Cancelado', () => {
    const t = TASKS.get('t-99300c4f')!;
    const step = planTaskFollow(seeded(t.id, 'c-71b7620fa906'), t, sessionOf);
    expect(step).toMatchObject({ to: 'done', place: 'lider' });
    expect(step!.doneSummary).toMatch(/^cancelada no Oráculo: Duplicada: é a mesma tarefa da t-6b1fc5e0/);
    expect(step!.note).toBe(step!.doneSummary);
  });

  it('as 2 em espera do Dev: o cartão passa a ele, em Fazendo, com a sessão dele', () => {
    for (const id of ['t-6b1fc5e0', 't-b3f48bf5']) {
      const step = planTaskFollow(seeded(id), TASKS.get(id)!, sessionOf);
      expect(step).toMatchObject({ from: 'todo', to: 'doing', fromPlace: 'lider', place: DEV, session: DEV_SID });
      expect(step!.note).toBe(`assumida no Oráculo · dono da tarefa: ${DEV}`);
    }
  });

  it('nada a mudar = nada (sem versão subindo a cada ronda); sem oraculo_id ou sem a tarefa, nunca mexe', () => {
    const t = TASKS.get('t-6b1fc5e0')!;
    expect(planTaskFollow({ ...seeded(t.id), stage: 'doing', placeId: DEV, sessionId: DEV_SID }, t, sessionOf)).toBeNull();
    expect(planTaskFollow({ ...seeded(t.id), stage: 'done' }, TASKS.get('t-f3e944ae')!, sessionOf)).toBeNull();
    expect(planTaskFollow({ ...seeded(t.id), oraculoId: null }, t, sessionOf)).toBeNull();
    expect(planTaskFollow(seeded('t-nao-existe'), undefined, sessionOf)).toBeNull();
  });

  it('transferida e ainda não assumida: sai de Fazendo do dono antigo para A fazer do novo; Travado e Esperando você ficam', () => {
    const open = task('t-a', 'aberta', 'place:novo', [ev('criada', '2026-11-20T10:00:00Z', LIDER), transfer('2026-11-20T13:00:00Z', 'place:velho', 'place:novo', 'outro faz')]);
    const card = { ...seeded('t-a'), stage: 'doing' as const, placeId: 'place:velho', sessionId: 'aaaaaaaa-1111' };
    expect(planTaskFollow(card, open)).toMatchObject({ to: 'todo', place: 'place:novo', note: 'aberta no Oráculo, falta assumir · dono da tarefa: place:novo' });
    expect(planTaskFollow(card, open)!.session).toBeUndefined();
    expect(planTaskFollow({ ...card, stage: 'waiting_owner' }, open)).toMatchObject({ to: 'waiting_owner', place: 'place:novo' });
  });

  it('devolvida (rejeitada viva): Feito reabre em A fazer só se a devolução veio depois; Fazendo fica', () => {
    const back = task('t-b', 'rejeitada', DEV, [ev('criada', '2026-11-20T10:00:00Z', LIDER), ev('entregue', '2026-11-20T14:00:00Z', DEV_ACTOR), ev('rejeitada', '2026-11-20T15:00:00Z', REVISOR, 'falta o teste')]);
    const done = { ...seeded('t-b'), stage: 'done' as const, placeId: DEV, sessionId: DEV_SID, stageSince: at('2026-11-20T14:30:00Z') };
    expect(planTaskFollow(done, back)).toMatchObject({ to: 'todo', note: 'devolvida no Oráculo: falta o teste', session: DEV_SID });
    expect(planTaskFollow({ ...done, stageSince: at('2026-11-20T16:00:00Z') }, back)).toBeNull();
    expect(planTaskFollow({ ...done, stage: 'doing' }, back)).toBeNull();
  });
});

describe('o vigia não manda mais o Líder "mover para Feito"', () => {
  it('tarefa fechada no Oráculo e cartão em Fazendo: o vigia pula (a ronda já fecha o cartão)', () => {
    const card: CronCard = { id: 'c-1', projectId: 'donel-dev', stage: 'doing', stageSince: NOW - 3600_000, placeId: DEV, version: 3, title: 't', sessionId: DEV_SID, wokenAt: null, chargedAt: null, chargeCount: 0, leaderNoticedAt: null, justifiedAt: null, desk: { state: 'aceita', closed: true } };
    expect(planVigia(card, { alive: true, idleSince: NOW - 3600_000, cards: true }, [], NOW)).toMatchObject({ do: 'skip' });
  });
});

describe('a ressincronização no quadro em SQLite, com os 8 casos reais', () => {
  async function seededBoard(): Promise<{ store: BoardSqliteStore; ids: Map<string, string> }> {
    const dir = mkdtempSync(join(tmpdir(), 'quadro-segue-'));
    dirs.push(dir);
    const store = createBoardSqlite(join(dir, 'board.sqlite'), { now: () => NOW });
    stores.push(store);
    await store.upsertProject({ id: 'donel-dev', name: 'Donel Dev', aliases: ['/home/u/seazone/Donel Dev'] });
    const ids = new Map<string, string>();
    for (const { card: real, task: t } of CASES) {
      // as runSeed did: born in A fazer with the owner of 11:42 (lider), then its import move
      const born = await store.createCard({ p_project_id: 'donel-dev', p_title: `cartão ${real}`, p_owner_request: 'pedido genérico', p_requested_by: 'dono', p_actor: SEED_ACTOR, p_client_ref: `oraculo:${t.id}`, p_stage: 'todo', p_oraculo_id: t.id, p_place_id: 'lider', p_as_leader: true });
      const moved = await store.moveCard({ p_card_id: born.id, p_to: 'todo', p_actor: SEED_ACTOR, p_expected_version: 1, p_note: 'importado do Oráculo', p_as_leader: true });
      expect(moved).toMatchObject({ stage: 'todo', place_id: 'lider', session_id: null, version: 2 });
      ids.set(t.id, born.id);
    }
    return { store, ids };
  }

  const blockMove = (cardId: string, version: number) => ({
    p_card_id: cardId,
    p_to: 'blocked' as const,
    p_actor: DEV,
    p_expected_version: version,
    p_justification: 'esperando o PC ligar',
    p_justification_link: 'https://example.com/fio',
    p_justification_due: new Date(NOW + 3600_000).toISOString(),
  });

  it('antes: o card_move do Dev é recusado ("o cartão é de lider"); depois: 5 em Feito, 1 cancelada, 2 dele em Fazendo, e ele move', async () => {
    const { store, ids } = await seededBoard();
    const waiting = ids.get('t-6b1fc5e0')!;
    await expect(store.moveCard(blockMove(waiting, 2))).rejects.toThrow('o cartão é de lider');

    const steps = planOracleSync(await store.cardsWithTask(), TASKS, sessionOf);
    expect(steps).toHaveLength(8);
    const lines: string[] = [];
    expect(await applyOracleSync(store, steps, (line) => lines.push(line))).toEqual({ applied: 8, failed: 0 });
    expect(lines).toHaveLength(8);

    for (const id of ['t-f3e944ae', 't-c1b710c2', 't-6ee72efc', 't-b9877007', 't-4beea80e']) {
      expect(await store.getCard(ids.get(id)!), id).toMatchObject({ stage: 'done', done_summary: 'aceita no Oráculo', place_id: DEV, version: 3 });
    }
    const cancelled = await store.getCard(ids.get('t-99300c4f')!);
    expect(cancelled).toMatchObject({ stage: 'done', place_id: 'lider', version: 3 });
    expect(cancelled!.done_summary).toMatch(/^cancelada no Oráculo: Duplicada/);
    for (const id of ['t-6b1fc5e0', 't-b3f48bf5']) {
      expect(await store.getCard(ids.get(id)!), id).toMatchObject({ stage: 'doing', place_id: DEV, session_id: DEV_SID, version: 3, note: `assumida no Oráculo · dono da tarefa: ${DEV}` });
    }

    // the Dev moves his own card now
    expect(await store.moveCard(blockMove(waiting, 3))).toMatchObject({ stage: 'blocked', place_id: DEV, version: 4 });
  });

  it('o movimento fica no andamento como servico:oraculo, e uma segunda passada não muda nada', async () => {
    const { store, ids } = await seededBoard();
    await applyOracleSync(store, planOracleSync(await store.cardsWithTask(), TASKS, sessionOf), () => undefined);
    const again = planOracleSync(await store.cardsWithTask(), TASKS, sessionOf);
    expect(again).toEqual([]);
    for (const id of ids.values()) expect((await store.getCard(id))!.version).toBe(3);
    const feed = await store.ownerFeed(0);
    expect(feed.filter((row) => row.to_stage === 'done')).toHaveLength(6);
    expect(ORACULO_ACTOR).toBe('servico:oraculo');
  });

  it('o cartão que mudou entre a leitura e a escrita não é sobrescrito (compare-and-swap); a próxima ronda resolve', async () => {
    const { store, ids } = await seededBoard();
    const steps = planOracleSync(await store.cardsWithTask(), TASKS, sessionOf);
    const raced = ids.get('t-b3f48bf5')!;
    await store.moveCard({ p_card_id: raced, p_to: 'doing', p_actor: 'lider', p_expected_version: 2, p_place_id: 'place:outro', p_as_leader: true });
    const result = await applyOracleSync(store, steps, () => undefined);
    expect(result).toEqual({ applied: 7, failed: 1 });
    expect(await store.getCard(raced)).toMatchObject({ place_id: 'place:outro', version: 3 });
    await applyOracleSync(store, planOracleSync(await store.cardsWithTask(), TASKS, sessionOf), () => undefined);
    expect(await store.getCard(raced)).toMatchObject({ stage: 'doing', place_id: DEV, session_id: DEV_SID, version: 4 });
  });
});
