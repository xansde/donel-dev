// Hill climbing — the pure loop of a mission (dossiê do treinamento do Bill, seção m, decidido em 05/11).
//
// A mission is a way to run work, not a place on the board: one chair (the Escalador) sends a version, the
// loop in code counts the round, asks a council of judges, joins the scores and closes the round of work
// ("rodada") when it passes the cut, stalls or runs out of rounds. Then it waits for the owner.
//
// Fixed rules (the owner's, or decided by the Pesquisa on the owner's delegation):
//  - never starts by itself: born `proposta` (a card in the Oráculo), runs only after the owner accepts;
//  - first rodada X = 5 rounds, then at most N = 2 extra rodadas of Y = 3, each one a gesture of the owner;
//  - cut: ≥ 9 in every criterion from every judge (and the measured target, when the mission has one);
//  - "estacionou": 2 rounds in a row that do not raise the lowest score close the rodada early;
//  - judges are blind: each one sees only the target, the criteria and the current version.
//
// Reducers never mutate and never read the clock: `now` comes in.

export const HILL_CLIMB_SCHEMA_VERSION = 1;

export const HILL_CLIMB_RULES = {
  /** X — rounds of the first rodada. */
  firstRounds: 5,
  /** Y — rounds of each extra rodada. */
  extraRounds: 3,
  /** N — extra rodadas after the first one. */
  maxExtraRodadas: 2,
  /** Every judge, every criterion, at least this. */
  cut: 9,
  /** Rounds in a row without raising the lowest score that close the rodada as "estacionou". */
  stallRounds: 2,
  judges: 3,
} as const;

export const MAX_CRITERIA = 6;
export const MAX_VERSION_CHARS = 20_000;
export const MAX_TEXT_CHARS = 2000;

export type MissionState =
  /** Waiting for the owner in the Oráculo. */
  | 'proposta'
  /** A rodada is open: the Escalador sends versions. */
  | 'rodando'
  /** The rodada closed: the sample waits for a gesture of the owner. */
  | 'pausada'
  /** The owner stopped and accepted (or there were no rodadas left and the owner accepted). */
  | 'aceita'
  /** The owner said no to the proposal in the Oráculo. */
  | 'recusada';

export type RodadaCloseReason = 'corte' | 'estacionou' | 'fim';

/** A measured target ("CI em menos de 30 s"): the Escalador sends the measure with each version. */
export interface MissionMeasure {
  readonly label: string;
  readonly target: number;
  /** `menor` = the measure has to be ≤ target; `maior` = ≥ target. */
  readonly direction: 'menor' | 'maior';
}

export interface JudgeVerdict {
  /** "Juiz 1", "Juiz 2"… — the model goes in `model`, never in the label the other judges could see. */
  readonly judge: string;
  readonly model: string;
  /** criterion → 0..10 */
  readonly scores: Readonly<Record<string, number>>;
  readonly comment: string;
}

export interface MissionRound {
  /** 1-based, across the whole mission. */
  readonly index: number;
  /** 0-based rodada. */
  readonly rodada: number;
  readonly at: number;
  readonly version: string;
  /** What changed, in the Escalador's words. */
  readonly note?: string;
  readonly measured?: number;
  readonly verdicts: readonly JudgeVerdict[];
}

export interface MissionRodada {
  readonly index: number;
  readonly maxRounds: number;
  readonly openedAt: number;
  /** "redirecionar": what the owner wrote for this rodada. */
  readonly direction?: string;
  readonly closed?: { readonly reason: RodadaCloseReason; readonly at: number };
}

export interface HillClimbMission {
  readonly id: string;
  readonly projectPath: string;
  /** The Escalador: the place of the board that proposed and sends versions. */
  readonly placeId: string;
  readonly title: string;
  /** Alvo — what "better" means, in the owner's words. */
  readonly target: string;
  readonly criteria: readonly string[];
  readonly measure?: MissionMeasure;
  /** What the proposal says it will cost, as text ("~11 rounds × 3 juízes"). */
  readonly estimatedCost: string;
  /** The card of the proposal in the Oráculo. */
  readonly ledgerTaskId: string;
  readonly state: MissionState;
  readonly createdAt: number;
  readonly rodadas: readonly MissionRodada[];
  readonly rounds: readonly MissionRound[];
}

