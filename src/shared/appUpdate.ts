// B33 — update to the new alpha from inside the app (feed of GitHub releases, electron-updater). Pure: the IPC
// contract, whether the open sessions let the app close now, and the file that carries the open tabs across the
// restart. The main does the I/O; the renderer only asks and shows.

import type { SemaphoreState } from './index';

// ---------------------------------------------------------------------------
// IPC contract
// ---------------------------------------------------------------------------

export const APP_UPDATE_CHANNELS = {
  /** invoke -> `AppUpdateStatus`. */
  get: 'appUpdate:get',
  /** main -> renderer, when the status changes (check, download progress, ready, error). */
  changed: 'appUpdate:changed',
  /** invoke(tabs: ResumeTab[], remotes: ResumeRemote[]) -> `AppUpdateApplyResult`. On `ok` the app restarts into the new version. */
  apply: 'appUpdate:apply',
  /** invoke -> `AppUpdateBoot`: the tabs to reopen and the error of a failed update, once (the file is deleted). */
  takeBoot: 'appUpdate:takeBoot',
  /** invoke -> looks for a new version now. */
  check: 'appUpdate:check',
} as const;

/** A newer version on the release feed: downloading in the background, or downloaded and ready to restart into. */
export interface AppUpdateAvailable {
  readonly version: string;
  /** 0–100 while downloading; `null` before the first progress event. */
  readonly percent: number | null;
  readonly ready: boolean;
}

/** `enabled: false` = not the packaged alpha, or no feed: the feature does not show at all. */
export interface AppUpdateStatus {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly available: AppUpdateAvailable | null;
  /** The last check or download failed (e.g. `gh` not logged in): shown quietly, with "tentar de novo". */
  readonly failure: string | null;
  /**
   * Sessão durável (dono, 12/11) — how long "Atualizar" waits for the sessions in a turn before restarting anyway
   * (`appUpdate.forceAfterMinutes` of the config, 5 min by default). They come back on the same conversation.
   */
  readonly forceAfterMs: number;
}

export const DEFAULT_FORCE_AFTER_MINUTES = 5;

export type AppUpdateApplyResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface AppUpdateBoot {
  readonly tabs: readonly ResumeTab[];
  /** The sessions on a remote place that were open: they reattach by themselves; listed so the Líder hears who did not. */
  readonly remotes: readonly ResumeRemote[];
  /** The installer failed and the old version was opened again: what went wrong. */
  readonly failure: string | null;
}

export interface DonelAppUpdateApi {
  get(): Promise<AppUpdateStatus>;
  onChanged(listener: (status: AppUpdateStatus) => void): () => void;
  apply(tabs: readonly ResumeTab[], remotes: readonly ResumeRemote[]): Promise<AppUpdateApplyResult>;
  takeBoot(): Promise<AppUpdateBoot>;
  check(): Promise<void>;
}
// ---------------------------------------------------------------------------
// "Can it update now?"
// ---------------------------------------------------------------------------

export interface UpdateSessionInput {
  /** The process of the tab is alive. */
  readonly alive: boolean;
  readonly state?: SemaphoreState;
  /** No hook heard yet: the `working` of the birth is a guess, the session is at the prompt. */
  readonly unconfirmed?: boolean;
  readonly pendingKinds?: readonly string[];
  /** `waiting` with background agents alive: the CLI will wake the session. */
  readonly awaitingBackgroundAgents?: boolean;
}

export interface UpdateReadiness {
  readonly ready: boolean;
  /** Sessions in the middle of a turn (or about to be woken by their background agents). */
  readonly working: number;
  /** Sessions with a question, permission or plan open for the owner. */
  readonly waitingOnYou: number;
}

/** Never ends a turn in the middle: it updates only when no live session is working or waiting on the owner. */
export function updateReadiness(sessions: readonly UpdateSessionInput[]): UpdateReadiness {
  let working = 0;
  let waitingOnYou = 0;
  for (const session of sessions) {
    if (!session.alive) continue;
    if (session.state === 'permission' || (session.pendingKinds?.length ?? 0) > 0) waitingOnYou += 1;
    else if ((session.state === 'working' && !session.unconfirmed) || session.awaitingBackgroundAgents) working += 1;
  }
  return { ready: working === 0 && waitingOnYou === 0, working, waitingOnYou };
}

