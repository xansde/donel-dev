// T1103 (011-contas-e-provedores, etapa 1) — tipos IPC do domínio de contas
// (data-model.md §1, contracts/ipc-accounts.md). Espelha o padrão de
// src/shared/profiles.ts (PROFILE_CHANNELS): o shared só declara canais e
// DTOs puros, sem I/O. `CredentialPair` NUNCA aparece aqui — fica confinado a
// src/main/accounts/ (regra dura do tasks.md); todo campo abaixo é seguro
// para atravessar o preload e chegar ao renderer.

/** Opaco, estável dentro de um mod. LGPD (C8): nunca e-mail, nunca nome de pessoa. */
export type AccountId = string;

export type ModId = 'seazone' | 'local';

/**
 * Carga de uma conta nas janelas que o auto-switch usa. Todos os campos são
 * "% consumido" — CUIDADO: é o inverso do `percentRemaining` (% livre) de
 * `ProfileQuota` (spec 002); os dois convivem na UI enquanto perfis
 * existirem (achado A3 do `analyze`, ver T1123).
 */
export interface AccountLoad {
  readonly fiveHour: number | null;
  readonly sevenDay: number | null;
  readonly sonnet: number | null;
  /** ISO-8601 da leitura. */
  readonly readAt: string;
}

/** `overallLoad = max(fiveHour, sevenDay, sonnet)` ignorando `null`; três `null` = carga desconhecida (C9 — nunca é destino de auto-switch). */
export function overallLoad(load: AccountLoad | null): number | null {
  if (!load) return null;
  const values = [load.fiveHour, load.sevenDay, load.sonnet].filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

/** O que a UI vê. Nunca carrega segredo. */
export interface AccountSummary {
  readonly id: AccountId;
  readonly label: string;
  readonly plan: string | null;
  readonly active: boolean;
  readonly available: boolean;
  readonly load: AccountLoad | null;
}

export interface AutoSwitchPolicy {
  readonly enabled: boolean;
  readonly switchAtLoad: number; // default 90
  readonly minAdvantage: number; // default 20
}

export function defaultAutoSwitchPolicy(): AutoSwitchPolicy {
  return { enabled: true, switchAtLoad: 90, minAdvantage: 20 };
}

/** Metadado NÃO sensível de uma conta do pool local; segredo mora no cofre (vault.ts). */
export interface LocalAccountMeta {
  readonly id: AccountId;
  readonly label: string;
  readonly plan: string | null;
}

/** Persistência: chave `accounts` do `config.json` (userData). */
export interface AccountsConfig {
  /** `null` = motor inerte; comportamento de hoje intocado (C2). */
  readonly mod: ModId | null;
  readonly autoSwitch: AutoSwitchPolicy;
  /** Alvo das escritas do switch; `null` = default `~/.claude` (C1). */
  readonly claudeHome: string | null;
  readonly seazone: { readonly baseUrl: string } | null;
  readonly localAccounts: readonly LocalAccountMeta[];
  readonly activeAccountId: AccountId | null;
}

export function defaultAccountsConfig(): AccountsConfig {
  return {
    mod: null,
    autoSwitch: defaultAutoSwitchPolicy(),
    claudeHome: null,
    seazone: null,
    localAccounts: [],
    activeAccountId: null,
  };
}

/** DTO devolvido por `accounts:getConfig`/`accounts:setConfig` — mesmo shape de `AccountsConfig` (nada sensível aqui). */
export type AccountsConfigDto = AccountsConfig;

/** DTO devolvido por `accounts:list` e emitido em `accounts:changed`. */
export interface AccountsViewDto {
  readonly mod: ModId | null;
  readonly state: 'inert' | 'ready' | 'unavailable';
  readonly unavailableReason: 'offline' | 'unauthorized' | 'io' | null;
  readonly accounts: readonly AccountSummary[];
  readonly activeAccountId: AccountId | null;
  readonly autoSwitch: AutoSwitchPolicy;
  readonly lastReadAt: string | null;
}

/**
 * Único ponto por onde segredo ENTRA (write-only, padrão T3). Nada aqui é
 * devolvido em nenhum canal de leitura — nem eco do que foi digitado.
 */
export type ConnectModInput =
  | { readonly mod: 'seazone'; readonly baseUrl: string; readonly sessionRefreshToken: string }
  | { readonly mod: 'local'; readonly label: string; readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: number };

export type ConnectModOutcome =
  | { readonly kind: 'connected'; readonly config: AccountsConfigDto }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'vault-unavailable' | 'invalid-input' };

export type SwitchOutcome =
  | { readonly kind: 'switched'; readonly from: AccountId | null; readonly to: AccountId }
  | { readonly kind: 'already-active'; readonly account: AccountId }
  | { readonly kind: 'deferred'; readonly reason: 'session-busy' }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'io' };

/** 011-contas-e-provedores, etapa 3, Fase 1 — "Remover conta" (plan-etapa-3.md §4.3). Bloqueada quando `id` é a conta ATIVA (ver `planRemoveAccount`, account-pool.ts). */
export type RemoveAccountOutcome =
  | { readonly kind: 'removed'; readonly config: AccountsConfigDto }
  | { readonly kind: 'blocked'; readonly reason: 'active-account' }
  | { readonly kind: 'failed'; readonly reason: 'unknown-account' | 'io' };

export const ACCOUNT_CHANNELS = {
  list: 'accounts:list',
  switch: 'accounts:switch',
  getConfig: 'accounts:getConfig',
  setConfig: 'accounts:setConfig',
  connectMod: 'accounts:connectMod',
  disconnectMod: 'accounts:disconnectMod',
  removeAccount: 'accounts:removeAccount',
  changed: 'accounts:changed',
} as const;

/** API tipada exposta pelo preload em `window.donel.accounts` (contextBridge). */
export interface DonelAccountsApi {
  list(options?: { force?: boolean }): Promise<AccountsViewDto>;
  switch(id: AccountId): Promise<SwitchOutcome>;
  getConfig(): Promise<AccountsConfigDto>;
  setConfig(patch: Partial<AccountsConfigDto>): Promise<AccountsConfigDto>;
  connectMod(input: ConnectModInput): Promise<ConnectModOutcome>;
  disconnectMod(): Promise<AccountsConfigDto>;
  /** 011-contas-e-provedores, etapa 3, Fase 1 — remove uma conta cadastrada (bloqueado para a ATIVA, ver `RemoveAccountOutcome`). */
  removeAccount(id: AccountId): Promise<RemoveAccountOutcome>;
  /** Retorna função de unsubscribe (mesmo padrão de `pty.onData`). */
  onChanged(listener: (view: AccountsViewDto) => void): () => void;
}