export interface HillClimbDoc {
  readonly schemaVersion: typeof HILL_CLIMB_SCHEMA_VERSION;
  readonly missions: Readonly<Record<string, HillClimbMission>>;
}

export function emptyHillClimbDoc(): HillClimbDoc {
  return { schemaVersion: HILL_CLIMB_SCHEMA_VERSION, missions: {} };
}

// ---------------------------------------------------------------------------------------------------------------
// Blind judging

/** Everything a judge is allowed to see. Nothing else exists in the call: no scores, no earlier versions. */
export interface BlindJudgeInput {
  readonly target: string;
  readonly criteria: readonly string[];
  readonly version: string;
}

export function blindInput(mission: HillClimbMission, version: string): BlindJudgeInput {
  return { target: mission.target, criteria: [...mission.criteria], version };
}

// ---------------------------------------------------------------------------------------------------------------
// Scores

/** The lowest score of a round, across judges and criteria; `0` for a round without verdicts. */
export function lowestScore(round: MissionRound, criteria: readonly string[]): number {
  let low = Infinity;
  for (const verdict of round.verdicts) for (const criterion of criteria) low = Math.min(low, verdict.scores[criterion] ?? 0);
  return Number.isFinite(low) ? low : 0;
}

function measureMet(mission: HillClimbMission, round: MissionRound): boolean {
  const measure = mission.measure;
  if (!measure) return true;
  if (round.measured === undefined) return false;
  return measure.direction === 'menor' ? round.measured <= measure.target : round.measured >= measure.target;
}

export function passesCut(mission: HillClimbMission, round: MissionRound): boolean {
  return round.verdicts.length >= HILL_CLIMB_RULES.judges && lowestScore(round, mission.criteria) >= HILL_CLIMB_RULES.cut && measureMet(mission, round);
}

export function roundsOf(mission: HillClimbMission, rodada: number): MissionRound[] {
  return mission.rounds.filter((round) => round.rodada === rodada);
}

/** The last `stallRounds` rounds of the rodada did not raise the best lowest score seen before them. */
export function stalled(mission: HillClimbMission, rodada: number): boolean {
  const lows = roundsOf(mission, rodada).map((round) => lowestScore(round, mission.criteria));
  const n = HILL_CLIMB_RULES.stallRounds;
  if (lows.length <= n) return false;
  const bestBefore = Math.max(...lows.slice(0, lows.length - n));
  return lows.slice(-n).every((low) => low <= bestBefore);
}

export function currentRodada(mission: HillClimbMission): MissionRodada | undefined {
  return mission.rodadas[mission.rodadas.length - 1];
}

