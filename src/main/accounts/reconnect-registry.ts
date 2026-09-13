// 011-contas-e-provedores, etapa 3, Fase 2 (D3) — registro em memória de
// quais contas precisam reconectar. O motor (account-engine.ts) marca uma
// conta quando a troca PARA ELA falha com `expired-credentials`; a marca
// some quando uma troca bem-sucedida pra ela acontece, ou quando um login
// isolado a renova (isolated-login.ts/index.ts). Puro (Set em memória) —
// index.ts mantém UM registro compartilhado entre reconstruções do motor
// (senão um rebuild de F6 perderia toda marca pendente).

import type { AccountId } from '../../shared/accounts';

export interface ReconnectRegistry {
  has(id: AccountId): boolean;
  mark(id: AccountId): void;
  clear(id: AccountId): void;
}

export function createReconnectRegistry(): ReconnectRegistry {
  const marked = new Set<AccountId>();
  return {
    has: (id) => marked.has(id),
    mark: (id) => {
      marked.add(id);
    },
    clear: (id) => {
      marked.delete(id);
    },
  };
}
