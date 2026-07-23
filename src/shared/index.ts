// Tipos IPC compartilhados entre main/preload/renderer (plan.md "Arquitetura
// de processos"). CommandBuilder chega em T006 (TDD); os tipos abaixo cobrem
// os canais `pty:*` introduzidos em T004. Canais `projects:*` chegam no T007
// (src/shared/projects.ts) — os demais (sessions:*, profiles:*, config:*)
// chegam junto das tasks que os implementam.

import type { DonelProjectsApi } from './projects';

export { PROJECT_CHANNELS } from './projects';
export type { DonelProjectsApi, ProjectInfo } from './projects';

/** Nomes dos canais IPC do domínio PTY (plan.md linha 37). */
export const PTY_CHANNELS = {
  create: 'pty:create',
  input: 'pty:input',
  resize: 'pty:resize',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit',
  preview: 'pty:preview',
} as const;

export interface PtyCreateOptions {
  /** Colunas iniciais (medidas pelo xterm/addon-fit no renderer). */
  cols: number;
  /** Linhas iniciais (medidas pelo xterm/addon-fit no renderer). */
  rows: number;
  /** Diretório de trabalho; default = home do usuário (T004 não tem contexto de projeto ainda). */
  cwd?: string;
  /**
   * 'shell' (default) = terminal livre (FR-008), spawna powershell.exe.
   * 'claude' (T005) = spawna o `claude` CLI direto no PTY (FR-006, plan.md
   * ponto 1) — o main process resolve o executável (PATH → fallback
   * `~/.local/bin/claude.exe`) e responde com erro CA-5 se não encontrar.
   */
  sessionType?: 'shell' | 'claude';
  /**
   * Argv extra do CommandBuilder (T008 — Launcher, FR-003/CA-1). Só tem
   * efeito quando `sessionType === 'claude'`; ignorado no terminal livre
   * (que sempre spawna `powershell.exe -NoLogo`, PtyManager.FREE_TERMINAL_ARGS).
   */
  args?: string[];
}

/**
 * Prefixo reconhecido pelo renderer (TerminalPane) para distinguir o erro
 * "claude não encontrado" (CA-5) de qualquer outra falha de `pty:create`.
 * Compartilhado entre main e renderer para não duplicar a string literal.
 */
export const CLAUDE_NOT_FOUND_PREFIX = 'CLAUDE_NOT_FOUND:';

/**
 * Extrai o caminho esperado de um erro de `pty:create` rejeitado com o
 * prefixo `CLAUDE_NOT_FOUND:<path>` (CA-5), ou null se não for esse erro.
 * Puro (sem React/DOM) — usado pelo TerminalPane e testável isoladamente.
 */
export function parseClaudeNotFound(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const markerIndex = message.indexOf(CLAUDE_NOT_FOUND_PREFIX);
  if (markerIndex < 0) return null;
  return message.slice(markerIndex + CLAUDE_NOT_FOUND_PREFIX.length).trim();
}

export interface PtyCreateResult {
  ptyId: string;
}

export interface PtyExitInfo {
  exitCode: number;
  signal?: number;
}

/** API tipada exposta pelo preload em `window.donel.pty` (contextBridge). */
export interface DonelPtyApi {
  create(options: PtyCreateOptions): Promise<PtyCreateResult>;
  input(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  kill(ptyId: string): void;
  /** Ring buffer de ~50 linhas (ANSI stripado) — plan.md ponto 8, hover-preview futuro. */
  getPreview(ptyId: string): Promise<string[]>;
  /** Retorna função de unsubscribe. */
  onData(ptyId: string, listener: (data: string) => void): () => void;
  /** Retorna função de unsubscribe. */
  onExit(ptyId: string, listener: (info: PtyExitInfo) => void): () => void;
}

export interface DonelApi {
  pty: DonelPtyApi;
  projects: DonelProjectsApi;
}
