// Mindscape desenho — key → board action, pure. The keys only exist with the
// Mindscape mounted and the focus inside it (the `<section>` listens), and
// never with the focus in a text field. Design: docs/design/mindscape-desenho.md,
// "Ferramentas, seleção e atalhos".

/** The tools of the bar. Fatia 01: V H A L R O; fatia 04: P (lápis) and E (borracha). */
export type MindscapeTool = 'select' | 'hand' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'pencil' | 'eraser';

export type MindscapeShortcut =
  | { readonly type: 'tool'; readonly tool: MindscapeTool }
  | { readonly type: 'escape' }
  /** Fatia 02 — Ctrl+Z / Ctrl+Shift+Z on the board (the text field keeps its own undo). */
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  /** Fatia 03 — Delete removes the selection (or the selected link). */
  | { readonly type: 'delete' }
  /** Fatia 03 — Ctrl+A: the visible cards and every drawing. */
  | { readonly type: 'select-all' }
  /** Fatia 03 — Ctrl+Shift+] / Ctrl+Shift+[ (by `key`: ABNT2 puts the brackets elsewhere than US). */
  | { readonly type: 'bring-to-front' }
  | { readonly type: 'send-to-back' };

export interface ShortcutInput {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  /** Focus in an `input`, `textarea`, `select` or `contenteditable` — the key belongs to the field. */
  readonly editable: boolean;
}

export const TOOL_KEYS: Readonly<Record<MindscapeTool, string>> = {
  select: 'v',
  hand: 'h',
  arrow: 'a',
  line: 'l',
  rect: 'r',
  ellipse: 'o',
  pencil: 'p',
  eraser: 'e',
};

const TOOL_BY_KEY: Readonly<Record<string, MindscapeTool>> = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([tool, key]) => [key, tool as MindscapeTool]),
);

export function mindscapeShortcut(input: ShortcutInput): MindscapeShortcut | null {
  if (input.editable) return null;
  if (input.key === 'Escape') return { type: 'escape' };
  // With Shift the key comes as "Z"; Ctrl only (no Alt/Meta).
  if (input.ctrl && !input.alt && !input.meta && input.key.toLowerCase() === 'z') return { type: input.shift ? 'redo' : 'undo' };
  if (input.key === 'Delete') return input.ctrl || input.alt || input.meta ? null : { type: 'delete' };
  if (input.ctrl && !input.alt && !input.meta) {
    if (!input.shift && input.key.toLowerCase() === 'a') return { type: 'select-all' };
    // With Shift, the bracket key may come as "]" or "}" (and "[" or "{"), depending on the layout.
    if (input.shift && (input.key === ']' || input.key === '}')) return { type: 'bring-to-front' };
    if (input.shift && (input.key === '[' || input.key === '{')) return { type: 'send-to-back' };
  }
  if (input.ctrl || input.alt || input.meta) return null;
  const tool = TOOL_BY_KEY[input.key.toLowerCase()];
  return tool ? { type: 'tool', tool } : null;
}
