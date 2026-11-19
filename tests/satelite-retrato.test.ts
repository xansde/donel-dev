// t-d461e003, item 4 (19/11, ~10h45): com o PC fora, o Líder único da VPS pessoal mandou recado ao Dalton (quadro
// Homologação, sessão na Homologações) e ouviu "conheço só os quadros do último retrato (teamzone, BizOps, Donel Dev)".
// Aqui: o satélite da Homologações monta o retrato das próprias sessões (o mesmo retrato-local) e o manda ao Oráculo da
// VPS pessoal com o token do portão; o Oráculo junta esse retrato ao dele (o dele vence), e o recado a uma sessão de lá
// espera numa fila daquela máquina, que o satélite busca e entrega na fila de recados dele. O que quebraria sem o dono
// perceber: o recado que some ou chega duas vezes, o retrato de fora que apaga sessão da VPS pessoal, um retrato velho
// por cima de um novo, e uma tarefa no quadro de lá que fura o alcance do Líder único.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { pickLocalLeader, readLeaderMeta } from '../src/oraculo/lider-local';
import { createGateHandler, type BoardPicture } from '../src/oraculo/portao';
import { createGateToolRoutes, GATE_PICTURE_PATH, readGateHashes } from '../src/oraculo/portoes';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';
import { createRelay } from '../src/oraculo/relay';
import { createLocalPicture, createTmuxLiveNow, readTmuxLive } from '../src/oraculo/retrato-local';
import { createRemotePictures, EMPTY_PICTURE_HOLD_MS, EMPTY_PICTURE_REPEATS } from '../src/oraculo/retrato-satelite';
import { createSatelliteNotice, createSatelliteSync, type SatellitePost } from '../src/oraculo/satelite';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const MIN = 60_000;
const TOKEN = 'e'.repeat(43);
const GATE = 'g'.repeat(64);
const PC = 'p'.repeat(64);
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

// The personal VPS: a Dev on the board atlas (the PC's last picture), the Líder único alive in tmux.
const ATLAS = '/home/dono/seazone/atlas';
const DEV = 'place:dev';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
// The Homologações: the Dalton at the top of the board Homologação, a Dev below him, and two places in a loop of
// arrows (neither is the top, nor below it): the Líder único does not reach them.
const HOMOLOG = 'C:\\Users\\dono\\seazone\\Homologação';
const DALTON = 'place:dalton';
const HDEV = 'place:hdev';
const HX = 'place:hx';
const HY = 'place:hy';
const SID_DALTON = '65431ae3-2222-4333-8444-555555555555';
const BEACON = '/srv/seazone/beacon';
const SID_BEACON = '99999999-2222-4333-8444-555555555555';

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
const ATLAS_BOARD: MindscapeBoard = { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: { [DEV]: card(DEV, 'dev') }, links: [], drawings: [] };
const HOMOLOG_BOARD: MindscapeBoard = {
  projectPath: HOMOLOG,
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: { [DALTON]: card(DALTON, 'dalton'), [HDEV]: card(HDEV, 'dev'), [HX]: card(HX, 'dev'), [HY]: card(HY, 'dev') },
  links: [
    { id: 'l1', from: DALTON, to: HDEV, arrow: true },
    { id: 'l2', from: HX, to: HY, arrow: true },
    { id: 'l3', from: HY, to: HX, arrow: true },
  ],
  drawings: [],
};
const HOMOLOG_LISTAR = [
  { id: DALTON, papel: 'dalton', estado: 'trabalhando', voce: true, podeMandar: false },
  { id: HDEV, papel: 'dev', estado: 'trabalhando' },
  { id: HX, papel: 'dev', estado: 'trabalhando' },
  { id: HY, papel: 'dev', estado: 'trabalhando' },
];

const tmux: RecadosTmux = { screen: async () => ({ inMode: false, text: 'esc to interrupt' }), type: async () => true, enter: async () => true, clear: async () => true };

/**
 * 19/11, 11h: the PC's app closed 10 min ago on both machines. The personal VPS (Oráculo, ledger, Líder único) and the
 * Homologações (satellite: no ledger, the Dalton in its tmux), joined by the satellite's POSTs straight into the API.
 */
