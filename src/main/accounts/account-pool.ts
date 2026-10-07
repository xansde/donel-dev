// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — PURO: decide se uma
// mudança de AccountsConfig exige reconstruir o AccountEngine (o mod
// concreto só é resolvido no construtor, account-engine.ts:75 — `updateConfig`,
// account-engine.ts:102, só troca a config em memória) ou se basta
// `updateConfig`. F6 é exatamente essa lacuna: o import de conta com o mod já
// ativo e o handler `accounts:setConfig` só chamavam `updateConfig`, e a
// conta nova só entrava no motor depois de reiniciar o app.

import type { AccountId, AccountsConfig, LocalAccountMeta } from '../../shared/accounts';
import { defaultAccountsConfig } from '../../shared/accounts';
// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — o formato do que o
// login isolado colheu (isolated-login.ts, `AccountHarvestedEvent`).
import type { AccountHarvestedEvent } from './isolated-login';

const SEAZONE_SESSION_KEY = 'seazone:session';

/** Comparação posicional (não só de conjunto) — troca de ordem também conta como mudança, já que a ordem é o que a UI lista. */
function localAccountsChanged(prev: readonly LocalAccountMeta[], next: readonly LocalAccountMeta[]): boolean {
  if (prev.length !== next.length) return true;
  return prev.some((account, index) => {
    const other = next[index];
    return account.id !== other.id || account.label !== other.label || account.plan !== other.plan;
  });
}

/**
 * `true` quando `mod`, `seazone.baseUrl` ou `localAccounts` (id/label/plan/
 * ordem/tamanho) mudaram — só o construtor do `AccountEngine` resolve o mod
 * concreto com a lista nova. `false` para mudanças só de `autoSwitch`,
 * `claudeHome` ou `activeAccountId`, que `updateConfig` já absorve sem
 * reconstruir.
 */
