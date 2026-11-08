// Ledger v5, fatia 4 (docs/planos/ledger-v5.md, 1.3 and 1.9 step 3) — how a closed task really closed, READ from the
// v4 ledger. v4 has one way to close what is not accepted: a `rejeitada` event with the mark "⟦cancelada⟧", and the
// Curador's cleanup and the Líder used it for work that was done ("concluída: PR #269 mesclado…"), a message that
// went out ("Enviada: …") and tasks replaced by others ("substituída pela t-…"). This reads the reason and names the
// closing the v5 way (`motivoFechamento`). Nothing is written: no field, no mark, no new version — the ledger file
// stays byte for byte what it is (the VPS copies it). Every reader of the row (the app's table and the Supabase
// mirror) gets the same words.

import { eventNote, isCancelled, lastDecision, type LedgerTask } from './contract';

export type ClosingKind = 'concluida-por-prova' | 'enviada' | 'substituida' | 'cancelada';

export interface Closing {
  readonly kind: ClosingKind;
  /** `substituida`: the first task named as the replacement. */
  readonly replacedBy?: string;
}

// In doubt, "cancelada" (Revisor, PR #308): the first word is not proof. Each closing needs the shape the real
// reasons have AND the evidence in the reason itself — otherwise "Concluída? Não: o dono desistiu" or "Coberta pelo
// Fernando" would read as done or replaced.
/** A PR number, a link or a task id: what the done reasons point to. */
const EVIDENCE = /#\d+|https?:\/\/|\bt-[0-9a-f]+\b/i;
/** "concluída: <evidence>…" or "Concluída pelas t-…": the work was done; the cancel only closed it. */
const DONE = /^conclu[ií]da(?::|\s+pel[ao]s?\s+t-[0-9a-f]+\b)/i;
/** "Enviada: …" (with the colon): a message that went out. */
const SENT = /^enviada:/i;
/** "substituída pela t-…", "Carta substituída pela t-…", "Substituída pelas cartas t-…", "Coberta pela t-…": the id must follow. */
const REPLACED = /^(?:carta\s+)?(?:substitu[ií]da|coberta)\s+pel[ao]s?\s+(?:cartas?\s+)?(t-[0-9a-f]+)\b/i;
/** "concluída: não, …", "Enviada: nunca saiu", "Enviada: ainda não": the colon is followed by a denial. */
const DENIED_AFTER_COLON = /^[^:]*:\s*(?:ainda\s+)?(?:n[aã]o|nunca)\b/i;

/** How a cancelled task closed; `null` = not cancelled (open, delivered, accepted, or rejected to be redone). */
export function closingOf(task: LedgerTask): Closing | null {
  if (!isCancelled(task)) return null;
  const decision = lastDecision(task);
  const reason = (decision && eventNote(decision))?.trim() ?? '';
  const denied = DENIED_AFTER_COLON.test(reason);
  if (DONE.test(reason) && EVIDENCE.test(reason) && !denied) return { kind: 'concluida-por-prova' };
  if (SENT.test(reason) && !denied) return { kind: 'enviada' };
  // Ids are lower case ("T-ABCD" is the same task); a task never replaces itself.
  const replacedBy = REPLACED.exec(reason)?.[1]?.toLowerCase();
  if (replacedBy && replacedBy !== task.id.toLowerCase()) return { kind: 'substituida', replacedBy };
  return { kind: 'cancelada' };
}

/** The state a person reads ("concluída por prova", "substituída"…). */
export const CLOSING_LABELS: Readonly<Record<ClosingKind, string>> = {
  'concluida-por-prova': 'concluída por prova',
  enviada: 'enviada',
  substituida: 'substituída',
  cancelada: 'cancelada',
};

const LEADING_MARKS = /^(?:⟦[^⟧\n]{1,240}⟧ ?)+/;

/** A text without the marks at its start (the request of a bot record starts with one). Only the app writes marks. */
export function withoutMarks(text: string): string {
  return text.replace(LEADING_MARKS, '');
}
