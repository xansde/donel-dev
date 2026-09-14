# Contrato — interface de mod de contas (etapa 1)

Arquivo de destino: `src/main/accounts/account-mod.ts` (tipos) e
`src/main/accounts/account-engine.ts` (orquestrador).

A interface abaixo é **extraída dos dois mods concretos** (Seazone e local),
nunca desenhada em abstrato — guard-rail do discovery `[T-3]`. Método que só um
dos dois precisa é `opcional` e o motor testa a presença antes de chamar.

```ts
export interface AccountMod {
  readonly id: ModId;

  /** Lista as contas do backend com carga. Nunca lança: erro vira o estado
   *  `unavailable` (C9). */
  listAccounts(): Promise<ListAccountsResult>;

  /** Deixa a conta `id` como a credencial vigente do CLI. NÃO escreve em
   *  disco — devolve o par para o motor aplicar (única escrita de credencial
   *  do sistema fica no `claude-state.ts`). */
  switchTo(id: AccountId): Promise<SwitchToResult>;

  /** Persiste o par que o CLI rotacionou para a conta que está saindo.
   *  Seazone: repassa ao servidor deles. Local: grava no cofre. */
  captureRotatedPair(id: AccountId, pair: CredentialPair): Promise<void>;

  /** OPCIONAL — só o mod Seazone implementa (heartbeat de 15 min, C3).
   *  O mod local não implementa: switch-time-only é decisão fechada. */
  keepAlive?(): Promise<void>;
}

export type ListAccountsResult =
  | { readonly kind: 'ok'; readonly accounts: readonly AccountSummary[] }
  | { readonly kind: 'unavailable'; readonly reason: 'offline' | 'unauthorized' | 'io' };

export type SwitchToResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'failed'; readonly reason: 'unauthorized' | 'offline' | 'expired-credentials' | 'unknown-account' };
```

## Responsabilidades — quem faz o quê

| Passo do switch | Quem |
|---|---|
| Decidir que é hora de trocar (90/20) | `auto-switch.ts` (puro) |
| Verificar se há sessão ocupada (C5) | `account-engine.ts`, lendo o semáforo |
| Ler o par vigente do disco antes de sobrescrever | `account-engine.ts` → `claude-state.ts` |
| Guardar o par rotacionado | `mod.captureRotatedPair` |
| Obter o par da conta que entra | `mod.switchTo` |
| Escrever `.credentials.json` + apagar `oauthAccount` | `claude-state.ts` (**única** escrita de credencial) |
| Renovar token expirado | **só** `local-mod`: no switch (fallback) e, desde a Fase 2 da etapa 3, na leitura de carga de conta **parada** (nunca a ativa; uma renovação por conta de cada vez). Mod Seazone **nunca** renova `[T-2]` |

## Invariantes que todo mod deve honrar

1. **Nunca** devolve segredo em erro, log ou telemetria.
2. `listAccounts()` nunca lança — falha é `unavailable`.
3. `switchTo()` não escreve em `~/.claude*`; só o motor escreve.
4. Nenhum mod cria agendador de SO; qualquer periodicidade é timer do
   processo vivo (C3).
5. Mod é módulo **in-repo** do main process, escolhido por config. Não há
   carregamento de código externo.

## Testes de contrato

`tests/accountModContract.test.ts` roda a mesma bateria contra os dois mods,
com HTTP e cofre falsos: as 5 invariantes acima + os shapes de retorno. Um mod
novo (etapa 3 em diante) passa a valer quando entra nessa bateria.
