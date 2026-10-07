# Lessons learned — donel-dev

Registro append-only de trade-offs e decisões que custaram análise. Uma seção
por fase/entrega; nunca reescrever entrada antiga.

## 2026-08-04 — pln-motor-contas-mods (motor-contas-mods)

### Refresh token de uso único proíbe clonar o heartbeat

A tentação era portar o `daemon.py` do claude-switcher inteiro para o main
process — heartbeat de 15 min renovando tokens, igual ao original. O research
mostrou que o refresh acontece no **servidor** deles e que existe ainda um
monitor externo coordenado por `refresh_owner`/`token_version`. Como o refresh
token da Anthropic é de **uso único**, um segundo renovador local queimaria o
par debaixo do primeiro. A alternativa rejeitada (clone do heartbeat) foi
trocada por **switch-time-only**: renova só na hora do switch, só como
fallback, e só para contas próprias. Custo aceito: conta parada meses pede
re-login uma vez.

**Lesson:** antes de clonar um mecanismo de renovação de credencial, descubra
QUEM mais renova aquele mesmo par — com refresh token de uso único, dois
renovadores não coexistem, e o segundo é sempre o que quebra.

### Interface extraída de dois mods, não projetada antes deles

Havia espaço para desenhar um framework de mods (loader, manifesto, sandbox)
antes de existir qualquer backend. Rejeitado: a interface nasce com exatamente
os quatro membros que os dois mods concretos exigem, e o motor escolhe entre
dois construtores com um `switch`. Corolário que só apareceu no plano: com **um
mod só** não há de onde extrair — a interface sairia sendo a API da Seazone com
outro nome, exatamente o acoplamento que a frente existe para evitar. Foi o que
obrigou o mod local a entrar na mesma etapa do mod Seazone.

**Lesson:** "extrair a interface de N implementações" implica entregar as N
juntas — cortar a etapa em uma implementação só transforma a abstração no
formato do primeiro backend.

### A escrita de credencial mora fora dos mods

O caminho óbvio era cada mod escrever `.credentials.json` e limpar
`oauthAccount`. Rejeitado: a sequência é uma invariante de correção (inverter a
ordem perde o par rotacionado da conta que sai) e duplicá-la por mod garante
que o terceiro mod a implemente errado. `switchTo()` passou a **devolver** o
par; a escrita ficou num módulo só, com o teste da ordem num lugar só.

**Lesson:** quando uma sequência de passos é invariante de correção, ela é
responsabilidade do orquestrador — plugin que a reimplementa é bug esperando
o próximo plugin.

### Motor inerte por default destrava a etapa

A etapa 1 convive com perfis vivos e com a 010 em voo. Em vez de sequenciar por
espera, o motor nasce desligado (`accounts.mod = null`): sem mod configurado, o
comportamento é byte a byte o de hoje. Isso torna a etapa mergeável e
reversível por config, sem depender da demolição de perfis.

**Lesson:** feature que substitui um mecanismo vivo entra desligada por config
— assim ela pode ser integrada e testada em dogfooding antes de o mecanismo
antigo morrer.

## 2026-08-04 — pln-registry-providers-classe-a (registry-classe-a)

### Registry de um piloto só: campos genéricos em vez de campos nomeados

A classe A estreia com **um** provider (OpenRouter), e a lição da etapa 1 diz
que interface extraída de uma implementação só vira o formato dessa
implementação. A alternativa natural — modelar a entrada com `baseUrl`,
`apiKey` e `model` — foi rejeitada: congelaria o registry no formato do
primeiro provider e exigiria código novo para o segundo. A entrada passou a
carregar `env: Record<string,string>` genérico + `secretEnvKeys: string[]`, e o
teste do registry roda a mesma bateria contra **duas** entradas fictícias de
formatos diferentes. Nenhuma string do provider real existe em lógica.

**Lesson:** quando a feature estreia com um único caso concreto, a proteção
contra "virar o formato dele" não é abstrair mais — é modelar o mecanismo em
dados genéricos e provar com duas fixtures de formatos diferentes.

### "Funciona sem obra" é afirmação sobre o mecanismo, não sobre o encanamento

