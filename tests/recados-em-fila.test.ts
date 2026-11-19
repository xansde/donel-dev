// Canal do Donel fora do PC (t-e195b35c), PR 2 — the recados of the VPS: a queue on disk per machine, delivered at the
// end of the target's turn (Stop hook) or typed only on a free field of a stopped session, confirmed by the next prompt.
// What breaks without the owner noticing: a message that vanishes or arrives twice, a "para" by role that picks the
// wrong place, a Revisor in the Dev's own chain getting a direct line, and a task stuck on a place that closed when
// its successor (same role, same opener) is the one calling.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { createRelay, deliverLocalFirst } from '../src/oraculo/relay';
import { createCardWriter } from '../src/main/ledger-card-writer';

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
  const cleared: string[] = [];
  /** The last turn in each session's transcript (absent = no transcript found). */
  const turns = new Map<string, { ended: boolean; at: number }>();
  const inTranscript = new Map<string, string[]>();
  /** The next `type` answers this once (a tmux that refused, or took the text and not the Enter). */
  const typeAnswers: boolean[] = [];
  /** Runs while the transcript is read (a hook arriving in the middle of a tick). */
  const duringTranscriptRead: { fn?: () => Promise<void> } = {};
  const tmux: RecadosTmux = {
    screen: async (sid) => ({ inMode: false, text: screens.get(sid) ?? screen('') }),
    type: async (sid, text) => {
      typed.push({ sid, text });
      return typeAnswers.shift() ?? true;
    },
    enter: async (sid) => {
      enters.push(sid);
      return true;
    },
    clear: async (sid) => {
      cleared.push(sid);
      screens.set(sid, screen(''));
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
      transcriptOf: async (sid) => `/transcripts/${sid}.jsonl`,
      lastTurn: async (path) => turns.get(path.replace(/^.*\/|\.jsonl$/g, '')) ?? null,
      transcriptHas: async (path, label) => {
        const fn = duringTranscriptRead.fn;
        duringTranscriptRead.fn = undefined;
        if (fn) await fn();
        return (inTranscript.get(path.replace(/^.*\/|\.jsonl$/g, '')) ?? []).some((line) => line.includes(label));
      },
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
    cleared,
    turns,
    inTranscript,
    typeAnswers,
    duringTranscriptRead,
    relayed,
    clock: () => clock,
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

  it('id antigo de um lugar fechado vai ao sucessor (o único vivo do mesmo papel e do mesmo pai); dois candidatos = o id dado', () => {
    const NEW = 'place:dev-novo';
    const renewed = boardOf([...Object.values(BOARD.cards), place(NEW, 'dev', 'session')], [...BOARD.links, { id: 'l3', from: LIDER, to: NEW, arrow: true, by: 'session', opened: true }]);
    const listar = [...LISTAR.map((p) => (p.id === DEV ? { ...p, estado: 'fechada' } : p)), { id: NEW, papel: 'dev', estado: 'trabalhando', abertaPor: LIDER }];
    expect(resolveAddress(renewed, listar, REV, DEV)).toEqual({ placeId: NEW, renovadoDe: DEV });
    expect(resolveAddress(renewed, [...listar, { id: 'place:dev-3', papel: 'dev', estado: 'parada', abertaPor: LIDER }], REV, DEV)).toEqual({ placeId: DEV });
    expect(resolveAddress(BOARD, LISTAR, REV, DEV)).toEqual({ placeId: DEV }); // alive: itself
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
    // No arrow Dev → owner's Revisor and nothing delivered: with the PC off, refused with the app's words.
    expect(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: REV, texto: 'oi' }, 'desligado'))).toMatch(/^Sem ligação/);
    // Revisor → Dev by role, with nothing delivered yet: no link either.
    const sent = await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: 'dev', texto: 'olha o PR 12', tarefa: 't-abc12345' }, 'desligado');
    expect(textOf(sent)).toMatch(/^Sem ligação/);

    await deliveredTask(g.ledger!);
    // By role: two live Revisores (the owner's and the one in the Dev's chain) = an error naming both.
    expect(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'revisor', texto: 'pode revisar?' }, 'desligado'))).toContain(REV_CHAIN);
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

  it('retrato velho com o PC ligado: lugar que ele não conhece, ou sem seta nele, vai ao PC decidir; nada entra na fila', async () => {
    const g = setup();
    const recados = g.make();
    const mine = g.picture.sessoes[SID_DEV]!;
    // A place opened after the last picture (sessao_abrir, then a message right away), and an arrow drawn after it.
    expect(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'place:recem-aberto', texto: 'oi' })).toBe('repassar');
    expect(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: REV, texto: 'oi' })).toBe('repassar');
    expect(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'revisor', texto: 'oi' })).toBe('repassar');
    expect(existsSync(g.file)).toBe(false);
    // With the PC off the picture is all there is: the same answer as the app's.
    expect(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'place:recem-aberto', texto: 'oi' }, 'desligado'))).toContain('não é um lugar do quadro');
  });

  it('PC fora e alvo fora desta máquina: vai ao relay uma vez (a repetição junta), e quem mandou sabe', async () => {
    const g = setup();
    const recados = g.make();
    const mine = g.picture.sessoes[SID_DEV]!;
    const first = JSON.parse(textOf(await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'lider-quadro', texto: 'acabei o PR', tarefa: 't-abc12345' }, 'desligado'))) as { entregue: string; para: string };
    expect(first).toMatchObject({ entregue: 'pelo-relay', para: LIDER });
    await recados.enviar(SID_DEV, mine, { tool: 'sessao_enviar', para: 'lider-quadro', texto: 'acabei o PR', tarefa: 't-abc12345' }, 'desligado');
    expect(g.relayed).toHaveLength(2);
    const [a, b] = g.relayed as { placeId: string; text: string; key: string }[];
    expect(a).toMatchObject({ placeId: LIDER, text: expect.stringContaining('[t-abc12345] acabei o PR') });
    expect(a!.text).toContain(`Dev (${DEV})`);
    expect(b!.key).toBe(a!.key); // the relay joins the same key: delivered once
    expect(existsSync(g.file)).toBe(false);
  });

  it('sessão parada: digita só com o campo livre, uma vez por recado, e confirma pelo prompt', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    // Never heard from the Revisor and nothing in its transcript says the turn ended: nothing typed.
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

describe('Recados em fila: sessão nunca ouvida (daemon reiniciado, hook instalado depois)', () => {
  it('parada pela tela e pelo transcript: digita; ocupada (turno aberto, esc to interrupt, transcript mexendo): não', async () => {
    const g = setup();
    await deliveredTask(g.ledger!);
    // The Dev, stopped before the daemon came up: no hook ever told this daemon about it.
    const recados = g.make();
    const sent = JSON.parse(textOf(await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: DEV, texto: 'aprovado' }))) as { id: string; entregue: string };
    expect(sent.entregue).toBe('na-fila');
    // A turn still open in the transcript: never typed.
    g.turns.set(SID_DEV, { ended: false, at: g.clock() - 60_000 });
    await recados.tick();
    // Ended, but the transcript moved a moment ago: not yet.
    g.turns.set(SID_DEV, { ended: true, at: g.clock() - 1_000 });
    await recados.tick();
    // Ended and quiet, but the CLI says it is working.
    g.turns.set(SID_DEV, { ended: true, at: g.clock() - 60_000 });
    g.screens.set(SID_DEV, `${screen('')}\n  ⏵⏵ bypass permissions on · esc to interrupt`);
    await recados.tick();
    expect(g.typed).toEqual([]);
    // Stopped: typed on the free field, and the transcript confirms it (no hook at all).
    g.screens.set(SID_DEV, screen(''));
    await recados.tick();
    expect(g.typed).toEqual([{ sid: SID_DEV, text: expect.stringContaining(`Recado ${sent.id}`) }]);
    g.inTranscript.set(SID_DEV, [g.typed[0]!.text]);
    g.advance(21_000);
    await recados.tick();
    const item = (JSON.parse(readFileSync(g.file, 'utf8')) as { items: { id: string; estado: string; via?: string }[] }).items.find((i) => i.id === sent.id);
    expect(item).toMatchObject({ estado: 'entregue', via: 'transcript' });
    // Confirmed by the transcript with the hook silent: the next one still goes once the session is stopped again.
    const next = JSON.parse(textOf(await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: DEV, texto: 'outro' }))) as { id: string };
    g.turns.set(SID_DEV, { ended: true, at: g.clock() - 60_000 });
    await recados.tick();
    expect(g.typed).toHaveLength(2);
    expect(g.typed[1]!.text).toContain(`Recado ${next.id}`);
  });

  it('a caixa segura o texto a cada digitação: limpa e redigita; esgotadas as tentativas, caixa limpa, volta à fila, o Líder ouve uma vez e o fim de turno entrega uma vez', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'preso' }))) as { id: string };
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    for (let typing = 1; typing <= 3; typing += 1) {
      // The Enter did not go: the text sits in the field (a long one shows as a paste).
      g.screens.set(SID_REV, screen('[Pasted text #1]'));
      g.advance(21_000);
      await recados.tick();
      expect(g.cleared).toHaveLength(typing);
      expect(g.typed).toHaveLength(Math.min(typing + 1, 3));
    }
    expect(new Set(g.typed.map((t) => t.text)).size).toBe(1); // always the same text
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'fila', tentativas: 3 });
    const warned = (g.relayed as { key: string; text: string }[]).filter((m) => m.key.startsWith('caixa:'));
    expect(warned).toHaveLength(1);
    expect(warned[0]!.text).toContain(sent.id);
    for (let i = 0; i < 10; i += 1) {
      g.advance(30_000);
      await recados.tick();
    }
    expect(g.typed).toHaveLength(3); // spent: not typed again
    expect((g.relayed as { key: string }[]).filter((m) => m.key.startsWith('caixa:'))).toHaveLength(1);
    const stop = JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body) as { reason?: string };
    expect(stop.reason!.split(`Recado ${sent.id}`)).toHaveLength(2);
    // Somebody's own draft in the field is never cleared.
    await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV, { stop_hook_active: true }));
    g.screens.set(SID_REV, screen(''));
    await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'mais um' });
    await recados.tick();
    expect(g.typed).toHaveLength(4);
    g.screens.set(SID_REV, screen('rascunho do dono'));
    g.advance(21_000);
    await recados.tick();
    expect(g.cleared).toHaveLength(3);
  });

  it('o texto digitado sai sem caracteres de controle (um \\r manda pela metade)', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'a\rb\tc\x1b[2Jd\x7fe\n\nf' });
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    expect(g.typed[0]!.text).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(g.typed[0]!.text).toMatch(/a b c \[2Jd e f$/);
  });
});

