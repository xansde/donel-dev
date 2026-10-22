// T050 (015-jobu-pet, US5, R10/FR-007) - the watcher of apps in full screen, with no dependency of its own: a
// PowerShell that lives as long as the pet does, asks `SHQueryUserNotificationState` (shell32) every 1.5 s and
// prints the state, one number per line. `src/shared/pet/fullscreenState.ts` reads what it prints (2, 3 and 4
// hide the Jobu); this file starts the process, keeps it alive and turns what it says into `onChange(active)`.
//
// Rules that hold whatever the helper does:
//  - only CHANGES are reported (the screen starts out free);
//  - a helper that dies, or never starts, counts as "free": a watcher that does not know must never leave the
//    Jobu hidden, so the owner is never left without him because PowerShell was killed;
//  - it comes back with a growing wait (1 s, 2 s, ... 60 s), and a process that lived long enough to count as
//    working makes the wait start over;
//  - stopping it kills the process and silences it for good;
//  - the script ends by itself when nobody reads the pipe any more, so a parent that was killed hard does not
//    leave a PowerShell polling forever.
//
// Everything that touches the system (the process, the timers, the clock) comes in through `FullscreenWatcherDeps`,
// so the whole of it is tested with fakes (tests/pet-fullscreen-watcher.test.ts).

import { spawn as nodeSpawn } from 'node:child_process';
import { createFullscreenParser } from '../../shared/pet/fullscreenState';

/** How often the helper asks Windows. */
export const FULLSCREEN_POLL_MS = 1_500;
/** The first wait before the helper is started again, and the one every good run goes back to. */
export const FULLSCREEN_RESTART_MIN_MS = 1_000;
/** The wait doubles at each early death up to this. */
export const FULLSCREEN_RESTART_MAX_MS = 60_000;
/** A process that lived this long counts as working: its death does not make the next wait longer. */
export const FULLSCREEN_STABLE_MS = 30_000;

/**
 * The helper, in PowerShell 5.1. `Add-Type` declares the P/Invoke of `SHQueryUserNotificationState`; the loop prints
 * the state (a failed call is -1) and sleeps. A line that cannot be written means nobody is reading: it exits.
 */
export const FULLSCREEN_HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System.Runtime.InteropServices;',
  'public static class DonelShell {',
  '  [DllImport("shell32.dll")]',
  '  public static extern int SHQueryUserNotificationState(out int state);',
  '}',
  "'@",
  '$out = [Console]::Out',
  'while ($true) {',
  '  $state = -1',
  '  try {',
  '    $value = 0',
  '    if ([DonelShell]::SHQueryUserNotificationState([ref]$value) -eq 0) { $state = $value }',
  '  } catch { $state = -1 }',
  '  try { $out.WriteLine($state); $out.Flush() } catch { exit }',
  `  Start-Sleep -Milliseconds ${FULLSCREEN_POLL_MS}`,
  '}',
].join('\n');

/** `-EncodedCommand` takes the script as base64 of UTF-16LE: no quoting to get wrong. */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The slice of a child process the watcher uses. */
export interface WatcherChild {
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'exit' | 'error', listener: () => void): unknown;
  kill(): unknown;
}

export interface FullscreenWatcherDeps {
  /** `true` = an app has the whole screen, `false` = it is free. Only when the answer changes. */
  readonly onChange: (active: boolean) => void;
  readonly spawn?: (command: string, args: readonly string[]) => WatcherChild;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly now?: () => number;
  readonly log?: (message: string, error?: unknown) => void;
}

export interface FullscreenWatcher {
  stop(): void;
}

function defaultSpawn(command: string, args: readonly string[]): WatcherChild {
  // No window, nothing written to stdin or stderr: only stdout is read.
  return nodeSpawn(command, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

export function createFullscreenWatcher(deps: FullscreenWatcherDeps): FullscreenWatcher {
  const spawn = deps.spawn ?? defaultSpawn;
  const later = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((message, error) => console.error(`[donel-dev] ${message}`, error ?? ''));
  const command = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(FULLSCREEN_HELPER_SCRIPT)] as const;

  let stopped = false;
  let child: WatcherChild | null = null;
  let restartTimer: unknown = null;
  let wait = FULLSCREEN_RESTART_MIN_MS;
  /** What was last reported: the screen starts out free. */
  let reported = false;

  const report = (active: boolean): void => {
    if (active === reported) return;
    reported = active;
    deps.onChange(active);
  };

  const scheduleRestart = (): void => {
    if (stopped) return;
    restartTimer = later(() => {
      restartTimer = null;
      start();
    }, wait);
    wait = Math.min(wait * 2, FULLSCREEN_RESTART_MAX_MS);
  };

  function start(): void {
    if (stopped) return;
    let spawned: WatcherChild;
    try {
      spawned = spawn('powershell.exe', command);
    } catch (error) {
      log('o vigia de tela cheia do Jobu não iniciou (o Jobu segue visível):', error);
      report(false);
      scheduleRestart();
      return;
    }
    child = spawned;
    const startedAt = now();
    const parser = createFullscreenParser();
    spawned.stdout?.on('data', (chunk) => {
      if (child !== spawned) return; // a process that was already replaced says nothing
      for (const active of parser.push(chunk)) report(active);
    });
    const ended = (): void => {
      if (child !== spawned) return; // `error` and `exit` can both come: the first one ends it
      child = null;
      if (now() - startedAt >= FULLSCREEN_STABLE_MS) wait = FULLSCREEN_RESTART_MIN_MS;
      report(false);
      scheduleRestart();
    };
    spawned.on('exit', ended);
    spawned.on('error', ended);
  }

  start();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (restartTimer !== null) {
        cancel(restartTimer);
        restartTimer = null;
      }
      const running = child;
      child = null;
      try {
        running?.kill();
      } catch {
        // The process is already gone: there is nothing left to stop.
      }
    },
  };
}