A spec prometia que transcripts, hooks, resume e Modo Dev funcionariam "sem
obra" na classe A, porque o binário é o mesmo. Verdade sobre o mecanismo — e
falso sobre o app: `resolveTranscriptPath` e `indexProjectSessions` recebem o
`claudeHome` por parâmetro, então alguém tem de passar o home do provider. A
tentação era unir todas as raízes de transcript; foi rejeitada (muda assinatura
do indexer, cria dedup e ordenação entre origens, obra que ninguém pediu). A
resolução ficou no mesmo padrão que já vale para perfil ativo: a lista segue o
provider selecionado, e a UI diz de qual origem ela veio.

**Lesson:** "o binário é o mesmo, então funciona" merece uma checagem no código
de quem chama — o mecanismo herdado costuma ser parametrizado, e o parâmetro é
a obra escondida.

### Precedência de env com três donos vira função pura, não `if` no hub

`CLAUDE_CONFIG_DIR` passa a ter três candidatos ao mesmo tempo (perfil ativo,
motor de contas que exige *ausência* de override, provider). Espalhar a decisão
no `pty:create` deixaria a etapa 2 (que mata perfis) quebrar o comportamento sem
teste acusar. Virou `resolveSessionConfigDir` — pura, ordem provider > motor >
perfil, tabela-verdade testada incluindo o mundo pós-demolição, consumida num
ponto só.

**Lesson:** quando um recurso muda de dono ao longo de etapas, escreva a
precedência como função pura com tabela-verdade — a etapa que remove um dono
some com um ramo em vez de virar arqueologia.

## 2026-08-04 — pln-demolicao-perfis-migracao (demolicao-perfis-migracao)

### Migrar o que a topologia já consolidou é copiar arquivo sobre si mesmo

