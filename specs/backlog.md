# Backlog pós-MVP — Donel Dev

Melhorias registradas fora do ciclo 001-mvp. Fonte de cada item indicada.
Nada aqui entra em implementação sem passar pelo ciclo de spec
(specify → clarify → plan) — regra do projeto.

## Fila já especificada (spec 001, aguardando priorização do Alexandre)

- **P1**: US-8 tokens/smart zone · US-9 subagentes · US-10 post-its ·
  US-11 todo do projeto · US-12 quota das 15 contas (**absorvido no motor —
  `specs/011-contas-e-provedores/`, ver B8**) · US-14 rotinas ·
  US-15 novo projeto decente · ~~**auto-switch**~~ (**absorvido no motor —
  `specs/011-contas-e-provedores/`, 90/20 puro em `accounts/auto-switch.ts`**;
  era "auto-seleção de perfil por headroom", insumo em
  `001-mvp/analise-switch-account-amanda.md`).
- **P2**: US-13 Modo Dev (task → fases da Esteira, ui-spec §11) ·
  US-16 Donel buddy.

> **DECISÃO 2026-07-24 (Alexandre):** **`002-quota-headroom` é a PRÓXIMA
> ENTREGA** — fura a fila inclusive do Modo Dev. Spec+plan em
> `specs/002-quota-headroom/`. Escopo: destravar o headroom (fix do timeout
> do quota-axi) + dropdown "Perfis de conta" enriquecido com AS DUAS janelas
> (5h e semanal) rotuladas + botão "Atualizar". Ordem de entrega agora:
> **002-quota-headroom → 003-modo-dev → auto-switch**. Numeração das pastas:
> quota=002, modo-dev=003; a reserva "002" do auto-switch foi liberada (segue
> a ordem de criação).

> **DECISÃO 2026-07-23 (Alexandre):** o **Modo Dev (US-13) fura a fila e é a
> PRÓXIMA feature** — ciclo de spec (specify → clarify → plan) abre assim que
> a rodada 5 fechar, como `003-modo-dev` (002 segue reservado pro
> auto-switch). Pré-requisito duro a resolver no ciclo: vínculo TaskDex do
> repo (`.taskdex.json`/pointer, pendência desde 22/07). O medidor de smart
> zone (US-8) aparece na UI do Modo Dev — fatiar a spec para a 1ª fatia
> funcionar sem ele.

## Melhorias futuras — feedback do Alexandre, 2026-07-23 (pós-MVP)

### B1. Buddy de acompanhamento

"Ter um buddy para me acompanhar." **Já especificado como US-16** (Donel,
o buddy — post-its = conversa com o Donel, humor/falas próprias, P2).
O pedido REFORÇA a prioridade do US-16 — considerar promover na fila junto
com US-10 (post-its), que é o substrato dele.

### B2. Visão de artefatos por sessão/processo/projeto

"Ter visão dos artefatos criados naquela sessão/processo/projeto."
Parcialmente coberto pelo painel de artefatos do **Modo Dev** (ui-spec §11,
P2 — artefatos por task/fase). O pedido GENERALIZA: quero ver artefatos
também no modo Uso geral, nos três níveis — sessão, processo e projeto.
Abordagem provável: extrair "artefatos produzidos" (arquivos criados/
modificados) do transcript da sessão (SessionIndexer já lê os .jsonl) e/ou
do git status/diff do projeto. Clarify futuro: o que conta como artefato
(arquivo tocado? só specs/docs? diff?), e onde aparece (painel direito?).

### B3. Acompanhamento de PRs abertas (novo)

"Acompanhamento das PRs abertas similar ao que já temos no Claude Code
desktop." Item NOVO — não existe em nenhuma US. Painel/aba com as PRs
abertas dos repos dos projetos (autor, status de checks, reviews), via
`gh` CLI (padrão do workspace: CLI > MCP). Clarify futuro: escopo (só PRs
do Alexandre? do squad? por projeto favorito?), refresh, e ação ao clicar
(abrir no browser × abrir sessão de review com a skill /spotsys-review).

> ✅ **B3 construído em 30/10 (`feature/painel-prs-sidebar`)** — decisão do dono:
> "Na sidebar, por projeto" (itens 5 e 6 de
> `docs/produto/pesquisa-mercado-2026-10-30.md`). Os clarifys acima, **decididos
> por delegação do dono (2026-10-30)**, sempre pela opção mais simples:
> - **Escopo:** só o PR **aberto** da **branch atual** de cada pasta que já está
>   na sidebar (sessões abertas e grupos de favoritos). Nada de lista de PRs do
>   squad nem de todas as PRs do repo; PR de quem for, desde que seja da branch.
> - **Refresh:** sob demanda — ao montar, ao trocar/abrir projeto (a lista de
>   pastas ou a branch muda) e ao focar a janela; cache de 30 s no main
>   (inclusive do "sem PR"). Polling de 90 s **só** para PR com check rodando e
>   janela visível.
> - **Ação ao clicar:** abre um painel (o `Modal` do design-system, mesma troca
>   "popover → Modal" do `ProjectSwitcher`) com título, "Abrir no navegador",
>   checks com link do job, reviews, conversas não resolvidas e **"Mandar pro
>   Claude consertar"**, que manda um prompt pronto para a aba do Claude daquele
>   projeto pelo `sendDriver`. Sessão de review com `/spotsys-review` fica de
>   fora (é Seazone; aqui Seazone é só adaptador opcional).
> - **Autor/"meu PR":** não filtra — a branch já diz de quem é o trabalho.
> - **Leitura:** só `gh` (`github-reader.ts`, allowlist: `pr-view-branch` e
>   `pr-review-threads`, GraphQL com consulta literal de leitura). Sem `gh` ou
>   sem login: nada aparece.

### B4. Visualizador de widgets (novo — exige spike)

"Visualizador de widgets, para continuarmos tendo essas funcionalidades."
Item NOVO e o mais sensível tecnicamente: os widgets das skills (heartbeat,
spotsys-review/radar, preparar-daily) são renderizados pelo HOST (app
desktop do Claude Code / claude.ai) — dentro de um terminal xterm cru eles
NÃO existem. Se o Donel Dev virar o cockpit principal, essas skills perdem
o formato preferido do Alexandre (memória: widgets são o formato para
decisões/curadoria). Spike necessário ANTES da spec: descobrir como/se o
CLI expõe o conteúdo do widget em modo terminal (artefato HTML no disco?
evento no transcript .jsonl? nada?) e, conforme o achado, desenhar o viewer
(ex.: webview/painel que renderiza o HTML emitido, sandboxed, sem rede).
Riscos: contrato não documentado do CLI pode mudar; segurança de renderizar
HTML arbitrário do transcript.

### B5. Favoritos como terceiro grupo na sidebar (novo)

"Projetos favoritados aparecerem num terceiro grupo diferente de projetos e
sessões (talvez até dentro de sessões, mas certamente separado de projetos),
onde mostra o projeto e, em sub-itens, as sessões recentes do projeto (ou
sessões fixadas dele). As sessões desses projetos não apareceriam na parte
de sessões." Evolução direta da sidebar atual (hoje favorito só reordena
dentro de Projetos). Comportamento pedido:
- Novo agrupamento (candidato: no topo ou dentro da área de sessões, mas
  SEPARADO da lista de projetos) só com os projetos favoritados;
- Cada favorito expande em sub-itens: sessões recentes OU fixadas daquele
  projeto (clarify: recentes automáticas × fixadas manualmente × ambas);
- Dedupe: sessões listadas sob um favorito SOMEM da seção geral de sessões.
Clarify futuro: limite de sub-itens, ordenação, e o que acontece ao
desfavoritar (sessões voltam para a seção geral).

> ✅ **B5 VIROU `specs/007-favoritos-sessoes/` (discovery 25/07).** Os três
> clarifys acima foram respondidos por ele: **ambas** (5 recentes + fixadas
> ALÉM das 5), colapsável por projeto com estado persistido, e desfavoritar
> devolve as sessões à lista geral. Duas coisas novas saíram da entrevista e
> não estavam no B5: o pin passa a ser da **sessão** e **persistido** (o de
> hoje é da aba e volátil), e a fonte da lista é um **registro próprio do app**
> mantido durante o trabalho — não uma varredura de `~/.claude` no boot
> (evita ~2 s de sidebar em branco com favoritos pesados, medição da 004).

> **B6 + B7 viraram `specs/005-terminal-copy-paste/` (discovery 24/07).**
> Nomear conversas → `specs/004-nomear-sessoes/`; % de contexto consumido
> (fatia do US-8) → `specs/006-contexto-consumido/`. Todas em rascunho
> pós-discovery, aguardando priorização/`clarify`.

### B6. Colar imagens na sessão (novo — feedback 23/07, 2ª leva)

"Poder colar imagens." O CLI `claude` aceita imagem colada em terminais que
repassam o evento (ele lê o clipboard e insere `[Image #N]`); dentro do
xterm.js o Ctrl+V pode estar sendo interceptado e reduzido a texto. Spike:
verificar o que chega ao PTY hoje ao colar uma imagem do clipboard; se o
xterm engole, encaminhar o atalho cru ao CLI (ou implementar handler de
paste com imagem no TerminalPane). Critério: colar print direto na sessão
funciona igual ao Windows Terminal.

### B7. Copiar texto fácil (novo — feedback 23/07, 2ª leva)

"Ser fácil de copiar texto." Hoje a seleção/cópia no terminal embedado é o
default do xterm.js. Melhorias candidatas (clarify): copy-on-select,
Ctrl+Shift+C, menu de contexto com Copiar, e seleção que sobrevive a
output novo chegando. Critério: copiar um trecho do terminal tem que ser
tão fácil quanto no Windows Terminal.

### B8. ~~Painel de cotas de todas as contas~~ — **ABSORVIDO no motor de contas (`specs/011-contas-e-provedores/`)**

> **Absorvido em 2026-08-04 (011-contas-e-provedores, etapa 2).** O painel
> dedicado listando todas as contas com cota (5h e semanal), refresh manual e
> uma unidade só de leitura (C25 fecha o achado A3 da etapa 1: `AccountLoad`,
> % consumido, sem o `ProfileQuota` de perfil convivendo do lado) é o
> `AccountsPanel`/`MigrationWizard` de hoje — o dropdown de perfis que este
> item descrevia morreu na demolição (T1225). Nada deste texto é apagado —
> fica como registro do pedido original.

"Seria interessante um botão que rode um script olhando todas as contas
ativas e suas cotas de uso disponível (5h e semanal)." Encaixa em **US-12
(P1 — quota das 15 contas)** e é o passo natural depois do headroom por
perfil. O que já existe: `readAllProfilesHeadroom` (main/quota-headroom.ts)
roda `quota-axi` em paralelo por perfil com `CLAUDE_CONFIG_DIR` apontado,
com cache de 60 s. O que falta:
- expor **as duas janelas** (5 h e semanal) em vez de um número só — hoje a
  implementação escolhe `five_hour` e cai pra `seven_day`, sem dizer qual
  está mostrando (o que gerou o "não entendi o que essa cota significa");
