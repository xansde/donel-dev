// t-c292d9a4 (20/11) — with the PC off, the PC's last picture keeps every session opened on the VPS as "trabalhando",
// closed or not. A delivery named 14 Revisores, most of them closed, and each review request to a closed one went to
// the PC's relay, which nobody empties with the PC off: 356 items went stale there with no notice. What must hold: with
// the PC away, only a Revisor whose session runs decides (and hears); with none running, the delivery waits for the
// reconciliador (it opens a Revisor or tells the Líder) instead of vanishing in the relay. With the PC on, as before.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { withLiveOwner, type BoardPicture, type PictureSession } from '../src/oraculo/portao';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const LIDER = 'place:lider';
const DEV = 'place:dev';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_LIVE = '66666666-2222-4333-8444-555555555555';
const SID_CLOSED = '77777777-2222-4333-8444-555555555555';
const REV_LIVE = `session:${SID_LIVE}`;
const REV_CLOSED = `session:${SID_CLOSED}`;

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
const BOARD: MindscapeBoard = {
  projectPath: PROJECT,
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: Object.fromEntries([card(LIDER, 'lider'), card(DEV, 'dev'), card(REV_LIVE, 'revisor'), card(REV_CLOSED, 'revisor')].map((one) => [one.id, one])),
  links: [{ id: 'l1', from: LIDER, to: DEV, arrow: true, by: 'session', opened: true }],
  drawings: [],
};
// The PC's last picture: every place "trabalhando", the closed Revisor too.
const LISTAR = [LIDER, DEV, REV_LIVE, REV_CLOSED].map((id) => ({ id, estado: 'trabalhando' }));
const session = (lugar: string, papel: string): PictureSession => ({ quemSou: { nome: papel, pasta: PROJECT, lugar, papel }, listar: LISTAR, board: BOARD });

function setup(tmux: ReadonlySet<string>) {
  const dir = mkdtempSync(join(tmpdir(), 'revisor-vivo-'));
  dirs.push(dir);
  const clock = Date.UTC(2026, 10, 20, 23);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => clock });
  const picture: BoardPicture = { at: clock, sessoes: { [SID_DEV]: session(DEV, 'dev'), [SID_LIVE]: session(REV_LIVE, 'revisor'), [SID_CLOSED]: session(REV_CLOSED, 'revisor') } };
  const relayed: { placeId: string }[] = [];
  const noTmux: RecadosTmux = { screen: async () => null, type: async () => false, enter: async () => false, clear: async () => false };
  const file = join(dir, 'recados.json');
  const recados = createGateRecados({
    file,
    io,
    ledger: () => ledger,
    picture: () => picture,
    localSessions: async () => new Set(tmux),
    tmux: noTmux,
    relay: async (message) => void relayed.push(message),
    now: () => clock,
    log: () => undefined,
  });
  const base: LedgerCaller = {
    projectPath: PROJECT,
    placeId: DEV,
    roleId: 'dev',
    boardPlaceIds: Object.keys(BOARD.cards),
    board: BOARD,
    placeStates: new Map([[PROJECT, new Map(LISTAR.map((place) => [place.id, place.estado]))]]),
  };
  /** Creates, takes and delivers a low task as the Dev; the notices after it run as the gate runs them. */
  let made = 0;
  async function deliver(pcAway: boolean): Promise<{ id: string; estado: string; proximo: string }> {
    made += 1;
    const caller = withLiveOwner(base, { tmux: () => tmux, pcAway: () => pcAway });
    const created = await runLedgerTool(ledger, caller, { tool: 'tarefa_criar', titulo: `entrega ${made}`, pedido: `faz ${made}`, criterio: 'feito', prazo: '2026-11-22', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(ledger, caller, { tool: 'tarefa_assumir', id });
    const call = { tool: 'tarefa_entregar' as const, id, provas: [{ tipo: 'texto' as const, texto: `verify verde ${made}` }] };
    const answer = await runLedgerTool(ledger, caller, call);
    expect(answer.ok).toBe(true);
    recados.depoisDaTarefa(SID_DEV, picture.sessoes[SID_DEV]!, caller, call, answer.text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const parsed = JSON.parse(answer.text) as { estado: string; proximo?: string };
    return { id, estado: parsed.estado, proximo: parsed.proximo ?? '' };
  }
  const queued = (): string => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  return { deliver, relayed, queued };
}

describe('Revisor fechado com o PC fora (t-c292d9a4)', () => {
  it('sai da lista do tarefa_entregar e não recebe o pedido pelo relay; o vivo recebe; com o PC ligado, como antes', async () => {
    const g = setup(new Set([SID_DEV, SID_LIVE]));
    const away = await g.deliver(true);
    expect(away.estado).toBe('entregue');
    expect(away.proximo).toContain(REV_LIVE);
    expect(away.proximo).not.toContain(REV_CLOSED);
    expect(g.relayed.filter((message) => message.placeId === REV_CLOSED)).toEqual([]);
    expect(g.queued()).toContain(SID_LIVE);

    const on = await g.deliver(false);
    expect(on.proximo).toContain(REV_LIVE);
    expect(on.proximo).toContain(REV_CLOSED);
  });

  it('sem Revisor vivo, a entrega espera o reconciliador: não fecha sozinha e nada vai ao relay para o fechado', async () => {
    const g = setup(new Set([SID_DEV]));
    const away = await g.deliver(true);
    expect(away.estado).toBe('entregue');
    expect(away.proximo).toContain('reconciliador');
    expect(g.relayed.filter((message) => message.placeId === REV_CLOSED || message.placeId === REV_LIVE)).toEqual([]);
  });
});
