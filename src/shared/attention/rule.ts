// notificacoes-completas (30/10) — THE rule of "avisar", one place for every channel that tells the owner
// something about a session: the Jobu's bubble, the Windows toast, the taskbar flash and the taskbar badge.
//
// The news itself is born in the pet core (src/shared/pet/petState.ts, `trackSession`), which is fed ALWAYS,
// with the Jobu on or off: a wait that starts out of the owner's sight is a `BubbleEvent`. WHETHER a wait is
// news and of WHAT kind is decided here (`newWaitNotice`), and so is which channel says it (`shouldToast`),
// what the toast says (`noticeToast`) and when the taskbar flashes (`shouldFlash`). Pure: no Electron, no clock.
//
// Who the owner is looking at: its tab in front, in a Donel window that has the focus. That session never
// gives news (the core marks its wait "seen" at birth). With the Jobu on, the bubble is the channel and the
// toast stays quiet (FR-020 of 015, also while he is silenced or hidden by a full-screen app); with him off,
// the toast covers it. The badge and the flash are the taskbar's and work with or without him.

import type { NotificationPreference } from '../config';
import { truncateTabName } from '../pet/bubble';
import type { BubbleEvent, BubbleEventKind, PetSemaphore, SemaphorePublicState } from '../pet/types';

/**
 * From what the semaphore published to what the owner should read (R2 of 015): no update at all is `idle` (a tab
 * that was just opened is not "working" because the semaphore is born that way), and `error` is `done`.
 *
 * #109: a `waiting` the semaphore marks `awaitingBackgroundAgents` is a turn that ended while sub-agents still run
 * in the background; each of them wakes the session when it finishes. It reads as `working` until the turn that
 * ends with none alive, which is the real end (and the one notice). A turn that ended in an API error
 * (`StopFailure`: usage limit, overload, login) is the exception: nothing will carry on by itself, so it is a
 * real wait even with sub-agents alive.
 */
export function toAttentionSignal(published: SemaphorePublicState | undefined, awaitingBackgroundAgents = false, failed = false): PetSemaphore {
  if (published === undefined) return 'idle';
  if (published === 'waiting' && awaitingBackgroundAgents && !failed) return 'working';
  return published === 'error' ? 'done' : published;
}

export interface NewWaitInput {
  /** The session was already known before this signal: one met for the first time never gives news, nobody saw it change. */
  readonly known: boolean;
  readonly semaphore: 'waiting' | 'permission';
  /** The owner is looking at it right now (its tab in front, the Donel focused). */
  readonly seenNow: boolean;
  /** Short reason when the turn ended in an API error (`failureReasonText`); `null` = a normal end. */
  readonly failure: string | null;
}

/**
 * A wait was just born: is it news, and of what kind? `blocked` when the session asks for something (a pending wins
 * over a failure), `failed` when the turn ended in an API error, `finished` otherwise. `null` when the owner is
 * looking at it, or when the session was met right now.
 */
export function newWaitNotice(input: NewWaitInput): Exclude<BubbleEventKind, 'ended'> | null {
  if (!input.known || input.seenNow) return null;
  if (input.semaphore === 'permission') return 'blocked';
  return input.failure !== null ? 'failed' : 'finished';
}

export interface ToastDecisionInput {
  readonly kind: BubbleEventKind;
  /** The Jobu is on screen: his bubble is the channel. */
  readonly petEnabled: boolean;
  readonly preference: NotificationPreference;
  /**
   * The chat is on: it raises its own toast for every pending it opens (T079), with what the pending is, and its
   * click opens the pending panel. A `blocked` here would be the same news twice.
   */
  readonly chatCoversPending: boolean;
}

/** Kinds that need the owner to act: the default preference ("Só permissão pendente") says these and only these. */
const NEEDS_OWNER: ReadonlySet<BubbleEventKind> = new Set(['blocked', 'failed']);

/** Is the Windows toast the channel for this news? */
export function shouldToast(input: ToastDecisionInput): boolean {
  if (input.petEnabled || input.preference === 'none') return false;
  if (input.kind === 'blocked' && input.chatCoversPending) return false;
  if (input.preference === 'permission-only') return NEEDS_OWNER.has(input.kind);
  return true;
}

/** What the pending of a `blocked` session is, for the body of the toast (never its content, D-C17). */
const BLOCKED_BODY = {
  question: 'Tem uma pergunta para você.',
  permission: 'Quer permissão para continuar.',
  plan: 'Tem um plano para aprovar.',
} as const;

/** The text of the toast: who and what in the title, short pt-BR; the body adds what a click leads to. */
export function noticeToast(event: BubbleEvent): { readonly title: string; readonly body: string } {
  const name = truncateTabName(event.name);
  switch (event.kind) {
    case 'finished':
      return { title: `${name} terminou`, body: 'Clique para abrir a sessão.' };
    case 'blocked':
      return { title: `${name} precisa de você`, body: BLOCKED_BODY[event.blockedKind ?? 'permission'] };
    case 'failed':
      return { title: event.reason ? `${name} parou com erro: ${event.reason}` : `${name} parou com erro`, body: 'Clique para abrir a sessão.' };
    case 'ended':
      return { title: `${name} encerrou`, body: 'O processo da sessão saiu.' };
  }
}

/** The `error` codes of the `StopFailure` hook (read in the CLI 2.1.3xx schema) in a few words of pt-BR. */
const FAILURE_REASONS: Readonly<Record<string, string>> = {
  rate_limit: 'limite de uso',
  billing_error: 'problema de cobrança',
  authentication_failed: 'login expirado',
  oauth_org_not_allowed: 'login não permitido',
  account_on_hold: 'conta suspensa',
  verification_required: 'verificação pendente',
  overloaded: 'API sobrecarregada',
  invalid_request: 'pedido inválido',
  model_not_found: 'modelo não encontrado',
  server_error: 'erro da API',
  max_output_tokens: 'resposta longa demais',
  cloud_credential_error: 'credencial da nuvem',
};

/** The reason of a failed turn: the known code in words, anything else (a new code, nothing at all) is "erro da API". */
export function failureReasonText(error: unknown): string {
  return typeof error === 'string' && Object.hasOwn(FAILURE_REASONS, error) ? FAILURE_REASONS[error] : 'erro da API';
}

/** The taskbar button flashes when news arrives with the Donel not in front, unless the owner turned the notices off. */
export function shouldFlash(input: { readonly preference: NotificationPreference; readonly windowInFront: boolean; readonly notices: number }): boolean {
  return input.notices > 0 && !input.windowInFront && input.preference !== 'none';
}

/** What a screen reader says of the badge over the taskbar button. */
export function overlayDescription(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 sessão esperando você' : `${count} sessões esperando você`;
}
