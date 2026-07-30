// Item 2/3 (rodada de feedback do teste de 30/07) — lógica pura do seletor de
// projetos (ProjectSwitcher): filtro textual (case/acento-insensível) e
// agrupamento por diretório-raiz, para a lista do popover "Projetos" mostrar
// só o NOME do projeto, agrupado por root (ex. `~/seazone`, `~/pessoal`).
// Módulo puro (sem React/Electron) — TDD conforme CLAUDE.md do projeto.

import type { ProjectInfo } from './projects';

/** Um grupo de projetos que compartilham o mesmo `root` (ordem de primeira aparição). */
export interface ProjectCatalogGroup {
  readonly root: string;
  readonly items: readonly ProjectInfo[];
}

/**
 * Remove acentos e normaliza caixa — mesma régua usada pro filtro do popover
 * (ex. "cotas" acha "Cotás").
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Filtra por `project.name` (case/acento-insensível). Query vazia/só espaços
 * devolve a lista inteira, sem tocar na ordem.
 */
export function filterProjectsByName(projects: readonly ProjectInfo[], query: string): ProjectInfo[] {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return [...projects];
  return projects.filter((project) => normalizeForSearch(project.name).includes(needle));
}

/**
 * Agrupa por `project.root`, preservando a ordem de PRIMEIRA aparição de cada
 * root e a ordem relativa dos itens dentro do grupo — não assume que a lista
 * de entrada já vem contígua por root (diferente do `groupByRoot` que a
 * árvore da sidebar usava).
 */
export function groupProjectsByRoot(projects: readonly ProjectInfo[]): ProjectCatalogGroup[] {
  const order: string[] = [];
  const byRoot = new Map<string, ProjectInfo[]>();
  for (const project of projects) {
    let bucket = byRoot.get(project.root);
    if (!bucket) {
      bucket = [];
      byRoot.set(project.root, bucket);
      order.push(project.root);
    }
    bucket.push(project);
  }
  return order.map((root) => ({ root, items: byRoot.get(root) ?? [] }));
}

/** Rótulo curto de um root pro cabeçalho de grupo, ex. `C:\Users\x\seazone` → `seazone`. */
export function projectRootLabel(root: string): string {
  const normalized = root.replace(/[\\/]+$/, '');
  const lastSep = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return lastSep >= 0 ? normalized.slice(lastSep + 1) : normalized;
}
