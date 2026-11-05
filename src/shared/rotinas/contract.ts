// Item 20 (PDA mindscape-openrig, D3) — routines that wake places. The contract every routine follows:
//
//   generator (read only) → finding keys → filter WITHOUT an LLM (filter.ts) → wake the owner place
//
// The generator never writes anything: it reads a snapshot and returns findings, each one with a stable key.
// The filter decides, by rules only, which keys would wake the owner place. Today every routine runs IN SHADOW:
// the decision is only written to the shadow log in `<userData>/rotinas/`, nobody is woken. The contract is
// plain data in and out (no Electron, no fs) so the same routine can move to the VPS later (B38/B39) and run
// there under another timer.

/** Who a routine would wake. Resolved only when the routine leaves the shadow (the Líder model may change). */
export interface WakeTarget {
  /** The role of the owner place. V1: always the Líder. */
  readonly roleId: string;
  /** The board whose Líder it is. */
  readonly projectPath: string;
}

/** One finding of a generator: what is wrong, where, and its stable key (the filter only looks at the key). */
export interface Finding {
  /** Stable while the situation lasts, e.g. `parada:place:…`. Same key in two rounds = same situation. */
  readonly key: string;
  readonly projectPath: string;
  readonly placeId: string;
  /** pt-BR, one line, for the owner: "parada há 9 h". */
  readonly summary: string;
  readonly wake: WakeTarget;
}

/** What the filter decided about a key in a round. Only these go to the shadow log. */
export type ShadowDecision =
  /** Passed every rule: out of the shadow, this would wake the owner place. */
  | 'acordaria'
  /** Passed the hysteresis but the cap of the window was full: it tries again in the next rounds. */
  | 'adiada'
  /** Would have woken, and was gone by the next round: the wake would have been noise. */
  | 'descartada'
  /** More than half of the wakes of the last 7 days were noise: the source is off for 7 days. */
  | 'fonte-desligada';

/** One line of `<userData>/rotinas/sombra.log` (JSON Lines), and what the board lists. */
export interface ShadowEntry {
  /** Epoch ms. */
  readonly at: number;
  readonly routineId: string;
  readonly decision: ShadowDecision;
  readonly key?: string;
  readonly projectPath?: string;
  readonly placeId?: string;
  readonly summary: string;
  readonly wake?: WakeTarget;
}

export const ROTINAS_CHANNELS = {
  /** Renderer → main: the shadow entries of today (local day). */
  today: 'rotinas:today',
  /** Main → renderer: a round wrote something to the shadow log. */
  changed: 'rotinas:changed',
} as const;

/** `window.donel.rotinas`. */
export interface DonelRotinasApi {
  today(): Promise<ShadowEntry[]>;
  onChanged(listener: () => void): () => void;
}