const itemOf = (file: string, id: string) => (JSON.parse(readFileSync(file, 'utf8')) as { items: { id: string; estado: string; via?: string; tentativas: number }[] }).items.find((i) => i.id === id);

describe('Recados em fila: o campo de quem está digitando é dele', () => {
  it('Enter de novo só com o próprio recado no campo; o transcript confirma e para os Enters', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'revisa' }))) as { id: string };
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    g.advance(6_000);
    g.screens.set(SID_REV, screen('rascunho do dono'));
    await recados.tick();
    expect(g.enters).toEqual([]); // someone's draft: never sent
    g.screens.set(SID_REV, screen(g.typed[0]!.text));
    await recados.tick();
    expect(g.enters).toEqual([SID_REV]); // its own text stuck in the field
    g.inTranscript.set(SID_REV, [g.typed[0]!.text]);
    g.screens.set(SID_REV, screen('[Pasted text #2]')); // the owner's paste, after the recado went in
    g.advance(2_000);
    await recados.tick();
    expect(g.enters).toEqual([SID_REV]);
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'entregue', via: 'transcript' });
  });

  it('confirmado pelo hook no meio da conferência: o campo (agora do dono) não é apagado', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'revisa' }))) as { id: string };
    await recados.tick();
    g.advance(21_000);
    g.screens.set(SID_REV, screen('[Pasted text #3]'));
    g.duringTranscriptRead.fn = async () => {
      await recados.hook('ocupada', tmuxHeader(SID_REV), hookBody(SID_REV, { prompt: g.typed[0]!.text }));
    };
    await recados.tick();
    expect(g.cleared).toEqual([]);
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'entregue', via: 'tela' });
  });

  it('tmux falhou ao digitar: não tenta a cada 2 s, e um Enter depois é confirmado sem duplicar no fim de turno', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'sem enter' }))) as { id: string };
    g.typeAnswers.push(false); // the text went in, the Enter did not
    await recados.tick();
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'digitado', tentativas: 1 });
    for (let i = 0; i < 30; i += 1) {
      g.advance(2_000);
      await recados.tick();
    }
    expect(g.typed).toHaveLength(1); // a minute of ticks, one typing
    // Somebody presses Enter on what was left: the prompt carries its label, so it counts as delivered.
    await recados.hook('ocupada', tmuxHeader(SID_REV), hookBody(SID_REV, { prompt: g.typed[0]!.text }));
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'entregue', via: 'tela' });
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body)).toEqual({});
  });
});

