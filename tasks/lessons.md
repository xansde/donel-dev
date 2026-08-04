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
