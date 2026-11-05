// Mindscape — what the renderer does with a failed load or save of
// `mindscape.json` (handoffs/mindscape-revisao.md, items 2 and 3). Pure: the
// hook (useMindscapeDoc) holds the timers and the IPC, this module decides.
// A board that did not load is never written (it would overwrite the file
// with an empty board); a save that fails is retried a few times and then
// shown, while the last version stays in memory to be written later.

import type { MindscapeDoc } from './model';
import type { MindscapeSaveResult } from './channels';

/** Waits before each retry of a failed save; after the last one, the failure is shown. */
export const MINDSCAPE_SAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 8000];

export type MindscapeLoadStatus = 'loading' | 'ready' | 'failed';
export type MindscapeSaveStatus = 'saved' | 'retrying' | 'failed' | 'read-only';

export interface MindscapeSaveDecision {
  readonly status: MindscapeSaveStatus;
  /** Wait before the next attempt; `null` = no retry. */
  readonly retryInMs: number | null;
}

/**
 * After a save returns. `result === null` is an IPC that rejected (treated as a
 * failed write); `retriesDone` counts the retries already made for this change.
 */
export function decideAfterSave(result: MindscapeSaveResult | null, retriesDone: number): MindscapeSaveDecision {
  if (result?.ok) return { status: 'saved', retryInMs: null };
  // Another channel upgraded the file: retrying will not make it older.
  if (result?.reason === 'read-only') return { status: 'read-only', retryInMs: null };
  const delay = MINDSCAPE_SAVE_RETRY_DELAYS_MS[retriesDone];
  return delay === undefined ? { status: 'failed', retryInMs: null } : { status: 'retrying', retryInMs: delay };
}

export interface MindscapeAlert {
  readonly kind: 'load-failed' | 'save-failed' | 'read-only';
  readonly text: string;
  /** Shows "Tentar de novo" (read the file again, or write the last version again). */
  readonly retry: boolean;
}

/** The warning of the Mindscape screen, or `null` when there is nothing to say. */
export function mindscapeAlert(load: MindscapeLoadStatus, save: MindscapeSaveStatus): MindscapeAlert | null {
  if (load === 'failed') return { kind: 'load-failed', text: 'Não consegui abrir o quadro — nada será gravado até reabrir.', retry: true };
  if (load !== 'ready') return null;
  if (save === 'failed') return { kind: 'save-failed', text: 'Não consegui gravar o quadro — as mudanças seguem só na memória.', retry: true };
  if (save === 'read-only') {
    return { kind: 'read-only', text: 'Este quadro foi gravado por uma versão mais nova do Donel Dev — nada daqui será gravado.', retry: false };
  }
  return null;
}

/** Closing the app: write the last version if the board loaded and that version was not saved yet. */
export function shouldFlushOnClose(load: MindscapeLoadStatus, current: MindscapeDoc, lastSaved: MindscapeDoc): boolean {
  return load === 'ready' && current !== lastSaved;
}
