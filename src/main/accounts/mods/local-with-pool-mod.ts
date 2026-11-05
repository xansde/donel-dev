// Pool Seazone AO LADO das contas locais, sem trocar o mod. Com
// `accounts.mod = 'local'` e `accounts.seazone` configurado, index.ts
// (`resolveAccountMod`) entrega ao motor este mod composto: as contas locais
// (local-mod.ts) seguidas das contas do switcher (seazone-mod.ts), cada uma com
// id `seazone:<label>` (pool-account-id.ts).
//
// O ponto crítico é o ROTEAMENTO POR DONO DO ID em `switchTo`,
// `captureRotatedPair` e `keepAlive`: o par rotacionado de uma conta local que
// sai vai para o cofre local (senão a conta pede reconexão e o token pessoal
// iria parar no servidor Seazone); o de uma conta do pool vai para o
// heartbeat do switcher (senão a conta compartilhada quebra para os colegas).
//
// Nenhuma invariante do ADR 0001 muda: este mod não escreve em `~/.claude*`
// (o motor aplica o par via claude-state.ts, na mesma ordem de sempre), não
// renova token do pool (quem fala com o switcher continua sendo só o
// seazone-mod, que não importa token-refresh.ts) e não cria agendador.

import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToContext, SwitchToResult, SyncActivePairResult } from '../account-mod';
import { poolLabelFromId, toPoolAccountId } from '../pool-account-id';

export interface LocalWithPoolModDeps {
  /** O mod local de sempre (local-mod.ts) — dono de todo id que não começa com `seazone:`. */
  readonly local: AccountMod;
  /** O mod do switcher (seazone-mod.ts) — enxerga só o label, nunca o prefixo. */
  readonly pool: AccountMod;
}

/** Rótulo da linha do pool: deixa claro na lista que a conta é compartilhada. */
function poolRowLabel(label: string): string {
  return `Seazone · ${label}`;
}

/**
 * O pool nunca derruba as locais: `unavailable` (fora do ar, 401, sem token
 * no cofre) ou exceção do lado do switcher devolvem só as locais.
 */
async function listPoolAccounts(pool: AccountMod): Promise<ListAccountsResult | null> {
  try {
    return await pool.listAccounts();
  } catch {
    return null;
  }
}

export function createLocalWithPoolMod(deps: LocalWithPoolModDeps): AccountMod {
  const { local, pool } = deps;

  return {
    // A view continua dizendo `local`: o pool é acréscimo, não troca de mod.
    id: 'local',

    async listAccounts(): Promise<ListAccountsResult> {
      const [localResult, poolResult] = await Promise.all([local.listAccounts(), listPoolAccounts(pool)]);
      if (localResult.kind !== 'ok') return localResult;
      if (!poolResult || poolResult.kind !== 'ok') return localResult;

      const poolAccounts = poolResult.accounts
        .filter((account) => account.id.length > 0)
        .map((account) => ({ ...account, id: toPoolAccountId(account.id), label: poolRowLabel(account.label) }));
      // Contas do pool SEMPRE no fim, depois das locais.
      return { kind: 'ok', accounts: [...localResult.accounts, ...poolAccounts] };
    },

    /**
     * Patch local v2 (D2): o contexto chega ao switcher no vocabulário dele —
     * `from` só vai se a conta que sai for do pool, sem o prefixo (um id
     * local não significa nada lá). A conta que o switcher ENTREGOU volta
     * com o prefixo, para o motor adotá-la como ativa.
     */
    async switchTo(id, context?: SwitchToContext): Promise<SwitchToResult> {
      const poolLabel = poolLabelFromId(id);
      if (poolLabel === null) return local.switchTo(id, context);
      const poolContext: SwitchToContext | undefined = context
        ? { origin: context.origin, from: context.from === null ? null : poolLabelFromId(context.from) }
        : undefined;
      const result = await pool.switchTo(poolLabel, poolContext);
      if (result.kind !== 'ok' || result.accountId === undefined) return result;
      return { ...result, accountId: toPoolAccountId(result.accountId) };
    },

    /** Não engole erro: se o dono recusar guardar o par, a exceção aborta o switch antes de qualquer escrita (claude-state.ts). */
    async captureRotatedPair(id, pair: CredentialPair): Promise<void> {
      const poolLabel = poolLabelFromId(id);
      if (poolLabel === null) {
        await local.captureRotatedPair(id, pair);
        return;
      }
      await pool.captureRotatedPair(poolLabel, pair);
    },

    /** Só o switcher tem sessão a manter viva; o mod local é switch-time-only (D4). Nunca lança. */
    async keepAlive(): Promise<void> {
      try {
        await pool.keepAlive?.();
      } catch {
        // A próxima leitura mostra o pool indisponível; as locais seguem.
      }
    },

    /** Patch local v3 — heartbeat só para conta do pool; uma local nunca chega ao switcher (o token pessoal não sai da máquina). Nunca lança. */
    async syncActivePair(id, pair: CredentialPair): Promise<SyncActivePairResult> {
      const poolLabel = poolLabelFromId(id);
      if (poolLabel === null || !pool.syncActivePair) return { kind: 'skipped' };
      try {
        return await pool.syncActivePair(poolLabel, pair);
      } catch {
        return { kind: 'failed', reason: 'offline' };
      }
    },
  };
}
