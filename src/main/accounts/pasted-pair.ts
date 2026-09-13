// 011-contas-e-provedores, etapa 3, Fase 1 (F2) — PURO: valida o par colado
// manualmente no fallback de "conectar conta" (o caminho principal — login
// isolado — é a Fase 1.2, fora do escopo deste bloco). Hoje o renderer
// mandava `expiresAt = Date.now() + 1h` (AccountsPanel.tsx:146) e o main
// aceitava qualquer número: se o token colado vencesse antes desse prazo
// chutado, o mod achava que estava válido, não disparava o refresh de
// fallback (`local-mod.ts`, só refresca par JÁ vencido no switch, D4), e o
// switch gravava um par morto no cofre.

import type { CredentialPair } from './account-mod';

export interface PastedPairInput {
  readonly accessToken?: unknown;
  readonly refreshToken?: unknown;
  readonly expiresAt?: unknown;
}

export type BuildPastedPairResult = { readonly kind: 'ok'; readonly pair: CredentialPair } | { readonly kind: 'invalid-input' };

function trimmedNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * `undefined`/`null` (campo ausente ou explicitamente nulo) vira `0` —
 * validade DESCONHECIDA é tratada como VENCIDA de propósito: o mod local
 * renova o par no fallback de switch antes de usá-lo pela primeira vez
 * (`local-mod.ts`: `pair.expiresAt <= Date.now()` dispara o refresh), então a
 * conta nasce correta em vez de "válida" por um prazo chutado. Qualquer outro
 * valor que não seja inteiro finito >= 0 é entrada inválida — só a ausência
 * EXPLÍCITA vira `0`; nunca por silêncio (ex.: string numérica é rejeitada,
 * não convertida).
 */
function resolveExpiresAt(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) return value;
  return null;
}

/** `scopes` sempre `[]` — o colhedor manual não tem como saber os scopes reais do token colado (só o login isolado, que lê o `.credentials.json`, tem essa informação). */
export function buildPastedPair(input: PastedPairInput): BuildPastedPairResult {
  const accessToken = trimmedNonEmptyString(input.accessToken);
  const refreshToken = trimmedNonEmptyString(input.refreshToken);
  const expiresAt = resolveExpiresAt(input.expiresAt);
  if (accessToken === null || refreshToken === null || expiresAt === null) return { kind: 'invalid-input' };

  return { kind: 'ok', pair: { accessToken, refreshToken, expiresAt, scopes: [] } };
}
