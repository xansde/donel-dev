# Research — etapa 3: como o CLI guarda a credencial OAuth

> Insumo do gate da Fase 0 (`plan-etapa-3.md` §4), 13/09/2026. Leitura estática
> do binário `claude.exe` **2.1.270** (Windows, `~/.local/bin`) por busca de texto
> no bundle JS embutido — nenhum arquivo de credencial foi lido. **Não substitui
> o gate**: é a previsão que o teste manual confirma ou derruba.

## Achados

| # | Pergunta | Achado | Confiança |
|---|---|---|---|
| A1 | O processo relê `.credentials.json`? | Não a cada request: o par fica em cache por processo. Só relê o disco (a) num **401** — adota o token do disco se for outro e não vencer em ≤5 min (`tengu_oauth_401_recovered_from_disk`); (b) ao **renovar** o próprio token (≤5 min do `expiresAt`) — a gravação é compare-and-swap pelo `refreshToken`: se o disco mudou, descarta o que renovou e adota o disco (`tengu_oauth_refresh_compromised_cas_adopted_sibling`); (c) em login/logout | Alta — (a) e (b) conferidos no binário |
| A2 | Há checagem por mtime do arquivo? | Existe fingerprint `dev:ino:size:mtime`, mas só no backend novo de secure storage, atrás de flag; o backend `plaintext` (o do Windows) não o usa | Média-baixa |
| A3 | `/logout` só apaga local? | **Não.** Revoga o refresh token no servidor (`POST ${TOKEN_URL}/revoke`, `token_type_hint: "refresh_token"`) e depois apaga local; falha de rede não impede o logout local | Alta — chamada de revogação conferida no binário |
| A4 | De onde vêm `/usage` e `/status`? | `/usage` chama `api/oauth/usage` com o token **em memória** — mostra a conta que o processo usa de fato. `/status` lê `oauthAccount` da config (`~/.claude.json`), que tem cache próprio | Alta (`/usage`), média (`/status`) |
| A5 | O CLI vigia `~/.claude.json`? | Sim — push ou `fs.watchFile`: edição externa é recarregada, e as escritas do CLI são patch sobre o estado recarregado. Janela de corrida residual não descartada | Alta / média |
| A6 | `CLAUDE_CONFIG_DIR` vazio + `/login` | Grava `.credentials.json` **e** `.claude.json` dentro do diretório, salvo o override `CLAUDE_SECURESTORAGE_CONFIG_DIR` (as sessões do Donel não o definem) | Alta |

## Previsão para o gate

Sessão viva com o token da conta A ainda válido, depois de o arquivo passar a ter o
par da conta B: a próxima mensagem **ainda usa A**. Ela só passa a B quando o token
de A chega a ≤5 min do vencimento (renovação → CAS adota o disco) ou quando leva um
401. Sessão **nova** nasce em B.

Se o gate confirmar, "trocar sem reiniciar" vale na **próxima renovação do token da
sessão**, não na próxima mensagem — e o plano muda de forma (§4, Fase 0,
"Reprovou").

## Consequências já aplicadas à Fase 0

1. **Cadastro por login isolado** (`CLAUDE_CONFIG_DIR` por conta), não `/logout` →
   `/login` + cópia: por A3, cada `/logout` revogaria no servidor o par que acabou de
   ser copiado — as contas entrariam no cofre com o refresh token já revogado.
2. **A evidência do gate é o `/usage`** (A4), cruzado com a carga de cada conta no
   painel; o `/status` fica como registro secundário.
