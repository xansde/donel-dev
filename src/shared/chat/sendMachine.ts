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
//   env      { alive?, pendingOpen?, terminalNeeded? }   process alive / `open` pending / "terminal needs you" banner
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

import { matchesPrompt, normalizePrompt } from './promptMatch';
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
}

export type SendStep = 'gate' | 'image' | 'text' | 'menu-esc' | 'enter-gap' | 'await-ack' | 'lookup' | 'done';

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
  readonly createdAt: number;
  readonly phase: SendState;
  readonly step: SendStep;
  readonly attempts: number;
  readonly failReason: string | null;
  readonly alive: boolean;
  readonly pendingOpen: boolean;
  readonly terminalNeeded: boolean;
  readonly lines: readonly LineInput[] | null;
  readonly waitSince: number;
  readonly reasonVisible: boolean;
  readonly interruptSent: boolean;
  readonly imageIdx: number;
  readonly stepDeadline: number | null;
  readonly enterAt: number | null;
  readonly resendAt: number | null;
  readonly ackDeadline: number | null;
  readonly resendDone: boolean;
  readonly idleAtEnter: boolean;
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
const IMAGE_MS = 3_000;
const TEXT_BASE_MS = 3_000;
const TEXT_PER_15KB_MS = 1_000;
const FIRST_PASTE_MS = 12_000;
const ACK_MS = 15_000;
const ENTER_GAP_MS = 80;
const RESEND_ENTER_MS = 3_000;

// ----------------------------------------------------------- text and class

/** §2: CRLF/CR → LF, strip C0/DEL/C1 controls (keeps LF and TAB), TAB → 4 spaces, trim only the borders. */
export function sanitizeOutgoing(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, '')
    .replace(/\t/g, '    ')
    .trim();
}

const NATIVE_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir', 'agents', 'bug', 'config', 'context', 'copy', 'cost', 'doctor', 'effort', 'exit', 'export', 'fast',
  'help', 'hooks', 'ide', 'init', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions',
  'plugin', 'plugins', 'pr-comments', 'privacy-settings', 'quit', 'release-notes', 'rename', 'resume', 'review',
  'rewind', 'skills', 'stats', 'status', 'statusline', 'terminal-setup', 'theme', 'upgrade', 'usage', 'vim',
]);

/** Which acceptance signals apply (§5 table). Expects the sanitized text. */
export function classifyOutgoing(text: string, options: { readonly customCommands?: ReadonlySet<string> } = {}): MessageClass {
  if (text.startsWith('!')) return { kind: 'shell' };
  if (!text.startsWith('/')) return { kind: 'prompt' };
  const name = /^\/(\S*)/.exec(text)?.[1] ?? '';
  const lower = name.toLowerCase();
  if (options.customCommands?.has(name) || options.customCommands?.has(lower)) return { kind: 'skill', name };
  if (lower === 'clear' || lower === 'new' || lower === 'reset') return { kind: 'clear' };
  if (lower === 'compact') return { kind: 'compact' };
  if (NATIVE_COMMANDS.has(lower)) return { kind: 'native', name };
  return { kind: 'skill', name };
}

function sendKindOf(cls: MessageClass): SendKind {
  if (cls.kind === 'prompt') return 'prompt';
  return cls.kind === 'shell' ? 'shell' : 'slash';
}

const needsIdleKind = (cls: MessageClass) => cls.kind !== 'prompt';

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
    createdAt: now,
    phase: 'waiting-cli',
    step: 'gate',
    attempts: 0,
    failReason: null,
    alive: true,
    pendingOpen: false,
    terminalNeeded: false,
    lines: null,
    waitSince: now,
    reasonVisible: false,
    interruptSent: false,
    imageIdx: 0,
    stepDeadline: null,
    enterAt: null,
    resendAt: null,
    ackDeadline: null,
    resendDone: false,
    idleAtEnter: true,
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
  s.attempts += 1;
  s.lines = null; // wait for a fresh read: never paste on a stale screen
  s.waitSince = now;
  s.reasonVisible = false;
  s.interruptSent = false;
  s.imageIdx = 0;
  s.stepDeadline = null;
  s.enterAt = null;
  s.resendAt = null;
  s.ackDeadline = null;
  s.resendDone = false;
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
  if (s.step !== 'await-ack' && s.phase !== 'queued') return;
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
        if (name === cls.name) accept();
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
  if (placeholder && /^\[Pasted text #\d+(?: \+\d+ lines?)?\]$/.test(stripped)) {
    const breaks = (s.text.match(/\n/g) ?? []).length;
    return placeholder.lines === null || placeholder.lines === breaks;
  }
  return false;
}

