---
tema: mesma-conta-dois-pcs
plano: docs/planos/pool-contas.pda.md
item: 01 — A mesma conta em dois PCs: o que o refresh e o CLI permitem
data: 2026-10-27
taskdex: []  # Donel Dev roda sem TaskDex (ferramenta pessoal)
fontes-consultadas: [repos-locais, externas]
---

# Pesquisa: a mesma conta em dois PCs

## Pergunta

Com a mesma conta Claude (assinatura, login OAuth do CLI) usada em dois PCs, o que acontece de fato?
(a) Renovar o refresh token invalida o anterior na hora, ou há janela de tolerância ou reuso?
(b) Um mesmo access token vale ao mesmo tempo nas duas máquinas?
(c) O CLI renova sozinho o token da conta ativa, fora do app? Com que gatilho e com que frequência? Ele relê o
`.credentials.json` do disco antes de renovar, e usa o par novo se o arquivo foi trocado por fora?
(d) A Anthropic aceita dois logins independentes da mesma conta, cada PC com sua cadeia de tokens? Um login novo derruba o
outro?

O que se busca são fatos que alimentem o item 04 (sincronização). A arquitetura fica fora desta pesquisa.

## Resposta (gist)

O CLI 2.1.311 renova a credencial só quando precisa, sem timer na sessão interativa. A renovação acontece quando o token
está a 5 minutos de vencer, antes de uma request, ou depois de um 401. Antes de renovar, o CLI relê o
`.credentials.json`, adota o par que encontrar trocado por fora e coordena os processos com um lock de arquivo que vale
só para a máquina local. Se o refresh volta `invalid_grant`, o CLI apaga a credencial do disco. A rotação é tratada como
uso único: o lado cliente e os relatos públicos mostram isso. A janela de tolerância no servidor e a coexistência de
dois logins da mesma conta ficaram sem prova, porque só um experimento com credencial real fecharia essas duas.

## Achados

Marcação: **VERIFICADO** quer dizer lido na fonte citada. **INFERIDO** quer dizer dedução a partir de fontes
verificadas, com o raciocínio exposto. Minificados do binário (`Fu`, `SR`...) mudam entre builds. A âncora estável é o
nome do evento de telemetria (`tengu_*`) ou a string literal. Os offsets são do `~/.local/bin/claude.exe` 2.1.311
(`claude --version` em 27/10/2026), lidos por extração estática de texto. Nenhum arquivo de credencial foi aberto.

### (a) Rotação do refresh token e tolerância

- **VERIFICADO.** O refresh do CLI é `POST ${TOKEN_URL}` com `grant_type: "refresh_token"`, `refresh_token`,
  `client_id` e `scope`, sem nenhum cabeçalho de prova de posse (DPoP). A resposta é lida como
  `{access_token, refresh_token: j = e, expires_in}`: se o servidor **não** devolver `refresh_token`, o CLI segue com
  o antigo. O cliente aceita os dois modos, com e sem rotação. **Fonte:** `claude.exe` 2.1.311, função de refresh
  perto do evento `tengu_oauth_token_refresh_success` (offset ~248.385.343).
- **VERIFICADO.** A resposta também pode trazer `refresh_token_expires_in`, e o CLI grava `refreshTokenExpiresAt`. O
  refresh token tem validade própria. A documentação oficial diz que, a 3 dias do vencimento do login, o CLI avisa
  "Your login expires in 3 days · run /login to renew" e que, vencido sem renovação possível, toda request falha com
  `Login expired`. **Fonte:** binário, mesmo trecho; https://code.claude.com/docs/en/authentication (seção "Renew an
  expiring login"), acesso em 27/10/2026.
- **VERIFICADO.** O CLI classifica como "token morto" o erro `invalid_grant` em 400/401 (`vq`). Nesse caso marca o
  refresh token como morto (`tengu_oauth_refresh_token_marked_dead_invalid_grant`) e **apaga do disco**
  `refreshToken`, `accessToken` e `expiresAt` (`tengu_oauth_refresh_token_cleared_on_disk`). Só apaga se o disco
  ainda tiver o mesmo refresh token que falhou. As mensagens de servidor que o CLI conhece incluem
  `"Refresh token expired"` e `"Refresh token not found or invalid"`. **Fonte:** binário, offsets ~248.396.681 (`vq`)
  e ~248.634.487 (limpeza do disco).
