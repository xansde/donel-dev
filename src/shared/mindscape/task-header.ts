// t-057bf559 (Líder único, 13/11) — every message between sessions opens with "[t-xxxx] título: objetivo em uma frase".
// The usage collector cuts each request at 300 characters before counting tasks; our requests put the context first and
// the task id last, so most arrived cut. The app writes the line from the ledger when the caller names the task
// (`tarefa` on sessao_enviar / sessao_abrir). Without a task it invents nothing: the text goes as it came, and the
// role's rule tells the sender to write the line. Pure: the main gives the ledger it already has in memory. Never
// through `tarefa_ver`: that marks the proof as read (the accept gate) and answers a print as an image (Revisor, #420).

import type { LedgerDoc } from '../ledger/contract';
import type { BoardToolCall } from './agent-tools';

/** The line fits in the 300 the collector reads, with room for the "◆ De …, quadro …, motivo:" prefix (60 to 100). */
export const TASK_HEADER_MAX_CHARS = 180;

/** What the line is made of, as `tarefa_ver` answers it. */
export interface TaskHeaderSource {
  readonly id: string;
  readonly titulo?: string;
  readonly criterio?: string;
  readonly pedido?: string;
}

/** The text already opens with a task line (spaces and line breaks before it included). */
export function hasTaskHeader(text: string): boolean {
  return /^\s*\[t-/.test(text);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The first sentence of the criterion (or of the request), on one line. */
function objectiveOf(source: TaskHeaderSource): string {
  const from = oneLine(source.criterio ?? '') || oneLine(source.pedido ?? '');
  const first = from.split(/(?<=[.!?;])\s/)[0] ?? '';
  return first.replace(/[.;]$/, '');
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** "[t-xxxx] título: objetivo", at most `TASK_HEADER_MAX_CHARS`. */
export function taskHeaderLine(source: TaskHeaderSource): string {
  const head = `[${source.id}] ${oneLine(source.titulo ?? '')}`.trimEnd();
  const objective = objectiveOf(source);
  if (!objective) return cap(head, TASK_HEADER_MAX_CHARS);
  return cap(`${head}: ${objective}`, TASK_HEADER_MAX_CHARS);
}

/** The line, a blank line and the text exactly as it came; a text that already opens with "[t-" stays as it is. */
export function withTaskHeader(text: string, source: TaskHeaderSource | null | undefined): string {
  if (!source || hasTaskHeader(text)) return text;
  return `${taskHeaderLine(source)}\n\n${text}`;
}

/** Title, criterion and request of the task `id`, straight from the ledger; null when it is not there. */
export function taskHeaderSourceOfDoc(doc: LedgerDoc, id: string): TaskHeaderSource | null {
  const task = doc.tasks[id];
  if (!task) return null;
  return { id: task.id, ...(task.title ? { titulo: task.title } : {}), ...(task.doneWhen ? { criterio: task.doneWhen } : {}), ...(task.request ? { pedido: task.request } : {}) };
}

/** `sessao_enviar` / `sessao_abrir` with `tarefa`: the text or request gains the line; any other call goes as it came. */
export function withTaskHeaderOnCall(call: BoardToolCall, doc: LedgerDoc | null): BoardToolCall {
  if ((call.tool !== 'sessao_enviar' && call.tool !== 'sessao_abrir') || !call.tarefa || !doc) return call;
  const source = taskHeaderSourceOfDoc(doc, call.tarefa);
  if (!source) return call;
  return call.tool === 'sessao_enviar' ? { ...call, texto: withTaskHeader(call.texto, source) } : { ...call, pedido: withTaskHeader(call.pedido, source) };
}
