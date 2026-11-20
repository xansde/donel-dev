// t-f66595b2 — a session that waits for a slot in the limitador (claude.sh held by `limitador.py espera`, up to 4 h)
// lost its opening request: the app on the PC types it only within 240 s of opening the tab, and nobody types it when
// the CLI finally comes up. What breaks without the owner noticing: a session alive for hours on an empty box, holding
// a slot and doing nothing, and a recado to it that never goes in (it has no transcript yet) until it goes stale.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createGateHandler, type BoardPicture, type GateForward } from '../src/oraculo/portao';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const PLACE = 'place:revisor-novo';
const SID = '5b767b87-2222-4333-8444-555555555555';
const PEDIDO = '[t-1234abcd] Revisar o PR 12: confira o teste e mescle se o verify estiver verde.';

/** A screen of the CLI with the input field between the two last rules. */
function boxScreen(field: string): string {
  return ['╭───╮', '│ Claude Code │', '╰───╯', '', '─'.repeat(40), `❯ ${field}`, '─'.repeat(40), '  ? for shortcuts'].join('\n');
}
/** What the tmux shows while claude.sh waits in the limitador: no input field at all. */
const WAITING = 'VPS pessoal sem vaga (vivas: 5 de 5). Esperando a vaga (até 240 min)…';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'primeira-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 20, 5);
  const live = new Set([SID]);
  const screens = new Map<string, string>([[SID, WAITING]]);
  const typed: { sid: string; text: string }[] = [];
  /** No entry = no transcript yet (the CLI never started a conversation). */
  const turns = new Map<string, { ended: boolean; at: number; empty?: boolean }>();
  const inTranscript = new Map<string, string[]>();
  const tmux: RecadosTmux = {
    screen: async (sid) => ({ inMode: false, text: screens.get(sid) ?? WAITING }),
    type: async (sid, text) => {
      typed.push({ sid, text });
      return true;
    },
    enter: async () => true,
    clear: async () => true,
  };
  const picture: BoardPicture = { at: clock, sessoes: { [SID]: { quemSou: { nome: 'Revisor · atlas', pasta: PROJECT, lugar: PLACE, papel: 'revisor' }, listar: [] } } };
  const firstFile = join(dir, 'primeiras.json');
  const recados = createGateRecados({
    file: join(dir, 'recados.json'),
    io,
    ledger: () => null,
    picture: () => picture,
    localSessions: async () => new Set(live),
    tmux,
    relay: async () => undefined,
    transcriptOf: async (sid) => (turns.has(sid) ? `/transcripts/${sid}.jsonl` : undefined),
    lastTurn: async (path) => turns.get(path.replace(/^.*\/|\.jsonl$/g, '')) ?? null,
    transcriptHas: async (path, label) => (inTranscript.get(path.replace(/^.*\/|\.jsonl$/g, '')) ?? []).some((line) => line.includes(label)),
    firstMessages: firstFile,
    placeOf: (sid) => (sid === SID ? PLACE : undefined),
    now: () => clock,
    log: () => undefined,
  });
  /** The CLI took what was typed: its words are the first message of the transcript. */
  const cliTakes = (): void => {
    turns.set(SID, { ended: false, at: clock, empty: false });
    inTranscript.set(SID, typed.map((entry) => entry.text));
    screens.set(SID, `${boxScreen('')}\n  esc to interrupt`);
  };
  const run = async (ms: number, step = 2_000): Promise<void> => {
    for (let spent = 0; spent < ms; spent += step) {
      await recados.tick();
      clock += step;
    }
  };
  const items = (): { id: string; estado: string; texto: string; para: { sid: string } }[] => {
    const file = join(dir, 'recados.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { items: { id: string; estado: string; texto: string; para: { sid: string } }[] }).items : [];
  };
  const remember = (pedido = PEDIDO, em = clock): void => writeFileSync(firstFile, JSON.stringify({ items: [{ placeId: PLACE, pedido, em }] }));
  return { dir, firstFile, recados, screens, typed, turns, inTranscript, cliTakes, run, items, remember, clock: () => clock };
}