// Caixa pendurada (19/11): the Dalton's queue stood ~20 h behind two notices typed and never sent.
describe('Recados em fila: caixa pendurada', () => {
  const caixaWarnings = (relayed: unknown[]) => (relayed as { key: string; text: string }[]).filter((m) => m.key.startsWith('caixa:'));

  it('a caixa segura o texto depois do Enter: o entregador limpa, digita de novo o mesmo texto e a fila anda, sem sair em dobro', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'revisa o PR 12' }))) as { id: string };
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    g.screens.set(SID_REV, screen(g.typed[0]!.text)); // the Enter did not go in
    g.advance(6_000);
    await recados.tick();
    expect(g.enters).toEqual([SID_REV]); // another Enter first
    g.advance(15_000);
    await recados.tick();
    expect(g.cleared).toEqual([SID_REV]);
    expect(g.typed).toHaveLength(2);
    expect(g.typed[1]!.text).toBe(g.typed[0]!.text);
    // This time it went in.
    g.screens.set(SID_REV, screen(''));
    g.inTranscript.set(SID_REV, [g.typed[1]!.text]);
    g.advance(6_000);
    await recados.tick();
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'entregue', via: 'transcript' });
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body)).toEqual({});
    expect(g.typed).toHaveLength(2);
    expect(caixaWarnings(g.relayed)).toEqual([]);
  });

  it('recado ao próprio Líder único que não entra na caixa dele: nenhum aviso novo na mesma caixa travada, nada em laço', async () => {
    // A Dev the Líder único opened: it reaches him by the PC's rule (t-d461e003).
    const listar = LISTAR.map((entry) => (entry.id === DEV ? { ...entry, abertaPor: 'lider' } : entry));
    const g = setup({ picture: { at: Date.UTC(2026, 10, 18, 12), sessoes: { [SID_DEV]: session(DEV, 'dev', 'Dev', listar), [SID_REV]: session(REV, 'revisor', 'Revisor', listar) } } });
    const SID_LIDER = '77777777-2222-4333-8444-555555555555';
    const recados = createGateRecados({
      file: g.file,
      io,
      ledger: () => g.ledger,
      picture: () => g.picture,
      localSessions: async () => new Set([SID_DEV, SID_REV, SID_LIDER]),
      leader: async () => ({ sid: SID_LIDER }),
      tmux: {
        screen: async (sid) => ({ inMode: false, text: g.screens.get(sid) ?? screen('') }),
        // The Líder's box takes the text and never the Enter.
        type: async (sid, text) => {
          g.typed.push({ sid, text });
          g.screens.set(sid, screen(text));
          return true;
        },
        enter: async (sid) => {
          g.enters.push(sid);
          return true;
        },
        clear: async (sid) => {
          g.cleared.push(sid);
          g.screens.set(sid, screen(''));
          return true;
        },
      },
      relay: async (message) => g.relayed.push(message),
      transcriptOf: async (sid) => `/transcripts/${sid}.jsonl`,
      lastTurn: async () => ({ ended: true, at: g.clock() - 60_000 }),
      transcriptHas: async () => false,
      now: g.clock,
      log: () => undefined,
    });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: 'lider', texto: 'olha o PR 12' }))) as { id: string };
    expect(sent.id).toMatch(/^r-/);
    for (let i = 0; i < 1800; i += 1) {
      await recados.tick();
      g.advance(2_000);
    }
    const { items } = JSON.parse(readFileSync(g.file, 'utf8')) as { items: { id: string; para: { sid: string } }[] };
    expect(items.filter((item) => item.para.sid === SID_LIDER).map((item) => item.id)).toEqual([sent.id]);
    expect(caixaWarnings(g.relayed)).toEqual([]);
    expect(g.typed.filter((t) => t.sid === SID_LIDER)).toHaveLength(3);
    expect(g.cleared.filter((sid) => sid === SID_LIDER)).toHaveLength(3);
  });

  it('volta à fila sem saber do Enter e a conversa mostra que entrou: entregue, nunca redigitado nem reentregue', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_REV, { ended: true, at: g.clock() - 60_000 });
    const sent = JSON.parse(textOf(await recados.enviar(SID_DEV, g.picture.sessoes[SID_DEV]!, { tool: 'sessao_enviar', para: REV, texto: 'chegou tarde' }))) as { id: string };
    await recados.tick();
    g.advance(21_000);
    await recados.tick(); // empty field, nothing in the transcript yet: back to the queue, the screen waits
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'fila', tentativas: 1 });
    g.inTranscript.set(SID_REV, [g.typed[0]!.text]); // the transcript caught up
    g.advance(3 * 60_000);
    await recados.tick();
    expect(g.typed).toHaveLength(1);
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'entregue', via: 'transcript' });
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_REV), hookBody(SID_REV))).body)).toEqual({});
  });

  it('aviso "◆ …" pendurado há mais de 5 min numa sessão ociosa: vai com um Enter e a fila atrás dele anda', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_DEV, { ended: true, at: g.clock() - 60_000 });
    g.screens.set(SID_DEV, screen('◆ De Homologador (place:3aef85f7): [t-4ad46dea] acabei o turno #sem-esteira'));
    const sent = JSON.parse(textOf(await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: DEV, texto: 'aprovado' }))) as { id: string };
    for (let i = 0; i < 9; i += 1) {
      await recados.tick();
      g.advance(30_000);
    }
    // 4,5 min: nothing touched, nothing typed over it.
    expect(g.enters).toEqual([]);
    expect(g.typed).toEqual([]);
    await recados.tick();
    g.advance(30_000);
    await recados.tick();
    expect(g.enters).toEqual([SID_DEV]);
    expect(g.cleared).toEqual([]);
    // The CLI took it: the field is free and the queue moves.
    g.screens.set(SID_DEV, screen(''));
    g.advance(30_000);
    await recados.tick();
    expect(g.typed).toEqual([{ sid: SID_DEV, text: expect.stringContaining(`Recado ${sent.id}`) }]);
    expect(g.enters).toEqual([SID_DEV]); // one Enter per box
    expect(caixaWarnings(g.relayed)).toEqual([]);
  });

  it('primeira mensagem de sessão renovada ("[Donel Dev · …]") parada numa sessão que nunca teve turno: Enters com recuo, nunca redigitada; o Líder ouve só depois do último (19/11)', async () => {
    const g = setup();
    const recados = g.make();
    // No turn in its transcript: the renewal's first message is what would start it.
    g.screens.set(SID_DEV, screen('[Donel Dev · sessão renovada em voo] Esta sessão continua a 1e74e200, encerrada pelo app'));
    const tickTo = async (ticks: number): Promise<void> => {
      for (let i = 0; i < ticks; i += 1) {
        await recados.tick();
        g.advance(30_000);
      }
    };
    await tickTo(10); // 0 .. 4,5 min
    expect(g.enters).toEqual([]);
    await tickTo(1); // 5 min: the first Enter
    expect(g.enters).toEqual([SID_DEV]);
    await tickTo(1); // 30 s later, still there: one more
    expect(g.enters).toEqual([SID_DEV, SID_DEV]);
    await tickTo(1); // the next one waits 1 min
    expect(g.enters).toHaveLength(2);
    await tickTo(1);
    expect(g.enters).toHaveLength(3);
    expect(caixaWarnings(g.relayed)).toEqual([]);
    await tickTo(10);
    expect(g.enters).toHaveLength(3);
    expect(g.typed).toEqual([]);
    expect(g.cleared).toEqual([]);
    expect(caixaWarnings(g.relayed)).toHaveLength(1);
  });

  it('aviso "◆ …" numa sessão em turno não leva Enter; o Líder ouve uma vez', async () => {
    const g = setup();
    const recados = g.make();
    g.screens.set(SID_DEV, `${screen('◆ De Dev (place:x): [t-1] fim de turno')}\n  esc to interrupt`);
    for (let i = 0; i < 20; i += 1) {
      await recados.tick();
      g.advance(30_000);
    }
    expect(g.enters).toEqual([]);
    expect(caixaWarnings(g.relayed)).toHaveLength(1);
  });

  it('texto sem a forma "◆" (o dono digitando): nada é apagado nem enviado, e a vigia avisa o Líder uma vez, com sessão, lugar, tempo e 80 caracteres', async () => {
    const g = setup();
    const recados = g.make();
    await deliveredTask(g.ledger!);
    g.turns.set(SID_DEV, { ended: true, at: g.clock() - 60_000 });
    const draft = `vou pedir pro revisor olhar o PR 12 com calma porque ${'x'.repeat(100)}`;
    g.screens.set(SID_DEV, screen(draft));
    const sent = JSON.parse(textOf(await recados.enviar(SID_REV, g.picture.sessoes[SID_REV]!, { tool: 'sessao_enviar', para: DEV, texto: 'aprovado' }))) as { id: string };
    for (let i = 0; i < 25; i += 1) {
      await recados.tick();
      g.advance(30_000);
    }
    expect(g.typed).toEqual([]);
    expect(g.enters).toEqual([]);
    expect(g.cleared).toEqual([]);
    const warned = caixaWarnings(g.relayed);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.text).toContain('caixa com texto não enviado há mais de 5 min');
    expect(warned[0]!.text).toContain(SID_DEV);
    expect(warned[0]!.text).toContain(DEV);
    expect(warned[0]!.text).toMatch(/há \d+ min/);
    expect(warned[0]!.text).toContain(`«${draft.slice(0, 80)}»`);
    expect(warned[0]!.text).not.toContain(draft.slice(0, 81));
    expect(itemOf(g.file, sent.id)).toMatchObject({ estado: 'fila', tentativas: 0 });
    // The owner sends his text: the field is free and the queue moves.
    g.screens.set(SID_DEV, screen(''));
    await recados.tick();
    expect(g.typed).toEqual([{ sid: SID_DEV, text: expect.stringContaining(`Recado ${sent.id}`) }]);
  });
});

