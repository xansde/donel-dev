// Sessão renovada em voo (B36, item 07 do PDA mindscape-openrig) — the pure part.
//
// When a session crosses the context budget the owner set, the app asks the
// session itself to write a handoff (fixed format, a file in the app's own
// folder), ends the process and opens a new one in the SAME tab, with the
// handoff as its first reading. This module only decides; the renderer
// (`sessionRenewal/useSessionRenewal.ts`) does the plumbing and the main
// (`session-renewal.ts`) writes the instructions and reads the handoff.
//
// Two rules no code path may break:
//   1. Only at the end of a turn: never mid-tool, never with a question or a
//      permission open (`turn !== 'waiting'`).
//   2. Never end a process with live work: background agents the CLI reports,
//      or anything the session itself declared in the handoff header.
//
// Refinement: docs/refinamentos/sessao-renovada-em-voo.md.

/** `sessionRenewal` in `config.json` (top-level key, like `pet`). */
export interface SessionRenewalPrefs {
  readonly enabled: boolean;
  /** Context tokens of the session that trigger the renewal. */
  readonly limitTokens: number;
}

/** The owner works with a "250k per session" budget (memory "Sessões por orçamento de 250k"). */
export const DEFAULT_SESSION_RENEWAL_PREFS: SessionRenewalPrefs = { enabled: true, limitTokens: 250_000 };
export const RENEWAL_LIMIT_MIN_TOKENS = 50_000;
export const RENEWAL_LIMIT_MAX_TOKENS = 1_000_000;
/** The discreet warning shows up this many tokens before the limit. */
export const RENEWAL_WARN_MARGIN_TOKENS = 20_000;
/** "Agora não" postpones the renewal by this many tokens of context. */
export const RENEWAL_SNOOZE_TOKENS = 50_000;

/** Field by field: an invalid field falls back to the default of that field. */
export function sanitizeSessionRenewalPrefs(value: unknown, fallback: SessionRenewalPrefs = DEFAULT_SESSION_RENEWAL_PREFS): SessionRenewalPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const limit = candidate.limitTokens;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    limitTokens:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(RENEWAL_LIMIT_MAX_TOKENS, Math.max(RENEWAL_LIMIT_MIN_TOKENS, Math.round(limit)))
        : fallback.limitTokens,
  };
}

/** The semaphore state of the tab (`SemaphoreState`), repeated here to keep this module free of imports. */
export type RenewalTurnState = 'working' | 'waiting' | 'permission' | 'error' | 'done';

export interface RenewalCheckInput {
  readonly prefs: SessionRenewalPrefs;
  /** Context of the session now (`null` = no reading yet). */
  readonly contextTokens: number | null;
  readonly turn: RenewalTurnState;
  /** The last `Stop` still listed background agents alive (`awaitingBackgroundAgents`). */
  readonly backgroundAgents: boolean;
  /** "Agora não": the renewal only comes back from this many tokens on. `null` = not postponed. */
  readonly snoozedUntilTokens: number | null;
  /** A plain session tab with a live process (not a login tab, not an isolated worktree). */
  readonly eligible: boolean;
}

/**
 * - `off`: nothing to show.
 * - `near`: the discreet warning (the renewal is close).
 * - `due-wait`: past the limit, waiting for the turn (or the background work) to end.
 * - `renew`: ask the session for the handoff now.
 */
export type RenewalVerdict = 'off' | 'near' | 'due-wait' | 'renew';

/** The threshold that applies now: the limit, or the "Agora não" mark when it is further. */
export function renewalThreshold(prefs: SessionRenewalPrefs, snoozedUntilTokens: number | null): number {
  return Math.max(prefs.limitTokens, snoozedUntilTokens ?? 0);
}

/** Should this session be renewed now? Decided again at every change of context or turn. */
export function checkRenewal(input: RenewalCheckInput): RenewalVerdict {
  if (!input.eligible || !input.prefs.enabled || input.contextTokens === null) return 'off';
  if (input.turn === 'done' || input.turn === 'error') return 'off';
  const threshold = renewalThreshold(input.prefs, input.snoozedUntilTokens);
  if (input.contextTokens < threshold - RENEWAL_WARN_MARGIN_TOKENS) return 'off';
  if (input.contextTokens < threshold) return 'near';
  if (input.turn !== 'waiting' || input.backgroundAgents) return 'due-wait';
  return 'renew';
}

