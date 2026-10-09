// T087 (014-chat) - pure decisions of the `/` and `@` menus of the composer: which key does what while a menu is
// open (Tab picks, Enter does NOT complete - it sends what is written, Esc closes), how the highlight moves, what
// text a pick inserts and how the matched part of a row is marked.

import type { ModelAlias } from '../../../../shared/commandBuilder';
import type { CommandEntry, CommandScope } from '../../../../shared/chat/ipc';
import { formatFileMention, replaceTextRange, type ComposerTrigger } from '../../../../shared/chat/t3/composerTrigger';

/** Origin chip of a `/` row (design T06-D: CLI, global, projeto; plus plugin, added by the conferência). */
export const SCOPE_BADGE: Readonly<Record<CommandScope, string>> = {
  builtin: 'CLI',
  user: 'global',
  project: 'projeto',
  plugin: 'plugin',
};

export type MenuKeyAction = 'prev' | 'next' | 'choose' | 'close';

export interface MenuKeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * What a key does while a menu with `itemCount` rows is showing; `null` = not the menu's business (the box
 * handles it as usual). Enter is deliberately absent: `/mod` + Enter sends `/mod`, it never completes to `/model`
 * (spec FR-017, B2 item 3). Shift+Tab stays the CLI's mode switch.
 */
export function menuKeyAction(input: MenuKeyInput, itemCount: number): MenuKeyAction | null {
  if (itemCount === 0 || input.ctrlKey || input.altKey || input.metaKey) return null;
  if (input.key === 'Escape') return 'close';
  if (input.shiftKey) return null;
  if (input.key === 'ArrowUp') return 'prev';
  if (input.key === 'ArrowDown') return 'next';
  if (input.key === 'Tab') return 'choose';
  return null;
}

/** The row after moving the highlight one step (wraps around). */
export function stepHighlight(ids: readonly string[], activeId: string | null, direction: 'prev' | 'next'): string | null {
  if (ids.length === 0) return null;
  const at = activeId === null ? -1 : ids.indexOf(activeId);
  if (at < 0) return ids[direction === 'next' ? 0 : ids.length - 1] ?? null;
  const delta = direction === 'next' ? 1 : -1;
  return ids[(at + delta + ids.length) % ids.length] ?? null;
}

/** The text with the picked row in place of the trigger (`/name ` or `@path `) and where the caret goes. */
export function insertionFor(text: string, trigger: ComposerTrigger, picked: { readonly kind: 'command'; readonly entry: CommandEntry } | { readonly kind: 'file'; readonly path: string }): { text: string; cursor: number } {
  const body = picked.kind === 'command' ? `/${picked.entry.name}` : formatFileMention(picked.path);
  // A space already follows the token (the caret was in the middle of a message): reuse it instead of doubling.
  const spaceFollows = text.charAt(trigger.rangeEnd) === ' ';
  const result = replaceTextRange(text, trigger.rangeStart, trigger.rangeEnd, spaceFollows ? body : `${body} `);
  return spaceFollows ? { text: result.text, cursor: result.cursor + 1 } : result;
}

/** Half-open range of `value` to mark as the match of `query` (prefix first, then the first occurrence); `null` = none. */
export function matchRange(value: string, query: string): readonly [number, number] | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const at = value.toLowerCase().indexOf(q);
  return at < 0 ? null : [at, at + q.length];
}

// --- model picker (Alt+P / a bare `/model`): the CLI's own picker only exists in the terminal, so the chat lists
// the aliases in the same menu and sends `/model <alias>` through the ordinary send path.

/** The aliases the launcher offers (same list as `ModelAlias`). */
export const MODEL_CHOICES: readonly ModelAlias[] = ['fable', 'opus', 'sonnet', 'haiku'];

/** The message a pick sends. */
export const modelCommandText = (alias: ModelAlias): string => `/model ${alias}`;

/** A bare `/model` (no argument) would open the CLI picker; the box opens its own instead of sending it. */
export const isBareModelCommand = (text: string): boolean => text.trim() === '/model';

/** Keys of the model menu: like `menuKeyAction`, but Enter picks too (nothing written is competing with it). */
export function modelMenuKeyAction(input: MenuKeyInput, itemCount: number): MenuKeyAction | null {
  if (input.key === 'Enter' && !input.shiftKey && !input.ctrlKey && !input.altKey && !input.metaKey) return itemCount === 0 ? null : 'choose';
  return menuKeyAction(input, itemCount);
}
