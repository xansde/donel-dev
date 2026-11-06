import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserStatusLine } from './cli-user-settings';
import type { RoleScopeSettings } from '../shared/role-scope';
import { AGENT_BOT_SERVERS, isAgentBotServerName } from '../shared/ledger/slack-guard';

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

/**
 * Events delivered as `http` hooks, with their `timeout` in seconds. `PermissionRequest` goes in even with the chat
 * off: the settings of a live session are fixed at spawn, and Modo YOLO must reach it. With nobody to answer, the
 * bridge says `{}` at once and the terminal asks as usual. `PermissionDenied` counts the auto mode classifier's blocks
 * (`autoApprovalVerdict`).
 */
export const BRIDGE_HTTP_EVENTS: ReadonlyArray<{ readonly event: string; readonly timeout: number }> = [
  { event: 'PermissionRequest', timeout: 86400 },
  { event: 'PermissionDenied', timeout: 10 },
  { event: 'PreToolUse', timeout: 10 },
  { event: 'PostToolUse', timeout: 10 },
  // t-45e87762 — a call that ended in error gives no `PostToolUse`; the semaphore counts running calls by both.
  { event: 'PostToolUseFailure', timeout: 10 },
  { event: 'UserPromptSubmit', timeout: 10 },
  { event: 'Stop', timeout: 10 },
  { event: 'StopFailure', timeout: 10 },
  { event: 'Notification', timeout: 10 },
  { event: 'SubagentStart', timeout: 10 },
  { event: 'SubagentStop', timeout: 10 },
  { event: 'SessionEnd', timeout: 2 },
];

export interface SessionHooksSettingsInput {
  readonly port: number;
  readonly token: string;
  /** Path (or bare name) of `curl.exe`; `null` when the boot did not find it — falls back to the PowerShell forwarder. */
  readonly curlPath: string | null;
  /** Required when `curlPath` is null: the `.ps1` written by `writeSessionHooksSettings`. */
  readonly forwarderScriptPath?: string;
  /** Ponte da statusline: what to inject (see `planStatusLineBridge`). Absent = no `statusLine` key at all. */
  readonly statusLine?: StatusLineBridgePlan | null;
  /** The `.ps1` the statusLine command runs (tee or silent forwarder); written by `writeSessionHooksSettings`. */
  readonly statusLineScriptPath?: string;
  /**
   * "Isolar em worktree": the tab runs `claude --worktree`. Then the file also carries `worktree.baseRef: "head"`,
   * so the worktree starts from the CURRENT branch of the project folder instead of the remote's default branch
   * (CLI 2.1.314 default `"fresh"` = `origin/HEAD`, which here is `main`, the beta). Measured with the real CLI on
   * 30/10: through this same `--settings` file the worktree is born at the local HEAD; without it, at `origin/HEAD`.
   * Only this session's file: the owner's `~/.claude/settings.json` is never touched.
   */
  readonly isolatedWorktree?: boolean;
  /**
   * Slack só com carta, fatia 4 — the command that runs `buildSlackOfflineGuardScript` (a remote session: it
   * outlives the app). Absent = only the `http` hook, whose bridge lives and dies with a local session.
   */
  readonly slackOfflineGuardCommand?: string;
  /** Escopo do papel: the MCPs, plugins and skills this session keeps (role-scope.ts). Absent = everything. */
  readonly roleScope?: RoleScopeSettings | null;
}

export interface SessionHooksSettingsContent extends RoleScopeSettings {
  readonly hooks: Record<string, ReadonlyArray<{ readonly matcher?: string; readonly hooks: ReadonlyArray<Record<string, unknown>> }>>;
  readonly statusLine?: StatusLineSetting;
  readonly worktree?: { readonly baseRef: 'head' };
}

function bridgeUrl(port: number, event: string): string {
  return `http://127.0.0.1:${port}/h/${event}`;
}

