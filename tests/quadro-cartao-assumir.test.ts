// Quadro de tarefas (t-1e354d15, t-8406f473 PR 1) — the `tarefa_assumir` answered at the daemon's gate opens the task's
// card in Fazendo, tied to the session. What breaks without the owner noticing: a second card for the same task (a
// repeated assumir, or a card the seed already imported), the card under the wrong place or with no session (the vigia
// would wake nobody), and a board error changing the assumir's answer that scripts parse (the despertador).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerService } from '../src/main/ledger-store';
import { createGateHandler, type GateDeps } from '../src/oraculo/portao';
import { createOracleApiHandler } from '../src/oraculo/api';
import { createGateToolRoutes, readGateHashes } from '../src/oraculo/portoes';
import { createSatelliteLedger, createSatelliteTaskMemory, type SatellitePost } from '../src/oraculo/satelite';
import { BoardError, type BoardStore } from '../src/oraculo/board-client';
import { createBoardSqlite, type BoardSqliteStore } from '../src/oraculo/board-sqlite';
import type { MindscapeBoard } from '../src/shared/mindscape/model';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const stores: BoardSqliteStore[] = [];
const SID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'd'.repeat(43);
const PROJECT = '/home/dono/seazone/atlas';
const ME = 'place:dev-vps';
const CONVERSA = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

const BOARD: MindscapeBoard = {
  projectPath: PROJECT,
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: {
    'place:lider': { kind: 'session', id: 'place:lider', previous: [], roleId: 'lider', x: 0, y: 0 },
    [ME]: { kind: 'session', id: ME, previous: [], roleId: 'dev', sessionId: CONVERSA, x: 0, y: 0, by: 'session' },
  },
  links: [{ id: 'l>d', from: 'place:lider', to: ME, arrow: true, by: 'session', opened: true }],
  drawings: [],
};

/**
 * The entregador apart (runEntregador with no `junto`, production's mode): this process has no ledger; the tasks go to
 * the registro's gate route (createSatelliteLedger), which answers with the task the call left (`taskOf`).
 */
function apart(ledger: LedgerService): Pick<GateDeps, 'ledger' | 'runLedger' | 'taskOf'> {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-assumir-registro-'));
  dirs.push(dir);
  const gateToken = 'g'.repeat(64);
  mkdirSync(join(dir, 'portoes'));
  writeFileSync(join(dir, 'portoes', 'entregador.sha256'), `${createHash('sha256').update(gateToken).digest('hex')}\n`);
  const api = createOracleApiHandler({ ledger, ledgerFile: join(dir, 'ledger.json'), tokenHash: () => 'x', gates: () => readGateHashes(dir), gateRoutes: createGateToolRoutes({ ledger: () => ledger }) });
  const post = async (url: string, token: string, body: string): Promise<SatellitePost> => {
    const answer = await api({ method: 'POST', url: new URL(url).pathname, body, authorization: `Bearer ${token}` });
    return { status: answer.status, body: answer.body as string };
  };
  const tasks = createSatelliteTaskMemory();
  return {
    ledger: () => {
      throw new Error('o entregador não tem registro');
    },
    runLedger: createSatelliteLedger({ url: 'http://registro:47816', token: () => gateToken, post, onTask: tasks.remember }),
    taskOf: tasks.taskOf,
  };
}

function setup(cards: () => BoardStore | null, mode: 'junto' | 'apart' = 'junto') {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-assumir-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  mkdirSync(join(sessions, SID), { recursive: true });
  writeFileSync(join(sessions, SID, 'meta.json'), JSON.stringify({ sid: SID, mcpToken: TOKEN, mcpPort: 25710 }));
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs });
  const separate = mode === 'apart' ? apart(ledger) : null;
  const picture = {
    at: Date.UTC(2026, 10, 20, 11),
    sessoes: {
      [SID]: {
        quemSou: { nome: 'Dev · atlas', projeto: 'atlas', pasta: PROJECT, lugar: ME, papel: 'dev', roda: 'VPS' },
        listar: [
          { id: ME, papel: 'dev', estado: 'trabalhando' },
          { id: 'place:lider', papel: 'lider', estado: 'parada' },
        ],
        board: BOARD,
      },
    },
  };
  const ledgerAnswers: string[] = [];
  const logs: string[] = [];
  const handle = createGateHandler({
    sessionsDir: sessions,
    ledger: separate ? separate.ledger : () => ledger,
    ...(separate?.taskOf ? { taskOf: separate.taskOf } : {}),
    picture: () => picture,
    forward: async () => 'desligado',
    serverVersion: 'teste',
    cards,
    runLedger: async (caller, call, context) => {
      const answer = separate ? await separate.runLedger!(caller, call, context) : await runLedgerTool(ledger, caller, call);
      ledgerAnswers.push(answer.text);
      return answer;
    },
    log: (line) => void logs.push(line),
  });
  const tool = async (name: string, args: unknown) => {
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const result = (JSON.parse(res.body) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { error: result.isError === true, text: result.content[0]!.text };
  };
  const newTask = async (): Promise<string> => {
    const created = await tool('tarefa_criar', { titulo: 'Cartão no assumir', pedido: 'abre o cartão sozinho', criterio: 'x', prazo: '2026-11-23', risco: 'baixo' });
    expect(created.error).toBe(false);
    return (JSON.parse(created.text) as { id: string }).id;
  };
  return { tool, newTask, ledgerAnswers, logs };
}

