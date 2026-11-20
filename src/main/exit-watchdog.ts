// Vigia de saída (13/11) — the main process must end once the main window is gone.
// An instance of the app stayed alive for 7 h with no window, no renderer and no socket (PC of the owner, 13/11):
// the window closed, the single-instance lock was released (the next launch took it), and the process never
// finished exiting. Whatever hangs there is past the JS event loop, so a timer in this process cannot be the net.
// A small process outside the app's tree waits and then ends this one, only if it is still the same process (same pid
// AND same start time, so a pid reused by another program — or by the next copy of the app — is never touched).
// It is not spawned `detached` (t-f2dcadf5): a detached PowerShell 5.1 with no console and ignored stdio exits 0
// without running anything, so the watchdog never ran. Like the exit sentinel, a hop that leaves at once starts it
// with Start-Process: it is no descendant of the app, so ending the app's tree does not end it before the app.

/** The spawn the watchdog needs (node's `child_process.spawn` fits). */
export type WatchdogSpawn = (
  file: string,
  args: readonly string[],
  options: { readonly windowsHide: true; readonly stdio: 'ignore' },
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

/** How long the process list may take; past it the app alone is ended. */
const PROCESS_LIST_TIMEOUT_SECONDS = 15;

/**
 * The editors the app opens ("Abrir no editor", or `code .` in a terminal of the app). One opened while it was not
 * running yet is a child of the app; ending the app's whole tree (`taskkill /T`) took it with unsaved files (review
 * of #466, t-6b1fc5e0). Each one survives with its own subtree.
 */
const SPARED_IMAGE_NAME = '^(code|code - insiders|cursor)\\.exe$';

/**
 * PowerShell: from `$all` (ProcessId, ParentProcessId, Name, CreationDate of every process), `$root` and `$rootStart`,
 * `$kill` = the descendants of `$root` to end, without each spared editor and what hangs under it. Windows keeps a
 * child's ParentProcessId after its parent dies, so a program whose dead parent's pid was reused by the app's tree
 * would look like the app's: a child only counts when it was born after its parent (review of #554). A process
 * without a birth time is left alone. A pid seen twice (one that names itself as parent, a cycle) is walked once.
 */
export const DESCENDANTS_TO_END_SCRIPT = [
  '$kids = @{}; $born = @{}',
  'foreach ($x in $all) { $pp = [int]$x.ParentProcessId; if (-not $kids.ContainsKey($pp)) { $kids[$pp] = @() }; $kids[$pp] += ,$x; $born[[int]$x.ProcessId] = $x.CreationDate }',
  '$born[[int]$root] = $rootStart',
  '$kill = @(); $seen = @{}; $seen[[int]$root] = $true; $todo = @([int]$root)',
  'while ($todo.Count -gt 0) { $c = $todo[0]; $todo = @($todo | Select-Object -Skip 1); ' +
    'foreach ($k in @($kids[$c])) { if ($null -eq $k) { continue }; $id = [int]$k.ProcessId; ' +
    'if ($seen.ContainsKey($id)) { continue }; $seen[$id] = $true; ' +
    'if ($null -eq $k.CreationDate -or $null -eq $born[$c] -or $k.CreationDate -lt $born[$c]) { continue }; ' +
    `if ([string]$k.Name -match '${SPARED_IMAGE_NAME}') { continue }; $kill += $id; $todo += $id } }`,
].join('; ');

function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * The PowerShell line: wait, then, only when the pid still belongs to this very process, end it and its tree, except
 * an editor it opened. Without the process list (no CIM) only the app itself is ended.
 */
export function buildExitWatchdogCommand(options: ExitWatchdogOptions): { file: string; args: string[] } {
  const pid = Math.trunc(options.pid);
  const startedAt = Math.trunc(options.startedAtMs);
  const grace = Math.max(1, Math.trunc(options.graceSeconds));
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('vigia de saída: pid ou início inválido');
  }
  const inner = [
    `Start-Sleep -Seconds ${grace}`,
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if (-not $p) { exit 0 }',
    `$expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime`,
    `if ([math]::Abs(($p.StartTime.ToUniversalTime() - $expected).TotalSeconds) -gt ${SAME_PROCESS_TOLERANCE_SECONDS}) { exit 0 }`,
    `$root = ${pid}; $rootStart = $p.StartTime`,
    // bounded: a stuck WMI must not keep the hung app alive (without the list only the app is ended)
    `$all = @(Get-CimInstance Win32_Process -OperationTimeoutSec ${PROCESS_LIST_TIMEOUT_SECONDS} -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId, Name, CreationDate)`,
    DESCENDANTS_TO_END_SCRIPT,
    // the app first, so it starts nothing new; then what it left, never an editor
    'Stop-Process -Id $root -Force -ErrorAction SilentlyContinue',
    'if ($kill.Count -gt 0) { Stop-Process -Id $kill -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  const hop =
    "Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive'," +
    `'-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`;
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(hop)],
  };
}

/**
 * The watchdog of this process. `arm` arms it once (Windows only) and returns whether it was armed now; it never
 * throws, because failing to arm it must not hold the app's own teardown back. `exitingForUpdate` stands it down for
 * good: on "Atualizar" the electron-updater spawns the installer as a child of the app before `app.quit()`, and ending
 * the app's tree on a slow exit would end the installer midway (review of #428).
 */
export function createExitWatchdog(spawn: WatchdogSpawn, platform: NodeJS.Platform = process.platform) {
  let armed = false;
  let forUpdate = false;
  return {
    arm(options: ExitWatchdogOptions): boolean {
      if (armed || forUpdate || platform !== 'win32') return false;
      try {
        const { file, args } = buildExitWatchdogCommand(options);
        spawn(file, args, { windowsHide: true, stdio: 'ignore' }).unref();
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
