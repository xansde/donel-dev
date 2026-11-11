// T006 — CommandBuilder (FR-003, plan.md ponto 3)
//
// `buildClaudeArgs` é uma função pura (sem I/O) que traduz as opções do
// Launcher num argv (`string[]`) para o `claude` CLI. O array resultante é
// consumido diretamente pelo PtyManager via node-pty (ConPTY no Windows), que
// spawna o processo sem passar por um shell — cada elemento do array vira um
// argumento discreto. Por isso os valores (ex.: nome da sessão) NUNCA devem
// ser envolvidos em aspas literais: a notação `-n "<nome>"` na tabela do
// FR-003 e no CA-1 da spec é só uma forma legível de mostrar "flag seguida do
// valor como um token"; aspas de verdade corromperiam o valor recebido pelo
// CLI (o `-n` receberia `"radar"` em vez de `radar`).
//
// Controle não preenchido = flag omitida (o CLI usa o default do usuário).

export type ModelAlias = 'fable' | 'opus' | 'sonnet' | 'haiku';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type PermissionMode =
  | 'manual'
  | 'acceptEdits'
  | 'auto'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions';

// As três ações "Retomar" / "Fork" / "Continuar última" da tabela FR-003 são
// mutuamente exclusivas (é uma escolha só no Launcher) — modelada como union
// discriminada para tornar estados inválidos irrepresentáveis.
export type SessionContinuation =
  | { readonly type: 'resume'; readonly sessionId: string }
  | { readonly type: 'fork'; readonly sessionId: string }
  | { readonly type: 'continueLast' };

export interface BuildClaudeArgsOptions {
  readonly model?: ModelAlias;
  readonly effort?: EffortLevel;
  readonly permissionMode?: PermissionMode;
  readonly sessionName?: string;
  readonly continuation?: SessionContinuation;
  /** "Isolar em worktree": o CLI cria e entra em `.claude/worktrees/<nome>` (`--worktree <nome>`). Vazio/ausente omite. */
  readonly worktree?: string;
}

export function buildClaudeArgs(opts: BuildClaudeArgsOptions = {}): string[] {
  const args: string[] = [];

  if (opts.model) {
    args.push('--model', opts.model);
  }

  if (opts.effort) {
    args.push('--effort', opts.effort);
  }

  if (opts.permissionMode) {
    args.push('--permission-mode', opts.permissionMode);
  }

  if (opts.sessionName) {
    // Token único, sem aspas — ver nota de topo do arquivo.
    args.push('-n', opts.sessionName);
  }

  switch (opts.continuation?.type) {
    case 'resume':
      args.push('-r', opts.continuation.sessionId);
      break;
    case 'fork':
      args.push('-r', opts.continuation.sessionId, '--fork-session');
      break;
    case 'continueLast':
      args.push('-c');
      break;
    default:
      break;
  }

  // Por último, para não mexer na ordem estável das flags acima.
  if (opts.worktree) {
    args.push('--worktree', opts.worktree);
  }

  return args;
}

// T011 — Defaults do Brief 3 (design reference), mesmos valores que o
// Launcher.tsx já usa (DEFAULT_MODEL/DEFAULT_EFFORT locais, comentário
// "Defaults do Brief 3: fable/high/acceptEdits") — exportados aqui pra
// SessionDetails (right panel, FR-011) semear o valor inicial de uma sessão
// aberta SEM passar pelo Launcher (ex.: clique direto na sidebar), onde
// `parseModelEffortFromArgs` abaixo não tem nenhuma flag pra ler.
export const DEFAULT_MODEL_ALIAS: ModelAlias = 'fable';
export const DEFAULT_EFFORT_LEVEL: EffortLevel = 'high';

const KNOWN_MODEL_ALIASES: readonly ModelAlias[] = ['fable', 'opus', 'sonnet', 'haiku'];
const KNOWN_EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ParsedModelEffort {
  readonly model?: ModelAlias;
  readonly effort?: EffortLevel;
}

