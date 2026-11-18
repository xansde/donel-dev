// Oráculo na VPS — the headless daemon (`donel-oraculo`, a systemd user unit; scripts/oraculo-vps.sh installs it).
// It owns `<dir>/ledger.json` and `<dir>/ledger-provas/` with today's ledger code, unchanged: same format, same
// `applyLedgerOp`. Plan: docs/planos/oraculo-na-vps.md.
//
// `<dir>/pc.token.sha256` is written by the PC through its own ssh at each boot (the token itself only lives in the
// PC's memory); `<dir>/url` is where this daemon listens, for the PC to read through the same ssh.
//
// Env: DONEL_ORACULO_DIR (default ~/.donel/oraculo), DONEL_ORACULO_HOST (default: this place's Tailscale address),
// DONEL_ORACULO_PORT (default 47816), DONEL_LIVRO_ARQUIVO (F6 do ledger bom: the journal file; unset = no journal
// route, which is today's production until F4), DONEL_BOARD_CONFIG (quadro de tarefas, t-1e354d15: default
// ~/.donel/board/supabase.json; missing = no `card_*` tools).
// `<dir>/decisoes.json` (t-52bf8b45, same shape as the board's config): the phone app's decision queue in Supabase,
// applied to the ledger here; missing = the queue is off. Its optional `importar` (t-8762b0ac) lists the unsigned rows
// the Líder vouched for (`readImportList` in decisoes.ts); its optional `"semAssinatura": "aceitar"` (the owner's order,
// 17/11, t-2eedda0d) applies every unsigned row, with a note in the ledger (`readUnsignedPolicy`). The owner's
// per-page notes of each marked row go to `<dir>/notas-paginas.jsonl`, never into a decision's text. The same file
// turns on the queue of tasks the owner asks for in the phone (t-2eedda0d, tarefas-pedidas.ts) once its
// `quadroTarefas` names the board they land on.
//
// Canal do Donel fora do PC (t-e195b35c): the gate answers with the recados queue (`<dir>/recados.json`, recados.ts)
// and the probe (sonda.ts) pictures the sessions the PC has not; other machines' gates record here through
// `/v1/portao/*` (`<dir>/portoes/<name>.sha256`, portoes.ts). With `DONEL_PORTAO_SATELITE=<the personal VPS's API url>`
// this bundle runs as such a gate (the Homologações, scripts/portao-satelite.sh): the gate, the probe and the recados
// only, with the tasks on the personal VPS (`<dir>/portao.token`, satelite.ts).

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../main/ledger-store';
import { createCardWriter, type CardWriter } from '../main/ledger-card-writer';
import { createCelularCore } from '../main/celular/service';
import { createLedgerMobilePort } from '../main/celular/ledger-port';
import { createOracleAdminRoutes } from './admin';
import { createRelay } from './relay';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { callerOf, createOracleApiHandler } from './api';
import { readServiceHashes } from './servicos';
import { createLivroStore } from './livro';
import { createReturnGuard } from './devolvido';
import { createGateHandler, GATE_PORT, mergePicture, startGateServer, tunnelForward, type BoardPicture, type PictureSession } from './portao';
import { createGateRecados, tmuxLocalSessions } from './recados';
import { createGateToolRoutes, readGateHashes } from './portoes';
import { createProbe } from './sonda';
import { createSatelliteLedger, createSatelliteNotice, createSatelliteReviewLink, createSatelliteTaskMemory } from './satelite';
import { ORACLE_PORT, startOracleServer, type OracleServer } from './server';
import { createDaemonVigia } from './vigia';
import { boardName } from '../shared/vigia/board';
import { createBoardClient, readBoardConfig, type BoardStore } from './board-client';
import { canonicalJson, createSupabaseLedgerStore, readSupabaseLedger, type SupabaseLedgerDeps, type SupabaseLedgerStore } from './ledger-supabase';
import { createLedgerMirror, type LedgerMirror } from '../main/ledger-mirror/mirror';
import { createSupabaseSink } from '../main/ledger-mirror/supabase-sink';
import { createProofReader } from '../main/ledger-mirror/cartas';
import { withPlaceMemory, type PlaceInfo, type PlaceInfoOf } from '../shared/ledger/mirror';
import { SERVICE_PLACE_PREFIX, SERVICE_ROLE } from '../shared/ledger/contract';
import { createDecisoesConsumer, createDecisoesQueue, DECISOES_CONFIG_FILE, NOTAS_PAGINAS_FILE, readImportList, readUnsignedPolicy } from './decisoes';
import { createTarefasPedidasConsumer, createTarefasPedidasQueue, readQuadroTarefas } from './tarefas-pedidas';

