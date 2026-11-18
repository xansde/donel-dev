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
// turns on the queue of tasks the owner asks for in the phone (t-2eedda0d, tarefas-pedidas.ts); its optional
// `quadroTarefas` names the board they land on.

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
import { createGateHandler, GATE_PORT, mergePicture, startGateServer, tunnelForward, type BoardPicture } from './portao';
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
  const pictureFile = join(dir, 'retrato.json');
  let picture: BoardPicture | null = null;
  try {
    picture = JSON.parse(readFileSync(pictureFile, 'utf8')) as BoardPicture;
  } catch {
    picture = null;
  }
  const setPicture = (next: BoardPicture): void => {
    const sessionsDir = join(homedir(), '.donel', 's');
    picture = mergePicture(picture, next, (folder) => /^[A-Za-z0-9-]{1,64}$/.test(folder) && existsSync(join(sessionsDir, folder)));
    writeFileSync(`${pictureFile}.tmp`, JSON.stringify(picture), { mode: 0o600 });
    renameSync(`${pictureFile}.tmp`, pictureFile);
  };
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
      for (const session of Object.values(picture?.sessoes ?? {})) {
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
    ...(process.env.DONEL_LIVRO_ARQUIVO ? { livro: createLivroStore({ filePath: process.env.DONEL_LIVRO_ARQUIVO }) } : {}),
  });
  server = await startOracleServer({ host, port, caller: (authorization) => callerOf(authorization, tokenHash(), services()), handler });
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
    handler: createGateHandler({ sessionsDir: join(homedir(), '.donel', 's'), ledger: () => ledger, picture: () => picture, forward: tunnelForward, serverVersion: 'oraculo-vps', cards }),
  });
  // The setup of a remote session reads this to point its MCP at the gate.
  writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
  // t-ffbf8e7d — the vigia of this place's locks, with the PC off too (the PC hands its setup at each handshake).
  const vigia = createDaemonVigia({
    dir,
    ledger: () => ledger,
    log: (line) => console.log(line),
    boardOfSession: (sid) => {
      const pasta = picture?.sessoes[sid]?.quemSou?.pasta;
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
    ledger: () => ledger,
    returned: guard.returned,
    log: (line) => console.log(line),
  });
  tarefasPedidas.start();
  console.log(`[oraculo] no ar em ${server.url} (${Object.keys(first.doc.tasks).length} tarefas${first.readOnly ? ', só leitura' : ''}, fonte: ${store ? 'Supabase' : 'ledger.json'})`);
  const stop = (): void => {
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
