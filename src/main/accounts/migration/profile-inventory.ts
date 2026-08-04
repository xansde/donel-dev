// T1203 (011-contas-e-provedores, etapa 2) — inventário de perfis
// (`data-model-etapa-2.md` §1, `contracts/migration-etapa-2.md` §3). PURO com
// IO injetável, mesmo padrão de `ProfileCreationIoDeps`/`ConfigIoDeps`.
//
// FRONTEIRA DE CREDENCIAL: este módulo NUNCA lê `.credentials.json` — só
// verifica existência (`deps.exists`). O conteúdo do par só é tocado por
// `credentials-import.ts`, dentro da mesma pasta.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { titleCaseFromSlug } from '../../profile-manager';

export type ProjectsDirKind = 'junction' | 'real-directory' | 'missing';

export interface ProfileInventoryEntry {
  /** Nome de diretório em ~/.claude-profiles (dado de máquina, nunca de pessoa). */
  readonly slug: string;
  /** De .donel-profile.json; fallback = titleCase do slug. */
  readonly displayName: string;
  readonly path: string;
  /** Só existência — o conteúdo nunca sai de credentials-import.ts. */
  readonly hasCredentials: boolean;
  /** Decide se há transcript a consolidar (C26). */
  readonly projectsDir: ProjectsDirKind;
  /** Nomes de servidor MCP do .claude.json do perfil. NUNCA os blocos. */
  readonly mcpServerNames: readonly string[];
  /** Cópias divergentes do global (só o fato, sem conteúdo). */
  readonly settingsDiffers: boolean;
  readonly claudeMdDiffers: boolean;
}

export interface ProfileInventoryDeps {
  homedir(): string;
  /** Nomes das entradas diretamente sob o path; nunca lança ⇒ []. */
  readDir(path: string): readonly string[];
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  /** `null` ⇒ ausente/corrompido/não-objeto. Nunca lança. */
  readJson(path: string): Record<string, unknown> | null;
  /** `null` ⇒ ausente/ilegível. Nunca lança. */
  readTextOrNull(path: string): string | null;
  /** `null` ⇒ path não resolvível (ausente, link quebrado). Nunca lança. */
  realpathOrNull(path: string): string | null;
}

const PROFILES_DIR_NAME = '.claude-profiles';
const CLAUDE_HOME_DIR_NAME = '.claude';

function readDisplayName(configDir: string, slug: string, deps: ProfileInventoryDeps): string {
  const metadata = deps.readJson(join(configDir, '.donel-profile.json'));
  const name = metadata?.name;
  return typeof name === 'string' && name.trim() ? name : titleCaseFromSlug(slug);
}

function readProjectsDirKind(configDir: string, claudeHome: string, deps: ProfileInventoryDeps): ProjectsDirKind {
  const profileProjects = join(configDir, 'projects');
  const globalProjects = join(claudeHome, 'projects');

  const profileRealpath = deps.realpathOrNull(profileProjects);
  if (profileRealpath === null) return 'missing';

  const globalRealpath = deps.realpathOrNull(globalProjects);
  return globalRealpath !== null && profileRealpath === globalRealpath ? 'junction' : 'real-directory';
}

function readMcpServerNames(configDir: string, deps: ProfileInventoryDeps): readonly string[] {
  const claudeJson = deps.readJson(join(configDir, '.claude.json'));
  const mcpServers = claudeJson?.mcpServers;
  if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) return [];
  return Object.keys(mcpServers);
}

function fileDiffersFromGlobal(configDir: string, claudeHome: string, fileName: string, deps: ProfileInventoryDeps): boolean {
  const profileContent = deps.readTextOrNull(join(configDir, fileName));
  const globalContent = deps.readTextOrNull(join(claudeHome, fileName));
  if (profileContent === null || globalContent === null) return false;
  return profileContent !== globalContent;
}

/** Nunca lança: raiz ausente ⇒ []; entrada que não é diretório ⇒ ignorada; `.claude.json` corrompido ⇒ `mcpServerNames: []`. */
export function readProfileInventory(deps: ProfileInventoryDeps): readonly ProfileInventoryEntry[] {
  const homedir = deps.homedir();
  const root = join(homedir, PROFILES_DIR_NAME);
  const claudeHome = join(homedir, CLAUDE_HOME_DIR_NAME);

  const slugs = deps.readDir(root);
  const entries: ProfileInventoryEntry[] = [];

  for (const slug of slugs) {
    const configDir = join(root, slug);
    if (!deps.isDirectory(configDir)) continue;

    entries.push({
      slug,
      displayName: readDisplayName(configDir, slug, deps),
      path: configDir,
      hasCredentials: deps.exists(join(configDir, '.credentials.json')),
      projectsDir: readProjectsDirKind(configDir, claudeHome, deps),
      mcpServerNames: readMcpServerNames(configDir, deps),
      settingsDiffers: fileDiffersFromGlobal(configDir, claudeHome, 'settings.json', deps),
      claudeMdDiffers: fileDiffersFromGlobal(configDir, claudeHome, 'CLAUDE.md', deps),
    });
  }

  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deps reais (filesystem da máquina) — só o main process usa. */
export function createSystemProfileInventoryDeps(homedirFn: () => string): ProfileInventoryDeps {
  return {
    homedir: homedirFn,
    readDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    exists: (path) => existsSync(path),
    readJson: (path) => {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    readTextOrNull: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    realpathOrNull: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    },
  };
}
