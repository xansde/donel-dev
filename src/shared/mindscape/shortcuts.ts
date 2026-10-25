// Mindscape desenho — key → board action, pure. The keys only exist with the
// Mindscape mounted and the focus inside it (the `<section>` listens), and
// never with the focus in a text field. Design: docs/design/mindscape-desenho.md,
// "Ferramentas, seleção e atalhos".

/** The tools of the bar. Fatia 01: V H A L R O (P and E come in fatia 04). */
export type MindscapeTool = 'select' | 'hand' | 'arrow' | 'line' | 'rect' | 'ellipse';

export type MindscapeShortcut = { readonly type: 'tool'; readonly tool: MindscapeTool } | { readonly type: 'escape' };

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
};

const TOOL_BY_KEY: Readonly<Record<string, MindscapeTool>> = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([tool, key]) => [key, tool as MindscapeTool]),
);

export function mindscapeShortcut(input: ShortcutInput): MindscapeShortcut | null {
  if (input.editable) return null;
  if (input.key === 'Escape') return { type: 'escape' };
  if (input.ctrl || input.alt || input.meta) return null;
  const tool = TOOL_BY_KEY[input.key.toLowerCase()];
  return tool ? { type: 'tool', tool } : null;
}
