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

import type { EntityId, LockRecord, LockResource } from './storeFormat';

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

// ---------------------------------------------------------------------------
// A8/A20 — trava por RECURSO DE ESCRITA. Alcance DIFERENTE do resto deste
// arquivo: a cadeia acima olha o MESMO assunto (ou ancestral) e libera
// IRMAOS de proposito (D-5/D-7 — dois itens do mesmo plano rodam em
// paralelo). A trava de recurso olha o MESMO REPO+CAMINHO FISICO e
// ATRAVESSA assuntos irmaos — porque o perigo real (P32: "worker rodou na
// arvore principal enquanto outra sessao commitava nela — commits
// entrelacados na mesma branch") nao pergunta de quem e o card, pergunta em
// que DIRETORIO os dois estao escrevendo ao mesmo tempo. As duas travas
// convivem: uma nao substitui a outra.
// ---------------------------------------------------------------------------

/**
 * Duas dispatches conflitam pelo recurso quando apontam para o MESMO repo e o
 * caminho fisico nao PROVA isolamento:
 *
 * - `treePath` desconhecido (`null`) de QUALQUER lado e tratado como a arvore
 *   PRINCIPAL/compartilhada — o caso mais arriscado, e o default de hoje
 *   (`worktree_path` do run-input segue `null` na pratica; A20 nomeia
 *   exatamente isto: "operar na arvore principal exige lock da arvore").
 * - So NAO conflita quando os DOIS lados declaram um caminho conhecido e ele
 *   DIFERE — a prova de que sao worktrees distintas, o paralelismo que D-5/
 *   D-7 pedem.
 *
 * Deliberadamente NAO usa `branch` para decidir (só carrega para exibição):
 * `branch` nunca é preenchido pelo disparo ao vivo hoje, e tratar `null` como
 * curinga aí quebraria o paralelismo de irmãos isolados por worktree assim
 * que ele existir. `treePath` é o sinal que o contrato já tem e que decide
 * corretamente os dois casos (a árvore principal partilhada É o recurso
 * disputado; duas worktrees distintas NÃO são o mesmo recurso).
 */
export function resourceConflicts(a: LockResource, b: LockResource): boolean {
  if (a.targetRepo !== b.targetRepo) return false;
  if (a.treePath === null || b.treePath === null) return true;
  return a.treePath === b.treePath;
}

/** A trava de RECURSO que impede este pedido, se houver alguma — atravessa assuntos irmaos. */
export function findResourceLock(locks: readonly LockRecord[], resource: LockResource): LockRecord | null {
  return locks.find((lock) => lock.resource !== null && resourceConflicts(lock.resource, resource)) ?? null;
}
