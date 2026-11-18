// Canal do Donel fora do PC (t-e195b35c), PR 2 — the recados of the VPS: a queue on disk per machine, delivered at the
// end of the target's turn (Stop hook) or typed only on a free field of a stopped session, confirmed by the next prompt.
// What breaks without the owner noticing: a message that vanishes or arrives twice, a "para" by role that picks the
// wrong place, a Revisor in the Dev's own chain getting a direct line, and a task stuck on a place that closed when
// its successor (same role, same opener) is the one calling.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import type { BrowserToolOutcome } from '../src/shared/browser/mcp';
import type { MindscapeBoard, MindscapeCard, MindscapeLink } from '../src/shared/mindscape/model';
import { resolveAddress } from '../src/shared/mindscape/address';
import { successorOf } from '../src/shared/mindscape/reach';
import { reviewLink } from '../src/shared/ledger/revisao';
import type { BoardPicture, PictureSession } from '../src/oraculo/portao';
import { createGateRecados, fieldIsFree, type RecadosTmux } from '../src/oraculo/recados';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const LIDER = 'place:lider';
const DEV = 'place:dev';
const REV = 'place:rev'; // the owner's Revisor: out of the Dev's chain
const REV_CHAIN = 'place:rev-filha'; // a Revisor the Dev opened: in its chain
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_REV = '66666666-2222-4333-8444-555555555555';

function place(id: string, roleId: string, by?: 'session'): MindscapeCard {
  return { kind: 'session', id, roleId, previous: [], x: 0, y: 0, ...(by ? { by } : {}) };
}

function boardOf(cards: MindscapeCard[], links: MindscapeLink[]): MindscapeBoard {
  return { projectPath: PROJECT, pan: { x: 0, y: 0 }, zoom: 1, cards: Object.fromEntries(cards.map((card) => [card.id, card])), links, drawings: [] };
}

const BOARD = boardOf(
  [place(LIDER, 'lider'), place(DEV, 'dev', 'session'), place(REV, 'revisor'), place(REV_CHAIN, 'revisor', 'session')],
  [
    { id: 'l1', from: LIDER, to: DEV, arrow: true, by: 'session', opened: true },
    { id: 'l2', from: DEV, to: REV_CHAIN, arrow: true, by: 'session', opened: true },
  ],
);

const LISTAR = [
  { id: LIDER, papel: 'lider', estado: 'trabalhando' },
  { id: DEV, papel: 'dev', estado: 'trabalhando', abertaPor: LIDER },
  { id: REV, papel: 'revisor', estado: 'parada' },
  { id: REV_CHAIN, papel: 'revisor', estado: 'parada', abertaPor: DEV },
];

function session(lugar: string, papel: string, papelNome: string, listar: readonly unknown[] = LISTAR, board: MindscapeBoard = BOARD): PictureSession {
  return { quemSou: { nome: `${papelNome} · atlas`, pasta: PROJECT, lugar, papel, papelNome }, listar, board };
}

/** A screen of the CLI with the input field between the two last rules. */
function screen(field: string): string {
  return ['● feito.', '', '─'.repeat(40), `❯ ${field}`, '─'.repeat(40), '  ? for shortcuts'].join('\n');
}

