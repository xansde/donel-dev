# Spike T001 — Resultado: perfis/credenciais via `CLAUDE_CONFIG_DIR`

**Status:** concluído (sem login humano real — ver seção "Não verificado")
**Data:** 2026-07-23
**Ambiente:** Windows 11, `claude.exe` 2.1.218, `C:\Users\xansd\.local\bin\claude.exe`
**Perfil de teste:** `C:\Users\xansd\.claude-profiles\spike-test` (fica no disco como insumo do T014)

## Resumo executivo

Hipótese **CONFIRMADA**: `CLAUDE_CONFIG_DIR` isola login por perfil no Windows,
incluindo o `.claude.json` (achado do review que motivou o "passo crítico").
Com `CLAUDE_CONFIG_DIR` apontado para o perfil de teste, o CLI criou **dentro
do config dir do perfil** tanto `.claude.json` quanto `.credentials.json`
próprios — com `machineID`/`userID` diferentes dos globais e `oauthAccount`
ausente (perfil não autenticado) — e **nunca tocou** o `~/.claude.json` nem o
`~/.claude/.credentials.json` globais durante a execução do comando isolado.
Um comando `claude -p` não-autenticado no perfil retornou
`Not logged in · Please run /login` (exit code 1) em vez de usar
silenciosamente a sessão global já autenticada — evidência direta de que o CLI
não faz fallback para as credenciais globais quando `CLAUDE_CONFIG_DIR` está
setado.

Achado não previsto no plan: o `.claude.json` novo do perfil vem com
`mcpServers` **vazio** — a lista de MCP servers do usuário **não** é herdada
automaticamente; precisa ser semeada pelo `ProfileManager` (ver critério b).

Plano B (`HOME`/`USERPROFILE` por perfil) **não é necessário** — Plano A
(`CLAUDE_CONFIG_DIR` sozinho) já resolve o isolamento, incluindo o
`.claude.json`.

## Evidências (comandos + saídas relevantes)

### 1. Snapshot dos arquivos globais ANTES de qualquer teste

```
~/.claude.json          | Size=71595 | LastWriteTime=23/07/2026 00:58:25
~/.claude/.credentials.json | Size=3642 | LastWriteTime=23/07/2026 00:53:39
~/.claude/settings.json | Size=3503 | LastWriteTime=21/07/2026 14:30:37
~/.claude/CLAUDE.md     | Size=4206 | LastWriteTime=14/07/2026 12:09:35
```

Subdirs a linkar (mtime capturado antes): `projects`, `skills`, `commands`,
`rules`, `plugins`, `templates` — todos presentes e populados no `~/.claude`
real.

### 2. Criação do perfil de teste (fora do OneDrive)

```
New-Item -ItemType Directory -Force C:\Users\xansd\.claude-profiles\spike-test
```

Junctions via `cmd /c mklink /J` (sem admin, confirmado por exit code 0 nas 6
chamadas):

```
OK junction: projects
OK junction: skills
OK junction: commands
OK junction: rules
OK junction: plugins
OK junction: templates
```

`Get-ChildItem` no perfil mostrou `Attributes = Directory, ReparsePoint`,
`LinkType = Junction`, `Target` apontando para os dirs reais de `~/.claude`.
Verificação de conteúdo: `(Get-ChildItem "$profile\skills").Count` = 21,
idêntico a `(Get-ChildItem "~\.claude\skills").Count` = 21 — a junction
resolve para o conteúdo real, não uma cópia.

`Copy-Item settings.json, CLAUDE.md` para o perfil — confirmados presentes
com o mesmo tamanho/mtime da origem.

### 3. Versão do CLI

```
where.exe claude  → C:\Users\xansd\.local\bin\claude.exe
claude --version  → 2.1.218 (Claude Code)
```

`claude --version` com `CLAUDE_CONFIG_DIR` setado para o perfil **não criou
nenhum arquivo** no config dir do perfil (listagem antes/depois idêntica) —
é um comando estático que não toca o filesystem de config.

### 4. Comando não-interativo com CLAUDE_CONFIG_DIR isolado

Executado via `Start-Job` com timeout de 30s (para nunca travar em prompt
interativo de login):

```powershell
$env:CLAUDE_CONFIG_DIR = "C:\Users\xansd\.claude-profiles\spike-test"
claude -p "Responda apenas OK" --model haiku
```

