// O livro (plano `docs/planos/ledger-bom.md`, F2) — a projeção: o estado (o `LedgerDoc` v4 de hoje) é só derivado
// dos lançamentos, nunca gravado à mão. Cada lançamento de operação passa pelo `applyLedgerOp`, a mesma regra que
// o main e o Oráculo usam hoje; o que ela recusa fica no diário, marcado como recusado, e não muda o estado.

import { applyLedgerOp, emptyLedgerDoc, type LedgerDoc, type LedgerOp } from '../ledger/contract';
import { emptyFila, isFilaTipo, passoFila, type EstadoFila, type FilaTipo } from './fila';
import type { JournalLine, LivroEntry } from './formato';

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
  /** F9: priority, parents and board limits (`fila.ts`). */
  readonly fila: EstadoFila;
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

/** F9: priority and parent name tasks the ledger has; the board limit names a board, not a task. */
function filaStep(doc: LedgerDoc, fila: EstadoFila, entry: LivroEntry): ReturnType<typeof passoFila> {
  const tipo = entry.tipo as FilaTipo;
  if (tipo !== 'limite-do-quadro' && !doc.tasks[entry.tarefa]) return { ok: false, reason: `a tarefa ${entry.tarefa} não existe no livro` };
  const pai = (entry.dados as { pai?: unknown }).pai;
  if (tipo === 'agrupada' && typeof pai === 'string' && !doc.tasks[pai]) return { ok: false, reason: `o pai ${pai} não existe no livro` };
  return passoFila(fila, { seq: entry.seq, tipo, tarefa: entry.tarefa, dados: entry.dados });
}

/** Calcula o estado a partir dos lançamentos, em ordem de `seq`. */
export function projectJournal(lines: readonly JournalLine[]): Projection {
  let doc = emptyLedgerDoc();
  let fila = emptyFila();
  const steps: ProjectionStep[] = [];
  const seen = new Set<string>();
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
    if (isFilaTipo(line.tipo)) {
      const step = filaStep(doc, fila, line);
      if (step.ok) fila = step.state;
      steps.push(step.ok ? { seq: line.seq, status: 'aplicado' } : { seq: line.seq, status: 'recusado', reason: step.reason });
      continue;
    }
    const result: StepResult = line.tipo === 'v4-evento' ? { ok: false, reason: 'evento importado do v4 ainda não se projeta (F3).' } : applyOp(doc, line);
    if (result.ok) {
      doc = result.doc;
      steps.push({ seq: line.seq, status: 'aplicado' });
    } else steps.push({ seq: line.seq, status: 'recusado', reason: result.reason });
  }
  return { doc, fila, steps, readOnly: lines.some((line) => line.kind === 'newer') };
}
