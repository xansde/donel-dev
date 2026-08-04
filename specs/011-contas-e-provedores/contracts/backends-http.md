# Contrato — backends HTTP consumidos na etapa 1

Nenhum destes endpoints é servido pelo Donel; todos são **consumidos**. Nenhum
segredo aparece em log. Timeouts curtos (10 s) e falha sempre degradando para
`unavailable` (C9).

## A. API do claude-switcher (mod Seazone) `[T-2]`

Base URL configurável (`accounts.seazone.baseUrl`). Auth: JWT Bearer (HS256,
15 min) obtido a partir do `sessionRefreshToken` (30 dias, guardado no cofre —
C11).

| Método | Rota | Uso na etapa 1 |
|---|---|---|
| `POST` | `/auth/exchange` | Troca o `sessionRefreshToken` pelo JWT curto |
| `POST` | `/auth/refresh` | Renova o JWT curto quando expira |
| `POST` | `/auth/revoke` | Desconectar o mod (gesto do operador) |
| `GET` | `/accounts` | `listAccounts()` — label, plano, `fiveHour`/`sevenDay`/`sonnetUtil`, `available` |
| `POST` | `/session/switch` | `switchTo()` — devolve o par da conta nova |
| `POST` | `/session/heartbeat` | `keepAlive()` — sincroniza o par rotacionado |

**Não consumidos na etapa 1**: `POST /accounts` (adicionar conta ao pool —
gesto administrativo deles). O mod **nunca** chama `platform.claude.com` —
renovação de token de conta do pool é do servidor deles, e há monitor externo
com `refresh_owner`/`token_version`; renovar aqui colide (refresh token de uso
único).

## B. Endpoints Anthropic (mod local — pool próprio) `[T-3]`

| Método | Endpoint | Uso |
|---|---|---|
| `GET` | `api.anthropic.com/api/oauth/usage` | Carga por conta (janelas 5h/7d diretas), com o access token daquela conta |
| `POST` | `platform.claude.com/v1/oauth/token` | **Só fallback**: par vencido na hora do switch (`grant_type=refresh_token`, client_id público) |

Regras duras:

- O refresh é **sob demanda, no switch** — nunca periódico, nunca com o app
  fechado.
- Um refresh consome o refresh token (uso único): o par novo é gravado no
  cofre **antes** de ser usado; falha de gravação aborta o switch (perder o
  par novo deixa a conta inacessível).
- Recusa do refresh → `expired-credentials`: a UI pede re-login **uma vez**
  para aquela conta. Consequência aceita na spec.
- O mod local só opera contas **próprias** do dono. Conta do pool Seazone
  jamais é registrada nele.

## C. Arquivos do CLI escritos pelo motor `[T-2]`

| Arquivo | Operação |
|---|---|
| `<claudeHome>/.credentials.json` | Merge do par novo preservando chaves desconhecidas; escrita atômica; 0600 |
| `~/.claude.json` | Remoção do bloco `oauthAccount`; demais chaves preservadas |

As duas escritas, nessa ordem, **são** o switch: sem apagar `oauthAccount` o
CLI não re-fetcha e a troca não tem efeito na sessão viva.