**Saída:**
```
Not logged in · Please run /login
EXITCODE=1
```

Terminou dentro do timeout (não travou pedindo login interativo/OAuth
browser) — o CLI detecta a ausência de credencial no config dir isolado e
falha de forma limpa e não-interativa, sem tentar abrir fluxo de login nem
cair para a sessão global já autenticada.

### 5. Passo crítico — comportamento do `.claude.json` sob `CLAUDE_CONFIG_DIR`

**Antes do comando `-p`:** perfil não tinha `.claude.json` nem
`.credentials.json`. Global `.claude.json` = 71595 bytes / mtime 00:59:39.

**Depois do comando `-p`:** o perfil passou a ter, criados pelo próprio CLI
dentro do config dir do perfil:

```
.claude.json               1205 bytes  23/07/2026 01:00:24
.credentials.json            506 bytes  23/07/2026 01:00:24
mcp-needs-auth-cache.json     56 bytes  23/07/2026 01:00:24
backups/       (dir)
session-env/   (dir)
sessions/      (dir)
```

Checado imediatamente após o job (antes de qualquer outro comando): global
`.claude.json` ainda 71595 bytes / mtime 00:59:39 (**inalterado**); global
`.credentials.json` ainda 3642 bytes / mtime 00:53:39 (**inalterado**).

Conteúdo do `.claude.json` do perfil (chaves, sem valores sensíveis):
`firstStartTime, machineID, opusProMigrationComplete,
sonnet1m45MigrationComplete, seenNotifications,
hasResetAutoModeOptInForDefaultOffer, migrationVersion, userID, pluginUsage`.
Sem `oauthAccount` (consistente com "not logged in"). Sem `projects` (estado
de projetos confiados não vaza do global). **Sem `mcpServers`** (chave
ausente/vazia).

`machineID` do perfil (`c6796c26...`) é **diferente** do `machineID` global
(`e18e0a2d...`) — confirma que cada config dir gera identidade de máquina
própria, não reaproveita a global.

`pluginUsage` do perfil já lista os plugins instalados via marketplace
(`geral@seazone-skills`, `supabase@claude-plugins-official`,
`hookify@claude-plugins-official`, `dev@seazone-skills`,
`discovery@seazone-discovery`, `esteira@skills-dev-ai-ops-szi`) — herdados
corretamente através da junction `plugins` (catálogo compartilhado), sem
nenhuma cópia manual.

`.credentials.json` do perfil contém só a chave `mcpOAuth`, com uma entrada
de *client registration* para o MCP server `supabase` (`serverName,
serverUrl, clientId, clientSecret, redirectUri`) — **sem** `accessToken` nem
`refreshToken` preenchidos (campos vazios/ausentes, verificado por tamanho,
não por valor). É metadado de descoberta OAuth automática ao inicializar o
plugin, não um token de sessão vazado da conta global. Comparado à chave
equivalente no `.credentials.json` global (mesma string de chave
`plugin:supabase:supabase|4c994eebe4eb8533` também presente lá) — parece ser
um identificador determinístico do plugin, não algo copiado do perfil global.

**Conclusão do passo crítico:** SIM, com `CLAUDE_CONFIG_DIR` setado o CLI lê
e grava um `.claude.json` **dentro do config dir do perfil**, não o global.
O isolamento por env var fecha sozinho para identidade/login — não precisa de
Plano B.

### 6. Prova final — arquivos globais intocados pelo comando isolado

Checado no fim da sessão de testes (mesma sessão orquestradora, ver nota
abaixo sobre ruído):

```
global .claude.json:        Size=72159  LastWriteTime=01:01:44  (MUDOU)
global .credentials.json:   Size=3642   LastWriteTime=00:53:39  (inalterado)
global settings.json:       Size=3503   LastWriteTime=14:30:37  (inalterado)
global CLAUDE.md:            Size=4206   LastWriteTime=12:09:35  (inalterado)
```

`.claude.json` global cresceu de 71595 → 72159 bytes. **Isto não foi causado
pelo comando isolado do perfil** (checagem imediatamente antes/depois desse
comando específico mostrou 71595 bytes / 00:59:39 → 71595 bytes / 00:59:39,
sem mudança). A mudança ocorreu depois, entre 01:00:24 e 01:01:44, período em
que só rodaram outros comandos PowerShell de inspeção — não há mais nenhuma
chamada com `CLAUDE_CONFIG_DIR` setado nesse intervalo.

