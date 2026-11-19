// Passo 9 (t-5358d400) — the entregador of the Oráculo: the MCP gate of this machine's sessions (47817), the recados
// between them (`recados.json`), the Líder único found in this tmux, the sessions opened here with the PC off, the probe
// and the board picture (`retrato.json`). Without the mark `entregador.separado` the registro runs it in its own process
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
import { clearAdoptedMarks, createOpenLocal, readOpenKit, roomRefusal, sweepUnfinishedOpenings, type ScriptRun } from './abrir-local';
import { createBoardClient, readBoardConfig, type BoardStore } from './board-client';
import { createLocalLeaderFinder, currentConversation } from './lider-local';
import { RETRATO_PC_FILE } from './modo';
import { createGateHandler, GATE_PORT, mergePicture, startGateServer, tunnelForward, type BoardPicture, type GateDeps, type PictureSession } from './portao';
import { createGateRecados, findTranscript, tmuxLocalSessions, type GateRecadosHandle } from './recados';
import { deliverLocalFirst, type Relay } from './relay';
import { createLocalPicture, tmuxLiveNow } from './retrato-local';
import { createRemotePictures, type RemotePictures } from './retrato-satelite';
import { noticeOf } from './portoes';
import { createSatelliteLedger, createSatelliteNotice, createSatelliteReviewLink, createSatelliteTaskMemory, postJson, type SatellitePost } from './satelite';
import { createProbe } from './sonda';

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
function runLocalScript(script: string): Promise<ScriptRun> {
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
function loopbackPortFree(port: number): Promise<boolean> {
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
  /**
   * t-d461e003 — the other machines' pictures and queues (`portoes-retrato/`, `portoes-recados/`) when the registro runs
   * here: its `/v1/portao/retrato|recados` routes use this same one. Apart = `null`: the registro alone writes them.
   */
  readonly remotes: RemotePictures | null;
  readonly pictures: PictureStore;
  /** The picture the gate, the recados and the Líder read (the stored one, with this tmux's live sessions). */
  readonly localPicture: { get(): BoardPicture | null };
  /** The PC's push (`POST /v1/retrato`) when the registro runs here. */
  setPicture(next: BoardPicture): void;
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
  // them waits in that machine's queue here, which its satellite takes. Only with the registro in this process: apart,
  // the registro's routes write those files and the entregador leaves them alone (one writer; PR 2 brings them over).
  const remotes = junto ? createRemotePictures({ dir, io }) : null;
  const picture = (): BoardPicture | null => (remotes ? remotes.combine(localPicture.get()) : localPicture.get());
  const pictureWithoutPc = (sid: string): BoardPicture | null => (remotes ? remotes.combine(localPicture.withoutPc(sid)) : localPicture.withoutPc(sid));
  // t-c3fbe852 — the Líder único alive in this machine's tmux (the app's mark in its session folder, or the picture).
  const localLeader = createLocalLeaderFinder({ sessionsDir, liveSessions, picture: localPicture.get });
  // A session resumed from another conversation (the Líder that came over with `-r`) writes that one's transcript.
  const transcriptOf = async (sid: string): Promise<string | undefined> => (await findTranscript(currentConversation(sessionsDir, sid) ?? sid)) ?? findTranscript(sid);

  // Apart: the tasks on the registro's API (the url it writes at each start), a notice for another machine on disk
  // until the registro takes it, the task each call left remembered for the notices after it.
  let apart: { readonly notices: ReturnType<typeof createSatelliteNotice>; readonly runLedger: NonNullable<GateDeps['runLedger']>; readonly url: string } | null = null;
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
      relay: (message) => junto.relay.send(message, 0),
      leader: localLeader,
      transcriptOf,
      localSessions: liveSessions,
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
    apart = { notices, runLedger: createSatelliteLedger({ ...remote, onTask: tasks.remember }), url };
    recados = createGateRecados({
      file: join(dir, 'recados.json'),
      io,
      ledger: () => null,
      taskOf: tasks.taskOf,
      reviewLinked: createSatelliteReviewLink(remote),
      picture,
      relay: notices.send,
      leader: localLeader,
      transcriptOf,
      localSessions: liveSessions,
    });
  }
  /** What goes to the Líder único: his own queue when he lives here, else the PC's relay (no wait). */
  const toLeader = junto
    ? deliverLocalFirst(recados.deliverLocal, junto.relay, 0)
    : async (message: OwnerMessage) => (await recados.deliverLocal(message).catch(() => null)) ?? (await apart!.notices.send(message), null);

  // The task board: read at each call, so writing the config turns it on without a restart.
  const boardConfigFile = process.env.DONEL_BOARD_CONFIG || join(place.home, '.donel', 'board', 'supabase.json');
  let boardStore: { readonly key: string; readonly store: BoardStore } | null = null;
  let boardConfigWarned = false;
  const cards = (): BoardStore | null => {
    const config = readBoardConfig(boardConfigFile);
    if (!config) {
      if (!boardConfigWarned && existsSync(boardConfigFile)) {
        boardConfigWarned = true;
        console.error(`[oraculo] ${boardConfigFile} existe mas é inválido ({url https, serviceKeyFile}); quadro de tarefas desligado.`);
      }
      return null;
    }
    boardConfigWarned = false;
    const key = `${config.url}|${config.serviceKeyFile}`;
    if (boardStore?.key !== key) boardStore = { key, store: createBoardClient(config) };
    return boardStore.store;
  };

  let gate: { readonly port: number; close(): Promise<void> } | null = null;
  let probe: ReturnType<typeof createProbe> | null = null;
  return {
    recados,
    remotes,
    pictures,
    localPicture,
    setPicture: (next) => {
      pictures.set(next);
      adopted(next);
    },
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
          ...(apart ? { runLedger: apart.runLedger } : {}),
          picture,
          pcAway: localPicture.away,
          pictureWithoutPc,
          recados,
          forward: tunnelForward,
          serverVersion: 'oraculo-vps',
          cards,
          // t-1a3f7150 (docs/adr/0009) — the Líder único's `sessao_abrir` with the PC off opens the session in this tmux.
          abrir: createOpenLocal({
            sessionsDir,
            oraculoDir: dir,
            picture: localPicture.get,
            setSession: pictures.setSession,
            forgetSession: pictures.forget,
            leader: localLeader,
            liveSessions,
            deliver: toLeader,
            run: runLocalScript,
            room: () => roomRefusal({ freeBytes: freemem(), loadPerCpu: loadavg()[0]! / Math.max(1, cpus().length) }),
            portFree: loopbackPortFree,
            names: [hostname()],
          }),
          // Saída iii — a new phone app's key (the token never leaves the daemon) and the Líder's answer from chat_lider.py.
          // Apart (passo 9, PR 2): the registro's deliveries to these recados.
          local: junto ? junto.local : localDeliverRoute(recados),
          // The phone's server lives with the registro: a task a VPS session creates from an owner's request shows on his phone.
          ...(junto ? { linkPedido: junto.linkPedido } : {}),
          // The notices after a task (a delivery, a "travada", a verdict) go by the recados: queued for a session of this
          // machine, else to the PC's relay, which today's app delivers when it answers.
        }),
      });
      // The setup of a remote session reads this to point its MCP at the gate.
      writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
      recados.start();
      apart?.notices.start();
      // The sessions the PC has not pictured (its push, every 30 s, comes first: a fresh picture is not asked again).
      probe = createProbe({ sessionsDir, liveSessions, picture: pictures.get, setSession: pictures.setSession });
      probe.start();
    },
    stop() {
      probe?.stop();
      recados.stop();
      apart?.notices.stop();
      return gate ? gate.close() : Promise.resolve();
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
