// Passo 9 (t-5358d400) — the entregador of the Oráculo: the MCP gate of this machine's sessions (47817), the recados
// between them (`recados.json`), the Líder único found in this tmux, the sessions opened here with the PC off, the
// renewal of a session past the context limit with the PC away (renovar-local.ts, off by default), the probe and the
// board picture (`retrato.json`). Without the mark `entregador.separado` the registro runs it in its own process
// (`createEntregador` with the registro's ledger and relay, as before the split); with the mark it runs alone
// (`runEntregador`, `DONEL_ORACULO_MODO=entregador`) and never opens the ledger: its `tarefa_*` go to the registro's
// API, as a satellite's do, and a notice for another machine waits in `avisos-pendentes.json` until the registro takes it.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { cpus, freemem, hostname, loadavg } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import type { LedgerService } from '../main/ledger-store';
import type { DeliverOwnerMessage, OwnerMessage } from '../main/ledger-card-writer';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import { boardName } from '../shared/vigia/board';
import { clearAdoptedMarks, createOpenLocal, readOpenKit, REVIEWER_ROLE_ID, roomRefusal, sweepUnfinishedOpenings, type OpenLocal, type ScriptRun } from './abrir-local';
import type { BoardStore } from './board-client';
import { BOARD_SQLITE_CONFIG, chooseBoard, openBoard } from './board-sqlite';
import { markCardTools } from './com-cartoes';
import { createLocalLeaderFinder, currentConversation } from './lider-local';
import { RETRATO_PC_FILE } from './modo';
import { createGateHandler, GATE_PORT, mergePicture, startGateServer, tunnelForward, type BoardPicture, type GateDeps, type PictureSession } from './portao';
import { createGateRecados, findTranscript, systemRecadosTmux, tmuxLocalSessions, type GateRecadosHandle } from './recados';
import { FIRST_MESSAGES_FILE, placeOfSessionIn, rememberFirstMessage } from './primeiras';
import { createLocalRenewal, readLocalRenewalConfig } from './renovar-local';
import { deliverLocalFirst, type Relay } from './relay';
import { createLocalPicture, tmuxLiveKnown, tmuxLiveNow } from './retrato-local';
import { createRemotePictures, createRemotePicturesReader, type RemotePictureView, type RemotePictures } from './retrato-satelite';
import { createRemoteOpenClient, createRemoteOpenings, type RemoteOpenings } from './abrir-satelite';
import { createRemoteScreenClient, createRemoteScreens, type RemoteScreens } from './tela-satelite';
import { GATE_QUEUE_PATH, noticeOf } from './portoes';
import { createSatelliteCardRenewal, createSatelliteLedger, createSatelliteNotice, createSatelliteReviewLink, createSatelliteTaskMemory, postJson, type SatellitePost } from './satelite';
import { createProbe } from './sonda';
import { createEntregadorChat, type EntregadorChat } from './chat-entregador';
import { checkOpenReviewer, OPEN_REVIEWER_OP, RECONCILER_SERVICE, type OpenReviewerOrder, type OpenReviewerOutcome } from './servicos';
import { createGlossarioStore, glossarioFile } from './glossario';
import { createPhoneFront, createPhoneSignatures, GATE_PHONE_PAIR_PATH, registroPhonePort } from './celular-frente';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PictureStore {
  get(): BoardPicture | null;
  set(next: BoardPicture): void;
  setSession(sid: string, session: PictureSession): void;
  forget(sid: string): void;
}

/**
 * The last picture of the board (kept across a restart, `<dir>/retrato.json`): what the PC pushes, over it what the
 * probe asks of the sessions the PC has not pictured. A session whose folder is gone (closed) leaves it.
 * `pcFile` (entregador apart): the PC's push the registro left there is merged in when it is newer than the last one.
 */
