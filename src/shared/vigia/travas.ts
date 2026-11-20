// Vigia de travas, fase 1 (t-f15b71a7; desenho em docs/planos/vigia-travas.md). Pure: what counts as a lock on a
// remote place, and when a lock opens or closes its urgent card. The service (src/main/vigia/vigia-service.ts) does
// the ssh, the ledger and the file. No password is ever involved: the vault is only asked for its state.

import type { RemoteHealthReport } from '../health/remote';
import type { VigiaCofrePrefs } from './config';
import type { RemoteSessionReading } from '../health/remoteSessions';
import { apiFailureReason, pulseOfRemote, type SessionPulse } from '../mindscape/bottlenecks';

export const VIGIA_ROUND_MS = 5 * 60_000;
/** A session in a loop (retrying the API, login fallen, failed call) for longer than this is a lock. */
export const SESSION_STUCK_MS = 10 * 60_000;
/** The vault command's `status` slower than this (or no answer) = the vault is slow. */
export const COFRE_SLOW_MS = 20_000;
/** A lock seen in this many rounds in a row opens its card (one round can be a blip). */
export const ROUNDS_TO_WARN = 2;

export type CofreStatus = 'unlocked' | 'locked' | 'unauthenticated' | 'sem-resposta' | 'ausente';

/** What the vigia's own ssh to a place told. */
export interface PlaceProbe {
  readonly placeId: string;
  readonly label: string;
  readonly reached: boolean;
  /** Why it was not reached: the ssh asked for a check/login, or the place did not answer. */
  readonly failure?: 'login' | 'fora';
  readonly cofre?: { readonly status: CofreStatus; readonly ms: number };
}

export type TravaKind = 'vps-fora' | 'vps-login' | 'cofre' | 'sessoes';

