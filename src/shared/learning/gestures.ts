// Diário de gestos (docs/refinamentos/mindscape-lugar-principal.md, rules 9–11) — what the owner
// does, kept ONLY on this machine as examples for a local model to learn from later (B35, Laya).
// One JSON object per line in `<userData>/aprendizado/gestos-AAAA-MM.jsonl`. The main is the only
// writer; it records the session events itself and takes the screen gestures from the renderer
// through `learning:record`, validated here. Pure: no fs, no Electron.

/** Same cap as the post-it written by the session. */
export const GESTURE_TEXT_MAX_CHARS = 4000;

export const LEARNING_CHANNELS = {
  record: 'learning:record',
} as const;

export type SessionOpenedVia = 'aba' | 'mindscape' | 'retomar';
export type MindscapeGestureAction = 'organizar' | 'arquivar' | 'mostrar-antigas';

/** What the renderer may report (the main stamps the time). */
export type RendererGesture =
  | { readonly type: 'sessao-aberta'; readonly sessionId: string; readonly via: SessionOpenedVia }
  | {
      readonly type: 'mindscape';
      readonly acao: MindscapeGestureAction;
      readonly projectPath: string;
      readonly cardKind?: 'session-note' | 'owner';
      readonly sessionId?: string;
    };

/** A line of the diary. */
export type GestureEvent =
  | { readonly type: 'turno-terminou'; readonly sessionId: string; readonly text: string; readonly at: number }
  | { readonly type: 'pedido-enviado'; readonly sessionId: string; readonly promptLength: number; readonly at: number }
  | (RendererGesture & { readonly at: number });

const VIA: readonly SessionOpenedVia[] = ['aba', 'mindscape', 'retomar'];
const ACTIONS: readonly MindscapeGestureAction[] = ['organizar', 'arquivar', 'mostrar-antigas'];
const CARD_KINDS = ['session-note', 'owner'] as const;
const MAX_ID_CHARS = 200;
const MAX_PATH_CHARS = 1024;

function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** Never trusts the renderer: anything else is `null` and nothing is written. */
export function parseRendererGesture(raw: unknown): RendererGesture | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.type === 'sessao-aberta') {
    if (!shortString(value.sessionId, MAX_ID_CHARS) || !VIA.includes(value.via as SessionOpenedVia)) return null;
    return { type: 'sessao-aberta', sessionId: value.sessionId, via: value.via as SessionOpenedVia };
  }
  if (value.type === 'mindscape') {
    if (!ACTIONS.includes(value.acao as MindscapeGestureAction) || !shortString(value.projectPath, MAX_PATH_CHARS)) return null;
    const gesture: { type: 'mindscape'; acao: MindscapeGestureAction; projectPath: string; cardKind?: 'session-note' | 'owner'; sessionId?: string } = {
      type: 'mindscape',
      acao: value.acao as MindscapeGestureAction,
      projectPath: value.projectPath,
    };
    if (value.cardKind !== undefined) {
      if (!CARD_KINDS.includes(value.cardKind as 'session-note' | 'owner')) return null;
      gesture.cardKind = value.cardKind as 'session-note' | 'owner';
    }
    if (value.sessionId !== undefined) {
      if (!shortString(value.sessionId, MAX_ID_CHARS)) return null;
      gesture.sessionId = value.sessionId;
    }
    return gesture;
  }
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** One file per local month: never rewritten, never deleted by the app. */
export function gestureFileName(at: number): string {
  const date = new Date(at);
  return `gestos-${date.getFullYear()}-${pad2(date.getMonth() + 1)}.jsonl`;
}

/** The line written for an event (the text of a turn is cut at the cap). */
export function gestureLine(event: GestureEvent): string {
  const safe = event.type === 'turno-terminou' ? { ...event, text: event.text.slice(0, GESTURE_TEXT_MAX_CHARS) } : event;
  return `${JSON.stringify(safe)}\n`;
}

/** `window.donel.learning` — fire and forget; nothing comes back. */
export interface DonelLearningApi {
  record(gesture: RendererGesture): void;
}
