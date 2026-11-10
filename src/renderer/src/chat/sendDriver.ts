// 014-chat (T065) - the send driver: runs `sendMachine` instances (one per message) over the hidden terminal.
// Pure orchestration with injected ports (clock, timers, PTY write, screen read, ack lookup), so it is
// tested without a DOM or a PTY (`tests/chat-send-driver.test.ts`).
//
//   - FIFO per tab: ONE machine is active at a time (waiting-cli/typing/confirming); the next message
//     starts when the active one is queued by the CLI, accepted or failed.
//   - Acceptance signals (`chat:prompt-signal`) reach the OLDEST pending send that matches. The same prompt
//     arrives twice (hook + transcript): the second copy is dropped (`dedupeSignal`).
//   - Machine effects: write → PTY; wake-at → timer + fresh screen read; ack-lookup → IPC; status/leftover →
//     the view the composer renders.
//   - Every transition INTO `failed` goes once to `reportFailure` (the gate detail for `chat-diagnostics.log`,
//     never the message text): a retry that fails again is a new report.
//   - 06/11 - the owner comes first. A message from another session (`from: 'session'`: "◆ … terminou", sessao_enviar)
//     never starts while the owner is typing in the terminal or has a message of his own waiting, and the notices
//     held meanwhile go in as ONE message. While a notice is being written (paste → Enter), the owner's keystrokes
//     are held and written right after its Enter, never in the middle of it. Before, a notice's Enter submitted
//     what the owner was typing, cut ("trava não fi"), and his message waited behind every notice.
//     An Enter of a notice that looks lost (the notice still in the box) is written again BEFORE his held keys go
//     in: released into that box, they would ride along with the notice on his next Enter (Revisor, #257).
//     Only `session` sends merge with each other; an `owner` send (chat, Jobu, a card, "Pedir") never does.

import type { PromptSignalKind } from '../../../shared/chat/ipc';
import { commandResolvesTo, matchOldestPending, matchesPrompt, normalizePrompt, oldestPending } from '../../../shared/chat/promptMatch';
import type { SendKind, SendMode, SendState } from '../../../shared/chat/rows';
import { readInputText } from '../../../shared/chat/screen';
import { describeSendFailure, type SendFailureDetail } from '../../../shared/chat/sendDiagnostics';
import {
  createSend,
  step,
  type MessageClass,
  type SendEffect,
  type SendEvent,
  type SendInput,
  type SendLabel,
  type SendMachineState,
} from '../../../shared/chat/sendMachine';
import type { LineInput } from '../../../shared/screenLine';

export interface SendDriverPorts {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Raw bytes to the PTY; `false` = no live process. */
  write(data: string): boolean;
  /** Current screen of the hidden terminal (`[]` without a terminal). */
  readLines(): readonly LineInput[];
  ackLookup(text: string, sinceIso: string): Promise<{ readonly matched: boolean }>;
  /** The Enter of a command marked `opensScreen` went out: the terminal-needed strip shows up (T070). */
  opensScreen?(): void;
  /** A send has just ended in `failed`: the gate detail for the diagnostics log (no message or screen text). */
  reportFailure?(detail: SendFailureDetail): void;
  /** 08/11 — what the box held right before a session message cleared it (Esc Esc): kept for the owner. */
  boxCleared?(text: string): void;
}

export interface SendRequest {
  readonly text: string;
  /** Absolute paths, one paste each. */
  readonly imagePaths?: readonly string[];
  readonly mode?: SendMode;
  readonly opensScreen?: boolean;
  readonly customCommands?: ReadonlySet<string>;
  /**
   * Who sends it: `owner` (the chat box, the Jobu, a button the owner pressed: the default) or `session` (a notice or
   * a message from another session). The owner always goes first; a `session` message waits for him (see the top).
   */
  readonly from?: SendFrom;
  /**
   * 07/11 — the same text sent again while the first send is still on its way (at most `DEDUPE_MS`) answers for it
   * instead of going in twice. After the first one went in (or failed), the same text is a new message. For `sessao_enviar`: a sender that heard "não entrou" or a timeout while the message did go in
   * sent it again, and the destination got it twice.
   */
  readonly dedupe?: boolean;
}

export type SendFrom = 'owner' | 'session';

