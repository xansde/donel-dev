// Escopo do papel — the inventory of a CLI config dir on this PC (role-scope.ts has the rules). Reads only names:
// folder and file names, the keys of `installed_plugins.json` and the keys of `enabledPlugins` in the settings files.
// No other value of those files is kept (CLAUDE.md, "Credenciais").

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { enabledPluginIdsOf, inventoryFromListing, installedPluginIdsOf, type ClaudeInventory } from '../shared/role-scope';

function dirsOf(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function textOf(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function markdownFilesUnder(root: string, dir: string = root, depth = 0): string[] {
  if (depth > 3) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFilesUnder(root, path, depth + 1);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [relative(root, path)] : [];
  });
}

/** I/O — what `configDir` (and the project at `cwd`) holds that a scope can turn off. */
export function readClaudeInventory(configDir: string, cwd: string | undefined): ClaudeInventory {
  const settingsFiles = [join(configDir, 'settings.json'), ...(cwd ? [join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')] : [])];
  const skills = join(configDir, 'skills');
  return inventoryFromListing({
    pluginIds: [...installedPluginIdsOf(textOf(join(configDir, 'plugins', 'installed_plugins.json'))), ...settingsFiles.flatMap((path) => enabledPluginIdsOf(textOf(path)))],
    skillDirs: dirsOf(skills),
    syncedSkillDirs: dirsOf(join(skills, 'synced')).flatMap((account) => dirsOf(join(skills, 'synced', account))),
    commandFiles: markdownFilesUnder(join(configDir, 'commands')),
  });
}
