// Quadro de tarefas (t-1e354d15), PR 2 — the `card_*` tools at the daemon's gate. What breaks without the owner
// noticing: a card call going to the PC (which does not know the board) instead of the board, a Dev putting a card in
// "Esperando você" by calling the tool, a move recorded under the wrong place, and the tools missing from the list.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createGateHandler, withGateTools, type GateForward } from '../src/oraculo/portao';
import { BoardError, createBoardClient, projectFolderOf, type BoardStore, type CardRow, type MoveCardArgs } from '../src/oraculo/board-client';
import { emptyMindscapeDoc } from '../src/shared/mindscape/model';
import { CARD_INSTRUCTIONS } from '../src/shared/browser/mcp';
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
let clock = NOW;

function fakeStore() {
  const card: CardRow = {
    id: 'c-000000000001', project_id: 'atlas', front: 'Ledger', title: 'Quadro', owner_request: 'pedido', criterion: null, requested_by: 'dono',
    stage: 'todo', stage_since: '2026-11-16T17:00:00Z', note: null, place_id: null, session_id: null, justification: null,
    justification_link: null, justification_due: null, owner_reason: null, done_summary: null, version: 2,
  };
  const moves: MoveCardArgs[] = [];
  const touches: { place: string; session?: string | undefined; force: boolean | undefined }[] = [];
  const creates: (string | undefined)[] = [];
  const store: BoardStore = {
    projectOf: async (path) => (projectFolderOf(path) === PROJECT ? 'atlas' : 'sem-projeto'),
    getCard: async (id) => (id === card.id ? card : null),
    listCards: async () => [card],
    createCard: async (args) => {
      creates.push(args.p_client_ref);
      return card;
    },
    cardByClientRef: async (ref) => (creates.includes(ref) ? card : null),
    moveCard: async (args) => {
      moves.push(args);
      return { ...card, stage: args.p_to, version: card.version + 1, place_id: args.p_actor };
    },
    touchLane: async (_project, place, session, force) => {
      touches.push({ place, session, force });
    },
  };
  return { store, moves, touches, creates };
}

/** `me`: who calls; `leaderBy`: who put the Líder on the board (`'session'` = a session drew it: no power). */
function setup(store: BoardStore | null, forward: GateForward, me = DEV, folder = `${PROJECT}\\.claude\\worktrees\\x`, leaderBy?: 'session') {
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
      [LEADER]: { kind: 'session', id: LEADER, roleId: LEADER_ROLE_ID, x: 0, y: 0, ...(leaderBy ? { by: leaderBy } : {}) },
    },
  } as never;
  const picture = {
    at: NOW,
    sessoes: { [SID]: { quemSou: { pasta: folder, lugar: me, papel: me === LEADER ? 'lider' : 'dev' }, listar: [], board: mindscape } },
  };
  const handle = createGateHandler({ sessionsDir: sessions, ledger: () => ledger, picture: () => picture, forward, serverVersion: 'teste', cards: () => store, now: () => clock });
  const rpc = async (method: string, params: unknown) => {
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return JSON.parse(res.body) as { result: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } };
  };
  return { rpc };
}

