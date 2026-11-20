// t-f091595a — o quadro de tarefas (o SQLite do #541) lido pelo celular em /api/v2/quadro. O que quebraria sem o dono
// ver: a leitura do celular escrever no quadro (ou criar um quadro vazio onde não há), um pedido sem a chave do aparelho
// ler os cartões, e um cartão aparecer na coluna errada (ele decide pelo que vê).
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoardSqlite, type BoardSqliteStore } from '../src/oraculo/board-sqlite';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { createCelularV2Handler, signedMessage } from '../src/oraculo/celular-v2';
import { createQuadroLeitor } from '../src/oraculo/quadro-v2';

const dirs: string[] = [];
const stores: BoardSqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'quadro-v2-'));
  dirs.push(dir);
  return dir;
};

const KEY = createHash('sha256').update('token-do-aparelho', 'utf8').digest();
const NOW = Date.parse('2026-11-20T12:00:00Z');
const LEADER = 'place:lider';
const DEV = 'place:dev';

/** atlas: um cartão em cada coluna que importa; beacon: um travado. O quadro fica aberto, como o daemon o deixa. */
async function seed(file: string): Promise<{ store: BoardSqliteStore; ids: Record<string, string> }> {
  const store = createBoardSqlite(file, { now: () => NOW });
  stores.push(store);
  await store.upsertProject({ id: 'atlas', name: 'Atlas', aliases: ['/home/u/seazone/atlas'] });
  await store.upsertProject({ id: 'beacon', name: 'Beacon', aliases: ['/home/u/seazone/beacon'] });
  const create = (title: string, extra: Record<string, unknown> = {}) =>
    store.createCard({ p_project_id: 'atlas', p_title: title, p_owner_request: `pedido ${title}`, p_requested_by: 'dono', p_actor: LEADER, p_as_leader: true, ...extra });
  const entrada = await create('Entrada sem frente');
  const aFazer = await create('A fazer vencido', { p_stage: 'todo', p_front: 'Celular', p_due: '2026-11-19', p_oraculo_id: 't-aaaa1111' });
  const todo = await create('Em andamento', { p_stage: 'todo', p_front: 'Celular', p_risk: 'alto' });
  const fazendo = await store.moveCard({ p_card_id: todo.id, p_to: 'doing', p_actor: DEV, p_expected_version: todo.version, p_note: 'na metade' });
  const pedir = await create('Precisa do dono', { p_stage: 'todo', p_front: 'Servidor' });
  await store.moveCard({ p_card_id: pedir.id, p_to: 'waiting_owner', p_actor: LEADER, p_as_leader: true, p_owner_reason: 'main_prod', p_expected_version: pedir.version });
  const b = await store.createCard({ p_project_id: 'beacon', p_title: 'Travado', p_owner_request: 'x', p_requested_by: 'dono', p_actor: LEADER, p_as_leader: true, p_stage: 'todo' });
  const bDoing = await store.moveCard({ p_card_id: b.id, p_to: 'doing', p_actor: DEV, p_expected_version: b.version });
  await store.moveCard({
    p_card_id: b.id,
    p_to: 'blocked',
    p_actor: DEV,
    p_expected_version: bDoing.version,
    p_justification: 'esperando o review',
    p_justification_link: 'https://github.com/x/y/pull/1',
    p_justification_due: '2026-11-21T12:00:00Z',
  });
  return { store, ids: { entrada: entrada.id, aFazer: aFazer.id, fazendo: fazendo.id, pedir: pedir.id, travado: b.id } };
}

function world(opts: { sqlite?: string | null } = {}) {
  const dir = tmp();
  const sqliteConfig = join(dir, 'sqlite.json');
  const boardFile = join(dir, 'board.sqlite');
  if (opts.sqlite !== null) writeFileSync(sqliteConfig, opts.sqlite ?? JSON.stringify({ file: boardFile }));
  const handler = createCelularV2Handler({
    verify: (message, signature) => (createHmac('sha256', KEY).update(message, 'utf8').digest('hex') === signature ? { name: 'Donel (Android)' } : null),
    doc: () => null,
    store: createCelularLocalStore(join(dir, 'celular-local.json'), () => NOW),
    readProof: async () => ({ kind: 'sumiu' }),
    arvoreFile: join(dir, 'arvore.json'),
    places: () => (_path, placeId) => (placeId === DEV ? { name: 'Dev do celular' } : undefined),
    quadro: createQuadroLeitor({ sqliteConfig, supabaseConfig: join(dir, 'supabase.json') }, { now: () => NOW }),
    now: () => NOW,
  });
  return {
    dir,
    boardFile,
    call(url: string) {
      const ts = String(NOW);
      const sig = createHmac('sha256', KEY).update(signedMessage('GET', url, ts, ''), 'utf8').digest('hex');
      return handler({ method: 'GET', url, body: '', authorization: `Donel-HMAC ${ts}.${sig}` });
    },
    raw: (url: string, authorization?: string) => handler({ method: 'GET', url, body: '', ...(authorization ? { authorization } : {}) }),
  };
}

const parse = (response: { body: unknown }): any => JSON.parse(String(response.body));
/** The board's data: the database and its WAL (the -shm is only an index). */
const fingerprint = (file: string): string =>
  ['', '-wal'].map((suffix) => (existsSync(file + suffix) ? createHash('sha256').update(readFileSync(file + suffix)).digest('hex') : '-')).join('|');

