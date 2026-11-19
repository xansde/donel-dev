// Passo 9 (t-5358d400) — the registro of the Oráculo: the one writer of the ledger (`ledger.sqlite`, or ledger.json /
// the Supabase where those are the source), the PC's API on the Tailscale (47816: SSE, `fila.json`, services, other
// machines' gates), the phone's server and its queues (decisions, tasks asked for, the chat with the Líder), the card
// writer, the vigia and the journal. Without the mark `entregador.separado` it runs the entregador (entregador.ts) in
// this same process, as before the split; with the mark it leaves the entregador's files alone: the PC's picture goes to
// `retrato-pc.json`, and what it delivered through the local recados goes to the PC's relay.

import { appendFileSync, chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../main/ledger-store';
import type { LedgerStore } from '../main/ledger-store';
import { createCardWriter, type CardWriter } from '../main/ledger-card-writer';
import { createCelularCore } from '../main/celular/service';
import { createLedgerMobilePort } from '../main/celular/ledger-port';
import { createLedgerMirror, type LedgerMirror } from '../main/ledger-mirror/mirror';
import { createSupabaseSink } from '../main/ledger-mirror/supabase-sink';
import { createProofReader } from '../main/ledger-mirror/cartas';
import { whisperServerTranscriber } from '../main/celular/transcrever';
import { withPlaceMemory, type PlaceInfo, type PlaceInfoOf } from '../shared/ledger/mirror';
import type { DeliverOwnerMessage } from '../main/ledger-card-writer';
import { createOracleAdminRoutes } from './admin';
import { createRelay, deliverLocalFirst } from './relay';
import { callerOf, createOracleApiHandler } from './api';
import { readServiceHashes } from './servicos';
import { createLivroStore } from './livro';
import { createReturnGuard } from './devolvido';
import { GATE_PORT, type BoardPicture } from './portao';
import { createGateToolRoutes, isLocalGate, readGateHashes, type GateRoutes } from './portoes';
import { renewBeforeTask } from './recados';
import { createRemotePictures } from './retrato-satelite';
import { ORACLE_PORT, startOracleServer, type OracleServer } from './server';
import { createDaemonVigia } from './vigia';
import { readBoardConfig } from './board-client';
import { createSupabaseLedgerStore, readSupabaseLedger, type SupabaseLedgerDeps } from './ledger-supabase';
import { LEDGER_SQLITE_FILE, ledgerSourceOf, openSqliteLedgerStore } from './ledger-sqlite';
import { createDecisoesConsumer, createDecisoesQueue, DECISOES_CONFIG_FILE, NOTAS_PAGINAS_FILE, readImportList, readUnsignedPolicy } from './decisoes';
import { createTarefasPedidasConsumer, createTarefasPedidasQueue, readQuadroTarefas } from './tarefas-pedidas';
import { createChatCelularConsumer, createChatCelularQueue } from './chat-celular';
import { CELULAR_LOCAL_FILE, createCelularLocalStore } from './celular-local';
import { createCelularV2Handler } from './celular-v2';
import { CHAT_AUDIO_TIMEOUT_MS, createChatAudioWorker, DAEMON_WHISPER_URL } from './chat-audio';
import { startChatArquivoSweep } from './chat-arquivo';
import { chatResponder } from './chat-responder';
import { boardOfSession, createEntregador, createLocalDeliverClient, gatePortOf, type Entregador, type EntregadorPlace } from './entregador';
import { RETRATO_PC_FILE } from './modo';
import { CHAT_REPLIES_FILE, CHAT_TAIL_BYTES, readTail, repliesStore } from './chat-entregador';
import { GATE_PHONE_PAIR_PATH, isChatRoute, registroPhonePort } from './celular-frente';
import { MOBILE_PORT } from '../main/celular/server';

export const TOKEN_HASH_FILE = 'pc.token.sha256';
/** t-89279f84 — `{url, serviceKeyFile}`: present, the Supabase is the ledger's source (ledger.json is not read). */
export const LEDGER_SUPABASE_FILE = 'ledger-supabase.json';

export function supabaseLedgerDeps(dir: string): SupabaseLedgerDeps | null {
  const config = readBoardConfig(join(dir, LEDGER_SUPABASE_FILE));
  if (!config) return null;
  return {
    url: config.url,
    key: () => {
      try {
        return readFileSync(config.serviceKeyFile, 'utf8').trim() || null;
      } catch {
        return null;
      }
    },
    log: (line) => console.log(line),
  };
}

/** The hash the PC left; `null` = none yet (every call is refused). Read at each call: the PC rewrites it at boot. */
export function readTokenHash(dir: string): string | null {
  try {
    const hash = readFileSync(join(dir, TOKEN_HASH_FILE), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** The entregador's `retrato.json`, read (never written) when it runs apart: re-read when the file changed. */
function pictureReader(file: string): () => BoardPicture | null {
  let seen: { mtime: number; picture: BoardPicture | null } | null = null;
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (seen?.mtime !== mtime) seen = { mtime, picture: JSON.parse(readFileSync(file, 'utf8')) as BoardPicture };
      return seen.picture;
    } catch {
      return seen?.picture ?? null;
    }
  };
}

export interface RegistroPlace extends EntregadorPlace {
  /** This place's Tailscale address (the API never listens elsewhere). */
  readonly host: string;
  /** DONEL_ORACULO_PORT, else 47816. */
  readonly port?: number;
  /** `junto` = no mark: the entregador runs in this process, as before the split. */
  readonly entregador: 'junto' | 'separado';
  /** The API's listener (default: on the Tailscale address). */
  readonly listen?: typeof startOracleServer;
}

/** The registro (and, `junto`, the entregador in the same process); `stop` closes the ledger first, then the rest. */
export async function runRegistro(place: RegistroPlace): Promise<{ readonly url: string; stop(): Promise<void> }> {
  const { dir, home, host } = place;
  const port = place.port ?? ORACLE_PORT;
  const ledgerFile = join(dir, 'ledger.json');
  // t-89279f84 — the Supabase as the source: read once here; unreachable = no daemon (systemd tries again), never an
  // empty ledger answering.
  // 18/11 — the SQLite of this machine when it was seeded (`ledger.sqlite`); a seeded database gone missing stops here.
  const source = ledgerSourceOf(dir);
  const sbDeps = source === 'supabase' ? supabaseLedgerDeps(dir) : null;
  let store: LedgerStore | undefined;
  if (source === 'sqlite') store = openSqliteLedgerStore(join(dir, LEDGER_SQLITE_FILE), (line) => console.log(line), { requireSeeded: true });
  if (sbDeps) {
    const initial = await readSupabaseLedger(sbDeps);
    if (!initial.exists) throw new Error(`o Supabase do ledger está vazio; rode oraculo.mjs --semear-supabase antes de ligar ${LEDGER_SUPABASE_FILE}`);
    store = createSupabaseLedgerStore(sbDeps, initial);
  }
  let mirror: LedgerMirror | null = null;
  const tokenHash = (): string | null => readTokenHash(dir);
  const services = (): ReadonlyMap<string, string> => readServiceHashes(dir);
  const gates = (): ReadonlyMap<string, string> => readGateHashes(dir);
  const io = createSystemConfigIoDeps();
  let server: OracleServer | null = null;
  // What only the PC delivers (its board knows who is open): waits in `fila.json` until the PC acks.
  const relay = createRelay({ filePath: join(dir, 'fila.json'), io, notify: () => server?.notify('fila') });
  const RELAY_WAIT_MS = 10_000;
  // The phone's server lives here now (src/main/celular), so cards reach the phone with the PC off.
  let celular: ReturnType<typeof createCelularCore> | null = null;
  const raw = createLedgerService({
    filePath: ledgerFile,
    io,
    proofFs: nodeLedgerProofFs,
    ...(store ? { store } : {}),
    onChange: (snapshot) => {
      server?.notify('ledger');
      mirror?.changed(snapshot.doc);
      celular?.ledgerChanged(snapshot.doc);
    },
  });
  // Every writer of the daemon (the PC's API, the phone, the card writer) goes through the way back's guard: once
  // the ledger was returned to the PC, nothing writes here.
  const guard = createReturnGuard(raw, dir);
  const ledger = guard.ledger;
  // Saída iii (18/11) — the phone app's queues on this machine (`"fila": "local"` in decisoes.json, read at each
  // round): decisions, the tasks he asks for and his chat with the Líder wait here, not in the Supabase.
  // A file that is there but unreadable never takes the whole daemon down: the phone's queue stays off (404) and the
  // file is kept as it is (revisão do #495).
  let celularLocal: ReturnType<typeof createCelularLocalStore> | null = null;
  const answer = (status: number, value: unknown) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
  /** Saída iii — a new phone app's key (the token never leaves the daemon); its origin is the port the phone reaches. */
  const pairPhone = (input: Record<string, unknown>) => {
    const nome = typeof input.nome === 'string' && input.nome.trim() ? input.nome.trim().slice(0, 60) : 'Donel (Android)';
    const url = celular?.state().url;
    const added = celular?.addDevice(nome) ?? null;
    if (!added || !url) return answer(503, { erro: 'o servidor do celular não está no ar' });
    console.log(`[celular-v2] aparelho novo pareado pela VPS: ${nome} (${added.deviceId})`);
    const origem = url.replace(/\/+$/, '');
    return answer(200, { versao: 1, origem: place.entregador === 'junto' ? origem : origem.replace(/:\d+$/, `:${MOBILE_PORT}`), chave: added.chave });
  };
  // Saída iii — the new phone app's key and the Líder's answer from chat_lider.py, asked through the entregador's gate
  // (`/local/*`) when it runs in this process.
  const localRoutes: NonNullable<Parameters<typeof createEntregador>[1]>['local'] = async (method, path, body) => {
    if (method !== 'POST') return null;
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
    } catch {
      // an empty body is an empty object
    }
    if (path === '/local/celular/novo-aparelho') return pairPhone(input);
    if (path === '/local/celular/chat-responder') {
      if (!celularLocal) return answer(503, { erro: 'a fila do celular está desligada' });
      const replied = chatResponder(celularLocal, input);
      return answer(replied.status, replied.body);
    }
    return null;
  };
  // Passo 9 — the entregador in this process (no mark), with this ledger and this relay, as before the split.
  const entregador: Entregador | null =
    place.entregador === 'junto'
      ? createEntregador(place, { ledger: () => ledger, relay, linkPedido: (pedidoId, tarefa) => void celular?.linkPedido(pedidoId, tarefa), local: localRoutes })
      : null;
  // The entregador apart: its retrato.json is read here (the vigia, the place names), never written.
  const picture = entregador ? entregador.pictures.get : pictureReader(join(dir, 'retrato.json'));
  const setPicture = entregador
    ? entregador.setPicture
    : (next: BoardPicture): void => {
        const file = join(dir, RETRATO_PC_FILE);
        writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      };
  // t-d461e003 — the other machines' pictures and queues: the entregador's when it runs here; apart, only the registro
  // opens `portoes-retrato/` and `portoes-recados/` (its routes keep the pictures and hand the queues; nothing queues).
  const remotes = entregador ? entregador.remotes : createRemotePictures({ dir, io });
  /**
   * The local recados when the entregador runs here; apart (passo 9, PR 2), through its gate on the loopback: with it
   * down, `deliverLocalFirst` takes the message to the PC's relay with the same key (never twice when it comes back).
   */
  const deliverLocal: DeliverOwnerMessage = entregador
    ? entregador.recados.deliverLocal
    : createLocalDeliverClient({ port: () => gatePortOf(dir, place.gatePort ?? (Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT)) });
  // t-4c60b815 — the owner's word or decision reaches a session of this machine through its recados, with the PC off;
  // only a place off this machine waits in the PC's relay. t-c3fbe852: the Líder único too, when he lives here.
  const cardWriter: CardWriter = createCardWriter({
    service: () => ledger,
    deliver: deliverLocalFirst(deliverLocal, relay, RELAY_WAIT_MS),
  });
  /** What goes to the Líder único: his own queue when he lives here, else the PC's relay (no wait). */
  const toLeader = deliverLocalFirst(deliverLocal, relay, 0);
  // t-52bf8b45 — the phone app's queue decides through the same port as the PWA (dedup by pedido, owner queue check),
  // over the guarded ledger, never `raw`.
  const decisoesPort = createLedgerMobilePort(() => ledger, undefined, () => cardWriter);
  try {
    celularLocal = createCelularLocalStore(join(dir, CELULAR_LOCAL_FILE));
  } catch (error) {
    console.log(`[celular-v2] ${CELULAR_LOCAL_FILE} ilegível; a fila do celular fica desligada: ${error instanceof Error ? error.message : String(error)}`);
  }
  const filaLocal = (): boolean => {
    if (!celularLocal) return false;
    try {
      return (JSON.parse(readFileSync(join(dir, DECISOES_CONFIG_FILE), 'utf8')) as { fila?: unknown }).fila === 'local';
    } catch {
      return false;
    }
  };
  // The place names the rows show (the board picture the PC leaves, over the memory the espelho kept).
  const namesFile = join(home, '.donel', 'espelho', 'nomes.json');
  const names = new Map<string, PlaceInfo>();
  try {
    for (const [id, info] of Object.entries(JSON.parse(readFileSync(namesFile, 'utf8')) as Record<string, PlaceInfo>)) names.set(id, info);
  } catch {
    // no memory yet
  }
  const liveOf = (): PlaceInfoOf => {
    const live = new Map<string, PlaceInfo>();
    for (const session of Object.values(picture()?.sessoes ?? {})) {
      for (const place of session.listar as Array<{ id?: unknown; papel?: unknown; nome?: unknown }>) {
        if (typeof place?.id !== 'string') continue;
        const info: PlaceInfo = { ...(typeof place.papel === 'string' ? { roleId: place.papel } : {}), ...(typeof place.nome === 'string' ? { name: place.nome } : {}) };
        if (info.roleId || info.name) live.set(place.id, info);
      }
    }
    return (_project, placeId) => live.get(placeId);
  };
  const saveNames = (): void => {
    try {
      writeFileSync(`${namesFile}.tmp`, JSON.stringify(Object.fromEntries(names), null, 2));
      renameSync(`${namesFile}.tmp`, namesFile);
    } catch {
      // learnt again at the next push
    }
  };
  const placesOf = withPlaceMemory(liveOf, names, saveNames);
  /** A write from the phone runs its consumer now, one round at a time per queue (a round already running reruns once). */
  const rounds: Partial<Record<'decisoes' | 'pedidas' | 'chat', { running: boolean; again: boolean }>> = {};
  let consumers: { decisoes: () => Promise<void>; pedidas: () => Promise<void>; chat: () => Promise<void> } | null = null;
  const kick = (fila: 'decisoes' | 'pedidas' | 'chat'): void => {
    const state = (rounds[fila] ??= { running: false, again: false });
    if (!consumers) return;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    void (async () => {
      do {
        state.again = false;
        await consumers![fila]().catch((error: unknown) => console.log(`[celular-v2] rodada ${fila} falhou: ${error instanceof Error ? error.message : String(error)}`));
      } while (state.again);
      state.running = false;
    })();
  };
  // t-268ed62a — the owner's voice messages, transcribed here by the resident transcriber (loopback only), one at a time.
  // Apart (passo 9, PR 3), the chat, its transcriber and its consumer run in the entregador (chat-local.json).
  const chatHere = place.entregador === 'junto';
  let audioWorker: ReturnType<typeof createChatAudioWorker> | null = null;
  if (celularLocal && chatHere) {
    try {
      audioWorker = createChatAudioWorker({
        store: celularLocal,
        transcribe: whisperServerTranscriber({ url: process.env.DONEL_WHISPER_URL || DAEMON_WHISPER_URL, timeoutMs: CHAT_AUDIO_TIMEOUT_MS }),
        kick: (fila) => kick(fila),
        log: (line) => console.log(line),
      });
    } catch (error) {
      console.log(`[chat-audio] transcritor desligado: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const v2 = celularLocal && createCelularV2Handler({
    verify: (message, signature) => {
      const device = celular?.verifyDecisionSignature(message, signature);
      return device ? { name: device.deviceName } : null;
    },
    doc: () => {
      try {
        return ledger.load().doc;
      } catch {
        return null;
      }
    },
    store: celularLocal,
    places: placesOf,
    ownerName: () => process.env.ESPELHO_DONO || 'Alexandre',
    readProof: createProofReader(ledgerProofsDir(ledgerFile)),
    arvoreFile: join(home, '.donel', 'estado-derivado', 'arvore.json'),
    kick,
    audio: (id) => audioWorker?.enqueue(id),
  });
  /** Apart, the chat routes are the entregador's: here they do not exist (a second writer of the conversation). */
  const v2Here = v2 && !chatHere ? (request: Parameters<typeof v2>[0]) => (isChatRoute(request.url) ? Promise.resolve({ status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ erro: 'nao-encontrada' }) }) : v2(request)) : v2;
  celular = createCelularCore({
    v2: () => (filaLocal() && v2Here ? v2Here : null),
    // Apart, this server listens on DONEL_CELULAR_PORT (47818) behind the entregador's 47815, which the phone reaches.
    ...(chatHere ? {} : { port: registroPhonePort(), publicPort: MOBILE_PORT }),
    userDataDir: dir,
    io,
    ledger: () => ledger,
    provasRoot: ledgerProofsDir(ledgerFile),
    cardWriter: () => cardWriter,
    deliverToLeader: () => async (text, pedidoId) =>
      (await deliverLocalFirst(deliverLocal, relay, RELAY_WAIT_MS)({ projectPath: '', placeId: '', text, leaderText: text, ...(pedidoId ? { key: `pedido:${pedidoId}` } : {}) })) === 'lider',
  });
  // Fails here, not on the first call, when the file is there but unreadable (it would be written over).
  const first = raw.load();
  if (sbDeps) {
    // The readable projection (`tarefas`) and the phone's cards, as the espelho bridge did from the file: the same
    // mirror, fed by this daemon's own changes. Names: the board picture the PC leaves, over the bridge's memory.
    const sink = createSupabaseSink({ url: sbDeps.url, key: sbDeps.key, readProof: createProofReader(ledgerProofsDir(ledgerFile)), log: (line) => console.log(`[espelho] ${line}`) });
    mirror = createLedgerMirror({ sink: () => sink, places: placesOf, ownerName: () => process.env.ESPELHO_DONO || 'Alexandre', delayMs: 2_000, log: (line) => console.log(`[espelho] ${line}`) });
    mirror.changed(first.doc);
  }
  /** Apart (PR 3), the entregador asks the phone app's pairing here, with the gate credential marked local only. */
  const phonePairRoute = (routes: GateRoutes): GateRoutes =>
    entregador
      ? routes
      : async (name, request, path) => {
          if (path !== GATE_PHONE_PAIR_PATH) return routes(name, request, path);
          if (request.method !== 'POST' || !isLocalGate(dir, name)) return answer(403, { erro: 'só o portão local pareia o celular' });
          let input: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(request.body) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
          } catch {
            // an empty body is an empty object
          }
          return pairPhone(input);
        };
  const handler = createOracleApiHandler({
    ledger,
    ledgerFile,
    ...(store ? { importRefused: `A fonte do ledger é o ${source === 'sqlite' ? 'SQLite da VPS' : 'Supabase'}; a cópia do PC não substitui mais o Oráculo da VPS. Nada foi trocado.` } : {}),
    tokenHash,
    services,
    returned: guard,
    changed: () => {
      server?.notify('ledger');
      try {
        celular?.ledgerChanged(ledger.load().doc);
      } catch {
        // unreadable: the next write says it
      }
    },
    extra: createOracleAdminRoutes({ celular, relay, setPicture }),
    gates,
    gateRoutes: phonePairRoute(createGateToolRoutes({
      ledger: () => ledger,
      // Apart (passo 9, PR 2), the renewal before a task runs here, beside the ledger: the entregador's recados have none.
      recados: entregador?.recados ?? { antesDaTarefa: (caller, mine, call) => renewBeforeTask(ledger, caller, mine, call, (line) => console.error(`[oraculo] recados: ${line}`)) },
      linkPedido: (pedidoId, tarefa) => void celular?.linkPedido(pedidoId, tarefa),
      notice: toLeader,
      ...(remotes ? { pictures: remotes } : {}),
      // Apart, the Líder único of this machine reaches the ledger through the entregador's gate (never a satellite's).
      ...(entregador ? {} : { leader: { isLocal: (name: string) => isLocalGate(dir, name), picture: () => (remotes ? remotes.combine(picture()) : picture()) } }),
    })),
    ...(process.env.DONEL_LIVRO_ARQUIVO ? { livro: createLivroStore({ filePath: process.env.DONEL_LIVRO_ARQUIVO }) } : {}),
    // t-cddc62fc — the reconciliador's notices reach the Líder único by the relay, out of the owner's phone chat.
    // t-c3fbe852: his own queue when he lives here.
    avisarLider: async (texto, chave) => (await toLeader({ projectPath: '', placeId: '', text: texto, leaderText: texto, key: `reconciliador:${chave}` })) ?? 'pendente',
  });
  server = await (place.listen ?? startOracleServer)({ host, port, caller: (authorization) => callerOf(authorization, tokenHash(), services(), gates()), handler });
  writeFileSync(join(dir, 'url'), `${server.url}\n`, { mode: 0o600 });
  await entregador?.start();
  // t-ffbf8e7d — the vigia of this place's locks, with the PC off too (the PC hands its setup at each handshake).
  const vigiaPicture = entregador ? entregador.localPicture.get : picture;
  const vigia = createDaemonVigia({
    dir,
    ledger: () => ledger,
    log: (line) => console.log(line),
    boardOfSession: (sid) => boardOfSession(vigiaPicture(), sid),
  });
  vigia.start();
  // t-52bf8b45 — the config is read at each round: writing `decisoes.json` turns the queue on without a restart.
  const decisoes = createDecisoesConsumer({
    queue: () => {
      if (filaLocal() && celularLocal) return celularLocal.decisoes;
      const config = readBoardConfig(join(dir, DECISOES_CONFIG_FILE));
      return config ? createDecisoesQueue(config) : null;
    },
    port: decisoesPort,
    // A signed row counts only when a phone paired here signed it (the APK's queue password is not enough).
    verifier: () => (celular ? (message, signature) => celular?.verifyDecisionSignature(message, signature) ?? null : null),
    phoneOn: () => celular?.state().enabled ?? false,
    // t-8762b0ac — the rows the Líder vouched for (`importar`), applied without a signature, read at each round too.
    importar: () => readImportList(join(dir, DECISOES_CONFIG_FILE)),
    // t-2eedda0d — the owner's order (17/11): `"semAssinatura": "aceitar"` lets the unsigned rows through, read at each round.
    semAssinatura: () => readUnsignedPolicy(join(dir, DECISOES_CONFIG_FILE)),
    // t-8762b0ac (17/11) — the owner's per-page notes are design feedback: kept here, beside the decision, never in a message.
    // The mode only applies on creation (the bridge may create the file first), hence the chmod.
    guardarNotas: (entry) => {
      const file = join(dir, NOTAS_PAGINAS_FILE);
      appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    },
    ledger: () => ledger,
    returned: guard.returned,
    log: (line) => console.log(line),
  });
  decisoes.start();
  // t-2eedda0d — the tasks the owner asks for in the phone app (`celular.tarefas_pedidas`), same config and round.
  const tarefasPedidas = createTarefasPedidasConsumer({
    queue: () => {
      if (filaLocal() && celularLocal) return celularLocal.pedidas;
      const config = readBoardConfig(join(dir, DECISOES_CONFIG_FILE));
      return config ? createTarefasPedidasQueue(config) : null;
    },
    quadro: () => readQuadroTarefas(join(dir, DECISOES_CONFIG_FILE)),
    // With the ledger's source in the Supabase the daemon's mirror writes the new task's row (with place names).
    hasMirror: mirror !== null,
    ownerName: () => process.env.ESPELHO_DONO || 'Alexandre',
    ledger: () => ledger,
    returned: guard.returned,
    // t-c3fbe852 — the Líder único hears of the task the owner asked for (his queue here, else the PC's relay).
    avisarLider: toLeader,
    log: (line) => console.log(line),
  });
  tarefasPedidas.start();
  // t-cddc62fc — the owner's messages to the Líder único in the phone app (`celular.lider_mensagens`), same config and
  // round, delivered by the relay so a PC without the desktop router (before the alfa 26.1118.428) gets them too.
  // The answer goes by stdin (`-` + heredoc): no '~' for the remote shell to expand, no owner text in its argv.
  const replyScript = process.env.DONEL_CHAT_RESPONDER || join(home, 'bin', 'rotinas', 'chat-lider', 'chat_lider.py');
  const recados = entregador?.recados;
  const chatCelular = !chatHere
    ? null
    : createChatCelularConsumer({
    queue: () => {
      if (filaLocal() && celularLocal) return celularLocal.chat;
      const config = readBoardConfig(join(dir, DECISOES_CONFIG_FILE));
      return config ? createChatCelularQueue(config) : null;
    },
    relay,
    waitMs: RELAY_WAIT_MS,
    // t-c3fbe852 — with the Líder único alive here: his own queue, and his answer read from his transcript here.
    // Apart (passo 9, PR 1), the relay until the chat moves to the entregador.
    ...(recados
      ? {
          local: {
            deliver: recados.deliverLocal,
            state: recados.stateOf,
            tail: async (sid: string) => {
              const path = await recados.transcriptOf(sid);
              return path ? readTail(path, CHAT_TAIL_BYTES) : null;
            },
          },
        }
      : {}),
    store: repliesStore(join(dir, CHAT_REPLIES_FILE)),
    replyHint: (shortId) => `Para responder no celular: ssh ${userInfo().username}@${hostname()} python3 ${replyScript} responder ${shortId} - <<'FIM'\n<sua resposta>\nFIM`,
    log: (line) => console.log(line),
  });
  chatCelular?.start();
  consumers = { decisoes: () => decisoes.round(), pedidas: () => tarefasPedidas.round(), chat: () => chatCelular?.round() ?? Promise.resolve() };
  // After the consumers: an audio a restart left half-way is transcribed again and kicks the chat round.
  audioWorker?.start();
  // t-a1ad1ca2 — the owner's files from the phone chat are kept 30 days.
  const stopArquivoSweep = celularLocal && chatHere ? startChatArquivoSweep(celularLocal.arquivoDir, (line) => console.log(line)) : null;
  console.log(
    `[oraculo] no ar em ${server.url} (${Object.keys(first.doc.tasks).length} tarefas${first.readOnly ? ', só leitura' : ''}, fonte: ${source === 'sqlite' ? 'SQLite' : store ? 'Supabase' : 'ledger.json'}${entregador ? '' : ', entregador à parte'})`,
  );
  return {
    url: server.url,
    stop: () => {
      // The SQLite is closed first: its WAL goes into the file (a copy of ledger.sqlite alone is then the whole ledger).
      try {
        (store as { close?: () => void } | undefined)?.close?.();
      } catch {
        // exiting anyway
      }
      const entregadorClosed = entregador?.stop();
      vigia.stop();
      decisoes.stop();
      tarefasPedidas.stop();
      chatCelular?.stop();
      audioWorker?.stop();
      stopArquivoSweep?.();
      mirror?.dispose();
      return Promise.all([server?.close(), celular?.dispose(), entregadorClosed]).then(() => undefined);
    },
  };
}
