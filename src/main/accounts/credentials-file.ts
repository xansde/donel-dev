// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 1 — leitura PURA dos dois
// arquivos que `/login` grava num `CLAUDE_CONFIG_DIR` isolado
// (research-etapa-3-cli.md A6): `.credentials.json` (o par OAuth) e
// `.claude.json` (o fingerprint opaco da conta). Sem I/O — quem lê o disco é
// `isolated-login.ts` (via `IsolatedLoginManager.fs`), este módulo só faz
// parsing/validação de texto já lido.
//
// `extractPairFromCredentialsJson` morava em `migration/credentials-import.ts`
// (T1210, etapa 2) — movida pra cá porque o colhedor do login isolado (Fase 1,
// Bloco 1) e a migração de perfis (etapa 2) precisam do MESMO parsing do
// MESMO formato real de arquivo; `credentials-import.ts` agora importa daqui.

import { createHash } from 'node:crypto';
import type { CredentialPair } from './account-mod';

export type CredentialsFileTextReadResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid-format' };

/**
 * Formato REAL de `.credentials.json` do CLI (mesmo que `claude-state.ts`
 * `extractPair` já lê): o par vive dentro do bloco `claudeAiOauth`, não solto
 * na raiz do arquivo — outras chaves top-level (`unrelatedField` etc.) podem
 * existir e são ignoradas aqui de propósito.
 */
export function extractPairFromCredentialsJson(value: unknown): CredentialPair | null {
  if (typeof value !== 'object' || value === null) return null;
  const oauth = (value as { claudeAiOauth?: unknown }).claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) return null;
  const candidate = oauth as Partial<CredentialPair>;
  if (typeof candidate.accessToken !== 'string' || typeof candidate.refreshToken !== 'string' || typeof candidate.expiresAt !== 'number') {
    return null;
  }
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    scopes: Array.isArray(candidate.scopes) ? candidate.scopes.filter((s): s is string => typeof s === 'string') : [],
  };
}

/**
 * `null` (arquivo ainda não existe — normal enquanto o `/login` não terminou
 * de escrever) vira `absent`; texto presente mas sem JSON válido ou sem
 * `claudeAiOauth` no formato esperado vira `invalid-format` (o poll do login
 * isolado trata os dois iguais: "ainda esperando", pode ser escrita parcial
 * do CLI). `expiresAt`/`scopes` são os REAIS do arquivo — nunca um prazo
 * chutado (isso é só o fallback de colar token à mão, `pasted-pair.ts`).
 */
export function readCredentialsPairFromText(text: string | null): CredentialsFileTextReadResult {
  if (text === null) return { kind: 'absent' };
  try {
    const parsed = JSON.parse(text) as unknown;
    const pair = extractPairFromCredentialsJson(parsed);
    if (!pair) return { kind: 'invalid-format' };
    return { kind: 'ok', pair };
  } catch {
    return { kind: 'invalid-format' };
  }
}

/**
 * sha256 hex de `oauthAccount.accountUuid` (string não vazia) — id OPACO e
 * ESTÁVEL da conta, usado só para reconhecer "esta é a mesma conta de novo"
 * (`findAccountByFingerprint`, account-pool.ts) e decidir add/substitui no
 * fim do login isolado. NUNCA lê nem devolve outro campo do `.claude.json`
 * (e-mail, nome, organização) — LGPD: o rótulo da conta vem SEMPRE do que o
 * operador digitou antes de abrir a aba, nunca daqui. `null` = arquivo
 * ausente, JSON inválido, ou `accountUuid` ausente/vazio/não-string (o
 * `/login` pode ainda não ter terminado de escrever o perfil).
 */
export function accountFingerprintFromClaudeJsonText(text: string | null): string | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { oauthAccount?: { accountUuid?: unknown } };
    const accountUuid = parsed?.oauthAccount?.accountUuid;
    if (typeof accountUuid !== 'string' || !accountUuid) return null;
    return createHash('sha256').update(accountUuid, 'utf8').digest('hex');
  } catch {
    return null;
  }
}
