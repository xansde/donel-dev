// 014-chat (T038) — detectors over the RENDERED xterm buffer of the interactive
// `claude` (CLI 2.1.293). Pure: they take the lines `TerminalPane.readScreen()`
// produces (T039) and answer what the chat needs to know before writing to the
// PTY (`contracts/send-protocol.md` §1) and to explain why it is waiting
// (research R16).
//
// Each detector uses MORE THAN ONE marker where the CLI offers them, because
// the CLI text changes between versions. Detectors never read the byte stream:
// in ConPTY a space is a cursor advance, not a character (see `cliInputBox.ts`).

import { hasPermissionPrompt, isRulerLine, locateInputBox, readInputBox } from '../cliInputBox';
import { lineText, type LineInput, type ScreenLine } from '../screenLine';
import { trustDialogKind } from '../trustDialog';

export type { DimMask, DimRange, LineInput, ScreenLine } from '../screenLine';

/** What `TerminalPane.readScreen()` returns (contracts/ipc-chat.md §3). `dim` accepts ranges or one flag per character. */
export interface ScreenSnapshot {
  readonly lines: readonly ScreenLine[];
  readonly bracketedPaste: boolean;
  readonly altScreen: boolean;
  readonly cols: number;
  readonly rows: number;
}

// ---------------------------------------------------------------- input box

/**
 * The text of the input box as the chat compares it with what it pasted: dim runs (placeholder, ghost
 * suggestion, queue hint) are NOT text. `''` = empty box. Shell mode (`!` prompt) returns `'!' + text`, which
 * is what was pasted (the CLI draws `! echo` for a pasted `!echo`). `null` = box missing or hijacked by a menu.
 */
export function readInputText(lines: readonly LineInput[]): string | null {
  const box = readInputBox(lines);
  if (box.kind === 'typed') return box.shell ? `!${box.text}` : box.text;
  if (box.kind === 'empty') return box.shell ? '!' : '';
  return null;
}

/** Rows of the footer: everything under the bottom ruler of the input box. */
function footerLines(lines: readonly LineInput[]): string[] {
  const box = locateInputBox(lines);
  return box ? lines.slice(box.bottom + 1).map(lineText) : [];
}

/** Box content plus the few rows right above it (where the CLI draws queue notes and menus). */
function boxAndAbove(lines: readonly LineInput[], above: number): string[] {
  const box = locateInputBox(lines);
  if (!box) return [];
  return lines.slice(Math.max(0, box.top - above), box.bottom).map(lineText);
}

/**
 * Spinner row the CLI draws above the box while a turn runs: a spinner glyph at column 0, the verb, then "…" and
 * maybe a parenthesis ("✻ Booping… (31s · ↓ 58 tokens)", "· Crystallizing… (running UserPromptSubmit hooks… 0/2)").
 * The row of a finished turn ("✻ Worked for 26s · done 17:38") has no "…". Indented rows with "…" (dialog
 * lists, `⎿  Running…`) and the answer rows (`● ...`) never start with a glyph at column 0.
 */
const SPINNER_PATTERN = /^[·✢✳✶✻✽*]\s+[^\s…][^…]*…/u;
/** How far above the top ruler the spinner may sit (a wrapped "⎿ Tip:" or a short notice can come between them). */
const SPINNER_ROWS_ABOVE = 8;

function spinnerAboveBox(lines: readonly LineInput[]): boolean {
  const box = locateInputBox(lines);
  if (!box) return false;
  return lines.slice(Math.max(0, box.top - SPINNER_ROWS_ABOVE), box.top).some((line) => SPINNER_PATTERN.test(lineText(line)));
}

/**
 * The CLI is mid-turn: the footer says "esc to interrupt", or the spinner row sits right above the box. The footer
 * hint is not always there (CLI 2.1.314, measured on 30/10): ANY `statusLine` configured drops it (and "? for
 * shortcuts"), and text in the box drops it even without one. The spinner row stays in every case, appearing and
 * disappearing in the same frames as the hint (Enter, Esc, end of turn). Either one proves the turn; without the box
 * there is no proof (the caller falls back to the hooks).
 */