O passo "copiar `<perfil>/projects/*.jsonl` para `~/.claude/projects`" parecia
óbvio até o inventário mostrar que `projects` é uma das seis junctions que o
próprio app cria (`PROFILE_LINK_DIRS`): todo perfil aponta para o mesmo
diretório físico. Escrito ao pé da letra, o passo copiaria cada arquivo sobre
ele mesmo. A alternativa rejeitada foi cortar o passo ("não há o que migrar
nesta máquina"): ele ficou, mas comparando `realpath` antes — junction vira
"já consolidado", diretório real de verdade é copiado.

**Lesson:** antes de escrever um passo de migração, meça a topologia real do
disco — um plano de migração escrito a partir do modelo mental copia dados que
já estão no destino, ou pior, sobrescreve os que estão.

### Desfazer o link antes de renomear a pasta que o contém

Arquivar `~/.claude-profiles` com as junctions vivas passa em qualquer teste do
dia da virada. O estrago aparece semanas depois, quando um humano apaga a pasta
`.old` e a deleção atravessa o link até o `~/.claude` real. O código antigo já
sabia disso (`deleteProfileDirectory` desfazia as seis antes de remover) — a
lição estava dentro do módulo que ia ser deletado.

**Lesson:** ao demolir um módulo, extraia as invariantes de segurança que ele
carregava antes de apagá-lo; elas costumam estar em comentário e ordem de
chamada, não em nome de função.

### Religar a fonte nova antes de remover a velha

A tentação era começar pela demolição (é o nome da etapa) e religar a tela
depois. Rejeitado: existiria uma janela em que o app não tem tela de conta
nenhuma, e é exatamente nela que o dogfooding pararia. Com a ordem invertida —
trocar a fonte, ver verde, só então remover — cada remoção passa a ser sobre
código comprovadamente sem consumidor, e quem verifica isso é o `typecheck`,
não a leitura de quem removeu.

**Lesson:** numa substituição de mecanismo, a ordem "ligar o novo → provar →
apagar o velho" transforma revisão de diff em verificação automática; a ordem
inversa transforma em fé.

### Dois runs planejando a mesma spec no mesmo dia colidem na numeração

As fases Plano das etapas 2 e 3 rodaram em paralelo sobre a mesma `spec.md`. As
duas continuaram a numeração de clarifications a partir de C12 — e a que
commitou primeiro levou C13–C22. Só apareceu porque o `Edit` avisou que o
arquivo mudara em disco.

**Lesson:** ao acrescentar numeração contínua a um artefato compartilhado, releia
o arquivo no momento de escrever, não no início da sessão — em fases paralelas, a
numeração que você leu já é histórica.

## 2026-08-04 — wi-011-etapa1-motor-mods (motor-contas-mods)

### Nomear a variável Playwright de `Page` como `window` quebra a tipagem dentro do `evaluate()`

Os smokes existentes (`tests/smoke/profile-quota.spec.ts` e outros) nomeiam a
variável `Page` do Playwright de `window` — funciona ali porque esses arquivos
só chamam `window.locator(...)`/`window.keyboard...` (métodos do `Page`),
nunca referenciam o `window` do NAVEGADOR de dentro de um `.evaluate()`.
Copiei essa convenção para os três smokes novos de contas e, como eles
precisavam ler `window.donel.accounts.*` (a API global tipada via `declare
global` em `src/renderer/src/donel.d.ts`) de dentro do callback passado a
`.evaluate()`, o `window` do callback resolveu para a variável de módulo
`Page` (closure léxica) em vez do `Window` do browser — `tsc --noEmit` falhou
com "Property 'donel' does not exist on type 'Page'" em toda chamada. Os
smokes que já faziam isso (`config-persistence.spec.ts`,
`favorite-sessions.spec.ts`) usam `appWindow`/`win`, nunca `window`, exatamente
por essa razão — só não havia comentário nenhum explicando o porquê.

**Lesson:** ao escrever um smoke Playwright que chama `window.donel.*` dentro
de `.evaluate()`, nunca nomeie a variável `Page` como `window` — use
`appWindow` (convenção já presente em parte dos smokes do repo); a colisão de
nome só aparece no `tsc --noEmit`, não em tempo de execução do Playwright.

### Estado do motor e estado persistido divergem quando quem troca a conta não é o IPC

O `activeAccountId` é gravado em `config.json` só dentro do handler
`accounts:switch` (`src/main/index.ts`). O auto-switch, porém, acontece dentro
do motor (`AccountEngine.evaluateAutoSwitch` -> `switchTo`, disparado pelo poll
de 5 min) e nunca passa por esse handler: ele atualiza `this.config` em memória
e o `appConfig.accounts` do hub fica para trás. Duas consequências que nenhum
teste pega, porque as suítes do motor são unitárias e o hub não tem suíte:
a conta escolhida pelo auto-switch se perde no restart, e um
`accounts:setConfig` posterior (ex.: o toggle "Trocar automaticamente" do
painel) chama `updateConfig(appConfig.accounts)` e devolve ao motor o
`activeAccountId` velho — a troca automática é silenciosamente desfeita no
estado do motor. O motor nasce inerte, então nada disso aparece hoje; aparece
na etapa em que alguém conectar um mod de verdade.

**Lesson:** quando um objeto de domínio muda estado por conta própria (timer,
poll, auto-*), a persistência não pode morar só no handler IPC do gesto manual
— ou o motor notifica quem persiste (o `onChanged` já existe e serve), ou
`updateConfig` recebe só os campos de política, nunca o estado que o motor é
dono.

### `expiresAt` inventado na UI desarma o refresh de fallback do mod local

Ao conectar uma conta do pool próprio, o `AccountsPanel.tsx` monta o
`ConnectModInput` com `expiresAt: Date.now() + 3600_000` — uma hora chutada,
não um dado que o operador informou nem que veio do provedor. É esse campo que
o `local-mod.ts` consulta (`pair.expiresAt <= Date.now()`) para decidir se
tenta o refresh HTTP de fallback no switch (D4). Colar um par já vencido faz o
mod tratá-lo como válido pela primeira hora e escrever um token morto em
`.credentials.json` sem tentar renovar; colar um par de validade longa provoca
um refresh desnecessário depois de uma hora — e refresh token é de uso único.
Os testes não pegam porque o `expiresAt` chega pronto nos fixtures das suítes;
o valor fabricado só existe no caminho da UI.

**Lesson:** campo que alimenta uma decisão de negócio (aqui, "renovo ou não")
nunca deve ser fabricado com um default plausível na borda — ou vem do
provedor, ou é perguntado, ou o consumidor trata `null` explicitamente.

### Override de isolamento que cobre metade do alvo

O motor de contas escreve em dois arquivos: `.credentials.json` (dentro de
`claudeHome`) e `~/.claude.json` (de onde apaga o bloco `oauthAccount`). O
`accounts.claudeHome` existe para testes redirecionarem essas escritas, mas em
`main/index.ts` só o primeiro alvo o respeitava — o segundo saía sempre de
`homedir()`. Os três smokes da etapa 1 isolavam o `claudeHome`, acreditavam
estar em sandbox, e ao rodar apagavam o `oauthAccount` do `~/.claude.json`
REAL da máquina: o login do CLI Claude Code caía, e a asserção falhava ainda
por cima. Ninguém tinha visto porque os smokes nunca haviam sido executados —
`npm test` é vitest e não os inclui. Descoberto na captura visual da etapa 1
(04/08/2026), com o dano acontecendo de verdade na máquina antes da correção.

**Lesson:** override de isolamento é contrato de tudo ou nada — se ele cobre
parte dos alvos, promete sandbox e entrega estrago fora dele; derive os alvos
irmãos do mesmo override em vez de resolver cada um pela sua própria fonte.

### Garantia escrita numa tela que só conhece metade do app

O rodapé do painel de perfis afirmava "o app nunca lê nem grava credenciais".
Verdade sobre perfis; falsa sobre o app a partir do momento em que o botão
vizinho no mesmo titlebar passou a pedir access/refresh token e guardá-los no
cofre. A frase não foi revisada porque a etapa 1 não tocou no `ProfileSwitcher`
— e nenhum teste cobre texto de garantia. Só apareceu quando um print pôs as
duas telas lado a lado.

**Lesson:** frase que promete algo sobre *o app inteiro* deve morar onde o app
inteiro é conhecido, ou ser reescrita no escopo da tela que a exibe; do
contrário a primeira feature vizinha a transforma em mentira sem que ninguém
edite aquele arquivo.

### Dublê escrito a partir do contrato não testa o contrato

O mod Seazone foi implementado contra `backends-http.md`, escrito na fase de
pesquisa pela leitura do servidor e nunca exercitado contra a API. Quatro
divergências passaram: a rota de auth (`/auth/exchange` em vez de
`/auth/refresh`), o campo do JWT (`jwt` em vez de `accessJwt`), o envelope de
`/accounts` (lista no topo, e o identificador é o `label` — campo `id` não
existe) e os nomes da carga (`fiveHourUtil`/`sevenDayUtil`). A suíte tinha um
`fetch` falso que respondia exatamente o contrato imaginado, então cada teste
novo aumentava a confiança numa suposição. 1699 verdes, e o primeiro contato
com o servidor real devolveu 422.

A divergência mais perigosa era a silenciosa: com os nomes de carga errados, as
61 contas do pool apareceriam na tela com carga `null`, e carga desconhecida
nunca é destino de auto-switch (C9) — o recurso ficaria inerte, sem erro
nenhum, parecendo apenas "não trocou ainda".

**Lesson:** dublê de HTTP tem que nascer de uma resposta CAPTURADA do servidor
real (basta um `curl` salvo), nunca do documento de contrato — senão o teste
confirma a leitura de quem escreveu o documento, e a primeira execução real é
que vira o teste. Quando não dá para capturar (sem credencial, sem acesso),
isso é um bloqueio a declarar, não uma suposição a seguir.

### Toda falha virando "offline" apaga o diagnóstico

O mesmo mod classificava qualquer falha como indisponibilidade de rede. O 422
de contrato acima chegou ao operador como "Contas indisponíveis: backend
indisponível (offline)" — que mandou o diagnóstico para DNS e disponibilidade
do host, quando o servidor estava no ar e tinha respondido em 105 ms.

**Lesson:** "não consegui falar com o servidor" e "o servidor recusou o que eu
mandei" são estados diferentes e levam a ações opostas; colapsar os dois numa
palavra transfere para quem lê o custo de descobrir qual dos dois é. Separe ao
menos rede / credencial / resposta-inesperada, e deixe a razão do servidor
chegar à tela.

### Correção que não visita os irmãos do lugar onde nasceu

A rodada 2 de Validar (04/08/2026) revisou as três correções acima e achou, nas
três, o mesmo resíduo: a correção parou no caminho exato onde o defeito foi
observado e não visitou os caminhos gêmeos ao lado.

1. A separação rede/credencial/resposta-inesperada entrou em `listAccounts`
   (não-2xx → `io`), mas `switchTo`, no mesmo arquivo e a 20 linhas de
   distância, ainda devolve `offline` para qualquer não-2xx — inclusive o 422
   que originou a lição. O tipo `SwitchToResult` ganhou `'io'` no mesmo commit
   e o caminho continua sem usá-lo.
2. A bateria de contrato nova cobre 422 e 401 em `/accounts`; `/session/switch`
   só tem caso feliz. O teste seguiu o mesmo recorte da correção.
3. O roteiro `contas-motor-ativo.spec.ts`, criado no MESMO commit que consertou
   o `claudeJsonPath`, descreve no cabeçalho o bug em tempo presente ("é
   resolvido SEMPRE por `homedir()`") e afirma que o smoke "isola só o
   primeiro" — as duas frases nasceram falsas.

**Lesson:** ao corrigir, listar os irmãos do ponto corrigido — o outro método
da mesma interface, o outro campo do mesmo contrato, o comentário que descrevia
o defeito — e ou corrigir, ou registrar por que ficaram de fora. Um defeito
aparece onde alguém olhou, não onde ele mora; corrigir só o ponto observado
deixa o resto do padrão vivo e agora protegido por um verde novo, que faz o
lugar parecer revisado.

### Flag de closure lida depois de um `await` não sobrevive a chamada concorrente

`seazone-mod.ts` distingue "sessão recusada" de "sem rede" por uma variável de
closure (`sessaoRecusada`) que `authedFetch` zera na entrada e o chamador lê
depois do `await`. Duas chamadas concorrentes — o poll de 5 min do motor e um
clique de troca — se sobrepõem: a segunda zera a flag que a primeira acabou de
levantar, e um `unauthorized` real chega à tela como `offline`. Só o rótulo do
erro é afetado (nenhuma credencial se perde), e nenhum teste cobre o
entrelaçamento, porque cada teste roda uma chamada por vez.

**Lesson:** informação produzida dentro de uma chamada assíncrona volta pelo
valor de retorno, não por variável compartilhada — estado de closura lido
depois de um `await` pertence a quem escreveu por último, não a quem está
lendo. A suíte não pega: teste sequencial nunca produz o entrelaçamento.

## 2026-08-04 — wi-demolicao-perfis-migracao (demolicao-perfis-migracao)

### O dublê de teste tinha o formato errado de `.credentials.json`

`credentials-import.ts` nasceu (T1210/T1211) com `readCredentialsFile`
devolvendo o par **solto** na raiz do JSON (`{ accessToken, refreshToken,
expiresAt, scopes }`). A suíte de vitest passou verde de primeira — o dublê
injetado nos testes também usava esse formato, então o contrato entre teste e
implementação estava consistente e cego ao mesmo tempo. O formato REAL do
arquivo que o CLI escreve (confirmado em `claude-state.ts`, `extractPair`, já
existente da etapa 1) embrulha o par dentro do bloco `claudeAiOauth`:
`{ claudeAiOauth: { accessToken, ... } }`. Se `createSystemCredentialsImportDeps`
(a implementação de IO real, escrita depois dos testes) tivesse ido para
produção sem o smoke em árvore de perfis falsa (T1216/T1217) — que seeda um
`.credentials.json` no formato real —, toda importação de perfil real teria
devolvido `invalid-format` silenciosamente, e só apareceria no dia da virada.

**Lesson:** quando o módulo sob teste lê um arquivo cujo formato já existe em
outro lugar do código (aqui, `claude-state.ts` já lia o mesmo arquivo), o
dublê de teste do vitest tem que espelhar esse formato desde o primeiro
vermelho — não o formato mais simples que passa a asserção. Um smoke que seeda
o arquivo real (fixture de disco, não dublê em memória) é o que de fato prova
isso; sem ele, o vermelho→verde do módulo puro certifica só a lógica interna,
nunca o contrato com o mundo real.

### Duas telas, duas assinaturas do mesmo IPC — a cerca de performance que pegou

T1221 fez `App.tsx` assinar `window.donel.accounts.list()`/`onChanged` para
alimentar o badge/statusbar, sem perceber que `AccountsPanel` (etapa 1,
T1123) já mantinha a MESMA assinatura, montada sempre (independente do
painel estar aberto). O resultado só apareceu na regressão final (T1232): o
smoke `ca7-measurement.spec.ts` (cerca de 250ms no tempo de boot até a
sidebar pintar) passou a medir ~330ms, quase o dobro do pior caso histórico
(167ms) — dois round-trips de IPC sequenciais no boot em vez de um. A
correção (`AccountsPanel` ganha um prop `onViewChange`, reporta a MESMA
leitura pra cima em vez de `App.tsx` abrir a sua própria) trouxe a medição
de volta pra perto da faixa histórica, embora a cerca continue sensível a
ruído de máquina (variação observada entre 168ms e 274ms em execuções
consecutivas do mesmo código).

**Lesson:** ao adicionar um consumidor novo de um estado que outro componente
já busca via IPC, primeiro perguntar "quem mais já assina isso?" — a resposta
certa quase sempre é reportar pra cima (callback/prop), nunca abrir uma
segunda assinatura própria. Testes de performance com cerca apertada são o
jeito que esse tipo de duplicação silenciosa se denuncia; rodar a suíte de
smoke completa (não só a fatia que parece relacionada) antes de declarar uma
fase pronta é o que pega isso — mudança de estado/dado, não de UI visível,
não aparece em revisão de tela.

## 2026-08-04 — wi-demolicao-perfis-migracao (validação manual e2e)

### O canal antigo aberto apaga o progresso da migração — o risco aceito disparou no primeiro uso real

Na primeira execução real do MigrationWizard (8 perfis `tech-*` importados um
a um, pelo app em modo dev na branch da etapa 2), as 8 credenciais chegaram ao
cofre (`accounts-vault.json`, 8 entradas novas) — mas minutos depois o
`config.json` compartilhado estava sem a chave `migration` e com
`accounts.localAccounts` vazio. Causa: os canais instalados coexistem
compartilhando o MESMO `userData` (decisão de 2026-07-28), e o alfa (etapa 1,
não conhece `migration`) e o beta estavam abertos durante a migração; qualquer
persist deles reescreve o `config.json` inteiro a partir da cópia em memória
deles — o sanitize derruba a chave desconhecida e o last-writer-wins clobbera
`localAccounts` com a cópia velha. Exatamente o risco aceito como item de
produto "sanitize com passthrough" no CLAUDE.md — que aqui deixou de ser
teórico: o cenário normal do operador (usar o Donel enquanto migra… dentro do
próprio Donel) destrói o registro das contas migradas e o progresso do wizard.
Agravante: reimportar não é idempotente entre execuções — `generateAccountId`
é `randomUUID()` por import, então cada nova tentativa cria entradas novas no
cofre e as anteriores viram órfãs inatribuíveis (o payload cifrado guarda só o
par, sem label).

**Lesson:** estado novo que vive no `config.json` compartilhado entre canais
não sobrevive a um canal antigo aberto — antes de construir feature que
persiste chave nova ali, ou o sanitize ganha passthrough de chaves
desconhecidas (e escrita vira read-merge-write), ou a feature precisa detectar
outra instância viva e recusar rodar. Teste automatizado de processo único
nunca pega isso; só o e2e na máquina real com os canais coexistindo.

## 2026-08-05 — wi-registry-providers-classe-a (registry-providers-classe-a)

### `claude` CLI duplica `/v1/messages` em cima de `ANTHROPIC_BASE_URL` — path errado, não credencial

No spike do piloto (T1302), apontar `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`
(o valor que a documentação do OpenRouter recomenda para outros clientes,
igual ao que qualquer SDK Anthropic community usaria) fazia o `claude` CLI
recusar toda tentativa de lançamento com "There's an issue with the selected
model" — mensagem que aponta pro nome do modelo, não pro path, então a
primeira hipótese natural foi "o modelo não existe no catálogo do
OpenRouter". Testar o MESMO modelo direto via `curl` contra
`https://openrouter.ai/api/v1/messages` respondeu 200 — a API em si estava
certa. Só rodando o CLI com `--debug` (`ANTHROPIC_LOG=debug`) apareceu a
request de verdade: `POST https://openrouter.ai/api/v1/v1/messages` — o
binário concatena um sufixo fixo `/v1/messages` em cima de QUALQUER
`ANTHROPIC_BASE_URL`, então a base precisa terminar ANTES do `/v1` (aqui:
`https://openrouter.ai/api`, sem o `/v1` final) para o path final bater.

**Lesson:** quando um provider Anthropic-compatible falha com uma mensagem
que aponta pro MODELO, mas o problema é o ROTEAMENTO da URL, `--debug`
(`ANTHROPIC_LOG=debug`) que mostra a request HTTP de verdade resolve em um
comando o que tentativa-e-erro por variação de nome de modelo não resolveria
nunca — o path duplicado (`/v1/v1/`) só aparece ali, nunca na mensagem de
erro da CLI. Ao documentar `ANTHROPIC_BASE_URL` pra um provider novo no
registry, testar o valor exato com `curl` primeiro (confirma a API) e depois
com `--debug` do CLI (confirma o path que o binário de fato monta) — os dois
podem discordar mesmo com a mesma API funcionando.

### Prop de callback nova + painel que ainda lê o home default = sessão que some sem ninguém dizer

Na etapa 3 o `pty:create` passou a devolver `provider: { id, label }` e o
`TerminalPane` ganhou a prop `onProviderResolved` para levantá-lo — mas
nenhum chamador foi ligado (`grep onProviderResolved` fora do próprio
`TerminalPane.tsx` não devolve nada), e o handler de `SESSION_CHANNELS.list`
segue chamando `indexProjectSessions(projectPath)` sem `claudeHome`, ou
seja, sempre `~/.claude`. Como uma sessão de provider nasce com
`CLAUDE_CONFIG_DIR = <userData>/providers/<id>/`, o `.jsonl` dela é gravado
lá — e o painel "Sessões anteriores" simplesmente não a encontra, sem
nenhuma mensagem. É exatamente o risco que a C17 antecipou ("a origem da
lista é mostrada, nunca silenciosa") e que o DoD da T1321 pedia na UI. Os
1729 testes de vitest e os 7 smokes ficam todos verdes: nenhum deles abre o
painel de sessões anteriores DEPOIS de lançar com provider, então a lacuna
não tem cor vermelha em lugar nenhum.

**Lesson:** prop de callback declarada e nunca consumida é o sintoma barato
de um encanamento que parou no meio — `grep` do nome da prop fora do arquivo
que a declara custa um comando e pega o que a suíte inteira não pega. Quando
uma feature muda a RAIZ de onde um artefato é lido/gravado (`claudeHome`,
config dir, workspace), a checagem que fecha o ciclo não é "spawnou com o
env certo", é "o painel que lista aquele artefato ainda o acha depois" —
teste de leitura pós-escrita, não só de escrita.

### Campo de segredo desenhado sobre `envKeys` (que inclui os não-secretos) grava entrada órfã no cofre

O `ProviderSummaryDto.envKeys` é, de propósito, `[...Object.keys(entry.env),
...entry.secretEnvKeys]` — a lista de diagnóstico com TODOS os nomes. O
`ProviderForm` reaproveitou essa lista para renderizar a seção "Segredos de
<label>", então aparece um campo `password` também para as variáveis NÃO
secretas (ex.: `ANTHROPIC_BASE_URL`). Salvar ali grava
`provider:<id>:ANTHROPIC_BASE_URL` no cofre — um valor que `buildProviderEnv`
nunca lê (ele só resolve `secretEnvKeys`) e que `remove()` nunca apaga
(`deleteSecrets` também itera só `secretEnvKeys`): entrada órfã, cifrada,
sobrevivendo à remoção do provider. Nenhum teste pega porque todos os testes
constroem entradas em que as duas listas coincidem com a intenção.

**Lesson:** um DTO de DIAGNÓSTICO (lista de nomes "para o operador ver") e um
DTO de AÇÃO (lista sobre a qual a UI oferece escrita) parecem o mesmo array e
não são — reusar o primeiro como fonte do segundo abre escrita em chaves que
o motor nunca vai ler nem limpar. Quando um campo de UI gera escrita
persistente, derive a lista do campo do MESMO array que o consumidor lê
(aqui: `secretEnvKeys`), nunca da união de diagnóstico.
