// B33 — update to the new alpha from inside the app (docs/refinamentos/atualizar-versao.md).
//
// The main reads the installers folder of the daily alpha build, says whether a newer version is there, and on
// the owner's click writes the tabs to reopen, writes a detached helper (PowerShell) and closes. The helper waits
// for the app to exit, runs the NSIS installer silently (`/S`) and opens the app again — the old one when the
// installer fails, with the error waiting in `result.json`. The decisions are pure (src/shared/appUpdate.ts).

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  evaluateUpdate,
  parseResumeFile,
  RESUME_MAX_AGE_MS,
  serializeResumeFile,
  type AppUpdateApplyResult,
  type AppUpdateBoot,
  type AppUpdateStatus,
  type InstallerFile,
  type OwnBuild,
  type ResumeTab,
  type UpdateFolderSnapshot,
} from '../shared/appUpdate';

const POLL_MS = 10 * 60 * 1000;
const LAST_COMMIT_FILE = 'ultimo-commit.txt';
const FAILED_FILE = 'FALHOU.txt';
const BUILD_LOG_FILE = 'build.log';
const INSTALLER_PATTERN = /-Setup-.+\.exe$/i;

const RESUME_FILE = 'resume.json';
const RESULT_FILE = 'result.json';
const HELPER_FILE = 'update-helper.ps1';
const HELPER_LOG_FILE = 'update-helper.log';

/**
 * The helper. Runs hidden and detached; touches only the app's own pid, the installer it started and the app exe.
 * Never kills anything: if the app does not close in time, nothing is installed.
 */
export const UPDATE_HELPER_SCRIPT = [
  '# Donel Dev - troca de versao (B33). Gerado pelo app a cada atualizacao; pode apagar.',
  'param(',
  '  [Parameter(Mandatory = $true)][int]$AppPid,',
  '  [Parameter(Mandatory = $true)][string]$Installer,',
  '  [Parameter(Mandatory = $true)][string]$AppExe,',
  '  [Parameter(Mandatory = $true)][string]$ResultFile,',
  '  [Parameter(Mandatory = $true)][string]$LogFile,',
  '  [int]$ExitTimeoutSec = 120,',
  '  [int]$InstallTimeoutSec = 600,',
  '  [string]$InstallerArgs = "/S"',
  ')',
  '$ErrorActionPreference = "Stop"',
  'function Write-Log([string]$Message) {',
  '  try { Add-Content -LiteralPath $LogFile -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message) -Encoding UTF8 } catch {}',
  '}',
  'function Get-AppProcesses {',
  '  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq $AppExe) })',
  '}',
  'function Open-App {',
  '  if (-not (Test-Path -LiteralPath $AppExe)) { Write-Log "app nao encontrado: $AppExe"; return }',
  '  Start-Sleep -Seconds 2',
  '  if ((Get-AppProcesses).Count -gt 0) { Write-Log "o app ja esta aberto"; return }',
  '  Start-Process -FilePath $AppExe | Out-Null',
  '}',
  'function Stop-WithFailure([string]$Message) {',
  '  Write-Log "falhou: $Message"',
  '  $result = @{ ok = $false; message = $Message; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress',
  '  try { Set-Content -LiteralPath $ResultFile -Value $result -Encoding UTF8 } catch {}',
  '  try { Open-App } catch { Write-Log "nao reabriu: $_" }',
  '  exit 1',
  '}',
  'try {',
  '  Write-Log "esperando o app fechar (pid $AppPid)"',
  '  $app = Get-Process -Id $AppPid -ErrorAction SilentlyContinue',
  '  if ($app -and -not $app.WaitForExit($ExitTimeoutSec * 1000)) { Stop-WithFailure "o app nao fechou a tempo; nada foi instalado" }',
  '  $installDir = Split-Path -Parent $AppExe',
  '  $deadline = (Get-Date).AddSeconds(30)',
  '  while ((Get-Date) -lt $deadline) {',
  '    $left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir + "\\", [StringComparison]::OrdinalIgnoreCase) })',
  '    if ($left.Count -eq 0) { break }',
  '    Start-Sleep -Milliseconds 500',
  '  }',
  '  if (-not (Test-Path -LiteralPath $Installer)) { Stop-WithFailure "instalador nao encontrado: $Installer" }',
  '  Write-Log "rodando o instalador: $Installer $InstallerArgs"',
  '  $setup = Start-Process -FilePath $Installer -ArgumentList $InstallerArgs -WindowStyle Hidden -PassThru',
  '  $null = $setup.Handle',
  '  if (-not $setup.WaitForExit($InstallTimeoutSec * 1000)) {',
  '    try { $setup.Kill() } catch {}',
  '    Stop-WithFailure "o instalador passou de $InstallTimeoutSec s"',
  '  }',
  '  if ($setup.ExitCode -ne 0) { Stop-WithFailure "o instalador terminou com codigo $($setup.ExitCode)" }',
  '  Write-Log "instalado; abrindo a versao nova"',
  '  Open-App',
  '  exit 0',
  '} catch {',
  '  Stop-WithFailure "$_"',
  '}',
  '',
].join('\r\n');

