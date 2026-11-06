// Escopo do papel (dono, 05/11) — what a session with a role loads besides the app's own MCP. Pure: the
// inventory is read by `src/main/role-scope-inventory.ts` (this PC) or by `buildRemoteInventoryScript` (a remote
// place), and the result goes into the session's ONE `--settings` file (the CLI keeps only the last `--settings`).
//
// Measured with the CLI 2.1.318 (docs/design/papel-escopo.md):
// - `allowedMcpServers` in `--settings` keeps only the named servers: the user's, the project's, the plugins' and
//   the claude.ai connectors. Only names travel; the servers' definitions (with their tokens) stay in the user's
//   files. That is why the app does not write an `--mcp-config` copy plus `--strict-mcp-config`, which would copy
//   the tokens of `~/.claude.json` into the app's files (CLAUDE.md, "Credenciais").
// - `enabledPlugins: { id: false }` turns a plugin off with its skills, hooks, agents and MCP servers.
// - `skillOverrides: { name: 'off' }` turns off a skill or command of the user's own folders.
// - The hooks of the user's `settings.json` cannot be dropped per session: `--settings` adds hooks, never removes,
//   and `--setting-sources` without `user` also drops the user's skills, commands and permissions.

import type { RoleScope, ScopeList } from './roles';

/** What a CLI config dir holds that a scope can turn off. */
export interface ClaudeInventory {
  /** `name@marketplace`. */
  readonly pluginIds: readonly string[];
  /** Names of the user's own skills and commands (synced ones as `anthropic-skills:<name>`). */
  readonly skillNames: readonly string[];
}

export const EMPTY_INVENTORY: ClaudeInventory = { pluginIds: [], skillNames: [] };

/** The keys of the session's `--settings` that carry a scope. */
export interface RoleScopeSettings {
  readonly allowedMcpServers?: ReadonlyArray<{ readonly serverName: string }>;
  readonly enabledPlugins?: Readonly<Record<string, false>>;
  readonly skillOverrides?: Readonly<Record<string, 'off'>>;
}

function isList(list: ScopeList | undefined): list is readonly string[] {
  return Array.isArray(list);
}

/** True when the scope turns off plugins or skills (then the inventory has to be read). */
export function roleScopeNeedsInventory(scope: RoleScope | undefined): boolean {
  return isList(scope?.plugins) || isList(scope?.skills);
}

function pluginKept(id: string, kept: readonly string[]): boolean {
  const name = id.split('@')[0]!;
  return kept.some((entry) => entry === id || entry === name);
}

/**
 * Pure — the `--settings` keys of a scope. `null` = nothing to restrict (no role, no scope, or every axis `*`):
 * the session loads everything, as before. A kept plugin is left as the user has it (never turned on here).
 */
export function buildRoleScopeSettings(scope: RoleScope | undefined, inventory: ClaudeInventory, appMcpServerName: string): RoleScopeSettings | null {
  if (!scope) return null;
  const out: { -readonly [K in keyof RoleScopeSettings]: RoleScopeSettings[K] } = {};
  if (isList(scope.mcps)) {
    out.allowedMcpServers = [...new Set([appMcpServerName, ...scope.mcps])].map((serverName) => ({ serverName }));
  }
  const plugins = scope.plugins;
  if (isList(plugins)) {
    const off = [...new Set(inventory.pluginIds)].filter((id) => !pluginKept(id, plugins)).sort();
    out.enabledPlugins = Object.fromEntries(off.map((id) => [id, false as const]));
  }
  const skills = scope.skills;
  if (isList(skills)) {
    const off = [...new Set(inventory.skillNames)].filter((name) => !skills.includes(name)).sort();
    out.skillOverrides = Object.fromEntries(off.map((name) => [name, 'off' as const]));
  }
  return Object.keys(out).length > 0 ? out : null;
}

// --- Inventory: the same reading on this PC and on a remote place ------------------------------------------------

