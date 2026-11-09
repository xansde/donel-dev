// O livro (plano `docs/planos/ledger-bom.md`, F2) — a projeção: o estado (o `LedgerDoc` v4 de hoje) é só derivado
// dos lançamentos, nunca gravado à mão. Cada lançamento de operação passa pelo `applyLedgerOp`, a mesma regra que
// o main e o Oráculo usam hoje; o que ela recusa fica no diário, marcado como recusado, e não muda o estado.

import { applyLedgerOp, emptyLedgerDoc, parseLedgerDoc, type LedgerDoc, type LedgerEvent, type LedgerOp, type LedgerTask } from '../ledger/contract';
import { canonicalJson, type JournalLine, type LivroEntry } from './formato';
import type { V4EventData } from './importar-v4';

/**
 * `aplicado` mudou o estado; `recusado` ficou no diário sem mudar nada (o motivo é o da regra);
 * `repetido` é a mesma chave e o mesmo conteúdo de um lançamento anterior (não conta duas vezes);
 * `so-leitura` é de uma versão mais nova, que este app não sabe aplicar.
 */
export type StepStatus = 'aplicado' | 'recusado' | 'repetido' | 'so-leitura';

export interface ProjectionStep {
  readonly seq: number;
  readonly status: StepStatus;
  readonly reason?: string;
}

export interface Projection {
  readonly doc: LedgerDoc;
  readonly steps: ProjectionStep[];
  /** Algum lançamento é de versão maior: a projeção é a melhor leitura possível, não a verdade inteira. */
  readonly readOnly: boolean;
}

/** As operações que fazem nascer uma tarefa: o id dela é a `tarefa` do lançamento. */
const CREATES: ReadonlySet<string> = new Set(['criar', 'carta-slack', 'slack-bot']);

type StepResult = { readonly ok: true; readonly doc: LedgerDoc } | { readonly ok: false; readonly reason: string };

/** Um lançamento de operação, pela regra de hoje. Nunca lança: dado quebrado vira recusa. */
function applyOp(doc: LedgerDoc, entry: LivroEntry): StepResult {
  const creates = CREATES.has(entry.tipo);
  if (creates && doc.tasks[entry.tarefa]) return { ok: false, reason: `a tarefa ${entry.tarefa} já existe; uma criação não a sobrescreve.` };
  if ('op' in entry.dados || (!creates && 'id' in entry.dados)) return { ok: false, reason: 'os "dados" não levam "op" nem "id": vêm de "tipo" e "tarefa".' };
  const op = (creates ? { ...entry.dados, op: entry.tipo } : { ...entry.dados, op: entry.tipo, id: entry.tarefa }) as unknown as LedgerOp;
  try {
    const result = applyLedgerOp(doc, entry.quem, op, { now: entry.em, newId: () => entry.tarefa });
    return result.ok ? { ok: true, doc: result.doc } : { ok: false, reason: result.reason };
  } catch (error) {
    return { ok: false, reason: `dados inválidos para "${entry.tipo}": ${(error as Error).message}` };
  }
}

/**
 * Um evento importado do ledger v4 (F3): fato histórico, aplicado como está — o estado, o dono e o risco vêm no
 * lançamento. A tarefa que sai tem de passar inteira pelo parse do v4, senão o lançamento é recusado.
 */
function applyImported(doc: LedgerDoc, entry: LivroEntry): StepResult {
  const data = entry.dados as unknown as V4EventData;
  const current = doc.tasks[entry.tarefa];
  if (data.nova && current) return { ok: false, reason: `a tarefa ${entry.tarefa} já existe; o cabeçalho importado não a sobrescreve.` };
  if (!data.nova && !current) return { ok: false, reason: `a tarefa ${entry.tarefa} não existe; o evento importado precisa do cabeçalho antes.` };
  const base: LedgerTask = current ?? ({ ...data.nova, id: entry.tarefa, state: 'aberta', events: [] } as unknown as LedgerTask);
  const events: LedgerEvent[] = data.evento ? [...base.events, data.evento] : [...base.events];
  const task = {
    ...base,
    ...(data.dono !== undefined ? { ownerPlaceId: data.dono } : {}),
    ...(data.risco !== undefined ? { risk: data.risco } : {}),
    state: data.estado,
    events,
  } as LedgerTask;
  let parsed: LedgerTask | undefined;
  try {
    parsed = parseLedgerDoc({ tasks: { [task.id]: task } }).tasks[task.id];
  } catch {
    parsed = undefined;
  }
  if (!parsed || canonicalJson(parsed) !== canonicalJson(task)) return { ok: false, reason: 'o evento importado não forma uma tarefa v4 válida.' };
  return { ok: true, doc: { ...doc, startedAt: doc.startedAt ?? parsed.createdAt, tasks: { ...doc.tasks, [parsed.id]: parsed } } };
}

/** Calcula o estado a partir dos lançamentos, em ordem de `seq`. */
export function projectJournal(lines: readonly JournalLine[]): Projection {
  let doc = emptyLedgerDoc();
  const steps: ProjectionStep[] = [];
  const seen = new Set<string>();
  // The import is the start of the journal: after the first operation, an imported event would skip today's rules.
  let opened = false;
  for (const line of lines) {
    if (line.kind === 'newer') {
      steps.push({ seq: line.seq, status: 'so-leitura', reason: `lançamento da versão ${line.versao}` });
      continue;
    }
    if (seen.has(line.chave)) {
      steps.push({ seq: line.seq, status: 'repetido' });
      continue;
    }
    seen.add(line.chave);
    const imported = line.tipo === 'v4-evento';
    const result: StepResult = !imported
      ? applyOp(doc, line)
      : opened
        ? { ok: false, reason: 'evento importado do v4 só vale no começo do diário, antes da primeira operação.' }
        : applyImported(doc, line);
    if (!imported) opened = true;
    if (result.ok) {
      doc = result.doc;
      steps.push({ seq: line.seq, status: 'aplicado' });
    } else steps.push({ seq: line.seq, status: 'recusado', reason: result.reason });
  }
  return { doc, steps, readOnly: lines.some((line) => line.kind === 'newer') };
}
