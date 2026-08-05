// T1307 (011-contas-e-provedores, etapa 3) — env efetivo de uma sessão de
// provider classe A (data-model.md §5). PURO: cofre injetado via callback
// `readSecret`, sem I/O próprio, sem log. Falta de segredo aborta a sessão
// inteira (`missing-secret`) — nunca monta um env pela metade.

import type { ProviderEntry } from '../../shared/providers';
import { isReservedProviderEnvKey } from './reserved-env-keys';

export type BuildProviderEnvResult =
  | { readonly kind: 'ok'; readonly env: Record<string, string> }
  | { readonly kind: 'missing-secret'; readonly envKey: string };

/**
 * `readSecret(envKey)` devolve o valor em texto plano do cofre, ou `null` se
 * ausente — quem injeta decide a fonte real (provider-secrets.ts em
 * produção, um Map em teste). Nunca lança, nunca loga; o erro carrega só o
 * NOME da variável faltando, nunca o valor de nenhuma outra.
 */
export function buildProviderEnv(entry: ProviderEntry, readSecret: (envKey: string) => string | null): BuildProviderEnvResult {
  const env: Record<string, string> = {};

  // Defesa em profundidade (§6 do data-model.md): mesmo que `entry.env` já
  // devesse ter passado pelo sanitize do registry, este é o último ponto
  // antes do spawn — nunca confia cegamente que quem chamou filtrou.
  for (const [key, value] of Object.entries(entry.env)) {
    if (isReservedProviderEnvKey(key)) continue;
    env[key] = value;
  }

  for (const envKey of entry.secretEnvKeys) {
    if (isReservedProviderEnvKey(envKey)) continue;
    const value = readSecret(envKey);
    if (value === null) return { kind: 'missing-secret', envKey };
    env[envKey] = value;
  }

  return { kind: 'ok', env };
}
