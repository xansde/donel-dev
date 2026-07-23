// Tipos IPC compartilhados entre main/preload/renderer (plan.md "Arquitetura
// de processos"). CommandBuilder chega em T006 (TDD); os tipos abaixo cobrem
// os canais `pty:*` introduzidos em T004 — os demais (projects:*, sessions:*,
// profiles:*, config:*) chegam junto das tasks que os implementam.

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
}