describe.skipIf(process.platform === 'win32')('recados-hook.sh: só a CLI do próprio painel pede os recados', () => {
  it('a sessão leva os recados dela; um claude -p rodado de dentro dela (mesmo tmux) não leva nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recados-hook-'));
    dirs.push(dir);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const called = join(dir, 'curl-chamado');
    const tool = (name: string, body: string): void => {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    };
    // The pane's process is the outer "claude"; a nested one is a claude run by it, with the same tmux.
    tool('tmux', `#!/bin/sh\ncase "$*" in *pane_pid*) echo "$FAKE_PANE_PID" ;; *) echo donel-${SID_DEV} ;; esac\n`);
    tool('curl', `#!/bin/sh\ncat > '${called}'\necho '{"decision":"block","reason":"recado"}'\n`);
    tool('claude', '#!/bin/bash\n[ -n "${FAKE_PANE_PID:-}" ] || export FAKE_PANE_PID=$$\nif [ "${1:-}" = dentro ]; then "$0"; exit $?; fi\nprintf \'{}\' | bash "$HOOK" fim-de-turno\nexit $?\n');
    const { FAKE_PANE_PID: _drop, ...base } = process.env;
    const env = { ...base, PATH: `${bin}:${process.env.PATH ?? ''}`, TMUX: '/tmp/fake-tmux,1,0', HOOK: fileURLToPath(new URL('../scripts/vps/recados-hook.sh', import.meta.url)) };

    const own = spawnSync(join(bin, 'claude'), [], { env, encoding: 'utf8', timeout: 20_000 });
    expect(own.stdout).toContain('"decision":"block"');
    expect(existsSync(called)).toBe(true);
    rmSync(called);

    const nested = spawnSync(join(bin, 'claude'), ['dentro'], { env, encoding: 'utf8', timeout: 20_000 });
    expect(nested.status).toBe(0);
    expect(nested.stdout).toBe('');
    expect(existsSync(called)).toBe(false);
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
    // A call about no task (listar, criar, novidades) takes nothing: only the task it is about follows.
    await recados.antesDaTarefa(caller, mine, { tool: 'tarefa_listar' });
    await recados.antesDaTarefa(caller, mine, { tool: 'tarefa_novidades' });
    // Only looking at it takes nothing either: a sibling of the same role reading it never becomes its owner.
    await recados.antesDaTarefa(caller, mine, { tool: 'tarefa_ver', id });
    expect(g.ledger!.load().doc.tasks[id]!.ownerPlaceId).toBe(DEV);
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

describe('Decisão do dono pelo celular com o PC desligado', () => {
  it('o aviso vai à sessão dona que roda nesta máquina (recados.json), não à fila do PC; a de fora segue pela fila; uma vez só', async () => {
    const g = setup();
    const recados = g.make();
    const relay = createRelay({ filePath: join(g.dir, 'fila.json'), io });
    const writer = createCardWriter({ service: () => g.ledger, deliver: deliverLocalFirst(recados.deliverLocal, relay, 0) });
    const id = await deliveredTask(g.ledger!);
    const rejected = await g.ledger!.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: 'falta o caso vazio' });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;

    expect(await writer.tellDecision(rejected.task)).toEqual({ placeId: DEV });
    // The same decision again (same event = same key): joins, never a second item.
    expect(await writer.tellDecision(rejected.task)).toEqual({ placeId: DEV });
    expect(relay.pending()).toHaveLength(0);
    const stop = JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_DEV), hookBody(SID_DEV))).body) as { decision?: string; reason?: string };
    expect(stop.decision).toBe('block');
    expect(stop.reason).toContain('falta o caso vazio');
    expect(stop.reason!.split('falta o caso vazio')).toHaveLength(2);
    // Delivered at the end of the turn, a late retry still does not queue it again.
    expect(await writer.tellDecision(rejected.task)).toEqual({ placeId: DEV });
    expect(JSON.parse((await recados.hook('fim-de-turno', tmuxHeader(SID_DEV), hookBody(SID_DEV))).body)).toEqual({});

    // The owner's words on a card of a place that does not run here: the PC's relay, pending until it comes back.
    const comment = await writer.write({ id, text: 'e o caso vazio?', requestId: 'pedido-1' });
    expect(comment).toMatchObject({ ok: true, deliveredTo: { placeId: DEV } });
    const away = await g.ledger!.apply({ kind: 'dono' }, { op: 'aceitar', id: (await deliveredTask(g.ledger!)), requestId: 'p-2' });
    expect(away.ok).toBe(true);
    if (!away.ok) return;
    expect(await writer.tellDecision({ ...away.task, ownerPlaceId: LIDER })).toBeNull();
    expect(relay.pending()).toEqual([expect.objectContaining({ message: expect.objectContaining({ placeId: LIDER }) })]);
    expect(await writer.tellDecision({ ...away.task, ownerPlaceId: LIDER })).toBeNull();
    expect(relay.pending(), 'a repetição junta na fila').toHaveLength(1);
  });
});
