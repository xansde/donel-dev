// O Oráculo sem o PC (19/11). O dono, pelo celular: "Eu mandei não precisar de aplicativo no computador. Como que
// você me faz isso acontecer de precisar de aplicativo, pô? O Oráculo é o básico. Básico." Com o app do PC fechado, o
// portão da VPS recusava o Líder único e toda sessão aberta depois que o PC sumiu ("Sem retrato do quadro desta
// sessão"), e os túneis que ainda conectam penduravam a chamada. Aqui: com o PC fora por mais de 2 min, a VPS monta o
// retrato das próprias sessões (tmux + pasta da sessão + o último quadro que o PC deixou) e responde tarefa_*,
// sessao_quem_sou, sessao_listar, sessao_enviar e sessao_abrir pelas regras de sempre, sem passar pelo túnel.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { syntheticPicture } from '../src/oraculo/abrir-local';
import type { GateAbrir } from '../src/oraculo/gate-abrir';
import { pickLocalLeader, readLeaderMeta } from '../src/oraculo/lider-local';
import { createGateHandler, type BoardPicture, type GateForward, type PictureSession } from '../src/oraculo/portao';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';
import { createRelay } from '../src/oraculo/relay';
import { createLocalPicture, pcAway, pcSeenAt, withLocalSessions } from '../src/oraculo/retrato-local';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const DEV = 'place:dev';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
const SID_NOVO = '33333333-2222-4333-8444-555555555555';
const SID_REV = '44444444-2222-4333-8444-555555555555';
const NOVO = `session:${SID_NOVO}`;
const REV = `session:${SID_REV}`;
const MIN = 60_000;
const TOKEN = 'e'.repeat(43);

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
const BOARD: MindscapeBoard = { projectPath: PROJECT, pan: { x: 0, y: 0 }, zoom: 1, cards: { [DEV]: card(DEV, 'dev') }, links: [], drawings: [] };
const LISTAR = [{ id: DEV, papel: 'dev', estado: 'trabalhando', voce: true }];

/**
 * The personal VPS at 09h of 19/11: the PC's app closed (its last push and its last probe answer 10 min ago), the Líder
 * único alive in tmux and never pictured, a Dev the PC pictured, and the sessions opened after the PC left.
 */