afterEach(() => {
  clock = NOW;
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
    expect(moves[0]!.p_as_leader).toBeUndefined();
  });

  it('o Líder posto pelo dono manda e toma a raia na hora; o que perdeu o papel não', async () => {
    const leader = fakeStore();
    const asLeader = await setup(leader.store, PC_ON, LEADER).rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'waiting_owner', motivoDono: 'money' } });
    expect(asLeader.result.isError).toBeUndefined();
    expect(leader.touches).toEqual([{ place: LEADER, force: true }]);
    expect(leader.moves).toEqual([expect.objectContaining({ p_actor: LEADER, p_as_leader: true, p_owner_reason: 'money' })]);

    const demoted = fakeStore();
    const answer = await setup(demoted.store, PC_ON, LEADER, undefined, 'session').rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'waiting_owner', motivoDono: 'money' } });
    expect(answer.result.isError).toBe(true);
    expect(demoted.touches).toEqual([]);
    expect(demoted.moves).toEqual([]);
  });

  it('o Líder só dá o cartão a um lugar do próprio quadro; pasta sem projeto não lista nem move', async () => {
    const { store, moves } = fakeStore();
    const far = await setup(store, PC_ON, LEADER).rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'todo', lugar: 'place:de-outro-quadro' } });
    expect(far.result.isError).toBe(true);
    const unknown = await setup(store, PC_ON, DEV, 'C:\\Users\\dono\\seazone\\outro-repo').rpc('tools/call', { name: 'card_list', arguments: {} });
    expect(unknown.result.isError).toBe(true);
    expect(moves).toEqual([]);
  });

  it('reenvio do card_create depois de timeout não cria segundo cartão, mesmo cruzando a borda dos 10 min', async () => {
    const { store, creates } = fakeStore();
    const g = setup(store, PC_ON);
    const ask = { name: 'card_create', arguments: { titulo: 'Quadro', pedido: 'pedido', quemPediu: 'dono' } };
    clock = NOW - 5_000; // 17:59:55, the bucket ends at 18:00
    expect((await g.rpc('tools/call', ask)).result.isError).toBeUndefined();
    clock = NOW + 10_000; // the retry after the 15 s timeout
    expect((await g.rpc('tools/call', ask)).result.isError).toBeUndefined();
    expect(creates).toHaveLength(1);
    clock = NOW + 25 * 60 * 1000; // the same request much later is a new card
    await g.rpc('tools/call', ask);
    expect(creates).toHaveLength(2);
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

  it('o initialize que veio do PC ganha o parágrafo do cartão só com o quadro configurado, uma vez só', async () => {
    const PC_INIT = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","instructions":"Texto do PC. "}}';
    const fromPc: GateForward = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: PC_INIT });
    const raw = async (store: BoardStore | null, forward: GateForward) => (await setup(store, forward).rpc('initialize', {})) as unknown as { result: { instructions: string } };
    const withBoard = await raw(fakeStore().store, fromPc);
    expect(withBoard.result.instructions.startsWith('Texto do PC. ')).toBe(true);
    expect(withBoard.result.instructions.split(CARD_INSTRUCTIONS.trim()).length - 1).toBe(1);
    // An app that already knows the paragraph: not served twice.
    const already: GateForward = async () => ({ status: 200, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { instructions: `Texto do PC. ${CARD_INSTRUCTIONS}` } }) });
    expect((await raw(fakeStore().store, already)).result.instructions.split(CARD_INSTRUCTIONS.trim()).length - 1).toBe(1);
    // No board (the Homologações): the PC's answer passes byte for byte.
    const untouched = await setup(null, fromPc).rpc('initialize', {});
    expect(JSON.stringify(untouched)).toBe(PC_INIT);
    const answer = { status: 200, headers: {}, body: PC_INIT };
    expect(withGateTools('{"jsonrpc":"2.0","id":1,"method":"initialize"}', answer, false)).toBe(answer);
  });
});