function machines() {
  const clock = { now: Date.parse('2026-11-19T14:00:00Z') };
  const seen = clock.now - 10 * MIN;

  // ---- the personal VPS
  const dir = tempDir('oraculo-vps-');
  const sessions = join(dir, 's');
  const live = new Set<string>();
  const folder = (base: string, set: Set<string>, sid: string, meta: Record<string, unknown>): void => {
    mkdirSync(join(base, sid), { recursive: true });
    writeFileSync(join(base, sid, 'meta.json'), JSON.stringify({ sid, mcpToken: TOKEN, mcpPort: 25000 + set.size, ...meta }));
    set.add(sid);
  };
  folder(sessions, live, SID_DEV, { localCwd: ATLAS, name: 'Dev · atlas', roleId: 'dev', createdAt: '2026-11-19T08:00:00Z' });
  folder(sessions, live, SID_LIDER, { localCwd: '/root/_orquestradora', name: 'Líder', roleId: 'lider', leaderOfAll: true, createdAt: '2026-11-19T10:34:44Z' });
  const stored: { picture: BoardPicture | null } = {
    picture: { at: seen, sessoes: { [SID_DEV]: { quemSou: { nome: 'Dev · atlas', pasta: ATLAS, lugar: DEV, papel: 'dev' }, listar: [{ id: DEV, papel: 'dev', estado: 'trabalhando', voce: true }], board: ATLAS_BOARD, at: seen } } },
  };
  const local = createLocalPicture({ stored: () => stored.picture, sessionsDir: sessions, liveNow: () => live, now: () => clock.now, ttlMs: 0 });
  const remotes = createRemotePictures({ dir, io, now: () => clock.now });
  const picture = (): BoardPicture | null => remotes.combine(local.get());
  const ledgerFile = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: ledgerFile, io, proofFs: nodeLedgerProofFs, now: () => clock.now });
  const pcRelay = createRelay({ filePath: join(dir, 'fila.json'), io, now: () => clock.now });
  const recados = createGateRecados({
    file: join(dir, 'recados.json'),
    io,
    ledger: () => ledger,
    picture,
    remote: remotes.queue,
    localSessions: async () => new Set(live),
    leader: async () => pickLocalLeader(live, local.get(), (sid) => readLeaderMeta(sessions, sid), clock.now),
    tmux,
    relay: (message) => pcRelay.send(message, 0),
    transcriptOf: async (sid) => `/t/${sid}.jsonl`,
    lastTurn: async () => null,
    transcriptHas: async () => false,
    now: () => clock.now,
    log: () => undefined,
  });
  const forwarded: string[] = [];
  const gate = createGateHandler({
    sessionsDir: sessions,
    ledger: () => ledger,
    picture,
    pcAway: local.away,
    pictureWithoutPc: (sid) => remotes.combine(local.withoutPc(sid)),
    forward: async (_port, request) => {
      forwarded.push(request.body);
      return new Promise(() => undefined);
    },
    serverVersion: 'teste',
    recados,
    timeouts: { localAnswerMs: 50 },
  });
  mkdirSync(join(dir, 'portoes'));
  writeFileSync(join(dir, 'portoes', 'homologacoes.sha256'), `${hash(GATE)}\n`);
  const api = createOracleApiHandler({
    ledger,
    ledgerFile,
    tokenHash: () => hash(PC),
    gates: () => readGateHashes(dir),
    gateRoutes: createGateToolRoutes({ ledger: () => ledger, recados, notice: (message) => pcRelay.send(message, 0), pictures: remotes }),
  });
  const tool = async (sid: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await gate({ method: 'POST', path: `/s/${sid}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const result = (JSON.parse(res.body) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { error: result.isError === true, text: result.content[0]!.text };
  };

  // ---- the Homologações (satellite)
  const sdir = tempDir('oraculo-satelite-');
  const ssessions = join(sdir, 's');
  const slive = new Set<string>();
  folder(ssessions, slive, SID_DALTON, { localCwd: HOMOLOG, name: 'Dalton', roleId: 'dalton', createdAt: '2026-11-19T07:00:00Z' });
  const sstored: BoardPicture = { at: seen, sessoes: { [SID_DALTON]: { quemSou: { nome: 'Dalton', projeto: 'Homologação', pasta: HOMOLOG, lugar: DALTON, papel: 'dalton', roda: 'Homologações' }, listar: HOMOLOG_LISTAR, board: HOMOLOG_BOARD, at: seen } } };
  const stmux = { fails: false };
  const slocal = createLocalPicture({ stored: () => sstored, sessionsDir: ssessions, liveNow: () => slive, now: () => clock.now, ttlMs: 0 });
  /** The satellite's POST, straight into the personal VPS's API; `cut.ack` loses the next "entregue" on the way. */
  const cut = { ack: false };
  /** The paths the satellite posted to, in order. */
  const posted: string[] = [];
  const post = async (url: string, token: string, body: string): Promise<SatellitePost> => {
    const path = new URL(url).pathname;
    posted.push(path);
    if (cut.ack && body.includes('"entregues":["')) {
      cut.ack = false;
      return 'caiu';
    }
    const answer = await api({ method: 'POST', url: path, body, authorization: `Bearer ${token}` } as OracleRequest);
    return { status: answer.status, body: answer.body as string };
  };
  const remote = { url: 'http://vps-pessoal:47816', token: () => GATE, post };
  const notices = createSatelliteNotice({ ...remote, file: join(sdir, 'avisos-pendentes.json'), io, log: () => undefined });
  const srecados = createGateRecados({
    file: join(sdir, 'recados.json'),
    io,
    ledger: () => null,
    picture: slocal.get,
    localSessions: async () => new Set(slive),
    tmux,
    relay: notices.send,
    transcriptOf: async (sid) => `/t/${sid}.jsonl`,
    lastTurn: async () => null,
    transcriptHas: async () => false,
    now: () => clock.now,
    log: () => undefined,
  });
  const makeSync = () => createSatelliteSync({
    ...remote,
    picture: slocal.get,
    // `tmux.fails`: `tmux -L donel ls` failed or timed out (the Homologações under load, 19/11 14h48).
    live: () => (stmux.fails ? null : slive),
    deliver: async (message) => {
      if (await srecados.deliverLocal(message)) return true;
      await notices.send(message);
      return true;
    },
    now: () => clock.now,
    log: () => undefined,
  });
  const sync = makeSync();
  const endTurn = async (sid: string): Promise<{ decision?: string; reason?: string }> =>
    JSON.parse((await srecados.hook('fim-de-turno', { 'x-donel-tmux': `donel-${sid}` }, JSON.stringify({ session_id: sid }))).body) as { decision?: string; reason?: string };

  return { clock, dir, stored, local, remotes, picture, ledger, pcRelay, api, tool, forwarded, sync, makeSync, endTurn, cut, slive, post, posted, stmux };
}

const idOf = (text: string): string => (JSON.parse(text) as { id: string }).id;
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('com o PC fora, o Líder único da VPS pessoal alcança o quadro Homologação pelo satélite', () => {
  it('o recado ao Dalton chega na fila da Homologações, uma vez só, mesmo com a resposta perdida e o recado repetido', async () => {
    const m = machines();
    await m.sync.round();

    const listed = await m.tool(SID_LIDER, 'sessao_listar', { quadro: 'Homologação' });
    expect(listed.error, listed.text).toBe(false);
    expect(JSON.parse(listed.text)).toEqual(expect.arrayContaining([expect.objectContaining({ id: DALTON })]));

    const sent = await m.tool(SID_LIDER, 'sessao_enviar', { quadro: 'Homologação', para: DALTON, texto: 'conta GitHub pronta', tarefa: 't-d461e003' });
    expect(sent.error, sent.text).toBe(false);
    expect(JSON.parse(sent.text)).toMatchObject({ entregue: 'na-fila', para: DALTON, maquina: 'homologacoes' });
    // The model tries again (a lost answer): the same message joins the first.
    expect((await m.tool(SID_LIDER, 'sessao_enviar', { quadro: 'Homologação', para: DALTON, texto: 'conta GitHub pronta', tarefa: 't-d461e003' })).error).toBe(false);

    // The satellite takes it and queues it there, but its "entregue" is cut on the way and the satellite restarts: the
    // personal VPS hands the same item again to the new one.
    m.cut.ack = true;
    await m.sync.round();
    const restarted = m.makeSync();
    await restarted.round();
    await restarted.round();

    const turn = await m.endTurn(SID_DALTON);
    expect(turn.decision).toBe('block');
    expect(count(turn.reason ?? '', 'conta GitHub pronta')).toBe(1);
    expect(turn.reason).toContain('Líder');
    expect((await m.endTurn(SID_DALTON)).decision, 'nada chega duas vezes').toBeUndefined();
    // It never went to the PC's relay, nor to the PC's tunnel.
    expect(m.pcRelay.pending()).toEqual([]);
    expect(m.forwarded).toEqual([]);
  });

  it('o Líder único cria tarefa com dono no quadro Homologação pelo alcance de sempre, e a lista e lê', async () => {
    const m = machines();
    await m.sync.round();
    const base = { quadro: 'Homologação', titulo: 'Conta GitHub', pedido: 'cadastre a conta do Dalton', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' };

    const below = await m.tool(SID_LIDER, 'tarefa_criar', { ...base, dono: HDEV });
    expect(below.error, below.text).toBe(false);
    const created = await m.tool(SID_LIDER, 'tarefa_criar', { ...base, dono: DALTON });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);
    expect(m.ledger.load().doc.tasks[id]).toMatchObject({ projectPath: HOMOLOG, ownerPlaceId: DALTON });

    // A place in a loop of arrows is neither the top nor below it: refused, as on the PC.
    const refused = await m.tool(SID_LIDER, 'tarefa_criar', { ...base, dono: HX });
    expect(refused.error).toBe(true);
    expect(refused.text).toContain('alcança');

    const listed = await m.tool(SID_LIDER, 'tarefa_listar', { quadro: 'Homologação' });
    expect(listed.error, listed.text).toBe(false);
    expect(listed.text).toContain(id);
    const seen = await m.tool(SID_LIDER, 'tarefa_ver', { id });
    expect(seen.error, seen.text).toBe(false);
    expect(seen.text).toContain('Conta GitHub');
    expect(m.forwarded).toEqual([]);
  });
});

describe('o retrato de outra máquina no Oráculo da VPS pessoal', () => {
  it('nunca apaga nem troca sessão ou quadro da VPS pessoal, nem o de outra máquina', async () => {
    const m = machines();
    const before = m.local.get()!;
    await m.sync.round();
    const at = m.clock.now + 1_000;
    // A picture that claims the Dev's sid and the board atlas, from another gate's credential.
    const other = {
      at,
      quadros: {
        [ATLAS]: { listar: [{ id: 'place:intruso', papel: 'dev', estado: 'trabalhando' }], board: { ...ATLAS_BOARD, cards: {} } },
        [BEACON]: { listar: [{ id: 'place:b', papel: 'dev', estado: 'trabalhando' }], board: { ...ATLAS_BOARD, projectPath: BEACON, cards: { 'place:b': card('place:b', 'dev') } } },
      },
      sessoes: { [SID_DEV]: { quemSou: { pasta: ATLAS, lugar: 'place:intruso' } }, [SID_BEACON]: { quemSou: { pasta: BEACON, lugar: 'place:b' } } },
    };
    m.remotes.accept('outra', other as never);
    const combined = m.picture()!;
    expect(combined.sessoes[SID_DEV]).toEqual(before.sessoes[SID_DEV]);
    expect(combined.sessoes[SID_LIDER]).toBeDefined();
    expect(combined.sessoes[SID_DALTON], 'a sessão da Homologações segue').toMatchObject({ quemSou: expect.objectContaining({ lugar: DALTON }), maquina: 'homologacoes' });

    // The Homologações with no session now (for over a minute: a lone empty picture is held, see below): only its own
    // leave; the personal VPS's and the other machine's stay.
    m.slive.clear();
    for (let i = 0; i < 8; i += 1) {
      m.clock.now += 10_000;
      await m.sync.round();
    }
    const after = m.picture()!;
    expect(after.sessoes[SID_DALTON]).toBeUndefined();
    expect(after.sessoes[SID_DEV]).toEqual(before.sessoes[SID_DEV]);
    expect(after.sessoes[SID_BEACON], 'a da outra máquina segue').toMatchObject({ quemSou: expect.objectContaining({ lugar: 'place:b' }), maquina: 'outra' });
    expect(after.sessoes[SID_DEV]!.board).toEqual(ATLAS_BOARD);
  });

  it('um retrato velho não passa por cima de um novo, nem depois de reiniciar o daemon', async () => {
    const m = machines();
    const send = async (at: number, lugar: string) => {
      const retrato = { at, quadros: { [HOMOLOG]: { listar: [{ id: lugar, estado: 'trabalhando' }], board: HOMOLOG_BOARD } }, sessoes: { [SID_DALTON]: { quemSou: { pasta: HOMOLOG, lugar } } } };
      return m.post(`http://vps-pessoal:47816${GATE_PICTURE_PATH}`, GATE, JSON.stringify({ retrato }));
    };
    expect(await send(2_000, 'place:novo')).toMatchObject({ status: 200 });
    const old = await send(1_000, 'place:velho');
    expect(old).toMatchObject({ status: 200 });
    expect(JSON.parse((old as { body: string }).body)).toMatchObject({ guardado: false });
    expect(m.picture()!.sessoes[SID_DALTON]!.quemSou.lugar).toBe('place:novo');

    const again = createRemotePictures({ dir: m.dir, io, now: () => m.clock.now });
    expect(again.machineOf(HOMOLOG, 'place:novo')).toBe('homologacoes');
    again.accept('homologacoes', { at: 1_500, quadros: {}, sessoes: {} });
    expect(again.machineOf(HOMOLOG, 'place:novo')).toBe('homologacoes');

    // The PC's token does not reach the route.
    expect(await m.post(`http://vps-pessoal:47816${GATE_PICTURE_PATH}`, PC, JSON.stringify({ retrato: { at: 3_000, quadros: {}, sessoes: {} } }))).toMatchObject({ status: 403 });
  });
});

