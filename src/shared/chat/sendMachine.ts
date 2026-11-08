// 014-chat (T063) — send state machine (`contracts/send-protocol.md`, `data-model.md` §9). PURE and
// deterministic: no timers, no I/O, no clock. One instance per send; the renderer's driver feeds events and
// executes effects.
//
//   createSend(input, now)      → { state, effects }
//   step(state, event)          → { state, effects }
//
// Events (every one carries `now`, in ms; deadlines are compared against it):
//   screen   { screen: { lines } }        fresh read of the hidden terminal (reuses ./screen.ts detectors)
//   tick     {}                           the driver woke up (it should also re-read the screen)
//   env      { alive?, pendingOpen?, terminalNeeded?, working? }   process alive / `open` pending / "terminal needs
//                                         you" banner / mid-turn by the hooks
//   signal   { signal: PromptSignal }     acceptance signal (`chat:prompt-signal`, ipc-chat.md §2)
//   ack-result { found }                  answer to the `ack-lookup` effect
//   action   { action: 'retry' | 'discard-and-send' | 'interrupt-and-send' }   owner actions
//
// Effects:
//   write    { data }                     exact bytes for the PTY: `ESC[200~…ESC[201~`, `\r`, `ESC`, `ESC ESC`
//   wake-at  { at }                       deliver a `tick` (with a fresh screen) at this time
//   ack-lookup { text, since }            look for a late acceptance (stored UserPromptSubmit + transcript)
//   status   { state, label, reason? }    for the UI: label in pt-BR + human reason
//   leftover { text, canDiscard }         real text left in the TUI box (canDiscard = CLI idle)
//
// State phases are the `SendState` names of data-model §9. Inner steps (`SendStep`) refine them.
// Signals are only honoured after the Enter was written (`await-ack`) or while `queued`, and only when
// `signal.at >= createdAt`; the driver picks WHICH pending send receives a signal with `oldestPending`
// from ./promptMatch (identical messages are closed oldest first).
//
// Mid-turn (owner's decision, 30/10: "só envia, sem esperar ele finalizar, e acompanha se o próprio Claude
// coleta"): a plain prompt is written into the CLI's own queue even when the screen cannot prove the box; a paste
// that never shows up in the box still gets its Enter; and a `queued` send is checked (`verify`) once the turn is
// over, so it never stays "na fila" forever.

import { readInputBox } from '../cliInputBox';
import { NATIVE_COMMAND_NAMES } from './commandCatalog';
import { commandResolvesTo, matchesPrompt, normalizePrompt } from './promptMatch';
import {
  blockingScreen,
  imagePlaceholderCount,
  isReadyForInput,
  isWorking,
  pastedPlaceholder,
  readInputText,
  slashMenuOpen,
} from './screen';
import type { SendKind, SendMode, SendState } from './rows';
import type { LineInput } from '../screenLine';

// ------------------------------------------------------------------- types

export type PromptSignalKind =
  | 'submit'
  | 'enqueue'
  | 'deliver'
  | 'command'
  | 'shell'
  | 'local'
  | 'unknown-command'
  | 'session-switch'
  | 'compact';

export interface PromptSignal {
  readonly signal: PromptSignalKind;
  readonly text?: string;
  readonly at: number;
}

export type MessageClass =
  | { readonly kind: 'prompt' }
  | { readonly kind: 'skill'; readonly name: string }
  | { readonly kind: 'clear' }
  | { readonly kind: 'compact' }
  | { readonly kind: 'native'; readonly name: string }
  | { readonly kind: 'shell' };

export interface SendInput {
  readonly id: string;
  /** Raw text as the owner wrote it; the machine sanitizes it. */
  readonly text: string;
  /** Absolute paths, one paste each. */
  readonly imagePaths?: readonly string[];
  readonly mode?: SendMode;
  /** First paste of the session: wider text deadline (12 s). */
  readonly firstPaste?: boolean;
  /** Native command that opens a screen: that screen appearing is the acceptance. */
  readonly opensScreen?: boolean;
  /** Names (without `/`) of custom commands/skills; they win over native names. */
  readonly customCommands?: ReadonlySet<string>;
  /**
   * Nobody watches that box (a message from another session, `from: 'session'`): no owner will press Enter or clear
   * it by hand. The machine insists on the Enter longer and never leaves its own text sitting there (08/11).
   */
  readonly unattended?: boolean;
}

export type SendStep = 'gate' | 'image' | 'text' | 'menu-esc' | 'enter-gap' | 'await-ack' | 'lookup' | 'verify' | 'done';

