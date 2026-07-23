import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// T007 — persistência mínima de favoritos (FR-001: "favoritos são
// persistidos no config"). Por decisão explícita da task, isso é um JSON
// simples isolado neste módulo — o ConfigStore formal (%APPDATA%\DonelDev\
// config.json, plan.md "Arquitetura de processos") chega no T015 e absorve
// este arquivo. Leitura/escrita ficam separadas da lógica pura de toggle pra
// essa última ser testável sem tocar filesystem.

export interface ProjectConfig {
  /** Caminhos absolutos marcados como favorito. */
  favorites: string[];
}

const EMPTY_CONFIG: ProjectConfig = { favorites: [] };

/** Nunca lança — config ausente ou corrompido cai no default vazio. */
export function readProjectConfig(filePath: string): ProjectConfig {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    return { favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((p) => typeof p === 'string') : [] };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function writeProjectConfig(filePath: string, config: ProjectConfig): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

/** Toggle puro (sem I/O) — adiciona/remove `path` da lista, sem duplicar. */
export function toggleFavorite(favorites: readonly string[], path: string, favorite: boolean): string[] {
  const set = new Set(favorites);
  if (favorite) {
    set.add(path);
  } else {
    set.delete(path);
  }
  return [...set];
}
