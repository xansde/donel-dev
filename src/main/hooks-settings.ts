import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// T009 — arquivo `--settings` adicional (spike: "soma hooks aos hooks
// globais do usuário sem substituí-los" — validado byte-a-byte que
// ~/.claude/settings.json nunca é tocado). Um único par de arquivos (script
// `.ps1` + `settings.json`), escritos uma vez no boot do app, reaproveitados
// por `--settings <path>` em TODO spawn de sessão claude — não precisam ser
// por-sessão porque a correlação já vem no próprio payload do hook
// (`session_id`, ver session-correlation.ts).
//
// Script `.ps1` GERADO em vez de comando PowerShell inline (`-Command
// "..."`): tentado no smoke real do T009 e o hook NUNCA chegou ao servidor
// (nem erro visível no transcript, nem POST recebido) — o mecanismo com
// `-File "<script>"` é o que o spike T002 validou de ponta a ponta (e o
// addendum T009 reconfirmou com Notification real), então é o único usado
// em produção. O script é regravado a cada boot (porta efêmera muda), então
// não precisa ser um asset versionado — nada pra T016 empacotar.

/**
 * Eventos registrados — matriz do spike (specs/001-mvp/spike-t002-resultado.md)
 * + `StopFailure`: o CLI dispara ele NO LUGAR de `Stop` quando um erro de API
 * (rate limit, overload, auth) encerra o turno. Sem ele a sessão ficava
 * `working` para sempre e o auto-switch de contas adiava indefinidamente —
 * justo quando a conta estourou (bateria da Fase 2 das contas, 21/09).
 */
export const SEMAPHORE_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification', 'SessionEnd'] as const;

const SETTINGS_FILE_NAME = 'session-hooks-settings.json';
const FORWARDER_SCRIPT_FILE_NAME = 'session-hook-forward.ps1';

/** Puro — conteúdo do script PowerShell que os hooks chamam: lê stdin, faz POST pro endpoint local, nunca lança (mesma garantia do `hook-forward.ps1` do spike T002). */
export function buildHookForwarderScript(port: number): string {
  const endpoint = `http://127.0.0.1:${port}/hook`;
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$in = [Console]::In.ReadToEnd()',
    'try {',
    `  Invoke-RestMethod -Uri "${endpoint}" -Method Post -Body $in -ContentType "application/json" -TimeoutSec 2 | Out-Null`,
    '} catch {}',
    'exit 0',
    '',
  ].join('\r\n');
}

export interface HooksSettingsContent {
  readonly hooks: Record<(typeof SEMAPHORE_HOOK_EVENTS)[number], readonly [{ readonly hooks: readonly [{ readonly type: 'command'; readonly command: string }] }]>;
}

/** Puro — dado o path do script forwarder já gravado em disco, monta o conteúdo do `--settings`. */
export function buildHooksSettingsContent(forwarderScriptPath: string): HooksSettingsContent {
  const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${forwarderScriptPath}"`;
  const entry = [{ hooks: [{ type: 'command' as const, command }] }] as const;

  const hooks = Object.fromEntries(SEMAPHORE_HOOK_EVENTS.map((event) => [event, entry])) as HooksSettingsContent['hooks'];

  return { hooks };
}

/** I/O — grava o script forwarder + o `--settings` em `userDataDir`, devolve o path do `--settings`. `writeFileSyncFn` injetável pra testar sem tocar disco. */
export function writeHooksSettingsFile(userDataDir: string, port: number, writeFileSyncFn: typeof writeFileSync = writeFileSync): string {
  const scriptPath = join(userDataDir, FORWARDER_SCRIPT_FILE_NAME);
  writeFileSyncFn(scriptPath, buildHookForwarderScript(port), 'utf8');

  const settingsPath = join(userDataDir, SETTINGS_FILE_NAME);
  writeFileSyncFn(settingsPath, JSON.stringify(buildHooksSettingsContent(scriptPath), null, 2), 'utf8');

  return settingsPath;
}

// --- 014 (T011): per-session settings for the HTTP hook bridge ---
// contracts/hook-bridge.md §1–§2. The legacy single-file path above stays
// available (DONEL_HOOKS_TRANSPORT=legacy, T014).

const HOOK_SETTINGS_DIR_NAME = 'hook-settings';
const STALE_HOOK_SETTINGS_MS = 24 * 60 * 60 * 1000;

/** Events delivered as `http` hooks, with their `timeout` in seconds. `PermissionRequest` is gated by `chatEnabled`. */
export const BRIDGE_HTTP_EVENTS: ReadonlyArray<{ readonly event: string; readonly timeout: number; readonly chatOnly: boolean }> = [
  { event: 'PermissionRequest', timeout: 86400, chatOnly: true },
  { event: 'PreToolUse', timeout: 10, chatOnly: false },
  { event: 'PostToolUse', timeout: 10, chatOnly: false },
  { event: 'UserPromptSubmit', timeout: 10, chatOnly: false },
  { event: 'Stop', timeout: 10, chatOnly: false },
  { event: 'StopFailure', timeout: 10, chatOnly: false },
  { event: 'Notification', timeout: 10, chatOnly: false },
  { event: 'SubagentStart', timeout: 10, chatOnly: false },
  { event: 'SubagentStop', timeout: 10, chatOnly: false },
  { event: 'SessionEnd', timeout: 2, chatOnly: false },
];