export interface SendMachineState {
  readonly id: string;
  /** Sanitized text (what is pasted and compared). */
  readonly text: string;
  readonly images: readonly string[];
  readonly cls: MessageClass;
  readonly kind: SendKind;
  readonly mode: SendMode;
  readonly firstPaste: boolean;
  readonly opensScreen: boolean;
  readonly unattended: boolean;
  /** Enters written after the acceptance deadline, while our text still sat in the box (unattended only). */
  readonly lateEnters: number;
  readonly createdAt: number;
  readonly phase: SendState;
  readonly step: SendStep;
  readonly attempts: number;
  readonly failReason: string | null;
  /** Last reason the gate waited for in this attempt (diagnostics: what it was waiting on before failing). */
  readonly lastWaitReason: string | null;
  /** Step the send was in when it failed (`step` itself becomes `done`). */
  readonly failedStep: SendStep | null;
  readonly alive: boolean;
  readonly pendingOpen: boolean;
  readonly terminalNeeded: boolean;
  /** Mid-turn according to the hooks: a plain prompt is written even if the screen cannot prove the box. */
  readonly working: boolean;
  /** Times this send erased a terminal report that leaked into the box (capped: `MAX_JUNK_CLEANS`). */
  readonly junkCleans: number;
  readonly lines: readonly LineInput[] | null;
  readonly waitSince: number;
  readonly reasonVisible: boolean;
  readonly interruptSent: boolean;
  /** When the interrupt ESC went out: the paste waits for the turn to stop (or INTERRUPT_SETTLE_MS). */
  readonly interruptAt: number | null;
  readonly imageIdx: number;
  readonly stepDeadline: number | null;
  readonly enterAt: number | null;
  readonly resendAt: number | null;
  readonly ackDeadline: number | null;
  /** No more Enter resends (`MAX_ENTER_RESENDS` went out). */
  readonly resendDone: boolean;
  /** Enters written again after the first one, while our text still sat in the box. */
  readonly resends: number;
  /** The gate read an empty box right before the paste: whatever placeholder shows up next is ours. */
  readonly boxEmptyAtPaste: boolean;
  /** Idle CLI, paste not drawn yet: when to give up on it (`TEXT_IDLE_EXTRA_MS` after the text deadline). */
  readonly textGiveUpAt: number | null;
  readonly idleAtEnter: boolean;
  /** `queued` and the turn is over: when to look the prompt up (`verify`) if no delivery signal came. */
  readonly verifyAt: number | null;
  /** The empty-box lookup after the Enter already missed once: the next miss is "não foi". */
  readonly relooked: boolean;
  readonly leftoverShown: string | null;
  readonly lastStatusKey: string | null;
  readonly lastWake: number | null;
}

export type SendEvent =
  | { readonly type: 'screen'; readonly now: number; readonly screen: { readonly lines: readonly LineInput[] } }
  | { readonly type: 'tick'; readonly now: number }
  | {
      readonly type: 'env';
      readonly now: number;
      readonly alive?: boolean;
      readonly pendingOpen?: boolean;
      readonly terminalNeeded?: boolean;
      readonly working?: boolean;
    }
  | { readonly type: 'signal'; readonly now: number; readonly signal: PromptSignal }
  | { readonly type: 'ack-result'; readonly now: number; readonly found: boolean }
  | { readonly type: 'action'; readonly now: number; readonly action: 'retry' | 'discard-and-send' | 'interrupt-and-send' };

export type SendLabel = 'na fila' | 'enviando…' | 'entrou' | 'não foi';

export type SendEffect =
  | { readonly type: 'write'; readonly data: string }
  | { readonly type: 'wake-at'; readonly at: number }
  | { readonly type: 'ack-lookup'; readonly text: string; readonly since: number }
  | { readonly type: 'status'; readonly state: SendState; readonly label: SendLabel; readonly reason?: string }
  | { readonly type: 'leftover'; readonly text: string; readonly canDiscard: boolean };

export interface StepResult {
  readonly state: SendMachineState;
  readonly effects: readonly SendEffect[];
}

// ------------------------------------------------------------------ timings

const WAIT_CLI_MS = 30_000;
/**
 * The first send of a tab waits this long for the CLI to come up. A session opened on a remote place only shows the
 * CLI after the setup by ssh (up to 180 s), the attach and the boot there; with 30 s the first message gave up before
 * it existed, nothing was written, and the session "não começou" (07/11).
 */
const FIRST_WAIT_CLI_MS = 240_000;
const IMAGE_MS = 3_000;
const TEXT_BASE_MS = 3_000;
const TEXT_PER_15KB_MS = 1_000;
const FIRST_PASTE_MS = 12_000;
/**
 * With the CLI idle and nothing on its screen, a paste not drawn yet is waited for this much longer before giving
 * up. On a machine short of RAM (90 %+, 05/11) a CLI that had just booted drew the paste 20 s+ later; giving up at
 * 12 s left `[Pasted text #1 …]` in the box, never submitted, and the session never started.
 */
const TEXT_IDLE_EXTRA_MS = 12_000;
const FIRST_PASTE_IDLE_EXTRA_MS = 33_000;
/** While waiting that extra time, the screen is looked at again on this beat. */
const TEXT_RECHECK_MS = 1_000;
/** Enter written again while our text still sits in the box, 3 s apart (an Enter a slow CLI swallowed). */
const MAX_ENTER_RESENDS = 3;
const ACK_MS = 15_000;
/** The first send of a tab: a CLI that just came up may draw the box before it takes an Enter (07/11). */
const FIRST_MAX_ENTER_RESENDS = 14;
const FIRST_ACK_MS = 45_000;
/** Terminal reports erased from the box per send, at most. */
const MAX_JUNK_CLEANS = 3;
const ENTER_GAP_MS = 80;
const RESEND_ENTER_MS = 3_000;
const VERIFY_MS = 15_000;
const INTERRUPT_SETTLE_MS = 3_000;
/**
 * Unattended (08/11): sessions on a loaded remote place were found with `[Pasted text #N +M lines]` sitting in the box,
 * never submitted, and every later message waiting behind it. A paste drawn after the machine gave up, or an Enter the
 * CLI lost four times in a row, left it there. So an unattended send waits longer for its paste to show up, keeps
 * writing only the Enter (never the text) while its text is in the box, and if the CLI never takes it, clears its own
 * text from the box before saying "não foi": the box is free for the next message, and a resend is not a duplicate.
 */
