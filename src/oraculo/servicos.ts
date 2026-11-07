// t-a1ea2798 — a headless service (the Slack mentions one) creates and delivers tasks on the VPS's Oráculo with its
// own credential, with no session open. Each service has `<dir>/servicos/<name>.sha256` (the token's sha256, written by
// `scripts/oraculo-vps.sh servico <name>`); deleting the file revokes it, with no restart (read at each call).
//
// The credential reaches ONE route, `POST /v1/servico/apply` with `{ op }`: create, take and deliver, with text or
// link proofs. The daemon signs as the place `servico:<name>` (role `servico`), whatever the body says; the ledger's
// own rules do the rest (only the owner place takes and delivers, a high risk delivery carries the owner's letter).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_PLACE_PREFIX, SERVICE_ROLE, type LedgerActor, type LedgerOp } from '../shared/ledger/contract';

export const SERVICE_PATH = '/v1/servico/apply';
export const SERVICES_DIR = 'servicos';
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVICE_OPS: ReadonlySet<string> = new Set(['criar', 'assumir', 'entregar']);

/** name → sha256 (hex) of every service with a well-formed file; a bad name or hash is skipped. */
export function readServiceHashes(dir: string): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(join(dir, SERVICES_DIR));
  } catch {
    return hashes;
  }
  for (const file of names) {
    const name = file.endsWith('.sha256') ? file.slice(0, -'.sha256'.length) : '';
    if (!SERVICE_NAME.test(name)) continue;
    try {
      const hash = readFileSync(join(dir, SERVICES_DIR, file), 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hash)) hashes.set(name, hash);
    } catch {
      // unreadable: not a service
    }
  }
  return hashes;
}

export function serviceActor(name: string): LedgerActor {
  return { kind: 'lugar', placeId: `${SERVICE_PLACE_PREFIX}${name}`, roleId: SERVICE_ROLE };
}

/** Why a service may not send `op`; `null` = may (the ledger's rules still apply after). */
export function serviceOpRefusal(op: unknown): string | null {
  if (typeof op !== 'object' || op === null || typeof (op as { op?: unknown }).op !== 'string') return 'op inválida';
  const { op: kind, proofs, doneBy } = op as { op: string; proofs?: unknown; doneBy?: unknown };
  if (!SERVICE_OPS.has(kind)) return 'serviço só cria, assume e entrega tarefas';
  if (kind !== 'entregar') return null;
  if (doneBy !== undefined) return 'serviço entrega o próprio trabalho (sem feitoPor)';
  if (!Array.isArray(proofs) || proofs.some((p) => typeof p !== 'object' || p === null || ((p as { kind?: unknown }).kind !== 'texto' && (p as { kind?: unknown }).kind !== 'link')))
    return 'serviço prova com texto ou link';
  return null;
}

export type ServiceOp = Extract<LedgerOp, { op: 'criar' | 'assumir' | 'entregar' }>;
