// Mindscape (V1 + desenho) — IPC of `window.donel.mindscape`. The main is the only writer
// of `mindscape.json`; the renderer owns the state in memory and sends the whole
// document (debounced). Design: docs/design/mindscape.md, "Contratos IPC".

import type { BoardToolCall } from './agent-tools';
import type { MindscapeDoc } from './model';

export const MINDSCAPE_CHANNELS = {
  load: 'mindscape:load',
  save: 'mindscape:save',
  /** main → renderer push: a session ended a turn (fatia 03, post-it written by the session). */
  turnEnded: 'mindscape:turn-ended',
  /** Desenho, fatia 06 — renderer → main: the bytes of a pasted/dropped print; the main names the file. */
  saveImage: 'mindscape:save-image',
  /** Desenho, fatia 06 — renderer → main: the bytes of a print, by imageId. */
  readImage: 'mindscape:read-image',
  /** Quadro por MCP — main → renderer: a session called a board tool (`MindscapeBoardRequest`). */
  boardRequest: 'mindscape:board-request',
  /** Quadro por MCP — renderer → main: the answer to `boardRequest` (`MindscapeBoardResponse`). */
  boardRespond: 'mindscape:board-respond',
} as const;

/** A board tool call of the session of `ptyId`; the renderer answers with the same `requestId`. */
export interface MindscapeBoardRequest {
  readonly requestId: string;
  readonly ptyId: string;
  readonly call: BoardToolCall;
}

export interface MindscapeBoardResponse {
  readonly requestId: string;
  readonly ok: boolean;
  /** JSON text for the agent (ok) or the reason, in Portuguese (not ok). */
  readonly text: string;
}

/** Payload of `mindscape:turn-ended`: `sessionId` is the `claudeSessionId` of the tab. */
export interface MindscapeTurnEndedPayload {
  readonly sessionId: string;
  readonly text: string;
  readonly at: number;
}

export type MindscapeSaveResult = { ok: true } | { ok: false; reason: 'read-only' | 'write-failed' };

/** Payload of `mindscape:save-image`. */
export interface MindscapeSaveImageInput {
  readonly bytes: ArrayBuffer;
  readonly mediaType: string;
}

export type MindscapeSaveImageResult = { ok: true; imageId: string } | { ok: false; reason: 'type' | 'too-big' | 'not-image' | 'write-failed' };

export type MindscapeReadImageResult = { ok: true; bytes: Uint8Array; mediaType: string } | { ok: false };

export interface DonelMindscapeApi {
  /** Missing file → empty document; rejects when the file exists but is unreadable or not a document (never write over it). */
  load(): Promise<MindscapeDoc>;
  save(doc: MindscapeDoc): Promise<MindscapeSaveResult>;
  /** Subscribes to `mindscape:turn-ended`; returns the unsubscribe function. */
  onTurnEnded(listener: (payload: MindscapeTurnEndedPayload) => void): () => void;
  /** Desenho, fatia 06 — stores a print (PNG, JPEG or WebP, up to 10 MB); the main checks it all again. */
  saveImage(bytes: ArrayBuffer, mediaType: string): Promise<MindscapeSaveImageResult>;
  /** Desenho, fatia 06 — the bytes of a print (the renderer makes a `blob:` URL of them). */
  readImage(imageId: string): Promise<MindscapeReadImageResult>;
  /** Quadro por MCP — subscribes to the board tool calls of the sessions; returns the unsubscribe function. */
  onBoardRequest(listener: (request: MindscapeBoardRequest) => void): () => void;
  /** Quadro por MCP — the answer to one `onBoardRequest`. */
  respondBoard(response: MindscapeBoardResponse): void;
}