const UNATTENDED_TEXT_EXTRA_MS = 120_000;
const LATE_ENTER_MS = 10_000;
const MAX_LATE_ENTERS = 6;

// ----------------------------------------------------------- text and class

/** §2: CRLF/CR → LF, strip C0/DEL/C1 controls (keeps LF and TAB), TAB → 4 spaces, trim only the borders. */
export function sanitizeOutgoing(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, '')
    .replace(/\t/g, '    ')
    .trim();
}

/** Which acceptance signals apply (§5 table). Expects the sanitized text. */
export function classifyOutgoing(text: string, options: { readonly customCommands?: ReadonlySet<string> } = {}): MessageClass {
  if (text.startsWith('!')) return { kind: 'shell' };
  if (!text.startsWith('/')) return { kind: 'prompt' };
  const name = /^\/(\S*)/.exec(text)?.[1] ?? '';
  const lower = name.toLowerCase();
  if (options.customCommands?.has(name) || options.customCommands?.has(lower)) return { kind: 'skill', name };
  if (lower === 'clear' || lower === 'new' || lower === 'reset') return { kind: 'clear' };
  if (lower === 'compact') return { kind: 'compact' };
  if (NATIVE_COMMAND_NAMES.has(lower)) return { kind: 'native', name };
  return { kind: 'skill', name };
}

function sendKindOf(cls: MessageClass): SendKind {
  if (cls.kind === 'prompt') return 'prompt';
  return cls.kind === 'shell' ? 'shell' : 'slash';
}

const needsIdleKind = (cls: MessageClass) => cls.kind !== 'prompt';

/**
 * Mid-turn? A screen that proves the box and its footer answers (`isWorking`: "esc to interrupt" or the spinner row
 * above the box); otherwise the hooks do (a long command can hide the box or its footer while the turn goes on).
 */
function midTurn(s: { readonly working: boolean }, lines: readonly LineInput[] | null): boolean {
  if (lines !== null && isReadyForInput(lines)) return isWorking(lines);
  return s.working;
}

const bracketedPaste = (data: string) => `\x1b[200~${data}\x1b[201~`;

// -------------------------------------------------------------------- init

export function createSend(input: SendInput, now: number): StepResult {
  const text = sanitizeOutgoing(input.text);
  const cls = classifyOutgoing(text, { customCommands: input.customCommands });
  const images = input.imagePaths ?? [];
  const state: SendMachineState = {
    id: input.id,
    text,
    images,
    cls,
    kind: sendKindOf(cls),
    mode: input.mode ?? 'normal',
    firstPaste: input.firstPaste ?? false,
    opensScreen: input.opensScreen ?? false,
    unattended: input.unattended ?? false,
    lateEnters: 0,
    createdAt: now,
    phase: 'waiting-cli',
    step: 'gate',
    attempts: 0,
    failReason: null,
    lastWaitReason: null,
    failedStep: null,
    alive: true,
    pendingOpen: false,
    terminalNeeded: false,
    working: false,
    junkCleans: 0,
    lines: null,
    waitSince: now,
    reasonVisible: false,
    interruptSent: false,
    interruptAt: null,
    imageIdx: 0,
    stepDeadline: null,
    enterAt: null,
    resendAt: null,
    ackDeadline: null,
    resendDone: false,
    resends: 0,
    boxEmptyAtPaste: false,
    textGiveUpAt: null,
    idleAtEnter: true,
    verifyAt: null,
    relooked: false,
    leftoverShown: null,
    lastStatusKey: null,
    lastWake: null,
  };
  const draft = { ...state };
  const fx: SendEffect[] = [];
  if (text === '' && images.length === 0) fail(draft, 'mensagem vazia');
  else evaluate(draft, now, fx);
  return finish(draft, now, fx);
}

// -------------------------------------------------------------------- step

type Draft = { -readonly [K in keyof SendMachineState]: SendMachineState[K] };

export function step(state: SendMachineState, event: SendEvent): StepResult {
  const s: Draft = { ...state };
  const fx: SendEffect[] = [];
  const now = event.now;

  switch (event.type) {
    case 'screen':
      s.lines = event.screen.lines;
      break;
    case 'tick':
      break;
    case 'env':
      if (event.alive !== undefined) s.alive = event.alive;
      if (event.pendingOpen !== undefined) s.pendingOpen = event.pendingOpen;
      if (event.terminalNeeded !== undefined) s.terminalNeeded = event.terminalNeeded;
      if (event.working !== undefined) s.working = event.working;
      break;
    case 'signal':
      applySignal(s, event.signal);
      break;
    case 'ack-result':
      if (s.step === 'lookup') {
        if (event.found) {
          s.phase = 'accepted';
          s.step = 'done';
        } else resetForRetry(s, now);
      } else if (s.step === 'verify' && s.phase === 'confirming') {
        // The Enter went and the box emptied, but no acceptance signal came: the transcript decides, never a new paste.
        // A remote transcript comes through the mirror, seconds late: one miss asks again after VERIFY_MS (a late
        // signal accepts meanwhile). Saying "não foi" too soon made the sender resend and the message go in twice.
        if (event.found) {
          s.phase = 'accepted';
          s.step = 'done';
        } else if (!s.relooked) {
          s.relooked = true;
          s.verifyAt = now + VERIFY_MS;
        } else fail(s, 'não foi');
      } else if (s.step === 'verify' && s.phase === 'queued') {
        if (event.found) {
          s.phase = 'accepted';
          s.step = 'done';
        } else fail(s, 'o Claude não pegou a mensagem');
      }
      break;
    case 'action':
      applyAction(s, event.action, now, fx);
      break;
  }
  evaluate(s, now, fx);
  return finish(s, now, fx);
}

