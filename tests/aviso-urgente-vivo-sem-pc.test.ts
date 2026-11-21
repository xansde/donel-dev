// t-c292d9a4, parte 2 (21/11) — with the PC away its last list keeps every session it saw "trabalhando", closed or
// not. The #575 made the review request follow the sessions that run; the urgent notice ("travada", "precisa do dono",
// a delivery) still chose by that old list and could go to a closed place above, through the PC's relay that nobody
// empties with the PC away. What must hold: with the PC away, the urgent notice goes to the first place above that
// runs; with none, to the board's Líder that runs; with none, to the Líder único. With the PC on, as before.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { relayedTaskNotice, withLiveOwner, type BoardPicture, type PictureSession } from '../src/oraculo/portao';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_CHEFE = '22222222-2222-4333-8444-555555555555';
const SID_LIDER = '33333333-2222-4333-8444-555555555555';
const SID_UNICO = '44444444-2222-4333-8444-555555555555';
const DEV = 'place:dev';
const CHEFE = `session:${SID_CHEFE}`;
const LIDER = `session:${SID_LIDER}`;

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
// The Chefe is above the Dev by an arrow; the board's Líder has no arrow to either.
const BOARD: MindscapeBoard = {
  projectPath: PROJECT,
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: Object.fromEntries([card(LIDER, 'lider'), card(CHEFE, 'dev'), card(DEV, 'dev')].map((one) => [one.id, one])),
  links: [{ id: 'l1', from: CHEFE, to: DEV, arrow: true, by: 'session', opened: true }],
  drawings: [],
};
// The PC's last picture: every place "trabalhando", the closed ones too.
const LISTAR = [LIDER, CHEFE, DEV].map((id) => ({ id, estado: 'trabalhando' }));
const session = (lugar: string, papel: string): PictureSession => ({ quemSou: { nome: papel, pasta: PROJECT, lugar, papel }, listar: LISTAR, board: BOARD });

function setup(tmux: ReadonlySet<string>, leaderHere: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'urgente-vivo-'));
  dirs.push(dir);
  const clock = Date.UTC(2026, 10, 21, 3);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => clock });
  const picture: BoardPicture = { at: clock, sessoes: { [SID_DEV]: session(DEV, 'dev'), [SID_CHEFE]: session(CHEFE, 'dev'), [SID_LIDER]: session(LIDER, 'lider') } };
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
    ...(leaderHere ? { leader: async () => ({ sid: SID_UNICO }) } : {}),
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
  let made = 0;
  /** The Dev records "travada" on a task of its own; the notices after it run as the gate runs them. */
  async function stuck(pcAway: boolean): Promise<{ relayTarget: string | undefined }> {
    made += 1;
    const caller = withLiveOwner(base, { tmux: () => tmux, pcAway: () => pcAway });
    const created = await runLedgerTool(ledger, caller, { tool: 'tarefa_criar', titulo: `trava ${made}`, pedido: `faz ${made}`, criterio: 'feito', prazo: '2026-11-22', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(ledger, caller, { tool: 'tarefa_assumir', id });
    const call = { tool: 'tarefa_andamento' as const, id, estado: 'travada' as const, precisa: `sem acesso ${made}` };
    const answer = await runLedgerTool(ledger, caller, call);
    expect(answer.ok).toBe(true);
    recados.depoisDaTarefa(SID_DEV, picture.sessoes[SID_DEV]!, caller, call, answer.text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The gate without the recados queue: the notice it hands the relay.
    return { relayTarget: relayedTaskNotice(picture.sessoes[SID_DEV]!, caller, call, answer.text)?.placeId };
  }
  const queued = (): string => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  return { stuck, relayed, queued };
}

describe('aviso urgente com o PC fora (t-c292d9a4)', () => {
  it('quem está acima fechado: vai ao Líder do quadro que roda, nunca ao fechado pelo relay', async () => {
    const g = setup(new Set([SID_DEV, SID_LIDER]), false);
    const away = await g.stuck(true);
    expect(g.queued()).toContain(SID_LIDER);
    expect(g.queued()).toContain('está travada');
    expect(g.relayed).toEqual([]);
    expect(away.relayTarget).toBe(LIDER);
  });

  it('acima e Líder do quadro fechados: sobe ao Líder único (na fila dele quando roda aqui); com o PC ligado, como antes', async () => {
    const g = setup(new Set([SID_DEV]), true);
    const away = await g.stuck(true);
    expect(g.queued()).toContain(SID_UNICO);
    expect(g.relayed.filter((message) => message.placeId === CHEFE || message.placeId === LIDER)).toEqual([]);
    expect(away.relayTarget).toBe('');

    const on = await g.stuck(false);
    expect(on.relayTarget).toBe(CHEFE);
    expect(g.relayed.filter((message) => message.placeId === CHEFE)).toHaveLength(1);
  });
});