/** The Líder único on a VPS picture that has the boards atlas (lane of 'lider') and bizops (lane of its own Líder). */
function leaderOfAllSetup(lanes: Record<string, string>, resumedAs?: string) {
  const fake = fakeStore();
  const store: BoardStore = {
    ...fake.store,
    projectOf: async (path) => (path === PROJECT ? 'atlas' : path === BIZOPS ? 'bizops' : 'sem-projeto'),
    laneOf: async (projectId) => (lanes[projectId] ? { project_id: projectId, leader_place: lanes[projectId]!, leader_session: null, leader_seen_at: null } : null),
  };
  const dir = mkdtempSync(join(tmpdir(), 'portao-lider-unico-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  mkdirSync(join(sessions, SID), { recursive: true });
  writeFileSync(join(sessions, SID, 'meta.json'), JSON.stringify({ sid: SID, mcpToken: TOKEN, mcpPort: 25710 }));
  // A Líder resumed with `-r` lives in another conversation: the app writes it in the folder's `current`.
  if (resumedAs) writeFileSync(join(sessions, SID, 'current'), `${resumedAs}\n`);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs });
  const picture = {
    at: NOW,
    sessoes: {
      [SID]: { quemSou: { liderUnico: true, nome: 'Líder único' }, listar: [] },
      'atlas-dev': { quemSou: { pasta: PROJECT, lugar: DEV, papel: 'dev' }, listar: [{ id: DEV, estado: 'trabalhando' }, { id: LEADER, estado: 'parada' }] },
      'biz-dev': { quemSou: { pasta: BIZOPS, lugar: 'place:biz-dev', papel: 'dev' }, listar: [{ id: 'place:biz-dev', estado: 'trabalhando' }] },
    },
  };
  const handle = createGateHandler({ sessionsDir: sessions, ledger: () => ledger, picture: () => picture, forward: PC_ON, serverVersion: 'teste', cards: () => store, now: () => clock });
  const rpc = async (method: string, params: unknown) => {
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return JSON.parse(res.body) as { result: { content?: { text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } };
  };
  return { ...fake, rpc };
}

const BIZOPS = '/home/dono/seazone/bizops';

describe('card_* do Líder único (t-8406f473)', () => {
  it('com quadro=atlas cria em A fazer com o lugar e move, como o Líder da raia, com a conversa dele', async () => {
    const g = leaderOfAllSetup({ atlas: 'lider', bizops: 'place:lider-bizops' });
    const created = await g.rpc('tools/call', { name: 'card_create', arguments: { quadro: 'atlas', titulo: 'Quadro', pedido: 'pedido', quemPediu: 'dono', coluna: 'todo', lugar: DEV } });
    expect(created.result.isError).toBeUndefined();
    expect(g.creates).toHaveLength(1);
    const moved = await g.rpc('tools/call', { name: 'card_move', arguments: { quadro: 'atlas', id: 'c-000000000001', para: 'doing', lugar: DEV } });
    expect(moved.result.isError).toBeUndefined();
    expect(g.moves).toEqual([expect.objectContaining({ p_actor: 'lider', p_as_leader: true, p_place_id: DEV, p_session_id: SID })]);
    expect(g.touches.every((touch) => touch.place === 'lider' && touch.force === true)).toBe(true);
  });

  it('retomado com -r, a conversa dele é a viva (current), não a da pasta: no cartão e na raia', async () => {
    const VIVA = 'abababab-cdcd-4efe-8a0a-121212121212';
    const g = leaderOfAllSetup({ atlas: 'lider' }, VIVA);
    const moved = await g.rpc('tools/call', { name: 'card_move', arguments: { quadro: 'atlas', id: 'c-000000000001', para: 'doing', lugar: DEV } });
    expect(moved.result.isError).toBeUndefined();
    expect(g.moves).toEqual([expect.objectContaining({ p_actor: 'lider', p_session_id: VIVA })]);
    expect(g.touches.length).toBeGreaterThan(0);
    expect(g.touches.every((touch) => touch.session === VIVA)).toBe(true);
  });

  it('sem quadro é recusado; no quadro de outro Líder (bizops) ele não tria', async () => {
    const g = leaderOfAllSetup({ atlas: 'lider', bizops: 'place:lider-bizops' });
    const without = await g.rpc('tools/call', { name: 'card_move', arguments: { id: 'c-000000000001', para: 'doing' } });
    expect(without.result.isError).toBe(true);
    expect(without.result.content![0]!.text).toContain('quadro');
    const biz = await g.rpc('tools/call', { name: 'card_create', arguments: { quadro: 'bizops', titulo: 'x', pedido: 'y', quemPediu: 'dono', coluna: 'todo' } });
    expect(biz.result.isError).toBe(true);
    expect(biz.result.content![0]!.text).toContain('só o Líder do quadro');
    expect(g.creates).toEqual([]);
    expect(g.moves).toEqual([]);
    expect(g.touches).toEqual([]);
  });

  it('sessão comum com quadro é recusada; a lista dela não traz quadro, a do Líder único traz', async () => {
    const { store, moves } = fakeStore();
    const g = setup(store, PC_ON);
    const answer = await g.rpc('tools/call', { name: 'card_move', arguments: { quadro: 'atlas', id: 'c-000000000001', para: 'doing' } });
    expect(answer.result.isError).toBe(true);
    expect(moves).toEqual([]);
    const listed = (await g.rpc('tools/list', {})) as { result: { tools: { name: string; inputSchema?: { properties: Record<string, unknown> } }[] } };
    const cardsListed = listed.result.tools.filter((tool) => tool.name.startsWith('card_'));
    expect(cardsListed).toHaveLength(4);
    for (const tool of cardsListed) expect(Object.keys(tool.inputSchema!.properties)).not.toContain('quadro');
    const leader = await leaderOfAllSetup({ atlas: 'lider' }).rpc('tools/list', {});
    for (const tool of leader.result.tools!.filter((each) => each.name.startsWith('card_'))) expect(Object.keys(tool.inputSchema.properties)).toContain('quadro');
  });
});

describe('cliente do quadro (PostgREST)', () => {
  it('fala com o schema board pela chave de serviço e não põe o caminho nem a chave no erro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quadro-chave-'));
    dirs.push(dir);
    const keyFile = join(dir, 'k');
    writeFileSync(keyFile, 'sb_secret_TESTE\n');
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      return new Response('{"message":"só o Líder do quadro tria (Entrada e A fazer); peça a ele"}', { status: 400 });
    }) as unknown as typeof fetch;
    const client = createBoardClient({ url: 'https://ref.supabase.co', serviceKeyFile: keyFile }, fakeFetch);
    await expect(client.moveCard({ p_card_id: 'c-1', p_to: 'todo', p_actor: DEV, p_expected_version: 1 })).rejects.toThrow('só o Líder do quadro tria');
    expect(seen[0]!.url).toBe('https://ref.supabase.co/rest/v1/rpc/move_card');
    expect(seen[0]!.headers).toMatchObject({ 'Content-Profile': 'board', 'Accept-Profile': 'board', apikey: 'sb_secret_TESTE', Authorization: 'Bearer sb_secret_TESTE' });

    const missing = createBoardClient({ url: 'https://ref.supabase.co', serviceKeyFile: '/caminho/sb_secret_COLADO_NO_CAMPO' }, fakeFetch);
    const error = await missing.getCard('c-1').catch((e: Error) => e);
    expect(error).toBeInstanceOf(BoardError);
    expect((error as Error).message).not.toContain('sb_secret_COLADO_NO_CAMPO');
  });
});