function resetForRetry(s: Draft, now: number): void {
  s.phase = 'waiting-cli';
  s.step = 'gate';
  s.failReason = null;
  s.lastWaitReason = null;
  s.failedStep = null;
  s.attempts += 1;
  s.lines = null; // wait for a fresh read: never paste on a stale screen
  s.waitSince = now;
  s.reasonVisible = false;
  s.interruptSent = false;
  s.interruptAt = null;
  s.imageIdx = 0;
  s.stepDeadline = null;
  s.enterAt = null;
  s.resendAt = null;
  s.ackDeadline = null;
  s.resendDone = false;
  s.resends = 0;
  s.boxEmptyAtPaste = false;
  s.textGiveUpAt = null;
  s.verifyAt = null;
  s.leftoverShown = null;
}

function applyAction(s: Draft, action: 'retry' | 'discard-and-send' | 'interrupt-and-send', now: number, fx: SendEffect[]): void {
  if (action === 'retry') {
    if (s.phase === 'failed' && s.step !== 'lookup') {
      s.step = 'lookup';
      fx.push({ type: 'ack-lookup', text: s.text, since: s.createdAt });
    }
    return;
  }
  if (s.phase !== 'waiting-cli') return;
  if (action === 'interrupt-and-send') {
    s.mode = 'interrupt-first';
    return;
  }
  // discard-and-send: only with real text in the box and the CLI idle (Esc would interrupt a turn; Esc Esc on
  // an empty box opens Rewind).
  if (s.leftoverShown === null || s.lines === null) return;
  const boxText = readInputText(s.lines);
  if (!boxText || isWorking(s.lines)) return;
  fx.push({ type: 'write', data: '\x1b\x1b' });
  s.leftoverShown = null;
  s.lines = null; // re-read before continuing
  s.waitSince = now;
}

// ----------------------------------------------------------------- signals

function applySignal(s: Draft, sig: PromptSignal): void {
  if (s.step !== 'await-ack' && s.step !== 'verify' && s.phase !== 'queued') return;
  if (sig.at < s.createdAt) return;
  const cls = s.cls;
  const textOk = sig.text === undefined || matchesPrompt(s.text, sig.text);
  const accept = () => {
    s.phase = 'accepted';
    s.step = 'done';
  };
  const queue = () => {
    s.phase = 'queued';
    s.step = 'done';
    s.verifyAt = null;
  };

  if (sig.signal === 'unknown-command') {
    if (cls.kind === 'skill' || cls.kind === 'native') fail(s, 'comando desconhecido');
    return;
  }

  switch (cls.kind) {
    case 'prompt':
    case 'skill': {
      if (sig.signal === 'command' && cls.kind === 'skill') {
        const name = /^\/?(\S*)/.exec(sig.text ?? '')?.[1] ?? '';
        if (name === cls.name || commandResolvesTo(s.text, sig.text ?? '')) accept();
        return;
      }
      if (!textOk || sig.text === undefined) return;
      if (sig.signal === 'deliver') accept();
      else if (sig.signal === 'submit') {
        // While working the table says "na fila"; a second submit/deliver on a queued send is the delivery.
        if (s.phase === 'queued' || s.idleAtEnter) accept();
        else queue();
      } else if (sig.signal === 'enqueue') {
        if (s.phase !== 'queued') queue();
      }
      return;
    }
    case 'clear':
      if (sig.signal === 'session-switch') accept();
      return;
    case 'compact':
      if (sig.signal === 'compact') accept();
      return;
    case 'native':
      if (sig.signal === 'local') accept();
      return;
    case 'shell':
      if (sig.signal === 'shell') {
        const sent = normalizePrompt(s.text.replace(/^!\s*/, ''));
        if (sig.text === undefined || normalizePrompt(sig.text.replace(/^!\s*/, '')) === sent) accept();
      }
      return;
  }
}

// ---------------------------------------------------------------- evaluate

function fail(s: Draft, reason: string): void {
  s.failedStep = s.step;
  s.phase = 'failed';
  s.step = 'done';
  s.failReason = reason;
}

const collapse = (t: string) => t.replace(/\s+/g, ' ').trim();
/**
 * Whitespace-blind form for comparing against the box: the box joins wrapped/continuation
 * lines with no separator (a space at the wrap point or a real `
` vanishes), so only the
 * non-blank characters are comparable.
 */
const squash = (t: string) => t.replace(/\s+/g, '');