// Revisão do #505, ressalva 1: o retrato guardado de outra máquina nunca vencia. Com o satélite parado, o recado e o
// aviso a um lugar de lá iam para a fila dela, que ninguém lê até ele voltar (até 14 dias), mesmo com o PC ligado.
describe('o retrato de outra máquina vence quando o satélite some', () => {
  const notice = { projectPath: HOMOLOG, placeId: DALTON, text: '◆ Oráculo: tarefa nova', leaderText: '◆ Oráculo, quadro Homologação: tarefa nova', key: 'aviso:teste' };

  it('fresco, o aviso a um lugar de lá vai à fila dela; vencido, volta ao relay do PC', async () => {
    const m = machines();
    await m.sync.round();
    expect(await m.remotes.queue(notice)).toBe('homologacoes');

    // The satellite stops: no picture, no inbox call for over 2 min.
    m.clock.now += 2 * MIN + 1_000;
    expect(await m.remotes.queue({ ...notice, key: 'aviso:teste-2' })).toBeNull();
    const sent = await m.tool(SID_LIDER, 'sessao_enviar', { quadro: 'Homologação', para: DALTON, texto: 'conta GitHub pronta', tarefa: 't-d461e003' });
    expect(sent.error, sent.text).toBe(false);
    expect(JSON.parse(sent.text)).not.toMatchObject({ entregue: 'na-fila' });
    expect(m.pcRelay.pending().map((item) => item.message.placeId)).toEqual([DALTON]);
    // What was already in its queue stays there: the satellite takes it when it comes back.
    expect(m.remotes.inbox('homologacoes', []).map((item) => item.message.key)).toEqual(['aviso:teste']);
  });

  it('o satélite que segue chamando a cada 10 s mantém o retrato fresco, mesmo sem retrato novo', async () => {
    const m = machines();
    await m.sync.round();
    for (let i = 0; i < 18; i += 1) {
      m.clock.now += 10_000;
      await m.sync.round();
    }
    expect(await m.remotes.queue(notice)).toBe('homologacoes');
    const sent = await m.tool(SID_LIDER, 'sessao_enviar', { quadro: 'Homologação', para: DALTON, texto: 'segue', tarefa: 't-d461e003' });
    expect(JSON.parse(sent.text)).toMatchObject({ entregue: 'na-fila', maquina: 'homologacoes' });
    expect(m.pcRelay.pending()).toEqual([]);
  });
});

