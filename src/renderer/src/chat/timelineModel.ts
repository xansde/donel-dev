// T054/T055 (014-chat) - pure model behind the timeline: splits the rows into
// rounds (one per turn, the unit of `content-visibility: auto`) and, with Focus
// Mode on, folds the work of each round through `foldForFocus` (T031) into the
// "trabalhou - N ações, M notas" bar (G1: the label changes with the state).

import { foldForFocus } from '../../../shared/chat/focusFold';
import type { ConversationRow, LiveState, Turn } from '../../../shared/chat/rows';

export type FoldState = 'working' | 'waiting' | 'done';

export type TimelineItem =
  | { readonly kind: 'row'; readonly key: string; readonly row: ConversationRow }
  | {
      readonly kind: 'fold';
      /** Stable across renders: derived from the first folded row. */
      readonly key: string;
      readonly state: FoldState;
      readonly label: string;
      readonly rows: readonly ConversationRow[];
      readonly hasQuestion: boolean;
      readonly expanded: boolean;
      readonly startedAt: string;
      /** `null` while the fold is live (the clock ticks in the UI). */
      readonly endedAt: string | null;
    };

export interface TimelineRound {
  readonly key: string;
  readonly turnId: string | null;
  readonly items: readonly TimelineItem[];
}

export interface TimelineOptions {
  readonly focusMode: boolean;
  /** `null` = not known yet (history still loading): the last turn counts as finished. */
  readonly live: LiveState | null;
  /** Keys (`foldKey`) of the folds the owner opened. */
  readonly expanded: ReadonlySet<string>;
}

export const foldKey = (firstFoldedRowId: string): string => `fold:${firstFoldedRowId}`;

/**
 * Ctrl+O: the open-folds set after toggling ALL folds at once - every one opens unless every one already is,
 * then they all close. Returns `prev` untouched when there is no fold (Focus Mode off, or nothing folded yet).
 */
export function toggleAllFolds(rounds: readonly { readonly items: readonly { readonly kind: string; readonly key: string }[] }[], prev: ReadonlySet<string>): ReadonlySet<string> {
  const keys = rounds.flatMap((round) => round.items.filter((item) => item.kind === 'fold').map((item) => item.key));
  if (keys.length === 0) return prev;
  return keys.every((key) => prev.has(key)) ? new Set() : new Set(keys);
}

// ---- labels ------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const FOLD_PREFIX: Record<FoldState, string> = {
  working: 'trabalhando',
  waiting: 'esperando você',
  done: 'trabalhou',
};

export function foldLabel(state: FoldState, actions: number, notes: number, steps: number): string {
  const parts: string[] = [];
  if (actions > 0) parts.push(plural(actions, 'ação', 'ações'));
  if (notes > 0) parts.push(plural(notes, 'nota', 'notas'));
  if (parts.length === 0) parts.push(plural(steps, 'etapa', 'etapas'));
  return `${FOLD_PREFIX[state]} — ${parts.join(', ')}`;
}

/** "41 s", "2 min", "2 min 41 s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

// ---- rounds --------------------------------------------------------------------

interface RawRound {
  readonly turnId: string | null;
  readonly rows: ConversationRow[];
}

/** A new round starts when the turnId changes; rows without turnId stay with the round they sit in. */
function splitRounds(rows: readonly ConversationRow[]): RawRound[] {
  const rounds: RawRound[] = [];
  let current: RawRound | null = null;
  for (const row of rows) {
    if (row.turnId === null) {
      if (current === null) {
        current = { turnId: null, rows: [] };
        rounds.push(current);
      }
      current.rows.push(row);
      continue;
    }
    if (current === null || (current.turnId !== null && current.turnId !== row.turnId)) {
      current = { turnId: row.turnId, rows: [] };
      rounds.push(current);
    } else if (current.turnId === null) {
      // a leading run of loose rows (e.g. the "conversa nova" notice) becomes its own round
      current = { turnId: row.turnId, rows: [] };
      rounds.push(current);
    }
    current.rows.push(row);
  }
  return rounds;
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(['working', 'waiting-you', 'terminal-needed', 'starting']);

function lastTurnInProgress(live: LiveState | null): boolean {
  return live !== null && (LIVE_STATUSES.has(live.status) || live.pendings.length > 0);
}

function lastAssistantId(rows: readonly ConversationRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.kind === 'assistant') return rows[i]!.id;
  return null;
}

function focusItemsOf(round: RawRound, complete: boolean, options: TimelineOptions, waiting: boolean): TimelineItem[] {
  const byId = new Map(round.rows.map((r) => [r.id, r] as const));
  const out: TimelineItem[] = [];

  // Segments of consecutive rows that belong to the turn; loose rows pass through in place.
  const segments: ConversationRow[][] = [];
  for (const row of round.rows) {
    if (row.turnId === null) {
      segments.push([row]);
    } else {
      const last = segments[segments.length - 1];
      if (last && last[0]!.turnId !== null) last.push(row);
      else segments.push([row]);
    }
  }

  const turnRows = round.rows.filter((r) => r.turnId !== null);
  const finalRowId = complete ? lastAssistantId(turnRows) : null;

  for (let s = 0; s < segments.length; s += 1) {
    const segment = segments[s]!;
    if (segment[0]!.turnId === null) {
      out.push({ kind: 'row', key: segment[0]!.id, row: segment[0]! });
      continue;
    }
    const turn: Turn = {
      turnId: segment[0]!.turnId!,
      opener: segment[0]!.kind === 'user' ? 'human' : 'notification',
      rows: segment.map((r) => r.id),
      complete,
      finalRowId,
    };
    const folded = foldForFocus([turn], segment);
    for (let i = 0; i < folded.length; i += 1) {
      const item = folded[i]!;
      if (item.kind === 'row') {
        out.push({ kind: 'row', key: item.rowId, row: byId.get(item.rowId)! });
        continue;
      }
      const rows = item.rows.map((id) => byId.get(id)!).filter(Boolean);
      const isLastOfTurn = i === folded.length - 1 && s === segments.length - 1;
      const liveFold = !complete && isLastOfTurn;
      const state: FoldState = liveFold ? (waiting ? 'waiting' : 'working') : 'done';
      const key = foldKey(item.rows[0]!);
      const next = folded[i + 1];
      const nextRow = next && next.kind === 'row' ? byId.get(next.rowId) : undefined;
      out.push({
        kind: 'fold',
        key,
        state,
        label: foldLabel(state, item.actions, item.notes, item.rows.length),
        rows,
        hasQuestion: item.hasQuestion,
        expanded: options.expanded.has(key),
        startedAt: rows[0]!.at,
        endedAt: liveFold ? null : (nextRow ?? rows[rows.length - 1]!).at,
      });
    }
  }
  return out;
}

export function buildTimeline(rows: readonly ConversationRow[], options: TimelineOptions): TimelineRound[] {
  const raw = splitRounds(rows);
  const inProgress = lastTurnInProgress(options.live);
  const waiting = options.live !== null && (options.live.status === 'waiting-you' || options.live.pendings.length > 0);

  return raw.map((round, index) => {
    const isLast = index === raw.length - 1;
    const complete = !(isLast && inProgress);
    const items: TimelineItem[] = options.focusMode
      ? focusItemsOf(round, complete, options, waiting)
      : round.rows.map((row) => ({ kind: 'row' as const, key: row.id, row }));
    return { key: `round:${round.rows[0]!.id}`, turnId: round.turnId, items };
  });
}
