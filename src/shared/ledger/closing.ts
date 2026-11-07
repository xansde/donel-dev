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

const TASK_ID = /\bt-[0-9a-f]+\b/i;
/** "concluída: …", "Concluída pelas t-…" — the work was done; the cancel only closed it. */
const DONE = /^conclu[ií]da\b/i;
/** "Enviada: …" — a message that went out. */
const SENT = /^enviada\b/i;
/** "substituída pela t-…", "Carta substituída pela…", "Substituída pelas cartas t-…", "Coberta pela t-…". */
const REPLACED = /^(?:carta\s+)?(?:substitu[ií]da|coberta)\s+pel[ao]s?\b/i;

/** How a cancelled task closed; `null` = not cancelled (open, delivered, accepted, or rejected to be redone). */
export function closingOf(task: LedgerTask): Closing | null {
  if (!isCancelled(task)) return null;
  const decision = lastDecision(task);
  const reason = (decision && eventNote(decision))?.trim() ?? '';
  if (DONE.test(reason)) return { kind: 'concluida-por-prova' };
  if (SENT.test(reason)) return { kind: 'enviada' };
  if (REPLACED.test(reason)) {
    const replacedBy = TASK_ID.exec(reason)?.[0];
    return replacedBy ? { kind: 'substituida', replacedBy } : { kind: 'substituida' };
  }
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
