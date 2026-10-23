// 016-jobu-faxina (T008) - the one door to git for the sweep. `execFile` (never a shell: a branch name is an
// argument, not text to be parsed), promisified, with a timeout, no console window and no prompt for credentials.
// It never throws: a failure to start git is `code: -1`, so a caller reads one shape whatever happened.

import { execFile } from 'node:child_process';

export interface GitResult {
  /** The exit code; -1 when git could not be started or was killed by the timeout. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunOptions {
  readonly timeoutMs?: number;
}

/** Runs `git <args>` inside `cwd`. Injected everywhere, so the inventory is tested against real temporary repos or a fake. */
export type GitRun = (cwd: string, args: readonly string[], options?: GitRunOptions) => Promise<GitResult>;

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;

export function createGitRunner(): GitRun {
  return (cwd, args, options) =>
    new Promise<GitResult>((resolve) => {
      execFile(
        'git',
        // `quotepath=false`: names with accents come out as they are, not as "\303\241".
        ['-c', 'core.quotepath=false', ...args],
        {
          cwd,
          windowsHide: true,
          maxBuffer: MAX_BUFFER,
          timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/** The first non-empty line of a git message, trimmed: enough to say why something failed without dumping a page. */
export function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}
