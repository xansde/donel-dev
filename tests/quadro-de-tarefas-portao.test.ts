// Quadro de tarefas (t-1e354d15), PR 2 — the `card_*` tools at the daemon's gate. What breaks without the owner
// noticing: a card call going to the PC (which does not know the board) instead of the board, a Dev putting a card in
// "Esperando você" by calling the tool, a move recorded under the wrong place, and the tools missing from the list.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createGateHandler, type GateForward } from '../src/oraculo/portao';
import { projectFolderOf, type BoardStore, type CardRow, type MoveCardArgs } from '../src/oraculo/board-client';
import { emptyMindscapeDoc } from '../src/shared/mindscape/model';
import { LEADER_ROLE_ID } from '../src/shared/roles';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const SID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'd'.repeat(43);
const PROJECT = 'C:\\Users\\dono\\seazone\\atlas';
const DEV = 'place:dev-vps';
const LEADER = 'place:lider';
const CONVERSA = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const NOW = Date.parse('2026-11-16T18:00:00Z');

function fakeStore() {
  const card: CardRow = {
    id: 'c-000000000001', project_id: 'atlas', front: 'Ledger', title: 'Quadro', owner_request: 'pedido', criterion: null, requested_by: 'dono',
    stage: 'todo', stage_since: '2026-11-16T17:00:00Z', note: null, place_id: null, session_id: null, justification: null,
    justification_link: null, justification_due: null, owner_reason: null, done_summary: null, version: 2,
  };
  const moves: MoveCardArgs[] = [];
  const store: BoardStore = {
    projectOf: async (path) => (projectFolderOf(path) === PROJECT ? 'atlas' : 'sem-projeto'),
    getCard: async (id) => (id === card.id ? card : null),
    getLane: async (projectId) => ({ projectId, leaderPlace: LEADER }),
    listCards: async () => [card],
    createCard: async () => card,
    moveCard: async (args) => {
      moves.push(args);
      return { ...card, stage: args.p_to, version: card.version + 1, place_id: args.p_actor };
    },
    touchLane: async () => undefined,
  };
  return { store, moves };
}

function setup(store: BoardStore | null, forward: GateForward) {
  const dir = mkdtempSync(join(tmpdir(), 'portao-quadro-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  mkdirSync(join(sessions, SID), { recursive: true });
  writeFileSync(join(sessions, SID, 'meta.json'), JSON.stringify({ sid: SID, mcpToken: TOKEN, mcpPort: 25710 }));
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs });
  const board = emptyMindscapeDoc().boards[PROJECT] ?? { cards: {}, links: [] };
  const mindscape = {
    ...board,
    cards: {
      [DEV]: { kind: 'session', id: DEV, roleId: 'dev', sessionId: CONVERSA, x: 0, y: 0 },
      [LEADER]: { kind: 'session', id: LEADER, roleId: LEADER_ROLE_ID, x: 0, y: 0 },
    },
  } as never;
  const picture = {
    at: NOW,
    sessoes: { [SID]: { quemSou: { pasta: `${PROJECT}\\.claude\\worktrees\\x`, lugar: DEV, papel: 'dev' }, listar: [], board: mindscape } },
  };
  const handle = createGateHandler({ sessionsDir: sessions, ledger: () => ledger, picture: () => picture, forward, serverVersion: 'teste', cards: () => store, now: () => NOW });
  const rpc = async (method: string, params: unknown) => {
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return JSON.parse(res.body) as { result: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } };
  };
  return { rpc };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PC_ON: GateForward = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"tarefa_ver"}]}}' });

describe('card_* no portão do daemon', () => {
  it('responde no portão com o PC ligado e grava como o lugar da sessão, com a conversa dela', async () => {
    const { store, moves } = fakeStore();
    let forwarded = 0;
    const g = setup(store, async (...args) => {
      forwarded++;
      return PC_ON(...args);
    });
    const answer = await g.rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'doing', nota: 'comecei' } });
    expect(answer.result.isError).toBeUndefined();
    expect(forwarded).toBe(0);
    expect(moves).toEqual([expect.objectContaining({ p_to: 'doing', p_actor: DEV, p_session_id: CONVERSA, p_expected_version: 2, p_note: 'comecei' })]);
  });

  it('Dev não põe em "Esperando você": recusado antes do banco', async () => {
    const { store, moves } = fakeStore();
    const g = setup(store, PC_ON);
    const answer = await g.rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'waiting_owner', motivoDono: 'money' } });
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content![0]!.text).toContain('só o Líder do quadro');
    expect(moves).toEqual([]);
  });

  it('a lista de ferramentas do PC ganha as card_*; sem quadro configurado, nada muda', async () => {
    const withBoard = await setup(fakeStore().store, PC_ON).rpc('tools/list', {});
    expect(withBoard.result.tools!.map((tool) => tool.name)).toEqual(['tarefa_ver', 'card_create', 'card_move', 'card_justify', 'card_list']);
    const without = await setup(null, PC_ON).rpc('tools/list', {});
    expect(without.result.tools!.map((tool) => tool.name)).toEqual(['tarefa_ver']);
  });
});
