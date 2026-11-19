// t-a1ea2798 — a headless service (the Slack mentions one) creates and delivers tasks on the VPS's Oráculo with its
// own credential, with no session open. Each service has `<dir>/servicos/<name>.sha256` (the token's sha256, written by
// `scripts/oraculo-vps.sh servico <name>`); deleting the file revokes it, with no restart (read at each call).
//
// The credential reaches ONE route, `POST /v1/servico/apply` with `{ op }`: create, take and deliver, with text or
// link proofs, never marked as asked by the owner. Not the events stream either (server.ts), so a revoked service
// has no open connection left to cut. The daemon signs as the place `servico:<name>` (role `servico`), whatever the
// body says; the ledger's own rules do the rest (only the owner place takes and delivers, a high risk delivery
// carries the owner's letter).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASKED_BY_OWNER, cleanAskedBy, SERVICE_PLACE_PREFIX, SERVICE_ROLE, type LedgerActor, type LedgerOp } from '../shared/ledger/contract';

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

/**
 * t-ac3f20c6 — the reconciliador (cron of the VPS, item 13 of the lean structure) hands the Líder único the live task
 * of a place it saw closed. That transfer is the one thing it does beyond the other services: to "lider" only, with
 * `ownerGone`, and the ledger checks the same rule (contract.ts, `transferir`).
 */
export const RECONCILER_SERVICE = 'reconciliador';

/** Why a service may not send `op`; `null` = may (the ledger's rules still apply after). */
export function serviceOpRefusal(op: unknown, name?: string): string | null {
  if (typeof op !== 'object' || op === null || typeof (op as { op?: unknown }).op !== 'string') return 'op inválida';
  const { op: kind, proofs, doneBy, requestedBy, closeAlone } = op as { op: string; proofs?: unknown; doneBy?: unknown; requestedBy?: unknown; closeAlone?: unknown };
  if (kind === 'transferir' && name === RECONCILER_SERVICE) {
    const { to, ownerGone, reason } = op as { to?: unknown; ownerGone?: unknown; reason?: unknown };
    if (to !== 'lider' || ownerGone !== true) return 'o reconciliador só passa ao Líder único ("lider") a tarefa de um lugar fechado (ownerGone)';
    if ((op as { risk?: unknown }).risk !== undefined) return 'o reconciliador não muda o risco: quem decide é o Líder';
    return typeof reason === 'string' && reason.trim() ? null : 'motivo obrigatório';
  }
  if (!SERVICE_OPS.has(kind)) return 'serviço só cria, assume e entrega tarefas';
  // The owner's mark puts the task in the owner's progress (Jobu); a service names the person, never the owner.
  if (typeof requestedBy === 'string' && cleanAskedBy(requestedBy).toLowerCase() === ASKED_BY_OWNER) return 'serviço não marca pedido do dono';
  if (kind !== 'entregar') return null;
  if (doneBy !== undefined) return 'serviço entrega o próprio trabalho (sem feitoPor)';
  if (closeAlone !== undefined) return 'serviço não fecha a própria entrega: decide um Revisor ou o dono';
  if (!Array.isArray(proofs) || proofs.some((p) => typeof p !== 'object' || p === null || ((p as { kind?: unknown }).kind !== 'texto' && (p as { kind?: unknown }).kind !== 'link')))
    return 'serviço prova com texto ou link';
  return null;
}

/**
 * t-cddc62fc — the reconciliador's notice to the Líder único (`{ op: 'avisar-lider', texto, chave }`), by the relay
 * and never into the owner's phone chat (it used to write there as the owner). Only the reconciliador; no ledger.
 */
export const NOTICE_OP = 'avisar-lider';
const NOTICE_TEXT_MAX = 3500;
const NOTICE_KEY_MAX = 200;

export type NoticeCheck = { readonly ok: true; readonly texto: string; readonly chave: string } | { readonly ok: false; readonly status: 400 | 403; readonly error: string };

/** The notice's own check: who may send it, and its text and key (counted in characters). */
export function checkNotice(op: Record<string, unknown>, name: string): NoticeCheck {
  if (name !== RECONCILER_SERVICE) return { ok: false, status: 403, error: 'só o reconciliador avisa o Líder único' };
  const { texto, chave } = op;
  if (typeof texto !== 'string' || !texto.trim() || [...texto].length > NOTICE_TEXT_MAX) return { ok: false, status: 400, error: `texto de 1 a ${NOTICE_TEXT_MAX} caracteres` };
  if (typeof chave !== 'string' || !chave.trim() || [...chave].length > NOTICE_KEY_MAX) return { ok: false, status: 400, error: `chave de 1 a ${NOTICE_KEY_MAX} caracteres` };
  return { ok: true, texto, chave };
}

export type ServiceOp = Extract<LedgerOp, { op: 'criar' | 'assumir' | 'entregar' | 'transferir' }>;
