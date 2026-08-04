// T1211 (011-contas-e-provedores, etapa 2) — importa UM perfil por chamada
// para o cofre da etapa 1 (contracts/migration-etapa-2.md §3). DENTRO da
// fronteira de credencial: a exceção do CLAUDE.md já cobre `src/main/accounts/`
// inteiro, e este módulo mora dentro dela — não é uma ampliação.
//
// Invariantes: (a) o par vai do arquivo direto para o cofre, sem passar por
// variável de retorno exposta; (b) cofre indisponível ⇒ recusa ANTES de ler
// o arquivo; (c) nenhum `console.*` com conteúdo de par; (d) o resultado
// carrega só `{ id opaco, label }` — nunca e-mail (LGPD).

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { CredentialPair } from '../account-mod';
import type { VaultLike } from '../vault';
import type { ImportResult } from '../../../shared/migration';

export type { ImportResult } from '../../../shared/migration';

export type CredentialsFileReadResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid-format' };

export interface CredentialsImportDeps {
  readonly vault: VaultLike;
  readonly isVaultAvailable: () => boolean;
  /** Nunca lança — leitura + parsing do `.credentials.json` do perfil. */
  readonly readCredentialsFile: (path: string) => CredentialsFileReadResult;
  /** Gera o id opaco da conta importada — nunca e-mail. */
  readonly generateAccountId: (slug: string) => string;
}

export interface ProfileToImport {
  readonly slug: string;
  readonly displayName: string;
  readonly credentialsPath: string;
}

/** Importa UM perfil por chamada. Nunca chamado em lote (OK humano perfil a perfil, D10). */
export function importProfileCredentials(profile: ProfileToImport, deps: CredentialsImportDeps): ImportResult {
  // (b) cofre indisponível ⇒ recusa ANTES de ler o arquivo.
  if (!deps.isVaultAvailable()) return { kind: 'failed', reason: 'vault-unavailable' };

  const fileResult = deps.readCredentialsFile(profile.credentialsPath);
  if (fileResult.kind === 'absent') return { kind: 'absent' };
  if (fileResult.kind === 'invalid-format') return { kind: 'failed', reason: 'invalid-format' };

  const accountId = deps.generateAccountId(profile.slug);
  const writeResult = deps.vault.write(accountId, JSON.stringify(fileResult.pair));
  if (writeResult.kind !== 'ok') return { kind: 'failed', reason: 'vault-unavailable' };

  return { kind: 'imported', accountId, label: profile.displayName };
}

/**
 * Formato REAL de `.credentials.json` do CLI (mesmo que `claude-state.ts`
 * `extractPair` já lê): o par vive dentro do bloco `claudeAiOauth`, não solto
 * na raiz do arquivo — outras chaves top-level (`unrelatedField` etc.) podem
 * existir e são ignoradas aqui de propósito.
 */
function extractPairFromCredentialsJson(value: unknown): CredentialPair | null {
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

/** Deps reais (filesystem da máquina + cofre real) — só o main process usa. Nunca loga o conteúdo lido. */
export function createSystemCredentialsImportDeps(vault: VaultLike, isVaultAvailable: () => boolean): CredentialsImportDeps {
  return {
    vault,
    isVaultAvailable,
    readCredentialsFile: (path) => {
      if (!existsSync(path)) return { kind: 'absent' };
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        const pair = extractPairFromCredentialsJson(parsed);
        if (!pair) return { kind: 'invalid-format' };
        return { kind: 'ok', pair };
      } catch {
        return { kind: 'invalid-format' };
      }
    },
    generateAccountId: () => randomUUID(),
  };
}