/** Where the "Agora não" mark goes: one snooze past what the session has now (or past the limit, before it). */
export function snoozeMark(prefs: SessionRenewalPrefs, contextTokens: number | null): number {
  return Math.max(prefs.limitTokens, contextTokens ?? 0) + RENEWAL_SNOOZE_TOKENS;
}

// ---------------------------------------------------------------------------
// The handoff file and the swap
// ---------------------------------------------------------------------------

/** Marker of the first header line: the format version the app understands. */
export const HANDOFF_FORMAT_MARKER = 'donel-passagem: 1';

/**
 * - `missing`: no file yet, or a file without the header (still being written, or never).
 * - `ready`: header read; `liveWork` is what the session declared still running (`null` = nothing).
 */
export type HandoffStatus = { readonly kind: 'missing' } | { readonly kind: 'ready'; readonly liveWork: string | null };

const NO_LIVE_WORK = new Set(['nenhum', 'nenhuma', 'nada', 'none', '-', '']);

/**
 * Reads the front matter of the handoff. Only the header matters to the app:
 * the body is for the new session. A file without `donel-passagem: 1` in its
 * front matter counts as missing — the session has not finished it.
 */
export function parseHandoffHeader(text: string | null): HandoffStatus {
  if (text === null) return { kind: 'missing' };
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { kind: 'missing' };
  let marker = false;
  let liveWork: string | null | undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === '---') break;
    if (line === HANDOFF_FORMAT_MARKER) marker = true;
    const match = /^trabalho-vivo\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const value = match[1]!.trim().replace(/^["'`]|["'`]$/g, '').trim();
      liveWork = NO_LIVE_WORK.has(value.toLowerCase()) ? null : value;
    }
  }
  // Without the field the session did not say: treat as live work, never as "nothing".
  if (!marker) return { kind: 'missing' };
  return { kind: 'ready', liveWork: liveWork === undefined ? 'não declarado na passagem' : liveWork };
}

export interface SwapCheckInput {
  readonly handoff: HandoffStatus;
  readonly turn: RenewalTurnState;
  readonly backgroundAgents: boolean;
  /** A turn ended after the handoff was asked (the request was answered). */
  readonly turnEndedSinceAsk: boolean;
}

/**
 * - `swap`: end the process and open the new one now.
 * - `wait-turn`: the session is still on the request (or on something else).
 * - `wait-live-work`: the handoff is written but work must not die yet.
 * - `give-up`: the turn ended and no handoff was written — leave the session alone.
 */
export type SwapVerdict = 'swap' | 'wait-turn' | 'wait-live-work' | 'give-up';

export function decideSwap(input: SwapCheckInput): SwapVerdict {
  if (input.turn === 'done' || input.turn === 'error') return 'give-up';
  if (input.turn !== 'waiting' || !input.turnEndedSinceAsk) return 'wait-turn';
  if (input.handoff.kind === 'missing') return 'give-up';
  if (input.backgroundAgents || input.handoff.liveWork !== null) return 'wait-live-work';
  return 'swap';
}

// ---------------------------------------------------------------------------
// The argv of the new process
// ---------------------------------------------------------------------------

/** Permission modes worth carrying from the old process (a mode switched with Shift+Tab lives only in it). */
const CARRIED_PERMISSION_MODES: ReadonlySet<string> = new Set(['default', 'acceptEdits', 'plan']);

/**
 * Same flags as the launch, minus what points at the OLD conversation
 * (`-r`, `--resume`, `--session-id`, `--fork-session`, `-c`, `--continue`): the
 * main gives the new process its own `--session-id`. When the old process had
 * switched permission mode, the new one starts in that mode (only the modes
 * that need no extra opt-in).
 */