export interface SendEnv {
  readonly alive?: boolean;
  readonly pendingOpen?: boolean;
  readonly terminalNeeded?: boolean;
  /** Mid-turn according to the hooks. */
  readonly working?: boolean;
}

export interface DriverSignal {
  readonly signal: PromptSignalKind;
  readonly text?: string;
  /** ISO-8601. */
  readonly at: string;
  readonly origin?: 'hook' | 'transcript';
}

/** `pending` = not started yet: waiting for the message before it. */
export interface SendItemView {
  readonly id: string;
  readonly text: string;
  readonly images: readonly string[];
  readonly kind: SendKind;
  readonly mode: SendMode;
  readonly state: SendState | 'pending';
  readonly label: SendLabel;
  /** Human reason of the current wait/failure (pt-BR). */
  readonly reason?: string;
  /** D-C10: why a queued message is still queued. */
  readonly queuedReason?: string;
  readonly leftover: { readonly text: string; readonly canDiscard: boolean } | null;
  readonly createdAt: number;
  /** Esc before the first answer: the CLI gave the text back to its box, so the message did not stay (see `markReturned`). */
  readonly returned?: boolean;
}

interface Item {
  readonly id: string;
  readonly request: SendRequest;
  readonly from: SendFrom;
  /** What is pasted: the request text, plus the notices merged into this one while they waited for the owner. */
  text: string;
  /** When the first Enter of this attempt went out (session messages: the owner's keys are held until then). */
  enterWrittenAt: number | null;
  /** When the last Enter of this attempt went out (the first, a resend of the machine, or one written for the owner). */
  lastEnterAt: number | null;
  readonly createdAt: number;
  mode: SendMode;
  machine: SendMachineState | null;
  timer: unknown;
  label: SendLabel;
  reason: string | undefined;
  canDiscard: boolean;
  dismissed: boolean;
  returned: boolean;
}

const ACTIVE_PHASES: ReadonlySet<SendState> = new Set(['waiting-cli', 'typing', 'confirming']);
const isActive = (item: Item): boolean => item.machine !== null && ACTIVE_PHASES.has(item.machine.phase);
const SIGNAL_TTL_MS = 30_000;
/** A session message does not start until the owner has not typed in the terminal for this long. */
export const OWNER_QUIET_MS = 2_000;
/** After a session message's Enter, the owner's held keys wait at most this long for the box to clear. */
const OWNER_HOLD_AFTER_ENTER_MS = 1_500;
/**
 * The owner's keys are never held longer than this, whatever the notice is doing: room for the paste, its Enter and
 * two more Enters `OWNER_HOLD_AFTER_ENTER_MS` apart when the box still shows the notice.
 */
const OWNER_HOLD_MAX_MS = 5_000;
const MAX_ALIASES = 500;
/** How long a deduped send answers for a resend of the same text. */
const DEDUPE_MS = 10 * 60_000;

/**
 * Bytes the terminal emits on its own (focus in/out, cursor and device reports, mouse; and, 08/11, its answers to what
 * tmux asks on every attach of a remote session: DA2 `ESC[>…c`, version `ESC P>|…`, colours `ESC]10/11;rgb:…`): not the owner typing.
 * Everything else that reaches the PTY from the terminal is (keys, Enter, Backspace, arrows, a paste).
 */
const TERMINAL_REPORT =
  /^(?:\x1b\[(?:I|O|[?>][\d;]*c|\d+;\d+R|<[\d;]+[Mm]|M[\s\S]{3})|\x1bP>\|[^\x1b]*\x1b\\|\x1b\]1[01];rgb:[\da-fA-F/]+(?:\x07|\x1b\\))+$/; // several answers may come in one chunk
export const isOwnerTyping = (data: string): boolean => data !== '' && !TERMINAL_REPORT.test(data);

/** Session messages that can go in as one paste (plain text, no image, no command). */
const mergeable = (item: Item): boolean =>
  item.from === 'session' &&
  (item.request.imagePaths?.length ?? 0) === 0 &&
  (item.request.mode ?? 'normal') === 'normal' &&
  item.request.opensScreen !== true &&
  !/^[/!]/.test(item.text.trimStart());

