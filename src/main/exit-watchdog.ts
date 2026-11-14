// Vigia de saída (13/11) — the main process must end once the main window is gone.
// An instance of the app stayed alive for 7 h with no window, no renderer and no socket (PC of the owner, 13/11):
// the window closed, the single-instance lock was released (the next launch took it), and the process never
// finished exiting. Whatever hangs there is past the JS event loop, so a timer in this process cannot be the net.
// A small detached process waits and then ends this one, only if it is still the same process (same pid AND same
// start time, so a pid reused by another program — or by the next copy of the app — is never touched).

/** The spawn the watchdog needs (node's `child_process.spawn` fits). */
export type WatchdogSpawn = (
  file: string,
  args: readonly string[],
  options: { readonly detached: true; readonly windowsHide: true; readonly stdio: 'ignore' },
) => { unref(): void };

export interface ExitWatchdogOptions {
  readonly pid: number;
  /** When this process started (epoch ms), from `Date.now() - process.uptime() * 1000`. */
  readonly startedAtMs: number;
  /** How long a normal exit may take before the process is ended. */
  readonly graceSeconds: number;
}

/** How far the start time read by Windows may be from ours and still be the same process. */
const SAME_PROCESS_TOLERANCE_SECONDS = 10;

/** The PowerShell line: wait, then end the process tree only when the pid still belongs to this very process. */
export function buildExitWatchdogCommand(options: ExitWatchdogOptions): { file: string; args: string[] } {
  const pid = Math.trunc(options.pid);
  const startedAt = Math.trunc(options.startedAtMs);
  const grace = Math.max(1, Math.trunc(options.graceSeconds));
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('vigia de saída: pid ou início inválido');
  }
  const script = [
    `Start-Sleep -Seconds ${grace}`,
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if (-not $p) { exit 0 }',
    `$expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime`,
    `if ([math]::Abs(($p.StartTime.ToUniversalTime() - $expected).TotalSeconds) -gt ${SAME_PROCESS_TOLERANCE_SECONDS}) { exit 0 }`,
    `taskkill.exe /PID ${pid} /T /F | Out-Null`,
  ].join('; ');
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

/**
 * The watchdog of this process. `arm` arms it once (Windows only) and returns whether it was armed now; it never
 * throws, because failing to arm it must not hold the app's own teardown back. `exitingForUpdate` stands it down for
 * good: on "Atualizar" the electron-updater spawns the installer as a child of the app before `app.quit()`, and the
 * `taskkill /T` of a slow exit would end the installer midway (review of #428).
 */
export function createExitWatchdog(spawn: WatchdogSpawn, platform: NodeJS.Platform = process.platform) {
  let armed = false;
  let forUpdate = false;
  return {
    arm(options: ExitWatchdogOptions): boolean {
      if (armed || forUpdate || platform !== 'win32') return false;
      try {
        const { file, args } = buildExitWatchdogCommand(options);
        spawn(file, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
        armed = true;
        return true;
      } catch {
        return false;
      }
    },
    exitingForUpdate(): void {
      forUpdate = true;
    },
  };
}