export function extraRodadasLeft(mission: HillClimbMission): number {
  return Math.max(0, HILL_CLIMB_RULES.maxExtraRodadas - Math.max(0, mission.rodadas.length - 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Reducers

export type MissionResult = { readonly ok: true; readonly mission: HillClimbMission } | { readonly ok: false; readonly reason: string };

export interface ProposalInput {
  readonly id: string;
  readonly projectPath: string;
  readonly placeId: string;
  readonly title: string;
  readonly target: string;
  readonly criteria: readonly string[];
  readonly measure?: MissionMeasure;
  readonly estimatedCost: string;
  readonly ledgerTaskId: string;
  readonly now: number;
}

export function proposeMission(input: ProposalInput): HillClimbMission {
  return {
    id: input.id,
    projectPath: input.projectPath,
    placeId: input.placeId,
    title: input.title,
    target: input.target,
    criteria: [...input.criteria],
    ...(input.measure ? { measure: input.measure } : {}),
    estimatedCost: input.estimatedCost,
    ledgerTaskId: input.ledgerTaskId,
    state: 'proposta',
    createdAt: input.now,
    rodadas: [],
    rounds: [],
  };
}

/** The owner's answer in the Oráculo: accepted opens the first rodada (X rounds); rejected ends the mission. */
export function settleProposal(mission: HillClimbMission, decision: 'aceita' | 'rejeitada', now: number): HillClimbMission {
  if (mission.state !== 'proposta') return mission;
  if (decision === 'rejeitada') return { ...mission, state: 'recusada' };
  return { ...mission, state: 'rodando', rodadas: [{ index: 0, maxRounds: HILL_CLIMB_RULES.firstRounds, openedAt: now }] };
}

/** Why the Escalador may not send a version now; `null` = it may. */
export function cannotSubmit(mission: HillClimbMission): string | null {
  switch (mission.state) {
    case 'proposta':
      return 'A missão ainda é proposta: só roda depois que o dono aceitar a carta no Oráculo.';
    case 'pausada':
      return 'A rodada fechou e espera o dono (parar e aceitar, mais uma rodada ou redirecionar). Não mande versão até ele decidir.';
    case 'aceita':
      return 'O dono já aceitou esta missão; ela terminou.';
    case 'recusada':
      return 'O dono recusou esta missão no Oráculo.';
    case 'rodando':
      return null;
  }
}

export interface SubmittedVersion {
  readonly version: string;
  readonly note?: string;
  readonly measured?: number;
}

/** One round: the version and the council's verdicts. Closes the rodada when it passes the cut, stalls or ends. */
export function recordRound(mission: HillClimbMission, submitted: SubmittedVersion, verdicts: readonly JudgeVerdict[], now: number): MissionResult {
  const refusal = cannotSubmit(mission);
  if (refusal) return { ok: false, reason: refusal };
  const rodada = currentRodada(mission);
  if (!rodada) return { ok: false, reason: 'A missão não tem rodada aberta.' };
  if (verdicts.length < HILL_CLIMB_RULES.judges) return { ok: false, reason: `O conselho precisa de ${HILL_CLIMB_RULES.judges} juízes; vieram ${verdicts.length}.` };
  const round: MissionRound = {
    index: mission.rounds.length + 1,
    rodada: rodada.index,
    at: now,
    version: submitted.version,
    ...(submitted.note ? { note: submitted.note } : {}),
    ...(submitted.measured !== undefined ? { measured: submitted.measured } : {}),
    verdicts: [...verdicts],
  };
  const next: HillClimbMission = { ...mission, rounds: [...mission.rounds, round] };
  const inRodada = roundsOf(next, rodada.index).length;
  const reason: RodadaCloseReason | null = passesCut(next, round) ? 'corte' : stalled(next, rodada.index) ? 'estacionou' : inRodada >= rodada.maxRounds ? 'fim' : null;
  if (!reason) return { ok: true, mission: next };
  const rodadas = next.rodadas.map((item) => (item.index === rodada.index ? { ...item, closed: { reason, at: now } } : item));
  return { ok: true, mission: { ...next, rodadas, state: 'pausada' } };
}

export type OwnerGesture = { readonly kind: 'aceitar' } | { readonly kind: 'mais-uma' } | { readonly kind: 'redirecionar'; readonly text: string };

/** The owner's gesture on the sample of a closed rodada. */
export function applyGesture(mission: HillClimbMission, gesture: OwnerGesture, now: number): MissionResult {
  if (mission.state !== 'pausada') return { ok: false, reason: 'Só se decide uma rodada fechada.' };
  if (gesture.kind === 'aceitar') return { ok: true, mission: { ...mission, state: 'aceita' } };
  if (extraRodadasLeft(mission) === 0) return { ok: false, reason: `Já foram as ${HILL_CLIMB_RULES.maxExtraRodadas} rodadas extras desta missão; o que resta é parar e aceitar.` };
  const direction = gesture.kind === 'redirecionar' ? gesture.text.trim() : '';
  if (gesture.kind === 'redirecionar' && !direction) return { ok: false, reason: 'Redirecionar pede o texto do novo rumo.' };
  if (direction.length > MAX_TEXT_CHARS) return { ok: false, reason: `O novo rumo passa de ${MAX_TEXT_CHARS} caracteres.` };
  const rodada: MissionRodada = {
    index: mission.rodadas.length,
    maxRounds: HILL_CLIMB_RULES.extraRounds,
    openedAt: now,
    ...(direction ? { direction } : {}),
  };
  return { ok: true, mission: { ...mission, state: 'rodando', rodadas: [...mission.rodadas, rodada] } };
}

// ---------------------------------------------------------------------------------------------------------------
// Sample of a closed rodada

export interface RodadaSample {
  readonly rodada: number;
  readonly reason: RodadaCloseReason;
  /** The round with the highest lowest score (the later one on a tie). */
  readonly best: MissionRound;
  /** Lowest score per round of the rodada, in order. */
  readonly curve: readonly { readonly round: number; readonly low: number }[];
  /** 2–3 rounds between the first and the best, evenly spaced (fewer when the rodada is short). */
  readonly intermediates: readonly MissionRound[];
}

export const CLOSE_REASON_LABEL: Readonly<Record<RodadaCloseReason, string>> = {
  corte: 'passou do corte',
  estacionou: 'estacionou',
  fim: 'acabaram os rounds',
};

export function rodadaSample(mission: HillClimbMission, rodadaIndex: number): RodadaSample | null {
  const rodada = mission.rodadas[rodadaIndex];
  const rounds = roundsOf(mission, rodadaIndex);
  if (!rodada?.closed || rounds.length === 0) return null;
  const lows = rounds.map((round) => lowestScore(round, mission.criteria));
  let bestAt = 0;
  lows.forEach((low, i) => {
    if (low >= lows[bestAt]!) bestAt = i;
  });
  const others = rounds.filter((_, i) => i !== bestAt);
  const want = Math.min(3, others.length);
  const intermediates: MissionRound[] = [];
  for (let k = 0; k < want; k += 1) {
    const pick = others[Math.round((k * (others.length - 1)) / Math.max(1, want - 1))];
    if (pick && !intermediates.includes(pick)) intermediates.push(pick);
  }
  return {
    rodada: rodadaIndex,
    reason: rodada.closed.reason,
    best: rounds[bestAt]!,
    curve: rounds.map((round, i) => ({ round: round.index, low: lows[i]! })),
    intermediates,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parse (a channel that does not know a newer document reads it and never writes it)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNewerHillClimbDoc(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion > HILL_CLIMB_SCHEMA_VERSION;
}

const STATES: readonly MissionState[] = ['proposta', 'rodando', 'pausada', 'aceita', 'recusada'];

function parseMission(raw: unknown): HillClimbMission | null {
  if (!isRecord(raw)) return null;
  const { id, projectPath, placeId, title, target, criteria, ledgerTaskId, state, createdAt, rodadas, rounds } = raw;
  if (typeof id !== 'string' || typeof projectPath !== 'string' || typeof placeId !== 'string' || typeof title !== 'string') return null;
  if (typeof target !== 'string' || !Array.isArray(criteria) || !criteria.every((c) => typeof c === 'string')) return null;
  if (typeof ledgerTaskId !== 'string' || typeof createdAt !== 'number' || !STATES.includes(state as MissionState)) return null;
  if (!Array.isArray(rodadas) || !Array.isArray(rounds)) return null;
  return raw as unknown as HillClimbMission;
}

export function parseHillClimbDoc(raw: unknown): HillClimbDoc {
  if (!isRecord(raw) || !isRecord(raw.missions)) return emptyHillClimbDoc();
  const missions: Record<string, HillClimbMission> = {};
  for (const [key, value] of Object.entries(raw.missions)) {
    const mission = parseMission(value);
    if (mission) missions[key] = mission;
  }
  return { schemaVersion: HILL_CLIMB_SCHEMA_VERSION, missions };
}
