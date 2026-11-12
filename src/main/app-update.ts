// B33 — update to the new alpha from inside the app (docs/refinamentos/atualizar-versao.md).
//
// The alpha build publishes each version as a GitHub release of the work repo (installer + `latest.yml`).
// electron-updater checks that feed, downloads the new version in the background and, on the owner's click,
// restarts into it: the installer runs silently and the app opens again with the same tabs. The repo is private:
// the token is the one of the `gh` logged in on this PC (`gh auth token`), read at each check and never stored.
// Any PC with `gh` logged into an account that sees the repo updates the same way.

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppUpdater } from 'electron-updater';
import {
  DEFAULT_FORCE_AFTER_MINUTES,
  parseResume,
  resumeArgsFor,
  RESUME_MAX_AGE_MS,
  serializeResumeFile,
  type AppUpdateApplyResult,
  type AppUpdateAvailable,
  type AppUpdateBoot,
  type AppUpdateStatus,
  type ResumeRemote,
  type ResumeTab,
} from '../shared/appUpdate';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 15_000;
const RESUME_FILE = 'resume.json';
const RESULT_FILE = 'result.json';

export interface AppUpdateServiceOptions {
  /** `false` = not the packaged alpha: the feature does not show. */
  readonly enabled: boolean;
  readonly currentVersion: string;
  /** Lazily loaded (electron-updater reads `app-update.yml` on first use). */
  readonly updater: () => AppUpdater;
  /** Where the resume file lives: `userData/app-update/<channel>` (the channels share `userData`). */
  readonly stateDir: string;
  readonly channel: string;
  readonly onChanged: (status: AppUpdateStatus) => void;
  /** Lets the app save what it must before the restart (accounts, sessions). */
  readonly beforeRestart?: () => void;
  readonly now?: () => number;
  /** Sessão durável — the conversation has a transcript on this computer (else it starts again under the same id). */
  readonly transcriptExists?: (sessionId: string, cwd: string | undefined) => boolean;
  /** Minutes "Atualizar" waits for sessions in a turn (`appUpdate.forceAfterMinutes`), read at each status. */
  readonly forceAfterMinutes?: () => number;
  /** The token of the `gh` of this PC (tests pass their own). */
  readonly ghToken?: () => Promise<string | null>;
}

export interface AppUpdateService {
  start(): void;
  stop(): void;
  status(): AppUpdateStatus;
  check(): Promise<void>;
  apply(tabs: unknown, remotes?: unknown): AppUpdateApplyResult;
  takeBoot(): AppUpdateBoot;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

function isResumeTabList(value: unknown): value is ResumeTab[] {
  return Array.isArray(value) && value.length <= 100;
}

function isResumeRemoteList(value: unknown): value is ResumeRemote[] {
  return Array.isArray(value) && value.length <= 100;
}

/** The token of the `gh` logged in on this PC; `null` when there is no `gh` or no login. */
function ghToken(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      const token = String(stdout ?? '').trim();
      resolve(error || token.length === 0 ? null : token);
    });
  });
}

/** Short, owner-facing text for an updater error (never the token, never a stack). */
function failureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/\b(401|403|404)\b|Bad credentials|Not Found/i.test(raw)) return 'o GitHub recusou o acesso às versões (o gh desta máquina enxerga o repositório?)';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::/i.test(raw)) return 'sem conexão com o GitHub agora';
  if (/sha512|checksum/i.test(raw)) return 'o download veio corrompido; tento de novo na próxima verificação';
  return raw.split(/\r?\n/)[0].replace(/(gh[opsu]_|github_pat_)[A-Za-z0-9_]+/g, '***').slice(0, 160);
}