describe('Sessão que espera vaga no limitador: o pedido de abertura entra quando a caixa aparece', () => {
  it('a caixa só aparece 10 min depois de aberta (o PC já desistiu de colar): o pedido entra uma vez, inteiro, e nunca de novo', async () => {
    const g = setup();
    g.remember();
    // 10 min in the limitador: no field on the screen, nothing typed.
    await g.run(10 * 60_000);
    expect(g.typed).toEqual([]);
    // The slot came: the CLI is up with an empty box. Not typed right away (it may still be loading).
    g.screens.set(SID, boxScreen(''));
    await g.run(60_000);
    expect(g.typed).toEqual([]);
    await g.run(90_000);
    expect(g.typed).toHaveLength(1);
    expect(g.typed[0]!.sid).toBe(SID);
    expect(g.typed[0]!.text).toContain(PEDIDO);
    // Confirmed by the transcript; no more typing, ever; the stored request is gone.
    g.cliTakes();
    await g.run(60_000);
    g.turns.set(SID, { ended: true, at: g.clock() });
    g.screens.set(SID, boxScreen(''));
    await g.run(20 * 60_000);
    expect(g.typed).toHaveLength(1);
    expect(g.items().filter((item) => item.para.sid === SID).map((item) => item.estado)).toEqual(['entregue']);
    expect(JSON.parse(readFileSync(g.firstFile, 'utf8')).items).toEqual([]);
  });

  it('o PC colou o pedido a tempo (a conversa já começou): o guardado não entra em dobro', async () => {
    const g = setup();
    g.remember();
    g.screens.set(SID, boxScreen(''));
    g.turns.set(SID, { ended: false, at: g.clock(), empty: false });
    await g.run(20 * 60_000);
    expect(g.typed).toEqual([]);
    expect(JSON.parse(readFileSync(g.firstFile, 'utf8')).items).toEqual([]);
  });

  it('caixa com diálogo na tela ou sessão trabalhando: nada é digitado até ela ficar livre e parada', async () => {
    const g = setup();
    g.remember();
    await g.run(6 * 60_000);
    g.screens.set(SID, ['Do you trust the files in this folder?', '', '❯ 1. Yes, proceed', '  2. No, exit', '', 'Enter to confirm · Esc to cancel'].join('\n'));
    await g.run(5 * 60_000);
    expect(g.typed).toEqual([]);
    g.screens.set(SID, `${boxScreen('')}\n  esc to interrupt`);
    await g.run(5 * 60_000);
    expect(g.typed).toEqual([]);
    g.screens.set(SID, boxScreen(''));
    await g.run(3 * 60_000);
    expect(g.typed).toHaveLength(1);
  });

  it('pedido maior que o teto do tmux: digita o começo e aponta o arquivo com o pedido inteiro', async () => {
    const g = setup();
    const long = `${PEDIDO}\n${'linha do pedido com acentuação. '.repeat(900)}`;
    g.remember(long);
    g.screens.set(SID, boxScreen(''));
    await g.run(10 * 60_000);
    expect(g.typed).toHaveLength(1);
    const text = g.typed[0]!.text;
    expect(Buffer.byteLength(text)).toBeLessThan(15_000);
    expect(text).toContain(PEDIDO);
    const path = /em (\S+\.md)/.exec(text)?.[1];
    expect(path).toBeDefined();
    expect(readFileSync(path!, 'utf8')).toBe(long);
  });
});

describe('Recado para sessão que nunca teve turno (sem transcript)', () => {
  it('entra quando a caixa está vazia e parada há 1 min; nunca enquanto ela ainda espera vaga', async () => {
    const g = setup();
    const sent = await g.recados.deliverLocal({ projectPath: PROJECT, placeId: PLACE, text: '◆ De Líder (lider): retome o trabalho do PR 12', leaderText: '' });
    expect(sent).toEqual({ placeId: PLACE });
    await g.run(30 * 60_000);
    expect(g.typed).toEqual([]);
    g.screens.set(SID, boxScreen(''));
    await g.run(30_000);
    expect(g.typed).toEqual([]);
    await g.run(60_000);
    expect(g.typed).toHaveLength(1);
    expect(g.typed[0]!.text).toContain('retome o trabalho do PR 12');
  });
});

describe('Portão: o pedido de um sessao_abrir que o PC abriu fica guardado', () => {
  it('resposta ok do PC guarda lugar e pedido; erro do PC não guarda nada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'primeira-portao-'));
    dirs.push(dir);
    const sessions = join(dir, 's');
    const caller = '11111111-2222-4333-8444-555555555555';
    const token = 'd'.repeat(43);
    mkdirSync(join(sessions, caller), { recursive: true });
    writeFileSync(join(sessions, caller, 'meta.json'), JSON.stringify({ sid: caller, mcpToken: token, mcpPort: 25710 }));
    let answer: unknown = { content: [{ type: 'text', text: JSON.stringify({ lugar: PLACE, nome: 'Revisor', papel: 'revisor', roda: 'VPS pessoal' }) }] };
    const forward: GateForward = async (_port, request) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: (JSON.parse(request.body) as { id: number }).id, result: answer }),
    });
    const remembered: { placeId: string; pedido: string }[] = [];
    const handle = createGateHandler({
      sessionsDir: sessions,
      ledger: () => createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs }),
      picture: () => null,
      forward,
      serverVersion: 'teste',
      firstMessage: (placeId, pedido) => remembered.push({ placeId, pedido }),
    });
    const call = (pedido: string) =>
      handle({ method: 'POST', path: `/s/${caller}/mcp`, authorization: `Bearer ${token}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sessao_abrir', arguments: { papel: 'revisor', pedido } } }) });
    await call(PEDIDO);
    expect(remembered).toEqual([{ placeId: PLACE, pedido: PEDIDO }]);
    answer = { isError: true, content: [{ type: 'text', text: 'Sem vaga.' }] };
    await call('outro');
    expect(remembered).toHaveLength(1);
  });
});