/** Text in the box is a prefix of ours (so a timeout may clean it without eating the owner's own typing). */
function boxIsOurs(s: Draft, lines: readonly LineInput[]): boolean {
  const raw = readInputText(lines);
  if (raw === null) return false;
  const stripped = squash(raw.replace(/\[Image #\d+\]/g, ''));
  return stripped !== '' && squash(s.text).startsWith(stripped);
}

function textDeadlineMs(s: Draft): number {
  const bytes = new TextEncoder().encode(s.text).length;
  const ms = TEXT_BASE_MS + Math.floor(bytes / 15_000) * TEXT_PER_15KB_MS;
  return s.firstPaste ? Math.max(ms, FIRST_PASTE_MS) : ms;
}

function startText(s: Draft, now: number, fx: SendEffect[]): void {
  s.step = 'text';
  s.stepDeadline = now + textDeadlineMs(s);
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
    default:
      return; // queued: no deadline, depends on the turn
  }
}

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
    } else if (needsIdleKind(s.cls) && !interrupting && isWorking(lines)) {
      reason = 'esperando o Claude terminar a rodada';
      visible = true;
    }
  }

  let leftover: string | null = null;
  if (reason === null && lines !== null) {
    const boxText = readInputText(lines);
    if (boxText === null) reason = 'esperando a caixa de entrada';
    else if (boxText !== '') {
      leftover = boxText;
      reason = 'sobrou texto na caixa do terminal';
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
    if (!visible && now - s.waitSince >= WAIT_CLI_MS) fail(s, 'o Claude não ficou pronto');
    else s.failReason = reason; // reused as the current waiting reason for the status
    return;
  }
  s.failReason = null;

  // Gate open: start pasting.
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
    if (lines !== null && textSeen(s, lines)) {
      enterConfirming(s, lines, now, fx);
      return;
    }
    if (s.stepDeadline !== null && now >= s.stepDeadline) {
      // Clean the box only if what is there is ours and the CLI is idle (Esc would interrupt a turn).
      if (lines !== null && !isWorking(lines) && boxIsOurs(s, lines)) fx.push({ type: 'write', data: '\x1b\x1b' });
      fail(s, 'o texto não entrou na caixa');
    }
  }
}

function evaluateConfirming(s: Draft, now: number, fx: SendEffect[]): void {
  const lines = s.lines;
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
      s.idleAtEnter = lines === null ? true : !isWorking(lines);
      s.resendAt = now + RESEND_ENTER_MS;
      s.ackDeadline = now + ACK_MS;
      s.resendDone = false;
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
    if (s.ackDeadline !== null && now >= s.ackDeadline) {
      fail(s, 'não foi');
      return;
    }
    // Text still in the box 3 s after Enter: nothing was submitted. One more `\r`, once. An empty box
    // without acceptance may already have been delivered: wait, never resend.
    if (!s.resendDone && s.resendAt !== null && now >= s.resendAt && lines !== null && textSeen(s, lines)) {
      fx.push({ type: 'write', data: '\r' });
      s.resendDone = true;
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
      if (!s.reasonVisible) candidates.push(s.waitSince + WAIT_CLI_MS);
      break;
    case 'typing':
      if (s.stepDeadline !== null) candidates.push(s.stepDeadline);
      break;
    case 'confirming':
      if (s.step === 'menu-esc' && s.stepDeadline !== null) candidates.push(s.stepDeadline);
      if (s.step === 'enter-gap' && s.enterAt !== null) candidates.push(s.enterAt);
      if (s.step === 'await-ack') {
        if (s.ackDeadline !== null) candidates.push(s.ackDeadline);
        if (!s.resendDone && s.resendAt !== null) candidates.push(s.resendAt);
      }
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
