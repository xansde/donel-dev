// Diagnostics of a send that ended in `failed`: what `chat-diagnostics.log` records about it. PURE.
//
// The renderer builds the detail from the machine state (`describeSendFailure`) and the main sanitizes it again
// (`sanitizeSendFailure`) before writing, because the log's rule (top of `src/main/chat/diagnostics-log.ts`) is
// "never conversation content": no message text, no screen text. Reasons are the machine's own fixed pt-BR
// strings, checked against `KNOWN_SEND_REASONS`; anything else becomes `'outro'`.

import { hasFooter, isWorking, readInputText } from './screen';
import type { SendMachineState, SendStep } from './sendMachine';
import type { SendKind, SendMode } from './rows';

/** Every reason `sendMachine.ts` writes, as failure or as gate wait (`tests/chat-send-diagnostics.test.ts` checks it). */
export const KNOWN_SEND_REASONS: readonly string[] = [
  // failures
  'mensagem vazia',
  'a imagem não entrou',
  'comando desconhecido',
  'não foi',
  'o Claude foi encerrado',
  'o Claude não ficou pronto',
  'o texto da caixa mudou',
  'o texto não entrou na caixa',
  // gate waits
  'esperando a caixa de entrada',
  'esperando o Claude ficar pronto',
  'esperando o Claude terminar a rodada',
  'esperando o Claude terminar o que está fazendo',
  'há uma pergunta ou permissão esperando você',
  'lendo a tela do Claude',
  'o terminal precisa de você',
  'sobrou texto na caixa do terminal',
];

const REASONS: ReadonlySet<string> = new Set(KNOWN_SEND_REASONS);
const STEPS: ReadonlySet<string> = new Set<SendStep>(['gate', 'image', 'text', 'menu-esc', 'enter-gap', 'await-ack', 'lookup', 'done']);
const KINDS: ReadonlySet<string> = new Set<SendKind>(['prompt', 'slash', 'shell']);
const MODES: ReadonlySet<string> = new Set<SendMode>(['normal', 'interrupt-first']);

export interface SendFailureDetail {
  /** Failure reason (machine string, or `'outro'`). */
  readonly reason: string;
  /** Step the send was in when it failed. */
  readonly step: SendStep | null;
  /** Last gate wait of this attempt (`lendo a tela do Claude`, `esperando a caixa de entrada`...). */
  readonly lastWait: string | null;
  readonly sendKind: SendKind | null;
  readonly mode: SendMode | null;
  readonly attempts: number;
  /** How many images the message carried (the count, never the paths). */
  readonly images: number;
  readonly firstPaste: boolean;
  /** At least one read of the hidden terminal reached the machine. */
  readonly screenRead: boolean;
  /** Last screen: input box found (`null` = no screen read). */
  readonly boxFound: boolean | null;
  /** Last screen: footer under the box (`null` = no screen read). */
  readonly footer: boolean | null;
  /** Last screen: footer says "esc to interrupt" (`null` = no screen read). */
  readonly screenWorking: boolean | null;
  /** Mid-turn according to the hooks. */
  readonly working: boolean;
  readonly alive: boolean;
  readonly pendingOpen: boolean;
  readonly terminalNeeded: boolean;
  /** From the creation of the send to the failure. */
  readonly elapsedMs: number;
}

/** The detail of a failed send, from its machine state. Reads the last screen only through boolean detectors. */
export function describeSendFailure(state: SendMachineState, now: number): SendFailureDetail {
  const lines = state.lines;
  return {
    reason: state.failReason ?? 'outro',
    step: state.failedStep,
    lastWait: state.lastWaitReason,
    sendKind: state.kind,
    mode: state.mode,
    attempts: state.attempts,
    images: state.images.length,
    firstPaste: state.firstPaste,
    screenRead: lines !== null,
    boxFound: lines === null ? null : readInputText(lines) !== null,
    footer: lines === null ? null : hasFooter(lines),
    screenWorking: lines === null ? null : isWorking(lines),
    working: state.working,
    alive: state.alive,
    pendingOpen: state.pendingOpen,
    terminalNeeded: state.terminalNeeded,
    elapsedMs: Math.max(0, now - state.createdAt),
  };
}

const reasonOrOther = (v: unknown): string => (typeof v === 'string' && REASONS.has(v) ? v : 'outro');
const oneOf = <T extends string>(set: ReadonlySet<string>, v: unknown): T | null => (typeof v === 'string' && set.has(v) ? (v as T) : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const flag = (v: unknown): boolean => v === true;
const flagOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Whitelist, field by field, of a detail that crossed the IPC. `null` = not an object. */
export function sanitizeSendFailure(input: unknown): SendFailureDetail | null {
  if (input === null || typeof input !== 'object') return null;
  const d = input as Record<string, unknown>;
  return {
    reason: reasonOrOther(d.reason),
    step: oneOf<SendStep>(STEPS, d.step),
    lastWait: d.lastWait === null || d.lastWait === undefined ? null : reasonOrOther(d.lastWait),
    sendKind: oneOf<SendKind>(KINDS, d.sendKind),
    mode: oneOf<SendMode>(MODES, d.mode),
    attempts: count(d.attempts),
    images: count(d.images),
    firstPaste: flag(d.firstPaste),
    screenRead: flag(d.screenRead),
    boxFound: flagOrNull(d.boxFound),
    footer: flagOrNull(d.footer),
    screenWorking: flagOrNull(d.screenWorking),
    working: flag(d.working),
    alive: flag(d.alive),
    pendingOpen: flag(d.pendingOpen),
    terminalNeeded: flag(d.terminalNeeded),
    elapsedMs: count(d.elapsedMs),
  };
}