// t-d461e003 (19/11, 14h48): a Homologações sob carga, o `tmux -L donel ls` do satélite falhou ou passou dos 2 s, e o
// satélite mandou um retrato sem sessões, que trocou o último bom (16 sessões): o Dalton sumiu do alcance do Líder único.
describe('um retrato vazio do satélite não apaga o último bom', () => {
  const retrato = (at: number, sessoes: Record<string, { quemSou: Record<string, unknown> }>) => ({
    at,
    quadros: { [HOMOLOG]: { listar: HOMOLOG_LISTAR, board: HOMOLOG_BOARD } },
    sessoes,
  });
  const dalton = (lugar = DALTON) => ({ [SID_DALTON]: { quemSou: { pasta: HOMOLOG, lugar } } });

  it('tmux que falha no satélite não envia retrato; os recados seguem e a Homologação continua no alcance', async () => {
    const m = machines();
    await m.sync.round();
    expect(m.posted).toContain(GATE_PICTURE_PATH);

    m.stmux.fails = true;
    m.slive.clear(); // what a failed read looked like before: no session
    m.posted.length = 0;
    for (let i = 0; i < 12; i += 1) {
      m.clock.now += 10_000;
      await m.sync.round();
    }
    expect(m.posted, 'nenhum retrato sai com o tmux falhando').not.toContain(GATE_PICTURE_PATH);
    expect(m.posted.length, 'a busca de recados segue').toBeGreaterThan(0);
    expect(m.picture()!.sessoes[SID_DALTON]).toMatchObject({ maquina: 'homologacoes' });
    expect(await m.remotes.queue({ projectPath: HOMOLOG, placeId: DALTON, text: 'x', leaderText: 'x', key: 'aviso:tmux' })).toBe('homologacoes');
  });

  it('um vazio isolado não apaga o guardado; vazio repetido por 3 envios ao longo de 1 min apaga', () => {
    const m = machines();
    const start = m.clock.now;
    expect(m.remotes.accept('homologacoes', retrato(start, dalton()) as never)).toBe(true);

    // Two empties, then a third before a minute: all held.
    for (let i = 1; i <= 3; i += 1) {
      m.clock.now = start + i * 10_000;
      expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never), `vazio ${i}`).toBe(false);
      expect(m.picture()!.sessoes[SID_DALTON]).toMatchObject({ maquina: 'homologacoes' });
    }
    // Still empty a minute after the first one: it replaces the kept one.
    m.clock.now = start + 10_000 + EMPTY_PICTURE_HOLD_MS;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never)).toBe(true);
    expect(m.picture()!.sessoes[SID_DALTON]).toBeUndefined();
    // Restarted, the registro reads the empty one from disk.
    expect(createRemotePictures({ dir: m.dir, io, now: () => m.clock.now }).combine(m.local.get())!.sessoes[SID_DALTON]).toBeUndefined();
  });

  it('um vazio que se repete por mais de 1 min, mas em menos de 3 envios, também espera', () => {
    const m = machines();
    const start = m.clock.now;
    m.remotes.accept('homologacoes', retrato(start, dalton()) as never);
    m.clock.now = start + 1_000;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never)).toBe(false);
    m.clock.now = start + 5 * MIN;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never), 'só 2 envios').toBe(false);
    expect(m.picture()!.sessoes[SID_DALTON]).toMatchObject({ maquina: 'homologacoes' });
    expect(EMPTY_PICTURE_REPEATS).toBe(3);
  });

  it('o retrato bom depois de um vazio entra normal, e a contagem do vazio recomeça', () => {
    const m = machines();
    const start = m.clock.now;
    m.remotes.accept('homologacoes', retrato(start, dalton()) as never);
    m.clock.now = start + 10_000;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never)).toBe(false);
    m.clock.now = start + 20_000;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, dalton('place:hdev')) as never)).toBe(true);
    expect(m.picture()!.sessoes[SID_DALTON]!.quemSou.lugar).toBe('place:hdev');

    // Empties again: counted from the first of this new run, not the old one.
    for (let i = 1; i <= 3; i += 1) {
      m.clock.now = start + 20_000 + i * 15_000;
      expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never), `vazio ${i}`).toBe(false);
    }
    m.clock.now = start + 20_000 + 15_000 + EMPTY_PICTURE_HOLD_MS;
    expect(m.remotes.accept('homologacoes', retrato(m.clock.now, {}) as never)).toBe(true);
  });
});

