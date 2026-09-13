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

## Previsão para o gate (falhou — ver o resultado abaixo)

Sessão viva com o token da conta A ainda válido, depois de o arquivo passar a ter o
par da conta B: a próxima mensagem **ainda usa A**. Ela só passa a B quando o token
de A chega a ≤5 min do vencimento (renovação → CAS adota o disco) ou quando leva um
401. Sessão **nova** nasce em B.

Se o gate confirmar, "trocar sem reiniciar" vale na **próxima renovação do token da
sessão**, não na próxima mensagem — e o plano muda de forma (§4, Fase 0,
"Reprovou").

## Resultado do gate (13/09, ~15:10) — a sessão viva adotou na mensagem seguinte

Medido no Donel Dev Beta 0.3.2 com o CLI 2.1.270, pelo roteiro de `plan-etapa-3.md`
§4 (Fase 0). Troca da conta 3 (a do `~/.claude`) para a Interno 1 (conta 1):

- **A mesma aba passou para a conta nova na mensagem seguinte.** O `/usage` foi de
  `4%` sessão / `45%` semana (reset 17/09 09:00) para `0%` / `14%` (reset 18/09
  06:00). A janela semanal é outra, então a conta é outra. A request pós-troca teve
  **1 miss** do prompt cache, que é por organização — coerente com a inferência já
  sair pela conta nova, não só o `/usage`.
- **A previsão de A1 estava errada:** o token não ficou preso em memória até a
  renovação. O mecanismo exato ainda não foi lido no código. Candidatos: o watcher do
  `~/.claude.json` (A5) reagindo à remoção de `oauthAccount`, ou o fingerprint de A2
  ativo também no backend `plaintext`. Enquanto isso não for esclarecido, **a remoção
  de `oauthAccount` (passo 3 de `applyAccountSwitch`) conta como parte da troca que
  funcionou**, não como detalhe dispensável.
- **O `/status` do CLI fica errado logo depois da troca:** mostrou `Login method:
  Claude API account`, sem organização nem e-mail — efeito da remoção de
  `oauthAccount`. Cerca de 2 min depois, uma sessão viva refez o fetch do perfil e o
  `~/.claude.json` voltou a ter `oauthAccount`, já da conta nova.
- **Sessão nova nasce na conta nova**, e o MCP seguiu conectado na aba que trocou
  (`/status`: os mesmos 11 servidores conectados antes e depois).

## Consequências já aplicadas à Fase 0

1. **Cadastro por login isolado** (`CLAUDE_CONFIG_DIR` por conta), não `/logout` →
   `/login` + cópia: por A3, cada `/logout` revogaria no servidor o par que acabou de
   ser copiado — as contas entrariam no cofre com o refresh token já revogado.
2. **A evidência do gate é o `/usage`** (A4), cruzado com a carga de cada conta no
   painel; o `/status` fica como registro secundário.
