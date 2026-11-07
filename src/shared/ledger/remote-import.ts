// Oráculo na VPS (docs/planos/oraculo-na-vps.md, "Uma linha só") — the check of the move of `ledger.json` from the PC
// to the VPS. The file travels byte for byte; this only says whether it may: the parse of the contract must keep
// EVERY task of the file (it drops a malformed one silently) and every proof file must be there. Used on both ends:
// the PC checks before sending, the VPS checks again before writing, and re-reads after.

import { isNewerLedger, parseLedgerDoc, type LedgerDoc } from './contract';

export interface LedgerCount {
  readonly tasks: number;
  readonly events: number;
}

export type LedgerImportCheck =
  | { readonly ok: true; readonly doc: LedgerDoc; readonly count: LedgerCount; readonly proofFiles: readonly string[] }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every proof file named by a delivery of the ledger. */
export function ledgerProofFiles(doc: LedgerDoc): string[] {
  const files = new Set<string>();
  for (const task of Object.values(doc.tasks))
    for (const event of task.events) for (const proof of event.proofs ?? []) if (proof.kind === 'arquivo') files.add(proof.file);
  return [...files];
}

export function ledgerCount(doc: LedgerDoc): LedgerCount {
  return { tasks: Object.keys(doc.tasks).length, events: Object.values(doc.tasks).reduce((total, task) => total + task.events.length, 0) };
}

/** Same ids, same number of events each: what the VPS confirms after writing. */
export function sameLedger(a: LedgerDoc, b: LedgerDoc): boolean {
  const ids = Object.keys(a.tasks);
  if (ids.length !== Object.keys(b.tasks).length) return false;
  return ids.every((id) => b.tasks[id] !== undefined && b.tasks[id]!.events.length === a.tasks[id]!.events.length);
}

export function checkLedgerImport(text: string, proofExists: (file: string) => boolean): LedgerImportCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'o ledger.json não é JSON válido' };
  }
  if (!isRecord(raw) || !isRecord(raw.tasks)) return { ok: false, reason: 'o arquivo não é um ledger' };
  if (isNewerLedger(raw)) return { ok: false, reason: 'o ledger.json está marcado como de outra versão (já é um espelho do modo remoto?)' };
  const doc = parseLedgerDoc(raw);
  const lost = Object.keys(raw.tasks).filter((id) => doc.tasks[id] === undefined);
  if (lost.length) return { ok: false, reason: `o parse perderia ${lost.length} tarefa(s): ${lost.slice(0, 5).join(', ')}` };
  const proofFiles = ledgerProofFiles(doc);
  const missing = proofFiles.filter((file) => !proofExists(file));
  if (missing.length) return { ok: false, reason: `faltam ${missing.length} prova(s) em arquivo: ${missing.slice(0, 5).join(', ')}` };
  return { ok: true, doc, count: ledgerCount(doc), proofFiles };
}
