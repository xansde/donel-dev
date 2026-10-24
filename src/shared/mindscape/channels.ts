// Mindscape (V1) — IPC of `window.donel.mindscape`. The main is the only writer
// of `mindscape.json`; the renderer owns the state in memory and sends the whole
// document (debounced). Design: docs/design/mindscape.md, "Contratos IPC".

import type { MindscapeDoc } from './model';

export const MINDSCAPE_CHANNELS = {
  load: 'mindscape:load',
  save: 'mindscape:save',
  /** main → renderer push: a session ended a turn (fatia 03, post-it written by the session). */
  turnEnded: 'mindscape:turn-ended',
} as const;

/** Payload of `mindscape:turn-ended`: `sessionId` is the `claudeSessionId` of the tab. */
export interface MindscapeTurnEndedPayload {
  readonly sessionId: string;
  readonly text: string;
  readonly at: number;
}

export type MindscapeSaveResult = { ok: true } | { ok: false; reason: 'read-only' | 'write-failed' };

export interface DonelMindscapeApi {
  load(): Promise<MindscapeDoc>;
  save(doc: MindscapeDoc): Promise<MindscapeSaveResult>;
  /** Subscribes to `mindscape:turn-ended`; returns the unsubscribe function. */
  onTurnEnded(listener: (payload: MindscapeTurnEndedPayload) => void): () => void;
}
