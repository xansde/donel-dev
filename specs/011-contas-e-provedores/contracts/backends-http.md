# Contrato — backends HTTP consumidos na etapa 1

Nenhum destes endpoints é servido pelo Donel; todos são **consumidos**. Nenhum
segredo aparece em log. Timeouts curtos (10 s) e falha sempre degradando para
`unavailable` (C9).

## A. API do claude-switcher (mod Seazone) `[T-2]`

Base URL configurável (`accounts.seazone.baseUrl`). Auth: JWT Bearer (HS256,
15 min) obtido a partir do `sessionRefreshToken` (30 dias, guardado no cofre —
C11).

> **CORRIGIDO em 04/08/2026 contra a API real.** A tabela anterior foi escrita
> a partir da leitura do servidor, sem nunca ser exercitada, e errava em quatro
> pontos — cada um deles bastava para o mod não funcionar. O primeiro contato
> real devolveu `422` e chegou à tela como "backend indisponível (offline)".
> O que estava escrito antes está registrado em `captura-visual-etapa-1.md`.

| Método | Rota | Uso na etapa 1 | Corpo enviado | Resposta |
|---|---|---|---|---|
| `POST` | `/auth/refresh` | Troca **e** renova o JWT a partir do `sessionRefreshToken` | `{sessionRefreshToken}` | `{accessJwt, sessionRefreshToken, actorEmail, sessionExpiresAt, minimumClientVersion}` |
| `POST` | `/auth/exchange` | **NÃO usado pelo mod** — é o exchange do OAuth Google | `{code, redirect_uri}` | idem acima |
| `POST` | `/auth/revoke` | Desconectar o mod (gesto do operador) | `{sessionRefreshToken}` | `{revoked}` |
| `GET` | `/accounts` | `listAccounts()` | — | **lista no topo** de `{label, plan, fiveHourUtil, sevenDayUtil, sonnetUtil, available, unavailableReason}` |
| `POST` | `/session/switch` | `switchTo()` — devolve o par da conta nova | `{account, currentAccount?}` | `{label, accessToken, refreshToken, expiresAt}` |
| `POST` | `/session/heartbeat` | Sincroniza o par rotacionado (`captureRotatedPair`) | `{accessToken, refreshToken, expiresAt (ISO), label?}` | `{accessToken, refreshToken, expiresAt}` |

As quatro divergências, porque cada uma falha de um jeito diferente:

1. **A rota de auth** era `/auth/exchange`; é `/auth/refresh`. Falha ruidosa (422).
2. **O JWT** vinha em `jwt`; vem em `accessJwt`. Falharia mesmo com a rota certa.
3. **`/accounts`** devolve **lista**, não `{accounts: […]}`; e o identificador da
   conta é o **`label`** — não existe campo `id`.
4. **A carga** está em `fiveHourUtil`/`sevenDayUtil`, não `fiveHour`/`sevenDay`.
   Esta é a silenciosa: as contas apareceriam com carga `null`, e carga
   desconhecida nunca é destino de auto-switch (C9) — o recurso ficaria inerte
   sem nada na tela explicando.

Duas regras que a API impõe e o contrato não registrava:

- **`/auth/refresh` pode rotacionar o `sessionRefreshToken`** — a resposta traz
  um token novo, e não regravá-lo no cofre mata a sessão na chamada seguinte.
- **`expiresAt` do heartbeat é ISO-8601**, não epoch ms. O cliente oficial
  documenta que mandar o int cru fazia *todo* tick responder 422, o par
  rotacionado nunca chegava ao pool e os switches seguintes davam 403.

`minimumClientVersion` (hoje `0.4.1`) vem em toda resposta de auth e o mod
**ignora** — fora do escopo da etapa 1, mas é contrato pendente.

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
