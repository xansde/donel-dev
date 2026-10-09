// Adapted from pingdotgg/t3code@9f48092 apps/web/src/components/chat/useComposerTriggerState.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: the React hook became pure functions over an immutable state (the renderer keeps the state in
// its own store/reducer), so the "dismissed until the caret leaves the token" rule is testable without React.
// License text in ./LICENSE.

import type { ComposerTrigger } from './composerTrigger';

export interface ComposerTriggerState {
  /** The trigger the menu shows now (`null` = closed). */
  readonly trigger: ComposerTrigger | null;
  /** A trigger the owner closed with Esc; stays closed while the same token is under the caret. */
  readonly dismissed: ComposerTrigger | null;
}

export function initialTriggerState(trigger: ComposerTrigger | null = null): ComposerTriggerState {
  return { trigger, dismissed: null };
}

/** `candidate` unless it is the token the owner dismissed (same kind, same start). */
export function resolveTrigger(state: ComposerTriggerState, candidate: ComposerTrigger | null): ComposerTrigger | null {
  const { dismissed } = state;
  return candidate !== null && dismissed !== null && candidate.kind === dismissed.kind && candidate.rangeStart === dismissed.rangeStart
    ? null
    : candidate;
}

/** The text/caret changed: apply the dismissal rule; leaving the dismissed token forgets the dismissal. */
export function setTrigger(state: ComposerTriggerState, candidate: ComposerTrigger | null): ComposerTriggerState {
  const trigger = resolveTrigger(state, candidate);
  return { trigger, dismissed: candidate === null || trigger !== null ? null : state.dismissed };
}

/** Esc: close the menu and keep it closed for this token. */
export function dismissTrigger(_state: ComposerTriggerState, candidate: ComposerTrigger | null): ComposerTriggerState {
  return { trigger: null, dismissed: candidate };
}

/** Open (or replace) the trigger unconditionally, forgetting any dismissal. */
export function resetTrigger(_state: ComposerTriggerState, candidate: ComposerTrigger | null): ComposerTriggerState {
  return { trigger: candidate, dismissed: null };
}
