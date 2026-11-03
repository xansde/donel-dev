// Navegador integrado — `navegador_teclar("Ctrl+Enter")` into CDP `Input.dispatchKeyEvent` params. Pure.
//
// A combo is modifiers + one key, joined by `+` (`Enter`, `Shift+Tab`, `Ctrl+A`, `PageDown`, `F5`, `/`).
// Names are case-insensitive and accept the usual aliases (`Esc`, `Return`, `Del`, `Up`, `Espaço`).

export interface CdpKeyEvent {
  readonly type: 'keyDown' | 'rawKeyDown' | 'keyUp';
  readonly modifiers: number;
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode: number;
  readonly text?: string;
  readonly unmodifiedText?: string;
}

export type KeyComboResult = { readonly ok: true; readonly events: readonly CdpKeyEvent[] } | { readonly ok: false; readonly reason: string };

/** CDP modifier bits. */
export const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

const MODIFIER_ALIASES: Record<string, keyof typeof MODIFIER_BITS> = {
  alt: 'alt',
  option: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
  shift: 'shift',
};

interface KeyDef {
  readonly key: string;
  readonly code: string;
  readonly vk: number;
  readonly text?: string;
}

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  insert: { key: 'Insert', code: 'Insert', vk: 45 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
};

const KEY_ALIASES: Record<string, string> = {
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pagedn: 'pagedown',
  espaço: 'space',
  espaco: 'space',
  spacebar: 'space',
};

/** Printable characters that have their own physical key on a US layout (for `code`/`vk`). */
const PUNCTUATION: Record<string, { code: string; vk: number }> = {
  '/': { code: 'Slash', vk: 191 },
  '.': { code: 'Period', vk: 190 },
  ',': { code: 'Comma', vk: 188 },
  ';': { code: 'Semicolon', vk: 186 },
  '-': { code: 'Minus', vk: 189 },
  '=': { code: 'Equal', vk: 187 },
  '[': { code: 'BracketLeft', vk: 219 },
  ']': { code: 'BracketRight', vk: 221 },
  "'": { code: 'Quote', vk: 222 },
  '`': { code: 'Backquote', vk: 192 },
  '\\': { code: 'Backslash', vk: 220 },
};

function resolveKey(raw: string): KeyDef | null {
  const lower = raw.toLowerCase();
  const named = NAMED_KEYS[KEY_ALIASES[lower] ?? lower];
  if (named) return named;
  const fn = /^f([1-9]|1[0-2])$/.exec(lower);
  if (fn) {
    const n = Number(fn[1]);
    return { key: `F${n}`, code: `F${n}`, vk: 111 + n };
  }
  if ([...raw].length !== 1) return null;
  if (/^[a-z]$/i.test(raw)) return { key: lower, code: `Key${lower.toUpperCase()}`, vk: lower.toUpperCase().charCodeAt(0), text: lower };
  if (/^[0-9]$/.test(raw)) return { key: raw, code: `Digit${raw}`, vk: raw.charCodeAt(0), text: raw };
  const punct = PUNCTUATION[raw];
  if (punct) return { key: raw, code: punct.code, vk: punct.vk, text: raw };
  // Any other single printable character (accents, `?`, `@`...): key + text is enough for the page.
  if (/^\P{C}$/u.test(raw)) return { key: raw, code: '', vk: 0, text: raw };
  return null;
}

/** Turns `"Ctrl+Shift+K"` into the keyDown/keyUp pair CDP expects. */
export function parseKeyCombo(input: string): KeyComboResult {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: false, reason: 'Tecla vazia.' };
  // `+` alone (or at the end, as in `Ctrl++`) is the plus key itself.
  const parts = text === '+' ? ['+'] : text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  if (parts.some((part) => part.trim() === '')) return { ok: false, reason: `Combinação inválida: "${text}". Use, por exemplo, "Ctrl+Enter".` };
  const keyName = parts[parts.length - 1].trim();
  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!modifier) return { ok: false, reason: `Modificador desconhecido: "${part.trim()}". Use Ctrl, Shift, Alt ou Meta.` };
    modifiers |= MODIFIER_BITS[modifier];
  }
  const def = resolveKey(keyName);
  if (!def) return { ok: false, reason: `Tecla desconhecida: "${keyName}". Exemplos: Enter, Tab, Escape, ArrowDown, PageDown, F5, Ctrl+A.` };

  const shift = (modifiers & MODIFIER_BITS.shift) !== 0;
  // With Ctrl/Alt/Meta the key is a shortcut, not typing: no text, `rawKeyDown`.
  const command = (modifiers & (MODIFIER_BITS.ctrl | MODIFIER_BITS.alt | MODIFIER_BITS.meta)) !== 0;
  const typed = def.text !== undefined && !command ? (shift && /^[a-z]$/.test(def.text) ? def.text.toUpperCase() : def.text) : undefined;
  const key = typed !== undefined && def.text !== '\r' && def.text !== ' ' ? typed : def.key;
  const base = { modifiers, key, code: def.code, windowsVirtualKeyCode: def.vk };
  const down: CdpKeyEvent = typed !== undefined ? { type: 'keyDown', ...base, text: typed, unmodifiedText: def.text } : { type: 'rawKeyDown', ...base };
  return { ok: true, events: [down, { type: 'keyUp', ...base }] };
}
