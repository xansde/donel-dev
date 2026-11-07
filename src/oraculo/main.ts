// Oráculo na VPS — the headless daemon (`donel-oraculo`, a systemd user unit; scripts/oraculo-vps.sh installs it).
// It owns `<dir>/ledger.json` and `<dir>/ledger-provas/` with today's ledger code, unchanged: same format, same
// `applyLedgerOp`. Plan: docs/planos/oraculo-na-vps.md.
//
// Env: DONEL_ORACULO_DIR (default ~/.donel/oraculo), DONEL_ORACULO_HOST (default: this place's Tailscale address),
// DONEL_ORACULO_PORT (default 47816).

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSystemConfigIoDeps } from '../main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../main/ledger-store';
import { pickTailscaleAddress } from '../main/celular/tailscale';
import { createOracleApiHandler } from './api';
import { ORACLE_PORT, startOracleServer, type OracleServer } from './server';

/** The PC's token: made once, 0600, read by the PC through its own ssh (never typed, never stored on the PC). */
export function ensureToken(dir: string): string {
  const file = join(dir, 'pc.token');
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(token)) return token;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

async function main(): Promise<void> {
  const dir = process.env.DONEL_ORACULO_DIR || join(homedir(), '.donel', 'oraculo');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const host = process.env.DONEL_ORACULO_HOST || pickTailscaleAddress(networkInterfaces());
  if (!host) {
    // systemd starts it again (Restart=always): the Tailscale may come up after the boot.
    console.error('[oraculo] sem endereço da Tailscale; saindo para tentar de novo.');
    process.exit(2);
  }
  const port = Number(process.env.DONEL_ORACULO_PORT) || ORACLE_PORT;
  const token = ensureToken(dir);
  let server: OracleServer | null = null;
  const ledger = createLedgerService({
    filePath: join(dir, 'ledger.json'),
    io: createSystemConfigIoDeps(),
    proofFs: nodeLedgerProofFs,
    onChange: () => server?.notifyLedger(),
  });
  // Fails here, not on the first call, when the file is there but unreadable (it would be written over).
  const first = ledger.load();
  server = await startOracleServer({ host, port, token, handler: createOracleApiHandler({ ledger, token }) });
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