export function needsEngineRebuild(prev: AccountsConfig, next: AccountsConfig): boolean {
  if (prev.mod !== next.mod) return true;
  if (prev.seazone?.baseUrl !== next.seazone?.baseUrl) return true;
  if (localAccountsChanged(prev.localAccounts, next.localAccounts)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 1 — "Remover conta" (plan-etapa-3.md
// §4.3). Hoje não existe remover; `disconnectMod` voltava ao default e
// deixava os pares no cofre (origem das 8 órfãs medidas em 13/09). Os dois
// planos abaixo são PUROS: só calculam a config final + as chaves que o
// cofre deve perder — quem chama (index.ts) aplica a config (persist + motor)
// e apaga do cofre.
// ---------------------------------------------------------------------------

export type RemoveAccountPlan =
  | { readonly kind: 'remove'; readonly config: AccountsConfig; readonly vaultKeys: string[] }
  | { readonly kind: 'blocked'; readonly reason: 'active-account' }
  | { readonly kind: 'unknown-account' };

/**
 * Remover a conta ATIVA é BLOQUEADO: o par dela vive só no `~/.claude` (não
 * no cofre, ver claude-state.ts), e sem `activeAccountId` a próxima troca não
 * tem `fromId` pra capturar o par rotacionado (`AccountEngine.switchTo`) — a
 * conta morreria. Trocar antes é o caminho (a UI orienta isso).
 */
export function planRemoveAccount(config: AccountsConfig, id: AccountId): RemoveAccountPlan {
  const exists = config.localAccounts.some((account) => account.id === id);
  if (!exists) return { kind: 'unknown-account' };
  if (id === config.activeAccountId) return { kind: 'blocked', reason: 'active-account' };

  return {
    kind: 'remove',
    config: { ...config, localAccounts: config.localAccounts.filter((account) => account.id !== id) },
    vaultKeys: [id],
  };
}

export interface DisconnectPlan {
  readonly config: AccountsConfig;
  readonly vaultKeys: string[];
}

/**
 * Volta ao default (motor inerte, C2) preservando só `claudeHome` (não é
 * segredo, é preferência de onde o motor escreveria se reconectado). As
 * chaves agendadas pro cofre são as das contas locais que estão SAINDO da
 * config + `seazone:session` (pool Seazone fora, decisão do dono) — nunca
 * `provider:*` (namespace do cofre compartilhado com os providers classe A).
 */
export function planDisconnect(config: AccountsConfig): DisconnectPlan {
  return {
    config: { ...defaultAccountsConfig(), claudeHome: config.claudeHome },
    vaultKeys: [...config.localAccounts.map((account) => account.id), SEAZONE_SESSION_KEY],
  };
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — o que o login isolado
// (isolated-login.ts) usa pra decidir "esta conta já existe?" e o que index.ts
// grava em `appConfig.accounts` depois de colher a credencial. PUROS, iguais
// aos planos acima.
// ---------------------------------------------------------------------------

/** `null` = nenhuma conta local tem esse fingerprint (ou o fingerprint passado é vazio/desconhecido). Devolve só `{ id, label }` — nunca o objeto inteiro (não vaza `fingerprint` de volta pra fora à toa). */
export function findAccountByFingerprint(config: AccountsConfig, fingerprint: string): { readonly id: AccountId; readonly label: string } | null {
  if (!fingerprint) return null;
  const found = config.localAccounts.find((account) => account.fingerprint === fingerprint);
  return found ? { id: found.id, label: found.label } : null;
}

/**
 * `added`: acrescenta `{ id, label, plan: null, fingerprint }` no FIM da
 * lista e fixa `mod: 'local'` (liga o motor sozinho se ele estava inerte —
 * o mesmo gesto que a migração de perfil já faz). `replaced`: a config NÃO
 * MUDA — a entrada existente mantém id, rótulo e posição; só o par no cofre
 * foi sobrescrito (fora daqui, em `IsolatedLoginManager.harvest`).
 *
 * `reconnected` (011-contas-e-provedores, etapa 3, Fase 2, D3): login COM
 * ALVO que colheu a credencial da MESMA conta. Só grava fingerprint quando a
 * conta-alvo ainda NÃO tinha um (conta antiga, cadastrada antes do login
 * isolado existir) E o evento trouxe um — mantém posição, rótulo e plano
 * intocados; qualquer outro caso (conta sumiu da config, já tinha
 * fingerprint, ou o evento não trouxe um) devolve a config intacta.
 */
export function applyHarvestedAccount(config: AccountsConfig, event: AccountHarvestedEvent): AccountsConfig {
  if (event.kind === 'replaced') return config;

  if (event.kind === 'reconnected') {
    const index = config.localAccounts.findIndex((account) => account.id === event.accountId);
    if (index === -1) return config;

    const existing = config.localAccounts[index];
    if (existing.fingerprint || !event.fingerprint) return config;

    const localAccounts = [...config.localAccounts];
    localAccounts[index] = { ...existing, fingerprint: event.fingerprint };
    return { ...config, localAccounts };
  }

  const newAccount: LocalAccountMeta = { id: event.accountId, label: event.label, plan: null, fingerprint: event.fingerprint };
  return { ...config, mod: 'local', localAccounts: [...config.localAccounts, newAccount] };
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 2 (D3) — "Reconectar" (fase2-design.md
// §Bloco 1). PUROS, mesmo espírito dos planos acima: só decidem/consultam;
// quem chama (index.ts) aplica.
// ---------------------------------------------------------------------------

/**
 * Identifica uma conta cadastrada por id (não por fingerprint — isso é
 * `findAccountByFingerprint` acima). Usado por `accounts:beginReconnect`
 * (index.ts) e injetado no `IsolatedLoginManager` como dependência
 * `findAccountById`, pro colhedor do login isolado saber quem é o alvo.
 * `fingerprint` normaliza a chave ausente (conta antiga) e o `null` explícito
 * (login isolado sem `accountUuid`) pro mesmo valor — ambos significam "esta
 * conta não tem fingerprint ainda".
 */
export function findAccountById(config: AccountsConfig, id: AccountId): { readonly id: AccountId; readonly label: string; readonly fingerprint: string | null } | null {
  const found = config.localAccounts.find((account) => account.id === id);
  return found ? { id: found.id, label: found.label, fingerprint: found.fingerprint ?? null } : null;
}

export type PlanReconnectResult = { readonly kind: 'ok'; readonly label: string } | { readonly kind: 'blocked'; readonly reason: 'active-account' } | { readonly kind: 'unknown-account' };

/**
 * A conta ATIVA nunca reconecta (D3): a credencial dela vive no `~/.claude`,
 * e o próprio CLI a renova sozinho — não há nada pra "reconectar" ali. `id`
 * desconhecido vence sobre `blocked`, mesmo que por acaso bata com
 * `activeAccountId` (mesma ordem de checagem de `planRemoveAccount`: existe
 * primeiro, depois é ativa).
 */
export function planReconnect(config: AccountsConfig, id: AccountId): PlanReconnectResult {
  const found = config.localAccounts.find((account) => account.id === id);
  if (!found) return { kind: 'unknown-account' };
  if (id === config.activeAccountId) return { kind: 'blocked', reason: 'active-account' };
  return { kind: 'ok', label: found.label };
}