export function isWorking(lines: readonly LineInput[]): boolean {
  return footerLines(lines).some((line) => /esc to interrupt/i.test(line)) || spinnerAboveBox(lines);
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypass';

/**
 * Permission mode the CLI footer reports ("⏵⏵ accept edits on (shift+tab to cycle)", "⏸ plan mode on ...",
 * "⏵⏵ bypass permissions on ...", "⏸ manual mode on" = default). Only the footer counts: the box and the
 * transcript above it can contain the same words. `null` = no box, or the footer names no mode.
 */
export function readPermissionMode(lines: readonly LineInput[]): PermissionMode | null {
  for (const line of footerLines(lines)) {
    if (/bypass permissions on/i.test(line)) return 'bypass';
    if (/accept edits on/i.test(line)) return 'acceptEdits';
    if (/plan mode on/i.test(line)) return 'plan';
    if (/(?:manual|default) mode on/i.test(line)) return 'default';
  }
  return null;
}

/** Messages typed while the CLI works wait in its own queue. Two independent markers. */
export function hasQueuedMessages(lines: readonly LineInput[]): boolean {
  return boxAndAbove(lines, 6).some((line) => /Press up to edit queued messages/i.test(line) || /ctrl\+x ctrl\+s to send now/i.test(line));
}

/** Suggestion rows the CLI draws just above the box: two-space indent, then `❯` on the highlighted entry. */
const MENU_ROW_PATTERN = /^ {2}❯\s+\S/;

function menuRowAbove(lines: readonly LineInput[]): boolean {
  const box = locateInputBox(lines);
  if (!box) return false;
  return lines.slice(Math.max(0, box.top - 10), box.top).some((line) => MENU_ROW_PATTERN.test(lineText(line)));
}

/** The `/` command menu is open: the box holds only a `/word` (no argument yet) and suggestion rows sit above it. */
export function slashMenuOpen(lines: readonly LineInput[]): boolean {
  const box = readInputBox(lines);
  if (box.kind !== 'typed' || box.shell) return false;
  return /^\/\S*$/.test(box.text) && menuRowAbove(lines);
}

/** The `@` file menu is open: the last word of the box starts with `@` and suggestion rows sit above it. */
export function atMenuOpen(lines: readonly LineInput[]): boolean {
  const box = readInputBox(lines);
  if (box.kind !== 'typed' || box.shell) return false;
  return /(?:^|\s)@\S*$/.test(box.text) && menuRowAbove(lines);
}

/** `[Pasted text #N +M lines]` in the box (`lines` is `null` when the CLI omits the count). */
export function pastedPlaceholder(lines: readonly LineInput[]): { id: number; lines: number | null } | null {
  const text = readInputText(lines);
  if (text === null) return null;
  const match = /\[Pasted text #(\d+)(?: \+(\d+) lines?)?\]/.exec(text);
  if (!match) return null;
  return { id: Number(match[1]), lines: match[2] === undefined ? null : Number(match[2]) };
}

/** How many `[Image #N]` markers the box holds (the transcript echo does not count). */
export function imagePlaceholderCount(lines: readonly LineInput[]): number {
  const text = readInputText(lines);
  return text === null ? 0 : (text.match(/\[Image #\d+\]/g) ?? []).length;
}

// ------------------------------------------------------------------ dialogs

export type BlockingScreenKind = 'trust' | 'external-imports' | 'plan' | 'question' | 'permission' | 'screen';

export interface BlockingScreen {
  readonly kind: BlockingScreenKind;
  readonly title: string;
}

/**
 * Screens that REPLACE the input box (research R16). Titles come from the bar `▔▔▔` the CLI draws above
 * full-screen views. Typing into any of them answers or navigates the dialog.
 */
const SCREEN_TITLES: readonly string[] = [
  'Select model',
  'Resume session',
  'Settings',
  'Status',
  'Config',
  'Usage',
  'Stats',
  'Permissions',
  'Manage MCP servers',
  'Hooks',
  'Memory',
  'Theme',
  'Skills',
  'Plugins',
  'Export conversation',
  'Rewind',
  'Add directory to workspace',
  'Background',
  'Effort',
  'Help',
];

const PLAN_TITLES: readonly string[] = ['Exit plan mode?', 'Ready to code?'];
const BAR_CHAR = '▔';

function isBarLine(line: string): boolean {
  const trimmed = line.trim();
  let bars = 0;
  for (const char of trimmed) if (char === BAR_CHAR) bars += 1;
  return bars >= 10 && bars * 2 >= trimmed.length;
}

function firstMatching(lines: readonly string[], pattern: RegExp): string | null {
  for (const line of lines) if (pattern.test(line)) return line.trim();
  return null;
}

function screenTitle(lines: readonly string[]): string | null {
  let bar = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isBarLine(lines[i])) {
      bar = i;
      break;
    }
  }
  if (bar < 0) return null;
  for (let i = bar + 1; i < Math.min(lines.length, bar + 5); i += 1) {
    const text = lines[i].trim();
    if (text === '') continue;
    const title = SCREEN_TITLES.find((candidate) => text.startsWith(candidate) && !/^[A-Za-z]/.test(text.slice(candidate.length)));
    return title ?? null;
  }
  return null;
}

/**
 * Which dialog or box-less screen holds the CLI, or `null`. While one is up, pasting would ANSWER it
 * (digits and `j`/`k` choose options), so `isReadyForInput` is false and the chat shows "o terminal precisa
 * de você". Checked from the most specific to the most generic.
 */
export function blockingScreen(lines: readonly LineInput[]): BlockingScreen | null {
  const plain = lines.map(lineText);

  const trust = trustDialogKind(lines);
  if (trust === 'trust') return { kind: 'trust', title: 'Quick safety check' };
  if (trust === 'external-imports') {
    return { kind: 'external-imports', title: firstMatching(plain, /\bexternal\b.*\bimports?\b/i) ?? 'External imports' };
  }

  const plan = plain.map((line) => line.trim()).find((line) => PLAN_TITLES.includes(line));
  if (plan) return { kind: 'plan', title: plan };

  if (plain.some((line) => /Enter to select/.test(line)) && plain.some((line) => /to navigate/.test(line))) {
    const header = plain.findIndex((line) => /^\s*[☐☒✔]\s/.test(line));
    const question = header >= 0 ? plain.slice(header + 1).find((line) => line.trim() !== '') : undefined;
    return { kind: 'question', title: question?.trim() ?? 'Question' };
  }

  const box = readInputBox(lines);
  const boxVisible = box.kind === 'typed' || box.kind === 'empty';

  // A permission prompt replaces the box. Its patterns are loose ("1. Yes"), so they only count when the box is gone.
  if (!boxVisible && hasPermissionPrompt(lines)) {
    return { kind: 'permission', title: firstMatching(plain, /Do you want to\b.*\?/i) ?? firstMatching(plain, /requires confirmation/i) ?? 'Permission' };
  }

  if (!boxVisible) {
    const title = screenTitle(plain);
    if (title) return { kind: 'screen', title };
  }
  return null;
}

/** A permission dialog read from the screen (t-1293c818): what it asks, as drawn, and the key that answers "Yes". */
export interface PermissionDialog {
  /** The dialog from its top border down to its question ("Bash command / rm -rf build / … / Do you want to proceed?"). */
  readonly text: string;
  /** The digit of the option that is exactly "Yes" (allow once); `null` = none drawn (never guess another option). */
  readonly yesKey: string | null;
}

const PERMISSION_QUESTION = /Do you want to\b.*\?|requires confirmation/i;
const YES_OPTION = /^\s*(?:❯\s*)?(\d)\.\s+Yes\s*$/;
/** How far above its question the dialog may start (a long command wraps). */
const DIALOG_ROWS_ABOVE = 24;
const DIALOG_TEXT_MAX = 1_500;

/**
 * The permission dialog on the screen, so a Líder can read what it asks before answering it from another session
 * (`sessao_permissao`); `null` when `blockingScreen` sees no permission prompt. Refusing is Esc; allowing is `yesKey`.
 */
export function permissionDialog(lines: readonly LineInput[]): PermissionDialog | null {
  if (blockingScreen(lines)?.kind !== 'permission') return null;
  const plain = lines.map(lineText);
  let question = -1;
  for (let i = plain.length - 1; i >= 0; i -= 1) {
    if (PERMISSION_QUESTION.test(plain[i])) {
      question = i;
      break;
    }
  }
  if (question < 0) question = Math.max(0, plain.findIndex((line) => YES_OPTION.test(line)) - 1);
  let top = question;
  while (top > 0 && question - top < DIALOG_ROWS_ABOVE && !isRulerLine(plain[top - 1]) && !isBarLine(plain[top - 1])) top -= 1;
  const body: string[] = [];
  for (const line of plain.slice(top, question + 1).map((row) => row.trimEnd())) {
    if (line.trim() === '' && (body.length === 0 || body[body.length - 1] === '')) continue;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  const text = body.join('\n');
  const yes = plain.slice(question + 1).map((line) => YES_OPTION.exec(line)).find((match) => match !== null);
  return { text: text.length > DIALOG_TEXT_MAX ? `${text.slice(0, DIALOG_TEXT_MAX)}…` : text, yesKey: yes ? yes[1] : null };
}

/** Footer present: the CLI printed something under the box (mode, hints). Typed text hides "? for shortcuts", so any text counts. */
export function hasFooter(lines: readonly LineInput[]): boolean {
  return footerLines(lines).some((line) => line.trim() !== '');
}

/**
 * Gate of `contracts/send-protocol.md` §1 on what the screen can prove: input box visible + footer present +
 * no dialog. (Process alive and no `open` pending are the caller's checks.) It is true while the CLI is
 * working too: the message goes to the CLI queue.
 */
export function isReadyForInput(lines: readonly LineInput[]): boolean {
  const box = readInputBox(lines);
  if (box.kind !== 'typed' && box.kind !== 'empty') return false;
  if (!hasFooter(lines)) return false;
  return blockingScreen(lines) === null;
}

// -------------------------------------------------------------- model dialog

export interface ModelDialogOption {
  readonly index: number;
  readonly label: string;
  /** Marked with the check mark: the model in use. */
  readonly current: boolean;
}

export interface ModelDialog {
  readonly options: readonly ModelDialogOption[];
  /** Number of the highlighted option (`❯`), or `null`. */
  readonly cursor: number | null;
  /** Number of the option in use, or `null`. */
  readonly current: number | null;
}

const MODEL_OPTION_PATTERN = /^\s*(?:(❯)|[↓↑])?\s*(\d+)\.\s+(.*\S)\s*$/;

/** The "Select model" dialog (`/model`), parsed; `null` when it is not on screen. */
export function modelDialog(lines: readonly LineInput[]): ModelDialog | null {
  const plain = lines.map(lineText);
  const start = plain.findIndex((line, i) => line.trim().startsWith('Select model') && i > 0 && plain.slice(Math.max(0, i - 3), i).some(isBarLine));
  if (start < 0) return null;
  const options: ModelDialogOption[] = [];
  let cursor: number | null = null;
  for (const line of plain.slice(start + 1)) {
    const match = MODEL_OPTION_PATTERN.exec(line);
    if (!match) continue;
    const index = Number(match[2]);
    const label = match[3].split(/\s{2,}/)[0].replace('✔', '').trim();
    const current = match[3].includes('✔');
    if (match[1]) cursor = index;
    options.push({ index, label, current });
  }
  if (options.length === 0) return null;
  return { options, cursor, current: options.find((o) => o.current)?.index ?? null };
}

// ----------------------------------------------------------------- messages

/** "Transcript saving is off": the CLI will not write the transcript the chat reads (R17). */
export function transcriptSavingOff(lines: readonly LineInput[]): boolean {
  return lines.some((line) => /Transcript saving is off/i.test(lineText(line)));
}

export type TransientMessage = 'unknown-command' | 'ctrl-c-again' | 'esc-again';

/** Short-lived CLI notices the chat translates (instead of showing raw terminal text). */
export function transientMessage(lines: readonly LineInput[]): TransientMessage | null {
  const plain = lines.map(lineText);
  if (plain.some((line) => /Press Ctrl-C again to exit/i.test(line))) return 'ctrl-c-again';
  if (plain.some((line) => /Esc again to clear/i.test(line))) return 'esc-again';
  if (plain.some((line) => /Unknown command:/i.test(line))) return 'unknown-command';
  return null;
}
