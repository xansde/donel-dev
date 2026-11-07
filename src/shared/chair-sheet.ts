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

export interface ChairScreenKey {
  readonly key: string;
  readonly defaultPrevented: boolean;
  /** The focus is inside the chair screen. */
  readonly focusInScreen: boolean;
  /** Nothing has the focus (it fell on the page when the focused button went away, as "Recolher ›" does). */
  readonly focusOnPage: boolean;
}

/** Esc closes the chair screen with the focus in it or dropped on the page; never from a dialog over it (Papéis). */
export function escapeClosesChairScreen(input: ChairScreenKey): boolean {
  return input.key === 'Escape' && !input.defaultPrevented && (input.focusInScreen || input.focusOnPage);
}

// ---------------------------------------------------------------------------
// Cadeiras, fatia 3 — editing the chair writes into its role. Every change keeps the other items and axes: an axis
// that kept everything becomes the full list minus what was turned off, never an empty one.
// ---------------------------------------------------------------------------

export type ScopeAxisName = 'skills' | 'plugins' | 'mcps';

function withAxis(role: SessionRole, axis: ScopeAxisName, list: ScopeList): SessionRole {
  return { ...role, scope: { ...role.scope, [axis]: list } };
}

/** Turns one item of an axis on or off. The app's MCP never leaves; with every MCP of the user kept, nothing changes (the app does not know that list). */
export function setScopeItem(role: SessionRole, axis: ScopeAxisName, name: string, on: boolean, inventory: ClaudeInventory): SessionRole {
  const current = role.scope?.[axis];
  if (axis === 'mcps') {
    if (name === APP_MCP_NAME || !isList(current)) return role;
    const has = current.includes(name);
    if (has === on) return role;
    return withAxis(role, axis, on ? [...current, name] : current.filter((entry) => entry !== name));
  }
  const names = axis === 'skills' ? inventory.skillNames : inventory.pluginIds;
  const kept = axis === 'skills' ? sameName : pluginKept;
  const list = isList(current) ? current : [...new Set(names)];
  if (kept(name, list) === on) return role;
  // Off: drop every entry that keeps it (a plugin kept by its short name too). On: add it by its full name.
  const next = on ? [...list, name] : list.filter((entry) => !kept(name, [entry]));
  return withAxis(role, axis, next);
}

/** Adds an MCP by name to a role that names its MCPs (never to one that keeps them all: that would drop the rest). */
export function addScopeMcp(role: SessionRole, name: string): SessionRole {
  const trimmed = name.trim();
  const current = role.scope?.mcps;
  if (!trimmed || trimmed === APP_MCP_NAME || !isList(current) || current.includes(trimmed)) return role;
  return withAxis(role, 'mcps', [...current, trimmed]);
}

/** "Usar todos": the axis keeps everything of the user again (written as `*`, so a factory list is not inherited). */
export function setScopeAll(role: SessionRole, axis: ScopeAxisName): SessionRole {
  return role.scope?.[axis] === '*' ? role : withAxis(role, axis, '*');
}