- rótulo explícito de que o número é **restante**, não usado;
- **botão de refresh manual** que ignora o cache de 60 s;
- painel/tela dedicada listando todos os perfis, em vez do dropdown.
Gotchas obrigatórios: (1) o cache do quota-axi
(`~/.cache/quota-axi/quotas.json`) é GLOBAL, não escopado por
`CLAUDE_CONFIG_DIR` — leitura marcada `state.stale`/`state.error` pode
trazer o número de OUTRO perfil e por isso vira `null` hoje; (2) `npx -y
quota-axi` leva ~3,8 s por chamada nesta máquina, então qualquer painel que
leia N perfis precisa de timeout generoso, leitura assíncrona e estado de
"carregando" (ver o bug do "—" na rodada 6 do feedback-e2e).
**Parte deste pedido já virou entrega:** o destravar + as duas janelas no
dropdown estão especificados em `specs/002-quota-headroom/` (próxima
entrega). O que continua como B8/US-12 pós-002: a TELA/painel dedicado de
todas as contas com histórico, ordenação por folga e reset.

Alternativa a avaliar no clarify: o endpoint oficial de uso OAuth
(`api.anthropic.com/api/oauth/usage`, visto no script da Amanda) devolve
five_hour/seven_day direto, sem o overhead do npx — mas exige ler o token
do perfil, o que esbarra na regra "o app nunca lê credenciais". Decidir
explicitamente.

### B9. Log de resultado de testes para consulta rápida (novo — feedback 24/07) · candidato a PADRÃO DE TODOS OS AMBIENTES DE DEV

"Ter um log de testes unitários executados para consulta rápida, sem
execuções exaustivas." Dor concreta: para saber se a suíte estava verde num
commit foi preciso re-rodar 6,7 min de smoke — o resultado deveria estar
gravado. Proposta: cada execução da suíte (unit e smoke) grava um registro
persistido (ex.: `test-results/last-run.json` + um append em
`test-results/history.md`) com: timestamp, **commit hash + se a árvore estava
suja**, comando rodado, contagem passou/falhou, e a lista dos que falharam.
Consultar o último estado vira leitura de arquivo, não re-execução.

**Gotcha de design (obrigatório, senão o log mente):** o registro só vale se
for **gerado pelo próprio runner** na execução real e **carimbar o commit** —
um log escrito à mão ou não amarrado ao commit fica stale e afirma "verde"
sobre código que já mudou (viola a regra do squad "não declarar sem checar").
A consulta rápida deve exibir o commit do log e alertar se difere do `HEAD`
atual / se a árvore está suja ("este resultado é de outro commit — re-rode").

**Tag `todos-os-ambientes-de-dev`:** o Alexandre pediu que, se aprovado, isso
seja usado em TODOS os ambientes de desenvolvimento — ou seja, é candidato a
virar padrão do **baseline do squad SZI** (um wrapper de teste que grava o
log, reusável entre repos), não só do Donel Dev. Clarify futuro: formato do
log, onde vive (repo × global), e como o hook/wrapper se pluga no runner de
cada projeto (vitest, pytest, etc.).

### B10. Dois canais instalados: app de trabalho + app de teste (novo — pedido 24/07)

"Ter um app de teste e um app de prod, para usar um para trabalhar e outro
para testar as novidades." **Decisões do Alexandre (2026-07-24):** (a) entra
DEPOIS de fechar a 002 (dist + reinstalação + E2E da 002 acontecem no app
atual, como já combinado); (b) isolamento **só do estado do app** —
`~/.claude` segue COMPARTILHADO entre os canais, de propósito, para o canal
de teste ver as contas e a cota reais (é o que permite testar o motor de
verdade). **Atualizado em 2026-08-04 (011-contas-e-provedores, etapa 2):** a
frase sobre `~/.claude-profiles` compartilhado saiu — perfis não existem
mais (demolidos, T1222/T1225); o fundo do item continua o mesmo, um só
`~/.claude` para os canais instalados lado a lado (ver `CLAUDE.md`, seção
"Canais instalados coexistindo").

Investigação feita (24/07) — o app já está quase pronto para isso: todo
estado próprio (config, favoritos, launcher defaults, e o
`session-hooks-settings.json` + `session-hook-forward.ps1` do semáforo) vive
em `app.getPath('userData')`, derivado de `app.setName('donel-dev')`
(`src/main/index.ts:126`), e o `~/.claude/settings.json` nunca é tocado (o
`--settings` é por-spawn, validado no spike do T009). Trocar o nome do app já
isola estado, porta do hook e preferências.

O que precisa divergir entre canais: `appId` (senão o NSIS trata como o mesmo
produto e um DESINSTALA o outro), `productName`/`shortcutName` (nome, atalho e
pasta de instalação), `app.setName` (o `userData`) e `setAppUserModelId` (senão
a notificação do canal de teste aparece atribuída ao app de trabalho).

**Estado medido na máquina em 2026-07-24 (18h) — há DOIS apps instalados, e
eles NÃO são dois canais:**

| | asar | Instalado em | Atalho |
|---|---|---|---|
| Atual (com cota 5h) | 24/07 16:25 | `C:\Program Files\Donel Dev` (24/07 17:06) | "Donel Dev" |
| Antigo (MVP P0) | 23/07 23:11 | `%LOCALAPPDATA%\Programs\Donel Dev` | "Donel Dev (ANTIGO 23-07 - sem cota 5h)" |

Sobreviveram lado a lado por acidente (`allowToChangeInstallationDirectory:
true` + diretório trocado à mão na 2ª instalação), não por design. Consequências
confirmadas: (1) **estado 100% compartilhado** — mesmo `appId`, `productName` e
`setName`, logo o mesmo `%APPDATA%\donel-dev` (config, favoritos, defaults do
launcher, `session-hooks-settings.json`); mexer na config de um vaza no outro;
(2) **uma única entrada de desinstalação** no registro ("Donel Dev 0.1.0", em
HKLM, GUID derivado do `appId`) — a do install de 23/07 foi sobrescrita, o
antigo virou **órfão**, e desinstalar "Donel Dev" hoje remove só o de
`Program Files`. Isso é a evidência prática de por que o B10 precisa divergir
o `appId`, não só a pasta.

**Vínculo com branch (decidido pelo Alexandre em 2026-07-24):** canal stable =
`main`, canal teste = `staging` (ver `CLAUDE.md`). `main` foi fast-forwardada
até `feature/mvp-p0` e o repo ganhou remoto privado nessa data.

**Gotcha de design (obrigatório, senão o isolamento não existe):** o canal tem
de ser **assado em tempo de BUILD** (`define` do electron-vite ou equivalente),
NUNCA lido de `process.env` em runtime — o app é aberto pelo atalho da Área de
Trabalho, que não carrega env nenhuma, e o canal de teste cairia no `userData`
do app de trabalho. Implementação prevista: segundo `electron-builder.beta.yml`
+ script `dist:beta`.

### B11. Vermelhos permanentes da suíte de smokes — DIAGNÓSTICO CORRIGIDO em 24/07

> ⚠️ **A versão anterior desta entrada estava ERRADA e foi substituída.** Ela
> afirmava que 3 smokes falhavam por "drift de tela do CLI v2.1.219": esperariam
> `"Let's get started"` e receberiam só o banner novo. **REFUTADO por medição
> direta** (sonda `node-pty` com `CLAUDE_CONFIG_DIR` fresco, 24/07): o CLI
> v2.1.219 **imprime** exatamente essa string, com apóstrofo ASCII (U+0027),
> visível ~9,7 s após o spawn. O diagnóstico antigo tinha sido **inferido dos
> números de linha** citados no T209 — que apontam a linha do `test(...)`, não a
> asserção que falhou. Ninguém havia lido a mensagem de erro real.

**Causa 1 — teardown estourando o timeout de hook (RESOLVIDA, commit `e2259d5`).**
A falha era `"afterAll" hook timeout of 30000ms exceeded`, com o CORPO do teste
passando. Medido: `electronApp.close()` leva **70,5 s** no T014 (3 PTYs vivos,
incluindo uma sessão claude no wizard de 1º uso) contra os 30 s default de hook.
Não é vazamento — nenhum `claude.exe`/`electron.exe` órfão depois (`tasklist`),
e o close é rápido em cenários mais leves (medido: 1,2 s sem sessão · 1,2 s com
aba shell · 3,4 s com uma sessão claude). Fix: folga de 90 s **só nesse hook**
(`test.setTimeout` dentro do `afterAll`, API do Playwright) + `try/finally` nas
limpezas, em `profiles.spec.ts`, `model-injection.spec.ts` e
`previous-sessions.spec.ts` — mesmo padrão que `tabs-lifecycle.spec.ts` já tinha
desde a rodada 6 e que esses três não haviam recebido.

> **Ganho colateral, mais importante que o B11:** `previous-sessions.spec.ts`
> escreve dois `.jsonl` sintéticos sob o `homedir()` **real** e limpava só
> DEPOIS do `close()`. Com o close estourando — exatamente o cenário acima —
> esses arquivos ficavam permanentes em `~/.claude/projects/` do usuário. Agora
> a limpeza está em `finally`.

**Causa 2 — asserção que depende de subir uma sessão claude REAL (ABERTA).**
Com o teardown corrigido, o T014 passa a falhar no corpo, e o motivo real
aparece: `expect(...).toContain("Let's get started")` recebe `" "` — o painel
está **VAZIO**, não com texto diferente. Provado no snapshot DOM da falha: a aba
nasce, o app mostra o próprio hint "Sessão pronta — digite no terminal", e o
xterm não tem saída nenhuma do CLI. Ou seja: **o texto não mudou, a sessão não
pinta em tempo**. Isso é instabilidade estrutural do teste — depende de CLI real,
rede, cota e da máquina sob contenção (a suíte roda várias instâncias de Electron
e sessões claude concorrentes). **Não tentar "consertar" com timeout maior sem
antes decidir o desenho:** a prova de isolamento do perfil (FR-005/FR-012) não
precisa necessariamente do texto do wizard — um marcador determinístico do
próprio app seria estável. Fica como decisão de desenho, não como bug.

> **Nota de método (aprendida à força em 24/07):** ao investigar isto, uma
> hipótese intermediária — "as 6 junctions do perfil quebram o startup do CLI" —
> foi anunciada como achado e estava **errada**. O grupo de controle (perfil
> pelado) parou de reproduzir no meio do bisect: o ambiente mudava sob a medição
> (dezenas de `claude.exe` spawnados pela própria investigação + carga da
> máquina). Lição: sem controle estável, medição de startup do CLI nesta máquina
> não é confiável — e é a mesma razão de fundo da Causa 2.

**Atualização 24/07 (gate do Batch B da 004) — DOIS vermelhos novos, causa
nomeada: COTA SEMANAL ESGOTADA.** Na suíte completa rodada nesse gate,
`model-injection.spec.ts` (T011) e `terminal.spec.ts:281` (semáforo em
background) falharam. Ambos exigem um **turno real do modelo**, e o pane
capturado no artefato de falha do `model-injection` traz, impresso pelo próprio
CLI: `You've hit your weekly limit · resets 1am (America/Sao_Paulo)` +
`/usage-credits to finish what you're working on`. No `terminal.spec.ts:281` o
efeito visível é o StateDot parar em **"Permissão pendente"** em vez de
"Aguardando resposta" — coerente com o CLI exibindo o aviso de limite como
prompt bloqueante. Não é regressão da 004 (a entrega não toca semáforo, hooks
nem state machine) e **não** é o teardown da Causa 1, que segue corrigido.
Re-rodar os dois quando a janela semanal virar; se falharem com cota folgada,
aí sim é achado novo.

> Nota de método: `terminal.spec.ts:281` **não** roda isolado com `-g` — ele
> depende do projeto já selecionado por testes anteriores do MESMO arquivo
> (o "▶ Iniciar" nasce desabilitado sem isso). Para reproduzir, rodar o
> arquivo inteiro.

