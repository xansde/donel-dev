// Pool Seazone ao lado das contas locais — o id de uma conta do pool dentro do
// motor. O switcher identifica conta pelo `label` (seazone-mod.ts); dentro do
// mod composto (mods/local-with-pool-mod.ts) esse label ganha o prefixo
// `seazone:` para nunca colidir com o id opaco (UUID) de uma conta local.
// O prefixo decide o DONO da conta: `switchTo`, `captureRotatedPair` e o
// auto-switch roteiam por ele. Nenhuma credencial passa por aqui.

import type { AccountId } from '../../shared/accounts';

export const SEAZONE_POOL_ID_PREFIX = 'seazone:';

export function toPoolAccountId(label: string): AccountId {
  return `${SEAZONE_POOL_ID_PREFIX}${label}`;
}

/** Label sem prefixo, ou `null` quando o id não é de conta do pool (inclui `seazone:` vazio). */
export function poolLabelFromId(id: AccountId): string | null {
  if (!id.startsWith(SEAZONE_POOL_ID_PREFIX)) return null;
  const label = id.slice(SEAZONE_POOL_ID_PREFIX.length);
  return label ? label : null;
}

export function isPoolAccountId(id: AccountId): boolean {
  return poolLabelFromId(id) !== null;
}
