# Anatomia do código do claude-switcher

Type: research
Status: resolved

## Question

Como o `seazone-tech/claude-switcher-api` funciona por dentro: contrato da API
do pool (endpoints, auth), mecânica local do cliente (arquivos escritos, adoção
de conta sem reiniciar, política exata do auto-switch), e — decisivo — ONDE
acontece o refresh do token Anthropic (uso único): cliente ou servidor? O que
disso é portável quase direto para o main process (TypeScript) do Donel, o que
é reescrever, e o que só faz sentido com o servidor da Seazone?

## Answer

Código clonado e lido (research subagent, 04/08). Clone raso em scratchpad da
sessão (descartável).

### Arquitetura
- **Cliente** `client/claude_switcher_client/` — Python stdlib-only, ~4.250
  linhas: `api.py` (HTTP), `credentials.py` (.credentials.json/Keychain),
  `claude_state.py` (~/.claude.json), `oauth_login.py`, `scheduler.py`
  (systemd/launchd/schtasks, 619L), `commands.py` (855L), `daemon.py` (tick do
  heartbeat, 859L — o mais crítico).
- **Servidor** `src/claude_switcher_api/` — FastAPI + asyncpg + httpx, ~4.823
  linhas: `service.py` (core, 1.599L), `repository.py` (Postgres),
  `anthropic_client.py` (refresh OAuth Anthropic, 181L), `selection.py`
  (algoritmo, 17L).

### Contrato da API do pool
JWT Bearer (HS256, 15min) obtido de `sessionRefreshToken` (30 dias, em
`~/.claude-switcher/session.json`). Endpoints: `POST /auth/exchange|refresh|
revoke`, `GET /accounts` (label, plano, fiveHour/sevenDay/sonnetUtil,
available), `POST /accounts` (adicionar conta ao pool), `POST /session/switch`
(devolve tokens da conta nova), `POST /session/heartbeat` (sincroniza tokens).

### Mecânica local
- Escreve `~/.claude/.credentials.json` (ou Keychain no macOS) e apaga o bloco
  `oauthAccount` de `~/.claude.json` a cada switch — é ISSO que faz o Claude
  Code adotar a conta nova sem reiniciar (a ausência força re-fetch).
- Heartbeat: agendador do SO a cada 15min → `daemon.run_tick()` →
  `POST /session/heartbeat`.
- Auto-switch (`daemon.py` ~601-674): troca quando carga (max de
  fiveHour/sevenDay/sonnet) ≥ **90.0** E existe conta com folga ≥ **20.0**
  pontos; seleção power-of-two-choices; limiar espelhado no servidor.

### Renovação do token — o fato decisivo
**O refresh do token Anthropic acontece no SERVIDOR**
(`anthropic_client.py::refresh_access_token` → `POST
platform.claude.com/v1/oauth/token`, client_id público). O cliente nunca fala
com a Anthropic — só repassa ao servidor o par de tokens que o próprio CLI
rotacionou localmente. Há ainda um "monitor de contas" externo (produto
separado) que refresca tokens do pool na cadência própria, coordenado por
`refresh_owner`/`token_version`. **Logo: (1) clone só do cliente não renova
token sozinho; (2) um switcher local que renovasse tokens do pool Seazone
colidiria com esse monitor — confirmado o risco levantado na entrevista.**

### Reuso para o main process (TypeScript)
- **(a) Porta quase direto**: selection (power-of-two), limiares do
  auto-switch, `_needs_refresh` (buffer de expiração), timefmt.
- **(b) Reescrever com algoritmo aproveitado**: credentials (merge + write
  0600), claude_state (limpar `oauthAccount`), keychain → `safeStorage`/
  `keytar`, scheduler → `setInterval` interno do Electron (elimina 619L),
  oauth_login → `shell.openExternal` + loopback.
- **(c) Irrelevante sem o servidor Seazone**: repository, auth Google,
  coordenação refresh_owner/token_version, slack, ratelimit, migrations.
- **Estimativa**: 2–4 dias para (a)+(b) em modelo single-user. Para contas
  PRÓPRIAS (não pool compartilhado), o refresh Anthropic pode ser
  reimplementado direto no main process (mesma chamada HTTP, client_id
  público), zerando a dependência de backend — perdendo só a coordenação
  anti-colisão entre máquinas, que só importa em pool compartilhado.
