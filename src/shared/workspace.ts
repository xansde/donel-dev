// "Abrir no editor" + branch atual (sidebar) — contrato IPC.
// Mesmo padrão `'<domínio>:<ação>'` dos outros domínios.

export const WORKSPACE_CHANNELS = {
  /** invoke -> `EditorStatus` (VS Code, senão Cursor, senão nenhum). */
  editorStatus: 'workspace:editorStatus',
  /** invoke(path) -> `OpenInEditorResult`. Só pasta absoluta existente. */
  openInEditor: 'workspace:openInEditor',
  /** invoke(path) -> `GitBranchResult`, com cache curto no main. */
  gitBranch: 'workspace:gitBranch',
} as const;

export type EditorStatus = { readonly available: true; readonly name: string } | { readonly available: false };

export type OpenInEditorResult =
  | { readonly ok: true; readonly editor: string }
  | { readonly ok: false; readonly reason: 'invalid-path' | 'no-editor' | 'spawn-failed' };

/** `branch: null` = não é repositório git, HEAD destacado ou o git falhou. */
export interface GitBranchResult {
  readonly branch: string | null;
}

/** API exposta pelo preload em `window.donel.workspace`. */
export interface DonelWorkspaceApi {
  editorStatus(): Promise<EditorStatus>;
  openInEditor(path: string): Promise<OpenInEditorResult>;
  gitBranch(path: string): Promise<GitBranchResult>;
}