**Reclassificação honesta dos vermelhos (era "6 misteriosos", agora nomeados):**

| Onde | Causa | Estado |
|---|---|---|
| `profiles.spec.ts` T014 | teardown 30 s → Causa 1 | **corrigida** |
| `model-injection.spec.ts` T011 | teardown 30 s → Causa 1 | **corrigida** |
| `previous-sessions.spec.ts` ×2 | dívida T013 (restauração de sessões) — asserções reais de feature | aberta, fora do B11 |
| `profiles.spec.ts` T014 (corpo) | Causa 2 — depende de sessão claude real | **aberta, decisão de desenho** |
| `tabs-lifecycle.spec.ts:174` | flake de contenção (passa isolado em 9,4 s) | mitigada na rodada 6 |
| `model-injection.spec.ts` T011 | **cota semanal esgotada** (24/07) — precisa de turno real | aberta, ambiental |
| `terminal.spec.ts:281` | **cota semanal esgotada** (24/07) — dot para em "Permissão pendente" | aberta, ambiental |

**O risco original do B11 está morto:** não há mais "vermelho misterioso" que
possa esconder uma regressão nova — cada um tem causa nomeada e verificada.

**Atualização 2026-07-26 (gate da 006) — os DOIS vermelhos de cota viraram
verdes.** Suíte completa no HEAD da `feature/mvp-p0` (com os 2 testes novos do
`session-context.spec.ts`): **26 verdes, 2 vermelhos, 5,9 min**. Os vermelhos são
só a dívida da T013 (`previous-sessions.spec.ts` ×2, marcador determinístico que
não aparece no pane). O que mudou:

- `model-injection.spec.ts` (T011): **verde** — exigia turno real e a janela
  semanal de cota virou.
- `terminal.spec.ts:281` (semáforo em background): **verde em 1,4 min**, contra
  os 4,4 min que queimava esperando um turno que a cota não deixava chegar. Isso
  também explica a suíte cair de 9,2 para 5,9 min — a causa nomeada no §B13 era
  essa mesma.

Ou seja: a hipótese "cota esgotada" de 24/07 ficou **confirmada por refutação
inversa** (com cota, passa). Os únicos vermelhos restantes são feature real não
implementada (T013), não ambiente.

**Relacionado:** B9 (log de resultado de testes) — um registro carimbado com
commit tornaria essa reclassificação consultável em vez de re-executável.

### B12. Dívidas conscientes da 004 (nomear sessões) — anotadas durante o Batch A, 24/07

Nenhuma delas é bug; as três foram decididas fora de escopo pela própria
`004-nomear-sessoes/tasks.md` e ficam registradas aqui para não sumirem.

- **GC de entradas órfãs em `sessionNames`.** Uma sessão renomeada pela UI e
  depois apagada do disco deixa ~100 bytes mortos no `config.json`. Nada lê
  essa entrada (a resolução parte da lista de sessões existentes), então o
  efeito é só tamanho de arquivo. Limpeza exigiria cruzar o mapa com o disco
  no boot — escopo próprio.
- **Cache de `custom-title` só em memória.** O cache por `mtime+size` do T403
  (ver `specs/004-nomear-sessoes/medicao-t403.md`) morre a cada restart do app,
  então a primeira listagem de um projeto pesado paga a varredura de novo
  (pior caso medido: 684 ms no `spotometro`, 9 transcripts / 72 MB, quase
  nenhum com título — provar ausência exige ler o arquivo inteiro). Um cache
  persistido em disco resolveria; é escopo não pedido.
- **Aba `shell` não persiste nome** (decisão C4 do clarify, não dívida técnica):
  o app não restaura abas shell no restart, então não havia o que persistir.
  Se a restauração de sessões (seção abaixo) chegar, revisitar.

### B13. Suíte de smokes: o vaivém de janelas incomoda, mas o custo é outro (medido em 24/07)

Reclamação real dele ao ver a suíte rodar: "ficava abrindo e fechando, abrindo e
fechando" — com a hipótese de que fazer cada ação uma vez só seria mais rápido.
**Medido antes de decidir:** a suíte sobe o app **16 vezes** (13 arquivos de spec
+ 3 restarts que são o próprio objeto do teste: `config-persistence` e
`session-rename` provam persistência através de restart, `previous-sessions`
relança). Cada launch custa ~1–3 s → os 16 somam **< 1 min** dos **9,2 min** da
suíte. O caro é outra coisa: **`terminal.spec.ts:281` sozinho queimou 4,4 min
(48% da suíte)** esperando um turno que a cota esgotada não deixa chegar, e o
`model-injection` outros 57 s.

Portanto: fundir launches deixaria a tela mais calma e economizaria menos de 10%
do tempo — e **ressuscitaria o bug que o isolamento resolveu** na rodada 5
(specs compartilhando o `%APPDATA%` real; `launcherDefaults` de uma execução
anterior era a causa raiz de dois vermelhos que pareciam bug de código, ver
`userDataIsolation.ts`).

O que de fato vale fazer, quando entrar na fila:

1. **Falhar rápido quando a causa é ambiental** — detectar no pane o aviso de
   limite de cota do CLI ("You've hit your weekly limit") e abortar o teste com
   mensagem clara em vez de esperar o timeout de 240 s. Corta ~4 min da suíte e
   substitui um vermelho enigmático por um diagnóstico.
2. **Não abrir sessão `claude` real onde ela não é o objeto do teste** — foi o
   que deixou os smokes da 004 em ~5,7 s no total (fixture sintética + descobrir
   o `sessionId` pelo próprio rename, sem consumir turno).
3. **Janela do Electron sem roubar foco durante a suíte** (o incômodo visual em
   si): exigiria o app nascer oculto sob um flag de teste — mudança de código de
   produção para servir teste, avaliar com cuidado antes.

### B14. As duas instalações na máquina dele — levantamento real (25/07)

Feito para responder "o instalador vai instalar por cima do app de teste?". O que
existe de fato hoje, medido (`Get-Process` para saber qual binário estava no ar,
atalhos resolvidos via `WScript.Shell`, chaves de Uninstall em HKCU e HKLM):

