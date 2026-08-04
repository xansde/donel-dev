// Spec 010 (D-11) — o ALCANCE da trava, escrito uma vez só.
//
// A trava vale para a cadeia PARA CIMA (item → plano → discovery) e para nenhum
// irmao:
//
//  - discovery em andamento trava o plano e os itens que descendem dele — o card
//    inteiro esta sendo trabalhado, e disparar a fase seguinte no meio disso e o
//    atropelo que a trava existe para impedir;
//  - dois ITENS do mesmo plano rodam em paralelo sem problema — sao assuntos
//    irmaos, e o modelo novo quer justamente esse paralelismo (D-5/D-7).
//
// Mora aqui, e nao dentro do disparo, porque a TELA precisa da MESMA regra: se
// ela oferecer o que `dispatchPhase` vai recusar — ou esconder o que ele
// aceitaria —, volta o defeito que o batch B2 existe para extinguir (oferecer
// caminho que o modelo nao comporta), so que pelo avesso. Duas copias da mesma
// regra e como o vocabulario errado reapareceu noutro lugar depois de
// "corrigido": a correcao nao tinha descido ate a raiz.
//
// Modulo puro: sem I/O, sem Electron.

import type { EntityId, LockRecord } from './storeFormat';

export interface LockChainAncestors {
  readonly discoveryId: string;
  readonly planId?: string | null;
}

/** O assunto e seus ancestrais na cadeia. Nunca inclui irmaos. */
export function lockChainOf(subject: EntityId, ancestors: LockChainAncestors): readonly EntityId[] {
  const chain: EntityId[] = [subject];
  if (subject.entity === 'work_item' && ancestors.planId) chain.push({ entity: 'plan', id: ancestors.planId });
  if (subject.entity !== 'discovery') chain.push({ entity: 'discovery', id: ancestors.discoveryId });
  return chain;
}

/** A trava que impede este assunto de ser disparado, se houver alguma. */
export function findBlockingLock(locks: readonly LockRecord[], chain: readonly EntityId[]): LockRecord | null {
  return locks.find((lock) => chain.some((entry) => entry.entity === lock.subject.entity && entry.id === lock.subject.id)) ?? null;
}
