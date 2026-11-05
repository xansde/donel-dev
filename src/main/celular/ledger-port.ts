// Ledger no celular — o que o servidor do celular precisa do ledger, e o adaptador sobre o ledger V1
// (`src/shared/ledger/contract.ts`, `src/main/ledger-store.ts`). Decidir passa pelo MESMO
// `LedgerService.apply` da faixa do Mindscape, com autor `{ kind: 'dono' }`: o aceite pelo celular conta
// como validação humana, e as regras (quem entregou não decide, risco, amostra do Revisor) são as do contrato.

import { basename } from 'node:path';
import type { CartaCelular, DecisaoCelular, EntregaCelular, ProvaCelular, VisualCelular } from '../../shared/celular';
import {
  decisionOfRequest,
  lastDecision,
  lastDelivery,
  ownerQueue,
  waitsForOwner,
  type LedgerForOwner,
  type LedgerProof,
  type LedgerTask,
  type LedgerVisual,
} from '../../shared/ledger/contract';
import { actorLabel, naipeDoPapel, type PlaceNameOf } from '../../shared/ledger/labels';
import type { LedgerService } from '../ledger-store';
import { maskSecrets, summarize } from './mask';

export interface DecisaoInput {
  /** Id do pedido do celular: gravado com a decisão no ledger, então um reenvio (mesmo depois de reiniciar) não grava de novo. */
  readonly pedidoId: string;
  readonly itemId: string;
  readonly decisao: DecisaoCelular;
  /** Obrigatório ao rejeitar sem opção. */
  readonly motivo: string | null;
  /** Forma A: o rótulo da opção escolhida (ela já diz como a tarefa fecha). */
  readonly opcao?: string;
}

export type DecisaoOutcome =
  | { readonly ok: true; readonly estado: 'aceita' | 'rejeitada' }
  /** `nao-encontrada`: a entrega não existe; `recusada`: o ledger recusou (já decidida, só leitura…), com o motivo dele. */
  | { readonly ok: false; readonly reason: 'nao-encontrada' | 'recusada'; readonly message: string };

/** A prova como arquivo copiado pelo ledger (`filePath` dentro de `ledger-provas/`) ou bytes em memória. */
export type ProvaFonte =
  | { readonly mediaType: string; readonly filePath: string }
  | { readonly mediaType: string; readonly bytes: Uint8Array };

export type { PlaceNameOf };

export interface MobileLedgerPort {
  /** O que espera o dono: entregas de risco alto + a amostra do dia dos aceites do Revisor (D2). */
  pendentes(): EntregaCelular[];
  /** Grava a decisão do dono no ledger. Recusa (sem gravar) o que não está mais esperando o dono. */
  decidir(input: DecisaoInput): DecisaoOutcome;
  /** Print ou vídeo (o arquivo) ou a saída de comando inteira, mascarada (bytes de texto). */
  prova(itemId: string, provaId: string): ProvaFonte | null;
}

function visualCelular(visual: LedgerVisual | undefined): VisualCelular | undefined {
  if (!visual) return undefined;
  switch (visual.kind) {
    case 'prova':
      return { tipo: 'prova', prova: String(visual.proof) };
    case 'antes-depois':
      return { tipo: 'antes-depois', antes: String(visual.before), depois: String(visual.after) };
    case 'checagens':
      return { tipo: 'checagens', itens: visual.checks.map((check) => ({ nome: check.name, ok: check.ok, frase: check.sentence })) };
  }
}

function cartaCelular(forOwner: LedgerForOwner): CartaCelular {
  const visual = visualCelular(forOwner.visual);
  return {
    pergunta: forOwner.question,
    resumo: forOwner.summary,
    opcoes: forOwner.options.map((option) => ({
      rotulo: option.label,
      efeito: option.effect,
      ...(option.risk ? { risco: option.risk } : {}),
      fecha: option.closes,
      ...(option.recommended ? { recomendada: true as const } : {}),
    })),
    porque: forOwner.why,
    risco: forOwner.risk,
    ...(visual ? { visual } : {}),
  };
}

function provaCelular(proof: LedgerProof, index: number): ProvaCelular {
  const id = String(index);
  switch (proof.kind) {
    case 'arquivo':
      return proof.mediaType.startsWith('video/') ? { id, tipo: 'video', rotulo: 'Vídeo' } : { id, tipo: 'imagem', rotulo: 'Print' };
    case 'texto': {
      // A fila leva só o começo, mascarado; o texto inteiro (também mascarado) vem por /api/prova ao abrir.
      const { texto, cortado } = summarize(proof.text);
      return { id, tipo: 'comando', rotulo: 'Saída', texto, ...(cortado ? { cortado: true } : {}) };
    }
    case 'link':
      return { id, tipo: 'link', rotulo: 'Link', url: proof.url };
  }
}