export function createPictureStore(dir: string, sessionsDir: string, options: { readonly pcFile?: string; readonly onPcPicture?: (next: BoardPicture) => void } = {}): PictureStore {
  const pictureFile = join(dir, 'retrato.json');
  let picture: BoardPicture | null = null;
  try {
    picture = JSON.parse(readFileSync(pictureFile, 'utf8')) as BoardPicture;
  } catch {
    picture = null;
  }
  const exists = (folder: string): boolean => /^[A-Za-z0-9-]{1,64}$/.test(folder) && existsSync(join(sessionsDir, folder));
  const save = (next: BoardPicture): void => {
    picture = next;
    writeFileSync(`${pictureFile}.tmp`, JSON.stringify(picture), { mode: 0o600 });
    renameSync(`${pictureFile}.tmp`, pictureFile);
  };
  const set = (next: BoardPicture): void => save(mergePicture(picture, next, exists));
  const mtimeOf = (file: string): number | null => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return null;
    }
  };
  // A push older than retrato.json was merged before a restart: it is not laid again over the probe's newer sessions.
  const pcAtStart = options.pcFile ? mtimeOf(options.pcFile) : null;
  const pictureAtStart = mtimeOf(pictureFile);
  let pcSeen: number | null = pcAtStart !== null && pictureAtStart !== null && pictureAtStart >= pcAtStart ? pcAtStart : null;
  const takePcPush = (): void => {
    if (!options.pcFile) return;
    let pushed: BoardPicture;
    try {
      const mtime = statSync(options.pcFile).mtimeMs;
      if (mtime === pcSeen) return;
      pcSeen = mtime;
      pushed = JSON.parse(readFileSync(options.pcFile, 'utf8')) as BoardPicture;
    } catch {
      return;
    }
    if (typeof pushed?.at !== 'number' || typeof pushed.sessoes !== 'object' || pushed.sessoes === null) return;
    set(pushed);
    options.onPcPicture?.(pushed);
  };
  takePcPush();
  return {
    get: () => {
      takePcPush();
      return picture;
    },
    set,
    // The probe's session carries its own `at`; the picture's (the PC's last push) does not move.
    setSession: (sid, session) => save(mergePicture(picture, { at: picture?.at ?? Date.now(), sessoes: { [sid]: session } }, exists)),
    // t-1a3f7150 — the synthetic picture of an opening that failed.
    forget: (sid) => {
      if (!picture?.sessoes[sid]) return;
      const { [sid]: _gone, ...sessoes } = picture.sessoes;
      save({ ...picture, sessoes });
    },
  };
}

/** The gate token of this machine for the registro's `/v1/portao/*` (`<dir>/portao.token`); `null` = none. */
export function readGateToken(dir: string): string | null {
  try {
    const token = readFileSync(join(dir, 'portao.token'), 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * t-1a3f7150 — a bash script (on stdin) as this user, with its login PATH (the daemon runs under systemd): the setup of
 * a session opened with the PC off, its tmux, the inventory of plugins and skills.
 */
export function runLocalScript(script: string): Promise<ScriptRun> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-l', '-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(script);
  });
}

