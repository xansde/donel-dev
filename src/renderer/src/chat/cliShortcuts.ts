// 014-chat - the CLI shortcuts the chat box takes over. The CLI binds these keys itself; in the chat the focus is
// in a textarea, so the key either does nothing or does something else. Source: default keybindings extracted from
// the `claude` binary 2.1.295 (contexts Global and Chat), classified once here:
//   - forward: the box swallows the key and writes the bytes xterm.js would send (Alt = ESC + letter on Windows);
//   - native: the chat has its own answer, because the CLI one only exists in the terminal (a picker, the
//     transcript screen);
//   - everything else stays with the box, on purpose: enter, shift+enter, ctrl+j, up/down, escape (= Parar),
//     ctrl+l, ctrl+g, ctrl+s, ctrl+_ / ctrl+- (undo), alt+v (paste image), ctrl+r (history search), ctrl+c (copy),
//     ctrl+x and its chords (ctrl+x = cut), ctrl+up/down and alt+up/down (diff panel that only exists in the
//     terminal), space (voice).
//   - never: ctrl+d (app:exit would end the CLI) and ctrl+shift+b (toggleBrief: a terminal cannot tell it from
//     ctrl+b).

/** What the box does for a key besides editing text. */
export type NativeShortcutAction = 'modelPicker' | 'toggleFolds' | 'sendNow';

export type CliShortcut =
  | { readonly kind: 'forward'; readonly bytes: string; readonly label: string }
  | { readonly kind: 'native'; readonly action: NativeShortcutAction; readonly label: string };

/** The slice of a keyboard event the lookup needs. */
export interface ShortcutKeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

const forward = (bytes: string, label: string): CliShortcut => ({ kind: 'forward', bytes, label });
const native = (action: NativeShortcutAction, label: string): CliShortcut => ({ kind: 'native', action, label });

/** Combo (`ctrl+t`, `alt+o`, `shift+tab`, `ctrl+enter`) -> entry. Letters are lowercase. */
export const CLI_SHORTCUTS: Readonly<Record<string, CliShortcut>> = {
  'shift+tab': forward('\x1b[Z', 'alterna o modo'),
  'alt+o': forward('\x1bo', 'modo rápido'),
  'alt+t': forward('\x1bt', 'liga/desliga o raciocínio'),
  'alt+w': forward('\x1bw', 'liga/desliga o workflow'),
  'ctrl+y': forward('\x19', 'modelo mais novo'),
  'ctrl+t': forward('\x14', 'mostra/esconde as tarefas'),
  'ctrl+b': forward('\x02', 'manda para o fundo'),
  'ctrl+]': forward('\x1d', 'abre o artefato'),
  'alt+p': native('modelPicker', 'trocar modelo'),
  'ctrl+o': native('toggleFolds', 'expande/recolhe o trabalho'),
  'ctrl+enter': native('sendNow', 'interrompe e manda agora'),
};

/** The combo of an event as `CLI_SHORTCUTS` spells it; `null` for a bare key or for Meta/Cmd combos. */
function comboOf(input: ShortcutKeyInput): string | null {
  if (input.metaKey) return null;
  const mods = [input.ctrlKey ? 'ctrl' : '', input.altKey ? 'alt' : '', input.shiftKey ? 'shift' : ''].filter(Boolean);
  if (mods.length === 0) return null;
  const name = input.key === 'Tab' ? 'tab' : input.key === 'Enter' ? 'enter' : input.key.toLowerCase();
  return [...mods, name].join('+');
}

/** The CLI shortcut a key press stands for; `null` = not one of them (the box handles it as usual). */
export function shortcutFor(input: ShortcutKeyInput): CliShortcut | null {
  const combo = comboOf(input);
  if (combo === null) return null;
  return Object.prototype.hasOwnProperty.call(CLI_SHORTCUTS, combo) ? (CLI_SHORTCUTS[combo] ?? null) : null;
}