describe('o tmux ls do retrato segue a regra do "tmux ls que falha mantém o conjunto"', () => {
  it('falha ou timeout: nulo para o satélite e o último conjunto para o retrato; servidor fora: nenhuma', () => {
    const answers: Array<{ code: number; stdout: string; stderr: string }> = [
      { code: 0, stdout: `donel-${SID_DALTON}\noutra\n`, stderr: '' },
      { code: 1, stdout: '', stderr: '' }, // timeout (killed) or a busy server
      { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/donel' },
    ];
    const run = () => answers.shift()!;
    expect([...readTmuxLive(() => ({ code: 0, stdout: `donel-${SID_DALTON}\n`, stderr: '' }))!]).toEqual([SID_DALTON]);
    expect(readTmuxLive(() => ({ code: 1, stdout: '', stderr: '' }))).toBeNull();
    expect([...readTmuxLive(() => ({ code: 1, stdout: '', stderr: 'error connecting to /tmp/tmux-1000/donel' }))!]).toEqual([]);

    const live = createTmuxLiveNow(() => readTmuxLive(run));
    expect([...live()]).toEqual([SID_DALTON]);
    expect([...live()], 'falhou: o último conjunto').toEqual([SID_DALTON]);
    expect([...live()], 'sem servidor: nenhuma').toEqual([]);
  });
});