Causa raiz identificada: **esta própria sessão orquestradora é um processo
`claude` rodando sob o `~/.claude` global** e, como qualquer sessão do Claude
Code, atualiza seu próprio estado de telemetria/projeto ao longo do turno.
Confirmado por inspeção estrutural (sem imprimir segredos):
- `numStartups` = 21 (contador de sessões, incremento normal).
- `mcpServers` no global: mesmas 13 chaves de antes (`taskdex, slack,
  pipedrive, filesystem, github, google-workspace, bitwarden, obsidian, nekt,
  seazone-kb, data-lake-airbnb, sapron, mcp-spotsys-prod`) — **sem alteração
  estrutural**.
- `oauthAccount` ainda presente (verificado como booleano, não vazado).
- O mapa `projects` do `.claude.json` global ganhou/atualizou a entrada
  `C:/Users/xansd/seazone/donel-dev` (cwd desta própria sessão) com campos de
  bookkeeping normais (`allowedTools, mcpContextUris, mcpServers,
  hasTrustDialogAccepted, lastGracefulShutdown, ...`).

Ou seja: o crescimento é bookkeeping normal desta sessão de trabalho
(rodando como `claude` autenticado no perfil global, executando este próprio
spike), não uma modificação indevida nem um efeito do
`CLAUDE_CONFIG_DIR`/perfil de teste. `.credentials.json`, `settings.json` e
`CLAUDE.md` globais permaneceram byte-idênticos (mesmo tamanho e mtime) do
início ao fim.

