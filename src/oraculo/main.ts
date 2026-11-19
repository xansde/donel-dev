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

import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../main/ledger-store';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { createGateHandler, GATE_PORT, startGateServer, tunnelForward } from './portao';
import { createGateRecados, tmuxLocalSessions } from './recados';
import { createProbe } from './sonda';
import { createSatelliteLedger, createSatelliteNotice, createSatelliteReviewLink, createSatelliteTaskMemory } from './satelite';
import { ORACLE_PORT } from './server';
import { canonicalJson, createSupabaseLedgerStore, readSupabaseLedger } from './ledger-supabase';
import { exportSqliteLedger, LEDGER_SQLITE_FILE, seedSqliteLedger } from './ledger-sqlite';
import { SERVICE_PLACE_PREFIX, SERVICE_ROLE } from '../shared/ledger/contract';
import { createPictureStore, readGateToken, runEntregador } from './entregador';
import { oracleMode } from './modo';
import { LEDGER_SUPABASE_FILE, runRegistro, supabaseLedgerDeps } from './registro';

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

/**
 * The satellite (`DONEL_PORTAO_SATELITE`): only the MCP gate of this machine's sessions, the probe that pictures them
 * and the recados between them. No ledger, phone, mirror, vigia nor events here: the tasks go to the personal VPS's
 * Oráculo; a message for a place off this machine goes on to the PC through the session's tunnel, and with the PC off
 * to the personal VPS's relay (as the notices do), waiting on disk here while that machine does not answer.
 */
async function runSatellite(dir: string, url: string): Promise<void> {
  const io = createSystemConfigIoDeps();
  const sessionsDir = join(homedir(), '.donel', 's');
  const pictures = createPictureStore(dir, sessionsDir);
  const remote = { url, token: () => readGateToken(dir) };
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

/** The daemon must be stopped for an offline write: it keeps the ledger in memory and would write over it. */
async function daemonAnswers(dir: string): Promise<boolean> {
  try {
    const url = readFileSync(join(dir, 'url'), 'utf8').trim();
    await fetch(`${url}/v1/ledger`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * `oraculo.mjs --semear-sqlite` (dono, 18/11: "Vamos trazer para um sqlite local mesmo"): a new `ledger.sqlite` from the
 * ledger.json, read back and compared; then the ledger.json is set aside (`ledger.json.antes-sqlite-<hora>`, read-only)
 * so nothing reads a stale copy. With the daemon stopped.
 */
async function seedSqlite(dir: string, ledgerFile: string): Promise<number> {
  if (await daemonAnswers(dir)) {
    console.error('[semear-sqlite] o daemon está no ar: pare-o antes (systemctl --user stop donel-oraculo)');
    return 1;
  }
  if (!existsSync(ledgerFile)) {
    console.error(`[semear-sqlite] não há ${ledgerFile}: nada a semear`);
    return 1;
  }
  const loaded = createLedgerService({ filePath: ledgerFile, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs }).load();
  if (loaded.readOnly) {
    console.error('[semear-sqlite] o ledger.json é de uma versão mais nova que este daemon: nada foi semeado');
    return 1;
  }
  const doc = loaded.doc;
  const result = await seedSqliteLedger(join(dir, LEDGER_SQLITE_FILE), doc);
  console.log(JSON.stringify({ ledgerJson: Object.keys(doc.tasks).length, ...result }));
  if (result.diferentes !== 0 || result.tarefas !== Object.keys(doc.tasks).length) return 1;
  const aside = `${ledgerFile}.antes-sqlite-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(ledgerFile, aside);
  chmodSync(aside, 0o400);
  console.log(JSON.stringify({ ledgerJsonGuardado: aside }));
  return 0;
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
  // Passo 9 (t-5358d400) — the satellite, the registro with the entregador (no mark, as before the split), the registro
  // alone or the entregador alone (`entregador.separado` + DONEL_ORACULO_MODO=entregador): modo.ts.
  const mode = oracleMode(process.env, dir);
  if (mode === 'satelite') return runSatellite(dir, process.env.DONEL_PORTAO_SATELITE!.trim());
  if (mode === 'entregador') return onSignal(await runEntregador({ dir, home: homedir() }));
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
  if (process.argv.includes('--semear-sqlite')) process.exit(await seedSqlite(dir, ledgerFile));
  if (process.argv.includes('--exportar-sqlite')) {
    const target = process.argv[process.argv.indexOf('--exportar-sqlite') + 1];
    if (!target) process.exit(2);
    console.log(JSON.stringify(exportSqliteLedger(join(dir, LEDGER_SQLITE_FILE), target)));
    process.exit(0);
  }
  onSignal(await runRegistro({ dir, home: homedir(), host, port, entregador: mode === 'junto' ? 'junto' : 'separado' }));
}

/** SIGTERM / SIGINT stop the daemon and exit once it closed. */
function onSignal(daemon: { stop(): Promise<void> }): void {
  const stop = (): void => void daemon.stop().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('[oraculo] não subiu:', error);
  process.exit(1);
});