/** The sessions in the middle of a turn (the same count as `working`): each is asked to close it and save its state. */
export function sessionsToWarn(sessions: readonly (UpdateSessionInput & { readonly id: string })[]): string[] {
  return sessions.filter((session) => updateReadiness([session]).working > 0).map((session) => session.id);
}

export interface UpdateGo {
  readonly go: boolean;
  /** Going with sessions still busy: the deadline passed (they come back on the same conversation). */
  readonly forced: boolean;
  readonly remainingMs: number;
}

/**
 * Sessão durável (dono, 12/11: "dar um tempo limite para reinicialização do sistema se elas não ficarem disponíveis
 * logo") — the update goes when every session is free, or when `forceAfterMs` has passed since the click.
 */
export function updateGo(
  readiness: UpdateReadiness,
  timing: { readonly requestedAt: number; readonly now: number; readonly forceAfterMs: number; readonly readyForMs: number },
): UpdateGo {
  const remainingMs = Math.max(0, timing.requestedAt + timing.forceAfterMs - timing.now);
  // Between the end of a turn and the turn the notice opens, every session looks free for an instant: hold a little.
  if (readiness.ready && timing.readyForMs >= UPDATE_READY_HOLD_MS) return { go: true, forced: false, remainingMs };
  return remainingMs === 0 ? { go: true, forced: true, remainingMs } : { go: false, forced: false, remainingMs };
}

// ---------------------------------------------------------------------------
// The tabs to reopen after the update
// ---------------------------------------------------------------------------

export const RESUME_FILE_VERSION = 1;
/** A file older than this is not an update that just happened: it is dropped, never restored. */
export const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const TAB_VIEWS = ['chat', 'terminal'] as const;

export interface ResumeTab {
  readonly sessionType: 'claude' | 'shell';
  readonly name: string;
  readonly cwd?: string;
  readonly projectName?: string;
  /** The conversation (`-r <id>` on the way back). Absent in a free terminal or a session that never started. */
  readonly sessionId?: string;
  /** The launch flags, already with `-r <sessionId>` when there is a conversation. */
  readonly launchArgs?: readonly string[];
  readonly providerId?: string;
  readonly roleId?: string;
  /** The place of the Mindscape a session that had not started was opened from. */
  readonly placeId?: string;
  /** Só os Líderes nas abas — place of the session that opened this one (`sessao_abrir`): it comes back out of the tab bar. */
  readonly openedBy?: string;
  /** Líder único (ADR 0007) — the Jobu's mark on its tab; without it the tab comes back as an ordinary session. */
  readonly leaderOfAll?: boolean;
  readonly color?: string;
  readonly customTitle?: string | null;
  readonly pinned?: boolean;
  readonly view?: (typeof TAB_VIEWS)[number];
  /** The tab in focus when the app closed. */
  readonly active?: boolean;
}

/**
 * A session on a remote place that was open when the app closed. It keeps running there and reattaches on the next
 * boot (`pty.remoteAlive`); it is kept apart from `tabs` so an older build never spawns it here.
 */
export interface ResumeRemote {
  readonly remoteId: string;
  readonly sessionId: string;
  readonly name: string;
  readonly cwd?: string;
}

export interface ResumeFile {
  readonly version: number;
  /** `alfa` | `beta` | `stable` | `dev`: the channels share `userData`, only the one that closed restores. */
  readonly channel: string;
  readonly writtenAt: number;
  readonly tabs: readonly ResumeTab[];
  readonly remotes?: readonly ResumeRemote[];
}