describe('quadro de tarefas pelo celular (/api/v2/quadro)', () => {
  it('só lê com a assinatura do aparelho', async () => {
    const w = world();
    await seed(w.boardFile);
    expect((await w.raw('/api/v2/quadro')).status).toBe(401);
    expect((await w.raw('/api/v2/quadro/projeto?id=atlas', 'Bearer qualquer')).status).toBe(401);
    // A assinatura cobre a query: a de um projeto não abre outro.
    const ts = String(NOW);
    const sig = createHmac('sha256', KEY).update(signedMessage('GET', '/api/v2/quadro/projeto?id=atlas', ts, ''), 'utf8').digest('hex');
    expect((await w.raw('/api/v2/quadro/projeto?id=beacon', `Donel-HMAC ${ts}.${sig}`)).status).toBe(401);
    expect((await w.call('/api/v2/quadro')).status).toBe(200);
  });

  it('visão geral: uma linha por projeto, a contagem de cada coluna e o que pede atenção', async () => {
    const w = world();
    await seed(w.boardFile);
    const answer = parse(await w.call('/api/v2/quadro'));
    expect(answer.colunas.map((c: any) => c.id)).toEqual(['inbox', 'todo', 'doing', 'blocked', 'waiting_owner', 'done']);
    // sem-projeto sem cartão não aparece
    expect(answer.projetos.map((p: any) => p.id)).toEqual(['atlas', 'beacon']);
    const atlas = answer.projetos[0];
    expect(atlas).toMatchObject({ nome: 'Atlas', contagem: { inbox: 1, todo: 1, doing: 1, blocked: 0, waiting_owner: 1, done: 0 }, abertos: 4, vencidos: 1, pede_atencao: true });
    expect(atlas.atencao).toEqual(expect.arrayContaining(['1 esperando você', '1 com prazo vencido', '1 na entrada']));
    expect(answer.projetos[1]).toMatchObject({ contagem: { blocked: 1 }, atencao: ['1 travado'] });
  });

  it('projeto: cada cartão na coluna dele, com o id do Oráculo e a frente para agrupar', async () => {
    const w = world();
    const { ids } = await seed(w.boardFile);
    const answer = parse(await w.call('/api/v2/quadro/projeto?id=atlas'));
    expect(answer.projeto).toMatchObject({ id: 'atlas', nome: 'Atlas' });
    const byId = new Map(answer.cartoes.map((c: any) => [c.id, c]));
    expect(byId.get(ids.entrada)).toMatchObject({ coluna: 'inbox', coluna_nome: 'Entrada', frente: null });
    expect(byId.get(ids.aFazer)).toMatchObject({ coluna: 'todo', frente: 'Celular', oraculo_id: 't-aaaa1111', prazo: '2026-11-19', vencido: true });
    expect(byId.get(ids.fazendo)).toMatchObject({ coluna: 'doing', coluna_nome: 'Fazendo', dono: DEV, dono_nome: 'Dev do celular', risco: 'alto', nota: 'na metade' });
    expect(byId.get(ids.pedir)).toMatchObject({ coluna: 'waiting_owner', motivo_dono: 'main_prod' });
    expect(byId.has(ids.travado)).toBe(false);
    // frentes na ordem dos cartões, "sem frente" por último
    expect(answer.frentes.map((f: any) => [f.frente, f.total])).toEqual([
      ['Celular', 2],
      ['Servidor', 1],
      [null, 1],
    ]);

    const beacon = parse(await w.call('/api/v2/quadro/projeto?id=beacon'));
    expect(beacon.cartoes[0]).toMatchObject({ coluna: 'blocked', justificativa: { texto: 'esperando o review', link: 'https://github.com/x/y/pull/1', ate: '2026-11-21T12:00:00.000Z' } });
    expect((await w.call('/api/v2/quadro/projeto?id=vega')).status).toBe(404);
    expect((await w.call('/api/v2/quadro/projeto?id=Nao%20Slug')).status).toBe(400);
  });

  it('não escreve no quadro, nem cria um onde não há', async () => {
    const w = world();
    const { store } = await seed(w.boardFile);
    const before = fingerprint(w.boardFile);
    for (let i = 0; i < 3; i++) {
      expect((await w.call('/api/v2/quadro')).status).toBe(200);
      expect((await w.call('/api/v2/quadro/projeto?id=atlas')).status).toBe(200);
    }
    expect(fingerprint(w.boardFile)).toBe(before);
    // o daemon segue escrevendo com a leitura aberta antes
    expect((await store.listCards('atlas', {})).length).toBe(4);

    const missing = world();
    const answer = await missing.call('/api/v2/quadro');
    expect(answer.status).toBe(503);
    expect(parse(answer).erro).toBe('quadro-indisponivel');
    expect(existsSync(missing.boardFile)).toBe(false);
  });

  it('quadro desligado ou config inválida respondem 503 explícito', async () => {
    const off = world({ sqlite: null });
    const answer = await off.call('/api/v2/quadro');
    expect(answer.status).toBe(503);
    expect(parse(answer).erro).toBe('quadro-desligado');
    expect(parse(await off.call('/api/v2/quadro/projeto?id=atlas')).erro).toBe('quadro-desligado');

    const bad = world({ sqlite: '{"arquivo": 1}' });
    const refused = await bad.call('/api/v2/quadro');
    expect(refused.status).toBe(503);
    expect(parse(refused).erro).toBe('quadro-invalido');
  });
});
