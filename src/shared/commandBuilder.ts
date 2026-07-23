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

  return args;
}
