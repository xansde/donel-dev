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
import { RENEW_MARK } from '../src/oraculo/renovar-local';
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
    expect(w.killed).toEqual([]);
    // The tunnel refused: answered here, by this machine's tmux (t-d461e003).
    w.setForward(async () => 'desligado');
    w.screens.set(SID_DEV, 'fiz o teste vermelho\n> ');
    const off = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV });
    expect(off.error, off.text).toBe(false);
    expect(off.text).toContain('fiz o teste vermelho');
  });

  it('o Líder único com o PC fora: ver_tela e fechar pelo tmux daqui, sem tocar o túnel', async () => {
    const w = vps();
    // r-4f20422c — the PC's last list says "parada"; the screen says a turn runs. The screen wins.
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, listar: [{ ...LISTAR[0]!, estado: 'parada' }] } } };
    const RULE = '─'.repeat(40);
    w.screens.set(SID_DEV, `● lendo o código\n\n✻ Cogitating… (12s · ↓ 300 tokens)\n${RULE}\n❯ \n${RULE}\n  ⏵⏵ bypass permissions on\n`);
    const busy = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV });
    expect(busy.error, busy.text).toBe(false);
    expect(JSON.parse(busy.text)).toMatchObject({ id: DEV, estado: 'trabalhando' });
    w.screens.set(SID_DEV, `fiz o teste vermelho\n\n✻ Worked for 26s\n${RULE}\n❯ \n${RULE}\n  ? for shortcuts\n`);
    const seen = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: DEV });
    expect(seen.error, seen.text).toBe(false);
    expect(seen.text).toContain('fiz o teste vermelho');
    expect(JSON.parse(seen.text)).toMatchObject({ estado: 'parada' });
    expect(await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: DEV })).toEqual({ error: false, text: 'Fechada.' });
    expect(w.killed).toEqual([SID_DEV]);
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
    const w = renewed({ placeId: DEV });
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

  // Corte do Líder único (19/11): o lugar só vem do placeId gravado e conferido no quadro; nunca por nome, papel ou
  // quem abriu. "Matar a sessão errada é pior do que perder o lugar."
  it('placeId válido (no quadro, aberto, sem dona viva): o place:', () => {
    const named = renewed({ placeId: DEV, name: 'outro nome' });
    expect(named.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(DEV);
  });

  it('sem placeId: session:, mesmo com um único lugar de mesmo nome, papel e quem abriu', () => {
    const w = renewed();
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });

  it('placeId fora do quadro: session:', () => {
    const w = renewed({ placeId: 'place:nada' });
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });

  it('placeId de lugar fechado: session:', () => {
    const w = renewed({ placeId: LQ });
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });

  it('placeId ocupado por outra sessão viva: session:', () => {
    const w = renewed({ placeId: DEV });
    w.live.add(SID_DEV);
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });

  // 1ª renovação real sem PC (20/11): 06:19 detectou 9c10729a, 06:20:27 abriu a sucessora (meta com placeId e renovaDe),
  // 06:20:54 a sucessora chamou tarefa_andamento e o Oráculo recusou ("Só o lugar dono registra"): a velha, ainda viva
  // até 06:22, segurava o lugar no retrato guardado, e a sucessora era session:<sid>. Condição do Líder único
  // (r-ded62192): um dono só. Da passagem pronta em diante, com a sucessora viva, ela é a dona e a velha só termina o turno.
  const RENOVADA = 'esta sessão foi renovada; quem responde pelo lugar agora é';
  const markOf = (w: ReturnType<typeof vps>, sid: string, passo: string, extra: Record<string, unknown> = {}): void =>
    writeFileSync(join(w.sessions, sid, RENEW_MARK), `${JSON.stringify({ passo, em: '2026-11-19T11:59:00Z', ...extra })}\n`);
  const lugarOf = (w: ReturnType<typeof vps>, sid: string): unknown => w.local.get()!.sessoes[sid]?.quemSou.lugar;
  const successorMeta = (renovaDe: string, extra: Record<string, unknown> = {}) => ({ localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', placeId: DEV, renovaDe, createdAt: '2026-11-19T11:59:30Z', ...extra });
  async function taskOfDev(w: ReturnType<typeof vps>, assumes: string): Promise<string> {
    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'x', pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);
    expect(await w.tool(assumes, 'tarefa_assumir', { id })).toMatchObject({ error: false });
    return id;
  }

  it('sequência de 20/11: depois da passagem pronta a sucessora é a dona do lugar, e a velha não registra mais', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    // Pedida a passagem: a velha segue dona.
    markOf(w, SID_DEV, 'pediu');
    expect(await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'escrevo a passagem' })).toMatchObject({ error: false });

    markOf(w, SID_DEV, 'pronta');
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    const who = JSON.parse((await w.tool(SID_NOVO, 'sessao_quem_sou')).text) as Record<string, unknown>;
    expect(who).toMatchObject({ lugar: DEV, pasta: PROJECT });
    expect(lugarOf(w, SID_DEV)).not.toBe(DEV);
    const old = JSON.parse((await w.tool(SID_DEV, 'sessao_quem_sou')).text) as Record<string, unknown>;
    expect(JSON.stringify(old)).toContain(`${RENOVADA} 33333333`);

    const fromNew = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'li a passagem' });
    expect(fromNew.error, fromNew.text).toBe(false);
    for (const [name, args] of [
      ['tarefa_andamento', { id, estado: 'trabalhando', proximo: 'passei o bastão' }],
      ['tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: 'feito' }] }],
      ['tarefa_assumir', { id }],
      ['tarefa_criar', { dono: DEV, titulo: 'y', pedido: 'y', criterio: 'y', prazo: '2026-11-30', risco: 'baixo' }],
    ] as const) {
      const refused = await w.tool(SID_DEV, name, args);
      expect(refused.error, `${name}: ${refused.text}`).toBe(true);
      expect(refused.text).toContain(`${RENOVADA} 33333333`);
    }
    // Reading still answers.
    expect(await w.tool(SID_DEV, 'tarefa_ver', { id })).toMatchObject({ error: false });

    // A recado to the place reaches the successor, never the old one.
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: 'no meio da troca', motivo: 'bloqueio' });
    expect(sent.error, sent.text).toBe(false);
    expect((await w.endTurn(SID_NOVO)).reason).toContain('no meio da troca');
    expect((await w.endTurn(SID_DEV)).reason ?? '').not.toContain('no meio da troca');

    // The old one closed (06:22): the successor keeps the place and delivers.
    markOf(w, SID_DEV, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(SID_DEV);
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    const delivered = await w.tool(SID_NOVO, 'tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: 'npm run verify: 0 falhas' }] });
    expect(delivered.error, delivered.text).toBe(false);
    expect(w.forwarded).toEqual([]);
  });

  it('desistência que fecha a sucessora devolve o lugar à velha; "duas vivas" deixa a sucessora dona até o Líder decidir', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    expect((await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'x' })).error).toBe(true);

    // "duas vivas no lugar" (lasting): both stay alive, the successor stays the owner.
    markOf(w, SID_DEV, 'desistiu', { motivo: 'duas vivas no lugar: …', permanente: true, sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    expect(lugarOf(w, SID_DEV)).not.toBe(DEV);
    expect((await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'x' })).text).toContain(RENOVADA);

    // The successor closed (a give-up that kills it, or the Líder's call): the old one is the owner again.
    w.live.delete(SID_NOVO);
    markOf(w, SID_DEV, 'desistiu', { motivo: 'a nova não respondeu', ate: '2026-11-19T12:30:00Z', tentativas: 1, sucessora: SID_NOVO });
    expect(lugarOf(w, SID_DEV)).toBe(DEV);
    const back = await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'sigo eu' });
    expect(back.error, back.text).toBe(false);
  });

  it('cadeia sem PC (A → B → C): a 2ª renovação dá o lugar a C e tira de B pelo mesmo critério', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    markOf(w, SID_DEV, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(SID_DEV);
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);

    // C opened beside B before B's mark says the handoff is ready (never in the renewal's order): B keeps the place.
    w.folder(SID_REV, successorMeta(SID_NOVO, { createdAt: '2026-11-19T11:59:50Z' }));
    expect([lugarOf(w, SID_NOVO), lugarOf(w, SID_REV)]).toEqual([DEV, REV]);

    markOf(w, SID_NOVO, 'pronta');
    expect([lugarOf(w, SID_NOVO), lugarOf(w, SID_REV)]).toEqual([NOVO, DEV]);
    markOf(w, SID_NOVO, 'abriu', { sucessora: SID_REV });
    expect(lugarOf(w, SID_REV)).toBe(DEV);
    expect(lugarOf(w, SID_NOVO)).not.toBe(DEV);
    const fromB = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'x' });
    expect(fromB.error).toBe(true);
    expect(fromB.text).toContain(`${RENOVADA} 44444444`);
    const fromC = await w.tool(SID_REV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'li a passagem' });
    expect(fromC.error, fromC.text).toBe(false);
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: 'para a C', motivo: 'bloqueio' });
    expect(sent.error, sent.text).toBe(false);
    expect((await w.endTurn(SID_REV)).reason).toContain('para a C');
    expect((await w.endTurn(SID_NOVO)).reason ?? '').not.toContain('para a C');

    w.live.delete(SID_NOVO);
    expect(lugarOf(w, SID_REV)).toBe(DEV);
  });

  it('papel diferente não herda o lugar pelo renovaDe; a velha segue dona', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    w.folder(SID_NOVO, successorMeta(SID_DEV, { roleId: 'revisor' }));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(NOVO);
    expect(lugarOf(w, SID_DEV)).toBe(DEV);
    const fromOld = await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'sigo eu' });
    expect(fromOld.error, fromOld.text).toBe(false);
  });

  it('renovaDe não é passe-livre: sem ele, de outra sessão, ou com duas sucessoras, session:', () => {
    const without = vps();
    without.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:30Z' });
    expect(without.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);

    const other = vps();
    other.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, renovaDe: SID_LIDER, createdAt: '2026-11-19T11:59:30Z' });
    expect(other.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);

    const twins = vps();
    twins.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, renovaDe: SID_DEV, createdAt: '2026-11-19T11:59:30Z' });
    twins.folder(SID_REV, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, renovaDe: SID_DEV, createdAt: '2026-11-19T11:59:40Z' });
    const sessoes = twins.local.get()!.sessoes;
    expect([sessoes[SID_NOVO]!.quemSou.lugar, sessoes[SID_REV]!.quemSou.lugar]).toEqual([NOVO, REV]);
    expect(sessoes[SID_DEV]!.quemSou.lugar).toBe(DEV);
  });

  // Revisão da r2 do #540: o PC volta no meio da troca. A sucessora tem menos de 5 min e o PC ainda não a retratou;
  // depois o PC a retrata como session:<nova>. Em nenhum momento as duas registram: a marca da velha manda.
  it('PC voltando no meio da troca: a sucessora segue a única dona, antes e depois de o PC retratá-la como session:', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    markOf(w, SID_DEV, 'pronta');
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    const owners = async (step: string): Promise<void> => {
      expect(w.local.get()!.sessoes[SID_DEV]!.renovadaPara, step).toBe(SID_NOVO);
      expect(lugarOf(w, SID_DEV), step).not.toBe(DEV);
      const fromOld = await w.tool(SID_DEV, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: `${step} velha` });
      expect(fromOld.error, `${step}: ${fromOld.text}`).toBe(true);
      expect(fromOld.text).toContain(`${RENOVADA} 33333333`);
      const fromNew = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: `${step} nova` });
      expect(fromNew.error, `${step}: ${fromNew.text}`).toBe(false);
      const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: DEV, texto: `recado ${step}`, motivo: 'bloqueio' });
      expect(sent.error, sent.text).toBe(false);
      expect((await w.endTurn(SID_NOVO)).reason, step).toContain(`recado ${step}`);
      expect((await w.endTurn(SID_DEV)).reason ?? '', step).not.toContain(`recado ${step}`);
    };

    // The PC is back (a fresh push without the successor) and the successor's tunnel refuses.
    w.stored.picture = { at: w.clock.now - 1000, sessoes: { [SID_DEV]: { ...dev, at: w.clock.now - 1000 } } };
    w.setForward(async () => 'desligado');
    expect(w.local.away()).toBe(false);
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    expect(w.local.withoutPc(SID_NOVO)!.sessoes[SID_DEV]!.renovadaPara).toBe(SID_NOVO);
    await owners('PC de volta');

    // The PC pictures the successor as a loose conversation (session:<nova>): still one owner, the successor.
    const loose: PictureSession = { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: NOVO, papel: 'dev' }, listar: [...LISTAR, { id: NOVO, papel: 'dev', estado: 'trabalhando' }], board: BOARD, at: w.clock.now - 500 };
    w.stored.picture = { at: w.clock.now - 500, sessoes: { [SID_DEV]: { ...dev, at: w.clock.now - 500 }, [SID_NOVO]: loose } };
    expect(lugarOf(w, SID_NOVO)).toBe(DEV);
    await owners('PC retratou a nova');

    // "duas vivas" lasting, with the PC on: the successor stays the owner.
    markOf(w, SID_DEV, 'desistiu', { motivo: 'duas vivas no lugar: o PC voltou', permanente: true, sucessora: SID_NOVO });
    await owners('duas vivas');
  });

  // Revisão da r2 do #540: o ensaio do Líder é uma sessão aberta aqui com o PC fora (placeId session:<A>, do abrir-local),
  // que nunca entra nos quadros do retrato guardado. A sucessora fica com session:<A>, inclusive depois que A fecha.
  it('sessão aberta sem PC (placeId session:<A>) renovada: a sucessora vira dona de session:<A>, e segue depois que A fecha', async () => {
    const w = vps();
    const A = '88888888-2222-4333-8444-555555555555';
    const PLACE_A = `session:${A}`;
    w.folder(A, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', openedBy: SID_LIDER, placeId: PLACE_A, createdAt: '2026-11-19T11:00:00Z' });
    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: PLACE_A, titulo: 'x', pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);
    expect(await w.tool(A, 'tarefa_assumir', { id })).toMatchObject({ error: false });

    markOf(w, A, 'pronta');
    w.folder(SID_NOVO, successorMeta(A, { placeId: PLACE_A, openedBy: SID_LIDER }));
    markOf(w, A, 'abriu', { sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(PLACE_A);
    expect(lugarOf(w, A)).not.toBe(PLACE_A);
    expect(w.local.get()!.sessoes[A]!.renovadaPara).toBe(SID_NOVO);

    const fromOld = await w.tool(A, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'velha' });
    expect(fromOld.error, fromOld.text).toBe(true);
    expect(fromOld.text).toContain(`${RENOVADA} 33333333`);
    const fromNew = await w.tool(SID_NOVO, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: 'li a passagem' });
    expect(fromNew.error, fromNew.text).toBe(false);
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: PLACE_A, texto: 'para a nova', motivo: 'bloqueio' });
    expect(sent.error, sent.text).toBe(false);
    expect((await w.endTurn(SID_NOVO)).reason).toContain('para a nova');
    expect((await w.endTurn(A)).reason ?? '').not.toContain('para a nova');

    // A closed: the successor still answers for session:<A> and delivers.
    markOf(w, A, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(A);
    expect(lugarOf(w, SID_NOVO)).toBe(PLACE_A);
    const delivered = await w.tool(SID_NOVO, 'tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: 'npm run verify: 0 falhas' }] });
    expect(delivered.error, delivered.text).toBe(false);
    const later = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: PLACE_A, texto: 'depois do fim', motivo: 'bloqueio' });
    expect(later.error, later.text).toBe(false);
    expect((await w.endTurn(SID_NOVO)).reason).toContain('depois do fim');
  });

  // Ensaio 2 de 20/11 (06:17, 73ae7389 → 3b265823): a velha aberta sem PC fica no retrato guardado (abrir-local) com o
  // lugar session:<A>, e a sucessora herda esse lugar. Quem o PC retratou (o Dev de place:8be0d000) via no sessao_listar
  // o session:<A> duas vezes: uma pela velha guardada, outra pela sucessora.
  it('sessão aberta sem PC renovada: o sessao_listar de outra sessão do quadro mostra o lugar uma vez, com a sucessora', async () => {
    const w = vps();
    const A = '88888888-2222-4333-8444-555555555555';
    const PLACE_A = `session:${A}`;
    w.folder(A, { localCwd: PROJECT, projectName: 'atlas', name: 'Ensaio · atlas', roleId: 'dev', openedBy: 'lider', placeId: PLACE_A, createdAt: '2026-11-19T11:00:00Z' });
    const openedHere = syntheticPicture({ sid: A, name: 'Ensaio · atlas', role: { id: 'dev', name: 'Dev' }, pasta: PROJECT, projectName: 'atlas', roda: 'vps', base: { listar: LISTAR, board: BOARD }, at: w.clock.now - 30 * MIN, openedBy: 'lider' });
    w.stored.picture = { ...w.stored.picture!, sessoes: { ...w.stored.picture!.sessoes, [A]: { ...openedHere, local: true } } };
    const once = async (step: string): Promise<void> => {
      for (const viewer of [SID_DEV, SID_NOVO]) {
        const listed = JSON.parse((await w.tool(viewer, 'sessao_listar')).text) as { id?: string }[];
        expect(listed.filter((place) => place.id === PLACE_A), `${step}, visto de ${viewer.slice(0, 8)}`).toHaveLength(1);
      }
      const card = w.local.get()!.sessoes[SID_DEV]!.board!.cards[PLACE_A];
      expect(card?.kind === 'session' ? card.sessionId : undefined, step).toBe(SID_NOVO);
    };

    markOf(w, A, 'pronta');
    w.folder(SID_NOVO, successorMeta(A, { placeId: PLACE_A, openedBy: 'lider', name: 'Ensaio · atlas' }));
    markOf(w, A, 'abriu', { sucessora: SID_NOVO });
    expect(lugarOf(w, SID_NOVO)).toBe(PLACE_A);
    await once('velha viva, passagem pronta');

    markOf(w, A, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(A);
    expect(lugarOf(w, SID_NOVO)).toBe(PLACE_A);
    await once('velha fechada');
  });

  // Revisão da r3 do #540: com a velha JÁ fechada, o PC volta e adota a sucessora como session:<nova>
  // (adoptSessionOpenedWithoutPc). Ela segue dona do lugar herdado; o lugar nunca fica sem dono.
  const looseOf = (sid: string): PictureSession => ({ quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: `session:${sid}`, papel: 'dev' }, listar: [...LISTAR, { id: `session:${sid}`, papel: 'dev', estado: 'trabalhando' }], board: BOARD, at: 0 });
  const ownsTask = async (w: ReturnType<typeof vps>, sid: string, id: string, place: string, step: string): Promise<void> => {
    expect(lugarOf(w, sid), step).toBe(place);
    const fromNew = await w.tool(sid, 'tarefa_andamento', { id, estado: 'trabalhando', proximo: step });
    expect(fromNew.error, `${step}: ${fromNew.text}`).toBe(false);
    const sent = await w.tool(SID_LIDER, 'sessao_enviar', { quadro: 'atlas', para: place, texto: `recado ${step}`, motivo: 'bloqueio' });
    expect(sent.error, sent.text).toBe(false);
    expect((await w.endTurn(sid)).reason, step).toContain(`recado ${step}`);
  };

  it('fecha a velha, depois o PC volta e adota a sucessora como session:<nova>: ela segue dona do lugar', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    markOf(w, SID_DEV, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(SID_DEV);
    await ownsTask(w, SID_NOVO, id, DEV, 'sem PC');

    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    w.stored.picture = { at: w.clock.now - 500, sessoes: { [SID_DEV]: dev, [SID_NOVO]: { ...looseOf(SID_NOVO), at: w.clock.now - 500 } } };
    expect(w.local.away()).toBe(false);
    await ownsTask(w, SID_NOVO, id, DEV, 'PC adotou');
    expect(w.forwarded).toEqual([]);
  });

  it('PC ligado retratou a sucessora como session:<nova> na troca; a velha fecha depois: a sucessora segue dona', async () => {
    const w = vps();
    const id = await taskOfDev(w, SID_DEV);
    w.folder(SID_NOVO, successorMeta(SID_DEV));
    markOf(w, SID_DEV, 'abriu', { sucessora: SID_NOVO });
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    w.stored.picture = { at: w.clock.now - 500, sessoes: { [SID_DEV]: { ...dev, at: w.clock.now - 500 }, [SID_NOVO]: { ...looseOf(SID_NOVO), at: w.clock.now - 500 } } };
    await ownsTask(w, SID_NOVO, id, DEV, 'na troca');
    markOf(w, SID_DEV, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(SID_DEV);
    await ownsTask(w, SID_NOVO, id, DEV, 'velha fechada');
  });

  it('cadeia session:<A> (A → B → C), o PC volta e adota C como session:<C>: C segue dona de session:<A>', async () => {
    const w = vps();
    const A = '88888888-2222-4333-8444-555555555555';
    const C = '99999999-2222-4333-8444-555555555555';
    const PLACE_A = `session:${A}`;
    w.folder(A, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', openedBy: SID_LIDER, placeId: PLACE_A, createdAt: '2026-11-19T11:00:00Z' });
    const created = await w.tool(SID_LIDER, 'tarefa_criar', { quadro: 'atlas', dono: PLACE_A, titulo: 'x', pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error, created.text).toBe(false);
    const id = idOf(created.text);
    w.folder(SID_NOVO, successorMeta(A, { placeId: PLACE_A }));
    markOf(w, A, 'abriu', { sucessora: SID_NOVO });
    markOf(w, A, 'fechou', { sucessora: SID_NOVO });
    w.live.delete(A);
    w.folder(C, successorMeta(SID_NOVO, { placeId: PLACE_A }));
    markOf(w, SID_NOVO, 'abriu', { sucessora: C });
    markOf(w, SID_NOVO, 'fechou', { sucessora: C });
    w.live.delete(SID_NOVO);
    await ownsTask(w, C, id, PLACE_A, 'C sem PC');

    w.stored.picture = { ...w.stored.picture!, at: w.clock.now - 500, sessoes: { ...w.stored.picture!.sessoes, [C]: { ...looseOf(C), at: w.clock.now - 500 } } };
    await ownsTask(w, C, id, PLACE_A, 'PC adotou C');
  });

  it('retratada pelo PC como session:<ela>, sem renovaDe ou com a dona viva, não toma o lugar', () => {
    const plain = vps();
    plain.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:30Z' });
    plain.live.delete(SID_DEV);
    plain.stored.picture = { ...plain.stored.picture!, sessoes: { ...plain.stored.picture!.sessoes, [SID_NOVO]: { ...looseOf(SID_NOVO), at: plain.clock.now - 500 } } };
    expect(lugarOf(plain, SID_NOVO)).toBe(NOVO);

    const held = vps();
    held.folder(SID_NOVO, successorMeta(SID_DEV));
    held.stored.picture = { ...held.stored.picture!, sessoes: { ...held.stored.picture!.sessoes, [SID_NOVO]: { ...looseOf(SID_NOVO), at: held.clock.now - 500 } } };
    expect([lugarOf(held, SID_NOVO), lugarOf(held, SID_DEV)]).toEqual([NOVO, DEV]);
  });

  it('com quem a abriu vivo, o recado ao Líder único é recusado (como no PC)', async () => {
    const w = renewed({ placeId: DEV });
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

// Revisão do PR #523: o fechar e o ver_tela locais do Líder único acham o alvo só pelo id exato do lugar, como o PC
// (findPlace); nunca pelo sucessor de um lugar fechado, por papel, "lider-quadro" ou "quem-me-abriu".
describe('fechar e ver_tela locais do Líder único: só o id do lugar (revisão do #523)', () => {
  const LQ = 'place:lq';
  const OLD = 'place:old';
  /** A Dev alive here and its closed sibling (same role, opened by the same Líder of the board): the sucessor case. */
  function withClosedSibling() {
    const w = vps();
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    const board: MindscapeBoard = {
      ...BOARD,
      cards: { ...BOARD.cards, [LQ]: card(LQ, 'lider'), [OLD]: card(OLD, 'dev') },
      links: [
        { id: 'a', from: LQ, to: DEV, arrow: true, by: 'session', opened: true },
        { id: 'b', from: LQ, to: OLD, arrow: true, by: 'session', opened: true },
      ],
    };
    const listar = [
      { id: DEV, papel: 'dev', nome: 'Dev · atlas', estado: 'trabalhando', abertaPor: LQ, voce: true },
      { id: LQ, papel: 'lider', estado: 'trabalhando' },
      { id: OLD, papel: 'dev', nome: 'Dev velho', estado: 'fechada', abertaPor: LQ },
    ];
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, listar, board } } };
    w.screens.set(SID_DEV, '> ');
    return w;
  }

  it('lugar fechado com irmã viva: recusa e não mata ninguém', async () => {
    const w = withClosedSibling();
    const closed = await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: OLD });
    expect(closed.error, closed.text).toBe(true);
    expect(closed.text).toContain('fechada');
    expect(w.killed).toEqual([]);
    const seen = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem: OLD });
    expect(seen.error, seen.text).toBe(true);
  });

  it('nome de papel, "lider-quadro", "quem-me-abriu" ou id fora do quadro: recusa', async () => {
    const w = withClosedSibling();
    for (const quem of ['dev', 'lider-quadro', 'quem-me-abriu', 'place:nada']) {
      const closed = await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem });
      expect(closed.error, `${quem}: ${closed.text}`).toBe(true);
      const seen = await w.tool(SID_LIDER, 'sessao_ver_tela', { quadro: 'atlas', quem });
      expect(seen.error, `${quem}: ${seen.text}`).toBe(true);
    }
    expect(w.killed).toEqual([]);
    // The exact id still closes it.
    expect(await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: DEV })).toEqual({ error: false, text: 'Fechada.' });
    expect(w.killed).toEqual([SID_DEV]);
  });

  it('duas sessões vivas com o mesmo lugar: o fechar recusa em vez de escolher às cegas', async () => {
    const w = vps();
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: dev, [SID_NOVO]: { ...dev, at: dev.at } } };
    w.live.add(SID_NOVO);
    w.screens.set(SID_DEV, '> ');
    w.screens.set(SID_NOVO, '> ');
    const closed = await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: DEV });
    expect(closed.error, closed.text).toBe(true);
    expect(w.killed).toEqual([]);
  });

  it('o placeId da pasta respeita quem já tem o lugar; dois com o mesmo placeId não ficam ambos com ele', () => {
    const w = vps();
    // The old tmux of DEV is alive (SID_DEV, pictured by the PC); the renewed folder names the same place.
    w.folder(SID_NOVO, { localCwd: PROJECT, projectName: 'atlas', name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:30Z' });
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);

    const twins = vps();
    twins.live.delete(SID_DEV);
    twins.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:30Z' });
    twins.folder(SID_REV, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:40Z' });
    const sessoes = twins.local.get()!.sessoes;
    expect([sessoes[SID_NOVO]!.quemSou.lugar, sessoes[SID_REV]!.quemSou.lugar].filter((lugar) => lugar === DEV).length).toBeLessThan(2);
  });

  // 3ª revisão do #523: o lugar ocupado saía da lista antes da contagem, e uma irmã de mesmo nome, papel e quem abriu,
  // rodando fora desta VPS, virava acerto único — a renovada ganhava o place: dela e o fechar da irmã a matava.
  const SIB = 'place:sib';
  function withSibling() {
    const w = vps();
    const dev = w.stored.picture!.sessoes[SID_DEV]!;
    const board: MindscapeBoard = { ...BOARD, cards: { ...BOARD.cards, [SIB]: card(SIB, 'dev') } };
    const listar = [
      { id: DEV, papel: 'dev', nome: 'Dev · atlas', estado: 'trabalhando' },
      { id: SIB, papel: 'dev', nome: 'Dev · atlas', estado: 'trabalhando' },
    ];
    w.stored.picture = { ...w.stored.picture!, sessoes: { [SID_DEV]: { ...dev, listar, board } } };
    return w;
  }

  it('placeId ocupado e irmã de mesmo nome: session:, e fechar a irmã não mata a renovada', async () => {
    const w = withSibling();
    w.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', placeId: DEV, createdAt: '2026-11-19T11:59:30Z' });
    expect(w.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
    w.screens.set(SID_NOVO, '> ');
    const closed = await w.tool(SID_LIDER, 'sessao_fechar', { quadro: 'atlas', quem: SIB });
    expect(closed.text).not.toBe('Fechada.');
    expect(w.killed).toEqual([]);
  });

  it('sem placeId, com irmã de mesmo nome e papel: session:, viva ou não a dona do outro lugar', () => {
    const alive = withSibling();
    alive.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', createdAt: '2026-11-19T11:59:30Z' });
    expect(alive.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);

    const gone = withSibling();
    gone.live.delete(SID_DEV);
    gone.folder(SID_NOVO, { localCwd: PROJECT, name: 'Dev · atlas', roleId: 'dev', createdAt: '2026-11-19T11:59:30Z' });
    expect(gone.local.get()!.sessoes[SID_NOVO]!.quemSou.lugar).toBe(NOVO);
  });
});
