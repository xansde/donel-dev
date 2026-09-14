// 011-contas-e-provedores, etapa 3, Fase 2 (R1, revisão) — coordenador de
// renovação compartilhável ENTRE instâncias do mod local. Antes desta peça,
// o mapa de renovação em voo vivia DENTRO de cada `createLocalMod`; o motor
// reconstrói o mod inteiro (F6 — troca de `mod`/`localAccounts`), e o mod
// novo não enxergava a renovação que o mod antigo já tinha em andamento para
// a mesma conta. Refresh token é de uso único: dois refresh com o MESMO
// token não podem acontecer — na melhor hipótese o segundo é recusado, na
// pior o servidor revoga a família inteira. index.ts cria UMA instância no
// nível de módulo e passa a MESMA para toda `createLocalMod` (Bloco 3), então
// a proteção sobrevive à reconstrução.

import type { AccountId } from '../../shared/accounts';

export interface RefreshCoordinator {
  /**
   * Roda `task` para `id`. Uma chamada que chega enquanto outra já está em
   * voo para o MESMO `id` (nesta instância do coordenador, não desta
   * chamada) recebe a MESMA promessa — `task` NUNCA roda duas vezes em
   * paralelo para o mesmo `id`. O registro em voo limpa no `finally`,
   * sucesso ou falha, liberando a PRÓXIMA chamada para rodar `task` de novo.
   */
  run<T>(id: AccountId, task: () => Promise<T>): Promise<T>;
}

export function createRefreshCoordinator(): RefreshCoordinator {
  const pending = new Map<AccountId, Promise<unknown>>();

  return {
    run<T>(id: AccountId, task: () => Promise<T>): Promise<T> {
      const inFlight = pending.get(id);
      if (inFlight) return inFlight as Promise<T>;

      const promise = (async () => {
        try {
          return await task();
        } finally {
          pending.delete(id);
        }
      })();

      pending.set(id, promise);
      return promise;
    },
  };
}