function setup(options: { picture?: BoardPicture; withLedger?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'recados-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 18, 12);
  const ledger = options.withLedger === false ? null : createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => clock });
  const picture: BoardPicture = options.picture ?? {
    at: clock,
    sessoes: { [SID_DEV]: session(DEV, 'dev', 'Dev'), [SID_REV]: session(REV, 'revisor', 'Revisor') },
  };
  const screens = new Map<string, string>();
  const typed: { sid: string; text: string }[] = [];
  const enters: string[] = [];
  const tmux: RecadosTmux = {
    screen: async (sid) => ({ inMode: false, text: screens.get(sid) ?? screen('') }),
    type: async (sid, text) => {
      typed.push({ sid, text });
      return true;
    },
    enter: async (sid) => {
      enters.push(sid);
      return true;
    },
  };
  const relayed: unknown[] = [];
  const file = join(dir, 'recados.json');
  const make = () =>
    createGateRecados({
      file,
      io,
      ledger: () => ledger,
      picture: () => picture,
      localSessions: async () => new Set([SID_DEV, SID_REV]),
      tmux,
      relay: async (message) => relayed.push(message),
      now: () => clock,
      log: () => undefined,
    });
  return {
    dir,
    file,
    ledger,
    picture,
    screens,
    typed,
    enters,
    relayed,
    make,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const textOf = (outcome: BrowserToolOutcome | 'repassar'): string => (outcome === 'repassar' ? 'repassar' : outcome.kind === 'image' ? '' : outcome.text);
const hookBody = (sid: string, extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: sid, ...extra });
const tmuxHeader = (sid: string) => ({ 'x-donel-tmux': `donel-${sid}` });

describe('resolveAddress: o "para" de um recado', () => {
  it('papel com um lugar vivo só = esse lugar; vários vivos = erro com os ids; nenhum = erro', () => {
    expect(resolveAddress(BOARD, LISTAR, REV, 'dev')).toEqual({ placeId: DEV });
    const two = [...LISTAR, { id: 'place:dev-2', papel: 'dev', estado: 'parada' }];
    const many = resolveAddress(BOARD, two, REV, 'dev');
    expect(many).toMatchObject({ erro: expect.stringContaining(DEV) });
    expect((many as { erro: string }).erro).toContain('place:dev-2');
    const gone = LISTAR.map((p) => (p.id === DEV ? { ...p, estado: 'fechada' } : p));
    expect(resolveAddress(BOARD, gone, REV, 'dev')).toMatchObject({ erro: expect.any(String) });
    expect(resolveAddress(BOARD, LISTAR, REV, 'dalton')).toMatchObject({ erro: expect.any(String) });
  });

  it('id de lugar, "lider-quadro", "quem-me-abriu" e "lider"', () => {
    expect(resolveAddress(BOARD, LISTAR, DEV, REV)).toEqual({ placeId: REV });
    expect(resolveAddress(BOARD, LISTAR, DEV, 'lider-quadro')).toEqual({ placeId: LIDER });
    expect(resolveAddress(BOARD, LISTAR, REV_CHAIN, 'quem-me-abriu')).toEqual({ placeId: DEV });
    expect(resolveAddress(BOARD, LISTAR, DEV, 'lider')).toEqual({ liderUnico: true });
    expect(resolveAddress(BOARD, LISTAR, REV, 'quem-me-abriu')).toMatchObject({ erro: expect.any(String) });
  });
});

describe('successorOf: a tarefa segue a renovação', () => {
  it('o lugar vivo do mesmo papel aberto pelo mesmo lugar; dois candidatos ou outro pai = ninguém', () => {
    const renewed = boardOf([...Object.values(BOARD.cards), place('place:dev-novo', 'dev', 'session')], [...BOARD.links, { id: 'l3', from: LIDER, to: 'place:dev-novo', arrow: true, by: 'session', opened: true }]);
    const listar = [...LISTAR.map((p) => (p.id === DEV ? { ...p, estado: 'fechada' } : p)), { id: 'place:dev-novo', papel: 'dev', estado: 'trabalhando', abertaPor: LIDER }];
    expect(successorOf(renewed, listar, DEV)).toBe('place:dev-novo');
    expect(successorOf(renewed, [...listar, { id: 'place:dev-3', papel: 'dev', estado: 'parada', abertaPor: LIDER }], DEV)).toBeUndefined();
    expect(successorOf(renewed, listar.map((p) => (p.id === 'place:dev-novo' ? { ...p, abertaPor: REV } : p)), 'place:outro')).toBeUndefined();
    // Opened by another place: not its successor.
    const other = boardOf([...Object.values(BOARD.cards), place('place:dev-novo', 'dev', 'session')], [...BOARD.links, { id: 'l3', from: REV, to: 'place:dev-novo', arrow: true, by: 'session', opened: true }]);
    expect(successorOf(other, listar.map((p) => (p.id === 'place:dev-novo' ? { ...p, abertaPor: REV } : p)), DEV)).toBeUndefined();
  });
});

