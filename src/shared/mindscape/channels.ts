// Mindscape (V1) — IPC of `window.donel.mindscape`. The main is the only writer
// of `mindscape.json`; the renderer owns the state in memory and sends the whole
// document (debounced). Design: docs/design/mindscape.md, "Contratos IPC".

import type { MindscapeDoc } from './model';

export const MINDSCAPE_CHANNELS = {
  load: 'mindscape:load',
  save: 'mindscape:save',
} as const;

export type MindscapeSaveResult = { ok: true } | { ok: false; reason: 'read-only' | 'write-failed' };

export interface DonelMindscapeApi {
  load(): Promise<MindscapeDoc>;
  save(doc: MindscapeDoc): Promise<MindscapeSaveResult>;
}