/** Pure — the per-session `--settings` content. No `matcher` anywhere: every tool is observed. */
export function buildSessionHooksSettings(input: SessionHooksSettingsInput): SessionHooksSettingsContent {
  const { port, token, curlPath, forwarderScriptPath } = input;
  const hooks: Record<string, ReadonlyArray<{ matcher?: string; hooks: ReadonlyArray<Record<string, unknown>> }>> = {};

  for (const { event, timeout } of BRIDGE_HTTP_EVENTS) {
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
  if (input.slackOfflineGuardCommand) {
    hooks.PreToolUse = [...hooks.PreToolUse!, { matcher: SLACK_OFFLINE_GUARD_MATCHER, hooks: [{ type: 'command', command: input.slackOfflineGuardCommand, timeout: 10 }] }];
  }

  const statusLine = input.statusLine ? buildStatusLineSetting(input.statusLine, input) : null;
  return {
    hooks,
    ...(statusLine ? { statusLine } : {}),
    ...(input.isolatedWorktree ? { worktree: { baseRef: 'head' as const } } : {}),
    ...(input.roleScope ?? {}),
  };
}

// --- Slack só com carta, fatia 4: falha fechada --------------------------------
//
// A post to Slack is decided by the bridge (`preToolUseGuard`, answering the `http` PreToolUse hook). But an
// `http` hook that gets no answer does NOT block: with the app down, the post would go out unchecked. A local
// session dies with the app (its PTY is the app's child); a remote one lives on in tmux. So the remote session
// also gets this command hook: it asks the bridge `/h/Ping` (app up AND this token known); if yes, it says
// nothing and the bridge decides as usual; if not, and the call looks like a post to Slack, it REFUSES. The
// offline test is deliberately broad (it refuses a Slack draft, or any call to the Slack Web API, even a read,
// while the app is down): the owner's rule is
// "a carta antes de qualquer coisa", so what cannot be checked does not go out.

export const SLACK_OFFLINE_GUARD_MATCHER = 'Bash|mcp__.*';

/** A line of the offline guard script that says this app checks a letter with a file (`SlackLetter.file`). */
export const SLACK_GUARD_FILE_LETTER_MARK = 'carta-com-arquivo: esta trava confere carta com arquivo';

/** ERE over the hook payload (tool name + input), case-insensitive: anything that may post to Slack. */
export const SLACK_OFFLINE_PATTERN =
  'mcp__[^"]*slack[^"]*__[^"]*(send|post|repl|schedul|updat|edit|upload|file|share|enviar|mandar|postar|publicar|respond|agendar|editar|atualizar|subir|compartilh|anexar)|slack_[a-z_]*(send|post|repl|schedul|updat|edit|upload|file|share|enviar|mandar|postar|publicar|respond|agendar|editar|atualizar|subir|compartilh|anexar)|chat[._](postMessage|post_message|update|scheduleMessage|postEphemeral|meMessage)|files[._](upload|completeUpload|complete_upload|share)|slack\\.com/api/|hooks\\.slack\\.com|canal-produto';

export const SLACK_OFFLINE_REFUSAL =
  'Envio ao Slack bloqueado pelo Donel Dev: o app do Donel está fora do ar (ou não reconhece esta sessão), então não dá para confirmar a carta no Oráculo Harrow. Toda mensagem ao Slack em nome do dono precisa antes de uma carta aceita, e o que não se confirma não sai. Não tente outro caminho de envio. Diga ao dono que a mensagem está esperando o Donel voltar; quando ele voltar, crie a carta com carta_slack e espere a decisão.';

/**
 * The `sh` lines that let a call by one of the agents' own bots (`slackAgentBots`) through the offline guard: their
 * posts need no letter. They read ONLY the top-level `tool_name` of the hook payload, with a real JSON parser
 * (`node`, else `python3`): a text match over the payload would also find a `"tool_name"` planted inside the
 * call's input. With no parser on the machine (or a payload it cannot read) nothing passes here: the guard stays
 * closed. `[]` = no bot listed (the default).
 */
export function agentBotOfflineLines(servers: readonly string[]): string[] {
  const names = servers.filter(isAgentBotServerName);
  if (names.length === 0) return [];
  // Plain names ([A-Za-z0-9_-]): safe inside the regex and inside the single-quoted `sh` strings.
  const re = `^mcp__(${names.join('|')})__`;
  const node = `let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const v=JSON.parse(s);if(v&&typeof v==="object"&&!Array.isArray(v)&&typeof v.tool_name==="string"&&/${re}/i.test(v.tool_name))process.stdout.write("bot")}catch(e){}})`;
  const python = [
    'import sys, json, re',
    'try:',
    '    v = json.loads(sys.stdin.read())',
    'except Exception:',
    '    sys.exit(0)',
    't = v.get("tool_name") if isinstance(v, dict) else None',
    `if isinstance(t, str) and re.match(r"${re}", t, re.I):`,
    '    sys.stdout.write("bot")',
  ].join('\n');
  return [
    '# O bot do próprio agente não fala em nome do dono: passa sem carta. Só o tool_name do topo do JSON decide;',
    '# sem node nem python3 para ler o JSON, nada passa por aqui (a trava fica fechada).',
    "bot=''",
    'if command -v node >/dev/null 2>&1; then',
    `  bot=$(printf '%s' "$payload" | node -e '${node}' 2>/dev/null)`,
    'elif command -v python3 >/dev/null 2>&1; then',
    `  bot=$(printf '%s' "$payload" | python3 -I -c '${python}' 2>/dev/null)`,
    'fi',
    'if [ "$bot" = bot ]; then',
    '  exit 0',
    'fi',
  ];
}

/** Pure — the POSIX `sh` script of the offline guard (stdin: the hook payload; stdout: a deny, or nothing). */
export function buildSlackOfflineGuardScript(input: { readonly port: number; readonly token: string; readonly agentBotServers?: readonly string[] }): string {
  const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: SLACK_OFFLINE_REFUSAL } });
  return [
    '#!/bin/sh',
    '# Donel Dev — Slack só com carta: com o app fora do ar, envio ao Slack é recusado (falha fechada).',
    // Read by the Theo West MCP (VPS): only an app that checks a letter with a file offers the file upload.
    `# ${SLACK_GUARD_FILE_LETTER_MARK}`,
    'payload=$(cat)',
    `if curl -s -f --noproxy 127.0.0.1 --connect-timeout 2 --max-time 4 -o /dev/null -X POST -H "X-Donel-Token: ${input.token}" ${bridgeUrl(input.port, 'Ping')} 2>/dev/null; then`,
    '  exit 0',
    'fi',
    ...agentBotOfflineLines(input.agentBotServers ?? AGENT_BOT_SERVERS),
    `if printf '%s' "$payload" | grep -Eqi '${SLACK_OFFLINE_PATTERN}'; then`,
    "  cat <<'DONEL_DENY'",
    deny,
    'DONEL_DENY',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

// --- Ponte da statusline ------------------------------------------------------
//
// O CLI roda o comando de `statusLine` com o JSON da sessão no stdin (cota de
// 5h/7d, custo, janela de contexto, modelo, PR...) e mostra o que ele imprime.
// O app injeta um `statusLine` no MESMO `--settings` da sessão para receber
// esse JSON na ponte (`/h/StatusLine`, hook-bridge.ts). Fatos que moldam isto
// (CLI 2.1.314, conferidos no binário e na prática em 2026-10-30):
//
// 1. O `--settings` é a camada "flag", acima de user/project/local: a nossa
//    `statusLine` ESCONDE a do usuário. Por isso, quando ele tem uma, a nossa
//    ENCADEIA: `<tee> | <comando dele>` — o tee devolve o mesmo stdin ao
//    comando original (que roda no MESMO shell em que rodaria, com a mesma
//    saída e o mesmo código de saída) e posta uma cópia na ponte.
// 2. Com QUALQUER `statusLine` configurada, o CLI some com as dicas do rodapé
//    ("esc to interrupt", "? for shortcuts") — mesmo quando ela não imprime
//    nada (e uma que não imprime nada não deixa linha em branco: o rodapé fica
//    só com o modo de permissão). O chat NÃO depende dessas dicas: prova o
//    turno pela linha do spinner acima da caixa (`shared/chat/screen.ts`,
//    `isWorking`), que fica nos dois modos — medido no CLI real em 30/10. Por
//    isso a ponte é injetada sempre (chat ligado ou não);
//    `DONEL_STATUSLINE_BRIDGE=off` desliga tudo, e `always` vale o mesmo que
//    o padrão (ficou por compatibilidade).
// 3. No Windows o comando roda no Git Bash quando ele existe, senão no
//    PowerShell (o mesmo executor dos hooks de comando, sem campo `shell`). O
//    comando gerado vale nos dois: `powershell ... -File "<ps1>"`, `curl` e o
//    pipe. Comando do usuário com `&&`, `||`, `;`, `&` ou quebra de linha fora
//    de aspas não é encadeável com segurança — aí a sessão fica SEM a ponte e
//    a statusline dele intacta.
// 4. O CLI cancela a execução em voo quando vem outra atualização, e uma
//    statusline lenta atrasa a tela: o POST tem timeout curto e falha calado.

export interface StatusLineSetting {
  readonly type: 'command';
  readonly command: string;
  readonly padding?: number;
  readonly refreshInterval?: number;
  readonly hideVimModeIndicator?: boolean;
}

/** O que a sessão recebe: encadear a statusline do usuário ou só encaminhar (sem saída). */
export type StatusLineBridgePlan = { readonly kind: 'chain'; readonly user: UserStatusLine } | { readonly kind: 'forward' };

export type StatusLineBridgeMode = 'auto' | 'always' | 'off';

/** `DONEL_STATUSLINE_BRIDGE` → modo; qualquer outro valor é `auto`. */
export function statusLineBridgeMode(raw: string | undefined): StatusLineBridgeMode {
  return raw === 'always' || raw === 'off' ? raw : 'auto';
}

/**
 * Puro — decide a ponte da sessão. `null` = não injetar nada (a statusline do
 * usuário, se houver, segue exatamente como era).
 */
export function planStatusLineBridge(input: {
  readonly mode: StatusLineBridgeMode;
  readonly userStatusLine: UserStatusLine | null;
  /** Não muda mais a decisão: o chat não lê as dicas do rodapé que a statusline esconde (fato 2 acima). */
  readonly chatEnabled?: boolean;
}): StatusLineBridgePlan | null {
  if (input.mode === 'off') return null;
  if (input.userStatusLine) {
    return isChainableStatusLineCommand(input.userStatusLine.command) ? { kind: 'chain', user: input.userStatusLine } : null;
  }
  return { kind: 'forward' };
}

/**
 * Puro — o comando do usuário pode ir à direita de um pipe sem mudar de
 * sentido (em bash e em PowerShell)? Recusa, fora de aspas: `;`, `&` (e
 * `&&`), `||`, quebra de linha. `|` simples passa: `tee | a | b` continua
 * entregando o stdin a `a`. Na dúvida, recusa — recusar só deixa a sessão
 * sem a ponte.
 */
export function isChainableStatusLineCommand(command: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '\\') i++;
    else if (c === ';' || c === '&' || c === '\n' || c === '\r') return false;
    else if (c === '|' && command[i + 1] === '|') return false;
  }
  return quote === null && command.trim() !== '';
}