async function deliveredTask(ledger: NonNullable<ReturnType<typeof setup>['ledger']>): Promise<string> {
  const dev: LedgerCaller = {
    projectPath: PROJECT,
    placeId: DEV,
    roleId: 'dev',
    boardPlaceIds: Object.keys(BOARD.cards),
    board: BOARD,
    placeStates: new Map([[PROJECT, new Map(LISTAR.map((p) => [p.id, p.estado]))]]),
  };
  const created = await runLedgerTool(ledger, dev, { tool: 'tarefa_criar', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
  const id = (JSON.parse(created.text) as { id: string }).id;
  await runLedgerTool(ledger, dev, { tool: 'tarefa_assumir', id });
  const delivered = await runLedgerTool(ledger, dev, { tool: 'tarefa_entregar', id, provas: [{ tipo: 'texto', texto: 'npm test verde' }] });
  expect(JSON.parse(delivered.text)).toMatchObject({ entregue: true, estado: 'entregue' });
  return id;
}

describe('reviewLink: Dev e Revisor de fora falam sem seta', () => {
  it('liga quem entregou ao Revisor vivo de fora da cadeia, nos dois sentidos; nunca ao Revisor da cadeia', async () => {
    const g = setup();
    const doc = () => g.ledger!.load().doc;
    expect(reviewLink(doc(), BOARD, LISTAR, DEV, REV)).toBe(false); // nothing delivered yet
    await deliveredTask(g.ledger!);
    expect(reviewLink(doc(), BOARD, LISTAR, DEV, REV)).toBe(true);
    expect(reviewLink(doc(), BOARD, LISTAR, REV, DEV)).toBe(true);
    expect(reviewLink(doc(), BOARD, LISTAR, DEV, REV_CHAIN)).toBe(false);
    expect(reviewLink(doc(), BOARD, LISTAR, LIDER, REV)).toBe(false);
  });
});

describe('Recados em fila', () => {
  it('enviar enfileira; o fim de turno entrega uma vez e marca; o segundo fim de turno não reentrega; reinício relê', async () => {
    const g = setup();
    const recados = g.make();
    const mine = g.picture.sessoes[SID_DEV]!;
    // No arrow Dev → owner's Revisor and nothing delivered: refused with the app's words.
    expect(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: REV, texto: 'oi' }))).toMatch(/^Sem ligação/);
    // Revisor → Dev by role, with nothing delivered yet: no link either.
    const sent = await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: 'dev', texto: 'olha o PR 12', tarefa: 't-abc12345' });
    expect(textOf(sent)).toMatch(/^Sem ligação/);

    await deliveredTask(g.ledger!);
    // By role: two live Revisores (the owner's and the one in the Dev's chain) = an error naming both.
    expect(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'revisor', texto: 'pode revisar?' }))).toContain(REV_CHAIN);
    const ok = await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: REV, texto: 'pode revisar?', tarefa: 't-abc12345' });
    const answer = JSON.parse(textOf(ok)) as { entregue: string; id: string; para: string };
    expect(answer).toMatchObject({ entregue: 'na-fila', para: REV });
    // The same message again inside 2 min joins the first.
    const again = JSON.parse(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: REV, texto: 'pode revisar?', tarefa: 't-abc12345' }))) as { id: string };
    expect(again.id).toBe(answer.id);

    // A restart reads the queue from disk.
    const after = g.make();
    const stop = await after.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV));
    expect(stop.status).toBe(200);
    const block = JSON.parse(stop.body) as { decision?: string; reason?: string };
    expect(block.decision).toBe('block');
    expect(block.reason).toContain(`Recado ${answer.id} de Dev (${DEV}):`);
    expect(block.reason).toContain('[t-abc12345]');
    expect(block.reason!.split('pode revisar?')).toHaveLength(2); // once, not twice
    const second = await after.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV, { stop_hook_active: true }));
    expect(JSON.parse(second.body)).toEqual({});
    const items = (JSON.parse(readFileSync(g.file, 'utf8')) as { items: { id: string; estado: string; via?: string }[] }).items;
    expect(items).toEqual([expect.objectContaining({ id: answer.id, estado: 'entregue', via: 'fim-de-turno' })]);
    // The other session's turn end gets nothing of it.
    expect(JSON.parse((await after.hook('fim-de-turno', {}, hookBody(SID_DEV))).body)).toEqual({});
  });

  it('alvo fora desta máquina: repassa ao PC', async () => {
    const g = setup();
    const recados = g.make();
    expect(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: 'lider-quadro', texto: 'oi' })).toBe('repassar');
  });

  it('sessão parada: digita só com o campo livre, uma vez por recado, e confirma pelo prompt', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    // Never heard from the Revisor: unknown state, nothing typed.
    await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'primeiro' });
    await recados.tick();
    expect(g.typed).toEqual([]);
    // Its turn ends: the queued one goes by the hook. Now it is stopped.
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body).decision).toBe('block');
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV, { stop_hook_active: true }))).body)).toEqual({});

    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'segundo' }))) as { id: string };
    g.screens.set(SID_REV, screen('rascunho do dono'));
    await recados.tick();
    expect(g.typed).toEqual([]); // someone's draft: never typed over
    g.screens.set(SID_REV, screen(''));
    await recados.tick();
    expect(g.typed).toEqual([{ sid: SID_REV, text: expect.stringContaining(`Recado ${sent.id} de Dev`) }]);
    await recados.tick();
    expect(g.typed).toHaveLength(1); // not typed twice
    // The prompt with the label confirms it.
    await recados.hook('ocupada', tmuxHeader(SID_REV), hookBody(SID_REV, { prompt: g.typed[0]!.text }));
    const item = (JSON.parse(readFileSync(g.file, 'utf8')) as { items: { id: string; estado: string; via?: string }[] }).items.find((i) => i.id === sent.id);
    expect(item).toMatchObject({ estado: 'entregue', via: 'tela' });
    // And the next turn end does not deliver it again.
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body)).toEqual({});
  });

  it('digitado sem confirmação em 20 s volta à fila e não é digitado de novo: vai no fim de turno', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV));
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'sem eco' }))) as { id: string };
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    g.advance(21_000);
    await recados.tick();
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    const stop = JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body) as { reason?: string };
    expect(stop.reason).toContain(`Recado ${sent.id}`);
  });
});

