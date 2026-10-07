// Spec 010 (A7) — a parte PURA da reconciliacao MANIFESTO-SEM-RESULT: qual
// sessao e candidata a "a fase morreu entre o manifesto e o result do
// outbox". Sem fs, sem Electron, nunca lanca — o lado que toca disco
// (perguntar se o `resultPath` existe, e encerrar a sessao) mora em
// `main/esteira-dispatch.ts` (`reconcileOrphanedSessions`), que chama esta
// funcao para saber POR ONDE comecar.
//
// O raciocinio que torna isto seguro sem olhar processo nenhum: esta funcao so
// e chamada UMA VEZ, na abertura do app, ANTES de qualquer disparo desta
// execucao. Nesse instante, TODA sessao com `endedAt: null` que ja existia so
// pode ter nascido de uma execucao ANTERIOR — o PTY que a dirigia era filho
// daquele processo Electron, e este processo nao herda nem reconecta a ele.
// "Ainda aberta" e "nao pode mais estar rodando" sao a MESMA coisa, neste
// instante especifico — o que nao seria verdade se esta funcao rodasse a
// qualquer momento durante a execucao.

import type { SessionSnapshot, StoreSnapshot } from './storeFormat';

/**
 * As sessoes que a reconciliacao de boot precisa examinar: ainda abertas
 * (`endedAt: null`) e com um `resultPath` esperado — sem ele nao ha "manifesto
 * sem result" para checar, so uma sessao que nunca prometeu devolver nada.
 */
export function orphanedSessionCandidates(snapshot: StoreSnapshot): readonly SessionSnapshot[] {
  return snapshot.sessions.filter((session) => session.endedAt === null && session.resultPath !== null);
}