- **VERIFICADO.** Antes de concluir que o token morreu, o CLI relê o disco. Se o access token mudou nesse meio-tempo,
  conta como sucesso (`tengu_oauth_token_refresh_race_recovered`) e não apaga nada. **Fonte:** binário, ~248.652.838.
- **VERIFICADO (relato de terceiros, não oficial).** Quatro issues públicas fechadas (#24317, #43392, #48786, #80585) e
  duas abertas (#102985, #103325) descrevem o mesmo padrão. Dois processos enviam o mesmo refresh token, o segundo
  recebe `invalid_grant` e o login é apagado. Os autores chamam o token de "single-use" por observação. Nenhum
  funcionário da Anthropic confirma nos trechos lidos. A #102985 pede "a grace period / reuse tolerance for the previous
  refresh token", ou seja, quem relata não observou tolerância. **Fonte:**
  https://github.com/anthropics/claude-code/issues/103325, /102985, /43392, /80585 (acesso em 27/10/2026).
- **VERIFICADO (no repo, observação de uso).** O PR #115 registra que, depois de o CLI rotacionar o par da conta
  ativa, o refresh token antigo que ficou no cofre "voltava recusada ('Reconectar')" na renovação seguinte. É prova
  de recusa do token antigo **horas** depois da rotação. Não diz nada sobre segundos. **Fonte:** commit `4a95215`
  (mensagem); `src/main/accounts/account-engine.ts:338`.
- **VERIFICADO (norma, não comportamento da Anthropic).** Pela RFC 9700 §4.14.2, servidor com cliente público deve
  usar refresh token com restrição de remetente ou com rotação. Na rotação, quando um token já invalidado é
  apresentado, o servidor "cannot determine which party submitted the invalid refresh token" e revoga o refresh token
  ativo (revogação da família). **Fonte:** https://www.rfc-editor.org/rfc/rfc9700.html §4.14.2 (acesso em 27/10/2026).
  O `client_id` do CLI é público: `src/main/accounts/token-refresh.ts:23-24`.
- **INFERIDO.** A Anthropic rotaciona o refresh token a cada renovação e recusa o antigo. Base: PR #115, as issues e a
  premissa da ADR 0001 (`docs/adr/0001-motor-de-contas-e-mods.md:35-40`), que veio dos tickets do claude-switcher e não
  de teste próprio (`specs/011-contas-e-provedores/research.md:52-55`). **Não há prova** de janela de tolerância de
  segundos, nem prova de que reusar o token antigo derrube a família inteira, como permite a RFC 9700.

### (b) O mesmo access token em duas máquinas ao mesmo tempo

- **VERIFICADO.** As requests do CLI à API mandam o access token só como `Authorization: Bearer <token>`, sem prova
  de posse. O DPoP que existe no binário pertence ao SDK da AWS (credencial de login AWS com `dpopKey`) e não ao
  OAuth do claude.ai. **Fonte:** binário, `auth==="claude-ai-oauth"` → `Authorization: Bearer` (~248.888.000); trecho
  `generateDpop` / `loadToken` com `dpopKey` junto de `AWS_LOGIN_CACHE_DIRECTORY`.
- **VERIFICADO (no repo).** Hoje o app já usa, de **outro processo**, o access token que o CLI mantém no
  `~/.claude`: lê a carga da conta ativa com o par vivo, ao mesmo tempo que o CLI usa o mesmo token. **Fonte:**
  `src/main/accounts/mods/local-mod.ts:253-265`.
- **VERIFICADO (doc oficial).** O `claude setup-token` gera um token OAuth de um ano que "does not save the token
  anywhere". A instrução é configurá-lo como `CLAUDE_CODE_OAUTH_TOKEN` "wherever you want to authenticate". **Fonte:**
  https://code.claude.com/docs/en/authentication, seção "Generate a long-lived token" (acesso em 27/10/2026).
- **INFERIDO.** Um access token válido funciona nos dois PCs ao mesmo tempo até vencer. O cliente não amarra o token à
  máquina, e o app já usa o mesmo token em dois processos. **Não verificado:** se o servidor amarra o token por IP ou
  aparelho, ou se sinaliza uso simultâneo de regiões diferentes como abuso.

### (c) Quem renova a conta ativa, quando, e se relê o disco

- **VERIFICADO.** A sessão interativa não tem timer de renovação. A renovação é chamada antes das requests de
  primeira parte (`Lm` → `pa`, quando a request pede `refreshOAuth`) e em vários pontos de entrada, como perfil, org e
  sessões de nuvem. **Fonte:** binário, `firstPartyApi: refreshOAuth failed` (~248.891.604) e os chamadores de `pa(`.
  A busca por `setInterval` ligado à renovação deu zero.
- **VERIFICADO.** O gatilho é o token a 5 minutos do vencimento: `SR(expiresAt) = now + 300000 >= expiresAt`. Fora
  dessa janela, a renovação devolve `not_needed`. **Fonte:** binário, `function SR` (~248.390.077).
- **VERIFICADO.** Depois de um 401, o CLI primeiro tenta adotar do disco um token diferente e não vencido
  (`tengu_oauth_401_recovered_from_disk`, `..._from_keychain`). Se não acha, força a renovação (`force: true`).
  **Fonte:** binário, ~248.642.359.
- **VERIFICADO.** A frequência acompanha a vida do access token. O `CLAUDE.md` do repo registra ~8h pelo `expiresAt`,
  e as issues #48786 e #80585 dizem o mesmo. A #24317, de fev/2026, falava em ~15h. O valor vem do servidor
  (`expires_in`) e não está no binário. **Fonte:** `CLAUDE.md:259`; issues citadas.
- **VERIFICADO.** Antes de renovar, o CLI compara versão e `mtime` do `.credentials.json` (`SA`). Se o arquivo
  mudou, limpa o cache e relê o disco. Depois relê de novo, e se o access token no disco já não é o que ele tinha,
  adota o do disco e **não** envia refresh (`tengu_oauth_token_refresh_race_resolved`). Esse caminho se repete dentro
  do lock. Um arquivo trocado por fora antes da renovação faz o CLI usar o par novo. **Fonte:** binário, `SA`
  (~248.639.136) e a função de refresh (~248.652.838); confirmado pelo gate de 13/09 em
  `specs/011-contas-e-provedores/research-etapa-3-cli.md:12-13,35-46`, na versão 2.1.270.
- **VERIFICADO.** O CLI coordena os processos com um lock de arquivo no diretório de configuração (`ZN()` =
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` ou `~/.claude`), com até 5 tentativas e takeover de dono morto
  (`tengu_oauth_token_refresh_lock_*`). Esse lock só alcança processos que compartilham o mesmo diretório: **não
  coordena dois PCs**. **Fonte:** binário, ~248.637.605 (`ZN`) e eventos `lock_*`.
- **VERIFICADO.** A gravação depois do refresh é um compare-and-swap. Ela só grava se o disco ainda tiver o refresh
  token enviado, ou vazio. Se alguém trocou o arquivo durante o refresh, o CLI **descarta o par que acabou de obter** e
  adota o do disco (`tengu_oauth_refresh_save_adopted_newer_write`, `..._cas_adopted_sibling`). **Fonte:** binário,
  `l8r` (~248.629.908).
- **VERIFICADO.** Existe renovação proativa por timer, mas só no daemon de sessões em segundo plano
  (`auth: scheduling proactive refresh in`, `auth: proactive refresh starting`) e na ponte do Remote Control
  (`[remote-bridge] Proactive ...`). Em 27/10, neste PC, havia 2 processos `claude.exe`, nenhum daemon, bg-spare ou
  remote-control (contagem por linha de comando, sem ler argumentos sensíveis). **Fonte:** binário, offsets
  ~131.813.538 e ~133.565.393; `Get-CimInstance Win32_Process`.
- **VERIFICADO (no repo).** O app não renova a conta ativa, só lê o par vivo (D7), e não renova conta parada que
  divide o refresh token com o CLI (R5). Desde o PR #115 copia disco para cofre na leitura de carga e no encerramento,
  com prova de identidade. **Fonte:** `src/main/accounts/mods/local-mod.ts:15-49,253-265`;
  `src/main/accounts/account-engine.ts:338`; `CLAUDE.md:259-264`.

### (d) Dois logins independentes da mesma conta

- **VERIFICADO.** O `/logout` revoga no servidor o refresh token (`POST ${TOKEN_URL}/revoke`,
  `token_type_hint: "refresh_token"`) antes de apagar local. **Fonte:**
  `specs/011-contas-e-provedores/research-etapa-3-cli.md:14`; binário 2.1.311, função de revoke, ~248.388.040.
- **VERIFICADO.** No binário lido, as chamadas de revoke ficam no `/logout` e no fluxo próprio de sign-in de "cloud
  sessions", que revoga o **próprio** token novo quando perde corrida ou falta escopo. Nenhuma chamada de revoke foi
  achada ligada ao `/login` do claude.ai substituindo uma credencial anterior. A busca foi por chamadores do revoke e
  não é exaustiva. **Fonte:** binário, chamadores de `Ob(` e `l5r(`.
- **VERIFICADO (doc oficial).** O `setup-token` faz "the same browser authorization flow as `/login`" e entrega uma
  credencial à parte, sem salvar nada. O texto não diz que isso desliga o `/login` já existente. **Fonte:**
  https://code.claude.com/docs/en/authentication (acesso em 27/10/2026).
- **VERIFICADO (no repo, premissa de desenho).** O plano da etapa 3 adotou o login isolado (`CLAUDE_CONFIG_DIR`
  próprio) porque "cada conta tem família própria", e porque uma cópia que divide a família com o CLI "morre na
  primeira renovação". **Fonte:** `specs/011-contas-e-provedores/plan-etapa-3.md:76-85`. É premissa: o e2e não pôs
  duas cadeias da mesma conta para rodar juntas (`specs/011-contas-e-provedores/e2e.md:181-195` removeu a antiga antes
  de relogar).
- **INFERIDO.** Dois logins da mesma conta tendem a gerar cadeias independentes, sem um derrubar o outro. A base é
  que nada no cliente revoga a cadeia anterior no `/login` e que a doc trata `setup-token` como credencial paralela.
  **Não verificado:** o comportamento do servidor, como limite de sessões por conta ou revogação de sessões antigas
  num login novo.

## Lacunas

- **(a) Tolerância no servidor (segundos):** não verificado. Precisa de experimento (E2 abaixo).
- **(a) Revogação da família no reuso (RFC 9700):** não verificado. Também sai do E2.
- **(b) Amarração por IP ou aparelho no servidor:** não verificado. Precisa do E3.
- **(d) Coexistência de dois logins e limite de sessões por conta:** não verificado. Precisa do E1.
- **Vida do refresh token (`refresh_token_expires_in`):** o valor não aparece em fonte pública. Só lendo o campo de
  uma resposta real, coisa que esta pesquisa não pode fazer.
- **Fora do escopo deste item:** issue #101649, sobre processos de versões diferentes do CLI que seguem protocolos de
  lock diferentes na mesma credencial. Pesa no item 06 (atualizar o app nos dois PCs), porque canais alfa, beta e
  stable podem carregar CLIs diferentes.
- **Decisão, não fato (candidato ao item 04):** usar a mesma cadeia nos dois PCs (sincronizando o par) ou uma cadeia
  por PC (login separado em cada um). Depende de E1 e E2.

### Experimentos propostos (o dono decide se roda)

Todos pedem uma conta com assinatura cujo login o dono aceite perder (pior caso: refazer o login). Conta grátis não usa
Claude Code. Podem rodar num PC só, com login isolado. Nenhum passa por `/logout`.

- **E1, dois logins da mesma conta (d):** fazer login isolado da conta T no diretório X e de novo no diretório Y.
  Mandar uma mensagem em X e em Y e conferir `/usage` nos dois. Esperar um ciclo de renovação natural (~8h) com as duas
  sessões em uso. Resultado: as duas seguem vivas (cadeias independentes) ou uma cai no `Login expired` depois do
  segundo login (login novo derruba o anterior).
- **E2, tolerância e família (a):** com o par P0 de T, renovar pelo app (`token-refresh.ts`) para obter P1. Após N
  segundos (rodadas separadas com N = 0, 10, 60, cada uma com login novo), renovar de novo com P0 e anotar
  aceito/`invalid_grant`. Depois, renovar com P1 e anotar se ele ainda vale. P1 recusado indica revogação da família.
  Registrar só status HTTP e código de erro, nunca os tokens.
- **E3, mesmo access token em dois PCs (b):** sincronizar um par válido de T para o segundo PC, sem renovar em nenhum
  dos dois, e mandar uma mensagem em cada um dentro da validade. Os dois respondem e `/usage` mostra a mesma conta.

## Trilha de busca

- **Binário `claude.exe` 2.1.311**, buscando `tengu_oauth_*`, `proactive refresh`, `DPoP`/`dpopKey`, `/revoke`,
  `refresh_token_expires_in`, `Refresh token expired`, `setInterval` junto de `pa`/`Zfe`. Achou o fluxo completo de
  refresh, lock e CAS. Nenhum timer de refresh na sessão interativa. DPoP só no SDK da AWS.
- **Issues de anthropics/claude-code** (`gh search issues`), termos: "invalid_grant", "refresh token reuse",
  "refresh token multiple machines", "refresh token two computers", "second computer logged out", "another machine",
  "laptop desktop login", "two devices", "multiple devices", "same account multiple machines login", "sign in other
  device revokes", "session limit devices". Achou só corridas **na mesma máquina**. Nenhuma issue sobre a mesma conta
  em dois computadores com cadeias separadas, e nenhuma resposta da equipe nos trechos lidos.
- **Doc oficial** `code.claude.com/docs/en/authentication`: nada sobre rotação, tolerância, multi-dispositivo ou limite
  de logins por conta.
- **Repo:** `grep` por "uso único", "família", "tolerân", "simult", "outra máquina". A premissa de uso único vem dos
  tickets do claude-switcher (`research.md:52-55`). Nenhum teste próprio de tolerância ou de duas cadeias.
- **Vault Obsidian** (`Projects/donel-dev`): sem resultado para "invalid_grant" ou "Reconectar". A pasta não foi
  encontrada no caminho padrão.
- **KB Seazone e Nekt:** não consultados. A pergunta é sobre serviço de terceiro (Anthropic) e o código local.

## Implicações para o item 04 (sincronização)

Fatos que o refinamento do item 04 precisa considerar. Não são proposta de arquitetura.

1. **Mesma cadeia nos dois PCs e o refresh.** Se os dois PCs dividirem a mesma cadeia, o primeiro CLI que renovar
   invalida o refresh token do outro (rotação, INFERIDO). Se o outro PC renovar antes de receber o par novo, leva
   `invalid_grant` e o CLI **apaga a credencial do disco** dele (VERIFICADO), e pela RFC 9700 pode ainda derrubar a
   família (não verificado). O lock do CLI não atravessa a rede (VERIFICADO), então a coordenação entre PCs fica toda
   por conta do app.
2. **O CLI adota o par entregue a tempo.** Arquivo trocado antes da janela de 5 minutos, ou antes de um 401, é relido e
   adotado sem refresh (VERIFICADO). A janela crítica é o PC desligado ou dormindo. Ao voltar, o access token está
   vencido e a primeira request dispara o refresh na hora, antes de qualquer sincronização (VERIFICADO: o gatilho é a
   request). Isso bate com a decisão do dono: o PC que volta recebe os pares antes de renovar sozinho.
3. **Escrever durante o refresh perde par.** Se a sincronização reescrever o `.credentials.json` enquanto o CLI está
   no meio de um refresh, o CAS do CLI descarta o par recém-obtido e fica com o do disco (VERIFICADO). Se o par
   escrito for mais velho, a cadeia nova se perde.
4. **Renovação proativa existe em modos que o app não usa hoje.** O daemon de background e o Remote Control renovam
   por timer (VERIFICADO). Se algum dia rodarem num dos PCs, viram um terceiro renovador fora do controle do app.
5. **Uma cadeia por PC depende do E1.** Se dois logins da mesma conta coexistem, cada PC renova a sua cadeia e só
   lista, rótulos e grupos precisam sincronizar. Se não coexistem, o modelo fica impossível. Antes do E1, essa via não
   tem base para ser escolhida nem descartada.
6. **O access token em si pode circular.** Sem amarração no cliente (VERIFICADO), um access token válido levado ao
   outro PC funciona até vencer (INFERIDO, falta o E3). O risco está no refresh token, não no access token.
