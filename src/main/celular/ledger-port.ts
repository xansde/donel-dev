// Ledger no celular — o que o servidor do celular precisa do ledger, e o adaptador sobre o ledger V1
// (`src/shared/ledger/contract.ts`, `src/main/ledger-store.ts`). Decidir passa pelo MESMO
// `LedgerService.apply` da faixa do Mindscape, com autor `{ kind: 'dono' }`: o aceite pelo celular conta
// como validação humana, e as regras (quem entregou não decide, risco, amostra do Revisor) são as do contrato.

import { basename } from 'node:path';
import type { DecisaoCelular, EntregaCelular, ProvaCelular } from '../../shared/celular';
import { naipeDoTipo } from '../../shared/celular';
import { lastDecision, lastDelivery, ownerQueue, waitsForOwner, type LedgerActor, type LedgerProof, type LedgerTask } from '../../shared/ledger/contract';
import type { LedgerService } from '../ledger-store';

export interface DecisaoInput {
  readonly itemId: string;
  readonly decisao: DecisaoCelular;
  /** Obrigatório ao rejeitar. */
  readonly motivo: string | null;
}

export type DecisaoOutcome =
  | { readonly ok: true; readonly estado: 'aceita' | 'rejeitada' }
  /** `nao-encontrada`: a entrega não existe; `recusada`: o ledger recusou (já decidida, só leitura…), com o motivo dele. */
  | { readonly ok: false; readonly reason: 'nao-encontrada' | 'recusada'; readonly message: string };

/** A prova como arquivo copiado pelo ledger (`filePath` dentro de `ledger-provas/`) ou bytes em memória. */
export type ProvaFonte =
  | { readonly mediaType: string; readonly filePath: string }
  | { readonly mediaType: string; readonly bytes: Uint8Array };

export interface MobileLedgerPort {
  /** O que espera o dono: entregas de risco alto + a amostra do dia dos aceites do Revisor (D2). */
  pendentes(): EntregaCelular[];
  /** Grava a decisão do dono no ledger. Recusa (sem gravar) o que não está mais esperando o dono. */
  decidir(input: DecisaoInput): DecisaoOutcome;
  prova(itemId: string, provaId: string): ProvaFonte | null;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  dev: 'Dev',
  revisor: 'Revisor',
  pesquisa: 'Pesquisa',
  lider: 'Líder',
};

function actorLabel(actor: LedgerActor | undefined): string {
  if (!actor) return 'alguém';
  if (actor.kind === 'dono') return 'você';
  const role = actor.roleId ?? '';
  return ROLE_LABELS[role] ?? ROLE_LABELS[role.split('-')[0] ?? ''] ?? (role || 'um lugar');
}

/** O contrato ainda não tem tipo de trabalho: o naipe sai do papel de quem entregou (decidido pelo Dev). */
function naipeDoPapel(roleId: string | undefined): EntregaCelular['naipe'] {
  const role = (roleId ?? '').split('-')[0];
  if (role === 'pesquisa') return naipeDoTipo('pesquisa');
  if (role === 'revisor') return naipeDoTipo('revisao');
  if (role === 'lider') return naipeDoTipo('decisao');
  if (role === 'seguranca') return naipeDoTipo('seguranca');
  if (role === 'correcao' || role === 'fix') return naipeDoTipo('correcao');
  return naipeDoTipo('construcao');
}

function provaCelular(proof: LedgerProof, index: number): ProvaCelular {
  const id = String(index);
  switch (proof.kind) {
    case 'arquivo':
      return proof.mediaType.startsWith('video/') ? { id, tipo: 'video', rotulo: 'Vídeo' } : { id, tipo: 'imagem', rotulo: 'Print' };
    case 'texto':
      return { id, tipo: 'comando', rotulo: 'Saída', texto: proof.text };
    case 'link':
      return { id, tipo: 'link', rotulo: 'Link', url: proof.url };
  }
}

function entregaCelular(task: LedgerTask): EntregaCelular {
  const delivery = lastDelivery(task);
  const decision = lastDecision(task);
  const sample = task.state === 'aceita';
  const deliveredBy = delivery?.by;
  return {
    id: task.id,
    origem: sample ? 'amostra-revisor' : 'esperando-voce',
    naipe: naipeDoPapel(deliveredBy?.kind === 'lugar' ? deliveredBy.roleId : undefined),
    titulo: `${basename(task.projectPath) || task.projectPath} · prazo ${task.due.split('-').reverse().join('/')}`,
    pedido: task.request,
    criterio: task.doneWhen,
    quemEntregou: actorLabel(deliveredBy),
    entregueEm: new Date(delivery?.at ?? task.createdAt).toISOString(),
    ...(delivery?.text ? { nota: delivery.text } : {}),
    ...(sample && decision ? { aceitoPor: actorLabel(decision.by) } : {}),
    risco: task.risk,
    provas: (delivery?.proofs ?? []).map(provaCelular),
  };
}

/** O adaptador sobre o ledger V1. `getService` é `null` enquanto o ledger não abriu. */
export function createLedgerMobilePort(getService: () => LedgerService | null): MobileLedgerPort {
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
      return current ? ownerQueue(current, null).map(entregaCelular) : [];
    },
    decidir(input) {
      const service = getService();
      if (!service) return { ok: false, reason: 'recusada', message: 'O ledger não abriu neste app.' };
      let current;
      try {
        current = service.load().doc;
      } catch (error) {
        return { ok: false, reason: 'recusada', message: `Não consegui ler o ledger (${error instanceof Error ? error.message : String(error)}).` };
      }
      const task = current.tasks[input.itemId];
      if (!task) return { ok: false, reason: 'nao-encontrada', message: 'Esta entrega não existe mais.' };
      // Pelo celular só se decide o que está na fila do dono (o mesmo que a faixa do Mindscape mostra).
      if (!waitsForOwner(current, task)) return { ok: false, reason: 'recusada', message: 'Esta entrega já não espera você.' };
      const result =
        input.decisao === 'aceitar'
          ? service.apply({ kind: 'dono' }, { op: 'aceitar', id: task.id })
          : service.apply({ kind: 'dono' }, { op: 'rejeitar', id: task.id, reason: input.motivo ?? '' });
      if (!result.ok) return { ok: false, reason: 'recusada', message: result.reason };
      return { ok: true, estado: result.task.state === 'rejeitada' ? 'rejeitada' : 'aceita' };
    },
    prova(itemId, provaId) {
      const service = getService();
      const current = doc();
      const task = current?.tasks[itemId];
      if (!service || !task || !/^\d{1,2}$/.test(provaId)) return null;
      const proof = lastDelivery(task)?.proofs?.[Number(provaId)];
      if (!proof || proof.kind !== 'arquivo') return null;
      const filePath = service.proofPath(proof);
      return filePath ? { mediaType: proof.mediaType, filePath } : null;
    },
  };
}