export interface AppUpdateServiceOptions {
  /** The folder of the installers, or `null` when the feature does not apply (not the packaged alpha). */
  readonly installersDir: () => string | null;
  readonly own: OwnBuild;
  /** Where the resume file, the helper and its log live: `userData/app-update/<channel>` (the channels share `userData`). */
  readonly stateDir: string;
  readonly channel: string;
  readonly execPath: string;
  readonly pid: number;
  readonly onChanged: (status: AppUpdateStatus) => void;
  /** Closes the app the normal way (PTYs killed, accounts saved). */
  readonly quit: () => void;
  readonly now?: () => number;
}

export interface AppUpdateService {
  start(): void;
  stop(): void;
  status(): AppUpdateStatus;
  apply(tabs: unknown): AppUpdateApplyResult;
  takeBoot(): AppUpdateBoot;
  buildLogPath(): string | null;
}

/** The alpha installers folder by default: `<home>/<exe name> - diario`, the folder the daily build writes. */
export function defaultInstallersDir(home: string, execPath: string): string {
  return join(home, `${basename(execPath, extname(execPath))} - diario`);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
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

export function readUpdateFolder(dir: string): UpdateFolderSnapshot | null {
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) return null;
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const installers: InstallerFile[] = [];
  for (const name of names) {
    if (!INSTALLER_PATTERN.test(name)) continue;
    const path = join(dir, name);
    const mtimeMs = mtimeOf(path);
    if (mtimeMs !== null) installers.push({ name, path, mtimeMs });
  }
  const lastCommitPath = join(dir, LAST_COMMIT_FILE);
  const failedPath = join(dir, FAILED_FILE);
  return {
    lastCommitText: readText(lastCommitPath),
    lastCommitAtMs: mtimeOf(lastCommitPath),
    installers,
    failedText: readText(failedPath),
    failedAtMs: mtimeOf(failedPath),
  };
}

function isResumeTabList(value: unknown): value is ResumeTab[] {
  return Array.isArray(value) && value.length <= 100;
}

export function createAppUpdateService(options: AppUpdateServiceOptions): AppUpdateService {
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let lastSent = '';
  let applying = false;

  const status = (): AppUpdateStatus => {
    const dir = options.installersDir();
    return evaluateUpdate(options.own, dir ? readUpdateFolder(dir) : null);
  };

  const poll = (): void => {
    const next = status();
    const key = JSON.stringify(next);
    if (key === lastSent) return;
    lastSent = key;
    options.onChanged(next);
  };

  const resumePath = join(options.stateDir, RESUME_FILE);
  const resultPath = join(options.stateDir, RESULT_FILE);

  return {
    start() {
      if (timer || !options.installersDir()) return;
      timer = setInterval(poll, POLL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    status,
    buildLogPath() {
      const dir = options.installersDir();
      return dir ? join(dir, BUILD_LOG_FILE) : null;
    },
    apply(tabs) {
      if (applying) return { ok: false, message: 'A atualização já está em andamento.' };
      const available = status().available;
      if (!available) return { ok: false, message: 'Não há versão nova para instalar.' };
      if (!isResumeTabList(tabs)) return { ok: false, message: 'Não deu para guardar as abas abertas.' };
      try {
        mkdirSync(options.stateDir, { recursive: true });
        // Round trip through the parser: only what will be read back is written.
        const text = serializeResumeFile(options.channel, tabs, now());
        const checked = parseResumeFile(text, { channel: options.channel, now: now() });
        const temp = `${resumePath}.tmp`;
        writeFileSync(temp, serializeResumeFile(options.channel, checked, now()), 'utf8');
        renameSync(temp, resumePath);
        removeQuietly(resultPath);
        const helperPath = join(options.stateDir, HELPER_FILE);
        writeFileSync(helperPath, `﻿${UPDATE_HELPER_SCRIPT}`, 'utf8');
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-WindowStyle',
            'Hidden',
            '-File',
            helperPath,
            '-AppPid',
            String(options.pid),
            '-Installer',
            available.installerPath,
            '-AppExe',
            options.execPath,
            '-ResultFile',
            resultPath,
            '-LogFile',
            join(options.stateDir, HELPER_LOG_FILE),
          ],
          { detached: true, stdio: 'ignore', windowsHide: true },
        );
        if (child.pid === undefined) throw new Error('o ajudante da atualização não abriu');
        child.unref();
      } catch (error) {
        removeQuietly(resumePath);
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      applying = true;
      // Lets the answer reach the renderer before the window goes away.
      setTimeout(options.quit, 400);
      return { ok: true };
    },
    takeBoot() {
      const text = readText(resumePath);
      let tabs: readonly ResumeTab[] = [];
      if (text !== null) {
        tabs = parseResumeFile(text, { channel: options.channel, now: now() });
        // Restored or not (too old, broken), the file is used once: the general restore on boot stays cancelled.
        removeQuietly(resumePath);
      }
      let failure: string | null = null;
      const result = readText(resultPath);
      if (result !== null) {
        try {
          const raw = JSON.parse(result.replace(/^﻿/, '')) as { ok?: unknown; message?: unknown; at?: unknown };
          const fresh = typeof raw.at === 'number' && now() - raw.at <= RESUME_MAX_AGE_MS;
          if (raw.ok === false && fresh) failure = typeof raw.message === 'string' && raw.message ? raw.message : 'erro desconhecido';
        } catch {
          failure = null;
        }
        removeQuietly(resultPath);
      }
      return { tabs, failure };
    },
  };
}
