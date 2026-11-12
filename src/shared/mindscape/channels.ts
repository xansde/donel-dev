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
  /** Cartas forma A — main → renderer: deliver what the owner wrote on a card (`MindscapeOwnerMessageRequest`). */
  ownerMessage: 'mindscape:owner-message',
  /** renderer → main: where it went (`MindscapeOwnerMessageResponse`). */
  ownerMessageRespond: 'mindscape:owner-message-respond',
} as const;

/** What the owner wrote on a card: to the session of `placeId`, or (closed) to the Líder único with `leaderText`. */
export interface MindscapeOwnerMessageRequest {
  readonly requestId: string;
  readonly projectPath: string;
  readonly placeId: string;
  readonly text: string;
  readonly leaderText: string;
}

export interface MindscapeOwnerMessageResponse {
  readonly requestId: string;
  /** `{ placeId }` = the session that owns the task; `'lider'` = the Líder único; `null` = nobody open. */
  readonly deliveredTo: { readonly placeId: string } | 'lider' | null;
}

/**
 * 12/11 (t-58d7c191) — the CLI cuts an MCP call at 60 s when its config has no `timeout` ("The operation timed out."):
 * every session opened by an app older than #386 has none, and a live session keeps its config until it is born again.
 * The sender then sends again and the message goes in twice. So `sessao_enviar` answers well before 60 s, counted from
 * the call's arrival in the main (the clock nearest to the wire): the renderer stops waiting for the delivery at
 * `SEND_ANSWER_BY_MS` ("ainda não entrou; NÃO mande de novo"), and the main answers by itself at `SEND_NET_MS` when the
 * renderer did not. The rest (up to 60 s) is margin: a busy renderer answered up to 25 s past its own wait (t-81ff5a82),
 * and the round trip through a loaded VPS's gate took up to 21 s.
 */
export const SEND_ANSWER_BY_MS = 25_000;
export const SEND_NET_MS = 40_000;

/** A board tool call of the session of `ptyId`; the renderer answers with the same `requestId`. */
export interface MindscapeBoardRequest {
  readonly requestId: string;
  readonly ptyId: string;
  readonly call: BoardToolCall;
  /** Epoch ms by which the renderer answers a call that waits (today `sessao_enviar`); absent = its own default. */
  readonly answerBy?: number;
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
  /** Cartas forma A — what the owner wrote on a card, to deliver; returns the unsubscribe function. */
  onOwnerMessage(listener: (request: MindscapeOwnerMessageRequest) => void): () => void;
  respondOwnerMessage(response: MindscapeOwnerMessageResponse): void;
}