/** Nothing listens on this loopback port of this machine. */
export function loopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * Passo 9 (PR 2) — the registro's deliveries to this machine's recados when the entregador runs apart (the card writer,
 * the notices to the Líder único, the phone's requests): `POST 127.0.0.1:<gate>/local/recados/entregar` `{aviso}` →
 * `{entregue}`, what `deliverLocal` answered (`null` = not here: the registro sends it to the PC's relay).
 */
export const LOCAL_DELIVER_PATH = '/local/recados/entregar';
const LOCAL_DELIVER_TIMEOUT_MS = 5_000;

function deliveredOf(value: unknown): LedgerDeliveredTo {
  if (value === 'lider') return 'lider';
  const placeId = (value as { placeId?: unknown } | null)?.placeId;
  return typeof placeId === 'string' ? { placeId } : null;
}

/** The entregador's side: the message into its recados (the same key joins the item it made, delivered or not). */
function localDeliverRoute(recados: Pick<GateRecadosHandle, 'deliverLocal'>): NonNullable<GateDeps['local']> {
  const answer = (status: number, value: unknown) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
  return async (method, path, body) => {
    if (method !== 'POST' || path !== LOCAL_DELIVER_PATH) return null;
    let message: OwnerMessage | null = null;
    try {
      message = noticeOf((JSON.parse(body) as { aviso?: unknown } | null)?.aviso);
    } catch {
      message = null;
    }
    if (!message) return answer(400, { erro: 'aviso inválido' });
    return answer(200, { entregue: await recados.deliverLocal(message) });
  };
}

/**
 * t-3b258224 — apart, the reconciliador's Revisor asked of this machine's openLocal by the registro (which checked the
 * service's token): `POST 127.0.0.1:<gate>/local/abrir-revisor` `{quadro, pedido, chave, tarefa?}` → the opening's
 * outcome. The body is checked again with the service route's own rule (only these fields; the role is never in it).
 */
export const LOCAL_OPEN_REVIEWER_PATH = '/local/abrir-revisor';
/** The setup (worktree) and the tmux take seconds; the opening line may hold one before it. */
const LOCAL_OPEN_REVIEWER_TIMEOUT_MS = 50_000;

function localOpenReviewerRoute(openReviewer: OpenLocal['openReviewer']): NonNullable<GateDeps['local']> {
  const answer = (status: number, value: unknown) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
  return async (method, path, body) => {
    if (method !== 'POST' || path !== LOCAL_OPEN_REVIEWER_PATH) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return answer(400, { erro: 'corpo não é JSON' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return answer(400, { erro: 'corpo inválido' });
    const order = checkOpenReviewer({ ...(parsed as Record<string, unknown>), op: OPEN_REVIEWER_OP }, RECONCILER_SERVICE);
    if (!order.ok) return answer(order.status, { erro: order.error });
    return answer(200, await openReviewer({ quadro: order.quadro, pedido: order.pedido, ...(order.tarefa ? { tarefa: order.tarefa } : {}) }));
  };
}

/**
 * The registro's side of `LOCAL_OPEN_REVIEWER_PATH`. No answer (the entregador down, or a cut while the opening may still
 * be going) throws, so the service route answers 502 and the reconciliador keeps the opening pending: its next call gets
 * 'ja-tem' with the place when this one did open. Never 'recusada', which the reconciliador does not retry at once.
 */
export function createLocalOpenReviewerClient(deps: {
  readonly port: () => number;
  readonly timeoutMs?: number;
  readonly post?: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost>;
}): (order: OpenReviewerOrder) => Promise<OpenReviewerOutcome> {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? LOCAL_OPEN_REVIEWER_TIMEOUT_MS;
  const RESULTS: ReadonlySet<string> = new Set(['aberta', 'ja-tem', 'sem-vaga', 'recusada']);
  return async (order) => {
    // Never sent twice: a cut after it went out may have opened it, and the next call answers 'ja-tem'.
    const sent = await post(`http://127.0.0.1:${deps.port()}${LOCAL_OPEN_REVIEWER_PATH}`, '', JSON.stringify(order), timeoutMs);
    if (typeof sent !== 'object') throw new Error(`o entregador do Oráculo não respondeu à abertura (${sent})`);
    try {
      const said = JSON.parse(sent.body) as { resultado?: unknown; lugar?: unknown; texto?: unknown; erro?: unknown };
      if (sent.status === 200 && typeof said.resultado === 'string' && RESULTS.has(said.resultado)) {
        return { resultado: said.resultado as OpenReviewerOutcome['resultado'], ...(typeof said.lugar === 'string' ? { lugar: said.lugar } : {}), texto: typeof said.texto === 'string' ? said.texto : '' };
      }
      return { resultado: 'recusada', texto: `o entregador recusou (HTTP ${sent.status}${typeof said.erro === 'string' ? `: ${said.erro}` : ''})` };
    } catch {
      return { resultado: 'recusada', texto: `o entregador recusou (HTTP ${sent.status})` };
    }
  };
}

/**
 * Apart, the gate's `/local/*`: the registro's deliveries, the Líder's answer to the phone (chat_lider.py) and a new
 * phone app's pairing (asked of the registro, which keeps celular.json).
 */
function apartLocalRoutes(
  deliver: NonNullable<GateDeps['local']>,
  chat: Pick<EntregadorChat, 'responder'>,
  pair: (body: string) => Promise<SatellitePost>,
  openReviewer: NonNullable<GateDeps['local']>,
): NonNullable<GateDeps['local']> {
  return async (method, path, body) => {
    if (path === LOCAL_OPEN_REVIEWER_PATH) return openReviewer(method, path, body);
    if (method === 'POST' && path === '/local/celular/novo-aparelho') {
      const sent = await pair(body);
      if (typeof sent !== 'object') return { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ erro: 'o Oráculo da VPS não respondeu' }) };
      return { status: sent.status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: sent.body };
    }
    return (await chat.responder(method, path, body)) ?? deliver(method, path, body);
  };
}

/**
 * The registro's side: `deliverLocal` through the entregador's gate (`port`: where it listens now). Nothing listening,
 * or any other answer = `null`, and `deliverLocalFirst` takes it to the PC's relay with the same key, which a later
 * repeat finds there (never delivered here as well). A cut after it went out is sent once more, the same message.
 */
export function createLocalDeliverClient(deps: {
  readonly port: () => number;
  readonly timeoutMs?: number;
  readonly post?: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost>;
}): DeliverOwnerMessage {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? LOCAL_DELIVER_TIMEOUT_MS;
  return async (message) => {
    const url = `http://127.0.0.1:${deps.port()}${LOCAL_DELIVER_PATH}`;
    const body = JSON.stringify({ aviso: message });
    let sent = await post(url, '', body, timeoutMs);
    if (sent === 'caiu') sent = await post(url, '', body, timeoutMs);
    if (typeof sent !== 'object' || sent.status !== 200) return null;
    try {
      return deliveredOf((JSON.parse(sent.body) as { entregue?: unknown }).entregue);
    } catch {
      return null;
    }
  };
}

/**
 * Passo 9 (t-5358d400) — apart, a message of this machine's sessions for a place of another machine: into that
 * machine's queue at the registro (`POST /v1/portao/fila`, this machine's gate credential marked local), which alone
 * writes `portoes-recados/`. Asked only when a fresh picture here has the place; the same key joins there (a cut after
 * it went out is sent once more, the same message). The registro down, or no answer = `null`: the old way (the notices
 * on disk to the PC's relay, or the refusal).
 */
export function createRemoteQueueClient(deps: {
  readonly url: string;
  readonly token: () => string | null;
  readonly view: Pick<RemotePictureView, 'machineOf'>;
  readonly timeoutMs?: number;
  readonly post?: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost>;
}): (message: OwnerMessage) => Promise<string | null> {
  const post = deps.post ?? postJson;
  const timeoutMs = deps.timeoutMs ?? LOCAL_DELIVER_TIMEOUT_MS;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_QUEUE_PATH}`;
  return async (message) => {
    if (!message.placeId || !message.key || !deps.view.machineOf(message.projectPath, message.placeId)) return null;
    const token = deps.token();
    if (!token) return null;
    const body = JSON.stringify({ aviso: message });
    let sent = await post(url, token, body, timeoutMs);
    if (sent === 'caiu') sent = await post(url, token, body, timeoutMs);
    if (typeof sent !== 'object' || sent.status !== 200) return null;
    try {
      const maquina = (JSON.parse(sent.body) as { maquina?: unknown }).maquina;
      return typeof maquina === 'string' && maquina ? maquina : null;
    } catch {
      return null;
    }
  };
}

/** Where the entregador's gate listens (`<dir>/portao`, written at its start); `fallback` until it wrote one. */
export function gatePortOf(dir: string, fallback: number): number {
  try {
    const port = Number(readFileSync(join(dir, 'portao'), 'utf8').trim());
    return Number.isInteger(port) && port > 0 && port < 65_536 ? port : fallback;
  } catch {
    return fallback;
  }
}

export interface EntregadorPlace {
  /** DONEL_ORACULO_DIR. */
  readonly dir: string;
  /** The user's home: `~/.donel/s` (session folders) and `~/.donel/board`. */
  readonly home: string;
  /** DONEL_ORACULO_PORTAO_PORT, else 47817. */
  readonly gatePort?: number;
  /** This machine's live tmux sessions (default `tmux -L donel ls`), async and synchronous. */
  readonly liveSessions?: () => Promise<ReadonlySet<string>>;
  readonly liveNow?: () => ReadonlySet<string>;
  /**
   * Passo 9, PR 3 — apart, the phone's door (47815): `host` is this machine's Tailscale address, `listen` puts the
   * socket around it (the phone's server's, by default). Absent = no door (the tests of the gate alone).
   */
  readonly phone?: {
    readonly host: string;
    readonly port: number;
    readonly listen: (options: { readonly host: string; readonly port: number; readonly listener: (req: IncomingMessage, res: ServerResponse) => void }) => Promise<{ close(): Promise<void> }>;
  };
}

/** What the registro lends the entregador when both run in one process (no mark). */
export interface EntregadorJunto {
  readonly ledger: () => LedgerService;
  readonly relay: Relay;
  readonly linkPedido: NonNullable<GateDeps['linkPedido']>;
  readonly local: NonNullable<GateDeps['local']>;
}

export interface Entregador {
  readonly recados: GateRecadosHandle;
  /** Apart (PR 3): the owner's chat with the Líder único, answered here. Together = `null` (the registro runs it). */
  readonly chat: EntregadorChat | null;
  /**
   * t-d461e003 — the other machines' pictures and queues (`portoes-retrato/`, `portoes-recados/`) when the registro runs
   * here: its `/v1/portao/retrato|recados` routes use this same one. Apart = `null`: the registro alone writes them.
   */
  readonly remotes: RemotePictures | null;
  /** t-d461e003 — the openings on other machines' boards, with `remotes` (the registro in this process); else `null`. */
  readonly openings: RemoteOpenings | null;
  /** t-69eefa2c — the screens asked of other machines' satellites, with `remotes`; else `null` (the registro's). */
  readonly screens: RemoteScreens | null;
  readonly pictures: PictureStore;
  /** The picture the gate, the recados and the Líder read (the stored one, with this tmux's live sessions). */
  readonly localPicture: { get(): BoardPicture | null; away(): boolean };
  /** The PC's push (`POST /v1/retrato`) when the registro runs here. */
  setPicture(next: BoardPicture): void;
  /** t-3b258224 — the reconciliador's Revisor for a board (the registro's service route, in this process). */
  openReviewer: OpenLocal['openReviewer'];
  /** Sweeps half openings, starts the gate and writes `<dir>/portao`, then the recados and the probe. */
  start(): Promise<void>;
  /** Stops the loops at once; resolves when the gate is closed. */
  stop(): Promise<void>;
}

/** The entregador's pieces; `junto` = the registro of this same process (its ledger and its relay to the PC). */
export function createEntregador(place: EntregadorPlace, junto: EntregadorJunto | null): Entregador {
  const { dir } = place;
  const io = createSystemConfigIoDeps();
  const sessionsDir = join(place.home, '.donel', 's');
  const liveSessions = place.liveSessions ?? tmuxLocalSessions;
  const liveNow = place.liveNow ?? tmuxLiveNow;
  // t-1a3f7150 — a PC push that carries a session opened here with the PC off under `session:<sid>` adopted it.
  const adopted = (next: BoardPicture): void => {
    try {
      for (const sid of clearAdoptedMarks(sessionsDir, next)) console.log(`[oraculo] abrir: o PC adotou a sessão ${sid}, aberta com ele desligado.`);
    } catch (error) {
      console.log(`[oraculo] abrir: marca abertaSemPc: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // Fatia 4: the last picture of the board the PC left (kept across a restart), for the MCP gate of the VPS's sessions.
  const pictures = createPictureStore(dir, sessionsDir, junto ? {} : { pcFile: join(dir, RETRATO_PC_FILE), onPcPicture: adopted });
  // O Oráculo sem o PC (19/11) — what the gate, the recados and the Líder read: the PC's last picture, with the live
  // sessions of this tmux it does not carry made here (all of them with the PC away). The probe keeps the stored one.
  const localPicture = createLocalPicture({
    stored: pictures.get,
    sessionsDir,
    liveNow,
    extras: () => {
      const kit = readOpenKit(dir);
      return kit ? { roda: kit.place.label, roleName: (id: string) => kit.roles.find((role) => role.id === id)?.name } : {};
    },
  });
  // t-d461e003 — the other machines' pictures (their satellites send them, retrato-satelite.ts): what the gate and the
  // recados read is this VPS's picture with their sessions added (never over this VPS's own). A message for one of
  // them waits in that machine's queue here, which its satellite takes. With the registro in this process, these are
  // its own; apart (passo 9), the registro alone writes those files: the entregador reads the pictures and when each
  // satellite was heard, and queues by the registro's `fila` route.
  const remotes = junto ? createRemotePictures({ dir, io }) : null;
  const remoteView: RemotePictureView = remotes ?? createRemotePicturesReader({ dir });
  // t-d461e003 — the Líder único's openings on those machines' boards wait in their queues (`portoes-abrir/`,
  // abrir-satelite.ts): kept here only with the registro in this process; apart, the registro alone writes them and
  // the entregador asks it by the `abrir` route, only for a board a fresh picture of `remoteView` has.
  const openings = remotes ? createRemoteOpenings({ dir, pictures: remotes, kit: () => readOpenKit(dir) }) : null;
  // t-69eefa2c — the Líder único's look at a screen of those machines: an order their satellite takes in its exchange.
  const screens = remotes ? createRemoteScreens({ pictures: remotes }) : null;
  const picture = (): BoardPicture | null => remoteView.combine(localPicture.get());
  const pictureWithoutPc = (sid: string): BoardPicture | null => remoteView.combine(localPicture.withoutPc(sid));
  // t-c3fbe852 — the Líder único alive in this machine's tmux (the app's mark in its session folder, or the picture).
  const localLeader = createLocalLeaderFinder({ sessionsDir, liveSessions, picture: localPicture.get });
  // A session resumed from another conversation (the Líder that came over with `-r`) writes that one's transcript.
  const transcriptOf = async (sid: string): Promise<string | undefined> => (await findTranscript(currentConversation(sessionsDir, sid) ?? sid)) ?? findTranscript(sid);

  // Apart: the tasks on the registro's API (the url it writes at each start), a notice for another machine on disk
  // until the registro takes it, the task each call left remembered for the notices after it.
  let apart: {
    readonly notices: ReturnType<typeof createSatelliteNotice>;
    readonly runLedger: NonNullable<GateDeps['runLedger']>;
    readonly taskOf: NonNullable<GateDeps['taskOf']>;
    readonly url: string;
    readonly pair: (body: string) => Promise<SatellitePost>;
  } | null = null;
  let recados: GateRecadosHandle;
  if (junto) {
    // t-e195b35c — the recados of this machine's sessions; a notice or message for a place off it goes to the PC's relay
    // (queued on disk, no wait: nothing reads where it went, and a sessao_enviar with the PC off answers at once).
    recados = createGateRecados({
      file: join(dir, 'recados.json'),
      io,
      ledger: junto.ledger,
      picture,
      remote: remotes!.queue,
      remoteScreen: async (pasta, lugar) => {
        const answer = await screens!.ask(pasta, lugar);
        return answer ? { kind: answer.ok ? 'text' : 'error', text: answer.text } : null;
      },
      relay: (message) => junto.relay.send(message, 0),
      leader: localLeader,
      transcriptOf,
      localSessions: liveSessions,
      firstMessages: join(dir, FIRST_MESSAGES_FILE),
      placeOf: placeOfSessionIn(sessionsDir),
    });
  } else {
    let url: string;
    try {
      url = readFileSync(join(dir, 'url'), 'utf8').trim();
    } catch {
      url = '';
    }
    if (!url) throw new Error(`sem ${join(dir, 'url')}: o registro (donel-oraculo) ainda não subiu`);
    const remote = { url, token: () => readGateToken(dir) };
    const tasks = createSatelliteTaskMemory();
    const notices = createSatelliteNotice({ ...remote, file: join(dir, 'avisos-pendentes.json'), io });
    apart = {
      notices,
      runLedger: createSatelliteLedger({ ...remote, onTask: tasks.remember }),
      taskOf: tasks.taskOf,
      url,
      // The phone app's pairing writes celular.json: the registro's, through the gate credential marked local.
      pair: (body) => postJson(`${url.replace(/\/+$/, '')}${GATE_PHONE_PAIR_PATH}`, readGateToken(dir) ?? '', body, LOCAL_DELIVER_TIMEOUT_MS),
    };
    recados = createGateRecados({
      file: join(dir, 'recados.json'),
      io,
      ledger: () => null,
      taskOf: tasks.taskOf,
      reviewLinked: createSatelliteReviewLink(remote),
      renewCard: createSatelliteCardRenewal(remote),
      picture,
      remote: createRemoteQueueClient({ ...remote, view: remoteView }),
      remoteScreen: createRemoteScreenClient({ ...remote, view: remoteView }),
      relay: notices.deliver,
      leader: localLeader,
      transcriptOf,
      localSessions: liveSessions,
      firstMessages: join(dir, FIRST_MESSAGES_FILE),
      placeOf: placeOfSessionIn(sessionsDir),
    });
  }
  // Passo 9, PR 3 — apart, the chat lives here: a message for a Líder único not on this machine goes to the registro's
  // relay through the notices on disk (the same key joins; acked once the registro took it).
  const chat: EntregadorChat | null = apart
    ? createEntregadorChat({
        dir,
        home: place.home,
        recados,
        relay: { send: (message) => apart!.notices.send(message), pending: apart.notices.outbox.pending, byKey: apart.notices.outbox.byKey },
        verify: createPhoneSignatures(join(dir, 'celular.json'), io).verify,
        glossario: createGlossarioStore(glossarioFile(), (line) => console.log(line)),
      })
    : null;
  /** What goes to the Líder único: his own queue when he lives here, else the PC's relay (no wait). */
  const toLeader = junto
    ? deliverLocalFirst(recados.deliverLocal, junto.relay, 0)
    : async (message: OwnerMessage) => (await recados.deliverLocal(message).catch(() => null)) ?? (await apart!.notices.send(message), null);

  // The task board: the config is read at each call, so writing it turns the board on without a restart. sqlite.json
  // (the board in a SQLite of this machine, 20/11) wins over supabase.json; an invalid one turns the board off.
  const boardPaths = {
    sqliteConfig: process.env.DONEL_BOARD_SQLITE_CONFIG || join(place.home, '.donel', 'board', BOARD_SQLITE_CONFIG),
    supabaseConfig: process.env.DONEL_BOARD_CONFIG || join(place.home, '.donel', 'board', 'supabase.json'),
  };
  let boardStore: { readonly key: string; readonly store: BoardStore & { close?: () => void } } | null = null;
  let boardConfigWarned = false;
  const cards = (): BoardStore | null => {
    const choice = chooseBoard(boardPaths, place.home);
    if (choice.kind === 'off' || choice.kind === 'invalid') {
      if (!boardConfigWarned && choice.kind === 'invalid') {
        boardConfigWarned = true;
        console.error(`[oraculo] ${choice.file} existe mas é inválido (${choice.expected}); quadro de tarefas desligado.`);
      }
      boardStore?.store.close?.();
      boardStore = null;
      return null;
    }
    boardConfigWarned = false;
    if (boardStore?.key !== choice.key) {
      boardStore?.store.close?.();
      try {
        boardStore = { key: choice.key, store: openBoard(choice) };
      } catch (error) {
        boardStore = null;
        console.error(`[oraculo] o quadro de tarefas não abriu: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    return boardStore.store;
  };

  // t-1a3f7150 (docs/adr/0009) — sessions opened in this tmux with the PC off: the Líder único's `sessao_abrir`, and the
  // successor of a renewal (t-49dee38d).
  const room = (): string | null => roomRefusal({ freeBytes: freemem(), loadPerCpu: loadavg()[0]! / Math.max(1, cpus().length) });
  const openLocal = createOpenLocal({
    sessionsDir,
    oraculoDir: dir,
    home: place.home,
    picture: localPicture.get,
    setSession: pictures.setSession,
    forgetSession: pictures.forget,
    leader: localLeader,
    liveSessions,
    run: runLocalScript,
    room,
    portFree: loopbackPortFree,
    names: [hostname()],
    // t-d461e003 — a board of another machine (its satellite pictures it): the opening goes there. Apart, the
    // registro alone keeps those queues (`portoes-abrir/`), asked with this machine's local gate token for a
    // board the reader of its pictures sees.
    remote: openings ? async (call) => openings.request(call) : createRemoteOpenClient({ url: apart!.url, token: () => readGateToken(dir), view: remoteView }),
    // t-3b258224 — a Revisor alive on a board of another machine, by its fresh picture (only live sessions travel).
    remoteReviewer: (quadro) => {
      const machine = remoteView.boardMachine(quadro);
      if (!machine) return null;
      const session = Object.values(remoteView.combine(null)?.sessoes ?? {}).find((one) => one.maquina === machine.name && one.quemSou.pasta === machine.pasta && one.quemSou.papel === REVIEWER_ROLE_ID);
      return typeof session?.quemSou.lugar === 'string' ? session.quemSou.lugar : null;
    },
  });
  // t-49dee38d — a session past the context limit renewed here with the PC away (renovar-local.ts): off until
  // `<dir>/renovar-local.json` says `"enabled": true` and lists the session in `"somente"` (empty = nobody). Only this
  // daemon of the personal VPS runs it; the satellite does not.
  const renewal = createLocalRenewal({
    sessionsDir,
    handoffsDir: join(place.home, '.donel', 'handoffs'),
    config: () => readLocalRenewalConfig(dir),
    pcAway: localPicture.away,
    leader: localLeader,
    liveSessions,
    transcriptOf,
    screen: (sid) => systemRecadosTmux.screen(sid),
    type: (sid, text) => systemRecadosTmux.type(sid, text),
    kill: (sid) => systemRecadosTmux.kill?.(sid) ?? Promise.resolve(false),
    openSuccessor: (call) => openLocal.openSuccessor(call),
    // The place the PC's own picture gives the session (never one made here): for a meta that names none.
    placeOf: (sid) => {
      const lugar = pictures.get()?.sessoes[sid]?.quemSou.lugar;
      return typeof lugar === 'string' && lugar.startsWith('place:') ? lugar : undefined;
    },
    // No room = the handoff is not even asked; and the Líder hears two alive in a place, a lasting give-up, in flight.
    room,
    toLeader,
    // T1 — before the old one is closed, what reached it after the handoff goes to the successor by these recados.
    forward: (call) => recados.forwardAfterHandoff(call),
  });

  let gate: { readonly port: number; close(): Promise<void> } | null = null;
  let probe: ReturnType<typeof createProbe> | null = null;
  let door: { close(): Promise<void> } | null = null;
  let doorTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** The phone's door; a failure (the Tailscale not up, the port taken) is tried again each minute. */
  const openDoor = async (): Promise<void> => {
    const phone = place.phone;
    if (!phone || !chat || stopped) return;
    try {
      door = await phone.listen({
        host: phone.host,
        port: phone.port,
        listener: createPhoneFront({ chat: chat.handler, upstream: () => ({ host: phone.host, port: registroPhonePort() }) }),
      });
      console.log(`[oraculo] entregador: celular em ${phone.host}:${phone.port} (o resto vai ao registro na ${registroPhonePort()})`);
    } catch (error) {
      console.error(`[oraculo] entregador: a porta do celular ${phone.port} não subiu, tento de novo em 1 min: ${error instanceof Error ? error.message : String(error)}`);
      doorTimer = setTimeout(() => void openDoor(), 60_000);
      doorTimer.unref?.();
    }
  };
  return {
    recados,
    chat,
    remotes,
    openings,
    screens,
    pictures,
    localPicture,
    setPicture: (next) => {
      pictures.set(next);
      adopted(next);
    },
    openReviewer: (order) => openLocal.openReviewer(order),
    async start() {
      // t-1a3f7150 — an opening cut midway (the daemon died while it made the folder) leaves no half session for the PC.
      for (const sid of sweepUnfinishedOpenings(sessionsDir, await liveSessions())) console.log(`[oraculo] abrir: apaguei a pasta ${sid}, aberta pela metade.`);
      const gatePort = place.gatePort ?? (Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT);
      gate = await startGateServer({
        port: gatePort,
        handler: createGateHandler({
          sessionsDir,
          ledger: junto
            ? junto.ledger
            : () => {
                throw new Error('o entregador não tem registro');
              },
          // Apart, the registro's gate route says it (t-d461e003): the caller never leaves this process. t-c292d9a4: the
          // live source there too, for the notices after a delivery (only the Revisores that run hear it, the PC away).
          ...(apart ? { runLedger: apart.runLedger, taskOf: apart.taskOf } : {}),
          liveOwner: { tmux: place.liveNow ?? tmuxLiveKnown, machineOf: (projectPath: string, placeId: string) => remoteView.machineOf(projectPath, placeId), pcAway: localPicture.away },
          picture,
          pcAway: localPicture.away,
          pictureWithoutPc,
          recados,
          forward: tunnelForward,
          serverVersion: 'oraculo-vps',
          firstMessage: (placeId, pedido) => rememberFirstMessage(join(dir, FIRST_MESSAGES_FILE), placeId, pedido, Date.now()),
          cards,
          // t-8406f473 — the sessions served the card_* (the board's vigia wakes only those).
          markCards: (sid: string) => markCardTools(process.env.DONEL_BOARD_DIR || join(place.home, '.donel', 'board'), sid),
          // t-1a3f7150 (docs/adr/0009) — the Líder único's `sessao_abrir` with the PC off opens the session in this tmux.
          abrir: openLocal,
          // Saída iii — a new phone app's key (the token never leaves the daemon) and the Líder's answer from chat_lider.py.
          // Apart (passo 9, PR 2): the registro's deliveries to these recados.
          local: junto ? junto.local : apartLocalRoutes(localDeliverRoute(recados), chat!, apart!.pair, localOpenReviewerRoute(openLocal.openReviewer)),
          // The phone's server lives with the registro: a task a VPS session creates from an owner's request shows on his phone.
          ...(junto ? { linkPedido: junto.linkPedido } : {}),
          // The notices after a task (a delivery, a "travada", a verdict) go by the recados: queued for a session of this
          // machine, else to the PC's relay, which today's app delivers when it answers.
        }),
      });
      // The setup of a remote session reads this to point its MCP at the gate.
      writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
      recados.start();
      // A renewal cut by this restart is never resumed: logged for the Líder, the session stays out (renovar-local.ts).
      await renewal.recover();
      renewal.start();
      apart?.notices.start();
      // The sessions the PC has not pictured (its push, every 30 s, comes first: a fresh picture is not asked again).
      probe = createProbe({ sessionsDir, liveSessions, picture: pictures.get, setSession: pictures.setSession });
      probe.start();
      chat?.start();
      await openDoor();
    },
    stop() {
      stopped = true;
      if (doorTimer) clearTimeout(doorTimer);
      probe?.stop();
      renewal.stop();
      recados.stop();
      apart?.notices.stop();
      chat?.stop();
      return Promise.all([gate?.close(), door?.close()]).then(() => undefined);
    },
  };
}

/** `DONEL_ORACULO_MODO=entregador`, with the mark: the entregador alone, beside the registro's `donel-oraculo`. */
export async function runEntregador(place: EntregadorPlace): Promise<{ stop(): Promise<void> }> {
  const entregador = createEntregador(place, null);
  await entregador.start();
  console.log(`[oraculo] entregador no ar: portão 127.0.0.1:${place.gatePort ?? (Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT)}, registro em ${readFileSync(join(place.dir, 'url'), 'utf8').trim()}`);
  return { stop: () => entregador.stop() };
}

/** The board name of a session in a picture, for the vigia (`undefined` = not pictured). */
export function boardOfSession(picture: BoardPicture | null, sid: string): string | undefined {
  const pasta = picture?.sessoes[sid]?.quemSou?.pasta;
  return typeof pasta === 'string' && pasta ? boardName(pasta) : undefined;
}