const CAUSE_WORKING = 'entra na próxima pausa do Claude';
const CAUSE_STARTING = 'entra assim que o Claude ficar pronto';
const CAUSE_PENDING = 'entra depois que você responder';
const CAUSE_TERMINAL = 'entra quando o terminal liberar';
const CAUSE_LEFTOVER = 'entra quando a caixa do terminal esvaziar';
const CAUSE_PREVIOUS = 'entra depois da mensagem anterior';

/** D-C10 - caption for a message that has not been delivered yet. */
function queuedCause(item: Item, activeReason: string | undefined): string {
  const m = item.machine;
  if (m === null) return activeReason ?? CAUSE_PREVIOUS;
  if (m.phase === 'queued') return CAUSE_WORKING;
  switch (m.failReason) {
    case 'esperando o Claude terminar a rodada':
    case 'esperando o Claude terminar o que está fazendo':
      return CAUSE_WORKING;
    case 'há uma pergunta ou permissão esperando você':
      return CAUSE_PENDING;
    case 'o terminal precisa de você':
      return CAUSE_TERMINAL;
    case 'sobrou texto na caixa do terminal':
      return CAUSE_LEFTOVER;
    default:
      return CAUSE_STARTING;
  }
}

const FAIL_REASON_ALIASES: Readonly<Record<string, string>> = {
  'não foi': 'o Claude não confirmou o recebimento',
};

