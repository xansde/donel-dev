// T1104 (011-contas-e-provedores, etapa 1) — contrato do mod de contas
// (contracts/account-mod.md). FRONTEIRA DE CREDENCIAL: este arquivo, e todo o
// resto de src/main/accounts/, é o ÚNICO lugar do repo onde `CredentialPair`
// pode existir. Ele NUNCA cruza o preload, nunca entra em log (nem
// truncado), nunca entra em mensagem de erro. Fora desta pasta só circulam
// `AccountSummary`/`AccountsViewDto` (src/shared/accounts.ts).

import type { AccountId } from '../../shared/accounts';

/** Par de credenciais do CLI. Regras duras: nunca serializado para o renderer, nunca logado, nunca em mensagem de erro. */
export interface CredentialPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // epoch ms
  readonly scopes: readonly string[];
}

export type ListAccountsResult =
  | { readonly kind: 'ok'; readonly accounts: readonly import('../../shared/accounts').AccountSummary[] }
  | { readonly kind: 'unavailable'; readonly reason: 'offline' | 'unauthorized' | 'io' };

/**
 * `io` = o servidor respondeu, mas a resposta não deu para usar (formato
 * inesperado, corpo ilegível). É a mesma palavra que `ListAccountsResult` e
 * `SwitchOutcome` já usam para isso — antes o switch não tinha essa opção e
 * caía em `offline`, dizendo "sem rede" sobre um servidor que tinha acabado de
 * responder.
 */
export type SwitchToResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'unknown-account' | 'io' };

/**
 * A interface é EXTRAÍDA dos dois mods concretos (Seazone e local), nunca
 * desenhada em abstrato (D1 do plan.md) — os quatro membros abaixo são
 * exatamente o que os dois exigem. Invariantes (contracts/account-mod.md):
 * 1. Nunca devolve segredo em erro, log ou telemetria.
 * 2. `listAccounts()` nunca lança — falha é `unavailable`.
 * 3. `switchTo()` não escreve em `~/.claude*`; só o motor escreve.
 * 4. Nenhum mod cria agendador de SO; periodicidade é timer do processo vivo.
 * 5. Mod é módulo in-repo do main, escolhido por config — sem loader externo.
 */
export interface AccountMod {
  readonly id: import('../../shared/accounts').ModId;

  /** Lista as contas do backend com carga. Nunca lança: erro vira `unavailable` (C9). */
  listAccounts(): Promise<ListAccountsResult>;

  /** Deixa `id` como a credencial vigente do CLI. NÃO escreve em disco — devolve o par para o motor aplicar. */
  switchTo(id: AccountId): Promise<SwitchToResult>;

  /** Persiste o par que o CLI rotacionou para a conta que está saindo. Seazone: repassa ao servidor deles. Local: grava no cofre. */
  captureRotatedPair(id: AccountId, pair: CredentialPair): Promise<void>;

  /** OPCIONAL — só o mod Seazone implementa (heartbeat de 15 min, C3). O mod local não implementa: switch-time-only é decisão fechada (D4). */
  keepAlive?(): Promise<void>;
}