export function renewalLaunchArgs(args: readonly string[] | undefined, carried: string | null): string[] {
  const out: string[] = [];
  const source = args ?? [];
  // "default" is also what the chat reads when the transcript records no mode change: it never lowers a launch that
  // needed an opt-in (bypass, auto, dontAsk). The renewed session would stop on every prompt, and only the owner, inside
  // that tab, could answer (t-1293c818). A Shift+Tab to plan or acceptEdits still carries.
  const permissionMode = carried === 'default' && launchedWithOptIn(source) ? null : carried;
  for (let i = 0; i < source.length; i += 1) {
    const arg = source[i]!;
    if (arg === '-r' || arg === '--resume' || arg === '--session-id') {
      const next = source[i + 1];
      if (next !== undefined && !next.startsWith('-')) i += 1;
      continue;
    }
    if (arg.startsWith('--resume=') || arg.startsWith('--session-id=')) continue;
    if (arg === '--fork-session' || arg === '-c' || arg === '--continue') continue;
    if (permissionMode !== null && CARRIED_PERMISSION_MODES.has(permissionMode)) {
      if (arg === '--permission-mode') {
        i += 1;
        continue;
      }
      if (arg.startsWith('--permission-mode=')) continue;
    }
    out.push(arg);
  }
  if (permissionMode !== null && CARRIED_PERMISSION_MODES.has(permissionMode) && !out.includes('--dangerously-skip-permissions')) {
    out.push('--permission-mode', permissionMode);
  }
  return out;
}

/** Permission modes of the launch that need an opt-in (no Shift+Tab gets back to them once lowered). */
const OPT_IN_PERMISSION_MODES: ReadonlySet<string> = new Set(['bypassPermissions', 'auto', 'dontAsk']);

function launchedWithOptIn(args: readonly string[]): boolean {
  return args.some(
    (arg, i) =>
      arg === '--dangerously-skip-permissions' ||
      (arg === '--permission-mode' && OPT_IN_PERMISSION_MODES.has(args[i + 1] ?? '')) ||
      (arg.startsWith('--permission-mode=') && OPT_IN_PERMISSION_MODES.has(arg.slice('--permission-mode='.length))),
  );
}

// ---------------------------------------------------------------------------
// The first message of the new session (the handoff to read)
// ---------------------------------------------------------------------------

/** How long the renderer waits for the new session to take its first message before it tells the owner. */
export const RENEWAL_HANDOFF_WAIT_MS = 120_000;

/** How the first message of the new session ended (same shape as the send driver's outcome). */
export type RenewalHandoffDelivery =
  | { readonly kind: 'entrou' }
  | { readonly kind: 'na-fila' }
  | { readonly kind: 'nao-foi'; readonly reason: string }
  | { readonly kind: 'enviando'; readonly reason?: string };

/**
 * `null` when the new session took (or queued) the "read the handoff" message. Otherwise the notice
 * for the tab: the new session did not get the handoff and would start from scratch without anyone
 * noticing. It names the handoff file and never resends by itself: the owner decides.
 */
export function renewalHandoffDeliveryNotice(outcome: RenewalHandoffDelivery, handoffPath: string): string | null {
  if (outcome.kind === 'entrou' || outcome.kind === 'na-fila') return null;
  const why = outcome.kind === 'nao-foi' ? `não entrou (${outcome.reason})` : `ainda não entrou${outcome.reason ? ` (${outcome.reason})` : ''}`;
  return `A sessão nova não confirmou ter recebido a passagem de bastão: a primeira mensagem ${why}. A passagem está em ${handoffPath}. Confira antes de reenviar.`;
}

/** "250k" for the warning and the prompts. */
export function formatTokensK(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

// ---------------------------------------------------------------------------
// IPC (`window.donel.renewal`)
// ---------------------------------------------------------------------------

export const SESSION_RENEWAL_CHANNELS = {
  /** renderer → main: write the instructions and name the handoff of the session in `ptyId`. */
  prepare: 'renewal:prepare',
  /** renderer → main: read the header of the handoff back. */
  status: 'renewal:status',
} as const;

export interface RenewalPrepareInput {
  readonly ptyId: string;
  readonly contextTokens: number;
  readonly limitTokens: number;
}

export interface RenewalPrepared {
  readonly renewalId: string;
  readonly previousSessionId: string;
  readonly handoffPath: string;
  /** One line, sent to the session that leaves. */
  readonly requestPrompt: string;
  /** One line, the first message of the new session. */
  readonly firstPrompt: string;
}

export interface DonelRenewalApi {
  /** `null` when the main does not know the session of `ptyId` (it has not started, or it already ended). */
  prepare(input: RenewalPrepareInput): Promise<RenewalPrepared | null>;
  status(renewalId: string): Promise<HandoffStatus>;
}
