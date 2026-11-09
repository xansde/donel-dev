// O livro (plano `docs/planos/ledger-bom.md`, F3) — importar o ledger v4 de hoje, só lendo.
//
// Cada evento de cada tarefa do `ledger.json` vira um lançamento `v4-evento`, na ordem de `at` (dentro de uma tarefa,
// a ordem dos eventos nunca muda), com a chave `v4:<tarefa>:<n>` (o n-ésimo evento): importar de novo o mesmo
// ledger dá o mesmo diário, e um ledger que cresceu só acrescenta. O primeiro lançamento de cada tarefa leva o
// cabeçalho dela (`nova`), com o dono e o risco do nascimento; cada lançamento leva o estado em que a tarefa ficou,
// e o dono e o risco quando uma transferência os mudou.
//
// O evento importado é fato histórico: entra como estava, sem ser julgado pelas regras de hoje (que não existiam
// quando ele aconteceu). Por isso só vale no começo do diário (`projecao.ts`). A conferência é a projeção bater com
// o ledger lido, tarefa a tarefa (`compareLedgers`). Nada aqui grava: quem chama decide onde (uma pasta temporária).

import { canonicalJson, appendEntry, type EntryInput, type JournalLine } from './formato';
import { isAgentBotRecord, transfersOf, type LedgerDoc, type LedgerEvent, type LedgerRisk, type LedgerTask, type LedgerTaskState } from '../ledger/contract';

/** O cabeçalho de uma tarefa no seu primeiro lançamento importado: dono e risco do nascimento. */
export type V4Header = Omit<LedgerTask, 'id' | 'state' | 'events'>;

export interface V4EventData {
  readonly nova?: V4Header;
  readonly evento?: LedgerEvent;
  /** O estado da tarefa depois do evento. */
  readonly estado: LedgerTaskState;
  /** Depois de uma transferência: o novo dono, e o novo risco se mudou. */
  readonly dono?: string;
  readonly risco?: LedgerRisk;
}

const RISK_CHANGE = /\(risco passou a (baixo|alto)\)$/;

function otherRisk(risk: LedgerRisk): LedgerRisk {
  return risk === 'alto' ? 'baixo' : 'alto';
}

/** Os lançamentos de uma tarefa, em ordem. O estado de cada passo sai do tipo do evento, nunca do estado final. */
function taskInputs(task: LedgerTask): EntryInput[] {
  // Back from the final owner and risk through the transfers: who owned it, and at what risk, at birth.
  let owner = task.ownerPlaceId;
  let risk = task.risk;
  for (const transfer of transfersOf(task).reverse()) {
    owner = transfer.from;
    const changed = RISK_CHANGE.exec(transfer.reason)?.[1] as LedgerRisk | undefined;
    if (changed) risk = otherRisk(changed);
  }
  const { id: _id, state: _state, events: _events, ...rest } = task;
  const header: V4Header = { ...rest, ownerPlaceId: owner, risk };
  const bot = isAgentBotRecord(task);
  let state: LedgerTaskState = 'aberta';
  const inputs: EntryInput[] = [];
  const push = (index: number, data: V4EventData, at: number, by: LedgerEvent['by']): void => {
    inputs.push({ id: `v4-${task.id}-${index}`, em: at, quem: by, tipo: 'v4-evento', tarefa: task.id, dados: data as unknown as Record<string, unknown>, chave: `v4:${task.id}:${index}` });
  };
  if (task.events.length === 0) {
    push(0, { nova: header, estado: state }, task.createdAt, { kind: 'lugar', placeId: owner });
    return inputs;
  }
  task.events.forEach((event, index) => {
    let change: Pick<V4EventData, 'dono' | 'risco'> = {};
    switch (event.kind) {
      case 'criada': {
        const transfer = index > 0 ? transfersOf({ ...task, events: [event] })[0] : undefined;
        if (transfer) {
          if (state === 'em-execucao') state = 'aberta';
          const changed = RISK_CHANGE.exec(transfer.reason)?.[1] as LedgerRisk | undefined;
          change = { dono: transfer.to, ...(changed ? { risco: changed } : {}) };
        }
        break;
      }
      case 'assumida':
        state = 'em-execucao';
        break;
      case 'entregue':
        // A bot record is born accepted, with no decision event.
        state = bot ? 'aceita' : 'entregue';
        break;
      case 'aceita':
      case 'conferida':
      case 'enviada':
        state = 'aceita';
        break;
      case 'rejeitada':
        state = 'rejeitada';
        break;
      case 'comentada':
        break;
    }
    push(index, { ...(index === 0 ? { nova: header } : {}), evento: event, estado: state, ...change }, event.at, event.by);
  });
  return inputs;
}

/** Os lançamentos do ledger inteiro, por `at`, sem nunca trocar a ordem dos eventos de uma tarefa. */
export function importV4(doc: LedgerDoc): EntryInput[] {
  const queues = Object.values(doc.tasks)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(taskInputs);
  const heads = queues.map(() => 0);
  const out: EntryInput[] = [];
  for (;;) {
    let best = -1;
    for (let q = 0; q < queues.length; q += 1) {
      const head = queues[q]![heads[q]!];
      if (head && (best < 0 || head.em < queues[best]![heads[best]!]!.em)) best = q;
    }
    if (best < 0) return out;
    out.push(queues[best]![heads[best]!]!);
    heads[best]! += 1;
  }
}

/** O diário da importação, pronto para ler, projetar ou gravar numa pasta temporária. */
export function importV4Journal(doc: LedgerDoc): JournalLine[] {
  return importV4(doc).reduce<JournalLine[]>((lines, input) => {
    const result = appendEntry(lines, input);
    if (!result.ok) throw new Error(`importação: ${input.chave}: ${result.reason}`);
    return result.lines;
  }, []);
}

export interface LedgerDifference {
  /** A tarefa, ou `startedAt` para o início do ledger. */
  readonly task: string;
  readonly what: 'falta' | 'sobra' | 'difere';
  /** O primeiro campo que difere. */
  readonly field?: string;
}

/** Compara dois ledgers tarefa a tarefa, em JSON canônico. Lista vazia = iguais. */
export function compareLedgers(original: LedgerDoc, projected: LedgerDoc): LedgerDifference[] {
  const out: LedgerDifference[] = [];
  if (original.startedAt !== projected.startedAt) out.push({ task: 'startedAt', what: 'difere' });
  const ids = [...new Set([...Object.keys(original.tasks), ...Object.keys(projected.tasks)])].sort();
  for (const id of ids) {
    const a = original.tasks[id];
    const b = projected.tasks[id];
    if (!b) out.push({ task: id, what: 'falta' });
    else if (!a) out.push({ task: id, what: 'sobra' });
    else if (canonicalJson(a) !== canonicalJson(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const field = keys.find((key) => canonicalJson((a as unknown as Record<string, unknown>)[key] ?? null) !== canonicalJson((b as unknown as Record<string, unknown>)[key] ?? null));
      out.push({ task: id, what: 'difere', ...(field ? { field } : {}) });
    }
  }
  return out;
}