describe('depoisDaTarefa: avisos da entrega e do veredito', () => {
  it('entrega avisa o Revisor de fora (fila) e quem está acima (relay); a devolução chega ao Dev com o motivo', async () => {
    const g = setup();
    const recados = g.make();
    const states = new Map([[PROJECT, new Map(LISTAR.map((p) => [p.id, p.estado]))]]);
    const dev: LedgerCaller = { projectPath: PROJECT, placeId: DEV, roleId: 'dev', boardPlaceIds: Object.keys(BOARD.cards), board: BOARD, placeStates: states };
    const created = await runLedgerTool(g.ledger!, dev, { tool: 'tarefa_criar', titulo: 'Fila', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(g.ledger!, dev, { tool: 'tarefa_assumir', id });
    const entregar = { tool: 'tarefa_entregar' as const, id, provas: [{ tipo: 'texto' as const, texto: 'verde' }] };
    const delivered = await runLedgerTool(g.ledger!, dev, entregar);
    recados.depoisDaTarefa(SID_DEV, g.picture.sessoes[SID_DEV]!, dev, entregar, delivered.text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const toRev = JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body) as { reason?: string };
    expect(toRev.reason).toContain(`entregou a tarefa ${id}`);
    expect(g.relayed).toEqual([expect.objectContaining({ projectPath: PROJECT, placeId: LIDER, text: expect.stringContaining(id) })]);

    const rev: LedgerCaller = { ...dev, placeId: REV, roleId: 'revisor' };
    await runLedgerTool(g.ledger!, rev, { tool: 'tarefa_ver', id });
    const rejeitar = { tool: 'tarefa_rejeitar' as const, id, motivo: 'falta o teste do caso vazio' };
    const rejected = await runLedgerTool(g.ledger!, rev, rejeitar);
    expect(rejected.ok).toBe(true);
    recados.depoisDaTarefa(SID_REV, g.picture.sessoes[SID_REV]!, rev, rejeitar, rejected.text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const toDev = JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_DEV), hookBody(SID_DEV))).body) as { reason?: string };
    expect(toDev.reason).toContain(`devolveu ${id}`);
    expect(toDev.reason).toContain('falta o teste do caso vazio');
  });
});

