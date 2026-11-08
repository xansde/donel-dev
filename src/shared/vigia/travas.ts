// Vigia de travas, fase 1 (t-f15b71a7; desenho em docs/planos/vigia-travas.md). Pure: what counts as a lock on a
// remote place, and when a lock opens or closes its urgent card. The service (src/main/vigia/vigia-service.ts) does
// the ssh, the ledger and the file. No password is ever involved: the vault is only asked for its state.

import type { RemoteHealthReport } from '../health/remote';
import { pulseOfRemote } from '../mindscape/bottlenecks';

export const VIGIA_ROUND_MS = 5 * 60_000;
/** A session in a loop (retrying the API, login fallen, failed call) for longer than this is a lock. */
export const SESSION_STUCK_MS = 10 * 60_000;
/** `bw status` slower than this (or no answer) = the vault is slow. */
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

/**
 * Pure — the probe: says it was reached, then the vault's state and how long `bw status` took. The session key is
 * loaded by the place's own shell from `~/.bw_session` into the environment of `bw` only (never an argument), and
 * only the `status` field of the answer leaves the place.
 */
export function buildVigiaProbeScript(): string {
  return [
    "printf 'DONEL_VIGIA_OK\\n'",
    'if command -v bw >/dev/null 2>&1 && [ -r "$HOME/.bw_session" ]; then',
    '  t0=$(date +%s%3N)',
    '  st=$( ( set -a; . "$HOME/.bw_session" >/dev/null 2>&1; set +a; timeout 25 bw status 2>/dev/null ) | python3 -c \'import sys, json',
    'try:',
    '    print(json.load(sys.stdin).get("status", "sem-resposta"))',
    'except Exception:',
    '    print("sem-resposta")\' 2>/dev/null )',
    '  t1=$(date +%s%3N)',
    "  printf 'DONEL_COFRE %s %s\\n' \"${st:-sem-resposta}\" \"$((t1 - t0))\"",
    'else',
    "  printf 'DONEL_COFRE ausente 0\\n'",
    'fi',
    '',
  ].join('\n');
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

const COFRE_DETAIL: Record<CofreStatus, string> = {
  locked: 'o cofre de senhas está trancado',
  unauthenticated: 'o cofre de senhas está sem login',
  'sem-resposta': 'o cofre de senhas não respondeu',
  unlocked: 'o cofre de senhas está lento',
  ausente: '',
};

/** Pure — the locks of this round. `reports` are the remote health's (sessions); `now` only orders nothing here. */
export function detectTravas(input: { readonly probes: readonly PlaceProbe[]; readonly reports: readonly RemoteHealthReport[]; readonly now: number }): Trava[] {
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
      return (pulse.state === 'travada' || pulse.state === 'esperando-api') && pulse.since !== null && readAt - pulse.since >= SESSION_STUCK_MS;
    });
    if (stuck.length > 0) {
      const names = stuck.map((session) => session.name || session.sid).join(', ');
      travas.push({ ...base, key: `sessoes:${probe.placeId}`, kind: 'sessoes', detail: `${stuck.length === 1 ? 'uma sessão parada' : `${stuck.length} sessões paradas`} há mais de 10 min em ${probe.label}: ${names}` });
    }
  }
  return travas;
}

/** What the vigia keeps between rounds and restarts: per lock, when it was first seen, the rounds, and its card. */
export interface VigiaState {
  readonly open: Readonly<Record<string, { readonly firstSeen: number; readonly rounds: number; readonly cartaId: string | null }>>;
}

/** Pure — one round: the locks that open a card now, the cards whose lock passed, and the next state. */
export function planRound(
  state: VigiaState,
  travas: readonly Trava[],
  now: number,
): { state: VigiaState; toOpen: Trava[]; toClose: Array<{ key: string; cartaId: string }> } {
  const open: Record<string, { firstSeen: number; rounds: number; cartaId: string | null }> = {};
  const toOpen: Trava[] = [];
  for (const trava of travas) {
    const before = state.open[trava.key];
    const entry = { firstSeen: before?.firstSeen ?? now, rounds: (before?.rounds ?? 0) + 1, cartaId: before?.cartaId ?? null };
    open[trava.key] = entry;
    if (entry.cartaId === null && entry.rounds >= ROUNDS_TO_WARN) toOpen.push(trava);
  }
  const toClose: Array<{ key: string; cartaId: string }> = [];
  for (const [key, entry] of Object.entries(state.open)) {
    if (!(key in open) && entry.cartaId !== null) toClose.push({ key, cartaId: entry.cartaId });
  }
  return { state: { open }, toOpen, toClose };
}

/** Pure — the state read from disk; anything unreadable is an empty state (the worst case is one card more). */
export function parseVigiaState(raw: unknown): VigiaState {
  const open: Record<string, { firstSeen: number; rounds: number; cartaId: string | null }> = {};
  const entries = (raw as { open?: unknown } | null)?.open;
  if (entries && typeof entries === 'object') {
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const entry = value as { firstSeen?: unknown; rounds?: unknown; cartaId?: unknown };
      if (typeof entry?.firstSeen !== 'number' || typeof entry.rounds !== 'number') continue;
      open[key] = { firstSeen: entry.firstSeen, rounds: entry.rounds, cartaId: typeof entry.cartaId === 'string' ? entry.cartaId : null };
    }
  }
  return { open };
}