/** The pasted text is in the box: literally, or as `[Pasted text #N +M lines]` (M = number of `\n`). */
function textSeen(s: Draft, lines: readonly LineInput[]): boolean {
  const raw = readInputText(lines);
  if (raw === null) return false;
  const stripped = collapse(raw.replace(/\[Image #\d+\]/g, ''));
  if (squash(stripped) === squash(s.text)) return true;
  const placeholder = pastedPlaceholder(lines);
  if (placeholder && /^(?:\[Pasted text #\d+(?: \+\d+ lines?)?\]\s*)+$/.test(stripped)) {
    const breaks = (s.text.match(/\n/g) ?? []).length;
    if (placeholder.lines === null || placeholder.lines === breaks) return true;
    // The box was empty right before our paste, so only our paste can have put a placeholder there: a count the
    // CLI made differently (line endings, a paste it took in two parts) is still ours. Missing it left the
    // placeholder sitting in the box, never submitted (05/11).
    return s.boxEmptyAtPaste;
  }
  return s.boxEmptyAtPaste && looksLikeOurs(stripped, s.text);
}

/** Letters and digits only: what survives a screen read that drops or doubles a glyph (◆, ambiguous widths, wraps). */
const lettersOnly = (t: string): string => t.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/**
 * 05/11 — the box went from empty to holding text that is ours read loosely: about as long, and its start or end
 * is in our text. A message to an idle session sat in the box unsubmitted because the screen read did not match it
 * glyph for glyph; as the box was proven empty right before the paste, nobody else put it there — except the owner
 * typing in that box right after it: then the box is longer than ours and an Enter would send his text with ours.
 * So it may not be much longer (a glyph read twice, not a word typed), and when longer both ends must be ours.
 */
function looksLikeOurs(box: string, text: string): boolean {
  const seen = lettersOnly(box);
  const ours = lettersOnly(text);
  if (seen === '' || ours === '' || seen.length < ours.length * 0.8) return false;
  if (seen.length > ours.length + Math.max(2, Math.ceil(ours.length * 0.05))) return false;
  const edge = Math.min(12, seen.length);
  const startIsOurs = ours.includes(seen.slice(0, edge));
  const endIsOurs = ours.includes(seen.slice(-edge));
  return seen.length > ours.length ? startIsOurs && endIsOurs : startIsOurs || endIsOurs;
}

/** Text in the box is a prefix of ours (so a timeout may clean it without eating the owner's own typing). */
function boxIsOurs(s: Draft, lines: readonly LineInput[]): boolean {
  const raw = readInputText(lines);
  if (raw === null) return false;
  const stripped = squash(raw.replace(/\[Image #\d+\]/g, ''));
  return stripped !== '' && squash(s.text).startsWith(stripped);
}

/**
 * 07/11 — what a terminal writes back on its own (device attributes `ESC[?61;…c`, cursor position `ESC[12;40R`) can
 * reach a remote CLI split in two (ssh + tmux, a busy machine): its tail lands in the box as text (`;23;24;28;32;42c`).
 * Never something a person types: digits joined by `;`, ending in the report's letter.
 */
const REPORT = String.raw`\[?[?>]?\d*(?:;\d+)+[cRt]`;
const JUNK_ONLY = new RegExp(`^(?:${REPORT})+$`);
const JUNK_TAIL = new RegExp(`(?:${REPORT})+$`);
const JUNK_HEAD = new RegExp(`^(?:${REPORT})+`);

const ONLY_PLACEHOLDERS = /^(?:\[Pasted text #\d+(?: \+\d+ lines?)?\]\s*)+$/;

/** The box holds a leaked terminal report next to our text (literal, or its `[Pasted text #N]`): where, how long. */
function junkAroundOurs(s: Draft, raw: string): { readonly where: 'head' | 'tail'; readonly length: number } | null {
  const ours = squash(s.text);
  const isOurs = (rest: string): boolean => squash(rest) === ours || (s.boxEmptyAtPaste && ONLY_PLACEHOLDERS.test(rest.trim()));
  const tail = JUNK_TAIL.exec(raw);
  if (tail !== null && isOurs(raw.slice(0, tail.index))) return { where: 'tail', length: tail[0].length };
  const head = JUNK_HEAD.exec(raw);
  if (head !== null && isOurs(raw.slice(head[0].length))) return { where: 'head', length: head[0].length };
  return null;
}

const backspaces = (n: number): string => '\x7f'.repeat(n);

function textDeadlineMs(s: Draft): number {
  const bytes = new TextEncoder().encode(s.text).length;
  const ms = TEXT_BASE_MS + Math.floor(bytes / 15_000) * TEXT_PER_15KB_MS;
  return s.firstPaste ? Math.max(ms, FIRST_PASTE_MS) : ms;
}

function startText(s: Draft, now: number, fx: SendEffect[]): void {
  s.step = 'text';
  s.stepDeadline = now + textDeadlineMs(s);
  s.textGiveUpAt = s.stepDeadline + Math.max(s.firstPaste ? FIRST_PASTE_IDLE_EXTRA_MS : TEXT_IDLE_EXTRA_MS, s.unattended ? UNATTENDED_TEXT_EXTRA_MS : 0);
  fx.push({ type: 'write', data: bracketedPaste(s.text) });
}

function enterConfirming(s: Draft, lines: readonly LineInput[], now: number, fx: SendEffect[]): void {
  s.phase = 'confirming';
  if (slashMenuOpen(lines) && !isWorking(lines)) {
    fx.push({ type: 'write', data: '\x1b' });
    s.step = 'menu-esc';
    s.stepDeadline = now + TEXT_BASE_MS;
  } else {
    s.step = 'enter-gap';
    s.enterAt = now + ENTER_GAP_MS;
  }
}

function evaluate(s: Draft, now: number, fx: SendEffect[]): void {
  if (s.phase === 'accepted' || s.phase === 'failed') return;
  if (!s.alive && s.phase !== 'waiting-cli') {
    fail(s, 'o Claude foi encerrado');
    return;
  }
  switch (s.phase) {
    case 'waiting-cli':
      evaluateGate(s, now, fx);
      return;
    case 'typing':
      evaluateTyping(s, now, fx);
      return;
    case 'confirming':
      evaluateConfirming(s, now, fx);
      return;
    case 'queued':
      evaluateQueued(s, now, fx);
      return;
    default:
      return;
  }
}

/**
 * `queued`: no deadline while the turn goes on (delivery depends on it). Once the turn is over (hooks), 15 s
 * without `submit`/`deliver` → look the prompt up in the stored hooks/transcript (`verify`): found → accepted,
 * not found → failed "o Claude não pegou a mensagem". A screen still showing the turn (`isWorking`) puts the check off.
 */
function evaluateQueued(s: Draft, now: number, fx: SendEffect[]): void {
  if (s.step === 'verify') return;
  if (s.working) {
    s.verifyAt = null;
    return;
  }
  if (s.verifyAt === null) {
    s.verifyAt = now + VERIFY_MS;
    return;
  }
  if (now < s.verifyAt) return;
  if (s.lines !== null && isWorking(s.lines)) {
    s.verifyAt = now + VERIFY_MS;
    return;
  }
  s.step = 'verify';
  s.verifyAt = null;
  fx.push({ type: 'ack-lookup', text: s.text, since: s.createdAt });
}

const waitCliMs = (s: Draft): number => (s.firstPaste ? FIRST_WAIT_CLI_MS : WAIT_CLI_MS);

function evaluateGate(s: Draft, now: number, fx: SendEffect[]): void {
  const lines = s.lines;
  let reason: string | null = null;
  let visible = false;

  if (!s.alive) reason = 'o Claude foi encerrado';
  else if (s.pendingOpen) {
    reason = 'há uma pergunta ou permissão esperando você';
    visible = true;
  } else if (s.terminalNeeded) {
    reason = 'o terminal precisa de você';
    visible = true;
  } else if (lines === null) reason = 'lendo a tela do Claude';
  else if (blockingScreen(lines) !== null) {
    reason = 'o terminal precisa de você';
    visible = true;
  } else if (!isReadyForInput(lines)) reason = 'esperando o Claude ficar pronto';

  const interrupting = s.mode === 'interrupt-first';
  if (reason === null && lines !== null) {
    if (interrupting && isWorking(lines) && !s.interruptSent) {
      fx.push({ type: 'write', data: '\x1b' });
      s.interruptSent = true;
      s.interruptAt = now;
      reason = 'interrompendo o Claude';
    } else if (interrupting && s.interruptAt !== null && isWorking(lines) && now - s.interruptAt < INTERRUPT_SETTLE_MS) {
      // A paste right after the ESC read as one escape sequence (ESC ESC[200~) and the turn went on: wait for the
      // screen to stop showing the turn (`isWorking`); if it never does, paste anyway (the CLI queues it).
      reason = 'interrompendo o Claude';
    } else if (needsIdleKind(s.cls) && !interrupting && isWorking(lines)) {
      reason = 'esperando o Claude terminar a rodada';
      visible = true;
    }
  }

  let leftover: string | null = null;
  if (reason === null && lines !== null) {
    const boxText = readInputText(lines);
    if (boxText === null) reason = 'esperando a caixa de entrada';
    else if (boxText !== '' && JUNK_ONLY.test(boxText) && s.junkCleans < MAX_JUNK_CLEANS) {
      // Only a leaked terminal report: Backspace erases it (never Esc: Esc Esc on a box just emptied opens Rewind).
      fx.push({ type: 'write', data: backspaces(boxText.length) });
      s.junkCleans += 1;
      s.lines = null; // read again before pasting: never paste on the screen that still shows it
      s.lastWaitReason = 'lendo a tela do Claude';
      s.failReason = s.lastWaitReason;
      return;
    } else if (boxText !== '') {
      leftover = boxText;
      reason = 'sobrou texto na caixa do terminal';
      visible = true;
    }
  }

  // The screen cannot prove the box, but the hooks say the CLI is mid-turn (a long command can hide the box or its
  // footer). A plain prompt is written anyway: it goes into the CLI's own queue, which takes typed messages
  // mid-turn (owner's decision, 30/10). Never without a screen read (a dialog must be ruled out), never into a
  // menu, and not for images (each `[Image #N]` must be seen), `/`/`!` (need the CLI idle) or interrupt-first
  // (its Esc needs the turn proven on screen): those keep waiting, with a visible reason and no clock.
  if (reason !== null && !visible && s.alive && s.working && s.interruptAt === null) {
    const blindOk =
      lines !== null &&
      s.cls.kind === 'prompt' &&
      s.images.length === 0 &&
      s.mode !== 'interrupt-first' &&
      readInputBox(lines).kind !== 'menu';
    if (blindOk) reason = null;
    else {
      reason = 'esperando o Claude terminar o que está fazendo';
      visible = true;
    }
  }

  // The 30 s clock only runs while nothing visible explains the wait.
  if (visible) s.waitSince = now;
  else if (s.reasonVisible) s.waitSince = now;
  s.reasonVisible = visible;

  if (leftover !== null && lines !== null) {
    if (s.leftoverShown !== leftover) {
      s.leftoverShown = leftover;
      fx.push({ type: 'leftover', text: leftover, canDiscard: !isWorking(lines) });
    }
  } else if (reason === null) s.leftoverShown = null;

  if (reason !== null) {
    s.lastWaitReason = reason;
    if (!visible && now - s.waitSince >= waitCliMs(s)) fail(s, 'o Claude não ficou pronto');
    else s.failReason = reason; // reused as the current waiting reason for the status
    return;
  }
  s.failReason = null;

  // Gate open: start pasting.
  s.boxEmptyAtPaste = lines !== null && readInputText(lines) === '';
  s.phase = 'typing';
  s.attempts += 1;
  s.imageIdx = 0;
  if (s.images.length > 0) {
    s.step = 'image';
    s.stepDeadline = now + IMAGE_MS;
    fx.push({ type: 'write', data: bracketedPaste(s.images[0]) });
  } else startText(s, now, fx);
}

function evaluateTyping(s: Draft, now: number, fx: SendEffect[]): void {
  const lines = s.lines;
  if (s.step === 'image') {
    if (lines !== null && imagePlaceholderCount(lines) >= s.imageIdx + 1) {
      s.imageIdx += 1;
      if (s.imageIdx < s.images.length) {
        s.stepDeadline = now + IMAGE_MS;
        fx.push({ type: 'write', data: bracketedPaste(s.images[s.imageIdx]) });
      } else if (s.text !== '') startText(s, now, fx);
      else enterConfirming(s, lines, now, fx);
      return;
    }
    if (s.stepDeadline !== null && now >= s.stepDeadline) fail(s, 'a imagem não entrou');
    return;
  }
  if (s.step === 'text') {
    const raw = lines === null ? null : readInputText(lines);
    const junk = raw === null || s.junkCleans >= MAX_JUNK_CLEANS ? null : junkAroundOurs(s, raw);
    if (junk !== null && lines !== null) {
      s.junkCleans += 1;
      if (junk.where === 'tail') {
        // The cursor sits after it: Backspace takes only the report, our text stays for its Enter.
        fx.push({ type: 'write', data: backspaces(junk.length) });
        s.lines = null;
        return;
      }
      // Before our text: an Enter would submit it too. Clean the box (CLI idle: Esc would interrupt a turn) and paste
      // again only once the gate sees it empty; mid-turn the box is left as is and the gate waits on it.
      if (!isWorking(lines)) fx.push({ type: 'write', data: '\x1b\x1b' });
      resetForRetry(s, now);
      return;
    }
    if (lines !== null && textSeen(s, lines)) {
      enterConfirming(s, lines, now, fx);
      return;
    }
    if (s.stepDeadline !== null && now >= s.stepDeadline) {
      // Mid-turn the box may be hidden or slow to redraw (a long command, a machine short of RAM) while the CLI did
      // take the paste: send the Enter anyway and follow the acceptance signals. One paste only; no Esc Esc. Not
      // with a dialog or a pending question up: there the Enter would answer it.
      const dialogUp = s.pendingOpen || s.terminalNeeded || (lines !== null && blockingScreen(lines) !== null);
      if (!dialogUp && midTurn(s, lines)) {
        enterConfirming(s, lines ?? [], now, fx);
        return;
      }
      // Idle, nothing on the screen in the way, the box still empty: a slow CLI may still draw the paste. Writing
      // it again would duplicate it, so wait (looking again every second) and only then give up.
      if (!dialogUp && s.textGiveUpAt !== null && now < s.textGiveUpAt && lines !== null && readInputText(lines) === '') {
        s.stepDeadline = Math.min(now + TEXT_RECHECK_MS, s.textGiveUpAt);
        return;
      }
      // Clean the box only if what is there is ours and the CLI is idle (Esc would interrupt a turn).
      if (lines !== null && !isWorking(lines) && boxIsOurs(s, lines)) fx.push({ type: 'write', data: '\x1b\x1b' });
      fail(s, 'o texto não entrou na caixa');
    }
  }
}

function evaluateConfirming(s: Draft, now: number, fx: SendEffect[]): void {
  const lines = s.lines;
  if (s.step === 'verify') {
    if (s.verifyAt !== null && now >= s.verifyAt) {
      s.verifyAt = null;
      fx.push({ type: 'ack-lookup', text: s.text, since: s.createdAt });
    }
    return;
  }
  if (s.step === 'menu-esc') {
    if (lines !== null && textSeen(s, lines) && !slashMenuOpen(lines)) {
      s.step = 'enter-gap';
      s.enterAt = now + ENTER_GAP_MS;
      return;
    }
    if (s.stepDeadline !== null && now >= s.stepDeadline) fail(s, 'o texto da caixa mudou');
    return;
  }
  if (s.step === 'enter-gap') {
    if (s.enterAt !== null && now >= s.enterAt) {
      fx.push({ type: 'write', data: '\r' });
      s.step = 'await-ack';
      s.idleAtEnter = !midTurn(s, lines);
      s.resendAt = now + RESEND_ENTER_MS;
      s.ackDeadline = now + (s.firstPaste ? FIRST_ACK_MS : ACK_MS);
      s.resendDone = false;
      s.resends = 0;
    }
    return;
  }
  if (s.step === 'await-ack') {
    // Screen is never an acceptance, except the screen a native command is expected to open.
    if (s.cls.kind === 'native' && s.opensScreen && lines !== null && blockingScreen(lines)?.kind === 'screen') {
      s.phase = 'accepted';
      s.step = 'done';
      return;
    }
    // Enter written mid-turn and our text is not in the box once the Enter resend window is over: the CLI took it
    // into its own queue (it only confirms on delivery; the signal may also just be late, as on a machine short
    // of RAM). It waits there like any `queued` send, and is checked when the turn ends.
    if (!s.idleAtEnter && s.resendAt !== null && now >= s.resendAt && lines !== null && !textSeen(s, lines)) {
      s.phase = 'queued';
      s.step = 'done';
      s.verifyAt = null;
      return;
    }
    if (s.ackDeadline !== null && now >= s.ackDeadline) {
      // Our text left the box after the Enter: the CLI took it and only the signal is missing (a late hook or
      // transcript, a machine at 100 %). Mid-turn on screen it waits like a queued send, checked when the turn ends;
      // idle, the transcript is asked now. Either way, never a new paste: a sender told "não foi" sent it twice.
      if (lines !== null && readInputText(lines) === '') {
        if (isWorking(lines) || s.working) {
          s.phase = 'queued';
          s.step = 'done';
          s.verifyAt = null;
        } else {
          s.step = 'verify';
          s.ackDeadline = null;
          fx.push({ type: 'ack-lookup', text: s.text, since: s.createdAt });
        }
        return;
      }
      if (s.unattended && lines !== null && textSeen(s, lines)) {
        // Our text still sits in the box: only the Enter again, while there are tries left (mid-turn the turn may still
        // be holding the CLI: it does not use them up). Out of tries, idle: clear our own text, then "não foi".
        const working = isWorking(lines);
        if (working || s.lateEnters < MAX_LATE_ENTERS) {
          fx.push({ type: 'write', data: '\r' });
          if (!working) s.lateEnters += 1;
          s.ackDeadline = now + LATE_ENTER_MS;
          s.attempts += 1;
          return;
        }
        fx.push({ type: 'write', data: '\x1b\x1b' });
      }
      fail(s, 'não foi');
      return;
    }
    // Text still in the box 3 s after Enter: nothing was submitted. One more `\r` (never the text again), up to
    // MAX_ENTER_RESENDS, 3 s apart. An empty box without acceptance may already have been delivered: wait, never resend.
    if (!s.resendDone && s.resendAt !== null && now >= s.resendAt && lines !== null && textSeen(s, lines)) {
      fx.push({ type: 'write', data: '\r' });
      s.resends += 1;
      s.resendDone = s.resends >= (s.firstPaste ? FIRST_MAX_ENTER_RESENDS : MAX_ENTER_RESENDS);
      if (!s.resendDone) s.resendAt = now + RESEND_ENTER_MS;
      s.attempts += 1;
    }
  }
}

// ------------------------------------------------------------------ output

function labelOf(s: Draft): SendLabel {
  if (s.step === 'lookup') return 'enviando…';
  switch (s.phase) {
    case 'waiting-cli':
    case 'queued':
      return 'na fila';
    case 'typing':
    case 'confirming':
      return 'enviando…';
    case 'accepted':
      return 'entrou';
    case 'failed':
      return 'não foi';
  }
}

function reasonOf(s: Draft): string | undefined {
  if (s.step === 'lookup') return 'procurando se a mensagem entrou';
  if (s.phase === 'failed' || s.phase === 'waiting-cli') return s.failReason ?? undefined;
  return undefined;
}

function nextWake(s: Draft, now: number): number | null {
  const candidates: number[] = [];
  switch (s.phase) {
    case 'waiting-cli':
      if (!s.reasonVisible) candidates.push(s.waitSince + waitCliMs(s));
      if (s.interruptAt !== null) candidates.push(s.interruptAt + INTERRUPT_SETTLE_MS);
      break;
    case 'typing':
      if (s.stepDeadline !== null) candidates.push(s.stepDeadline);
      break;
    case 'confirming':
      if (s.step === 'menu-esc' && s.stepDeadline !== null) candidates.push(s.stepDeadline);
      if (s.step === 'enter-gap' && s.enterAt !== null) candidates.push(s.enterAt);
      if (s.step === 'verify' && s.verifyAt !== null) candidates.push(s.verifyAt);
      if (s.step === 'await-ack') {
        if (s.ackDeadline !== null) candidates.push(s.ackDeadline);
        // mid-turn the resend time is also when an empty box turns the send into `queued`
        if (s.resendAt !== null && (!s.resendDone || !s.idleAtEnter)) candidates.push(s.resendAt);
      }
      break;
    case 'queued':
      if (s.verifyAt !== null) candidates.push(s.verifyAt);
      break;
    default:
      break;
  }
  const future = candidates.filter((at) => at > now);
  return future.length > 0 ? Math.min(...future) : null;
}

function finish(s: Draft, now: number, fx: SendEffect[]): StepResult {
  const key = `${s.phase}|${s.step === 'lookup' ? 'lookup' : ''}|${reasonOf(s) ?? ''}`;
  if (key !== s.lastStatusKey) {
    s.lastStatusKey = key;
    const reason = reasonOf(s);
    fx.push({ type: 'status', state: s.phase, label: labelOf(s), ...(reason !== undefined ? { reason } : {}) });
  }
  const wake = nextWake(s, now);
  if (wake !== null && wake !== s.lastWake) {
    s.lastWake = wake;
    fx.push({ type: 'wake-at', at: wake });
  }
  return { state: s, effects: fx };
}
