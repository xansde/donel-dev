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
