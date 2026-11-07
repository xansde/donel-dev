// Oráculo na VPS — the headless daemon (`donel-oraculo`, a systemd user unit; scripts/oraculo-vps.sh installs it).
// It owns `<dir>/ledger.json` and `<dir>/ledger-provas/` with today's ledger code, unchanged: same format, same
// `applyLedgerOp`. Plan: docs/planos/oraculo-na-vps.md.
//
// `<dir>/pc.token.sha256` is written by the PC through its own ssh at each boot (the token itself only lives in the
// PC's memory); `<dir>/url` is where this daemon listens, for the PC to read through the same ssh.
//
// Env: DONEL_ORACULO_DIR (default ~/.donel/oraculo), DONEL_ORACULO_HOST (default: this place's Tailscale address),
// DONEL_ORACULO_PORT (default 47816).

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../main/ledger-store';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { createOracleApiHandler } from './api';
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
  let server: OracleServer | null = null;
  const ledger = createLedgerService({
    filePath: ledgerFile,
    io: createSystemConfigIoDeps(),
    proofFs: nodeLedgerProofFs,
    onChange: () => server?.notifyLedger(),
  });
  // Fails here, not on the first call, when the file is there but unreadable (it would be written over).
  const first = ledger.load();
  const handler = createOracleApiHandler({ ledger, ledgerFile, tokenHash, changed: () => server?.notifyLedger() });
  server = await startOracleServer({ host, port, tokenHash, handler });
  writeFileSync(join(dir, 'url'), `${server.url}\n`, { mode: 0o600 });
  console.log(`[oraculo] no ar em ${server.url} (${Object.keys(first.doc.tasks).length} tarefas${first.readOnly ? ', só leitura' : ''})`);
  const stop = (): void => {
    void server?.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('[oraculo] não subiu:', error);
  process.exit(1);
});
