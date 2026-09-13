# Contrato — IPC do motor de contas (etapa 1)

Espelha o padrão de `src/shared/profiles.ts` (`PROFILE_CHANNELS`): o shared só
declara canais e DTOs; quem faz I/O é o main. **Nenhum DTO deste arquivo
carrega segredo** — `CredentialPair` não cruza o preload em hipótese alguma.

```ts
// src/shared/accounts.ts
export const ACCOUNT_CHANNELS = {
  list: 'accounts:list',                 // (options?: { force?: boolean }) => AccountsViewDto
  switch: 'accounts:switch',             // (id: AccountId) => SwitchOutcome
  getConfig: 'accounts:getConfig',       // () => AccountsConfigDto
  setConfig: 'accounts:setConfig',       // (patch: Partial<AccountsConfigDto>) => AccountsConfigDto
  connectMod: 'accounts:connectMod',     // (input: ConnectModInput) => ConnectModOutcome
  disconnectMod: 'accounts:disconnectMod', // () => AccountsConfigDto
  changed: 'accounts:changed',           // main -> renderer (push)
} as const;
```

## DTOs

```ts
export interface AccountsViewDto {
  readonly mod: ModId | null;
  readonly state: 'inert' | 'ready' | 'unavailable';
  readonly unavailableReason: 'offline' | 'unauthorized' | 'io' | null;
  readonly accounts: readonly AccountSummary[];
  readonly activeAccountId: AccountId | null;
  readonly autoSwitch: AutoSwitchPolicy;
  readonly lastReadAt: string | null;
}

/** Único ponto por onde segredo ENTRA (write-only, padrão T3). Nada aqui é
 *  devolvido em nenhum canal de leitura. */
export type ConnectModInput =
  | { readonly mod: 'seazone'; readonly baseUrl: string; readonly sessionRefreshToken: string }
  | { readonly mod: 'local'; readonly label: string; readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: number };

export type ConnectModOutcome =
  | { readonly kind: 'connected'; readonly config: AccountsConfigDto }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'vault-unavailable' | 'invalid-input' };
```

`vault-unavailable` = `safeStorage.isEncryptionAvailable()` retornou `false`.
Nesse caso o motor **recusa conectar** — não existe fallback em texto plano.

## Evento `accounts:changed`

Emitido pelo main quando: conta ativa muda (switch manual ou automático),
carga é relida, ou o estado passa a/deixa de ser `unavailable`. Payload =
`AccountsViewDto`. A UI nunca faz polling própria — só reage.

## Regras

1. Todo handler roda no main e nunca devolve `CredentialPair`, token, header
   de auth ou trecho deles.
2. `accounts:switch` chamado com o motor `inert` devolve
   `{ kind: 'failed', reason: 'io' }` — não há caminho implícito de ativação.
3. Nenhum canal de perfis (`PROFILE_CHANNELS.*`) é removido ou alterado na
   etapa 1 — a demolição é a etapa 2.

## Emenda — etapa 3, Fase 1: cadastro múltiplo (13/09/2026)

Devolve o gesto de cadastrar e remover (`plan-etapa-3.md` §4, Fase 1). Os canais
acima continuam valendo; o que mudou neles está em "Mudanças".