function entregaCelular(task: LedgerTask, placeName: PlaceNameOf | undefined): EntregaCelular {
  const delivery = lastDelivery(task);
  const decision = lastDecision(task);
  const sample = task.state === 'aceita';
  const deliveredBy = delivery?.by;
  const quadro = basename(task.projectPath) || task.projectPath;
  const prazo = task.due.split('-').reverse().join('/');
  // Na amostra do Revisor a tarefa já foi aceita: a carta é a antiga (Confirmo / Rejeitar), sem opções.
  const forOwner = sample ? undefined : delivery?.forOwner;
  return {
    id: task.id,
    origem: sample ? 'amostra-revisor' : 'esperando-voce',
    naipe: naipeDoPapel(deliveredBy?.kind === 'lugar' ? deliveredBy.roleId : undefined),
    titulo: delivery?.forOwner?.title ?? task.title ?? `${quadro} · prazo ${prazo}`,
    pedido: task.request,
    criterio: task.doneWhen,
    quemEntregou: actorLabel(deliveredBy, task.projectPath, placeName),
    entregueEm: new Date(delivery?.at ?? task.createdAt).toISOString(),
    ...(delivery?.text ? { nota: delivery.text } : {}),
    ...(sample && decision ? { aceitoPor: actorLabel(decision.by, task.projectPath, placeName) } : {}),
    risco: task.risk,
    provas: (delivery?.proofs ?? []).map(provaCelular),
    quadro,
    prazo,
    ids: [`tarefa ${task.id}`, ...(deliveredBy?.kind === 'lugar' ? [`lugar ${deliveredBy.placeId}`] : [])],
    ...(forOwner ? { carta: cartaCelular(forOwner) } : {}),
  };
}

/** O adaptador sobre o ledger V1. `getService` é `null` enquanto o ledger não abriu. */
export function createLedgerMobilePort(getService: () => LedgerService | null, placeName?: PlaceNameOf): MobileLedgerPort {
  const doc = () => {
    try {
      return getService()?.load().doc ?? null;
    } catch {
      return null; // arquivo ilegível: o celular mostra a fila vazia, nunca uma fila inventada
    }
  };
  return {
    pendentes() {
      const current = doc();
      return current ? ownerQueue(current, null).map((task) => entregaCelular(task, placeName)) : [];
    },
    decidir(input) {
      const service = getService();
      if (!service) return { ok: false, reason: 'recusada', message: 'O Oráculo Harrow não abriu neste app.' };
      let current;
      try {
        current = service.load().doc;
      } catch (error) {
        return { ok: false, reason: 'recusada', message: `Não consegui ler o Oráculo Harrow (${error instanceof Error ? error.message : String(error)}).` };
      }
      const task = current.tasks[input.itemId];
      if (!task) return { ok: false, reason: 'nao-encontrada', message: 'Esta entrega não existe mais.' };
      // Reenvio de um pedido que já entrou (a rede caiu, o app reiniciou): a mesma resposta, sem gravar de novo.
      const previous = decisionOfRequest(task, input.pedidoId);
      if (previous) return { ok: true, estado: previous.kind === 'rejeitada' ? 'rejeitada' : 'aceita' };
      // Pelo celular só se decide o que está na fila do dono (o mesmo que a faixa do Mindscape mostra).
      if (!waitsForOwner(current, task)) return { ok: false, reason: 'recusada', message: 'Esta entrega já não espera você.' };
      const option = input.opcao ? { option: input.opcao } : {};
      const result =
        input.decisao === 'aceitar'
          ? service.apply({ kind: 'dono' }, { op: 'aceitar', id: task.id, requestId: input.pedidoId, ...option })
          : service.apply({ kind: 'dono' }, { op: 'rejeitar', id: task.id, reason: input.motivo ?? '', requestId: input.pedidoId, ...option });
      if (!result.ok) return { ok: false, reason: 'recusada', message: result.reason };
      return { ok: true, estado: result.task.state === 'rejeitada' ? 'rejeitada' : 'aceita' };
    },
    prova(itemId, provaId) {
      const service = getService();
      const current = doc();
      const task = current?.tasks[itemId];
      if (!service || !task || !/^\d{1,2}$/.test(provaId)) return null;
      const proof = lastDelivery(task)?.proofs?.[Number(provaId)];
      if (proof?.kind === 'texto') return { mediaType: 'text/plain; charset=utf-8', bytes: Buffer.from(maskSecrets(proof.text), 'utf8') };
      if (!proof || proof.kind !== 'arquivo') return null;
      const filePath = service.proofPath(proof);
      return filePath ? { mediaType: proof.mediaType, filePath } : null;
    },
  };
}