describe('antesDaTarefa: tarefa de lugar fechado passa ao sucessor', () => {
  it('a chamada do lugar novo do mesmo papel transfere a tarefa do lugar fechado a ele', async () => {
    const g = setup();
    const id = await (async () => {
      const dev: LedgerCaller = { projectPath: PROJECT, placeId: DEV, roleId: 'dev', boardPlaceIds: Object.keys(BOARD.cards) };
      const created = await runLedgerTool(g.ledger!, dev, { tool: 'tarefa_criar', pedido: 'faz', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
      const taskId = (JSON.parse(created.text) as { id: string }).id;
      await runLedgerTool(g.ledger!, dev, { tool: 'tarefa_assumir', id: taskId });
      return taskId;
    })();
    const NEW = 'place:dev-novo';
    const board = boardOf([...Object.values(BOARD.cards), place(NEW, 'dev', 'session')], [...BOARD.links, { id: 'l3', from: LIDER, to: NEW, arrow: true, by: 'session', opened: true }]);
    const listar = [...LISTAR.map((p) => (p.id === DEV ? { ...p, estado: 'fechada' } : p)), { id: NEW, papel: 'dev', estado: 'trabalhando', abertaPor: LIDER }];
    const mine = session(NEW, 'dev', 'Dev', listar, board);
    const recados = g.make();
    const caller: LedgerCaller = { projectPath: PROJECT, placeId: NEW, roleId: 'dev', boardPlaceIds: Object.keys(board.cards), board };
    await recados.antesDaTarefa(caller, mine, { tool: 'tarefa_andamento', id, estado: 'trabalhando' });
    const task = g.ledger!.load().doc.tasks[id]!;
    expect(task.ownerPlaceId).toBe(NEW);
    expect(JSON.stringify(task.events.at(-1))).toContain('renovação');
    // Someone else (not the successor) calling changes nothing.
    const other: LedgerCaller = { ...caller, placeId: REV };
    await recados.antesDaTarefa(other, session(REV, 'revisor', 'Revisor', listar, board), { tool: 'tarefa_listar' });
    expect(g.ledger!.load().doc.tasks[id]!.ownerPlaceId).toBe(NEW);
  });
});

describe('fieldIsFree: o campo do Claude Code na tela', () => {
  it('livre só com o campo vazio; sugestão esmaecida não conta como texto', () => {
    expect(fieldIsFree(screen(''))).toEqual({ free: true, reason: '' });
    expect(fieldIsFree(screen('algo')).free).toBe(false);
    expect(fieldIsFree(screen('\x1b[2mtry "fix the bug"\x1b[0m')).free).toBe(true);
    expect(fieldIsFree('nada de campo aqui').free).toBe(false);
  });
});