```ts
export const ACCOUNT_CHANNELS = {
  // ...os da etapa 1...
  removeAccount: 'accounts:removeAccount', // (id: AccountId) => RemoveAccountOutcome
  beginLogin: 'accounts:beginLogin',       // (label: string) => BeginLoginOutcome
  cancelLogin: 'accounts:cancelLogin',     // (loginId: string) => void
  loginChanged: 'accounts:loginChanged',   // main -> renderer (push): LoginStatusDto
} as const;

export type RemoveAccountOutcome =
  | { readonly kind: 'removed'; readonly config: AccountsConfigDto }
  | { readonly kind: 'blocked'; readonly reason: 'active-account' }
  | { readonly kind: 'failed'; readonly reason: 'unknown-account' | 'io' };

export type BeginLoginOutcome =
  | { readonly kind: 'started'; readonly loginId: string }
  | { readonly kind: 'failed'; readonly reason: 'invalid-input' | 'vault-unavailable' | 'login-in-progress' | 'io' };

export type LoginStatusDto =
  | { loginId: string; label: string; state: 'added'; accountId: AccountId }
  | { loginId: string; label: string; state: 'replaced'; accountId: AccountId; existingLabel: string }
  | { loginId: string; label: string; state: 'cancelled'; reason: 'user' | 'exited-without-login' | 'no-terminal' }
  | { loginId: string; label: string; state: 'failed'; reason: 'vault-unavailable' | 'io' };

// src/shared/index.ts
export interface PtyCreateOptions {
  // ...
  accountLoginId?: string; // só com sessionType 'claude'; mutuamente exclusivo com providerId
}

// LocalAccountMeta ganha:
fingerprint?: string | null; // sha256 do accountUuid — só em conta cadastrada por login isolado
```

### Mudanças em canais existentes

- `connectMod`, ramo `local`: `expiresAt?: number | null`. Ausente ou `null` grava
  `0` — validade desconhecida é tratada como vencida, e o mod local renova antes
  do primeiro uso (F2). Nunca mais um prazo chutado pelo renderer. O ramo
  `seazone` segue no tipo e no main, mas a UI não o oferece (pool Seazone fora,
  decisão do dono).
- `disconnectMod`: além de voltar a config ao default, apaga do cofre as
  credenciais das contas que saem da lista e `seazone:session` — nunca
  `provider:*`. A UI confirma antes, dizendo isso.
- `setConfig`, `connectMod`, `disconnectMod`, `removeAccount` e
  `migration:importCredentials`: mudança de `mod` ou da lista de contas
  reconstrói o motor vivo (F6, `AccountEngineHost`). Troca feita pelo próprio
  motor (auto-switch) é persistida em `activeAccountId` antes de qualquer
  reconstrução.

### Regras da emenda

4. Remover a conta **ativa** é recusado no main (`blocked/active-account`): o par
   dela vive no `~/.claude`, e sem `activeAccountId` a próxima troca não
   capturaria o par rotacionado. A UI só mostra a explicação.
5. Login isolado: `beginLogin` cria `<userData>/accounts-login-<uuid>/` (um login
   por vez; cofre indisponível recusa antes de criar). O renderer abre uma aba
   `claude` com `accountLoginId`; o main spawna o `claude` com `cwd` e
   `CLAUDE_CONFIG_DIR` nesse diretório, sem argv do launcher, sem hooks do
   semáforo e sem `--session-id`. Quando surge par válido em `.credentials.json`
   (esperando até 5 s pelo `oauthAccount` do `.claude.json`), o main grava o par
   no cofre, atualiza a config, encerra o PTY e só então apaga o diretório. O app
   nunca escreve na aba — nenhum `/logout` sai dele (`research-etapa-3-cli.md` A3).
6. Conta repetida: se o fingerprint do login já pertence a uma conta do pool, o
   par dela é **substituído** (mesmo id, mesmo rótulo) e o status é `replaced`.
   Contas cadastradas antes da Fase 1 não têm fingerprint; repetir uma delas cria
   linha nova, que se remove pelo painel.
7. Faxina no boot (`vault-reconciliation.ts`): só age com `mod === 'local'` e
   lista não vazia; remove id sem `:` não referenciado e `seazone:session`; nunca
   remove outra chave com `:`. Diretórios `accounts-login-*` deixados por um app
   fechado no meio do login também são apagados no boot. Os dois ficam
   registrados em `<userData>/accounts-maintenance.log`, só com nomes.
8. Nenhum DTO carrega segredo. O fingerprint é opaco e não é PII; pode voltar
   dentro de `LocalAccountMeta` pelos canais que devolvem a config, como o
   `AccountId`, mas nunca aparece em `LoginStatusDto`, log ou mensagem de erro.
