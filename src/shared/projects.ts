// T007 — tipos IPC do domínio de projetos (FR-001, plan.md "projects:list|favorite").
// ProjectScanner + merge de favoritos vivem no main process
// (src/main/project-scanner.ts, src/main/project-config-store.ts); aqui só o
// contrato compartilhado com preload/renderer.

export const PROJECT_CHANNELS = {
  list: 'projects:list',
  favorite: 'projects:favorite',
} as const;

export interface ProjectInfo {
  /** Caminho absoluto do diretório do projeto. */
  path: string;
  /** Nome do diretório, ex. "donel-dev". */
  name: string;
  /** Root de scan (ou dirname do favorito) em que o projeto foi agrupado. */
  root: string;
  favorite: boolean;
  /**
   * true quando o projeto era favorito mas não apareceu no scan atual —
   * removido do disco ou movido pra fora dos roots configurados. A UI mostra
   * esmaecido com ação "remover" (ui-spec §2).
   */
  missing?: boolean;
}

/** API tipada exposta pelo preload em `window.donel.projects`. */
export interface DonelProjectsApi {
  /** Lista projetos escaneados (FR-001) com favoritos mesclados, já ordenados. */
  list(): Promise<ProjectInfo[]>;
  /** Marca/desmarca favorito; retorna a lista já atualizada (evita round-trip extra). */
  setFavorite(path: string, favorite: boolean): Promise<ProjectInfo[]>;
}