export function serializeResumeFile(channel: string, tabs: readonly ResumeTab[], now: number, remotes: readonly ResumeRemote[] = []): string {
  const file: ResumeFile = { version: RESUME_FILE_VERSION, channel, writtenAt: now, tabs, ...(remotes.length > 0 ? { remotes } : {}) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseResumeTab(value: unknown): ResumeTab | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.sessionType !== 'claude' && raw.sessionType !== 'shell') return null;
  if (typeof raw.name !== 'string') return null;
  const launchArgs = Array.isArray(raw.launchArgs) && raw.launchArgs.every((arg) => typeof arg === 'string') ? (raw.launchArgs as string[]) : undefined;
  const view = TAB_VIEWS.find((candidate) => candidate === raw.view);
  const tab: ResumeTab = {
    sessionType: raw.sessionType,
    name: raw.name,
    ...(optionalString(raw.cwd) ? { cwd: optionalString(raw.cwd) } : {}),
    ...(optionalString(raw.projectName) ? { projectName: optionalString(raw.projectName) } : {}),
    ...(optionalString(raw.sessionId) ? { sessionId: optionalString(raw.sessionId) } : {}),
    ...(launchArgs ? { launchArgs } : {}),
    ...(optionalString(raw.providerId) ? { providerId: optionalString(raw.providerId) } : {}),
    ...(optionalString(raw.roleId) ? { roleId: optionalString(raw.roleId) } : {}),
    ...(optionalString(raw.placeId) ? { placeId: optionalString(raw.placeId) } : {}),
    ...(optionalString(raw.openedBy) ? { openedBy: optionalString(raw.openedBy) } : {}),
    ...(raw.leaderOfAll === true ? { leaderOfAll: true } : {}),
    ...(optionalString(raw.color) ? { color: optionalString(raw.color) } : {}),
    ...(typeof raw.customTitle === 'string' || raw.customTitle === null ? { customTitle: raw.customTitle } : {}),
    ...(raw.pinned === true ? { pinned: true } : {}),
    ...(view ? { view } : {}),
    ...(raw.active === true ? { active: true } : {}),
  };
  return tab;
}

/**
 * The tabs to reopen. Nothing when the file is broken, from another channel, from a newer format or too old:
 * the general restore on boot stays cancelled, this only finishes an update that just happened. A broken
 * tab is skipped without taking the others with it.
 */
export function parseResumeFile(text: string | null, options: { readonly channel: string; readonly now: number }): readonly ResumeTab[] {
  return parseResume(text, options).tabs;
}

function parseResumeRemote(value: unknown): ResumeRemote | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const remoteId = optionalString(raw.remoteId);
  const sessionId = optionalString(raw.sessionId);
  if (!remoteId || !sessionId || typeof raw.name !== 'string') return null;
  const cwd = optionalString(raw.cwd);
  return { remoteId, sessionId, name: raw.name, ...(cwd ? { cwd } : {}) };
}

/** `parseResumeFile` with the remote sessions too; the same checks (channel, age, format) drop both. */
export function parseResume(
  text: string | null,
  options: { readonly channel: string; readonly now: number },
): { readonly tabs: readonly ResumeTab[]; readonly remotes: readonly ResumeRemote[] } {
  const none = { tabs: [], remotes: [] };
  if (text === null) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return none;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return none;
  const file = parsed as Record<string, unknown>;
  if (file.version !== RESUME_FILE_VERSION || file.channel !== options.channel) return none;
  if (typeof file.writtenAt !== 'number' || options.now - file.writtenAt > RESUME_MAX_AGE_MS || file.writtenAt - options.now > 60_000) return none;
  if (!Array.isArray(file.tabs)) return none;
  const remotes = Array.isArray(file.remotes) ? file.remotes.map(parseResumeRemote).filter((remote): remote is ResumeRemote => remote !== null) : [];
  return { tabs: file.tabs.map(parseResumeTab).filter((tab): tab is ResumeTab => tab !== null), remotes };
}

/**
 * A conversation opened but never written to has no transcript: `claude -r <id>` would answer "No conversation found"
 * and exit. It starts again under the same id (`--session-id`), so its place on the Mindscape keeps the same thread.
 */
export function resumeArgsFor(launchArgs: readonly string[], sessionId: string, transcriptExists: boolean): string[] {
  const args = [...launchArgs];
  if (transcriptExists) return args;
  const index = args.indexOf('-r');
  if (index === -1 || args[index + 1] !== sessionId) return args;
  args.splice(index, 2, '--session-id', sessionId);
  return args;
}

/**
 * The other way, at each spawn: a tab that came back with `--session-id <id>` keeps that argv, and once the
 * conversation has a transcript a respawn (Reabrir) must resume it (`-r <id>`): the CLI refuses a `--session-id` in use.
 */
export function respawnArgsFor(launchArgs: readonly string[], transcriptExists: (sessionId: string) => boolean): readonly string[] {
  const index = launchArgs.indexOf('--session-id');
  const sessionId = index !== -1 ? launchArgs[index + 1] : undefined;
  if (!sessionId || launchArgs.includes('-r') || !transcriptExists(sessionId)) return launchArgs;
  const args = [...launchArgs];
  args.splice(index, 2, '-r', sessionId);
  return args;
}

/** A session freshly free is held this long before the update goes: the warned one may be opening its saving turn. */
export const UPDATE_READY_HOLD_MS = 5_000;
