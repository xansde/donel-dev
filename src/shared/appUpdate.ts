// B33 — update to the new alpha from inside the app. Pure: what the installers folder says (is there a new
// version? did the morning build fail?), whether the open sessions let the app close now, and the file that
// carries the open tabs across the restart. The main does the I/O; the renderer only asks and shows.

import type { SemaphoreState } from './index';

// ---------------------------------------------------------------------------
// IPC contract
// ---------------------------------------------------------------------------

export const APP_UPDATE_CHANNELS = {
  /** invoke -> `AppUpdateStatus` (reads the folder again). */
  get: 'appUpdate:get',
  /** main -> renderer, when the status changes (periodic read of the folder). */
  changed: 'appUpdate:changed',
  /** invoke(tabs: ResumeTab[]) -> `AppUpdateApplyResult`. On `ok` the app closes right after answering. */
  apply: 'appUpdate:apply',
  /** invoke -> `AppUpdateBoot`: the tabs to reopen and the error of a failed update, once (the file is deleted). */
  takeBoot: 'appUpdate:takeBoot',
  /** invoke -> opens the build log of the failed morning build. */
  openLog: 'appUpdate:openLog',
} as const;

export interface AppUpdateAvailable {
  readonly installerPath: string;
  readonly installerName: string;
  readonly commit: string;
}

export interface AppUpdateFailure {
  /** First line of `FALHOU.txt` (date and error). */
  readonly message: string;
  readonly failedAtMs: number;
}

/** `enabled: false` = no installers folder (or not the alpha): the feature does not show at all. */
export interface AppUpdateStatus {
  readonly enabled: boolean;
  readonly available: AppUpdateAvailable | null;
  readonly failure: AppUpdateFailure | null;
}

export type AppUpdateApplyResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface AppUpdateBoot {
  readonly tabs: readonly ResumeTab[];
  /** The installer failed and the old version was opened again: what went wrong. */
  readonly failure: string | null;
}

export interface DonelAppUpdateApi {
  get(): Promise<AppUpdateStatus>;
  onChanged(listener: (status: AppUpdateStatus) => void): () => void;
  apply(tabs: readonly ResumeTab[]): Promise<AppUpdateApplyResult>;
  takeBoot(): Promise<AppUpdateBoot>;
  openLog(): Promise<void>;
}

// ---------------------------------------------------------------------------
// "Is there a new version?"
// ---------------------------------------------------------------------------

export interface InstallerFile {
  readonly name: string;
  readonly path: string;
  readonly mtimeMs: number;
}

/** What the installers folder holds right now. */
export interface UpdateFolderSnapshot {
  /** Content of `ultimo-commit.txt` (the commit of the last good build), raw. */
  readonly lastCommitText: string | null;
  /** When that file was written: the last good build. */
  readonly lastCommitAtMs: number | null;
  readonly installers: readonly InstallerFile[];
  /** Content of `FALHOU.txt`, raw, and when it was written. */
  readonly failedText: string | null;
  readonly failedAtMs: number | null;
}

export interface OwnBuild {
  /** The commit this app was built from; `null` when the build could not read it. */
  readonly commit: string | null;
  /** When this app was built (epoch ms); `null` when unknown. */
  readonly builtAtMs: number | null;
}

/** `Set-Content -Encoding utf8` of Windows PowerShell writes a BOM: trimmed and lowercased here. */
export function cleanCommit(text: string | null): string | null {
  if (text === null) return null;
  const commit = text.replace(/^﻿/, '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}

function newestInstaller(installers: readonly InstallerFile[]): InstallerFile | null {
  // The date is in the name (`…-Setup-AAAA-MM-DD.exe`); the time of the file breaks ties.
  const sorted = [...installers].sort((a, b) => b.name.localeCompare(a.name) || b.mtimeMs - a.mtimeMs);
  return sorted[0] ?? null;
}

/**
 * A new version exists when the last good build came from another commit than this app, its installer is
 * there, and that installer is newer than this app (a build made by hand from a later commit is not
 * "updated" to an older one). The morning build failing after the last good one is reported apart.
 */
export function evaluateUpdate(own: OwnBuild, folder: UpdateFolderSnapshot | null): AppUpdateStatus {
  if (!folder) return { enabled: false, available: null, failure: null };
  const lastCommit = cleanCommit(folder.lastCommitText);
  const installer = newestInstaller(folder.installers);
  const ownCommit = cleanCommit(own.commit);
  const differs = lastCommit !== null && ownCommit !== null && !lastCommit.startsWith(ownCommit) && !ownCommit.startsWith(lastCommit);
  const newer = installer !== null && (own.builtAtMs === null || installer.mtimeMs > own.builtAtMs);
  const available = differs && newer && installer ? { installerPath: installer.path, installerName: installer.name, commit: lastCommit } : null;

  const failedAfterSuccess =
    folder.failedAtMs !== null && (folder.lastCommitAtMs === null || folder.failedAtMs > folder.lastCommitAtMs);
  const message = (folder.failedText ?? '').replace(/^﻿/, '').split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? '';
  const failure = failedAfterSuccess && folder.failedAtMs !== null ? { message, failedAtMs: folder.failedAtMs } : null;
  return { enabled: true, available, failure };
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
  readonly color?: string;
  readonly customTitle?: string | null;
  readonly pinned?: boolean;
  readonly view?: (typeof TAB_VIEWS)[number];
  /** The tab in focus when the app closed. */
  readonly active?: boolean;
}

export interface ResumeFile {
  readonly version: number;
  /** `alfa` | `beta` | `stable` | `dev`: the channels share `userData`, only the one that closed restores. */
  readonly channel: string;
  readonly writtenAt: number;
  readonly tabs: readonly ResumeTab[];
}

export function serializeResumeFile(channel: string, tabs: readonly ResumeTab[], now: number): string {
  const file: ResumeFile = { version: RESUME_FILE_VERSION, channel, writtenAt: now, tabs };
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
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const file = parsed as Record<string, unknown>;
  if (file.version !== RESUME_FILE_VERSION || file.channel !== options.channel) return [];
  if (typeof file.writtenAt !== 'number' || options.now - file.writtenAt > RESUME_MAX_AGE_MS || file.writtenAt - options.now > 60_000) return [];
  if (!Array.isArray(file.tabs)) return [];
  return file.tabs.map(parseResumeTab).filter((tab): tab is ResumeTab => tab !== null);
}
