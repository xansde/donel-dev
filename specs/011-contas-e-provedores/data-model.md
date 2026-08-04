# Modelo de dados — 011, etapa 1 (motor de contas + mods)

Todos os tipos abaixo são da **etapa 1**. Tipos puros (sem I/O) moram em
`src/shared/accounts.ts`; tipos que só o main conhece (par de credenciais)
**nunca** cruzam o preload.

## 1. Entidades de domínio (compartilhadas — `src/shared/accounts.ts`)

### `AccountId`

```ts
export type AccountId = string; // opaco, estável dentro de um mod
```

LGPD (C8): id opaco + `label` livre. **Nunca** e-mail, nunca nome de pessoa.

### `AccountLoad`

Carga de uma conta, nas janelas que o auto-switch usa.

```ts
export interface AccountLoad {
  /** 0–100, "% consumido" (não é o headroom da spec 002, que é % livre). */
  readonly fiveHour: number | null;
  readonly sevenDay: number | null;
  readonly sonnet: number | null;
  /** ISO-8601 da leitura; usado para expirar em cache. */
  readonly readAt: string;
}
```

Invariante: `overallLoad(load) = max(fiveHour, sevenDay, sonnet)` ignorando
`null`; se as três forem `null`, a carga é **desconhecida** e a conta não é
candidata a destino de auto-switch (C9).

### `AccountSummary`

O que a UI vê. **Nunca** carrega segredo.

```ts
export interface AccountSummary {
  readonly id: AccountId;
  readonly label: string;
  readonly plan: string | null;
  readonly active: boolean;
  readonly available: boolean;
  readonly load: AccountLoad | null;
}
```

### `ModId` / `AccountsConfig`

```ts
export type ModId = 'seazone' | 'local';

export interface AutoSwitchPolicy {
  readonly enabled: boolean;
  readonly switchAtLoad: number;   // default 90
  readonly minAdvantage: number;   // default 20
}

export interface AccountsConfig {
  /** `null` = motor inerte; comportamento de hoje intocado (C2). */
  readonly mod: ModId | null;
  readonly autoSwitch: AutoSwitchPolicy;
  /** Alvo das escritas do switch; default `~/.claude` (C1). */
  readonly claudeHome: string | null;
  readonly seazone: { readonly baseUrl: string } | null;
  /** Metadado NÃO sensível do pool próprio. Segredo mora no cofre. */
  readonly localAccounts: readonly { readonly id: AccountId; readonly label: string; readonly plan: string | null }[];
  readonly activeAccountId: AccountId | null;
}
```

Persistência: chave `accounts` do `config.json` (`userData`), com
`sanitizeAccountsConfig` no mesmo padrão resiliente dos demais blocos do
`config-store.ts` (nunca lança para config ausente/corrompida).

### `SwitchOutcome`

```ts
export type SwitchOutcome =
  | { readonly kind: 'switched'; readonly from: AccountId | null; readonly to: AccountId }
  | { readonly kind: 'already-active'; readonly account: AccountId }
  | { readonly kind: 'deferred'; readonly reason: 'session-busy' }        // C5
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'io' };
```

`failed.expired-credentials` é o caso "conta meses sem uso" da spec: o mod
local tentou o refresh de fallback e ele foi recusado → pede re-login uma vez.

## 2. Entidades só do main (nunca cruzam o preload)

### `CredentialPair`

```ts
interface CredentialPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;   // epoch ms
  readonly scopes: readonly string[];
}
```

Regras duras: nunca serializado para o renderer, nunca em log (nem truncado),
nunca em mensagem de erro. Só o mod local e o cofre o manipulam.

### `VaultRecord`

```ts
interface VaultRecord {
  readonly version: 1;
  /** accountId -> par cifrado; `seazone:session` guarda o sessionRefreshToken (C11). */
  readonly entries: Readonly<Record<string, string /* base64 do safeStorage */>>;
}
```

Arquivo: `<userData>/accounts-vault.json`, escrita atômica (temp + rename),
permissão 0600 onde o SO suportar. Cifrado por `safeStorage.encryptString`.
Se `safeStorage.isEncryptionAvailable()` for `false`, o cofre **recusa
gravar** — não existe degradação para texto plano.

### `ClaudeCredentialsFile` / `ClaudeStateFile`

Espelham os arquivos do CLI:

- `~/.claude/.credentials.json` — recebe o par da conta que entra (merge
  preservando chaves desconhecidas; escrita atômica, 0600).
- `~/.claude.json` — tem o bloco `oauthAccount` **removido** a cada switch
  (é o que força o CLI a re-fetch, `[T-2]`). Todas as demais chaves são
  preservadas byte a byte.

## 3. Estados e transições do motor

```
inerte (mod=null)
   │ operador escolhe mod + credencial válida
   ▼
pronto ──listAccounts()──► pronto (carga atualizada)
   │                          │ carga(ativa) ≥ 90 e existe folga ≥ 20
   │ switchTo(id)             ▼
   ├────────────────────► avaliando auto-switch
   │                          │ alguma sessão ocupada → deferred (C5)
   ▼                          ▼
capturando par rotacionado ─► escrevendo credencial ─► apagando oauthAccount ─► pronto
   │
   └── falha em qualquer passo → indisponível (auto-switch pausado, C9)
```

Invariante de segurança: a ordem
`captureRotatedPair → write .credentials.json → strip oauthAccount`
nunca é invertida — inverter perde o par rotacionado da conta que sai e a
conta fica órfã de credencial válida.