Outros dirs globais com mtime alterado no período (`projects`, `session-env`,
`shell-snapshots`, `sessions`, `backups`) são pelo mesmo motivo — atividade
normal desta sessão orquestradora rodando como processo `claude`, não do
perfil de teste (que grava seu próprio estado dentro de
`.claude-profiles\spike-test\`, isolado, conforme item 5).

### 7. Estado final do perfil de teste (fica no disco para T014)

```
backups/        (dir, criado pelo CLI)
commands/       junction → ~/.claude/commands
plugins/        junction → ~/.claude/plugins
projects/       junction → ~/.claude/projects
rules/          junction → ~/.claude/rules
session-env/    (dir, criado pelo CLI)
sessions/       (dir, criado pelo CLI)
skills/         junction → ~/.claude/skills
templates/      junction → ~/.claude/templates
.claude.json               (criado pelo CLI, próprio do perfil)
.credentials.json          (criado pelo CLI, próprio do perfil, sem tokens reais)
CLAUDE.md                  (copiado manualmente)
mcp-needs-auth-cache.json  (criado pelo CLI)
settings.json               (copiado manualmente, mtime preservado — CLI não reescreveu)
```

Nenhuma credencial real foi gravada (login nunca aconteceu — ver seção
"Não verificado"), então não havia lixo sensível para remover. O perfil foi
deixado no disco como pediu o roteiro, servindo de insumo para T014.

## Resposta aos 4 critérios de saída

### (a) Isolamento de login — confirmado até onde dá sem login humano

Confirmado sem login real:
- Perfil isolado com `CLAUDE_CONFIG_DIR` **não** usa a sessão global já
  autenticada (retornou "Not logged in" em vez de responder "OK" —
  comprova que não há fallback silencioso para a conta principal).
- `machineID`/`userID` gerados são **diferentes** por perfil — identidade de
  instalação não é compartilhada.
- `.credentials.json` e `.claude.json` (incluindo `oauthAccount`) do perfil
  ficam fisicamente separados do global, dentro do config dir do perfil.
- Global `.credentials.json` permaneceu byte-idêntico do início ao fim —
  nenhum vazamento de token nessa direção.

**O que falta (passo humano):** rodar `/login` de verdade dentro do perfil
de teste com uma conta (idealmente uma conta de teste, não a do Alexandre)
e então confirmar simultaneamente que (i) o perfil de teste funciona
autenticado como essa conta e (ii) uma sessão paralela usando o `~/.claude`
global continua autenticada como a conta principal, sem os dois se
pisarem. Esse par de logins concorrentes é ato humano (login não é
automatizável) e não foi executado neste spike.

### (b) Comportamento do `.claude.json` sob `CLAUDE_CONFIG_DIR`

Confirmado: o CLI cria e usa um `.claude.json` **dentro** do config dir do
perfil (sibling do `.credentials.json` do perfil), nunca o `~/.claude.json`
global, quando `CLAUDE_CONFIG_DIR` está setado. Isso fecha a lacuna que
motivou o "passo crítico" do plan — Plano A é suficiente.

**Porém**, o `.claude.json` novo do perfil nasce com `mcpServers` **vazio** —
diferente do que o plan esperava implicitamente ("como manter `mcpServers`
iguais entre perfis"). Recomendação para o `ProfileManager` (T014):
1. Ao criar um perfil, ler o subtree `mcpServers` do `~/.claude.json` global
   e gravá-lo no `.claude.json` do perfil (merge, não pisando em
   `oauthAccount`/`machineID`/`userID` que o CLI já terá gerado no primeiro
   `claude --version`/primeira execução).
2. Como o `.claude.json` inteiro **não pode** ser hardlink/junction (carrega
   identidade — `oauthAccount`, `machineID`, `userID`, estado de projetos
   confiados — que precisa ser único por perfil), a sincronização de
   `mcpServers` tem que ser um **merge programático campo a campo**, não uma
   cópia de arquivo inteiro.
3. Rodar esse merge (a) na criação do perfil e (b) sob demanda quando o
   usuário adicionar/editar um MCP server globalmente (ou expor um botão
   "sincronizar MCPs" no `ProfileManager`/doctor).
4. Servidores MCP com OAuth próprio (ex.: `supabase`) vão pedir novo consent
   por perfil de qualquer forma — os `clientId/clientSecret` de descoberta
   observados no perfil de teste não substituem o consentimento do usuário.

### (c) Lista definitiva de dirs/arquivos a LINKAR vs COPIAR

**Linkar (junction, `mklink /J`, sem admin) — catálogo compartilhado,
validado neste spike:**
`projects`, `skills`, `commands`, `rules`, `plugins`, `templates`.

**Copiar (cada perfil tem sua própria cópia, sincronização gerenciada pelo
ProfileManager) — validado:**
- `settings.json` — copiado uma vez; CLI não o reescreveu durante este
  spike (mtime preservado), mas isso não foi testado numa sessão
  autenticada de verdade (onde aprovar um prompt de permissão poderia
  gravar em `settings.json`/`settings.local.json`). Ver critério (d).
- `CLAUDE.md` — mesmo tratamento.
- Subtree `mcpServers` dentro do `.claude.json` do perfil — precisa ser
  copiado/mesclado programaticamente pelo `ProfileManager` (achado novo,
  item b acima), não é coberto pelas junctions.

**Nunca tocar manualmente — o próprio CLI cria e gerencia dentro do config
dir do perfil, confirmado neste spike:**
`.claude.json` (exceto o merge de `mcpServers` acima), `.credentials.json`,
`mcp-needs-auth-cache.json`, `backups/`, `session-env/`, `sessions/`.

**Não verificado neste spike (a sessão falhou no gate de auth antes de
inicializar essas áreas) — revisitar no T014 com login real:**
`cache/`, `config/`, `debug/`, `docs/`, `downloads/`, `references/`,
`scheduled-tasks/`, `state/`, `tasks/`, `telemetry/`, `uploads/`,
`usage-data/`, `history.jsonl`, `frustration_log.md`,
`hookify.*.local.md`, `LESSONS.md`, `seazone-baseline.md`,
`squad-szi-baseline.md`. Hipótese de trabalho (não comprovada): a maioria
desses é estado/cache per-instalação que o CLI recria sozinho dentro do
config dir do perfil na primeira sessão autenticada completa (mesmo padrão
observado com `.claude.json`/`.credentials.json`/`sessions`/`backups`), e
`CLAUDE.md`/`*baseline.md`/`LESSONS.md` são conteúdo do usuário que faria
sentido linkar ou copiar como `settings.json`/`CLAUDE.md` — mas isso é
inferência, não evidência de filesystem.

### (d) Decisão sobre `settings.json`: cópia sincronizada, não hardlink

**Decisão: cópia sincronizada** (o que o roteiro interino do plan.md já
fazia com `Copy-Item`), não hardlink.

Razão: um hardlink (`mklink /H`, também sem admin em NTFS, mesmo volume)
faria qualquer escrita em um perfil aparecer instantaneamente no outro —
inclusive escritas que o próprio Claude Code faz durante uma sessão viva
(ex.: um "sempre permitir" em prompt de permissão persistido em
`settings.json`/`settings.local.json`). Isso quebraria a premissa de perfis
como contas independentes: uma ação no perfil B vazaria para o perfil A.
Não foi possível observar esse comportamento neste spike (a sessão nunca
chegou a ficar autenticada/interativa o suficiente para dar um prompt de
permissão), então a decisão é por precaução + consistência com o roteiro já
validado no plan, não por evidência direta de escrita concorrente.
Recomendação para o `ProfileManager`: copiar `settings.json`/`CLAUDE.md` na
criação do perfil e oferecer uma ação explícita "sincronizar do global"
(não automática/silenciosa), para não pisar em customizações que o usuário
tenha feito dentro do perfil.

## Não verificado

- **Login humano real** dentro do perfil de teste (`/login` interativo) —
  ato humano, fora do escopo automatizável deste spike. Sem ele, não dá
  para confirmar 100% que duas contas diferentes ficam autenticadas
  simultaneamente sem colisão (só que a ausência de credencial não faz
  fallback pra global, o que já é evidência forte na direção certa).
- Comportamento de `cache/, config/, debug/, docs/, downloads/, references/,
  scheduled-tasks/, state/, tasks/, telemetry/, uploads/, usage-data/,
  history.jsonl` e os `.md` de baseline/lessons dentro de um config dir de
  perfil **autenticado e em uso normal** — o `-p` de teste falhou no gate de
  auth antes de qualquer uma dessas áreas ser tocada.
- Se um MCP server real (ex.: `nekt`, `sapron`) funciona corretamente
  quando `mcpServers` é semeado manualmente no `.claude.json` de um
  perfil — não testado (exigiria perfil autenticado).
- Robustez das junctions sob interferência de antivírus/OneDrive — não
  testado ativamente (só inferido pelo path do perfil estar fora do
  OneDrive, como já era o caso do `~/.claude` real).
- Se `claude -p ... --model haiku` teria se comportado diferente com um
  modelo inválido/typo — irrelevant aqui pois falhou antes no gate de auth
  (ordem observada: auth é checado antes de resolver o modelo).

## Implicações para o T014 (ProfileManager)

1. **Confirma a arquitetura do plan** (junctions em `projects, skills,
   commands, rules, plugins, templates` + `CLAUDE_CONFIG_DIR` por perfil) —
   nenhuma mudança de abordagem necessária, Plano B descartado.
2. **Novo requisito não previsto no plan**: `ProfileManager.createProfile()`
   precisa, além das 6 junctions e cópia de `settings.json`/`CLAUDE.md`,
   fazer um **merge programático da chave `mcpServers`** do `.claude.json`
   global para dentro do `.claude.json` do perfil (que só existe depois da
   primeira execução do CLI no perfil — ou seja, a ordem tem que ser: criar
   junctions → copiar settings/CLAUDE.md → rodar `claude --version` uma vez
   no perfil pra ele gerar seu `.claude.json` esqueleto → só então
   injetar/mesclar `mcpServers`).
3. **`profile doctor`** (FR-005) deve verificar, além de "cada junction
   resolve pro alvo esperado": (i) `.claude.json` do perfil existe e tem
   `mcpServers` não-vazio quando o global tem servers configurados
   (detectar drift); (ii) `settings.json`/`CLAUDE.md` do perfil não
   divergiram silenciosamente do global além do esperado (oferecer
   "sincronizar", não sincronizar sozinho).
4. **Dropdown de perfis com % de quota** (`quota-axi` sob o
   `CLAUDE_CONFIG_DIR` do perfil, FR-012) deve funcionar sem mudança,
   já que `quota-axi` lê o mesmo tipo de arquivo de config/credenciais que
   este spike confirmou existir isolado por perfil — mas isso não foi
   testado diretamente aqui (quota-axi não foi invocado).
5. Como a sessão de teste falhou no gate de auth antes de inicializar
   `cache/`, `config/`, `state/`, `tasks/`, `telemetry/` etc., o T014 (ou um
   spike-002 pontual) deveria incluir pelo menos uma sessão real autenticada
   no perfil de teste para fechar a lista "não verificado" acima antes de a
   UI de perfis ser considerada definitivamente pronta — o `profile doctor`
   de fato não tem como validar tudo sem uma autenticação real acontecer ao
   menos uma vez.