async function board(): Promise<BoardSqliteStore> {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-assumir-board-'));
  dirs.push(dir);
  const store = createBoardSqlite(join(dir, 'board.sqlite'));
  stores.push(store);
  await store.upsertProject({ id: 'atlas', name: 'atlas', aliases: [PROJECT] });
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tarefa_assumir abre o cartão da tarefa', () => {
  it('cria o cartão em Fazendo com o lugar, a conversa, o oraculo_id e o client_ref; repetir não duplica', async () => {
    const store = await board();
    const g = setup(() => store);
    const id = await g.newTask();
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    await vi.waitFor(async () => expect((await store.cardByClientRef(`oraculo:${id}`))?.stage).toBe('doing'));
    expect(await store.cardByClientRef(`oraculo:${id}`)).toMatchObject({ project_id: 'atlas', place_id: ME, session_id: CONVERSA, oraculo_id: id, title: 'Cartão no assumir' });

    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.listCards('atlas', { includeDone: true })).toHaveLength(1);
  });

  it('no entregador separado (sem registro no processo) o cartão nasce igual, com a tarefa que a rota do registro devolveu', async () => {
    const store = await board();
    const g = setup(() => store, 'apart');
    const id = await g.newTask();
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    await vi.waitFor(async () => expect((await store.cardByClientRef(`oraculo:${id}`))?.stage).toBe('doing'));
    expect(await store.cardByClientRef(`oraculo:${id}`)).toMatchObject({ place_id: ME, session_id: CONVERSA, oraculo_id: id, title: 'Cartão no assumir' });
    expect(g.logs.filter((line) => line.includes('não abriu'))).toEqual([]);
  });

  it('o cartão já em Fazendo do lugar, com a conversa antiga (lugar renovado), passa para a conversa de agora', async () => {
    const store = await board();
    const g = setup(() => store);
    const id = await g.newTask();
    const old = await store.createCard({
      p_project_id: 'atlas',
      p_title: 'antigo',
      p_owner_request: 'abre o cartão sozinho',
      p_requested_by: 'dono',
      p_actor: 'servico:semente',
      p_client_ref: `oraculo:${id}`,
      p_stage: 'todo',
      p_place_id: ME,
      p_oraculo_id: id,
      p_as_leader: true,
    });
    const ANTIGA = '00000000-aaaa-4bbb-8ccc-000000000000';
    await store.moveCard({ p_card_id: old.id, p_to: 'doing', p_actor: ME, p_expected_version: old.version, p_session_id: ANTIGA });
    expect((await store.getCard(old.id))?.session_id).toBe(ANTIGA);
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    await vi.waitFor(async () => expect((await store.getCard(old.id))?.session_id).toBe(CONVERSA));
    expect(await store.getCard(old.id)).toMatchObject({ stage: 'doing', place_id: ME });
    expect(await store.listCards('atlas', { includeDone: true })).toHaveLength(1);
  });

  it('o cartão que a semente já trouxe (oraculo:<id> em A fazer) é ligado e movido, sem nascer outro', async () => {
    const store = await board();
    const g = setup(() => store);
    const id = await g.newTask();
    const seeded = await store.createCard({
      p_project_id: 'atlas',
      p_title: 'importado',
      p_owner_request: 'abre o cartão sozinho',
      p_requested_by: 'dono',
      p_actor: 'servico:semente',
      p_client_ref: `oraculo:${id}`,
      p_stage: 'todo',
      p_oraculo_id: id,
      p_as_leader: true,
    });
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    await vi.waitFor(async () => expect((await store.getCard(seeded.id))?.stage).toBe('doing'));
    expect(await store.getCard(seeded.id)).toMatchObject({ place_id: ME, session_id: CONVERSA });
    expect(await store.listCards('atlas', { includeDone: true })).toHaveLength(1);
  });

  it('quadro fora do ar ou com erro: a resposta do tarefa_assumir sai igual, byte a byte, e a falha vira log', async () => {
    const failing: BoardStore = {
      projectOf: async () => {
        throw new BoardError('o quadro de tarefas não respondeu (TimeoutError); tente de novo');
      },
      getCard: async () => null,
      listCards: async () => [],
      cardByClientRef: async () => null,
      createCard: async () => {
        throw new BoardError('não');
      },
      moveCard: async () => {
        throw new BoardError('não');
      },
      touchLane: async () => undefined,
    };
    const broken = setup(() => failing);
    const id = await broken.newTask();
    const answer = await broken.tool('tarefa_assumir', { id });
    expect(answer.error).toBe(false);
    expect(answer.text).toBe(broken.ledgerAnswers.at(-1));
    await vi.waitFor(() => expect(broken.logs.some((line) => line.includes('cartão') && line.includes(id))).toBe(true));

    // A board that never answers does not hold the assumir.
    const hung = setup(() => ({ ...failing, projectOf: () => new Promise<string>(() => undefined) }));
    const other = await hung.newTask();
    const quick = await hung.tool('tarefa_assumir', { id: other });
    expect(quick.text).toBe(hung.ledgerAnswers.at(-1));
  });
});
