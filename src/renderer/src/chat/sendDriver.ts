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

import type { PromptSignalKind } from '../../../shared/chat/ipc';
import { commandResolvesTo, matchOldestPending, matchesPrompt, normalizePrompt, oldestPending } from '../../../shared/chat/promptMatch';
import type { SendKind, SendMode, SendState } from '../../../shared/chat/rows';
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
}

export interface SendRequest {
  readonly text: string;
  /** Absolute paths, one paste each. */
  readonly imagePaths?: readonly string[];
  readonly mode?: SendMode;
  readonly opensScreen?: boolean;
  readonly customCommands?: ReadonlySet<string>;
}

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

  constructor(private readonly ports: SendDriverPorts) {}

  // ------------------------------------------------------------------ public

  enqueue(request: SendRequest): string {
    const id = `send-${++this.seq}-${this.ports.now().toString(36)}`;
    this.items.push({
      id,
      request,
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
    this.pump();
    this.publish();
    return id;
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
    if (item === undefined) return;
    this.feedScreen(item);
    this.pump();
    this.publish();
  }

  handleSignal(sig: DriverSignal): void {
    if (this.dedupeSignal(sig)) return;
    const at = Date.parse(sig.at);
    const now = this.ports.now();
    const awaiting = this.items.filter((i) => i.machine !== null && (i.machine.step === 'await-ack' || i.machine.phase === 'queued'));
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
    const item = this.items.find((i) => i.id === id);
    if (item === undefined) return;
    this.ports.clearTimeout(item.timer);
    item.dismissed = true;
    this.items = this.items.filter((i) => i !== item);
    this.pump();
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
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

  /** Starts the next message when none is active. */
  private pump(): void {
    if (this.disposed) return;
    for (;;) {
      if (this.items.some(isActive)) return;
      const next = this.items.find((i) => i.machine === null);
      if (next === undefined) return;
      const input: SendInput = {
        id: next.id,
        text: next.request.text,
        imagePaths: next.request.imagePaths,
        mode: next.mode,
        firstPaste: this.sentCount === 0,
        opensScreen: next.request.opensScreen,
        customCommands: next.request.customCommands,
      };
      this.sentCount += 1;
      const created = createSend(input, this.ports.now());
      next.machine = created.state;
      this.runEffects(next, created.effects);
      this.dispatch(next, { type: 'env', now: this.ports.now(), ...this.env });
      if (isActive(next)) this.feedScreen(next);
    }
  }

  private dispatch(item: Item, event: SendEvent): void {
    if (item.machine === null || this.disposed || item.dismissed) return;
    const result = step(item.machine, event);
    item.machine = result.state;
    this.runEffects(item, result.effects);
  }

  private runEffects(item: Item, effects: readonly SendEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'write':
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

  private onAck(item: Item, found: boolean): void {
    if (this.disposed || item.dismissed) return;
    this.dispatch(item, { type: 'ack-result', now: this.ports.now(), found });
    if (isActive(item)) this.feedScreen(item);
    this.pump();
    this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
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
        text: m?.text ?? item.request.text,
        images: m?.images ?? item.request.imagePaths ?? [],
        kind: m?.kind ?? (item.request.text.startsWith('!') ? 'shell' : item.request.text.startsWith('/') ? 'slash' : 'prompt'),
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
