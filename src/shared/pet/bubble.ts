// T031 (015-jobu-pet, US2) - the words and the shape of the bubble: what each event says (FR-015), the
// pose it brings (FR-016), how tab names are cut, and what a group of events says as ONE bubble
// (FR-017). Pure: no clock, no state. WHEN a bubble is born, joined, refined or dismissed is the
// reducer's business (petState.ts); this file only answers "what would it say?".
//
// Nothing here reads the conversation: the only inputs are the name of a tab, the kind of an event and,
// for a blocked session, the kind of its pending (FR-018).

import { formatBytes } from '../format-bytes';
import type { BubbleEvent, BubbleTarget, PoseName, SweepBubbleSummary } from './types';

/** FR-017: a bubble stays about this long. */
export const PET_BUBBLE_MS = 6_000;
/** FR-017: an event that arrives up to this long after a bubble was born joins it instead of replacing it. */
export const PET_BUBBLE_JOIN_MS = 1_000;
/** FR-015: a tab name longer than this is cut and closed with an ellipsis. */
export const PET_BUBBLE_NAME_MAX = 28;

/**
 * Names over 28 characters keep the first 28 and take an ellipsis: `abc…`. Counted in characters, not in
 * UTF-16 units, so an emoji at the edge is never cut in half.
 */
export function truncateTabName(name: string): string {
  const characters = [...name];
  if (characters.length <= PET_BUBBLE_NAME_MAX) return name;
  return `${characters.slice(0, PET_BUBBLE_NAME_MAX).join('')}…`;
}

/** What the session waits for, in the words of FR-015. A kind that is not known (no chat) is the permission, the common case (R3). */
const BLOCKED_TEXT = {
  question: 'tem uma pergunta',
  permission: 'quer permissão',
  plan: 'plano para aprovar',
} as const;

/** The text of ONE event: `<aba> · terminou`, `<aba> · tem uma pergunta`, `<aba> · quer permissão`, `<aba> · plano para aprovar`, `<aba> · encerrou`. */
export function eventText(event: BubbleEvent): string {
  const name = truncateTabName(event.name);
  switch (event.kind) {
    case 'finished':
      return `${name} · terminou`;
    case 'blocked':
      return `${name} · ${BLOCKED_TEXT[event.blockedKind ?? 'permission']}`;
    case 'failed':
      // notificacoes-completas: a turn that ended in an API error, with the short reason when the hook said it.
      return event.reason ? `${name} · erro: ${event.reason}` : `${name} · parou com erro`;
    case 'ended':
      return `${name} · encerrou`;
  }
}

/** FR-016: calling (finished), surprised (blocked), sad (ended, failed). */
export function eventPose(event: BubbleEvent): PoseName {
  switch (event.kind) {
    case 'finished':
      return 'calling';
    case 'blocked':
      return 'surprised';
    case 'failed':
    case 'ended':
      return 'sad';
  }
}

const NAME_EVENT_SEPARATOR = ' · ';

/**
 * The text of a bubble about ONE session, split in the tab name and what happened, so the screen can give
 * the name its own face and cut only IT when the line is too long (the event is what matters). It splits
 * at the last separator: a name can have ` · ` inside, none of the events does. `null` for a text that is
 * not `<aba> · <evento>` (an aggregate, an account).
 */
export function splitSessionBubbleText(text: string): { readonly name: string; readonly event: string } | null {
  const at = text.lastIndexOf(NAME_EVENT_SEPARATOR);
  if (at <= 0) return null;
  return { name: text.slice(0, at), event: text.slice(at + NAME_EVENT_SEPARATOR.length) };
}

/** What the screen needs of a bubble that the clock does not decide: the words, the pose and where a click goes. */
export interface BubbleFace {
  readonly text: string;
  readonly pose: PoseName;
  readonly target: BubbleTarget;
}

/**
 * The bubble of a change of account (US4, FR-015, FR-016): `Conta → <rótulo>`, the mirror, and a click brings the
 * Donel to the front (FR-025). The label is what the owner called the account, never an e-mail (FR-018), and is
 * cut like the name of a tab when it is long.
 */
export function accountBubbleFace(label: string): BubbleFace {
  return { text: `Conta → ${truncateTabName(label)}`, pose: 'mirror', target: { kind: 'donel' } };
}

/** The facts of a sweep a bubble can carry, most important first; the line keeps only the first two so it stays small. */
const SWEEP_FACTS_MAX = 2;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The bubble of "Fazer faxina" (016): `Faxina · 319 MB liberados · 34 separados`, `Faxina · nada a limpar` or `Faxina · falhou`.
 * A click opens the folder of the sweep when there is one (the receipt of the deleted branches and the `resumo.html`
 * live there), and brings the Donel to the front otherwise. Totals only: no repo, branch or path name is ever said.
 */
export function sweepBubbleFace(summary: SweepBubbleSummary): BubbleFace {
  if (summary.failed) return { text: 'Faxina · falhou', pose: 'sad', target: { kind: 'donel' } };
  const target: BubbleTarget = summary.folder === null ? { kind: 'donel' } : { kind: 'folder', path: summary.folder };
  const facts: string[] = [];
  if (summary.freedBytes > 0) facts.push(`${formatBytes(summary.freedBytes)} liberados`);
  if (summary.separatedItems > 0) facts.push(`${summary.separatedItems} separados`);
  if (summary.branchesDeleted > 0) facts.push(plural(summary.branchesDeleted, 'branch', 'branches'));
  if (summary.worktreesRemoved > 0) facts.push(plural(summary.worktreesRemoved, 'worktree', 'worktrees'));
  if (facts.length === 0) return { text: 'Faxina · nada a limpar', pose: 'neutral', target };
  return { text: `Faxina · ${facts.slice(0, SWEEP_FACTS_MAX).join(' · ')}`, pose: 'talking', target };
}

/**
 * The bubble that says a set of session events (one per session). One event speaks for itself and a click
 * leads to its tab. Two or more become a count, and a click opens the list: `N sessões terminaram` when
 * they all finished, `N sessões encerraram` when they all ended (Q9), and `N sessões esperando você` when
 * the kinds mix or when they are all blocked - an `ended` among the others counts as one more waiting.
 * The aggregate never names a tab.
 */
export function composeBubble(events: readonly BubbleEvent[]): BubbleFace {
  const [first] = events;
  if (first === undefined) throw new RangeError('composeBubble: no events to say');
  if (events.length === 1) return { text: eventText(first), pose: eventPose(first), target: { kind: 'session', ptyId: first.ptyId } };

  const count = events.length;
  if (events.every((event) => event.kind === 'finished')) return { text: `${count} sessões terminaram`, pose: 'calling', target: { kind: 'list' } };
  if (events.every((event) => event.kind === 'ended')) return { text: `${count} sessões encerraram`, pose: 'sad', target: { kind: 'list' } };
  return { text: `${count} sessões esperando você`, pose: 'surprised', target: { kind: 'list' } };
}