| Atalho | Aponta para | Registro | Build |
|---|---|---|---|
| `Donel Dev.lnk` em **`C:\Users\Public\Desktop`** | `C:\Program Files\Donel Dev\` | **HKLM** (all-users) | 24/07 20:20 — o que ele testou, e estava rodando |
| `Donel Dev (ANTIGO 23-07 - sem cota 5h).lnk` no Desktop dele | `%LOCALAPPDATA%\Programs\Donel Dev\` | per-user | 23/07 23:11 |

**Corrige uma suposição do B10 e do `CLAUDE.md`** ("os dois installs compartilham
`appId`/`productName` … é só pasta e nome de atalho diferentes"): eles diferem em
mais que isso — um é **per-machine** (Program Files, HKLM, atalho no Desktop
PÚBLICO) e o outro **per-user**. Acontece porque o NSIS está com
`oneClick: false` e elevação permitida, então o modo é escolhido no diálogo do
instalador, e numa das vezes ele escolheu all-users. O que o B10 afirma e
**continua verdadeiro**: o `userData` é compartilhado
(`%APPDATA%\donel-dev\config.json` para as duas), então nome de sessão,
favoritos e preferências valem para ambas.

Consequência prática ao entregar build novo: instalar em all-users substitui o
app que ele usa; instalar "só para mim" substitui o ANTIGO, que é o ponto de
retorno dele. **Instalar é ato dele, não do agente** — quem empacota avisa qual
dos dois será sobrescrito.

Quando o B10 for implementado, precisa considerar os dois MODOS de instalação,
não só nomes divergentes.

### B15. `fs.watch` pode perder um evento — número velho até o próximo (achado na 006, 26/07)

Observado UMA vez, ao rodar o smoke novo `session-context.spec.ts`: depois de dois
appends refletidos normalmente na tela, o terceiro ficou **5 s inteiros** sem
aparecer (o indicador seguia mostrando o valor anterior) e passou com folga maior.
Investigado antes de normalizar:

- **Não é a mecânica do watcher.** Um diagnóstico dedicado repetiu a mesma
  sequência de três appends com o `watchTranscript` real, tanto em `tmpdir` quanto
  **no diretório real e movimentado** `~/.claude/projects/C--Users-xansd-seazone-donel-dev/`:
  3 de 3 emissões, nas duas condições, em ~1 s. O teste foi descartado depois de
  responder a pergunta.
- **Hipótese que sobra:** `fs.watch` no Windows coalesce/descarta notificação sob
  carga (o app tem PTY, xterm e Electron concorrendo). Um append ÚNICO seguido de
  silêncio é o pior caso possível — não vem nada depois para "consertar" o evento
  perdido.

**Por que fica como dívida e não como correção agora:** numa sessão real o CLI
escreve várias linhas por turno, então um evento perdido é seguido por outro em
seguida e o número se conserta sozinho. O cenário do smoke (uma linha e silêncio)
não existe no uso real. Corrigir mexeria no desenho do watcher compartilhado com a
004 — que ele já validou em produção ("funcionou perfeitamente") — para um sintoma
que ainda não apareceu no uso dele.

**Mitigação desenhada, se aparecer:** re-leitura de segurança de baixa frequência
(uma leitura de cauda a cada ~5 s por aba viva, além do `fs.watch`). Custo: ~64 KB
de leitura por sessão a cada 5 s, ordem de 0,1 ms. Gatilho para implementar: o
Alexandre relatar `%` (ou nome de aba) preso com a conversa andando — está no
`006-contexto-consumido/roteiro-e2e.md` como item a observar.

**Uso real em 26/07 NÃO reproduziu o sintoma.** O Alexandre rodou o roteiro E2E da
006 no build instalado, em sessão de trabalho de verdade, e aprovou sem relatar `%`
parado. Some-se ao diagnóstico dedicado (3/3 emissões em tmpdir e no diretório
real) e o placar fica: **uma única ocorrência, só no cenário artificial do smoke
(append único seguido de silêncio), nunca em uso real.** O gatilho para implementar
a mitigação continua o mesmo — só muda que agora há evidência contra a urgência,
não a favor.

**Efeito colateral no teste:** o passo 6 do smoke usa timeout de 20 s em vez de
5 s, com o motivo escrito no arquivo. Não é "timeout maior até passar": é a
tolerância explícita a um evento perdido, num passo cuja latência já foi medida
nos outros passos do mesmo teste.

### B16. Token morto do design-system: `--smart-zone-max-tokens: 400000` (achado na 006, 26/07)

`design-system/src/tokens.css` declara `--smart-zone-max-tokens: 400000` (e o
comentário fala de "medidor de contexto, ~400k tokens"), herdado do
`design-system.md`. A smart zone da 006 é **300.000**, decisão do Alexandre em
24/07, e vive em `src/shared/contextWindow.ts` (`SMART_ZONE_TOKENS`).

**Nada está errado no comportamento:** o token CSS não é lido por código nenhum —
`grep` confirma que só o `SMART_ZONE_TOKENS` do módulo puro decide o denominador,
e a 006 usa do design-system apenas a **cor** `--zone-over`. Mas dois números
diferentes para a mesma ideia, em dois arquivos, é a receita de alguém "corrigir"
o certo pelo errado depois.

O que fazer quando o `SmartZoneMeter` (componente do design-system, hoje sem
consumidor) entrar de verdade — provavelmente no US-8 completo do Modo Dev (003):
decidir UMA fonte para o número (o módulo puro) e apagar o token, ou alinhar o
token em 300k com comentário apontando para a decisão. Não mexer agora: mudar
token de design-system fora de uma feature que o use é escopo alheio.

**ATUALIZAÇÃO 29/07 (CA-22 da 009) — o consumidor chegou, o token continua morto.**
O `SmartZoneMeter` entrou de verdade: a `StatusBar` liga o slot `smartZone` e o
`App.tsx` passa `maxTokens={effectiveContextZone(model)}` explícito. Então a
**fonte única já é o módulo puro**, como este item pedia — o default
`DEFAULT_MAX_TOKENS = 400_000` do `lib/smartZone.ts` só é alcançado por story do
Storybook, nunca pelo app.

O que sobra é só o **token CSS**, e ele fica: `--smart-zone-max-tokens` consta da
referência do design-sync (`design-system/.design-sync/conventions.md` e o
`_ds_bundle.css` dos handoffs), então apagá-lo criaria divergência permanente
contra a referência gerada no Claude Design — um problema maior que a armadilha
que ele representa. Fica registrado que o número que MANDA é
`shared/contextWindow.SMART_ZONE_TOKENS` (300k) e que ninguém lê o token.

### B20. Otimizar o boot do app — candidatos que sobraram da decisão do CA-7 (26/07)

O CA-7 da 007 pedia sidebar pintada em < 100 ms; medido deu **103–167 ms** e o
Alexandre **aceitou o desvio** em 26/07 (`007-favoritos-sessoes/medicao-ca7.md`).
Os candidatos de otimização levantados no diagnóstico ficam aqui para não se
perderem — nenhum é urgente, e nenhum é culpa da 007:

1. **Unificar `config:get` + `projects:list` num canal só** (`boot:get`). Hoje são
   duas chamadas IPC em dois `useEffect` sequenciais no `App.tsx`; o segundo
   round-trip só começa depois do primeiro re-render. Melhor retorno por esforço.
2. **Atacar os ~158 ms que a bundle bloqueia ANTES do `domcontentloaded`** — a
   bundle de produção (~776 KB) não tem `defer`/`async`, e a execução síncrona do
   módulo trava o fim do parse do HTML. Mexe em `electron.vite.config.ts`, não na
   feature.
3. **Adiar a montagem das linhas fora da viewport inicial** — com registro cheio
   são 30 linhas montadas de uma vez; só as visíveis precisam existir no primeiro
   paint.

**Se algum destes entrar, apertar junto a cerca de regressão de 250 ms do
`tests/smoke/ca7-measurement.spec.ts`** — senão a melhoria não fica protegida por
teste nenhum.

### B18. Primeira abertura numa máquina que não é a dele (verificado no código, 26/07)

Levantado ao responder "o sistema de pastas será intuitivo para as outras
pessoas?". **Nada de estado dele viaja** — isso está verificado e é o menor dos
problemas (`app.asar` = `out/` + `package.json`; config vive em
`%APPDATA%\donel-dev\config.json`, criado na máquina de cada um). **Atualizado
em 2026-08-04 (011-contas-e-provedores, etapa 2):** a frase original descrevia
a listagem de perfis (`~/.claude-profiles` do próprio usuário, lista nascendo
só com o Principal) — mecanismo demolido (T1222/T1225). Numa máquina nova
hoje, a tela de contas nasce **inerte** (`accounts.mod = null`), sem conta
nenhuma até o operador conectar um provedor — comportamento equivalente
("nada pré-existe"), vocabulário atualizado. O problema é o **primeiro
contato**:

1. **`defaultProjectRoots` é a convenção de pastas do Alexandre** —
   `project-scanner.ts:110` devolve `~/seazone` e `~/pessoal`. Numa máquina que
   guarda código em `C:\dev` ou `~\source\repos`, as duas não existem, o scan
   volta vazio e a sidebar abre em branco.
2. **O empty state afirma o caminho errado e não ensina a saída** —
   `ProjectSidebar.tsx:161` tem o texto fixo *"Nenhum projeto encontrado em
   ~/seazone ou ~/pessoal"*, que ignora os roots realmente configurados (se o
   colega trocar por `C:\dev`, a mensagem continua falando de `~/seazone`) e não
   diz "abra Preferências". Deveria citar os roots configurados de verdade e
   apontar o caminho.
3. **Adicionar pasta-raiz é campo de TEXTO, sem "Procurar…"** —
   `Preferences.tsx` tem lista, lixeira, input e botão Adicionar (com re-scan
   imediato, o que é bom), mas não existe `dialog.showOpenDialog` em lugar nenhum
   do main. Colar caminho do Explorer funciona; escolher pasta num diálogo é o
   que a pessoa espera.

**Onde isso deve ser corrigido:** os itens 1 e 2 caem exatamente na
`007-favoritos-sessoes`, que já reescreve a sidebar de projetos — resolver lá
evita mexer duas vezes no mesmo arquivo e um conflito bobo com a worktree dela.
O item 3 é independente (main + Preferences) e pode virar task própria.
Mitigação enquanto não houver código: o `docs/LEIA-ME-colegas.md` já abre
dizendo que a sidebar vem vazia, que os caminhos padrão são de outra máquina, e
ensina o passo da engrenagem.

### B17. Dívidas da distribuição para colegas (canal decidido em 26/07)

Canal e rotina de publicação estão em `docs/distribuicao.md` (pasta compartilhada
no Google Drive + `npm run publicar`, nome de arquivo fixo para o link nunca
mudar). Fica de dívida, em ordem de incômodo:

1. **Instalador sem assinatura digital** — todo colega vê "O Windows protegeu o
   seu PC" e precisa de *Mais informações → Executar assim mesmo*. Documentado no
   LEIA-ME com o motivo e o SHA256 para conferência. Resolver = comprar
   certificado de code signing (OV exige token em hardware/HSM desde 2023):
   decisão de **custo**, não técnica. Enquanto não houver, cada colega novo
   passa por esse susto uma vez.
2. **Sem atualização automática** — o colega só descobre versão nova quando o
   Alexandre avisa. Caminho desenhado, se a adoção justificar: `electron-updater`
   com `provider: generic` apontando para `latest.yml` + `.exe` numa URL interna
   (EKS/Cloudflare que a Seazone já tem). Evita o token embutido que o feed de
   GitHub Release privado exigiria. **É feature, não ajuste** — entra por spec.
3. **Ícone padrão do Electron** — num instalador já não assinado, ícone genérico
   é o segundo sinal de "app suspeito". Custa um `build/icon.ico` quando o design
   entregar (já anotado no `electron-builder.yml`).
4. **O script não confere se a pasta está compartilhada** com quem precisa —
   publica em silêncio e o colega não consegue baixar. O relatório final lembra
   de conferir, mas é lembrete, não gate.
5. **`Ctrl+C` interrompendo execução** é a primeira coisa que um colega novo faz
   por reflexo. Está no LEIA-ME como limitação conhecida — sai de lá quando a
   **005** entrar (e o LEIA-ME precisa ser editado à mão nesse momento:
   `docs/LEIA-ME-colegas.md`, seção "Limitações conhecidas").
### B19. ~~A suíte de smokes não é válida fora da pasta `donel-dev`~~ — **RESOLVIDO em 2026-07-26 (008-fechar-pendencias)**

> **Fechado.** O nome do projeto passou a sair de `tests/smoke/repoUnderTest.ts`
> (`basename` da pasta de onde a suíte roda), da MESMA fonte que o `SESSIONS_DIR`
> da fixture — 13 arquivos de spec + o helper novo, commit `3469fb7`. As 4 cópias
> locais de `slugifyProjectPath` sumiram. Uma cerca de regressão
> (`tests/smoke-project-name.test.ts`) falha se `'donel-dev'` voltar a aparecer em
> código executável de smoke fora de uma allowlist explícita (as 3 ocorrências que
> são o nome do APP, o root fantasma do T015 e o prefixo de `mkdtemp`).
>
> **Provado nos dois lugares** (a prova que faltava): numa worktree descartável
> (`donel-dev-wt-check`), rodados isolados — `session-rename` **4/4**,
> `session-rename-live` **1/1**, `session-context` **2/2**. Eram 5 vermelhos
> determinísticos ali; agora não sobra nenhum por causa de nome. `previous-sessions`
> segue com os 2 vermelhos da dívida **T013**, com a MESMA falha da pasta
> principal (`Received string: " "` — o marcador não pinta), ou seja, não é
> artefato de worktree.
>
> **Achado colateral, anotado como §B22:** os vermelhos que sobram na suíte
> completa (não isolada) são de LATÊNCIA do CLI, não de worktree.
>
> O texto original do achado fica abaixo, como registro do diagnóstico.

**Estado original (26/07, antes do conserto):**

**5 specs falham deterministicamente quando a suíte roda de uma worktree** cujo
nome de pasta não é exatamente `donel-dev` — e falham por motivo de teste, não de
produto. Achado ao gatear o lote 005+007, que por desenho roda cada feature na sua
própria worktree (`donel-dev-wt-005`, `donel-dev-wt-007`).

**Mecanismo, verificado no código:** os specs semeiam a fixture `.jsonl` num
diretório derivado da PRÓPRIA pasta —
`SESSIONS_DIR = ~/.claude/projects/` + `slugify(path.resolve(__dirname/../..))`,
que numa worktree dá `C--Users-xansd-seazone-donel-dev-wt-005` — mas localizam o
projeto na sidebar por **nome hardcoded**, com `exact: true`:

- `session-rename.spec.ts:120` — `getByRole('button', { name: 'Sessões anteriores de donel-dev', exact: true })`
- `session-rename-live.spec.ts:80,82` — `[data-testid="project-row-donel-dev"]`
- `session-context.spec.ts:97,99` — idem

Como o scanner varre `~/seazone`, a pasta `donel-dev` de verdade TAMBÉM aparece na
sidebar da worktree — então o clique acha um projeto, só que o **errado**. O teste
dirige o projeto `donel-dev` enquanto a fixture está sob `donel-dev-wt-005`, e a
lista volta com 0 linhas. Não é flake: reproduziu 100% das vezes, isolado.

**Prova por grupo de controle:** os mesmos 3 arquivos rodados na pasta principal
`donel-dev`, no mesmo commit base (`fda3e49`), passaram — `session-rename` 4/4 e
`session-rename-live` 1/1. Ou seja: 4 dos 5 vermelhos são artefato de worktree, não
regressão. (O 5º, `session-context.spec.ts:86`, falha por §B15 — passou nas duas
retentativas na base.)

**Consequência para o processo, que é o que importa:** um gate rodado só de
worktree **não valida** esses 5 specs — e o modelo de lote da esteira roda sempre
em worktree. Hoje isso é compensado à mão (rodar o controle na pasta principal), o
que é frágil: quem não souber do achado vai ler 5 vermelhos como regressão da
própria feature, ou pior, mascarar como "vermelho conhecido".

**Correção quando entrar na fila** (não feita aqui — é escopo próprio, mexe em 12
arquivos de spec): derivar o nome do projeto do `basename(REPO_ABS_PATH)` em vez de
hardcodar `donel-dev`, no mesmo helper que já calcula o `SESSIONS_DIR`. Uma
constante por arquivo, mesma fonte para os dois lados. 12 dos 14 specs hardcodam
`donel-dev`; os outros 7 passam por sorte (só precisam de *um* projeto com esse
nome existindo, não cruzam fixture com sidebar).

### B21. Diálogo de workspace do CLI 2.1.220 engole o sinal de saída (achado na 008, 26/07)

O CLI **2.1.220** tem um gate que não existia na 2.1.219 e aparece **antes** de
qualquer validação de argumento:

```
Accessing workspace: C:\Users\xansd\seazone\donel-dev
Quick safety check: Is this a project you created or one you trust? …
❯ 1. Yes, I trust this folder   2. No, exit
```

**Por que importa:** com ele na frente, o processo `claude` fica **VIVO** e nunca
sai — medido em 25 s e 40 s numa sonda `node-pty`. Isso significa **ausência de
sinal** para o T710 (nenhum `onExit`, nenhum exit code): a aba fica aberta
esperando o humano responder. Não é falso positivo (nada é esquecido); é o sinal
não chegando. Depois de respondido "1" uma vez, o diálogo não voltou a aparecer.

**O que NÃO é verdade** (hipótese levantada e refutada na mesma sessão): "toda
pasta nova mostra o diálogo, então worktree precisa aceitar antes de rodar a
suíte". Medido: numa worktree recém-criada o diálogo **não** apareceu — o CLI foi
direto para `No conversation found` (4.930 ms) e saiu com código 1 (7.319 ms).
A aceitação não é por pasta. **Qual é a chave exata — repo, `~/seazone`, uma vez
por versão do CLI — não foi determinado.**

Sem medição: o caminho "**2. No, exit**". O diálogo não reaparece depois de
aceito e não se achou como forçá-lo de novo.

Vários smokes já tratam o caso (`terminal.spec.ts:182`, `if (…includes('trust
this folder')) keyboard.press('Enter')`), o que só funciona porque o diálogo
aparece DENTRO do pane. Se um dia o CLI mudar essa tela, esses smokes travam
juntos.

### B22. Os vermelhos da suíte COMPLETA são latência de startup do CLI, não regressão (medido na 008, 26/07)

Medido com sonda `node-pty` durante a verificação da 008: o tempo até o CLI
pintar o banner `▐▛███▜▌ Claude Code v2.1.220` foi de **14,5 s numa worktree** e
**20,9 s na pasta principal** (com `⚠ 3 MCP servers need authentication` chegando
aos 21–28 s). Vários smokes esperam texto real do CLI com orçamento de **15 s** —
`terminal.spec.ts:150/191`, `previous-sessions.spec.ts:250`,
`session-context.spec.ts:81`. Quando o startup passa do orçamento, o pane vem
como `" "` (vazio) e o teste falha.

Consequências práticas, já observadas:

- **Cascata dentro do arquivo:** quando o primeiro teste de `terminal.spec.ts`
  falha assim, os seguintes falham por *"Target page, context or browser has been
  closed"* / *"element(s) not found"* — a instância do Electron é compartilhada
  pelo arquivo. Foi o caso de `:194` e `:208` na rodada de worktree da 008.
- **O mesmo teste passa isolado:** `terminal.spec.ts:282` falhou na suíte
  completa e passou isolado em 1,9 min, com cota folgada (verificada com um turno
  real: `claude -p --model haiku` respondeu em 37 s). Ou seja: **não** é o §B11
  "cota esgotada" de 24/07.
- A dívida **T013** (`previous-sessions` ×2) falha com a MESMA assinatura
  (`Received string: " "`), o que sugere que parte dela também é latência, não só
  feature faltando. **Não investigado** — fica como hipótese.

Encaminhamento possível (não decidido, fora do escopo da 008): esperar um
marcador determinístico do próprio app em vez de texto do CLI, ou dar orçamento
proporcional medido. Relacionado ao §B11 Causa 2 e ao §B13.

**Reincidência confirmada em 29/07 (CA-29 da 009).** Rodando 6 arquivos de smoke
em sequência, `terminal.spec.ts:284` (semáforo em background) falhou com
exatamente a assinatura deste item — `Received string: " "` depois de 15 s
esperando "claude code" no buffer. Rodando o MESMO arquivo sozinho, passou em
44,1 s, e o diagnóstico que o próprio teste imprime mostrou **21 `claude.exe`
concorrentes** na máquina naquele momento. Confirma latência de startup por
contenção, não regressão. Também confirma que `--grep` num teste isolado deste
arquivo NÃO serve de grupo de controle: os testes de `terminal.spec.ts`
compartilham estado de UI (projeto selecionado no Launcher), e o isolado falha
em "▶ Iniciar desabilitado", que não diz nada sobre a hipótese.

### B23. A moldura do terminal cortava por DUAS causas independentes — ~~aberto~~ **RESOLVIDO em 29/07 (CA-29 da 009)**

Registro da medição, porque o sintoma volta em qualquer máquina com escala de
tela diferente e o próximo a olhar precisa dos números, não da conclusão.

Sonda de geometria (`tests/smoke/probe-terminal-frame.spec.ts`, não versionada —
`probe-*` no `.gitignore`), janela 1266×763, `devicePixelRatio` **1,25**
(Windows a 125%). Antes:

| caixa | altura | conteúdo | veredito |
|---|---|---|---|
| `.xterm` | 623,6px | `scrollHeight` **634** | transborda 10,4px |
| `.xterm-screen` | 634px | — | 37 linhas onde cabiam 36 |
| `.terminal` (moldura) | 640px client | `scrollHeight` **642** | `overflow:hidden` corta 2px do glifo |
| `.xterm-viewport` | — | `background-color` | **`rgb(0,0,0)`** contra `rgb(14,17,22)` da moldura |

**Causa 1 — transbordo de linha.** O `FitAddon` divide a altura disponível pela
altura *ideal* da célula; o renderer DOM arredonda a altura *renderizada* de cada
linha para fechar em pixel de dispositivo. Com DPR fracionário o erro (~0,28px por
linha) só aparece somado nas ~37 linhas. Correção: `fitWithoutOvershoot` em
`TerminalPane.tsx` mede o resultado real (`scrollHeight > clientHeight`) e encolhe
uma linha por vez, no máximo duas — em vez de tentar prever o arredondamento do
xterm, que muda entre renderers e versões. Roda antes do `pty.create`, então o PTY
nasce com as linhas certas.

**Causa 2 — listra preta.** O `xterm.css` da própria lib pinta `.xterm-viewport`
com `#000` fixo, e o tema do app é `#0e1116`. A diferença aparece onde o viewport
sobra: a calha de ~15px da barra de rolagem, à direita, encostada na borda
arredondada. Correção: `background-color: transparent` no viewport
(`TerminalPane.module.css`), deixando a moldura aparecer por baixo.

Depois das duas: `scrollHeight == clientHeight` em **todos** os níveis da cadeia
(`.xterm` 624/624, moldura 640/640), `.xterm-screen` em 619px e viewport
transparente. Sobram 4,6px de folga no rodapé do terminal, na cor da moldura —
invisíveis por serem a mesma superfície.

### B24. Indicador de conta GitHub ativa (novo — feedback 28/07)

"Acho que o GH-profile pode ficar no próprio Donel Dev. É uma dor que vejo
outras pessoas tendo: não conseguir configurar qual conta do GitHub está
ativa." Hoje isso é resolvido só para o Alexandre por um hook pessoal de
`SessionStart` do Claude Code (`~/.local/bin/gh-profile-switch.ps1`): roda
`gh api user --jq '.login'` e injeta `systemMessage = "GitHub ativo: <user>"`
no início da sessão — puramente informativo, não troca de conta. Referência
técnica pronta para quem especificar: o script cabe em ~10 linhas, e o
padrão de troca de conta (`gh auth switch -u <conta>`) já existe documentado
em `~/seazone/CLAUDE.md`.

Diferença do escopo aqui: o pedido é sobre a dor de **outras pessoas**, não
só a dele — sugere um painel/indicador na própria UI do Donel Dev (visível
sem depender de hook do Claude Code), possivelmente com **troca** de conta,
não só leitura. Related: B8 (painel de contas/cotas, absorvido no motor —
`specs/011-contas-e-provedores/`) já resolve um problema parecido de "qual
conta está ativa" para contas Claude — mesmo padrão de UI pode servir de
referência para o indicador de conta GitHub.

Clarify futuro: é só indicador (qual conta está ativa) ou também switcher
(trocar sem sair do app)? Por repo (cada projeto pode ter conta diferente,
via `includeIf` do git) ou global? Onde na UI (status bar, preferências)?

### B25. Priorizar contas específicas no pool Seazone (novo — dogfooding 04/08) — **ENTREGUE em 28/10** (`accounts.seazone.preferredLabels` + botão Preferir no painel; lista vazia = todas, para não mudar quem já usa o pool)

Pedido do Alexandre durante a validação da etapa 1 da 011, com o pool real na
tela: *"gostaria que esse mod-seazone eu pudesse priorizar algumas contas
específicas"*. Contexto que dá peso ao pedido: o pool do switcher tem **61
contas de toda a empresa** — o auto-switch, como está, pode mover o Alexandre
para a conta de um colega de outro squad sem ele pedir.

**Decisão fechada em 04/08 (a restrição vale para o automático, não para o
manual):** o auto-switch considera **apenas** as contas preferidas — allowlist
dura no que o app faz sozinho; se nenhuma preferida tiver folga, ele não troca.
A lista do painel continua mostrando as 61, e um clique deliberado em qualquer
uma segue funcionando. Assim o app nunca escolhe uma conta alheia por conta
própria, e a saída manual não se perde num momento de aperto.

Forma técnica (levantada, não implementada): `selectSwitchTarget`
(`src/main/accounts/auto-switch.ts`) já é função pura que filtra candidatas —
priorizar é mais um filtro ali, antes do power-of-two-choices. A config ganha
uma lista em `accounts` e o painel, um gesto para marcar/desmarcar. Como o
identificador da conta **é o label** (o e-mail, ver
`contracts/backends-http.md` corrigido em 04/08), a lista de preferidas é uma
lista de e-mails — legível direto no `config.json`.

Quando: **fora da etapa 1**, que está fechada e em Validar (risco sensível,
esperando PR + 2 aprovações) — mexer naquela branch reabriria um diff já
revisado. Entra como spec própria ou como emenda à etapa 2, depois que o PR da
etapa 1 fechar.

Clarify futuro: preferidas são uma lista simples ou têm ordem entre si? O que
a UI mostra quando o auto-switch não troca por nenhuma preferida ter folga —
silêncio, ou uma linha dizendo por quê? (Vale lembrar que hoje o painel já
descarta `available`/`unavailableReason` que a API manda — achado do mesmo dia,
mesmo lugar da tela.)

### B26. Alvo × escopo: microsserviço na Esteira (dogfooding 06/08) — **PARCIALMENTE ENTREGUE em 06/08**

Achado com o card real "Diário de Obra" na tela: ele nasceu com repo alvo
`"spotsys e api-spotsys"` — uma **frase**, digitada num campo de texto livre,
nomeando dois serviços. Ela nunca poderia bater com pasta nenhuma, então o
"Preparar" gravou o `run-input.json`, travou o card e **só então** disse que não
abriria a sessão. O card ficou preso desde 06/08 11:42 num trabalho que nunca
começou.

Causa raiz: o store já separa **âncora** (`targetRepo`, 0..1 — onde a sessão
senta) de **escopo** (`scopeRepos`, 0..N — o que a mudança toca) desde a spec
010 `[D-6]`, e o contrato os carrega ponta a ponta. Só a TELA não separava: um
`TextInput` livre rotulado "Repo alvo", e `scopeRepos: []` fixo no código. Quem
trabalha em microsserviço — que atravessa repositórios por natureza — não tinha
onde declarar o segundo repo, e escreveu "e api-spotsys" dentro do primeiro.

**Entregue em 06/08** (branch `feature/repo-alvo-e-escopo`):
- `repoScope.ts` — o vocabulário puro de âncora/escopo: normalização (a âncora
  sempre pertence ao escopo), resumo em uma linha, e o **aviso antes do gesto**.
- `RepoScopePicker` — âncora vira `Select` entre os projetos que o app conhece;
  escopo vira chip que liga/desliga. Repo declarado que o app não enxerga
  **aparece marcado como desconhecido**, em vez de sumir do formulário.
- Gesto `setDiscoveryRepos` — corrigir alvo e escopo de um card que **já
  existe**. Não havia: o repo só podia ser declarado no nascimento do card.
- `preparePhase` recusa repo impossível **antes** de gravar e travar. Card SEM
  repo continua preparando (é declaração legítima da spec: "discovery investiga
  um problema, não um repositório") — o que não abre é a aba.
- Correção no reducer: `discovery.updated` com `targetRepo: null` agora LIMPA o
  alvo. Antes, `?? current` lia `null` como "o evento não falou do campo" e
  ressuscitava o valor antigo — apagar era impossível.

**Fica em aberto (não entrou nesta leva):**
- **Escopo no item, pela tela.** `WorkItemSnapshot` tem os mesmos dois campos, e
  a fase de um item roda no repo do item. Hoje só a skill os declara — não há
  gesto de corrigir alvo/escopo de item, e o `RepoScopePicker` já serviria.
- **Herança item←card não existe no motor.** O comentário de `DiscoverySnapshot`
  diz "alvo default herdado pelos itens", mas o reducer (`work_item.created`)
  grava `targetRepo` cru do fato. Quem herda é a VIEW (`itemRepoOf`). Decidir:
  a herança sobe para o reducer, ou o comentário desce para a realidade?
- **`ships_with` não tem gesto na tela.** A relação "entra junto" existe no
  store e é o mecanismo certo para item do back + item do front que sobem na
  mesma janela — o caso canônico de microsserviço. Nenhuma UI a cria hoje.
- **O escopo não chega à skill como instrução.** Ele viaja no `run-input.json`
  (`context.discovery.scope_repos[]`), mas nenhuma skill 3.0 fala dele no
  prompt. Uma skill de Plano que ignore o escopo vai quebrar em itens de um
  repo só, que é o erro que este item nasceu para evitar.

### B27. O Claude Code já anuncia o próprio estado — e a gente joga fora (achado 10/08)

**A mentira do semáforo tem cura barata, e ela está no stream que o app já
intercepta.** O `PtyManager` (`src/main/pty-manager.ts:195`) vê cada byte que o
CLI emite. Entre esses bytes vai a sequência OSC que define o **título do
terminal** — e o Claude Code escreve nela, em tempo real, o próprio estado:

| Título OSC começa com | Significa |
|---|---|
| um caractere braille `U+2800`–`U+28FF` (o spinner girando) | **trabalhando** |
| `✳` (`U+2733`) | **ocioso** |

Não é heurística nossa: é o CLI declarando. A evidência veio do `herdr`
(`src/detect/manifests/claude.toml`, Apache-2.0), que usa exatamente essas duas
regras como as de **maior prioridade** (1100 e 250) na detecção dele — acima de
qualquer leitura de tela.

**Por que isto importa agora.** A arquitetura do nosso semáforo já está certa e
é a mesma do herdr: hooks do CLI como fonte autoritativa, com fallback quando o
hook não conta a história toda (`semaphore-state-machine.ts`, cabeçalho). O que
difere é a **qualidade do fallback**: o nosso é temporal
(`applyPermissionHeuristic`, `:113` — `PreToolUse` pendente sem `PostToolUse`),
e é exatamente ele que produz a mentira nomeada no dogfooding: *"afirma trabalho
com o comando parado no prompt"*. Um `PreToolUse` que nunca fecha deixa o
semáforo em `working` para sempre; o título OSC, nesse mesmo instante, já diz
`✳`. Detalhe agravante: `INITIAL_SEMAPHORE_STATE` nasce em `working` — o app
**começa** afirmando trabalho antes de ter observado qualquer coisa.

**Segunda metade do achado: `blocked` de graça.** O mesmo `claude.toml` mapeia,
em regras declarativas mantidas por terceiros, o que é uma **UI de bloqueio** do
Claude Code — prompt de permissão de bash, formulário com "enter to confirm /
esc to cancel", "do you want to proceed?", o menu de escolha. É o sinal que o
**motor da 012 pressupõe existir**: a fila só sabe parar e chamar o dono quando
alguém consegue dizer "esta sessão está bloqueada esperando gente". Hoje a gente
deriva isso de `Notification` (que o spike T002 provou que dispara) — o OSC + as
regras de tela são a rede quando ela não dispara.

**O que fazer (não implementar sem spec):**
- ler a sequência OSC de título no `PtyManager` e expor como evento tipado;
- trocar o fallback temporal do semáforo por esse sinal, mantendo os hooks como
  fonte primária (a hierarquia não muda, só o segundo tier);
- portar as regras de `blocked` do `claude.toml` como fallback do
  `permission`/`blocked`, com a licença creditada;
- **não** copiar o manifest inteiro nem criar dependência do binário `herdr`
  para isto — o que atravessa é o padrão e duas regex.

**Risco conhecido:** o formato do título é contrato **de facto**, não público —
uma versão do CLI pode mudar o spinner. Por isso ele entra como **fallback**,
nunca acima dos hooks, e a ausência do sinal tem que degradar para o
comportamento de hoje, não para `unknown`.

### B28. `herdr` como runtime das sessões da Esteira — spike, não decisão (10/08)

`github.com/herdrdev/herdr` (26.9k ★, Rust, Apache-2.0, v0.8.0) — "o runtime
onde seus agentes moram": servidor de fundo + TUI cliente, com socket API
(**named pipe no Windows**) e CLI que **agentes dirigem**. Ele resolve, prontos,
quatro buracos que a 012 tem em aberto:

| Buraco nosso | O que ele tem |
|---|---|
| o app **não envia o próprio Enter** na sessão que ele abre (problema fundador do catálogo) | `agent prompt <nome> "texto" --wait` — texto + Enter atômicos, honrando bracketed-paste |
| o motor precisa saber que a fase **parou e precisa do dono** | `agent wait --until blocked --timeout N` — a definição de gate da 012 |
| **sessão órfã** quando o app fecha (decisão nº2 do dogfooding) | servidor de fundo: sessões sobrevivem a fechar o cliente, cair a rede, reiniciar |
| **A8** — worktree/lock de árvore para o worker | `worktree.create` / `open` / `remove` na própria API |

Traz também um conceito que a nossa fila noturna precisa e não tem nome: **`done`
≠ `idle`** — `done` é "terminou e **ninguém olhou ainda**"; vira `idle` quando um
humano vê. É precisamente o estado que distingue "a fila avançou de madrugada" de
"o dono já leu".

**Os dois motivos de isto ser spike e não adoção:**

1. **Não existe stream de output bruto.** Varredura da lista de métodos da socket
   API: `pane.read` é snapshot, `events.subscribe` é ciclo de vida, e
   `pane.graphics.stream` é imagem. **Nenhum canal entrega os bytes do PTY.** O
   `xterm.js` do Donel vive desses bytes — então o herdr **não substitui**
   `node-pty`. Adotar de verdade seria abrir mão da UI que é o Donel.
2. **Windows é beta, e a issue mais próxima do nosso caso é de ontem:**
   [#2545](https://github.com/herdrdev/herdr/issues/2545) (09/08) — *"agent
   progress stalls for hours when herdr window is backgrounded on Windows"*.
   Fila da Esteira rodando de fundo no Windows **é** esse cenário. Há mais de uma
   dúzia de issues Windows abertas.

**Recorte do spike, se um dia rodar:** herdr como runtime **só das sessões de
fase da Esteira** — que não precisam de renderização rica, só nascer, receber
prompt e avisar quando travaram —, com o Donel seguindo dono das abas
interativas. **Gate do spike:** reproduzir a #2545. Se a fila trava de fundo no
Windows, o spike morre ali e o B27 (que não depende de nada) segue sozinho.

### B29. Jobu faxineiro — limpeza de restos de worktrees e sessões antigas (23/10)

**Origem:** faxina manual de 23/10, pedida pelo dono, que achou 3 worktrees
mortas, 143 branches locais já incorporadas, 32 pastas de sessão de spike em
`~/.claude/projects`, handoffs órfãos em `.esteira/`, instalador velho e ~120 MB
de saída regenerável. Tudo foi **arquivado**, não apagado, em
`seazone/_archive/donel-dev-limpeza-2026-10-23/` (com `branches-apagadas.txt`
nome→SHA para recriar qualquer branch). Este item registra o roteiro para o
Jobu fazer isso sozinho.

**Forma (decisão do dono, 23/10 — sem brainstorm):** uma **opção a mais** do
Jobu, "Fazer faxina", que roda a tarefa inteira e, ao fim, sobe uma
**notificação com o resultado resumido** no balão. Não há lista para o dono
marcar antes: o que não se recria vai para uma pasta que o próprio dono
esvazia (abaixo), e isso basta. É
uma emenda pequena à D2 da 015 (o Jobu passa a avisar também o resultado da
faxina) — registrar na spec da 015 ao implementar.

**Princípios (do que deu certo e do que travou na faxina manual):**

- **Apagar o que se recria; separar numa pasta só o que não se recria**
  (decisão do dono, 23/10):
  - **apaga direto:** saída regenerável (`node_modules`, `dist`,
    `test-results`, prints, logs), instaladores velhos e scratchpads de
    sessão;
  - **apaga direto com recibo:** branches — antes do `git branch -D`, grava
    `nome SHA` no manifesto (`git branch <nome> <sha>` recria enquanto o gc
    não coletar);
  - **separa na pasta da faxina:** sessões antigas do Claude (transcripts) e
    handoffs/ctx não rastreados — texto que ninguém recria.
- **Sem quarentena nem prazo; quem apaga a pasta é o dono** (decisão do
  dono, 23/10). O que não se recria é movido para
  `_archive/faxina-<data>/<repo>/`. O app **nunca** apaga essa pasta: ao fim
  da faxina ele abre a pasta no Explorer, e o dono exclui à mão o que
  quiser, quando quiser.
- **HTML de resumo dentro da pasta, um por execução.** Cada faxina grava
  `_archive/faxina-<data>/resumo.html`, um arquivo local autocontido que
  resume o que está na pasta, agrupado por repo e categoria. Para cada item,
  mostra caminho de origem, tamanho, data e motivo de ter saído. Traz
  também as branches apagadas, com o comando de recriação de cada uma, e o
  que ficou em "manter", com o motivo.
- A trava de segurança do Claude (`pretooluse-safety-check`) bloqueou a
  deleção recursiva dentro de `seazone\` na faxina manual. Ela não vale para
  o app; o script do Donel apaga direto.
- **"Mergeado" se prova por conteúdo, não por ancestralidade.** Squash e
  cherry-pick deixam a branch "não mergeada" com o conteúdo já em `staging`:
  usar `git cherry` (patch-id) e, se ainda sobrar, comparar arquivo a arquivo.
- **Nunca tocar** em: branch atual, `main`, `staging`, `backup/*`, worktrees
  dos canais (`donel-dev-alfa`/`-beta`), worktree com mudança não commitada,
  branch só local com commit que não está em lugar nenhum, a sessão viva.

**Passo a passo (o algoritmo que a faxina manual seguiu):**

1. **Inventário (só leitura).** `git fetch origin`; `git worktree list
   --porcelain`; `git for-each-ref refs/heads`; pastas `../<repo>-wt*/` e
   `.claude/worktrees/`; projetos de sessão em `~/.claude/projects/` cujo nome
   contenha o slug do repo; scratchpads em `%TEMP%/claude/<slug>*`; arquivos
   não rastreados (`git status --porcelain -uall`) e ignorados
   (`--ignored`) do checkout principal.
2. **Classificar worktrees.** Para cada uma: tem mudança não commitada? → manter
   e avisar. Limpa e com HEAD contido em `origin/staging` ou já publicada no
   remoto (mesmo SHA)? → candidata. Limpa, só local e com commit novo → manter.
   Conferir junction de `node_modules`/`design-system` **antes** de remover
   (memória do projeto: `git worktree remove` atravessa o junction). Remover com
   `git worktree remove` sem `--force`; depois `git worktree prune`.
3. **Classificar branches locais**, fora a lista "nunca tocar":
   - ancestral de `origin/staging` → candidata;
   - `git cherry origin/staging <b>` sem linha `+` → conteúdo já entrou →
     candidata;
   - publicada no remoto com o mesmo SHA → candidata (o remoto guarda);
   - resto → manter, mostrando "N commits só aqui, último em <data>".
   Gravar `nome SHA` no manifesto **antes** do `git branch -D`.
4. **Sessões mortas do Claude.** Pasta em `~/.claude/projects/` cujo cwd
   decodificado não existe mais (worktree removida, scratchpad de spike) →
   candidata a **arquivo** (não apagar: o `SessionIndexer` lê esses
   transcripts; arquivar some com elas do "Sessões anteriores", e o dono
   precisa saber disso). Nunca mexer em `.credentials.json` nem em nada fora
   de `projects/` — a regra de credenciais do projeto continua valendo.
5. **Scratchpads** em `%TEMP%/claude/<slug>*` sem escrita há mais de 7 dias,
   fora o da sessão atual → candidatos (apagar direto: é temp por definição).
6. **Lixo do checkout.** Untracked e ignorados por categoria:
   saída regenerável (`test-results/`, `.e2e-visual/`, `.tutorial-shots/`,
   `.playwright-cli/`, `node_modules`/`dist` de `prototypes/*`) → candidata;
   instaladores em `release/` mais velhos que o último por canal → candidata;
   handoffs/ctx de `.esteira/` não rastreados de item já concluído →
   arquivo; pasta estranha na raiz (ex.: `Microsoft/` — cache do PowerShell
   gravado no cwd errado) → candidata. **Fora:** sondas (`probe-*`,
   `tests/probe/`, ignoradas de propósito), arquivo da entrega em curso,
   `out/`, `scripts/publicar.local.json`.
7. **Executar** as candidatas conforme a categoria (apaga direto, apaga com
   recibo, separa na pasta). O que é separado vai para
   `_archive/faxina-<data>/<repo>/`, preservando o caminho relativo. O
   manifesto (`branches-apagadas.txt` e a lista do que foi movido e apagado,
   com a origem de cada item) fica na pasta do repo, e o `resumo.html`, na
   raiz da faxina.
   O que caiu em "manter" não é tocado — só entra no resumo e no HTML.
8. **Conferir depois:** `git worktree list`, `git branch`, `git status`
   iguais ao esperado. Se a conferência falhar, o resumo diz isso em vez de
   "pronto".
9. **Notificar** no balão do Jobu (fato seco, D6), por exemplo: *"Faxina:
   250 MB liberados; 32 sessões antigas separadas na pasta. Ficaram 3
   branches só locais e 1 worktree com mudança não salva."* Um clique abre a
   pasta `_archive/faxina-<data>/` no Explorer, com o `resumo.html` dentro.
   Se nada foi separado, a pasta não é criada e o balão só dá o resumo.

**Script ou Claude headless — recomendação: script.** Os passos 1–8 são
determinísticos (git + filesystem) e as regras "nunca tocar" são duras —
melhor como código testado (vitest, como o resto de `src/main`) do que como
prompt. Claude headless custaria cota a cada rodada e poderia variar o
critério. Ele só se paga num complemento opcional: redigir o resumo ou
opinar sobre as branches que ficaram em "manter".

**Alcance (decisão do dono, 23/10):** **todo repo que teve trabalho desde a
última varredura** — não só o do Donel. "Teve trabalho" = algum destes sinais
depois do carimbo da faxina anterior:

- transcript em `~/.claude/projects/` com `mtime` posterior, cujo cwd seja o
  repo ou uma worktree dele (worktree → repo dono pelo `.git` dela ou por
  `git worktree list`);
- entrada no reflog de `HEAD` ou de alguma branch local
  (`git reflog --date=iso`), o que pega commit, checkout e worktree nova
  feitos fora do Claude.

O carimbo (`lastSweepAt`) fica no `config.json` do app, gravado só quando a
faxina termina. **Na primeira rodada, sem carimbo, todo repo conhecido
entra.** Os repos conhecidos são os das raízes da sidebar mais os que
aparecem como cwd de transcript. Cada repo tem a sua subpasta
(`_archive/faxina-<data>/<repo>/`). O resumo do balão e o `resumo.html`
agregam todos: *"Faxina em 4 repos: …"*. Um repo sem nada a limpar não
aparece no resumo.

### B30. Jobu como ponte entre o computador e o Donel Dev (ideia do dono, 30/10)

**Pedido, nas palavras dele:** "tornar o Jobu a ponte entre o computador e o
donel dev, ou até uma forma de dar mais autonomia e conseguir falar mais com
ele. Não sei exatamente o que eu quero, mas acho que ele poderia ser mais
útil." **Ainda é névoa:** precisa de discovery (porta A) antes de virar spec.

**Hoje o Jobu:** avisa quando uma sessão termina, pede você ou falha (balão e,
desde o #136, número na barra de tarefas), faz a faxina de worktrees e
sessões (B29) e leva à aba ao clicar.

**Direções para o discovery (não decididas):**
- **Falar com ele:** uma caixa de texto (ou voz) no próprio Jobu que manda a
  frase para a sessão certa ("pergunta pro Donel Dev se o PR passou") ou abre
  uma sessão nova; resposta curta no balão.
- **Ponte com o computador:** ele vê o que acontece fora do app (downloads,
  área de transferência, janela ativa, notificações do Windows) e oferece
  levar para uma sessão ("quer mandar esse print para o Claude?").
- **Mais autonomia:** rotinas que ele dispara sozinho (resumo da manhã, o que
  terminou de noite, PRs esperando, cota das contas) e pequenas ações com
  confirmação, no lugar de só avisar.
- **Caixa de atenção:** o Jobu como a lista única de "quem está me esperando"
  (item 1 da `docs/produto/pesquisa-mercado-2026-10-30.md`).

**Riscos a discutir:** privacidade (ler área de transferência e janela
ativa), barulho (um pet que fala demais), e a regra de credenciais (nada de
ler senhas que passem pela área de transferência).

### B31. A wiki dentro do Donel Dev, para aposentar o Obsidian (pedido do dono, 30/10 — "para rodar em outro dia")

**Pedido:** "Fazer a wiki ser parte do donel dev, para aposentar o obsidian."
**Ainda não começar:** o dono marcou para outro dia; precisa de discovery antes.

**O que existe hoje (fora do app):** o vault Obsidian "Claude Seazone" é a
documentação viva (contexto dos projetos, filas `PROXIMO.md` dos gatilhos do
CLAUDE.md, feedbacks privados, insights) e é lido/escrito pelas skills
`wiki-ingest`, `wiki-query`, `wiki-deposit`, `wiki-write` e `wiki-synthesize`
(via o plugin Local REST API do Obsidian + Bitwarden) e pelo MCP `obsidian`.
Neste PC o vault não tem `Projects/donel-dev/` (verificado em 30/10), então
há pelo menos dois lugares com cópias diferentes.

**Perguntas para o discovery:**
- Onde moram os arquivos: continuar como pasta de `.md` no disco (o Obsidian
  vira opcional e nada se perde) ou um banco do app? Recomendação inicial:
  pasta de `.md`, com o app sendo leitor/editor e índice.
- O que o app precisa ter para o Obsidian não fazer falta: navegação por
  pastas e links `[[...]]`, busca, edição markdown com prévia, backlinks,
  frontmatter, anexos, talvez o grafo (o Mindscape é parente).
- Como as skills `wiki-*` e o MCP passam a falar com o app em vez do plugin
  REST do Obsidian (um MCP local do Donel Dev, como o do navegador interno?).
- Sincronização entre os dois PCs (hoje OneDrive no outro PC) e o que é
  privado (feedbacks de liderados nunca saem da máquina).
- Migração: importar o vault atual sem quebrar links nem os gatilhos
  `PROXIMO.md` citados no CLAUDE.md.

### B32. Hibernar e acordar abas para economizar RAM — porta de entrada da orquestração (pedido do dono, 30/10)

**Pedido:** "Conseguir abrir/fechar abas, para economizar RAM sem deixar as
sessões lá esperando. Isso acabará se tornando uma ferramenta de orquestração.
Muitos falam do Herdr, mas existem várias ferramentas e quero que você seja
autônomo nisso." **A escolha da ferramenta/abordagem é do Claude**, sem pedir
aprovação de cada passo (mesma régua da autonomia de 28/10).

**Contexto:** a máquina dele fica em 73–86% de RAM com várias abas do
`claude` abertas; cada sessão parada segura um processo node do CLI (e o
xterm do renderer). Hoje fechar a aba perde o lugar dela; reabrir é ir em
Sessões anteriores e retomar.

**V1 proposta (execução, sem decisão de produto pendente):**
- "Hibernar" uma aba: encerra o processo do CLI só quando a sessão está parada
  (nunca no meio de um turno, nem com pendência aberta), guarda o
  `sessionId`, o nome, a cor, o projeto e o rascunho do chat, e deixa a aba
  visível esmaecida ("hibernada · clique para acordar").
- "Acordar": relança com `claude --resume <sessionId>` na mesma aba (o app já
  sabe retomar; ver Sessões anteriores e o fork).
- Hibernar sozinho, opcional: aba parada há N minutos e RAM acima de um
  limite (o painel de saúde do PC já mede RAM).
- O semáforo, o Jobu, o Mindscape e a caixa de atenção tratam "hibernada"
  como estado próprio (não é "terminou", não é "trabalhando").

**Depois (orquestração):** fila de sessões que acordam para trabalhar e
voltam a dormir, sessão de fundo sem aba, despacho para vários repos. O B28
(herdr) já mostrou por que não adotar um runtime que não entrega os bytes do
PTY e ainda é beta no Windows; a escolha entre herdr, tmux-like próprio,
Claude Agent View (`claude agents`, `/bg`) ou nada externo é do Claude, com
spike curto quando precisar. Ver também `docs/produto/pesquisa-mercado-2026-10-30.md`
(Agent View, Conductor, Superset).

### B33. Botão "Atualizar versão" dentro do Donel Dev (pedido do dono, 31/10)

**Pedido:** um botão dentro do app para atualizar para a versão nova, sem sair
procurando o instalador.

**Como é hoje:** não existe atualização automática (`publish: null` no
`electron-builder.yml`, sem `electron-updater`). O alfa novo nasce toda manhã
pela tarefa "Donel Dev Alfa diario" (06:30) como
`Donel Dev Alfa-Setup-AAAA-MM-DD.exe` em `%USERPROFILE%\Donel Dev Alfa - diario\`;
beta e stable são buildados à mão no checkout de cada canal. A janela "O que
mudou" já aparece na primeira abertura de cada versão.

**V1 proposta (alfa):** o app compara a própria versão/data com o instalador
mais novo daquela pasta e, quando houver um mais novo, mostra "Versão nova
disponível · Atualizar" (rodapé ou menu). O clique fecha o app de forma limpa e
roda o instalador; ao reabrir, a janela "O que mudou" mostra a novidade.
Falha da build da manhã (`FALHOU.txt`) aparece no lugar do botão, com o log.

**Em aberto (decidir na spec):**
- Beta e stable: o botão só existe no alfa, ou o app também builda o canal a
  partir do checkout dele (mais lento, pode quebrar)?
- Sessões abertas na hora de atualizar: pedir confirmação, esperar os turnos
  terminarem ou hibernar e acordar depois (casa com o **B32**).
- Pasta e nomes vêm da config, nada fixo no código (vale também para o repo
  público, que não tem a tarefa agendada).
- Atualização automática de verdade (`electron-updater` + GitHub Release
  privado) é outro tamanho de feature; ver **B17**.

### B34. Mindscape organizado + agente do Mindscape (pedido do dono, 31/10)

**Pedido:** "Só aparece uma sessão. Como podemos organizar isso melhor?" e, em
seguida: "Adicionar uma funcionalidade de agente do Mindscape, que organize as
ideias e entenda o contexto completo. Pode ser algo relacionado com a wiki do
Donel Dev" (**B31**).

**O que está acontecendo (medido no `mindscape.json` dele, 31/10):** o quadro
do Donel Dev guarda 10 posições de sessão e 8 post-its escritos por sessão, mas
só 1 aba está aberta. Pela regra 11 da V1, sessão sem aba não é desenhada; o
post-it dela fica, solto, sem o cartão ao lado. Somando os projetos, são ~44
post-its órfãos (BizOps 12, Homologação 11, Donel Dev 8...). Metade se chama só
pelo nome do projeto ("Donel Dev", "BizOps"), então não dá para saber de qual
conversa é cada um. Nada sai do quadro sozinho.

**Parte 1, sem agente (pode ir direto ao alfa):**
- Sessão fechada aparece como cartão **adormecido** (apagado, com a data), com o
  post-it dela colado embaixo; duplo clique retoma com `claude --resume`. Muda a
  regra 11 da V1 e casa com o **B32** (hibernar).
- Sessão e post-it se movem juntos.
- Botão **"Organizar"**: colunas por situação (precisa de você · trabalhando ·
  parada · fechadas por data); fechadas há mais de 7 dias vão para uma pilha
  "Antigas", recolhida.
- Quando o nome da sessão é o do projeto, o cartão mostra o primeiro pedido da
  conversa e a data no lugar.
- **Sessões favoritas são fixas (decisão do dono, 31/10):** o dono favorita
  quantas quiser, sem teto (mesma regra C4 da 007), e nada as muda: o
  "Organizar" não as move, elas nunca vão para "Antigas" e o agente da Parte 2
  não mexe nelas.
- **Direção do casco (dono, 31/10):** a barra lateral esquerda do Uso geral
  fica cada vez mais recessiva; o Mindscape passa a ser o lugar principal de
  achar e retomar sessões. Cada leva que dá ao Mindscape algo que hoje só a
  barra faz (favoritas, recentes, retomar) é uma chance de recolher a barra
  por padrão.

**Parte 2, o agente do Mindscape (precisa de discovery, porta A):**
- **Não é "do Claude" (decisão do dono, 31/10):** o motor do agente é
  escolhido pelo dono entre qualquer LLM conectado, inclusive a conta ativa.
  Nada fixo a uma IA: o agente fala com um contrato próprio do app, e cada
  motor é um adaptador. Ponto de partida: o registro de **Provedores** que já
  existe (011: classe A = compatível com Claude via env, classe B = CLI
  terceiro, hoje recusada no lançamento) e as **contas** do motor de contas.
  Provavelmente falta um adaptador de API HTTP genérica (formato OpenAI-
  compatível cobre a maioria dos LLMs e modelos locais); decidir no discovery.
- Sob demanda, o motor escolhido roda em segundo plano e lê os post-its do
  quadro, os do dono e, quando precisar, os transcripts das sessões.
- Propõe **temas** (ex.: "instalador alfa", "contas Seazone"), agrupa os
  cartões, sugere ligações e um título para cada grupo. O dono aceita ou desfaz:
  o agente nunca arquiva nem apaga sozinho.
- Cada tema vira (ou atualiza) uma **página da wiki do B31**, com o que foi
  decidido, o que está pendente e de quais sessões veio. O quadro é a vista
  rápida; a wiki é a memória.
- Em aberto: contrato mínimo do motor (só texto? precisa ler arquivo, ou o app
  entrega o contexto pronto?); custo por organização; se roda sozinho
  (ex.: ao fechar o dia) ou só quando o dono pede; formato da wiki (depende do
  B31).

### B35. Laya como "Sistema 1" do Donel Dev, aprendendo com o uso (ideia do dono, 31/10 — avaliar)

**Pedido:** "Pensar na possibilidade de instaurar a Laya aqui para ir aprendendo
e melhorando sempre."

**O que é a Laya** (`NandhaKishorM/laya`, Apache-2.0, já testada pelo dono no
BizOps em 09–11/10): um modelo pequeno e local que responde decisões tipadas
(`choice`, `score` em níveis, `noul` sim/não) e melhora com fine-tune nos
exemplos do próprio dono. Não é um LLM de conversa: é o "reflexo" rápido e
barato; o LLM (qualquer motor, ver B34) fica para os casos de baixa confiança.

**O que o BizOps já mediu (`BizOps/handoffs/laya-decisoes-2026-10-09.md`):**
- Sem treino, perde do palpite trivial (prioridade: 0,22 de acerto contra 0,54
  do "sempre MEDIUM"). Com ~400 exemplos rotulados e 3 h de treino em CPU,
  passa (0,60) e o sim/não chega a 0,875 de precisão.
- Peso: venv de ~950 MB + pesos de ~650 MB + checkpoint de 1,26 GB; resposta
  ~2 s por item em CPU. Precisa de Python.
- O modo sombra parou: 22 demandas registradas, **0** sugestões do Claude e
  **0** decisões do dono preenchidas. O registro dependia de um ritual à parte e
  não aconteceu.

**Como caberia aqui:**
- **Aprender com gestos que o dono já faz**, nunca com formulário: abriu a
  sessão logo depois do aviso, desfez o agrupamento do agente, dispensou o aviso
  do Jobu. Cada gesto vira um exemplo rotulado, guardado só na máquina.
- **Primeira decisão candidata:** "este fim de turno precisa de você?" (`noul`),
  lendo o post-it que a sessão escreveu (ex.: "Antes de gravar, preciso do seu
  sim" = sim). Alimenta o destaque do Mindscape, o aviso do Jobu (ver issue #109)
  e o "Organizar".
- **Depois:** em qual tema um post-it entra (`choice`), barateando o agente do
  B34: a Laya agrupa o óbvio, o LLM só vê o que ela não tem certeza.
- Retreino local periódico, e só troca o modelo se o novo vencer o atual nos
  mesmos exemplos de teste.

**Restrições:** adaptador opcional, desligado por padrão e fora do instalador
(roda como serviço local, `laya-serve`/`laya-mcp-server`); nenhum dado sai da
máquina (decisão do dono de 09/10); nada de Laya no repo público além do
contrato do adaptador. A Laya é um motor entre outros do contrato de decisão,
não uma dependência do app.

**Em aberto:** quantos exemplos os gestos geram por semana (medir antes de
treinar: sem volume, não vale a pena); se o primeiro modelo parte do checkpoint
do BizOps ou do zero.

### B36. Sessão nova em voo ao chegar no limite de contexto (pedido do dono, 03/11)

**Pedido:** "Quando chegar no limite de contexto proposto, abrir uma sessão nova no
background e fazer todo esse processo que acabou de fazer, de maneira que se o
usuário estiver na versão 'chat' nem perceba o que aconteceu (claro, pode deixar
avisado, como fica o 'Trocou em voo (era a {nome da conta})')."

**De onde veio:** sessão longa de homologação (03/11) que passou do orçamento de
contexto (~250k por sessão, ver memória "Sessões por orçamento de 250k"). O dono
pediu para "organizar tudo no vault" e recriar a sessão; o Claude então:
1. escreveu a passagem de bastão no vault (`Projects/<projeto>/handoff-<data>.md`):
   prioridade, estado de cada frente, comandos prontos, decisões do dia,
   rascunhos esperando OK, o que está agendado;
2. atualizou `context.md`, `todo.md` e o `log.md` do vault, e a memória do projeto;
3. transformou em pendência tudo que dependia da sessão viva (agendamentos de
   cron da sessão, agentes em background), porque a sessão nova não herda nada disso.
Hoje isso é manual e o dono precisa pedir, esperar e abrir a sessão nova à mão.

**Como deveria ser no Donel Dev:**
- **Gatilho:** o app mede o contexto da sessão (já mostra uso/limite na statusbar)
  e, ao cruzar o limite proposto (configurável; padrão ~250k), dispara a troca no
  fim do turno corrente — nunca no meio de uma ferramenta.
- **Passagem de bastão automática:** a sessão que sai roda o mesmo processo acima
  (handoff no vault + memória + pendências), num formato fixo que a sessão nova lê
  primeiro.
- **Sessão nova em background**, mesma pasta e mesma conta, aberta já com o handoff
  como primeira leitura; a aba/conversa do chat continua a mesma para o dono — o
  histórico visível não some, só o motor por trás muda.
- **Aviso discreto**, no mesmo padrão do "Trocou em voo (era a {conta})" da
  statusbar: ex. "Sessão renovada em voo (contexto cheio) — passagem de bastão:
  {link do handoff}".
- **O que NÃO pode se perder:** agendamentos (cron/loop) e agentes em background da
  sessão velha. Ou a troca espera eles terminarem, ou o handoff os lista e a sessão
  nova os recria/acompanha. Nunca matar o `claude.exe` velho com trabalho vivo.
- **Escrita a terceiros e produção:** a sessão nova herda as aprovações só pelo
  que está escrito no handoff (rascunhos aprovados × esperando OK), nunca por
  suposição.

**Em aberto:** onde fica o handoff quando o projeto não tem vault (pasta do projeto?
memória?); se o limite é por sessão ou por custo; se o dono pode vetar a troca
("agora não") e quanto tempo o app espera.

## Decidido, aguardando spec

- ~~**Restauração de sessões no restart**~~ — **CANCELADA em 2026-07-25 pelo
  próprio Alexandre.** A decisão de 23/07 era restaurar no boot as sessões com
  atividade no dia anterior. No discovery da **007** ele disse o oposto, e de
  forma direta: *"Não quero manter as sessões ativas, apenas acessar as últimas
  sessões de trabalho de maneira rápida."* O problema que motivava a
  restauração (voltar rápido ao trabalho de ontem) passa a ser resolvido pela
  `specs/007-favoritos-sessoes/` — grupo de projetos favoritados com as 5
  sessões mais recentes + as fixadas, em um clique. **Não implementar a
  restauração**: subir N sessões `claude` no boot custaria RAM e cota sem ele
  pedir. Se algum dia voltar, vira spec nova. Contexto original em
  `001-mvp/feedback-e2e.md` (rodada 5).

## Decisões pendentes que alimentam este backlog

- NFR de RAM (spec 001): re-baseline ~450–500 MB × task de otimização.
- Priorização geral da fila P1/P2 + itens B1–B5 acima.