/**
 * Inverso de `buildClaudeArgs` pros dois campos que a sessão viva (T011,
 * SessionDetails) precisa mostrar pré-selecionados: lê `--model`/`--effort`
 * de volta de um argv já montado (`TabState.launchArgs`, T008/App.tsx) —
 * puro, sem I/O, mesmo espírito de `buildClaudeArgs`. Flag ausente, sem
 * valor seguinte (argv truncado) ou com valor fora do enum conhecido
 * (argv corrompido ou de uma versão futura do CommandBuilder) é omitida do
 * resultado em vez de propagar um valor inválido pro tipo `ModelAlias`/
 * `EffortLevel` — quem chama decide o fallback (SessionDetails cai pros
 * `DEFAULT_*` acima).
 */
export function parseModelEffortFromArgs(args: readonly string[] | undefined): ParsedModelEffort {
  if (!args || args.length === 0) return {};

  const result: { model?: ModelAlias; effort?: EffortLevel } = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--model') {
      const value = args[i + 1];
      if (value && (KNOWN_MODEL_ALIASES as readonly string[]).includes(value)) {
        result.model = value as ModelAlias;
      }
    } else if (args[i] === '--effort') {
      const value = args[i + 1];
      if (value && (KNOWN_EFFORT_LEVELS as readonly string[]).includes(value)) {
        result.effort = value as EffortLevel;
      }
    }
  }
  return result;
}

// T018 (014-chat, FR-030/R17) — todo spawn de sessão `claude` passa
// `--permission-mode` explícito, para o app saber o modo de partida sem
// adivinhar. Precedência: launcher (já no argv) > padrão do CLI do usuário
// (`permissions.defaultMode`, lido por main/cli-user-settings.ts) > `default`.

/** Modos aceitos pelo CLI em `--permission-mode` (superconjunto do `PermissionMode` do launcher). */
const CLI_PERMISSION_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

function findExplicitPermissionMode(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--permission-mode') return argv[i + 1];
    if (arg.startsWith('--permission-mode=')) return arg.slice('--permission-mode='.length);
  }
  return undefined;
}

export function resolvePermissionMode(argv: readonly string[], userDefault: string | undefined): string {
  const explicit = findExplicitPermissionMode(argv);
  if (explicit) return explicit;
  if (userDefault && CLI_PERMISSION_MODES.includes(userDefault)) return userDefault;
  return 'default';
}

/** Devolve o argv com `--permission-mode <resolvido>` acrescentado quando o launcher não o trouxe. */
export function withResolvedPermissionMode(argv: readonly string[], userDefault: string | undefined): string[] {
  if (findExplicitPermissionMode(argv)) return [...argv];
  return [...argv, '--permission-mode', resolvePermissionMode(argv, userDefault)];
}

// ---------------------------------------------------------------------------------------------------------------
// Navegador integrado — how the app's own MCP server (`donel`, shared/browser/mcp.ts) reaches the agent of a
// session (docs/design/navegador-interno.md, D9 + emenda agnóstica de 03/11).
//
// The tools are a contract of the APP, not of one CLI. What changes from one agent CLI to another is only how
// it is told "there is an MCP server here, with this header": a config file, a flag, an env var. That is the
// one function below, keyed by the CLI that runs in the PTY. Today every session runs Claude Code (with or
// without a third-party provider: the provider changes the model endpoint, not the CLI), so there is one case.
// A new CLI that speaks MCP (Codex: `-c mcp_servers.donel.url=…`; Gemini CLI: `mcpServers` in its settings)
// becomes one more `case` here, with its own test — nothing else in the app changes.

/** The agent CLI that runs in a session's PTY. */
export type AgentCli = 'claude-code';

/** The app's MCP endpoint for ONE session (the bearer token names the PTY whose browser it drives). */
export interface AppMcpEndpoint {
  /** Server name the agent sees (`donel` -> tools `mcp__donel__navegador_*` in Claude Code). */
  readonly name: string;
  /** Streamable HTTP URL on the loopback. */
  readonly url: string;
  readonly bearerToken: string;
}

/** What the spawn needs to hand the endpoint to the CLI. */
export interface McpDelivery {
  /** Content of the per-session file written at `configPath` (`null` = the CLI needs no file). */
  readonly configFileContent: string | null;
  /** Arguments appended to the CLI's argv. */
  readonly args: readonly string[];
}

