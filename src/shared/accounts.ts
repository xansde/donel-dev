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
  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — só o motor preenche (mods
   * NUNCA setam este campo, ver account-mod.ts). Presente e `true` quando a
   * última troca PARA esta conta falhou com `expired-credentials`; ausente
   * (chave nem existe) = `false`, pra não quebrar comparação por `toEqual`
   * nos testes que já existiam antes desta fase.
   */
  readonly needsReconnect?: boolean;
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D5; `blind` no adendo D8) —
 * estado do auto-switch pro painel decidir o que mostrar sem recalcular
 * limiar/folga na UI. `off` desligado · `idle` nada a fazer (ativa abaixo do
 * limiar, sem ativa, carga da ativa desconhecida, motor inerte/indisponível)
 * · `armed` ativa >= limiar e existe candidata · `saturated` ativa >= limiar,
 * nenhuma candidata, e TODAS as outras contas disponíveis/sem
 * `needsReconnect` têm carga conhecida (D6 — o painel avisa, não troca) ·
 * `blind` ativa >= limiar, nenhuma candidata, mas pelo menos UMA outra conta
 * disponível/sem `needsReconnect` está com carga DESCONHECIDA — falta DADO,
 * não falta folga (D8: o access token de uma conta parada vence ~8h depois
 * da última captura).
 */
export type AutoSwitchState = 'off' | 'idle' | 'armed' | 'saturated' | 'blind';

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D5) — última decisão do
 * auto-switch NESTE motor. Em memória de propósito: some ao reconstruir o
 * motor (F6) ou reiniciar o app — não é histórico persistido.
 *
 * 22/09 — `deferred` foi removido (emenda da D5, ver plan-etapa-3.md): o
 * auto-switch não adia mais por sessão ocupada, então esse estado nunca mais
 * é produzido.
 */
export type AutoSwitchEvent =
  | { readonly kind: 'switched'; readonly from: AccountId | null; readonly to: AccountId; readonly at: string }
  | { readonly kind: 'failed'; readonly to: AccountId; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'io'; readonly at: string };

/**
 * 22/09 (011-contas-e-provedores, etapa 3, Fase 2, emenda da D5) — corrida
 * observada depois de um switch (auto ou manual): o CLI pode renovar o par
 * de `~/.claude/.credentials.json` no mesmo instante em que o app grava a
 * conta nova, sobrescrevendo a troca. `SwitchOverwrittenWarning` é o que o
 * motor detecta ~30-60s depois de um switch bem-sucedido (ver
 * `AccountEngine` — checagem de corrida), exposto na view pro painel avisar
 * o operador. Em memória, mesma régua de `lastAutoSwitch`.
 */
export interface SwitchOverwrittenWarning {
  readonly to: AccountId;
  readonly at: string;
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
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — sha256 hex do `accountUuid`
   * do `.claude.json` (opaco, NUNCA e-mail/nome — LGPD;
   * `accountFingerprintFromClaudeJsonText`, main/accounts/credentials-file.ts).
   * Só existe em conta cadastrada por LOGIN ISOLADO — ausente (chave nem
   * existe) em conta antiga (token colado à mão, migrada de perfil). `null`
   * = login isolado que concluiu sem conseguir ler um `accountUuid` (ainda
   * assim uma conta válida; só não pode ser reconhecida de novo por
   * fingerprint).
   */
  readonly fingerprint?: string | null;
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
  /** 011-contas-e-provedores, etapa 3, Fase 2 (D5) — ver `AutoSwitchState`. */
  readonly autoSwitchState: AutoSwitchState;
  /** 011-contas-e-provedores, etapa 3, Fase 2 (D5) — última decisão do auto-switch neste motor; `null` = nenhuma ainda. Em memória (some ao reconstruir o motor ou reiniciar). */
  readonly lastAutoSwitch: AutoSwitchEvent | null;
  /** 22/09 (emenda da D5) — corrida detectada depois do último switch; `null` = nenhuma (caso comum). Em memória, mesma régua de `lastAutoSwitch`. */
  readonly lastSwitchOverwritten: SwitchOverwrittenWarning | null;
}

/**
 * Único ponto por onde segredo ENTRA (write-only, padrão T3). Nada aqui é
 * devolvido em nenhum canal de leitura — nem eco do que foi digitado.
 */
export type ConnectModInput =
  | { readonly mod: 'seazone'; readonly baseUrl: string; readonly sessionRefreshToken: string }
  | {
      readonly mod: 'local';
      readonly label: string;
      readonly accessToken: string;
      readonly refreshToken: string;
      /**
       * F2 (011-contas-e-provedores, etapa 3, Fase 1) — `undefined`/`null` =
       * validade DESCONHECIDA (ex.: token colado à mão, sem o `expiresAt`
       * real do arquivo de credenciais) — tratada como VENCIDA de propósito:
       * o mod local renova no primeiro switch (`local-mod.ts`, D4) em vez de
       * confiar num prazo chutado pelo renderer. Ver `buildPastedPair`
       * (main/accounts/pasted-pair.ts), que é quem de fato decide o valor
       * final gravado no cofre.
       */
      readonly expiresAt?: number | null;
    };

export type ConnectModOutcome =
  | { readonly kind: 'connected'; readonly config: AccountsConfigDto }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'vault-unavailable' | 'invalid-input' };

/** 22/09 — `deferred`/`session-busy` foi removido: o switch (manual ou auto) nunca mais adia por sessão ocupada. */
export type SwitchOutcome =
  | { readonly kind: 'switched'; readonly from: AccountId | null; readonly to: AccountId }
  | { readonly kind: 'already-active'; readonly account: AccountId }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'io' };

