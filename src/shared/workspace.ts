// "Abrir no editor" + branch atual (sidebar) — contrato IPC.
// Mesmo padrão `'<domínio>:<ação>'` dos outros domínios.

import type { PullRequestStatus } from './pullRequestStatus';

export const WORKSPACE_CHANNELS = {
  /** invoke -> `EditorStatus` (VS Code, senão Cursor, senão nenhum). */
  editorStatus: 'workspace:editorStatus',
  /** invoke(path) -> `OpenInEditorResult`. Só pasta absoluta existente. */
  openInEditor: 'workspace:openInEditor',
  /** invoke(path) -> `GitBranchResult`, com cache curto no main. */
  gitBranch: 'workspace:gitBranch',
  /** B3 — invoke(path, options?) -> `PullRequestStatusResult`: PR aberto da branch atual, lido pelo `gh` (cache curto no main). */
  pullRequest: 'workspace:pullRequest',
  /** B3 — invoke(url) -> boolean: abre o PR/job no navegador. Só `https:`. */
  openPullRequestUrl: 'workspace:openPullRequestUrl',
  /** "Isolar em worktree" — main -> renderer: a aba fechou e a worktree FICOU (trabalho não enviado), `WorktreeKeptPayload`. */
  worktreeKept: 'workspace:worktreeKept',
  /** invoke(path) -> boolean: abre no Explorer uma worktree que o main avisou que ficou. */
  openWorktreeFolder: 'workspace:openWorktreeFolder',
} as const;

/** A worktree de uma sessão isolada que não foi removida ao fechar a aba, e por quê. */
export interface WorktreeKeptPayload {
  /** `kept` = ficou por ter trabalho; `failed` = era para sair, mas o git recusou (nada foi apagado à força). */
  readonly kind: 'kept' | 'failed';
  readonly name: string;
  readonly path: string;
  readonly branch: string;
  readonly reason: string;
}

export type EditorStatus = { readonly available: true; readonly name: string } | { readonly available: false };

export type OpenInEditorResult =
  | { readonly ok: true; readonly editor: string }
  | { readonly ok: false; readonly reason: 'invalid-path' | 'no-editor' | 'spawn-failed' };

/** `branch: null` = não é repositório git, HEAD destacado ou o git falhou. */
export interface GitBranchResult {
  readonly branch: string | null;
}

/** `pr: null` = branch sem PR aberto, sem git, ou `gh` ausente/deslogado (nada a mostrar). */
export interface PullRequestStatusResult {
  readonly pr: PullRequestStatus | null;
}

export interface PullRequestRequestOptions {
  /** Também lê as conversas de review não resolvidas (uma consulta a mais; só o painel pede). */
  readonly details?: boolean;
}

/** API exposta pelo preload em `window.donel.workspace`. */
export interface DonelWorkspaceApi {
  editorStatus(): Promise<EditorStatus>;
  openInEditor(path: string): Promise<OpenInEditorResult>;
  gitBranch(path: string): Promise<GitBranchResult>;
  pullRequest(path: string, options?: PullRequestRequestOptions): Promise<PullRequestStatusResult>;
  openPullRequestUrl(url: string): Promise<boolean>;
  onWorktreeKept(listener: (payload: WorktreeKeptPayload) => void): () => void;
  openWorktreeFolder(path: string): Promise<boolean>;
}