export const TOKEN_HASH_FILE = 'pc.token.sha256';
/** t-89279f84 — `{url, serviceKeyFile}`: present, the Supabase is the ledger's source (ledger.json is not read). */
export const LEDGER_SUPABASE_FILE = 'ledger-supabase.json';

function supabaseLedgerDeps(dir: string): SupabaseLedgerDeps | null {
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

/**
 * `oraculo.mjs --semear-supabase`: copies ledger.json into the Supabase (empty tables only, unless `--forcar`) and
 * reads it back: same ids, same JSON. Run once, with the daemon stopped, before writing ledger-supabase.json's switch.
 */
async function seedSupabase(dir: string, ledgerFile: string): Promise<number> {
  const deps = supabaseLedgerDeps(dir);
  if (!deps) {
    console.error(`[semear] sem ${LEDGER_SUPABASE_FILE} válido`);
    return 2;
  }
  const local = createLedgerService({ filePath: ledgerFile, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs }).load().doc;
  const remote = await readSupabaseLedger(deps);
  if (Object.keys(remote.tasks).length > 0 && !process.argv.includes('--forcar')) {
    console.error(`[semear] o Supabase já tem ${Object.keys(remote.tasks).length} tarefas; nada foi gravado (use --forcar para gravar por cima)`);
    return 1;
  }
  const store = createSupabaseLedgerStore(deps, remote);
  if (!(await store.write(local))) return 1;
  const back = await readSupabaseLedger(deps);
  const ids = Object.keys(local.tasks);
  const diff = ids.filter((id) => canonicalJson(back.tasks[id]) !== canonicalJson(local.tasks[id]));
  console.log(JSON.stringify({ ledgerJson: ids.length, supabase: Object.keys(back.tasks).length, diferentes: diff.length, schemaVersion: back.schemaVersion, startedAt: back.startedAt }));
  return diff.length === 0 && Object.keys(back.tasks).length === ids.length ? 0 : 1;
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

/**
 * The last picture of the board (kept across a restart, `<dir>/retrato.json`): what the PC pushes, over it what the
 * probe asks of the sessions the PC has not pictured. A session whose folder is gone (closed) leaves it.
 */
function createPictureStore(dir: string): { get(): BoardPicture | null; set(next: BoardPicture): void; setSession(sid: string, session: PictureSession): void } {
  const pictureFile = join(dir, 'retrato.json');
  const sessionsDir = join(homedir(), '.donel', 's');
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
  return {
    get: () => picture,
    set: (next) => save(mergePicture(picture, next, exists)),
    // The probe's session carries its own `at`; the picture's (the PC's last push) does not move.
    setSession: (sid, session) => save(mergePicture(picture, { at: picture?.at ?? Date.now(), sessoes: { [sid]: session } }, exists)),
  };
}

/** The gate token of this machine (the satellite), written by scripts/portao-satelite.sh; `null` = none. */
function readGateToken(dir: string): string | null {
  try {
    const token = readFileSync(join(dir, 'portao.token'), 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * The satellite (`DONEL_PORTAO_SATELITE`): only the MCP gate of this machine's sessions, the probe that pictures them
 * and the recados between them. No ledger, phone, mirror, vigia nor events here: the tasks go to the personal VPS's
 * Oráculo; a message for a place off this machine goes on to the PC through the session's tunnel, and with the PC off
 * to the personal VPS's relay (as the notices do), waiting on disk here while that machine does not answer.
 */
async function runSatellite(dir: string, url: string): Promise<void> {
  const io = createSystemConfigIoDeps();
  const pictures = createPictureStore(dir);
  const remote = { url, token: () => readGateToken(dir) };
  const sessionsDir = join(homedir(), '.donel', 's');
  // Item 5 with the ledger on the personal VPS: the task each call left (its answer brings it) for the notices after it,
  // and the review link of a message with no arrow asked there.
  const tasks = createSatelliteTaskMemory();
  // A notice for another machine waits on disk until the personal VPS takes it (revisão do #486).
  const notices = createSatelliteNotice({ ...remote, file: join(dir, 'avisos-pendentes.json'), io });
  const recados = createGateRecados({
    file: join(dir, 'recados.json'),
    io,
    ledger: () => null,
    taskOf: tasks.taskOf,
    reviewLinked: createSatelliteReviewLink(remote),
    picture: pictures.get,
    relay: notices.send,
  });
  const gatePort = Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT;
  const gate = await startGateServer({
    port: gatePort,
    handler: createGateHandler({
      sessionsDir,
      ledger: () => {
        throw new Error('o satélite não tem registro');
      },
      runLedger: createSatelliteLedger({ ...remote, onTask: tasks.remember }),
      picture: pictures.get,
      forward: tunnelForward,
      serverVersion: 'oraculo-satelite',
      recados,
    }),
  });
  writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
  recados.start();
  notices.start();
  const probe = createProbe({ sessionsDir, liveSessions: tmuxLocalSessions, picture: pictures.get, setSession: pictures.setSession });
  probe.start();
  if (!readGateToken(dir)) console.error(`[oraculo] satélite: sem ${join(dir, 'portao.token')}; as tarefas desta máquina são recusadas até ele existir.`);
  console.log(`[oraculo] satélite no ar: portão 127.0.0.1:${gate.port}, registro em ${url}`);
  const stop = (): void => {
    probe.stop();
    recados.stop();
    notices.stop();
    void gate.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

/** The way back: `oraculo.mjs --exportar-supabase <arquivo>` writes the Supabase's ledger as a ledger.json (new file only). */
async function exportSupabase(dir: string, target: string | undefined): Promise<number> {
  const deps = supabaseLedgerDeps(dir);
  if (!deps || !target) {
    console.error(`[exportar] uso: --exportar-supabase <arquivo novo>, com ${LEDGER_SUPABASE_FILE} válido`);
    return 2;
  }
  const remote = await readSupabaseLedger(deps);
  writeFileSync(target, JSON.stringify({ schemaVersion: remote.schemaVersion, startedAt: remote.startedAt, tasks: remote.tasks }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ arquivo: target, tarefas: Object.keys(remote.tasks).length }));
  return 0;
}

/**
 * t-5839d76b — data fix with the daemon STOPPED: `--cancelar-offline t-a,t-b --motivo "..."` cancels a service's own
 * cards (owner `servico:*`) in the Supabase, signed by that service, as the service itself would. Only service cards:
 * any other task goes through the Oráculo. Refuses while the daemon answers (it keeps the ledger in memory).
 */
async function cancelOffline(dir: string, ids: string | undefined, reason: string | undefined): Promise<number> {
  const deps = supabaseLedgerDeps(dir);
  if (!deps || !ids || !reason?.trim()) {
    console.error(`[cancelar] uso: --cancelar-offline <ids,separados> --motivo "<texto>", com ${LEDGER_SUPABASE_FILE} válido`);
    return 2;
  }
  try {
    const url = readFileSync(join(dir, 'url'), 'utf8').trim();
    await fetch(`${url}/v1/ledger`, { signal: AbortSignal.timeout(1500) });
    console.error('[cancelar] o daemon está no ar: pare-o antes (systemctl --user stop donel-oraculo)');
    return 1;
  } catch {
    // not answering: safe to write
  }
  const remote = await readSupabaseLedger(deps);
  const store = createSupabaseLedgerStore(deps, remote);
  const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store });
  let failed = 0;
  for (const id of ids.split(',').map((item) => item.trim()).filter(Boolean)) {
    const task = service.load().doc.tasks[id];
    if (!task || !task.ownerPlaceId.startsWith(SERVICE_PLACE_PREFIX)) {
      console.log(JSON.stringify({ id, ok: false, motivo: task ? `não é carta de serviço (${task.ownerPlaceId})` : 'não existe' }));
      failed += 1;
      continue;
    }
    const result = await service.apply({ kind: 'lugar', placeId: task.ownerPlaceId, roleId: SERVICE_ROLE }, { op: 'cancelar', id, reason: reason.trim() });
    console.log(JSON.stringify({ id, ok: result.ok, antes: task.state, ...(result.ok ? { depois: result.task.state } : { motivo: result.reason }) }));
    if (!result.ok) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  const dir = process.env.DONEL_ORACULO_DIR || join(homedir(), '.donel', 'oraculo');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const satellite = process.env.DONEL_PORTAO_SATELITE?.trim();
  if (satellite) return runSatellite(dir, satellite);
  // The first slice left the token itself on disk; only its hash stays now.
  if (existsSync(join(dir, 'pc.token'))) unlinkSync(join(dir, 'pc.token'));
  const host = process.env.DONEL_ORACULO_HOST || pickTailscaleAddress(networkInterfaces());
  if (!host) {
    // systemd starts it again (Restart=always): the Tailscale may come up after the boot.
    console.error('[oraculo] sem endereço da Tailscale; saindo para tentar de novo.');
    process.exit(2);
  }
  const port = Number(process.env.DONEL_ORACULO_PORT) || ORACLE_PORT;
  const ledgerFile = join(dir, 'ledger.json');
  if (process.argv.includes('--semear-supabase')) process.exit(await seedSupabase(dir, ledgerFile));
  if (process.argv.includes('--cancelar-offline')) process.exit(await cancelOffline(dir, process.argv[process.argv.indexOf('--cancelar-offline') + 1], process.argv[process.argv.indexOf('--motivo') + 1]));
  if (process.argv.includes('--exportar-supabase')) process.exit(await exportSupabase(dir, process.argv[process.argv.indexOf('--exportar-supabase') + 1]));
  // t-89279f84 — the Supabase as the source: read once here; unreachable = no daemon (systemd tries again), never an
  // empty ledger answering.
  const sbDeps = supabaseLedgerDeps(dir);
  let store: SupabaseLedgerStore | undefined;
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
  const cardWriter: CardWriter = createCardWriter({
    service: () => ledger,
    deliver: async (message) => {
      const to = await relay.send(message, RELAY_WAIT_MS);
      return to === 'pendente' ? null : to;
    },
  });
  // t-52bf8b45 — the phone app's queue decides through the same port as the PWA (dedup by pedido, owner queue check),
  // over the guarded ledger, never `raw`.
  const decisoesPort = createLedgerMobilePort(() => ledger, undefined, () => cardWriter);
  celular = createCelularCore({
    userDataDir: dir,
    io,
    ledger: () => ledger,
    provasRoot: ledgerProofsDir(ledgerFile),
    cardWriter: () => cardWriter,
    deliverToLeader: () => async (text, pedidoId) =>
      (await relay.send({ projectPath: '', placeId: '', text, leaderText: text, ...(pedidoId ? { key: `pedido:${pedidoId}` } : {}) }, RELAY_WAIT_MS)) === 'lider',
  });
  // Fatia 4: the last picture of the board the PC left (kept across a restart), for the MCP gate of the VPS's sessions.
  const pictures = createPictureStore(dir);
  const setPicture = pictures.set;
  const sessionsDir = join(homedir(), '.donel', 's');
  // t-e195b35c — the recados of this machine's sessions; a notice or message for a place off it goes to the PC's relay
  // (queued on disk, no wait: nothing reads where it went, and a sessao_enviar with the PC off answers at once).
  const recados = createGateRecados({ file: join(dir, 'recados.json'), io, ledger: () => ledger, picture: pictures.get, relay: (message) => relay.send(message, 0) });
  // Fails here, not on the first call, when the file is there but unreadable (it would be written over).
  const first = raw.load();
  if (sbDeps) {
    // The readable projection (`tarefas`) and the phone's cards, as the espelho bridge did from the file: the same
    // mirror, fed by this daemon's own changes. Names: the board picture the PC leaves, over the bridge's memory.
    const namesFile = join(homedir(), '.donel', 'espelho', 'nomes.json');
    const names = new Map<string, PlaceInfo>();
    try {
      for (const [id, info] of Object.entries(JSON.parse(readFileSync(namesFile, 'utf8')) as Record<string, PlaceInfo>)) names.set(id, info);
    } catch {
      // no memory yet
    }
    const liveOf = (): PlaceInfoOf => {
      const live = new Map<string, PlaceInfo>();
      for (const session of Object.values(pictures.get()?.sessoes ?? {})) {
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
    const sink = createSupabaseSink({ url: sbDeps.url, key: sbDeps.key, readProof: createProofReader(ledgerProofsDir(ledgerFile)), log: (line) => console.log(`[espelho] ${line}`) });
    mirror = createLedgerMirror({ sink: () => sink, places: withPlaceMemory(liveOf, names, saveNames), ownerName: () => process.env.ESPELHO_DONO || 'Alexandre', delayMs: 2_000, log: (line) => console.log(`[espelho] ${line}`) });
    mirror.changed(first.doc);
  }
  const handler = createOracleApiHandler({
    ledger,
    ledgerFile,
    ...(store ? { importRefused: 'A fonte do ledger é o Supabase; a cópia do PC não substitui mais o Oráculo da VPS. Nada foi trocado.' } : {}),
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
    gateRoutes: createGateToolRoutes({
      ledger: () => ledger,
      recados,
      linkPedido: (pedidoId, tarefa) => void celular?.linkPedido(pedidoId, tarefa),
      notice: (message) => relay.send(message, 0),
    }),
    ...(process.env.DONEL_LIVRO_ARQUIVO ? { livro: createLivroStore({ filePath: process.env.DONEL_LIVRO_ARQUIVO }) } : {}),
  });
  server = await startOracleServer({ host, port, caller: (authorization) => callerOf(authorization, tokenHash(), services(), gates()), handler });
  writeFileSync(join(dir, 'url'), `${server.url}\n`, { mode: 0o600 });
  // The task board: read at each call, so writing the config turns it on without a restart.
  const boardConfigFile = process.env.DONEL_BOARD_CONFIG || join(homedir(), '.donel', 'board', 'supabase.json');
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
  const gatePort = Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT;
  const gate = await startGateServer({
    port: gatePort,
    handler: createGateHandler({
      sessionsDir,
      ledger: () => ledger,
      picture: pictures.get,
      recados,
      forward: tunnelForward,
      serverVersion: 'oraculo-vps',
      cards,
      // The phone's server lives here: a task a VPS session creates from an owner's request shows on his phone.
      linkPedido: (pedidoId, tarefa) => void celular?.linkPedido(pedidoId, tarefa),
      // The notices after a task (a delivery, a "travada", a verdict) go by the recados: queued for a session of this
      // machine, else to the PC's relay, which today's app delivers when it answers.
    }),
  });
  // The setup of a remote session reads this to point its MCP at the gate.
  writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
  recados.start();
  // The sessions the PC has not pictured (its push, every 30 s, comes first: a fresh picture is not asked again).
  const probe = createProbe({ sessionsDir, liveSessions: tmuxLocalSessions, picture: pictures.get, setSession: pictures.setSession });
  probe.start();
  // t-ffbf8e7d — the vigia of this place's locks, with the PC off too (the PC hands its setup at each handshake).
  const vigia = createDaemonVigia({
    dir,
    ledger: () => ledger,
    log: (line) => console.log(line),
    boardOfSession: (sid) => {
      const pasta = pictures.get()?.sessoes[sid]?.quemSou?.pasta;
      return typeof pasta === 'string' && pasta ? boardName(pasta) : undefined;
    },
  });
  vigia.start();
  // t-52bf8b45 — the config is read at each round: writing `decisoes.json` turns the queue on without a restart.
  const decisoes = createDecisoesConsumer({
    queue: () => {
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
      const config = readBoardConfig(join(dir, DECISOES_CONFIG_FILE));
      return config ? createTarefasPedidasQueue(config) : null;
    },
    quadro: () => readQuadroTarefas(join(dir, DECISOES_CONFIG_FILE)),
    // With the ledger's source in the Supabase the daemon's mirror writes the new task's row (with place names).
    hasMirror: mirror !== null,
    ownerName: () => process.env.ESPELHO_DONO || 'Alexandre',
    ledger: () => ledger,
    returned: guard.returned,
    log: (line) => console.log(line),
  });
  tarefasPedidas.start();
  console.log(`[oraculo] no ar em ${server.url} (${Object.keys(first.doc.tasks).length} tarefas${first.readOnly ? ', só leitura' : ''}, fonte: ${store ? 'Supabase' : 'ledger.json'})`);
  const stop = (): void => {
    probe.stop();
    recados.stop();
    vigia.stop();
    decisoes.stop();
    tarefasPedidas.stop();
    mirror?.dispose();
    void Promise.all([server?.close(), celular?.dispose(), gate.close()]).then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('[oraculo] não subiu:', error);
  process.exit(1);
});