/** 011-contas-e-provedores, etapa 3, Fase 1 — "Remover conta" (plan-etapa-3.md §4.3). Bloqueada quando `id` é a conta ATIVA (ver `planRemoveAccount`, account-pool.ts). */
export type RemoveAccountOutcome =
  | { readonly kind: 'removed'; readonly config: AccountsConfigDto }
  | { readonly kind: 'blocked'; readonly reason: 'active-account' }
  | { readonly kind: 'failed'; readonly reason: 'unknown-account' | 'io' };

/**
 * 011-contas-e-provedores, etapa 3, Fase 1.2 — resultado de iniciar um login
 * isolado (`accounts:beginLogin`, `IsolatedLoginManager.begin`,
 * main/accounts/isolated-login.ts). `loginId` é o mesmo id usado depois em
 * `getPendingDir`/`attachPty`/`cancelLogin`.
 */
export type BeginLoginOutcome =
  | { readonly kind: 'started'; readonly loginId: string }
  | {
      readonly kind: 'failed';
      /**
       * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — `active-account` e
       * `unknown-account` só saem de `accounts:beginReconnect`
       * (`planReconnect`, account-pool.ts): a conta ativa nunca reconecta (a
       * credencial dela vive no `~/.claude`) e um id que sumiu da config não
       * tem pra onde apontar o login.
       */
      readonly reason: 'invalid-input' | 'vault-unavailable' | 'login-in-progress' | 'io' | 'active-account' | 'unknown-account';
    };

/**
 * 011-contas-e-provedores, etapa 3, Fase 1.2 — status final de um login
 * isolado, emitido em `accounts:loginChanged`
 * (main/accounts/isolated-login.ts, `IsolatedLoginManager.emitStatus`).
 * `label` é sempre o rótulo digitado PARA ESTE login — inclusive em
 * `replaced`, onde a conta existente mantém o PRÓPRIO rótulo em
 * `existingLabel` (conta repetida substitui o par, nunca o rótulo, decisão
 * da Fase 1).
 */
export type LoginStatusDto =
  | { readonly loginId: string; readonly label: string; readonly state: 'added'; readonly accountId: AccountId }
  | { readonly loginId: string; readonly label: string; readonly state: 'replaced'; readonly accountId: AccountId; readonly existingLabel: string }
  | {
      readonly loginId: string;
      readonly label: string;
      readonly state: 'cancelled';
      readonly reason: 'user' | 'exited-without-login' | 'no-terminal';
    }
  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — login com alvo
   * (`beginReconnect`) que colheu a credencial da MESMA conta: o par no
   * cofre foi renovado, a marca `needsReconnect` cai. `label` é o rótulo da
   * conta-alvo (igual ao pedido em `beginReconnect`).
   */
  | { readonly loginId: string; readonly label: string; readonly state: 'reconnected'; readonly accountId: AccountId }
  /**
   * Fase 2 (D3) — login com alvo cuja credencial colhida é de OUTRA conta
   * (fingerprint bate com outra, ou os dois têm fingerprint e divergem).
   * Nada é gravado. `otherLabel` é o rótulo da conta que o fingerprint
   * realmente identificou; `null` quando não dá pra provar de quem é (login
   * sem fingerprint contra alvo com fingerprint diferente já é aceito — só
   * chega aqui quando dá pra afirmar que é outra).
   */
  | { readonly loginId: string; readonly label: string; readonly state: 'wrong-account'; readonly otherLabel: string | null }
  | {
      readonly loginId: string;
      readonly label: string;
      readonly state: 'failed';
      /** Fase 2 (D3) — `unknown-account` = o alvo do reconectar sumiu da config entre o `beginReconnect` e a conclusão do login. */
      readonly reason: 'vault-unavailable' | 'io' | 'unknown-account';
    };

export const ACCOUNT_CHANNELS = {
  list: 'accounts:list',
  switch: 'accounts:switch',
  getConfig: 'accounts:getConfig',
  setConfig: 'accounts:setConfig',
  connectMod: 'accounts:connectMod',
  disconnectMod: 'accounts:disconnectMod',
  removeAccount: 'accounts:removeAccount',
  changed: 'accounts:changed',
  /** 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado (`IsolatedLoginManager`, main/accounts/isolated-login.ts). */
  beginLogin: 'accounts:beginLogin',
  cancelLogin: 'accounts:cancelLogin',
  loginChanged: 'accounts:loginChanged',
  /** 011-contas-e-provedores, etapa 3, Fase 2 (D3) — login isolado direcionado a UMA conta já cadastrada (`beginReconnect`, isolated-login.ts). */
  beginReconnect: 'accounts:beginReconnect',
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
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — inicia o login isolado
   * (rótulo pedido ANTES de abrir a aba — LGPD, o nome nunca sai do
   * `.claude.json`). `loginId` do retorno alimenta o `pty:create` seguinte
   * (`PtyCreateOptions.accountLoginId`).
   */
  beginLogin(label: string): Promise<BeginLoginOutcome>;
  /** Cancela um login isolado pendente — mata a aba, apaga o diretório, nada toca o cofre. */
  cancelLogin(loginId: string): Promise<void>;
  /** Retorna função de unsubscribe (mesmo padrão de `onChanged`). */
  onLoginChanged(listener: (status: LoginStatusDto) => void): () => void;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — login isolado apontado
   * PARA a conta `id` (mesmo `IsolatedLoginManager` do `beginLogin`, com
   * alvo). O rótulo vem da conta cadastrada — nunca digitado de novo.
   */
  beginReconnect(id: AccountId): Promise<BeginLoginOutcome>;
}