export function createAppUpdateService(options: AppUpdateServiceOptions): AppUpdateService {
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let firstTimer: NodeJS.Timeout | null = null;
  let available: AppUpdateAvailable | null = null;
  let failure: string | null = null;
  let checking = false;
  let applying = false;
  let wired: AppUpdater | null = null;

  const resumePath = join(options.stateDir, RESUME_FILE);
  const resultPath = join(options.stateDir, RESULT_FILE);

  const forceAfterMs = (): number => {
    const minutes = options.forceAfterMinutes?.() ?? DEFAULT_FORCE_AFTER_MINUTES;
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_FORCE_AFTER_MINUTES) * 60_000;
  };
  const status = (): AppUpdateStatus => ({ enabled: options.enabled, currentVersion: options.currentVersion, available, failure, forceAfterMs: forceAfterMs() });
  const emit = (): void => options.onChanged(status());

  const updater = (): AppUpdater => {
    if (wired) return wired;
    const instance = options.updater();
    instance.autoDownload = true;
    instance.autoInstallOnAppQuit = false;
    instance.allowDowngrade = false;
    instance.logger = null;
    instance.on('update-available', (info) => {
      available = { version: info.version, percent: null, ready: false };
      failure = null;
      emit();
    });
    instance.on('update-not-available', () => {
      if (!available?.ready) available = null;
      failure = null;
      emit();
    });
    instance.on('download-progress', (progress) => {
      if (!available || available.ready) return;
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
      if (percent === available.percent) return;
      available = { ...available, percent };
      emit();
    });
    instance.on('update-downloaded', (info) => {
      available = { version: info.version, percent: 100, ready: true };
      failure = null;
      emit();
    });
    instance.on('error', (error) => {
      failure = failureText(error);
      if (available && !available.ready) available = null;
      emit();
    });
    wired = instance;
    return instance;
  };

  const check = async (): Promise<void> => {
    if (!options.enabled || checking || applying || available?.ready) return;
    checking = true;
    try {
      const token = await (options.ghToken ?? ghToken)();
      if (!token) {
        failure = 'entre no GitHub com o gh nesta máquina (gh auth login) para receber versões novas';
        emit();
        return;
      }
      // Private feed: electron-updater reads the token from the env at each request of the GitHub provider.
      process.env.GH_TOKEN = token;
      await updater().checkForUpdates();
    } catch (error) {
      failure = failureText(error);
      emit();
    } finally {
      checking = false;
    }
  };

  return {
    start() {
      if (!options.enabled || timer) return;
      firstTimer = setTimeout(() => void check(), FIRST_CHECK_AFTER_MS);
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
      firstTimer.unref?.();
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      if (firstTimer) clearTimeout(firstTimer);
      timer = null;
      firstTimer = null;
    },
    status,
    check,
    apply(tabs, remotes = []) {
      if (applying) return { ok: false, message: 'A atualização já está em andamento.' };
      if (!available?.ready) return { ok: false, message: 'A versão nova ainda está baixando.' };
      if (!isResumeTabList(tabs) || !isResumeRemoteList(remotes)) return { ok: false, message: 'Não deu para guardar as abas abertas.' };
      try {
        mkdirSync(options.stateDir, { recursive: true });
        // Round trip through the parser: only what will be read back is written.
        const text = serializeResumeFile(options.channel, tabs, now(), remotes);
        const checked = parseResume(text, { channel: options.channel, now: now() });
        const temp = `${resumePath}.tmp`;
        writeFileSync(temp, serializeResumeFile(options.channel, checked.tabs, now(), checked.remotes), 'utf8');
        renameSync(temp, resumePath);
        removeQuietly(resultPath);
      } catch (error) {
        removeQuietly(resumePath);
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      applying = true;
      // Lets the answer reach the renderer before the window goes away. Silent install, then the new version opens.
      setTimeout(() => {
        try {
          options.beforeRestart?.();
          updater().quitAndInstall(true, true);
        } catch (error) {
          applying = false;
          removeQuietly(resumePath);
          failure = failureText(error);
          emit();
        }
      }, 400);
      return { ok: true };
    },
    takeBoot() {
      const text = readText(resumePath);
      let tabs: readonly ResumeTab[] = [];
      let remotes: readonly ResumeRemote[] = [];
      if (text !== null) {
        const parsed = parseResume(text, { channel: options.channel, now: now() });
        remotes = parsed.remotes;
        // Each conversation comes back under its own id: `-r` when it has a transcript, else a new start with that id.
        tabs = parsed.tabs.map((tab) =>
          // A provider's session keeps its transcript in the provider's home: its `-r` stays as it was.
          tab.sessionId && tab.launchArgs && !tab.providerId && options.transcriptExists
            ? { ...tab, launchArgs: resumeArgsFor(tab.launchArgs, tab.sessionId, options.transcriptExists(tab.sessionId, tab.cwd)) }
            : tab,
        );
        // Restored or not (too old, broken), the file is used once: the general restore on boot stays cancelled.
        removeQuietly(resumePath);
      }
      let bootFailure: string | null = null;
      const result = readText(resultPath);
      if (result !== null) {
        try {
          const raw = JSON.parse(result.replace(/^﻿/, '')) as { ok?: unknown; message?: unknown; at?: unknown };
          const fresh = typeof raw.at === 'number' && now() - raw.at <= RESUME_MAX_AGE_MS;
          if (raw.ok === false && fresh) bootFailure = typeof raw.message === 'string' && raw.message ? raw.message : 'erro desconhecido';
        } catch {
          bootFailure = null;
        }
        removeQuietly(resultPath);
      }
      return { tabs, remotes, failure: bootFailure };
    },
  };
}