/** State the design-system `OwnerMessage` draws for this send. */
export function ownerSendState(view: Pick<SendItemView, 'state' | 'returned'>): 'sending' | 'queued' | 'sent' | 'failed' | 'interrupted' {
  if (view.returned === true) return 'interrupted';
  switch (view.state) {
    case 'typing':
    case 'confirming':
      return 'sending';
    case 'accepted':
      return 'sent';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

/** Does this signal concern this send? (class-aware, text-aware). */
function accepts(cls: MessageClass, text: string, sig: DriverSignal): boolean {
  switch (sig.signal) {
    case 'submit':
    case 'enqueue':
    case 'deliver':
      return (cls.kind === 'prompt' || cls.kind === 'skill') && sig.text !== undefined && matchesPrompt(text, sig.text);
    case 'command':
      return cls.kind === 'skill' && (/^\/?(\S*)/.exec(sig.text ?? '')?.[1] === cls.name || commandResolvesTo(text, sig.text ?? ''));
    case 'shell':
      return cls.kind === 'shell';
    case 'local':
      return cls.kind === 'native';
    case 'unknown-command': {
      if (cls.kind !== 'skill' && cls.kind !== 'native') return false;
      const name = /^\/?(\S*)/.exec(sig.text ?? '')?.[1];
      return name === undefined || name === '' || name.toLowerCase() === cls.name.toLowerCase();
    }
    case 'session-switch':
      return cls.kind === 'clear';
    case 'compact':
      return cls.kind === 'compact';
  }
}

export class SendDriver {
  private items: Item[] = [];
  private view: readonly SendItemView[] = [];
  private readonly listeners = new Set<() => void>();
  private env: Required<SendEnv> = { alive: true, pendingOpen: false, terminalNeeded: false, working: false };
  private seq = 0;
  private sentCount = 0;
  private disposed = false;
  /** Echo filter: how many copies of a signal each origin delivered (`kind\0text`). */
  private readonly seen = new Map<string, { hook: number; transcript: number; at: number }>();
  /** Last time the owner typed in the terminal (`null`: never). */
  private ownerTypedAt: number | null = null;
  /** Last time a key of the owner actually reached the PTY (typed through, or released after being held). */
  private ownerWrittenAt: number | null = null;
  /** The owner typed and the box has not been seen empty since: his text may be in it. */
  private ownerBoxDirty = false;
  /** The owner's keys held while a session message was being written, in order. */
  private held: { data: string; forward: (data: string) => void }[] = [];
  private heldSince: number | null = null;
  private ownerTimer: unknown = undefined;
  private holdTimer: unknown = undefined;
  /** A session message merged into another: its id answers for the one that carries it (`carrierOf`). */
  private readonly aliases = new Map<string, string>();
  /** Deduped sends by normalized text: the first id and when it was sent. */
  private readonly recent = new Map<string, { readonly id: string; readonly at: number }>();
  /** Ids that reached `accepted` or `queued` (`sendToTabAndWait` hears "entrou" for them after they leave the list). */
  private readonly delivered = new Set<string>();
  /** Some send of this tab was taken by the CLI. */
  private took = false;

  constructor(private readonly ports: SendDriverPorts) {}

  // ------------------------------------------------------------------ public

  enqueue(request: SendRequest): string {
    const resent = this.resendOf(request);
    if (resent !== null) return resent;
    const id = `send-${++this.seq}-${this.ports.now().toString(36)}`;
    if (request.dedupe === true) this.remember(request.text, id);
    const from = request.from ?? 'owner';
    this.items.push({
      id,
      request,
      from,
      text: request.text,
      enterWrittenAt: null,
      lastEnterAt: null,
      createdAt: this.ports.now(),
      mode: request.mode ?? 'normal',
      machine: null,
      timer: undefined,
      label: 'na fila',
      reason: undefined,
      canDiscard: false,
      dismissed: false,
      returned: false,
    });
    // Finished sends only matter while the composer/timeline merge them; keep the list bounded.
    const finished = (i: Item): boolean => i.machine !== null && (i.machine.phase === 'accepted' || i.machine.phase === 'failed');
    while (this.items.length > 200) {
      const old = this.items.find(finished);
      if (old === undefined) break;
      this.ports.clearTimeout(old.timer);
      this.items = this.items.filter((i) => i !== old);
    }
    // The owner's message goes before a notice that has not written anything yet.
    if (from === 'owner') this.demoteWaitingSession();
    this.pump();
    this.publish();
    return id;
  }

  /** The send that carries `id`: itself, or the notice it was merged into while waiting for the owner. */
  carrierOf(id: string): string {
    return this.aliases.get(id) ?? id;
  }

  /** The CLI took some send of this tab (an acceptance signal, from a hook or the transcript, or a lookup). */
  tookMessage(): boolean {
    return this.took;
  }

  /** `id` (or its carrier) was taken by the CLI, even if it already left the list. */
  wasDelivered(id: string): boolean {
    return this.delivered.has(this.carrierOf(id));
  }

  /**
   * A deduped send of the same text still on its way (not accepted, not failed): the id that answers for this one.
   * Once the first went in, the same text again is a new message ("Siga de onde parou" after a second 429) and goes.
   */
  private resendOf(request: SendRequest): string | null {
    if (request.dedupe !== true) return null;
    const key = normalizePrompt(request.text);
    const prev = this.recent.get(key);
    if (prev === undefined || this.ports.now() - prev.at >= DEDUPE_MS) return null;
    const carrier = this.carrierOf(prev.id);
    const phase = this.items.find((i) => i.id === carrier)?.machine?.phase;
    if (phase === undefined || phase === 'accepted' || phase === 'failed') return null;
    return prev.id;
  }

  private remember(text: string, id: string): void {
    const now = this.ports.now();
    for (const [key, rec] of this.recent) if (now - rec.at >= DEDUPE_MS) this.recent.delete(key);
    this.recent.set(normalizePrompt(text), { id, at: now });
    while (this.recent.size > MAX_ALIASES) this.recent.delete(this.recent.keys().next().value as string);
  }

  /**
   * A keystroke (or paste) of the owner in this tab's terminal, on its way to the PTY. `forward` writes it: now, or
   * right after the Enter of a session message being written at this very moment (never in the middle of it).
   */
  ownerInput(data: string, forward: (data: string) => void): void {
    if (this.disposed || !isOwnerTyping(data)) {
      forward(data);
      return;
    }
    const now = this.ports.now();
    this.ownerTypedAt = now;
    this.ownerBoxDirty = true;
    if (this.held.length > 0 || this.sessionWriting(now)) {
      this.held.push({ data, forward });
      this.heldSince ??= now;
      this.armHoldTimer();
    } else this.writeOwner(data, forward);
    this.demoteWaitingSession();
    this.armOwnerTimer(now);
    this.pump();
    this.publish();
  }

  getItems(): readonly SendItemView[] {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setEnv(env: SendEnv): void {
    const next = { ...this.env, ...stripUndefined(env) };
    if (
      next.alive === this.env.alive &&
      next.pendingOpen === this.env.pendingOpen &&
      next.terminalNeeded === this.env.terminalNeeded &&
      next.working === this.env.working
    )
      return;
    this.env = next;
    for (const item of this.items) {
      if (isActive(item) || item.machine?.phase === 'queued') this.dispatch(item, { type: 'env', now: this.ports.now(), ...env });
    }
    this.pump();
    this.publish();
  }

  /** The hidden terminal drew something: feed the active machine a fresh screen. */
  onScreen(): void {
    const item = this.items.find(isActive);
    if (item === undefined) {
      // A notice waiting for the owner: the box he just emptied (his Enter) lets it go.
      if (this.held.length > 0 || this.items.some((i) => i.machine === null)) {
        this.pump();
        this.publish();
      }
      return;
    }
    this.feedScreen(item);
    this.pump();
    this.publish();
  }

  handleSignal(sig: DriverSignal): void {
    if (this.dedupeSignal(sig)) return;
    const at = Date.parse(sig.at);
    const now = this.ports.now();
    const awaiting = this.items.filter((i) => i.machine !== null && (i.machine.step === 'await-ack' || i.machine.step === 'verify' || i.machine.phase === 'queued'));
    if (awaiting.length === 0) return;
    const candidates = awaiting.map((i) => ({ item: i, text: i.machine!.text, cls: i.machine!.cls, createdAt: i.machine!.createdAt }));
    const textual = sig.signal === 'submit' || sig.signal === 'enqueue' || sig.signal === 'deliver';
    const hit =
      textual && sig.text !== undefined
        ? matchOldestPending(candidates, sig.text)
        : oldestPending(candidates, (c) => accepts(c.cls, c.text, sig));
    if (hit === null) return;
    this.dispatch(hit.item, {
      type: 'signal',
      now,
      signal: { signal: sig.signal, ...(sig.text !== undefined ? { text: sig.text } : {}), at: Number.isNaN(at) ? now : at },
    });
    this.pump();
    this.publish();
  }

  retry(id: string): void {
    this.act(id, 'retry');
  }

  discardAndSend(id: string): void {
    this.act(id, 'discard-and-send', false);
  }

  /** "Interromper e mandar agora" on a message that is still waiting. */
  interruptAndSend(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item === undefined) return;
    if (item.machine === null) {
      item.mode = 'interrupt-first';
      this.publish();
      return;
    }
    this.act(id, 'interrupt-and-send');
  }

  /**
   * The CLI cancelled this (accepted) message before any answer and gave its text back to the terminal box:
   * the card says "interrompida" instead of "entrou" from now on.
   */
  markReturned(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item === undefined || item.returned) return;
    item.returned = true;
    this.publish();
  }

  /** Drops a finished send from the list (the real transcript row took over). */
  dismiss(id: string): void {
    const item = this.items.find((i) => i.id === this.carrierOf(id));
    if (item === undefined) return;
    this.ports.clearTimeout(item.timer);
    item.dismissed = true;
    this.items = this.items.filter((i) => i !== item);
    this.pump();
    this.publish();
  }

  dispose(): void {
    this.releaseHeld();
    this.disposed = true;
    this.ports.clearTimeout(this.ownerTimer);
    for (const item of this.items) this.ports.clearTimeout(item.timer);
    this.items = [];
    this.view = [];
    this.listeners.clear();
  }

  // ----------------------------------------------------------------- internals

  private act(id: string, action: 'retry' | 'discard-and-send' | 'interrupt-and-send', feed = true): void {
    const item = this.items.find((i) => i.id === id);
    if (item === undefined || item.machine === null) return;
    this.dispatch(item, { type: 'action', now: this.ports.now(), action });
    if (feed && isActive(item)) this.feedScreen(item);
    this.pump();
    this.publish();
  }

  /** True when the signal is the echo of one already handled (other origin delivered it first). */
  private dedupeSignal(sig: DriverSignal): boolean {
    if (sig.origin === undefined) return false;
    const now = this.ports.now();
    for (const [key, rec] of this.seen) if (now - rec.at > SIGNAL_TTL_MS) this.seen.delete(key);
    const key = `${sig.signal}\0${sig.text === undefined ? '' : normalizePrompt(sig.text)}`;
    const rec = this.seen.get(key) ?? { hook: 0, transcript: 0, at: now };
    const mine = sig.origin;
    const other = mine === 'hook' ? 'transcript' : 'hook';
    const echo = rec[other] > rec[mine];
    rec[mine] += 1;
    rec.at = now;
    if (rec.hook === rec.transcript) this.seen.delete(key);
    else this.seen.set(key, rec);
    return echo;
  }

  private feedScreen(item: Item): void {
    if (item.machine === null) return;
    this.dispatch(item, { type: 'screen', now: this.ports.now(), screen: { lines: this.ports.readLines() } });
  }

  /** Starts the next message when none is active: the owner's first; a session message only when he is not typing. */
  private pump(): void {
    if (this.disposed) return;
    for (;;) {
      if (this.items.some(isActive)) return;
      let next = this.items.find((i) => i.machine === null && i.from === 'owner');
      if (next === undefined) {
        const waiting = this.items.filter((i) => i.machine === null);
        if (waiting.length === 0 || this.ownerHolds()) return;
        next = this.mergeWaiting(waiting);
      }
      next.enterWrittenAt = null;
      next.lastEnterAt = null;
      const input: SendInput = {
        id: next.id,
        text: next.text,
        imagePaths: next.request.imagePaths,
        mode: next.mode,
        firstPaste: this.sentCount === 0,
        opensScreen: next.request.opensScreen,
        customCommands: next.request.customCommands,
        unattended: next.from === 'session',
      };
      this.sentCount += 1;
      const created = createSend(input, this.ports.now());
      next.machine = created.state;
      this.noteFailure(null, created.state);
      this.runEffects(next, created.effects);
      this.dispatch(next, { type: 'env', now: this.ports.now(), ...this.env });
      if (isActive(next)) this.feedScreen(next);
    }
  }

  private dispatch(item: Item, event: SendEvent): void {
    if (item.machine === null || this.disposed || item.dismissed) return;
    const before = item.machine.phase;
    const result = step(item.machine, event);
    item.machine = result.state;
    if (result.state.phase === 'accepted' || result.state.phase === 'queued') {
      this.took = true;
      if (!this.delivered.has(item.id)) {
        this.delivered.add(item.id);
        while (this.delivered.size > MAX_ALIASES) this.delivered.delete(this.delivered.values().next().value as string);
      }
    }
    this.noteFailure(before, result.state);
    this.runEffects(item, result.effects);
  }

  /** Reports the transition into `failed` (once per failure; a diagnostics port that throws never breaks the send). */
  private noteFailure(before: SendState | null, after: SendMachineState): void {
    if (after.phase !== 'failed' || before === 'failed' || this.ports.reportFailure === undefined) return;
    try {
      this.ports.reportFailure(describeSendFailure(after, this.ports.now()));
    } catch {
      // diagnostics must never break the send
    }
  }

  private runEffects(item: Item, effects: readonly SendEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'write':
          if (effect.data === '\r' && item.from === 'session') {
            // An Enter written again (the first one looked lost) once a key of the owner reached the box would submit
            // HIS text with it. Keys still held never reached it: then the Enter is safe, and wanted. (The screen cannot
            // clear him: his keys may still be on their way through ssh.)
            if (item.enterWrittenAt !== null && this.ownerWrittenAt !== null && this.ownerWrittenAt >= item.enterWrittenAt) break;
            item.enterWrittenAt ??= this.ports.now();
            item.lastEnterAt = this.ports.now();
          }
          // The same for the Esc Esc an unattended send writes to clear its own text when it gives up (08/11): a key of
          // the owner sent after its Enter may be in that box too, and must not be erased with it.
          if (effect.data === '\x1b\x1b' && item.from === 'session' && item.enterWrittenAt !== null && this.ownerWrittenAt !== null && this.ownerWrittenAt >= item.enterWrittenAt)
            break;
          if (effect.data === '\x1b\x1b' && item.from === 'session') this.keepCleared();
          this.ports.write(effect.data);
          if (effect.data === '\r' && item.request.opensScreen === true) this.ports.opensScreen?.();
          break;
        case 'wake-at': {
          this.ports.clearTimeout(item.timer);
          const delay = Math.max(0, effect.at - this.ports.now());
          item.timer = this.ports.setTimeout(() => {
            item.timer = undefined;
            if (this.disposed || item.dismissed || item.machine === null) return;
            this.feedScreen(item);
            this.pump();
            this.publish();
          }, delay);
          break;
        }
        case 'ack-lookup': {
          const since = new Date(effect.since).toISOString();
          void this.ports.ackLookup(effect.text, since).then(
            (r) => this.onAck(item, r.matched),
            () => this.onAck(item, false),
          );
          break;
        }
        case 'status':
          item.label = effect.label;
          item.reason = effect.reason;
          break;
        case 'leftover':
          item.canDiscard = effect.canDiscard;
          break;
      }
    }
  }

  /**
   * 08/11 (Revisor, #333) — a session message is about to clear the box (its own text that never went in, or a leftover
   * redrawn next to its paste). What the box shows goes to the owner first: it may be a draft of his. A long paste only
   * shows as `[Pasted text #N]`; that marker is what is kept then.
   */
  private keepCleared(): void {
    const text = readInputText(this.ports.readLines());
    if (text === null || text.trim() === '') return;
    try {
      this.ports.boxCleared?.(text);
    } catch {
      // keeping it must never stop the send
    }
  }

  private onAck(item: Item, found: boolean): void {
    if (this.disposed || item.dismissed) return;
    this.dispatch(item, { type: 'ack-result', now: this.ports.now(), found });
    if (isActive(item)) this.feedScreen(item);
    this.pump();
    this.publish();
  }

  // ------------------------------------------------------------- the owner first

  /** The owner typed a moment ago, or typed and the box has not been seen empty since: notices wait. */
  private ownerHolds(): boolean {
    if (this.ownerTypedAt === null) return false;
    if (this.ports.now() - this.ownerTypedAt < OWNER_QUIET_MS) {
      this.armOwnerTimer(this.ownerTypedAt);
      return true;
    }
    if (this.ownerBoxDirty && readInputText(this.ports.readLines()) === '') this.ownerBoxDirty = false;
    // Text of his still in the box (or a box that cannot be read): wait for him to send it. A screen update (his
    // Enter) looks again; there is no clock, so a notice never fails for waiting.
    return this.ownerBoxDirty;
  }

  /** Looks again when the quiet time after the owner's last key is over. */
  private armOwnerTimer(typedAt: number): void {
    this.ports.clearTimeout(this.ownerTimer);
    const delay = Math.max(0, typedAt + OWNER_QUIET_MS - this.ports.now());
    this.ownerTimer = this.ports.setTimeout(() => {
      this.ownerTimer = undefined;
      if (this.disposed) return;
      this.pump();
      this.publish();
    }, delay);
  }

  /** While keys are held, looks again on a short beat (the cap must hold even without a screen update). */
  private armHoldTimer(): void {
    if (this.holdTimer !== undefined) return;
    this.holdTimer = this.ports.setTimeout(() => {
      this.holdTimer = undefined;
      if (this.disposed || this.held.length === 0) return;
      this.publish();
      if (this.held.length > 0) this.armHoldTimer();
    }, 100);
  }

  /**
   * A session message is in the middle of its write (paste written and Enter not yet, or Enter written and the box
   * not cleared yet): a key of the owner now would land inside it, or be submitted with it. When the box still shows
   * the notice `OWNER_HOLD_AFTER_ENTER_MS` after its last Enter, that Enter looks lost: it is written again here,
   * while his keys are still held (the box holds only the notice), and they keep waiting for the box to clear.
   */
  private sessionWriting(now: number): boolean {
    if (this.heldSince !== null && now - this.heldSince >= OWNER_HOLD_MAX_MS) return false;
    const item = this.items.find((i) => i.from === 'session' && isActive(i));
    const m = item?.machine;
    if (item === undefined || m == null) return false;
    if (m.phase === 'typing') return true;
    if (m.phase !== 'confirming') return false;
    if (m.step !== 'await-ack' || item.enterWrittenAt === null || item.lastEnterAt === null) return true;
    const box = readInputText(this.ports.readLines());
    if (box === null || box === '') return false;
    if (now - item.lastEnterAt < OWNER_HOLD_AFTER_ENTER_MS) return true;
    // A key of his already in the box: an Enter now would submit it too (the same rule as the machine's resend).
    if (this.ownerWrittenAt !== null && this.ownerWrittenAt >= item.enterWrittenAt) return false;
    this.ports.write('\r');
    item.lastEnterAt = now;
    return true;
  }

  /** Writes one key of the owner to the PTY now. */
  private writeOwner(data: string, forward: (data: string) => void): void {
    this.ownerWrittenAt = this.ports.now();
    forward(data);
  }

  /** Writes the owner's held keys, in order. */
  private releaseHeld(): void {
    const held = this.held;
    this.held = [];
    this.heldSince = null;
    this.ports.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    for (const key of held) this.writeOwner(key.data, key.forward);
  }

  /** A session message that has not written anything yet goes back to waiting (the owner comes first). */
  private demoteWaitingSession(): void {
    const item = this.items.find((i) => i.from === 'session' && isActive(i));
    const m = item?.machine;
    if (item === undefined || m == null || m.phase !== 'waiting-cli' || m.attempts > 0 || m.interruptSent) return;
    this.ports.clearTimeout(item.timer);
    item.timer = undefined;
    item.machine = null;
    item.label = 'na fila';
    item.reason = undefined;
    item.canDiscard = false;
  }

  /** The notices that piled up while the owner typed go in as one message (none is lost: each id answers for it). */
  private mergeWaiting(waiting: readonly Item[]): Item {
    const carrier = waiting[0];
    if (!mergeable(carrier)) return carrier;
    const rest = waiting.slice(1).filter(mergeable);
    if (rest.length === 0) return carrier;
    carrier.text = [carrier.text, ...rest.map((i) => i.text)].join('\n');
    for (const item of rest) {
      for (const [alias, to] of this.aliases) if (to === item.id) this.aliases.set(alias, carrier.id);
      this.aliases.set(item.id, carrier.id);
      this.ports.clearTimeout(item.timer);
    }
    while (this.aliases.size > MAX_ALIASES) this.aliases.delete(this.aliases.keys().next().value as string);
    this.items = this.items.filter((i) => !rest.includes(i));
    return carrier;
  }

  private publish(): void {
    if (this.disposed) return;
    if (this.held.length > 0 && !this.sessionWriting(this.ports.now())) this.releaseHeld();
    const active = this.items.find(isActive);
    const activeCause = active !== undefined ? queuedCause(active, undefined) : undefined;
    this.view = this.items.map((item): SendItemView => {
      const m = item.machine;
      const state: SendState | 'pending' = m === null ? 'pending' : m.phase;
      const waiting = state === 'pending' || state === 'waiting-cli' || state === 'queued';
      const reason =
        state === 'failed' || state === 'waiting-cli' ? (item.reason === undefined ? undefined : (FAIL_REASON_ALIASES[item.reason] ?? item.reason)) : item.reason;
      const leftover = m !== null && m.phase === 'waiting-cli' && m.leftoverShown !== null ? { text: m.leftoverShown, canDiscard: item.canDiscard } : null;
      return {
        id: item.id,
        text: m?.text ?? item.text,
        images: m?.images ?? item.request.imagePaths ?? [],
        kind: m?.kind ?? (item.text.startsWith('!') ? 'shell' : item.text.startsWith('/') ? 'slash' : 'prompt'),
        mode: m?.mode ?? item.mode,
        state,
        label: state === 'pending' ? 'na fila' : item.label,
        ...(reason !== undefined ? { reason } : {}),
        ...(waiting ? { queuedReason: state === 'pending' ? (activeCause ?? CAUSE_PREVIOUS) : queuedCause(item, activeCause) } : {}),
        leftover,
        createdAt: item.createdAt,
        ...(item.returned ? { returned: true } : {}),
      };
    });
    for (const l of [...this.listeners]) l();
  }
}

function stripUndefined(env: SendEnv): SendEnv {
  const out: { alive?: boolean; pendingOpen?: boolean; terminalNeeded?: boolean; working?: boolean } = {};
  if (env.alive !== undefined) out.alive = env.alive;
  if (env.pendingOpen !== undefined) out.pendingOpen = env.pendingOpen;
  if (env.terminalNeeded !== undefined) out.terminalNeeded = env.terminalNeeded;
  if (env.working !== undefined) out.working = env.working;
  return out;
}
