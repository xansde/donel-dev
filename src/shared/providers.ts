// T1304 (011-contas-e-provedores, etapa 3) — tipos IPC do registry de
// providers classe A (data-model.md, contracts/provider-registry.md). Mesmo
// espírito de src/shared/accounts.ts: só tipos e canais, sem I/O. NENHUM
// campo aqui carrega valor de segredo — o valor vive só no cofre
// (src/main/providers/provider-secrets.ts), nunca atravessa o preload.
//
// D1 (research.md/plan.md) — o contrato da classe A é o mecanismo env do
// Claude Code, não a API de um provider específico: `env` é um mapa
// genérico + `secretEnvKeys` (nomes, nunca valores). Nenhum campo nomeado
// (`baseUrl`, `apiKey`, `model`) — isso seria o formato-OpenRouter vazando
// pro registry (lição da etapa 1, R2).

/** Slug opaco: `^[a-z0-9][a-z0-9-]{0,31}$`. LGPD (C22): nunca nome de pessoa. */
export type ProviderId = string;

/** `'A'` = Claude-compatible (único com spawn na v1); `'B'` = CLI terceiro, aceito e persistido, recusado no lançamento (C20/D5). */
export type ProviderClass = 'A' | 'B';

/** Entrada de registry, persistida na chave `providers` do config.json (data-model.md §1). */
export interface ProviderEntry {
  readonly id: ProviderId;
  /** Texto livre do operador. LGPD (C22): nunca nome de pessoa. */
  readonly label: string;
  readonly class: ProviderClass;
  /** Só classe B; classe A sempre usa o binário `claude` resolvido pelo app — o campo é `null`. */
  readonly command: string | null;
  /** Env NÃO sensível (ex.: ANTHROPIC_BASE_URL, ANTHROPIC_MODEL). Genérico de propósito (C15/D1). */
  readonly env: Readonly<Record<string, string>>;
  /** Nomes (nunca valores) das variáveis cujo segredo vive no cofre. */
  readonly secretEnvKeys: readonly string[];
  /** Nome do diretório sob `<userData>/providers/`. Default = `id` (C16). */
  readonly configDirName: string;
}

/** O que atravessa o preload. Nunca contém valor de env sensível (data-model.md §2). */
export interface ProviderSummaryDto {
  readonly id: ProviderId;
  readonly label: string;
  readonly class: ProviderClass;
  /** Derivado do cofre; é tudo que a UI sabe sobre o segredo (C19). */
  readonly secretsStatus: 'configured' | 'missing' | 'vault-unavailable';
  /** `false` para `class: 'B'` na v1 (C20). */
  readonly supported: boolean;
  /** Só os NOMES (diagnóstico), incluindo os secretos. */
  readonly envKeys: readonly string[];
}

/** Chave `providers` do config.json (data-model.md §3). Nasce `{ version: 1, entries: [] }` — registry inerte (C14/D6). */
export interface ProvidersConfigDto {
  readonly version: 1;
  readonly entries: readonly ProviderEntry[];
}

export function defaultProvidersConfig(): ProvidersConfigDto {
  return { version: 1, entries: [] };
}

/** Write-only: segredos vão por `setSecret`, nunca pelo upsert (contracts/provider-registry.md). */
export interface UpsertProviderInput {
  /** Ausente = criação; presente = atualização da entrada existente. */
  readonly id?: ProviderId;
  readonly label: string;
  readonly class: ProviderClass;
  readonly command?: string | null;
  readonly env?: Readonly<Record<string, string>>;
  readonly secretEnvKeys?: readonly string[];
  readonly configDirName?: string;
}

export type ValidationReason =
  | 'invalid-id'
  | 'invalid-label'
  | 'invalid-class'
  | 'invalid-command'
  | 'reserved-env-key'
  | 'secret-key-conflict'
  | 'not-found';

export type UpsertProviderResult =
  | { readonly kind: 'ok'; readonly id: ProviderId }
  | { readonly kind: 'invalid'; readonly reason: ValidationReason; readonly field: string };

export type SetSecretResult = { readonly kind: 'ok' } | { readonly kind: 'vault-unavailable' };

export type ResolveLaunchResult =
  | { readonly kind: 'ok'; readonly env: Record<string, string>; readonly configDir: string }
  | { readonly kind: 'unsupported-class' }
  | { readonly kind: 'missing-secret'; readonly envKey: string }
  | { readonly kind: 'vault-unavailable' }
  | { readonly kind: 'not-found' };

export const PROVIDER_CHANNELS = {
  list: 'providers:list',
  upsert: 'providers:upsert',
  remove: 'providers:remove',
  setSecret: 'providers:setSecret',
} as const;

/**
 * API tipada exposta pelo preload em `window.donel.providers` (contextBridge).
 * Não existe `providers:resolveLaunch` como canal (contracts/provider-registry.md)
 * — a resolução acontece no main durante `pty:create`, para o env nunca
 * atravessar o preload.
 */
export interface DonelProvidersApi {
  list(): Promise<readonly ProviderSummaryDto[]>;
  upsert(input: UpsertProviderInput): Promise<UpsertProviderResult>;
  remove(id: ProviderId): Promise<readonly ProviderSummaryDto[]>;
  /** Write-only: grava o valor no cofre e devolve só o status — nunca ecoa o valor de volta. */
  setSecret(id: ProviderId, envKey: string, value: string): Promise<SetSecretResult>;
}
