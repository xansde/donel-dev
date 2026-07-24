# Backlog pós-MVP — Donel Dev

Melhorias registradas fora do ciclo 001-mvp. Fonte de cada item indicada.
Nada aqui entra em implementação sem passar pelo ciclo de spec
(specify → clarify → plan) — regra do projeto.

## Fila já especificada (spec 001, aguardando priorização do Alexandre)

- **P1**: US-8 tokens/smart zone · US-9 subagentes · US-10 post-its ·
  US-11 todo do projeto · US-12 quota das 15 contas · US-14 rotinas ·
  US-15 novo projeto decente · **auto-switch** (auto-seleção de perfil
  por headroom; insumo em `001-mvp/analise-switch-account-amanda.md`).
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

### B8. Painel de cotas de todas as contas (novo — feedback 23/07, rodada 6)

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
`~/.claude` e `~/.claude-profiles` seguem COMPARTILHADOS entre os canais, de
propósito, para o canal de teste ver as contas e a cota reais (é o que
permite testar perfis/quota de verdade). Consequência aceita: "Criar perfil"/
"Recriar links" no canal de teste mexe nas junctions REAIS.

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

**Reclassificação honesta dos vermelhos (era "6 misteriosos", agora nomeados):**

| Onde | Causa | Estado |
|---|---|---|
| `profiles.spec.ts` T014 | teardown 30 s → Causa 1 | **corrigida** |
| `model-injection.spec.ts` T011 | teardown 30 s → Causa 1 | **corrigida** |
| `previous-sessions.spec.ts` ×2 | dívida T013 (restauração de sessões) — asserções reais de feature | aberta, fora do B11 |
| `profiles.spec.ts` T014 (corpo) | Causa 2 — depende de sessão claude real | **aberta, decisão de desenho** |
| `tabs-lifecycle.spec.ts:174` | flake de contenção (passa isolado em 9,4 s) | mitigada na rodada 6 |

**O risco original do B11 está morto:** não há mais "vermelho misterioso" que
possa esconder uma regressão nova — cada um tem causa nomeada e verificada.

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

## Decidido, aguardando spec

- **Restauração de sessões no restart** (rodada 5 do feedback-e2e).
  **Decisão do Alexandre (2026-07-23):** restaurar as sessões que tiveram
  ATIVIDADE NO DIA ANTERIOR ao boot (critério de corte = atividade no dia
  anterior, não "toda sessão anterior sem limite"). Comportamento desejado
  registrado; feature NÃO implementada — ainda precisa do ciclo de spec
  completo (specify → clarify → plan) antes de qualquer código, incluindo
  detalhar: o que conta como "atividade" (última mensagem? último turno
  completo?), sessões `shell` (sem transcript, sem `-r` — provavelmente fora
  do escopo), e interação com a decisão A (aba inicial vazia, ver
  `001-mvp/feedback-e2e.md`) — a restauração passaria a ser a ÚNICA forma de
  o app abrir uma sessão claude sozinho no boot, então o clarify precisa
  reconciliar as duas decisões explicitamente.

## Decisões pendentes que alimentam este backlog

- NFR de RAM (spec 001): re-baseline ~450–500 MB × task de otimização.
- Priorização geral da fila P1/P2 + itens B1–B5 acima.