/** Rota da ponte para a statusline (mesmo nome que `STATUS_LINE_EVENT` em hook-bridge.ts). */
const STATUS_LINE_ROUTE = 'StatusLine';

function powershellFile(scriptPath: string): string {
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`;
}

/** Puro — o bloco `statusLine` do `--settings` da sessão. */
export function buildStatusLineSetting(
  plan: StatusLineBridgePlan,
  input: { readonly port: number; readonly token: string; readonly curlPath: string | null; readonly statusLineScriptPath?: string },
): StatusLineSetting {
  if (plan.kind === 'chain') {
    // `padding`, `refreshInterval` e `hideVimModeIndicator` do usuário viajam junto: a nossa substitui a dele.
    const { command, ...rest } = plan.user;
    return { ...rest, type: 'command', command: `${powershellFile(input.statusLineScriptPath ?? '')} | ${command}` };
  }
  if (input.curlPath !== null) {
    // Barras normais e `"@-"` entre aspas: o mesmo texto vale no Git Bash (que come `\` sem aspas —
    // visto num transcript real do 2.1.295, `C:WindowsSystem32curl.exe: command not found`), no
    // PowerShell (onde `@-` sem aspas é erro de sintaxe) e no cmd.
    const path = input.curlPath.replaceAll('\\', '/');
    const exe = /\s/.test(path) ? `"${path}"` : path;
    // A ponte responde com corpo vazio: o curl não imprime nada.
    return {
      type: 'command',
      command: `${exe} -s --noproxy 127.0.0.1 --connect-timeout 1 --max-time 2 --data-binary "@-" -H "X-Donel-Token: ${input.token}" ${bridgeUrl(input.port, STATUS_LINE_ROUTE)}`,
    };
  }
  return { type: 'command', command: powershellFile(input.statusLineScriptPath ?? '') };
}

/**
 * Puro — o `.ps1` da statusline. `echo: true` é o TEE do encadeamento: lê o
 * stdin em bytes, devolve-o no stdout (todo caractere não-ASCII escapado como
 * `\uXXXX` — o MESMO JSON para qualquer leitor, e que nenhuma página de código
 * do PowerShell estraga no pipe) e FECHA o stdout antes de postar, para o
 * comando do usuário não esperar a ponte. `echo: false` só posta, calado.
 * Nunca lança, termina com 0; o POST tem timeout de 1,5 s e ignora proxy.
 */
export function buildStatusLineScript(input: { readonly port: number; readonly token: string; readonly echo: boolean }): string {
  const lines = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$stdin = [Console]::OpenStandardInput()',
    '$ms = New-Object System.IO.MemoryStream',
    '$stdin.CopyTo($ms)',
    '$bytes = $ms.ToArray()',
  ];
  if (input.echo) {
    lines.push(
      '$text = [System.Text.Encoding]::UTF8.GetString($bytes)',
      "$ascii = [regex]::Replace($text, '[^\\u0000-\\u007F]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })",
      '$outBytes = [System.Text.Encoding]::ASCII.GetBytes($ascii)',
      '$stdout = [Console]::OpenStandardOutput()',
      '$stdout.Write($outBytes, 0, $outBytes.Length)',
      '$stdout.Flush()',
      '$stdout.Close()',
    );
  }
  lines.push(
    'try {',
    `  $req = [System.Net.HttpWebRequest]::Create("${bridgeUrl(input.port, STATUS_LINE_ROUTE)}")`,
    '  $req.Method = "POST"',
    '  $req.Proxy = $null',
    '  $req.Timeout = 1500',
    '  $req.ReadWriteTimeout = 1500',
    '  $req.ContentType = "application/json"',
    `  $req.Headers.Add("X-Donel-Token", "${input.token}")`,
    '  $req.ContentLength = $bytes.Length',
    '  $rs = $req.GetRequestStream()',
    '  $rs.Write($bytes, 0, $bytes.Length)',
    '  $rs.Close()',
    '  $req.GetResponse().Close()',
    '} catch {}',
    'exit 0',
    '',
  );
  return lines.join('\r\n');
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

function sessionStatusLineScriptPath(userDataDir: string, ptyId: string): string {
  return join(userDataDir, HOOK_SETTINGS_DIR_NAME, `${ptyId}.statusline.ps1`);
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

  // Ponte da statusline: o tee (encadeamento) sempre; o encaminhador calado só quando não há curl.
  let statusLineScriptPath = input.statusLineScriptPath;
  const plan = input.statusLine;
  if (plan && (plan.kind === 'chain' || input.curlPath === null)) {
    statusLineScriptPath = sessionStatusLineScriptPath(userDataDir, ptyId);
    writeFileSync(statusLineScriptPath, buildStatusLineScript({ port, token, echo: plan.kind === 'chain' }), 'utf8');
  }

  const path = sessionHookSettingsPath(userDataDir, ptyId);
  writeFileSync(path, JSON.stringify(buildSessionHooksSettings({ ...input, forwarderScriptPath, statusLineScriptPath }), null, 2), 'utf8');
  return path;
}

/**
 * I/O — the session's `--settings` with only the role scope, for a session whose hooks file could not be written
 * (same path, so `removeSessionHooksSettings` and the boot cleanup take it too).
 */
export function writeSessionScopeOnlySettings(userDataDir: string, ptyId: string, roleScope: RoleScopeSettings): string {
  mkdirSync(join(userDataDir, HOOK_SETTINGS_DIR_NAME), { recursive: true });
  const path = sessionHookSettingsPath(userDataDir, ptyId);
  writeFileSync(path, JSON.stringify(roleScope, null, 2), 'utf8');
  return path;
}

/** I/O — removes the session's settings file and forwarder script; missing files are fine. */
export function removeSessionHooksSettings(userDataDir: string, ptyId: string): void {
  for (const path of [sessionHookSettingsPath(userDataDir, ptyId), sessionForwarderScriptPath(userDataDir, ptyId), sessionStatusLineScriptPath(userDataDir, ptyId)]) {
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
