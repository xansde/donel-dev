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
  /** Cartas forma A — the owner writes on a card (`LedgerComment` → `LedgerCommentResult`). */
  comment: 'ledger:comment',
  /** 06/11 (t-e753b554) — a place is gone: its live tasks pass on (`LedgerPassOnRequest[]` → `LedgerPassedOn[]`). */
  passOn: 'ledger:pass-on',
  /** 08/11 — a session ended a turn: the record goes to its live task (`LedgerTurnRecord` → `LedgerTurnRecorded`). */
  turnEnded: 'ledger:turn-ended',
} as const;

/**
 * 08/11 (dono: "Eles devem atualizar diretamente o ledger") — the end of a turn of the session of `placeId`, written to
 * its live task as an `andamento` record instead of a "◆ … terminou" in the Líder's chat.
 */
export interface LedgerTurnRecord {
  readonly projectPath: string;
  readonly placeId: string;
  readonly text: string;
  /**
   * Not an end of turn: a situation that cannot wait (a permission open, a failed turn), recorded with this state and
   * `text` as what it needs, whether or not a Líder could hear it yet (Revisor, #324).
   */
  readonly estado?: 'travada' | 'precisa-do-dono';
}

export type LedgerTurnRecorded = 'registrado' | 'ja-registrado' | 'sem-tarefa' | 'falhou';

/**
 * 06/11 (t-e753b554) — the renderer saw that a place is gone (its tab was closed and did not come back, or it never
 * started) and names who takes its work: the first live place above it (`firstLiveAbove`, reach.ts) or the Líder
 * único (`'lider'`). The main moves only the tasks that are aberta, em execução or rejeitada (a delivered one waits
 * for whoever decides) and, for `nao-comecou`, only past the grace of `ownerGone`.
 */
export interface LedgerPassOnRequest {
  readonly projectPath: string;
  readonly placeId: string;
  readonly gone: 'fechada' | 'nao-comecou';
  /** A place id of the same board, or `'lider'`. */
  readonly to: string;
}

/** What moved for one request: the tasks now owned by `to`. */
export interface LedgerPassedOn {
  readonly projectPath: string;
  readonly placeId: string;
  readonly to: string;
  readonly tasks: readonly { readonly id: string; readonly title?: string }[];
}

export interface LedgerComment {
  readonly id: string;
  readonly text: string;
  /** Joins a retry to the first send (a double click sends once). */
  readonly requestId: string;
}

/** Where the words went: the session that owns the task, the Líder único, or nobody open (kept on the card). */
export type LedgerCommentResult =
  | { readonly ok: true; readonly deliveredTo: { readonly placeId: string } | 'lider' | null; readonly at: number }
  | { readonly ok: false; readonly reason: string };

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
  | { readonly id: string; readonly accept: true; readonly option?: string; readonly text?: string }
  | { readonly id: string; readonly accept: false; readonly reason: string; readonly option?: string; readonly text?: string };

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
  /** The owner writes on a card: recorded and sent at once to whoever reads it. */
  comment(comment: LedgerComment): Promise<LedgerCommentResult>;
  /** 06/11 — the live tasks of gone places pass on, with the record; answers what moved. */
  passOn(requests: readonly LedgerPassOnRequest[]): Promise<readonly LedgerPassedOn[]>;
  /** 08/11 — the end of a session's turn, recorded in the ledger. */
  turnEnded(record: LedgerTurnRecord): Promise<LedgerTurnRecorded>;
}
