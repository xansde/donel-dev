// Item 20 (D3) — the filter between a generator and the wake, WITHOUT an LLM (numbers from the kit, to recalibrate):
//
// - dedup: a key that already passed stays quiet while it is present; it is a new situation only after it goes away;
// - hysteresis: a key passes only after it was seen in 2 rounds in a row;
// - cap per window: at most 5 passes per hour and 15 per day; the rest is deferred to the next rounds;
// - noise cut: a pass whose key was gone by the very next round counts as discarded (the wake would have been
//   noise); more than 50% discarded in 7 days (with at least 4 passes) turns the source off for 7 days.
//
// Pure: the state is plain JSON (it is persisted between rounds and app restarts) and `now` comes from outside.
// Item 19 (ledger): when the routine leaves the shadow, the dedup moves to "there is an open task with origin
// `rotina:<id>:<key>`" and a discard becomes the owner place rejecting the task; the rules stay the same.

export interface FilterRules {
  readonly hysteresisRounds: number;
  readonly capPerHour: number;
  readonly capPerDay: number;
  readonly noiseWindowMs: number;
  readonly noiseRatio: number;
  readonly noiseMinSample: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_FILTER_RULES: FilterRules = {
  hysteresisRounds: 2,
  capPerHour: 5,
  capPerDay: 15,
  noiseWindowMs: 7 * DAY_MS,
  noiseRatio: 0.5,
  noiseMinSample: 4,
};

/** The memory of one source between rounds. */
export interface SourceFilterState {
  /** Keys seen in a row that did not pass yet → how many rounds in a row. */
  streak: Record<string, number>;
  /** Keys that passed and are still present (dedup) → when they passed and how many rounds they survived since. */
  open: Record<string, { at: number; rounds: number }>;
  /** When each pass of the last day happened (the caps). */
  passes: number[];
  /** Passes whose key went away, in the noise window: was it noise? */
  outcomes: { at: number; discarded: boolean }[];
  /** The noise cut turned the source off at this moment. */
  offSince?: number;
}

export function emptySourceFilterState(): SourceFilterState {
  return { streak: {}, open: {}, passes: [], outcomes: [] };
}

export type FilterDecision =
  | { readonly key: string; readonly decision: 'acordaria' | 'adiada' | 'descartada' }
  | { readonly decision: 'fonte-desligada' };

export interface FilterRound {
  readonly state: SourceFilterState;
  readonly decisions: readonly FilterDecision[];
  /** The source is off: the generator should not even run. */
  readonly off: boolean;
}

/** The source is off now (the noise cut), counting the 7 days. */
export function isSourceOff(state: SourceFilterState, now: number, rules: FilterRules = DEFAULT_FILTER_RULES): boolean {
  return state.offSince !== undefined && now - state.offSince < rules.noiseWindowMs;
}

/** One round: the keys the generator found now → what would wake, and the state for the next round. */
export function filterRound(previous: SourceFilterState, keys: readonly string[], now: number, rules: FilterRules = DEFAULT_FILTER_RULES): FilterRound {
  if (isSourceOff(previous, now, rules)) return { state: previous, decisions: [], off: true };
  const decisions: FilterDecision[] = [];
  // Back after the 7 days off: a clean slate.
  const base = previous.offSince !== undefined ? emptySourceFilterState() : previous;
  const present = new Set(keys);
  const streak: Record<string, number> = {};
  const open: Record<string, { at: number; rounds: number }> = {};
  let outcomes = base.outcomes.filter((outcome) => now - outcome.at < rules.noiseWindowMs);
  let passes = base.passes.filter((at) => now - at < DAY_MS);

  for (const [key, entry] of Object.entries(base.open)) {
    if (present.has(key)) {
      open[key] = { at: entry.at, rounds: entry.rounds + 1 };
      continue;
    }
    const discarded = entry.rounds === 0;
    outcomes = [...outcomes, { at: now, discarded }];
    if (discarded) decisions.push({ key, decision: 'descartada' });
  }

  for (const key of [...present].sort()) {
    if (open[key]) continue;
    const seen = (base.streak[key] ?? 0) + 1;
    if (seen < rules.hysteresisRounds) {
      streak[key] = seen;
      continue;
    }
    const lastHour = passes.filter((at) => now - at < HOUR_MS).length;
    if (lastHour < rules.capPerHour && passes.length < rules.capPerDay) {
      open[key] = { at: now, rounds: 0 };
      passes = [...passes, now];
      decisions.push({ key, decision: 'acordaria' });
      continue;
    }
    streak[key] = seen;
    // Only the first deferral of a situation is logged: the next rounds would repeat it.
    if (seen === rules.hysteresisRounds) decisions.push({ key, decision: 'adiada' });
  }

  const discardedCount = outcomes.filter((outcome) => outcome.discarded).length;
  if (outcomes.length >= rules.noiseMinSample && discardedCount / outcomes.length > rules.noiseRatio) {
    decisions.push({ decision: 'fonte-desligada' });
    return { state: { ...emptySourceFilterState(), outcomes, offSince: now }, decisions, off: true };
  }
  return { state: { streak, open, passes, outcomes }, decisions, off: false };
}