/** What is listed in a config dir, before it becomes names. */
export interface InventoryListing {
  /** Keys of `plugins/installed_plugins.json` and of `enabledPlugins` in the settings files. */
  readonly pluginIds: readonly string[];
  /** Folders of `skills/` (`synced` is not a skill). */
  readonly skillDirs: readonly string[];
  /** Folders of `skills/synced/<account>/` (the claude.ai skills, named `anthropic-skills:<dir>`). */
  readonly syncedSkillDirs: readonly string[];
  /** `.md` files of `commands/`, relative, with `/` (`x.md`, `group/y.md`). */
  readonly commandFiles: readonly string[];
}

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Pure — the inventory of a listing. Odd names are dropped, never guessed. */
export function inventoryFromListing(listing: InventoryListing): ClaudeInventory {
  const skillNames = new Set<string>();
  for (const dir of listing.skillDirs) if (dir !== 'synced' && NAME_PATTERN.test(dir)) skillNames.add(dir);
  for (const dir of listing.syncedSkillDirs) if (NAME_PATTERN.test(dir)) skillNames.add(`anthropic-skills:${dir}`);
  for (const file of listing.commandFiles) {
    const parts = file.replace(/\\/g, '/').replace(/\.md$/i, '').split('/');
    // A skill folder kept under `commands/` (`x/SKILL.md`) is named after the folder.
    if (parts.length > 1 && parts[parts.length - 1]!.toUpperCase() === 'SKILL') parts.pop();
    if (parts.length === 0 || !parts.every((part) => NAME_PATTERN.test(part))) continue;
    skillNames.add(parts.join(':'));
  }
  return {
    pluginIds: [...new Set(listing.pluginIds.filter((id) => PLUGIN_ID_PATTERN.test(id)))].sort(),
    skillNames: [...skillNames].sort(),
  };
}

/** Pure — the keys of `enabledPlugins` (only them) in a settings file's text. */
export function enabledPluginIdsOf(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const enabled = (parsed as Record<string, unknown>).enabledPlugins;
    return typeof enabled === 'object' && enabled !== null && !Array.isArray(enabled) ? Object.keys(enabled) : [];
  } catch {
    return [];
  }
}

/** Pure — the plugin ids of `installed_plugins.json` (v2 `{ plugins: {...} }`, or the older flat object). */
export function installedPluginIdsOf(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const record = parsed as Record<string, unknown>;
    const plugins = typeof record.plugins === 'object' && record.plugins !== null ? (record.plugins as Record<string, unknown>) : record;
    return Object.keys(plugins).filter((id) => PLUGIN_ID_PATTERN.test(id));
  } catch {
    return [];
  }
}

/**
 * Pure — the script that lists a remote place's `~/.claude` (sent on stdin, read only). Plugin ids come out of the
 * JSON files by name only (python3 when there is one, else a grep of the installed list); nothing else of
 * `settings.json` leaves the machine.
 */
export function buildRemoteInventoryScript(): string {
  return [
    'C="$HOME/.claude"',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 - "$C" <<'DONEL_PY' 2>/dev/null`,
    'import json, os, sys',
    'c = sys.argv[1]',
    'def keys(path, pick):',
    '    try:',
    '        with open(path) as f: d = json.load(f)',
    '        v = pick(d)',
    '        return list(v.keys()) if isinstance(v, dict) else []',
    '    except Exception:',
    '        return []',
    'ids = keys(os.path.join(c, "plugins", "installed_plugins.json"), lambda d: d.get("plugins", d))',
    'ids += keys(os.path.join(c, "settings.json"), lambda d: d.get("enabledPlugins"))',
    'for i in ids: print("DONEL_INV_PLUGIN " + i)',
    'DONEL_PY',
    'else',
    `  grep -oE '"[A-Za-z0-9._-]+@[A-Za-z0-9._-]+"[[:space:]]*:' "$C/plugins/installed_plugins.json" 2>/dev/null | tr -d '":[:space:]' | sed 's/^/DONEL_INV_PLUGIN /'`,
    'fi',
    'for d in "$C"/skills/*/; do [ -d "$d" ] && printf "DONEL_INV_SKILL %s\\n" "$(basename "$d")"; done',
    'for d in "$C"/skills/synced/*/*/; do [ -d "$d" ] && printf "DONEL_INV_SYNCED %s\\n" "$(basename "$d")"; done',
    '[ -d "$C/commands" ] && (cd "$C/commands" && find . -name "*.md" -type f 2>/dev/null | sed "s|^\\./|DONEL_INV_COMMAND |")',
    'printf "DONEL_INV_END\\n"',
    '',
  ].join('\n');
}

/** Pure — reads the answer of `buildRemoteInventoryScript`; `null` when it did not finish (unreachable place). */
export function parseRemoteInventoryOutput(stdout: string): ClaudeInventory | null {
  const lines = stdout.split(/\r?\n/);
  if (!lines.includes('DONEL_INV_END')) return null;
  const pick = (prefix: string): string[] =>
    lines.filter((line) => line.startsWith(`${prefix} `)).map((line) => line.slice(prefix.length + 1).trim());
  return inventoryFromListing({
    pluginIds: pick('DONEL_INV_PLUGIN'),
    skillDirs: pick('DONEL_INV_SKILL'),
    syncedSkillDirs: pick('DONEL_INV_SYNCED'),
    commandFiles: pick('DONEL_INV_COMMAND'),
  });
}
