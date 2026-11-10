// Andamento no ledger (dono, 08/11: "Eles devem atualizar diretamente o ledger, né. Em vez de te notificar a cada
// instante") — what a session records about its work, instead of a "◆ … terminou" in the Líder's chat.
//
// v4 stays frozen (docs/planos/ledger-v5.md: no schema bump outside D1), so a record rides on a kind v4 already keeps,
// with a mark at the start of the text, like the transfers and the cancels (contract.ts, "Marks"):
//   a `comentada` event by the owner PLACE of the task, text "⟦andamento⟧ estado: …\nprecisa: …\nprova: …\npróximo: …"
// The owner's own `comentada` never starts with a mark (`commentRefusal` + `startsWithMark`), so a record is never
// confused with what the owner wrote on the card, and nobody forges one through the card.
//
// Pure and with no runtime import from contract.ts (contract.ts imports this file).

import type { LedgerEvent } from './contract';

export const PROGRESS_TAG = 'andamento';
const PROGRESS_MARK = `⟦${PROGRESS_TAG}⟧`;

/** What the session says it is. `turno-encerrado` is only the app's own record at the end of a turn. */
export type ProgressState = 'trabalhando' | 'esperando' | 'travada' | 'precisa-do-dono' | 'pronta' | 'turno-encerrado';
/** The states a session may write with `tarefa_andamento`. */
export const PROGRESS_STATES = ['trabalhando', 'esperando', 'travada', 'precisa-do-dono', 'pronta'] as const satisfies readonly ProgressState[];
const ALL_STATES: readonly ProgressState[] = [...PROGRESS_STATES, 'turno-encerrado'];

/** Each field is short: one line, this many characters at most (the summary of a turn a bit more). */
export const PROGRESS_FIELD_CHARS = 200;
export const PROGRESS_SUMMARY_CHARS = 280;

export interface LedgerProgress {
  readonly estado: ProgressState;
  /** What it needs to go on (from whom), if anything. */
  readonly precisa?: string;
  /** Where the evidence is (a test output, a PR, a print path). */
  readonly prova?: string;
  /** The next step. */
  readonly proximo?: string;
  /** The app's record at the end of a turn: the start of what the session said. */
  readonly resumo?: string;
}

const FIELDS = [
  ['precisa', 'precisa'],
  ['prova', 'prova'],
  ['proximo', 'próximo'],
  ['resumo', 'resumo'],
] as const;

/** One line, no mark characters, cut at `max` (with "…" only when cut). */
export function progressLine(value: string, max: number): string {
  const line = value.replace(/[⟦⟧]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Why the record cannot be written; `null` = it can. */
export function progressRefusal(progress: LedgerProgress): string | null {
  if (!ALL_STATES.includes(progress.estado)) return `"estado" tem de ser ${PROGRESS_STATES.join(', ')}.`;
  for (const [key] of FIELDS) {
    const value = progress[key];
    const max = key === 'resumo' ? PROGRESS_SUMMARY_CHARS : PROGRESS_FIELD_CHARS;
    if (value !== undefined && Array.from(value).length > max) return `"${key}" longo demais (máximo ${max} caracteres, uma linha).`;
  }
  return null;
}

/** The text of the `comentada` event. */
export function progressText(progress: LedgerProgress): string {
  const lines = [`${PROGRESS_MARK} estado: ${progress.estado}`];
  for (const [key, label] of FIELDS) {
    const value = progress[key];
    if (value?.trim()) lines.push(`${label}: ${progressLine(value, key === 'resumo' ? PROGRESS_SUMMARY_CHARS : PROGRESS_FIELD_CHARS)}`);
  }
  return lines.join('\n');
}

export function isProgressText(text: string | undefined): boolean {
  return (text ?? '').startsWith(PROGRESS_MARK);
}

/** The event is a progress record (never the owner's words on the card). */
export function isProgressEvent(event: LedgerEvent): boolean {
  return event.kind === 'comentada' && event.by.kind === 'lugar' && isProgressText(event.text);
}

/** The record read back from the event; `null` = not a progress record. */
export function progressOf(event: LedgerEvent): LedgerProgress | null {
  if (!isProgressEvent(event)) return null;
  const [head, ...rest] = event.text!.slice(PROGRESS_MARK.length).split('\n');
  const estado = /^\s*estado: (.+)$/.exec(head ?? '')?.[1]?.trim() as ProgressState | undefined;
  if (!estado || !ALL_STATES.includes(estado)) return null;
  const fields: Record<string, string> = {};
  for (const line of rest) {
    const field = FIELDS.find(([, label]) => line.startsWith(`${label}: `));
    if (field) fields[field[0]] = line.slice(field[1].length + 2);
  }
  return { estado, ...fields };
}

/** A record that cannot wait for the Líder's next read: it goes to it at once (dono, 08/11). */
export function isUrgentProgress(progress: LedgerProgress): boolean {
  return progress.estado === 'travada' || progress.estado === 'precisa-do-dono';
}

/** The app's record at the end of a turn: the first lines of the turn, as one short line. */
export function turnEndProgress(turnText: string): LedgerProgress {
  const resumo = progressLine(turnText, PROGRESS_SUMMARY_CHARS);
  return { estado: 'turno-encerrado', ...(resumo ? { resumo } : {}) };
}
