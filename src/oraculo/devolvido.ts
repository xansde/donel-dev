// Oráculo na VPS — after the way back the VPS's copy is dead: every writer of the daemon (the PC's API, the phone,
// the MCP gate of the VPS's sessions) goes through this guard, which refuses once the PC took the ledger back. The
// mark is a file (`<dir>/devolvido`), so a daemon restart keeps it. The next move replaces the dead copy (kept).

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerService } from '../main/ledger-store';

export const RETURNED_FILE = 'devolvido';
export const RETURNED_REASON = 'O Oráculo voltou para o PC; esta cópia na VPS não grava mais. Nada foi gravado.';

export interface ReturnGuard {
  /** The daemon's ledger, for every writer: refuses to write once returned. */
  readonly ledger: LedgerService;
  returned(): boolean;
  set(returned: boolean): void;
}

export function createReturnGuard(service: LedgerService, dir: string): ReturnGuard {
  const file = join(dir, RETURNED_FILE);
  const returned = (): boolean => existsSync(file);
  return {
    ledger: {
      ...service,
      load: () => {
        const snapshot = service.load();
        return returned() ? { doc: snapshot.doc, readOnly: true } : snapshot;
      },
      apply: async (actor, op) => (returned() ? { ok: false, reason: RETURNED_REASON } : service.apply(actor, op)),
    },
    returned,
    set(value) {
      if (value) writeFileSync(file, `${new Date().toISOString()}\n`, { mode: 0o600 });
      else if (existsSync(file)) unlinkSync(file);
    },
  };
}
