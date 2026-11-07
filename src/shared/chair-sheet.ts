// Cadeiras, fatia 2 (docs/planos/cadeiras-arquitetura.md, decisão 3) — what the chair screen (B1) shows for a
// chair, read from its role: the instructions a session gets at birth, the skills, plugins and MCPs the role keeps,
// and the ESTIMATED cost of a session sitting there. Pure: the inventory comes from `roles.inventory` (names only).
//
// The cost is an estimate on purpose (PDA item 09 decides the real source): the instructions are counted from their
// text (≈ 4 characters per token); each skill, plugin and MCP adds a flat amount; the memory is a base process plus
// one process per MCP the role names (a remote MCP spawns none, but the app does not read the MCP list to know).

import type { ClaudeInventory } from './role-scope';
import { rolePromptText, type ScopeList, type SessionRole } from './roles';

export const APP_MCP_NAME = 'donel';

/** ≈ characters per token of Portuguese and English text. */
const CHARS_PER_TOKEN = 4;
/** Flat estimates per item (tokens of the listing the CLI loads at birth). */
export const COST_PER_SKILL_TOKENS = 80;
export const COST_PER_PLUGIN_TOKENS = 400;
export const COST_PER_MCP_TOKENS = 1500;
/** Memory of a bare session (MB), and of each MCP server it spawns (stdio). */
export const BASE_SESSION_MB = 250;
export const COST_PER_MCP_MB = 90;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Where a line of the chair comes from (the seal of the B1). */
export type SheetOrigin = 'donel' | 'papel' | 'usuario';

export interface SheetItem {
  readonly name: string;
  readonly on: boolean;
  readonly origin: SheetOrigin;
}

export interface SheetAxis {
  /** `all` = the role keeps everything of the user (axis absent or `*`); `list` = only what it names. */
  readonly mode: 'all' | 'list';
  readonly items: readonly SheetItem[];
  /** How many are on; `null` when unknown (every MCP of the user: the app does not read that list). */
  readonly onCount: number | null;
}

export interface ChairSheet {
  /** The app's frame: who the session is and the rule of the fixed role. */
  readonly frame: string;
  readonly guidance: string;
  readonly frameTokens: number;
  readonly guidanceTokens: number;
  readonly skills: SheetAxis;
  readonly plugins: SheetAxis;
  readonly mcps: SheetAxis;
  readonly cost: { readonly tokens: number; readonly memoryMb: number; readonly mcpsUncounted: boolean };
}

function isList(list: ScopeList | undefined): list is readonly string[] {
  return Array.isArray(list);
}

function axisOf(list: ScopeList | undefined, inventory: readonly string[], kept: (name: string, list: readonly string[]) => boolean): SheetAxis {
  const names = [...new Set(inventory)].sort((a, b) => a.localeCompare(b));
  if (!isList(list)) {
    const items = names.map((name) => ({ name, on: true, origin: 'usuario' as const }));
    return { mode: 'all', items, onCount: items.length };
  }
  const known = names.map((name) => ({ name, on: kept(name, list), origin: (kept(name, list) ? 'papel' : 'usuario') as SheetOrigin }));
  // A name the role keeps that the inventory does not have still shows (on, from the role).
  const extra = list.filter((name) => !names.some((known) => kept(known, [name]))).map((name) => ({ name, on: true, origin: 'papel' as const }));
  const items = [...known, ...extra].sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
  return { mode: 'list', items, onCount: items.filter((item) => item.on).length };
}

const sameName = (name: string, list: readonly string[]): boolean => list.includes(name);
/** `dev` keeps `dev@seazone-skills` (same rule as `buildRoleScopeSettings`). */
const pluginKept = (id: string, list: readonly string[]): boolean => list.some((entry) => entry === id || entry === id.split('@')[0]);

export function chairSheet(role: SessionRole, inventory: ClaudeInventory): ChairSheet {
  const prompt = rolePromptText(role);
  const guidance = role.guidance.trim();
  const frame = (guidance ? prompt.slice(0, prompt.indexOf(guidance)) : prompt).trim();
  const skills = axisOf(role.scope?.skills, inventory.skillNames, sameName);
  const plugins = axisOf(role.scope?.plugins, inventory.pluginIds, pluginKept);
  const named = isList(role.scope?.mcps) ? role.scope.mcps.filter((name) => name !== APP_MCP_NAME) : null;
  const mcpItems: SheetItem[] = [{ name: APP_MCP_NAME, on: true, origin: 'donel' }, ...(named ?? []).map((name) => ({ name, on: true, origin: 'papel' as const }))];
  const mcps: SheetAxis = named ? { mode: 'list', items: mcpItems, onCount: mcpItems.length } : { mode: 'all', items: mcpItems.slice(0, 1), onCount: null };

  const frameTokens = estimateTokens(frame);
  const guidanceTokens = estimateTokens(guidance);
  const onOf = (axis: SheetAxis): number => axis.items.filter((item) => item.on).length;
  const tokens = frameTokens + guidanceTokens + onOf(skills) * COST_PER_SKILL_TOKENS + onOf(plugins) * COST_PER_PLUGIN_TOKENS + onOf(mcps) * COST_PER_MCP_TOKENS;
  // The app's own MCP is served by the app (no process); the named ones are counted as local servers.
  const memoryMb = BASE_SESSION_MB + (named?.length ?? 0) * COST_PER_MCP_MB;
  return { frame, guidance, frameTokens, guidanceTokens, skills, plugins, mcps, cost: { tokens, memoryMb, mcpsUncounted: named === null } };
}
