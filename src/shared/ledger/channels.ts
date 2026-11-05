// Ledger com prova (item 19) — IPC of `window.donel.ledger`. The main is the only writer of `ledger.json`;
// the renderer reads the document (the strip on top of the Mindscape) and decides as the OWNER: every
// decision that comes through here is recorded with the author `{ kind: 'dono' }`.

import type { LedgerDoc, LedgerProof, LedgerTask } from './contract';

export const LEDGER_CHANNELS = {
  load: 'ledger:load',
  /** main → renderer push after every write (`LedgerSnapshot`). */
  changed: 'ledger:changed',
  decide: 'ledger:decide',
  openProof: 'ledger:open-proof',
  /** Cartas forma A — a print of a delivery as a `data:` URL, for the card's front. */
  proofImage: 'ledger:proof-image',
} as const;

/** Cartas forma A — the desktop card loads a proof file (prototype, video) by this scheme (`main/ledger-proof-protocol.ts`). */
export const PROOF_SCHEME = 'donel-prova';

export function proofUrl(fileName: string): string {
  return `${PROOF_SCHEME}://prova/${encodeURIComponent(fileName)}`;
}

export interface LedgerSnapshot {
  readonly doc: LedgerDoc;
  /** A newer channel wrote the file: it is read, never written. */
  readonly readOnly: boolean;
}

/**
 * The owner accepts (or confirms a Revisor's accept), or rejects with a reason. `option`: the named path the owner
 * picked on the card (forma A); a rejecting option is its own reason.
 */
export type LedgerOwnerDecision =
  | { readonly id: string; readonly accept: true; readonly option?: string }
  | { readonly id: string; readonly accept: false; readonly reason: string; readonly option?: string };

export type LedgerApplyResult = { readonly ok: true; readonly task: LedgerTask } | { readonly ok: false; readonly reason: string };

export interface DonelLedgerApi {
  /** Missing file → empty ledger; rejects when the file exists but cannot be read. */
  load(): Promise<LedgerSnapshot>;
  onChanged(listener: (snapshot: LedgerSnapshot) => void): () => void;
  decide(decision: LedgerOwnerDecision): Promise<LedgerApplyResult>;
  /** Opens a proof outside the app (file in the system viewer, link in the browser); false = refused. */
  openProof(proof: LedgerProof): Promise<boolean>;
  /** A print of the CURRENT delivery of `taskId` (index in its proofs) as a `data:` URL; `null` = not a print, too big or gone. */
  proofImage(taskId: string, proofIndex: number): Promise<string | null>;
}