export interface SessionHooksSettingsInput {
  readonly port: number;
  readonly token: string;
  readonly chatEnabled: boolean;
  /** Path (or bare name) of `curl.exe`; `null` when the boot did not find it — falls back to the PowerShell forwarder. */
  readonly curlPath: string | null;
  /** Required when `curlPath` is null: the `.ps1` written by `writeSessionHooksSettings`. */
  readonly forwarderScriptPath?: string;
}

export interface SessionHooksSettingsContent {
  readonly hooks: Record<string, ReadonlyArray<{ readonly hooks: ReadonlyArray<Record<string, unknown>> }>>;
}

function bridgeUrl(port: number, event: string): string {
  return `http://127.0.0.1:${port}/h/${event}`;
}

/** Pure — the per-session `--settings` content. No `matcher` anywhere: every tool is observed. */
export function buildSessionHooksSettings(input: SessionHooksSettingsInput): SessionHooksSettingsContent {
  const { port, token, chatEnabled, curlPath, forwarderScriptPath } = input;
  const hooks: Record<string, ReadonlyArray<{ hooks: ReadonlyArray<Record<string, unknown>> }>> = {};

  for (const { event, timeout, chatOnly } of BRIDGE_HTTP_EVENTS) {
    if (chatOnly && !chatEnabled) continue;
    hooks[event] = [{ hooks: [{ type: 'http', url: bridgeUrl(port, event), headers: { 'X-Donel-Token': token }, timeout }] }];
  }

  // `http` is not honored for SessionStart — it goes through a command that reads stdin as bytes.
  let command: string;
  if (curlPath !== null) {
    const exe = /\s/.test(curlPath) ? `"${curlPath}"` : curlPath;
    command = `${exe} -s --data-binary @- -H "X-Donel-Token: ${token}" ${bridgeUrl(port, 'SessionStart')}`;
  } else {
    command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${forwarderScriptPath ?? ''}"`;
  }
  hooks.SessionStart = [{ hooks: [{ type: 'command', command, timeout: 10 }] }];

  return { hooks };
}

/** Pure — PowerShell fallback for SessionStart: reads stdin and posts the raw bytes (no text decoding, so accents in paths survive). */
export function buildByteSafeForwarderScript(input: { port: number; token: string }): string {
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$stdin = [Console]::OpenStandardInput()',
    '$ms = New-Object System.IO.MemoryStream',
    '$stdin.CopyTo($ms)',
    'try {',
    '  $wc = New-Object System.Net.WebClient',
    `  $wc.Headers.Add("X-Donel-Token", "${input.token}")`,
    '  $wc.Headers.Add("Content-Type", "application/json")',
    `  $wc.UploadData("${bridgeUrl(input.port, 'SessionStart')}", "POST", $ms.ToArray()) | Out-Null`,
    '} catch {}',
    'exit 0',
    '',
  ].join('\r\n');
}

export function sessionHookSettingsPath(userDataDir: string, ptyId: string): string {
  return join(userDataDir, HOOK_SETTINGS_DIR_NAME, `${ptyId}.json`);
}

function sessionForwarderScriptPath(userDataDir: string, ptyId: string): string {
  return join(userDataDir, HOOK_SETTINGS_DIR_NAME, `${ptyId}.forward.ps1`);
}

/** I/O — writes `userData/hook-settings/<ptyId>.json` (plus the forwarder script when there is no curl) and returns the settings path. */
export function writeSessionHooksSettings(input: SessionHooksSettingsInput & { readonly userDataDir: string; readonly ptyId: string }): string {
  const { userDataDir, ptyId, port, token } = input;
  mkdirSync(join(userDataDir, HOOK_SETTINGS_DIR_NAME), { recursive: true });

  let forwarderScriptPath = input.forwarderScriptPath;
  if (input.curlPath === null) {
    forwarderScriptPath = sessionForwarderScriptPath(userDataDir, ptyId);
    writeFileSync(forwarderScriptPath, buildByteSafeForwarderScript({ port, token }), 'utf8');
  }

  const path = sessionHookSettingsPath(userDataDir, ptyId);
  writeFileSync(path, JSON.stringify(buildSessionHooksSettings({ ...input, forwarderScriptPath }), null, 2), 'utf8');
  return path;
}

/** I/O — removes the session's settings file and forwarder script; missing files are fine. */
export function removeSessionHooksSettings(userDataDir: string, ptyId: string): void {
  for (const path of [sessionHookSettingsPath(userDataDir, ptyId), sessionForwarderScriptPath(userDataDir, ptyId)]) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }
}

/** I/O — boot cleanup: deletes files in `hook-settings/` untouched for more than one day. */
export function cleanupStaleHookSettings(userDataDir: string, now: number = Date.now()): void {
  const dir = join(userDataDir, HOOK_SETTINGS_DIR_NAME);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > STALE_HOOK_SETTINGS_MS) unlinkSync(path);
    } catch {
      // best effort
    }
  }
}
