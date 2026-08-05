// T1213 (011-contas-e-provedores, etapa 2) — arquivamento final:
// desfaz as 6 junctions de CADA perfil, e SÓ ENTÃO renomeia a raiz
// (`~/.claude-profiles` → `~/.claude-profiles.old`). Ordem invariante
// (C27/D12): todo unlink acontece antes do rename; falha de unlink aborta
// sem renomear. NENHUMA operação de deleção existe neste módulo, de
// propósito (D13) — `ArchiveIoDeps` não tem `remove`/`rm`.

import { join } from 'node:path';
import { existsSync, lstatSync, readlinkSync, renameSync, rmdirSync } from 'node:fs';
import type { ArchiveOutcome } from '../../../shared/migration';

export type { ArchiveOutcome } from '../../../shared/migration';

/**
 * T1222 (011-contas-e-provedores, etapa 2) — cópia PRÓPRIA da lista de dirs
 * linkados por junction (`profile-manager.ts` morreu na demolição). Mesma
 * lista, mesmo espírito de duplicação de propósito que os smokes já usam
 * (nunca importar de um módulo morto ou prestes a morrer — ver comentário
 * de topo de `tests/smoke/profiles.spec.ts`).
 */
const PROFILE_LINK_DIRS = ['projects', 'skills', 'commands', 'rules', 'plugins', 'templates'] as const;

export interface ArchiveIoDeps {
  /** `rmdir` do link — NUNCA remove o alvo (reparse point de diretório, não recursivo). */
  unlinkJunction(path: string): void;
  rename(from: string, to: string): void;
  exists(path: string): boolean;
  isJunction(path: string): boolean;
  // NOTA DE DESENHO: não existe `remove`/`rm` aqui, de propósito (D13).
}

export interface ArchiveInput extends ArchiveIoDeps {
  readonly paths: { readonly homedir: string };
  /** Slugs dos perfis a arquivar (do inventário) — [] ⇒ nothing-to-archive. */
  readonly profileSlugs: readonly string[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateSuffix(now: Date): string {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

/** Ordem invariante: todos os unlinks de TODOS os perfis primeiro, depois um único rename da raiz. */
export function archiveProfiles(input: ArchiveInput, now: Date): ArchiveOutcome {
  const root = join(input.paths.homedir, '.claude-profiles');
  if (!input.exists(root) || input.profileSlugs.length === 0) {
    return { kind: 'nothing-to-archive' };
  }

  for (const slug of input.profileSlugs) {
    const configDir = join(root, slug);
    for (const dirName of PROFILE_LINK_DIRS) {
      const linkPath = join(configDir, dirName);
      if (!input.isJunction(linkPath)) continue;
      try {
        input.unlinkJunction(linkPath);
      } catch {
        return { kind: 'aborted', reason: 'junction-unlink-failed', profileSlug: slug };
      }
    }
  }

  const baseTarget = `${root}.old`;
  const archivedTo = input.exists(baseTarget) ? `${baseTarget}-${dateSuffix(now)}` : baseTarget;

  try {
    input.rename(root, archivedTo);
  } catch {
    return { kind: 'aborted', reason: 'rename-failed' };
  }

  return { kind: 'archived', archivedTo };
}

/** Deps reais (filesystem da máquina) — só o main process usa. */
export function createSystemArchiveIoDeps(): ArchiveIoDeps {
  return {
    unlinkJunction: (path) => rmdirSync(path),
    rename: (from, to) => renameSync(from, to),
    exists: (path) => existsSync(path),
    isJunction: (path) => {
      try {
        return lstatSync(path).isSymbolicLink() || readlinkSync(path) !== undefined;
      } catch {
        return false;
      }
    },
  };
}