function vps(options: { pcSeenAgoMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-sem-pc-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  const clock = { now: Date.parse('2026-11-19T12:00:00Z') };
  const seen = clock.now - (options.pcSeenAgoMs ?? 10 * MIN);
  const stored: { picture: BoardPicture | null } = {
    picture: { at: seen - MIN, sessoes: { [SID_DEV]: { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: DEV, papel: 'dev', papelNome: 'Dev' }, listar: LISTAR, board: BOARD, at: seen } } },
  };
  const live = new Set<string>();
  const folder = (sid: string, meta: Record<string, unknown>): void => {
    mkdirSync(join(sessions, sid), { recursive: true });
    writeFileSync(join(sessions, sid, 'meta.json'), JSON.stringify({ sid, mcpToken: TOKEN, mcpPort: 25000 + live.size, ...meta }));
    live.add(sid);
  };
  folder(SID_DEV, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', createdAt: '2026-11-19T08:00:00Z' });
  folder(SID_LIDER, { localCwd: 'C:\\Users\\dono\\_orquestradora', name: 'Líder', roleId: 'lider', leaderOfAll: true, createdAt: '2026-11-19T10:34:44Z' });
  const local = createLocalPicture({ stored: () => stored.picture, sessionsDir: sessions, liveNow: () => live, now: () => clock.now, ttlMs: 0 });
  /** What each session's screen shows (default: mid-turn, so nothing is typed into it); `killed` = the tmux ended. */
  const screens = new Map<string, string>();
  const killed: string[] = [];
  const tmux: RecadosTmux = {
    screen: async (sid) => ({ inMode: false, text: screens.get(sid) ?? 'esc to interrupt' }),
    type: async () => true,
    enter: async () => true,
    clear: async () => true,
    kill: async (sid) => {
      killed.push(sid);
      live.delete(sid);
      return true;
    },
  };
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => clock.now });
  const relay = createRelay({ filePath: join(dir, 'fila.json'), io, now: () => clock.now });
  const recados = createGateRecados({
    file: join(dir, 'recados.json'),
    io,
    ledger: () => ledger,
    picture: local.get,
    localSessions: async () => new Set(live),
    leader: async () => pickLocalLeader(live, local.get(), (sid) => readLeaderMeta(sessions, sid), clock.now),
    tmux,
    relay: (message) => relay.send(message, 0),
    transcriptOf: async (sid) => `/t/${sid}.jsonl`,
    lastTurn: async () => null,
    transcriptHas: async () => false,
    now: () => clock.now,
    log: () => undefined,
  });
  /** What reached the PC's tunnel: with the app closed it connects (the ssh) and never answers. */
  const forwarded: string[] = [];
  const opened: string[] = [];
  const abrir: GateAbrir = {
    abrir: async (sid, _mine, call) => {
      opened.push(`${sid}:${call.papel}`);
      return { kind: 'text', text: 'aberta' };
    },
  };
  const gateWith = (forward: GateForward) =>
    createGateHandler({ sessionsDir: sessions, ledger: () => ledger, picture: local.get, pcAway: local.away, pictureWithoutPc: local.withoutPc, forward, serverVersion: 'teste', recados, abrir, timeouts: { localAnswerMs: 50 } });
  let handle = gateWith(async (_port, request) => {
    forwarded.push(request.body);
    return new Promise(() => undefined);
  });
  const tool = async (sid: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await handle({ method: 'POST', path: `/s/${sid}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const result = (JSON.parse(res.body) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { error: result.isError === true, text: result.content[0]!.text };
  };
  const endTurn = async (sid: string): Promise<{ decision?: string; reason?: string }> =>
    JSON.parse((await recados.hook('fim-de-turno', { 'x-donel-tmux': `donel-${sid}` }, JSON.stringify({ session_id: sid }))).body) as { decision?: string; reason?: string };
  return {
    dir,
    sessions,
    clock,
    stored,
    live,
    folder,
    local,
    ledger,
    relay,
    tool,
    endTurn,
    forwarded,
    opened,
    screens,
    killed,
    setForward: (forward: GateForward) => {
      handle = gateWith(forward);
    },
  };
}

const idOf = (text: string): string => (JSON.parse(text) as { id: string }).id;

describe('o Líder único no tmux da VPS, com o PC fora', () => {
  it('sabe quem é, cria tarefa e manda recado pelas setas, sem tocar o túnel do PC', async () => {
    const w = vps();
    const who = await w.tool(SID_LIDER, 'sessao_quem_sou');
    expect(who.error, who.text).toBe(false);
    expect(JSON.parse(who.text)).toMatchObject({ liderUnico: true, papel: 'lider' });

    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'Sem PC', pedido: 'O Oráculo é o básico', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    expect(w.ledger.load().doc.tasks[idOf(created.text)]).toMatchObject({ projectPath: PROJECT, ownerPlaceId: DEV });

    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: 'pegue a tarefa nova' });
    expect(sent.error, sent.text).toBe(false);
    expect(JSON.parse(sent.text)).toMatchObject({ entregue: 'na-fila', para: DEV });
    expect((await w.endTurn(SID_DEV)).reason).toContain('pegue a tarefa nova');

    const listed = await w.tool(SID_LIDER, 'sessao_listar', { quadro: 'atlas' });
    expect(listed.error, listed.text).toBe(false);
    expect(JSON.parse(listed.text)).toEqual([expect.objectContaining({ id: DEV })]);
    expect(w.forwarded, 'nada ficou pendurado no túnel do PC').toEqual([]);
  });

  it('recado do Líder único a um lugar sem dizer o quadro (os 9 presos do carteiro de 19/11): o quadro é o do lugar', async () => {
    const w = vps();
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { para: DEV, texto: 'pegue a tarefa nova', tarefa: 't-a670a96d' });
    expect(sent.error, sent.text).toBe(false);
    expect(JSON.parse(sent.text)).toMatchObject({ entregue: 'na-fila', para: DEV });
    expect((await w.endTurn(SID_DEV)).reason).toContain('pegue a tarefa nova');
    // A place no board of the picture has: the boards it knows.
    const unknown = await w.tool(SID_LIDER, 'sessao_enviar', { para: 'place:nenhum', texto: 'oi' });
    expect(unknown.error).toBe(true);
    expect(unknown.text).toContain('atlas');
    expect(w.forwarded).toEqual([]);
  });

  it('recado a quem o Líder único não alcança é recusado com o motivo; quadro desconhecido diz os que conhece', async () => {
    const w = vps();
    const BOSS = 'place:boss';
    const board: MindscapeBoard = { ...BOARD, cards: { ...BOARD.cards, [BOSS]: card(BOSS, 'lider') }, links: [{ id: 'l1', from: 'place:x', to: DEV, arrow: true }] };
    // DEV below an owner's arrow from a place that is not the top: the Líder único reaches only the top and below it.
    const boardWithX: MindscapeBoard = { ...board, cards: { ...board.cards, 'place:x': card('place:x', 'dev') }, links: [{ id: 'l1', from: 'place:x', to: DEV, arrow: true }, { id: 'l2', from: DEV, to: 'place:x', arrow: true }] };
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, board: boardWithX, listar: [...LISTAR, { id: 'place:x', papel: 'dev', estado: 'trabalhando' }, { id: BOSS, papel: 'lider', estado: 'trabalhando' }] } } };
    const refused = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: 'oi' });
    expect(refused.error).toBe(true);
    expect(refused.text).toContain('Sem ligação');
    const unknown = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'beacon', para: DEV, texto: 'oi' });
    expect(unknown).toMatchObject({ error: true });
    expect(unknown.text).toContain('atlas');
    expect(w.forwarded).toEqual([]);
  });

  it('com o PC fora, outra ferramenta de uma sessão que o PC conhece ainda tenta o PC (o navegador mora lá)', async () => {
    const w = vps();
    w.setForward(async (_port, request) => {
      w.forwarded.push(request.body);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"do PC"}]}}' };
    });
    expect(await w.tool(SID_DEV, 'quadro_ler')).toEqual({ error: false, text: 'do PC' });
    expect(await w.tool(SID_DEV, 'tarefa_listar')).toMatchObject({ error: false });
    expect(w.forwarded).toHaveLength(1);
  });

  it('sessao_abrir abre aqui (abrir-local), sem esperar o túnel', async () => {
    const w = vps();
    const answer = await w.tool(SID_LIDER, 'sessao_abrir', { papel: 'dev', pedido: 'faz', quadro: 'atlas' });
    expect(answer).toEqual({ error: false, text: 'aberta' });
    expect(w.opened).toEqual([`${SID_LIDER}:dev`]);
    expect(w.forwarded).toEqual([]);
  });
});

describe('sessão aberta na VPS depois que o PC sumiu', () => {
  it('o Dev aberto pelo Líder único entra no quadro guardado, recebe tarefa, manda andamento e responde a quem o abriu', async () => {
    const w = vps();
    w.folder(SID_NOVO, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev correção', roleId: 'dev', openedBy: 'lider', createdAt: '2026-11-19T11:50:32Z' });

    const who = await w.tool(SID_NOVO, 'sessao_quem_sou');
    expect(who.error, who.text).toBe(false);
    expect(JSON.parse(who.text)).toMatchObject({ lugar: NOVO, pasta: PROJECT, papel: 'dev' });

    // The Líder único sees it on the board and reaches it (top of the board: no arrow points to it).
    const listed = JSON.parse((await w.tool(SID_LIDER, 'sessao_listar', { quadro: 'atlas' })).text) as Array<{ id: string; abertaPor?: string }>;
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ id: NOVO, abertaPor: 'lider' })]));
    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: NOVO, titulo: 'Corrigir', pedido: 'corrija', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);

    expect((await w.tool(SID_NOVO, 'tarefa_assumir', { id })).error).toBe(false);
    const step = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'teste vermelho' });
    expect(step.error, step.text).toBe(false);
    expect(w.ledger.load().doc.tasks[id]).toMatchObject({ ownerPlaceId: NOVO });

    const back = await w.tool(SID_NOVO, 'sessao_enviar', { para: 'quem-me-abriu', texto: 'comecei', motivo: 'bloqueio' });
    expect(back.error, back.text).toBe(false);
    expect((await w.endTurn(SID_LIDER)).reason).toContain('comecei');
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: NOVO, texto: 'segue' });
    expect(sent.error, sent.text).toBe(false);
    expect((await w.endTurn(SID_NOVO)).reason).toContain('segue');
    expect(w.forwarded).toEqual([]);
  });

  it('aberta por um lugar do quadro: entra com a seta de abertura dele, e os dois conversam', async () => {
    const w = vps();
    w.folder(SID_REV, { localCwd: PROJECT, projectName: 'atlas', name: 'Revisor', roleId: 'revisor', openedBy: DEV, createdAt: '2026-11-19T11:55:00Z' });
    const pictured = w.local.get()!;
    expect(pictured.sessoes[SID_REV]!.board!.links).toEqual(expect.arrayContaining([expect.objectContaining({ from: DEV, to: REV, arrow: true, opened: true })]));
    // The Dev the PC pictured sees the new place too.
    expect(pictured.sessoes[SID_DEV]!.board!.cards[REV]).toMatchObject({ kind: 'session', sessionId: SID_REV });

    const toRev = await w.tool(SID_DEV, 'sessao_enviar', { para: REV, texto: 'revise o PR' });
    expect(toRev.error, toRev.text).toBe(false);
    expect((await w.endTurn(SID_REV)).reason).toContain('revise o PR');
    const toDev = await w.tool(SID_REV, 'sessao_enviar', { para: 'quem-me-abriu', texto: 'aprovado' });
    expect(toDev.error, toDev.text).toBe(false);
    expect((await w.endTurn(SID_DEV)).reason).toContain('aprovado');
    expect(w.forwarded).toEqual([]);
  });

  it('duas sessões que o PC nunca viu, uma aberta pela outra: a seta de abertura entra em qualquer ordem (revisão do #501)', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    const stored: BoardPicture = { at: now - 10 * MIN, sessoes: { [SID_DEV]: { quemSou: { pasta: PROJECT, lugar: DEV, papel: 'dev' }, listar: LISTAR, board: BOARD } } };
    const opener = { sid: SID_NOVO, localCwd: PROJECT, roleId: 'dev', openedBy: 'lider' };
    const opened = { sid: SID_REV, localCwd: PROJECT, roleId: 'revisor', openedBy: NOVO };
    for (const folders of [[opener, opened], [opened, opener]]) {
      const links = withLocalSessions(stored, folders, now)!.sessoes[SID_DEV]!.board!.links;
      expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ from: NOVO, to: REV, arrow: true, opened: true })]));
    }
  });

  it('pasta de sessão fechada (sem tmux) não vira lugar', () => {
    const w = vps();
    w.folder(SID_NOVO, { localCwd: PROJECT, roleId: 'dev', openedBy: 'lider' });
    w.live.delete(SID_NOVO);
    expect(w.local.get()!.sessoes[SID_NOVO]).toBeUndefined();
  });
});

describe('com o PC ligado, o retrato do PC manda', () => {
  it('push ou sonda recente: o Líder que o PC mostra e a sessão recém-aberta seguem ao PC, como hoje', async () => {
    const w = vps({ pcSeenAgoMs: 30_000 });
    const pcLider: PictureSession = { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [], at: w.clock.now - 30_000 };
    w.stored.picture = { ...w.stored.picture!, sessoes: { ...w.stored.picture!.sessoes, [SID_LIDER]: pcLider } };
    // Born 1 min ago: the PC pictures it within the minute.
    w.folder(SID_NOVO, { localCwd: PROJECT, roleId: 'dev', openedBy: 'lider', createdAt: new Date(w.clock.now - MIN).toISOString() });
    expect(w.local.get()).toBe(w.stored.picture);
    w.setForward(async (_port, request) => {
      w.forwarded.push(request.body);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"do PC"}]}}' };
    });
    expect(await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: DEV, pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' })).toEqual({ error: false, text: 'do PC' });
    expect(await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: 'oi' })).toEqual({ error: false, text: 'do PC' });
    expect(w.forwarded).toHaveLength(2);
  });

  it('o PC ligado não conhece o Líder único aberto no tmux há mais de 5 min (o caso de 19/11): ele é atendido aqui', async () => {
    const w = vps({ pcSeenAgoMs: 30_000 });
    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'x', pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    expect(w.forwarded).toEqual([]);
  });

  it('o Líder único com retrato feito aqui e o PC não fora: ver_tela e fechar vão ao túnel; túnel recusado cai aqui', async () => {
    // 19/11 15h: the app reopened, the Líder's tunnel answers, but the probe never pictured him and his local picture
    // answered "O PC está desligado" to everything only the PC does.
    const w = vps({ pcSeenAgoMs: 30_000 });
    expect(w.local.get()!.sessoes[SID_LIDER]).toMatchObject({ local: true, quemSou: { liderUnico: true } });
    w.setForward(async (_port, request) => {
      w.forwarded.push(request.body);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"do PC"}]}}' };
    });
    expect(await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV })).toEqual({ error: false, text: 'do PC' });
    expect(await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: DEV })).toEqual({ error: false, text: 'do PC' });
    expect(w.forwarded).toHaveLength(2);
    // What is answered here stays here (his tunnel may connect and never answer, the case of 07h34).
    expect((await w.tool(SID_LIDER, 'sessao_quem_sou')).error).toBe(false);
    expect(w.forwarded).toHaveLength(2);
    // The tunnel refused: answered here, as before.
    w.setForward(async () => 'desligado');
    const off = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV });
    expect(off.error).toBe(true);
    expect(off.text).toMatch(/PC está desligado/);
  });

  it('o Líder único com o PC fora: ver_tela não toca o túnel', async () => {
    const w = vps();
    const off = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV });
    expect(off.error).toBe(true);
    expect(w.forwarded).toEqual([]);
  });

  it('o PC ligado mas o túnel da sessão recém-aberta recusa: ela se identifica pelo que a VPS tem', async () => {
    const w = vps({ pcSeenAgoMs: 30_000 });
    w.folder(SID_NOVO, { localCwd: PROJECT, roleId: 'dev', openedBy: 'lider', createdAt: new Date(w.clock.now - MIN).toISOString() });
    w.setForward(async () => 'desligado');
    const who = await w.tool(SID_NOVO, 'sessao_quem_sou');
    expect(who.error, who.text).toBe(false);
    expect(JSON.parse(who.text)).toMatchObject({ lugar: NOVO });
  });

  it('quando o PC foi visto: o push dele ou a sonda que ele respondeu; nunca um retrato feito aqui', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    const session: PictureSession = { quemSou: { lugar: DEV, pasta: PROJECT }, listar: [] };
    expect(pcSeenAt({ at: now - 10 * MIN, sessoes: { a: { ...session, at: now - MIN } } })).toBe(now - MIN);
    expect(pcSeenAt({ at: now - 10 * MIN, sessoes: { a: { ...session, at: now, local: true } } })).toBe(now - 10 * MIN);
    expect(pcAway(null, now)).toBe(true);
    expect(pcAway({ at: now - MIN, sessoes: {} }, now)).toBe(false);
    // Between two probes (2,5 min with the PC well) it is not away.
    expect(pcAway({ at: now - 150_000, sessoes: {} }, now)).toBe(false);
    expect(withLocalSessions({ at: now, sessoes: {} }, [{ sid: SID_LIDER, leaderOfAll: true }], now)!.sessoes[SID_LIDER]).toMatchObject({ local: true, quemSou: { liderUnico: true } });
    // A session sessao_abrir opened here with the PC off is not the PC answering.
    const opened = syntheticPicture({ sid: SID_NOVO, name: 'Dev', role: { id: 'dev', name: 'Dev' }, pasta: PROJECT, projectName: 'atlas', roda: 'vps', base: undefined, at: now });
    expect(pcSeenAt({ at: now - 10 * MIN, sessoes: { [SID_NOVO]: opened } })).toBe(now - 10 * MIN);
  });
});

// t-d461e003 (19/11, ~15h04): o app do PC fechou logo depois de renovar uma sessão da VPS (limite de contexto: sid
// novo, mesmo lugar). O retrato guardado conhecia o lugar pelo sid antigo; a pasta nova virou `session:<sid>`, e daí
// "Só o lugar dono" nas tarefas, recado ao Líder único sem a regra do PC, e o Líder sem ver a tela nem fechar.
describe('sessão renovada na VPS com o PC fora (t-d461e003)', () => {
  /**
   * The PC's last picture names the Dev's place (with its tab name), opened by a Líder of the board that has closed
   * since (the case of 19/11: place:8be0d000, opened by place:bb9bfae3); its sid then renews, and the old tmux is gone.
   */
  const LQ = 'place:lq';
  function renewed(meta: Record<string, unknown> = {}) {
    const w = vps();
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    const board: MindscapeBoard = { ...BOARD, cards: { ...BOARD.cards, [LQ]: card(LQ, 'lider') }, links: [{ id: 'a', from: LQ, to: DEV, arrow: true, by: 'session', opened: true }] };
    const listar = [
      { id: DEV, papel: 'dev', nome: 'Dev · atlas', estado: 'trabalhando', abertaPor: LQ, voce: true },
      { id: LQ, papel: 'lider', estado: 'fechada' },
    ];
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, listar, board } } };
    w.live.delete(SID_DEV);
    w.folder(SID_NOVO, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', openedBy: LQ, createdAt: '2026-11-19T11:59:30Z', ...meta });
    return w;
  }

  it('segue o mesmo place:, assume e reporta a tarefa do lugar e fala com o Líder único', async () => {
    const w = renewed();
    const who = JSON.parse((await w.tool(SID_NOVO, 'sessao_quem_sou')).text) as Record<string, unknown>;
    expect(who).toMatchObject({ lugar: DEV, pasta: PROJECT });

    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'x', pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);
    expect(await w.tool(SID_NOVO, 'tarefa_assumir', { id })).toMatchObject({ error: false });
    const step = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'teste' });
    expect(step.error, step.text).toBe(false);

    // Who opened it closed and the board has no live Líder: the Líder único is who hears it, so it may speak to him.
    const up = await w.tool(SID_NOVO, 'sessao_enviar', { para: 'lider', texto: 'entreguei', motivo: 'tarefa-completa' });
    expect(up.error, up.text).toBe(false);
    expect((await w.endTurn(SID_LIDER)).reason).toContain('entreguei');
    expect(w.forwarded).toEqual([]);
  });

  it('o lugar que o app gravou na pasta (placeId) vale; dois candidatos ou um lugar com outra sessão viva: session:', () => {
    const named = renewed({ placeId: DEV, name: 'outro nome' });
    expect(named.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(DEV);

    const twins = renewed();
    twins.folder(SID_REV, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', openedBy: LQ, createdAt: '2026-11-19T11:59:40Z' });
    expect(twins.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);

    const taken = renewed();
    taken.live.add(SID_DEV);
    expect(taken.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });

  it('com quem a abriu vivo, o recado ao Líder único é recusado (como no PC)', async () => {
    const w = renewed();
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    const listar = dev.listar.map((entry) => ((entry as { id: string }).id === LQ ? { id: LQ, papel: 'lider', estado: 'trabalhando' } : entry));
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, listar } } };
    const up = await w.tool(SID_NOVO, 'sessao_enviar', { para: 'lider', texto: 'oi', motivo: 'bloqueio' });
    expect(up.error).toBe(true);
    expect(up.text).toContain('Sem ligação com o Líder único');
  });

  it('o Líder único vê a tela e fecha uma sessão da VPS; nunca no meio de um turno', async () => {
    const w = vps();
    w.screens.set(SID_DEV, '\x1b[1mfiz o teste vermelho\x1b[0m\n> ');
    const seen = await w.tool(SID_LIDER, 'sessao_ver_tela', { quem: DEV, quadro: 'atlas' });
    expect(seen.error, seen.text).toBe(false);
    expect(seen.text).toContain('fiz o teste vermelho');
    expect(seen.text).not.toContain('\x1b');

    w.screens.set(SID_DEV, 'esc to interrupt');
    const busy = await w.tool(SID_LIDER, 'sessao_fechar', { quem: DEV, quadro: 'atlas' });
    expect(busy.error).toBe(true);
    expect(busy.text).not.toContain('PC está desligado');
    expect(w.killed).toEqual([]);

    w.screens.set(SID_DEV, '> ');
    expect(await w.tool(SID_LIDER, 'sessao_fechar', { quem: DEV, quadro: 'atlas' })).toEqual({ error: false, text: 'Fechada.' });
    expect(w.killed).toEqual([SID_DEV]);
    expect(w.forwarded).toEqual([]);
  });
});
