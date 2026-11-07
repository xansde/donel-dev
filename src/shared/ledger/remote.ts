// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — IPC of Preferências → Oráculo na VPS: where the ledger lives,
// whether the PC reaches it, and the two gestures (take it to a remote place, bring it back).

export const LEDGER_REMOTE_CHANNELS = {
  getState: 'ledger-remote:get-state',
  move: 'ledger-remote:move',
  back: 'ledger-remote:back',
} as const;

export interface LedgerRemoteState {
  /** `local`: this PC writes `ledger.json`. `remoto`: the daemon on `lugar` does. */
  readonly mode: 'local' | 'remoto';
  readonly lugar: string | null;
  readonly lugarNome: string | null;
  /** Remote mode: the PC reaches the daemon now (otherwise it is read-only). */
  readonly conectado: boolean;
  readonly erro: string | null;
  /** The mirror on disk points at a place, but the remote-mode file is gone (deleted with the app closed). */
  readonly espelhoSemModo: string | null;
  /** The remote places of `accounts.remotes`, to pick one. */
  readonly lugares: readonly { readonly id: string; readonly label: string }[];
}

export interface DonelLedgerRemoteApi {
  getState(): Promise<LedgerRemoteState>;
  move(lugar: string): Promise<LedgerRemoteResult>;
  back(): Promise<LedgerRemoteResult>;
}

export type LedgerRemoteResult = { readonly ok: true; readonly state: LedgerRemoteState } | { readonly ok: false; readonly reason: string; readonly state: LedgerRemoteState };
