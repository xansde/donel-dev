// Oráculo na VPS — the headless daemon (`donel-oraculo`, a systemd user unit; scripts/oraculo-vps.sh installs it).
// It owns `<dir>/ledger.json` and `<dir>/ledger-provas/` with today's ledger code, unchanged: same format, same
// `applyLedgerOp`. Plan: docs/planos/oraculo-na-vps.md.
//
// `<dir>/pc.token.sha256` is written by the PC through its own ssh at each boot (the token itself only lives in the
// PC's memory); `<dir>/url` is where this daemon listens, for the PC to read through the same ssh.
//
// Env: DONEL_ORACULO_DIR (default ~/.donel/oraculo), DONEL_ORACULO_HOST (default: this place's Tailscale address),
// DONEL_ORACULO_PORT (default 47816).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../main/ledger-store';
import { createCardWriter, type CardWriter } from '../main/ledger-card-writer';
import { createCelularCore } from '../main/celular/service';
import { createOracleAdminRoutes } from './admin';
import { createRelay } from './relay';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { callerOf, createOracleApiHandler } from './api';
import { readServiceHashes } from './servicos';
import { createReturnGuard } from './devolvido';
import { createGateHandler, GATE_PORT, mergePicture, startGateServer, tunnelForward, type BoardPicture } from './portao';
import { ORACLE_PORT, startOracleServer, type OracleServer } from './server';

export const TOKEN_HASH_FILE = 'pc.token.sha256';

/** The hash the PC left; `null` = none yet (every call is refused). Read at each call: the PC rewrites it at boot. */
export function readTokenHash(dir: string): string | null {
  try {
    const hash = readFileSync(join(dir, TOKEN_HASH_FILE), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
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
    onChange: (snapshot) => {
      server?.notify('ledger');
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
  const handler = createOracleApiHandler({
    ledger,
    ledgerFile,
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
  });
  server = await startOracleServer({ host, port, caller: (authorization) => callerOf(authorization, tokenHash(), services()), handler });
  writeFileSync(join(dir, 'url'), `${server.url}\n`, { mode: 0o600 });
  const gatePort = Number(process.env.DONEL_ORACULO_PORTAO_PORT) || GATE_PORT;
  const gate = await startGateServer({
    port: gatePort,
    handler: createGateHandler({ sessionsDir: join(homedir(), '.donel', 's'), ledger: () => ledger, picture: () => picture, forward: tunnelForward, serverVersion: 'oraculo-vps' }),
  });
  // The setup of a remote session reads this to point its MCP at the gate.
  writeFileSync(join(dir, 'portao'), `${gate.port}\n`, { mode: 0o600 });
  console.log(`[oraculo] no ar em ${server.url} (${Object.keys(first.doc.tasks).length} tarefas${first.readOnly ? ', só leitura' : ''})`);
  const stop = (): void => {
    void Promise.all([server?.close(), celular?.dispose(), gate.close()]).then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('[oraculo] não subiu:', error);
  process.exit(1);
});
