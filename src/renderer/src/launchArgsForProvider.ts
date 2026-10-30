// T1317 (011-contas-e-provedores, etapa 3, C18/D7) — montador de argv puro,
// extraído do `App.tsx` (onde o Launcher decide as flags de lançamento).
// `commandBuilder.ts` PERMANECE INTOCADO (`buildClaudeArgs` continua a
// mesma função de sempre) — este arquivo só decide QUAIS opções passar pra
// ela: com provider classe A selecionado, `--model`/`--effort` não existem
// fora da assinatura Anthropic (o modelo vem do `env` da entrada), então são
// omitidos; `-n`/`--permission-mode` seguem iguais. Sem provider, o
// resultado é byte a byte o argv de hoje.

import { buildClaudeArgs } from '../../shared/commandBuilder';
import type { EffortLevel, ModelAlias, PermissionMode, SessionContinuation } from '../../shared/commandBuilder';

export interface BuildLauncherArgsOptions {
  /** `undefined`/vazio = sessão de conta/perfil (comportamento de hoje). */
  readonly providerId: string | undefined;
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
  readonly permissionMode: PermissionMode;
  /** Já trim()ado; string vazia = flag `-n` omitida. */
  readonly sessionName: string;
  readonly continuation?: SessionContinuation;
  /** Toggle "Navegador (Chrome/Edge)" do Launcher → `--chrome`. */
  readonly chrome?: boolean;
  /** "Isolar em worktree" — nome já escolhido (`worktreeNameFor`); ausente = sessão no checkout do projeto. */
  readonly worktree?: string;
}

export function buildLauncherArgs(options: BuildLauncherArgsOptions): string[] {
  const hasProvider = Boolean(options.providerId);

  return buildClaudeArgs({
    // C18/D7 — com provider, o modelo vem do env da entrada; passar
    // --model/--effort de um alias Anthropic (ex. "fable") para um endpoint
    // que não conhece esses aliases quebraria a sessão silenciosamente (A6).
    model: hasProvider ? undefined : options.model,
    effort: hasProvider ? undefined : options.effort,
    permissionMode: options.permissionMode,
    sessionName: options.sessionName || undefined,
    continuation: options.continuation,
    // Claude in Chrome exige login claude.ai — não existe com provider de
    // terceiro (doc code.claude.com/docs/en/chrome). O Launcher já desabilita
    // o toggle; aqui é a segunda trava, para o argv nunca levar a flag.
    chrome: hasProvider ? undefined : options.chrome,
    worktree: options.worktree,
  });
}