/**
 * Wall-clock limit of one call to the app's MCP, per server (`timeout` of the CLI's config). 10/11 (t-58d7c191) —
 * without it Claude Code cuts an HTTP MCP call at 60 s ("The operation timed out."), below the app's own waits:
 * `sessao_enviar` answers within 90 s and `sessao_abrir`/`navegador_pedir_humano` wait up to 30 min for the owner.
 * Every tool keeps its own net in the app (`board-bridge.ts`), so this only has to outlast the longest one.
 */
export const APP_MCP_TOOL_TIMEOUT_MS = 35 * 60_000;

/** Claude Code `--mcp-config` file: one HTTP server with the bearer header. */
export function buildBrowserMcpConfig(endpoint: AppMcpEndpoint): {
  mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string>; timeout: number }>;
} {
  return {
    mcpServers: {
      [endpoint.name]: {
        type: 'http',
        url: endpoint.url,
        headers: { Authorization: `Bearer ${endpoint.bearerToken}` },
        timeout: APP_MCP_TOOL_TIMEOUT_MS,
      },
    },
  };
}

/**
 * Claude Code argv for the config file. `--mcp-config` is variadic in the CLI: the spawn appends it after the
 * other flags, and only options (never a bare value) may follow it.
 */
export function browserMcpConfigArgs(configPath: string): string[] {
  return [...appMcpAllowArgs(), '--mcp-config', configPath];
}

/**
 * Quadro por MCP (owner, 04/11) — the board and session tools of the app's server never ask the owner for
 * permission in any mode: one session talking to another, or building the board, must not stop on a prompt
 * (the board batch is undoable and the session tools only reach sessions through the owner's links).
 * Visible in the argv, one comma-separated token so the variadic `--allowedTools` stops at the next option.
 * The browser tools (`navegador_*`) keep the CLI's normal permission flow.
 */
export const APP_MCP_PREAUTHORIZED_TOOLS: readonly string[] = [
  'quadro_ler',
  'quadro_aplicar',
  'papeis_listar',
  'sessao_quem_sou',
  'sessao_listar',
  'sessao_abrir',
  'sessao_enviar',
  'sessao_ver_tela',
  'sessao_retomar',
  'sessao_religar',
].map((tool) => `mcp__donel__${tool}`);

export function appMcpAllowArgs(): string[] {
  return ['--allowedTools', APP_MCP_PREAUTHORIZED_TOOLS.join(',')];
}

// ---------------------------------------------------------------------------------------------------------------
// Papéis de sessão (item 12a) — how the guidance of a role reaches the agent, at EVERY launch, resume and renewal
// (the app re-injects it; the model does not "remember"). Same shape as `mcpDeliveryFor`: one case per CLI.
// Claude Code reads it from a file appended to its system prompt (`--append-system-prompt-file`, a hidden option
// of the CLI, checked in 2.1.317). The CLI records the system prompt once per conversation and reuses it until the
// conversation is compacted, so passing it on a resume is harmless, and after a compaction it is what comes back.
// A CLI without such a flag gets the same text as its first message (`firstMessage`).

/** What the spawn needs to hand a role to the CLI. */
export interface RoleDelivery {
  /** Arguments appended to the CLI's argv (an option with its value; safe after `--mcp-config`). */
  readonly args: readonly string[];
  /** Text to send as the first message, for a CLI without a system-prompt flag (`null` = none). */
  readonly firstMessage: string | null;
}

/** The single extension point: how the guidance of a role (written at `promptPath`) reaches `cli`. */
export function roleDeliveryFor(cli: AgentCli, promptPath: string): RoleDelivery {
  switch (cli) {
    case 'claude-code':
      return { args: ['--append-system-prompt-file', promptPath], firstMessage: null };
  }
}

/** The single extension point: how the app's MCP endpoint reaches `cli`. */
export function mcpDeliveryFor(cli: AgentCli, endpoint: AppMcpEndpoint, configPath: string): McpDelivery {
  switch (cli) {
    case 'claude-code':
      return { configFileContent: `${JSON.stringify(buildBrowserMcpConfig(endpoint), null, 2)}\n`, args: browserMcpConfigArgs(configPath) };
  }
}