export interface Trava {
  /** Stable while the lock lasts: the same key never opens a second card. */
  readonly key: string;
  readonly kind: TravaKind;
  readonly placeId: string;
  readonly label: string;
  /** pt-BR, for the card; never anything that came from the vault or the ssh's words. */
  readonly detail: string;
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Pure — the probe: says it was reached, then (only with the optional `vigia.cofre` adapter) the vault's state and how
 * long its `status` took. The session file is loaded by the place's own shell into the environment of the vault's
 * command only (never an argument), and only the `status` field of the answer leaves the place.
 */
export function buildVigiaProbeScript(cofre: VigiaCofrePrefs | null): string {
  const lines = ["printf 'DONEL_VIGIA_OK\\n'"];
  if (!cofre) return `${lines.join('\n')}\n`;
  const command = shQuote(cofre.command);
  const file = `"$HOME"/${shQuote(cofre.sessionFile)}`;
  lines.push(
    `if command -v ${command} >/dev/null 2>&1 && [ -r ${file} ]; then`,
    '  t0=$(date +%s%3N)',
    `  st=$( ( set -a; . ${file} >/dev/null 2>&1; set +a; timeout 25 ${command} status 2>/dev/null ) | python3 -c 'import sys, json`,
    'try:',
    '    print(json.load(sys.stdin).get("status", "sem-resposta"))',
    'except Exception:',
    '    print("sem-resposta")\' 2>/dev/null )',
    '  t1=$(date +%s%3N)',
    "  printf 'DONEL_COFRE %s %s\\n' \"${st:-sem-resposta}\" \"$((t1 - t0))\"",
    'else',
    "  printf 'DONEL_COFRE ausente 0\\n'",
    'fi',
  );
  return `${lines.join('\n')}\n`;
}

const COFRE_STATES: readonly CofreStatus[] = ['unlocked', 'locked', 'unauthenticated', 'sem-resposta', 'ausente'];

/** Pure — reads the probe's answer. */
export function parseVigiaProbe(stdout: string): { reached: boolean; cofre?: { status: CofreStatus; ms: number } } {
  const lines = stdout.split(/\r?\n/);
  const reached = lines.includes('DONEL_VIGIA_OK');
  const line = lines.find((candidate) => candidate.startsWith('DONEL_COFRE '));
  if (!line) return { reached };
  const [, raw, ms] = line.split(' ');
  const status = (COFRE_STATES as readonly string[]).includes(raw ?? '') ? (raw as CofreStatus) : 'sem-resposta';
  return { reached, cofre: { status, ms: Number(ms) || 0 } };
}

/** Pure — the ssh did not get in: asking for a check or a login (Tailscale SSH, key refused), or no answer. */
export function classifySshFailure(stderrLastLine: string, timedOut: boolean): 'login' | 'fora' {
  if (timedOut) return 'fora';
  return /tailscale|authenticat|login|verif|permission denied|host key verification/i.test(stderrLastLine) ? 'login' : 'fora';
}

/** The causes that only wait on a usage limit or quota (`apiFailureReason`'s words). */
export const QUOTA_REASONS: ReadonlySet<string> = new Set(['conta no limite', 'sem cota (429)', 'gateway sem cota (429)']);

/**
 * Dono, 12/11 (t-5c0df1df): a session stopped by a limit or quota is routine — the despertador wakes it after the
 * reset — so it never opens a card to the owner. Login, 529 and 5xx loops still do.
 */
function waitsOnQuota(session: RemoteSessionReading, pulse: SessionPulse): boolean {
  if (pulse.state === 'esperando-api' && session.retry) return QUOTA_REASONS.has(apiFailureReason('', session.retry.text));
  if (pulse.state === 'travada' && session.pane !== 'login' && session.apiError && session.last === 'error') {
    return QUOTA_REASONS.has(apiFailureReason(session.apiError.kind, session.apiError.text));
  }
  return false;
}

const COFRE_DETAIL: Record<CofreStatus, string> = {
  locked: 'o cofre de senhas está trancado',
  unauthenticated: 'o cofre de senhas está sem login',
  'sem-resposta': 'o cofre de senhas não respondeu',
  unlocked: 'o cofre de senhas está lento',
  ausente: '',
};

/** Pure — the locks of this round. `reports` are the remote health's (sessions); `now` only orders nothing here. */
export function detectTravas(input: {
  readonly probes: readonly PlaceProbe[];
  readonly reports: readonly RemoteHealthReport[];
  readonly now: number;
  /** The board (its name) of a session, when known: the card of a loop names them, since it goes to one board only. */
  readonly boardOfSession?: (sid: string) => string | undefined;
}): Trava[] {
  const travas: Trava[] = [];
  for (const probe of input.probes) {
    const base = { placeId: probe.placeId, label: probe.label };
    if (!probe.reached) {
      travas.push(
        probe.failure === 'login'
          ? { ...base, key: `vps-login:${probe.placeId}`, kind: 'vps-login', detail: `${probe.label} pede verificação ou login para entrar` }
          : { ...base, key: `vps-fora:${probe.placeId}`, kind: 'vps-fora', detail: `${probe.label} não responde` },
      );
      continue;
    }
    const cofre = probe.cofre;
    if (cofre && cofre.status !== 'ausente' && (cofre.status !== 'unlocked' || cofre.ms >= COFRE_SLOW_MS)) {
      travas.push({ ...base, key: `cofre:${probe.placeId}`, kind: 'cofre', detail: `${COFRE_DETAIL[cofre.status]} em ${probe.label}` });
    }
    const report = input.reports.find((candidate) => candidate.id === probe.placeId);
    const reading = report?.status === 'ok' ? report.reading : null;
    const readAt = reading?.readAt ?? null;
    if (!reading?.sessionDetails || readAt === null) continue;
    const stuck = reading.sessionDetails.filter((session) => {
      const pulse = pulseOfRemote(session, readAt);
      // "Esperando a API" counts only when the CLI is RETRYING a failed call (`retry`): a long, legitimate answer
      // also waits on the API for minutes, and a bigger threshold would only move the false alarm, not remove it.
      const loop = pulse.state === 'travada' || (pulse.state === 'esperando-api' && session.retry !== null);
      return loop && !waitsOnQuota(session, pulse) && pulse.since !== null && readAt - pulse.since >= SESSION_STUCK_MS;
    });
    if (stuck.length > 0) {
      const names = stuck.map((session) => session.name || session.sid).join(', ');
      const boards = [...new Set(stuck.map((session) => input.boardOfSession?.(session.sid)).filter((board): board is string => !!board))].sort();
      const where = boards.length === 0 ? '' : ` (${boards.length === 1 ? 'quadro' : 'quadros'} ${boards.join(', ')})`;
      travas.push({ ...base, key: `sessoes:${probe.placeId}`, kind: 'sessoes', detail: `${stuck.length === 1 ? 'uma sessão parada' : `${stuck.length} sessões paradas`} há mais de 10 min em ${probe.label}: ${names}${where}` });
    }
  }
  return travas;
}

/** One lock the vigia keeps between rounds and restarts: when it was first seen, its card, and whether the PC warned. */
export interface VigiaEntry {
  readonly firstSeen: number;
  readonly rounds: number;
  readonly cartaId: string | null;
  /** The card could not be made (the Oráculo's place was down): the PC warned natively, once. */
  readonly notified: boolean;
  /**
   * Only in a state written before t-0358187b: the lock passed before its card could be made. It is read as a lock
   * that passed then (its record still goes), never kept as live.
   */
  readonly endedAt: number | null;
  /** The PC handed this lock over to the Oráculo's daemon (t-ffbf8e7d): its passage is the daemon's to record. */
  readonly handedOver?: true;
  readonly trava: Trava;
}

/** A lock that passed (it was confirmed: seen in two rounds, or it had a card or a warning on the PC). */
export interface PassedLock {
  readonly key: string;
  readonly trava: Trava;
  readonly firstSeen: number;
  readonly endedAt: number;
}

/** What the vigia knew of a place's sessions at its last good reading (for "what stopped"). */
export interface KnownSessions {
  readonly at: number;
  readonly sessions: ReadonlyArray<{ readonly sid: string; readonly name: string }>;
}

/** A record of a lock that passed, waiting for the Oráculo (it goes with the times the vigia saw, however late). */
export interface PendingRecord {
  readonly key: string;
  readonly trava: Trava;
  readonly firstSeen: number;
  readonly endedAt: number;
  /** The words of the record, made when the lock passed (the cause is measured then, not when the Oráculo answers). */
  readonly title: string;
  readonly note: string;
  readonly body: string;
  /** A round already tried to send it and the Oráculo did not answer. */
  readonly late: boolean;
}

/** A lock that passed, kept 24 h to tell when the same lock keeps coming back. */
export interface Passage {
  readonly key: string;
  readonly placeId: string;
  readonly kind: TravaKind;
  readonly firstSeen: number;
  readonly endedAt: number;
  readonly cause: string | null;
}

/** The repeat card of a lock (the owner's real question) and whether its answer was acted on. */
export interface RepeatCard {
  readonly cartaId: string;
  readonly at: number;
  readonly done: boolean;
}

export interface VigiaState {
  readonly open: Readonly<Record<string, VigiaEntry>>;
  readonly records?: readonly PendingRecord[];
  readonly history?: readonly Passage[];
  readonly sessions?: Readonly<Record<string, KnownSessions>>;
  readonly repeats?: Readonly<Record<string, RepeatCard>>;
}

/** A confirmed lock: seen in two rounds in a row, or it already had a card or a warning on the PC. */
function confirmed(entry: VigiaEntry): boolean {
  return entry.rounds >= ROUNDS_TO_WARN || entry.cartaId !== null || entry.notified || entry.endedAt !== null;
}

/**
 * Pure — one round:
 * - `toOpen`: a lock seen in two rounds with no card yet (its card says since when);
 * - `toClose`: the card of a lock that passed (cancelled: a lock that passed asks nothing);
 * - `passed`: every confirmed lock that passed, for its record (a one-round blip is no lock, and a lock handed over to
 *   the daemon is the daemon's to record).
 */
export function planRound(
  state: VigiaState,
  travas: readonly Trava[],
  now: number,
): {
  state: VigiaState;
  toOpen: Array<{ trava: Trava; firstSeen: number }>;
  toClose: Array<{ key: string; cartaId: string }>;
  passed: PassedLock[];
} {
  const open: Record<string, VigiaEntry> = {};
  const toOpen: Array<{ trava: Trava; firstSeen: number }> = [];
  const passed: PassedLock[] = [];
  for (const trava of travas) {
    // A lock that passed in an older state (kept only for its record) and came back is a new lock: new warning, card.
    const kept = state.open[trava.key];
    const before = kept && kept.endedAt === null ? kept : undefined;
    if (kept && kept.endedAt !== null) passed.push({ key: trava.key, trava: kept.trava, firstSeen: kept.firstSeen, endedAt: kept.endedAt });
    const entry: VigiaEntry = {
      firstSeen: before?.firstSeen ?? now,
      rounds: (before?.rounds ?? 0) + 1,
      cartaId: before?.cartaId ?? null,
      notified: before?.notified ?? false,
      endedAt: null,
      trava,
    };
    open[trava.key] = entry;
    if (entry.cartaId === null && entry.rounds >= ROUNDS_TO_WARN) toOpen.push({ trava, firstSeen: entry.firstSeen });
  }
  const toClose: Array<{ key: string; cartaId: string }> = [];
  for (const [key, entry] of Object.entries(state.open)) {
    if (key in open) continue;
    if (entry.cartaId !== null && entry.endedAt === null) toClose.push({ key, cartaId: entry.cartaId });
    if (confirmed(entry) && !entry.handedOver) passed.push({ key, trava: entry.trava, firstSeen: entry.firstSeen, endedAt: entry.endedAt ?? now });
  }
  return { state: { ...state, open }, toOpen, toClose, passed };
}

const TRAVA_KINDS: readonly TravaKind[] = ['vps-fora', 'vps-login', 'cofre', 'sessoes'];

function parseTrava(key: string, raw: unknown): Trava | null {
  const trava = raw as Partial<Trava> | undefined;
  if (!trava || typeof trava.placeId !== 'string' || typeof trava.label !== 'string' || typeof trava.detail !== 'string') return null;
  if (!(TRAVA_KINDS as readonly unknown[]).includes(trava.kind)) return null;
  return { key, kind: trava.kind as TravaKind, placeId: trava.placeId, label: trava.label, detail: trava.detail };
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === 'string';

/** Pure — the state read from disk; anything unreadable is dropped (the worst case is one card more). */
export function parseVigiaState(raw: unknown): VigiaState {
  const open: Record<string, VigiaEntry> = {};
  const root = (raw ?? {}) as { open?: unknown; records?: unknown; history?: unknown; sessions?: unknown; repeats?: unknown };
  const entries = root.open;
  if (entries && typeof entries === 'object') {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const entry = value as Partial<Record<keyof VigiaEntry, unknown>>;
      if (typeof entry?.firstSeen !== 'number' || typeof entry.rounds !== 'number') continue;
      const trava = parseTrava(key, entry.trava);
      if (!trava) continue;
      open[key] = {
        firstSeen: entry.firstSeen,
        rounds: entry.rounds,
        cartaId: typeof entry.cartaId === 'string' ? entry.cartaId : null,
        notified: entry.notified === true,
        endedAt: typeof entry.endedAt === 'number' ? entry.endedAt : null,
        ...(entry.handedOver === true ? { handedOver: true as const } : {}),
        trava,
      };
    }
  }
  const records: PendingRecord[] = [];
  for (const value of Array.isArray(root.records) ? root.records : []) {
    const record = value as Partial<Record<keyof PendingRecord, unknown>>;
    const trava = isStr(record?.key) ? parseTrava(record.key, record.trava) : null;
    if (!trava || !isNum(record.firstSeen) || !isNum(record.endedAt) || !isStr(record.title) || !isStr(record.note) || !isStr(record.body)) continue;
    records.push({ key: trava.key, trava, firstSeen: record.firstSeen, endedAt: record.endedAt, title: record.title, note: record.note, body: record.body, late: record.late === true });
  }
  const history: Passage[] = [];
  for (const value of Array.isArray(root.history) ? root.history : []) {
    const passage = value as Partial<Record<keyof Passage, unknown>>;
    if (!isStr(passage?.key) || !isStr(passage.placeId) || !(TRAVA_KINDS as readonly unknown[]).includes(passage.kind) || !isNum(passage.firstSeen) || !isNum(passage.endedAt)) continue;
    history.push({ key: passage.key, placeId: passage.placeId, kind: passage.kind as TravaKind, firstSeen: passage.firstSeen, endedAt: passage.endedAt, cause: isStr(passage.cause) ? passage.cause : null });
  }
  const sessions: Record<string, KnownSessions> = {};
  if (root.sessions && typeof root.sessions === 'object') {
    for (const [placeId, value] of Object.entries(root.sessions as Record<string, unknown>)) {
      const known = value as { at?: unknown; sessions?: unknown };
      if (!isNum(known?.at) || !Array.isArray(known.sessions)) continue;
      const list = known.sessions.filter((s): s is { sid: string; name: string } => isStr((s as { sid?: unknown })?.sid) && isStr((s as { name?: unknown })?.name));
      sessions[placeId] = { at: known.at, sessions: list.map((s) => ({ sid: s.sid, name: s.name })) };
    }
  }
  const repeats: Record<string, RepeatCard> = {};
  if (root.repeats && typeof root.repeats === 'object') {
    for (const [key, value] of Object.entries(root.repeats as Record<string, unknown>)) {
      const card = value as { cartaId?: unknown; at?: unknown; done?: unknown };
      if (isStr(card?.cartaId) && isNum(card.at)) repeats[key] = { cartaId: card.cartaId, at: card.at, done: card.done === true };
    }
  }
  return { open, records, history, sessions, repeats };
}
