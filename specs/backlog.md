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

**Gotcha de design (obrigatório, senão o isolamento não existe):** o canal tem
de ser **assado em tempo de BUILD** (`define` do electron-vite ou equivalente),
NUNCA lido de `process.env` em runtime — o app é aberto pelo atalho da Área de
Trabalho, que não carrega env nenhuma, e o canal de teste cairia no `userData`
do app de trabalho. Implementação prevista: segundo `electron-builder.beta.yml`
+ script `dist:beta`.

### B11. Smokes quebrados por drift do CLI `claude` (novo — medido 24/07)

Três smokes falham por mudança de TELA do CLI `claude` instalado
(v2.1.219), não por código do app: `profiles.spec.ts:83` (T014),
`model-injection.spec.ts:48` (T011) e `terminal.spec.ts:281` (T009). Eles
esperam a string `"Let's get started"` do wizard de 1º uso e recebem o banner
novo (`"Welcome to Claude Code v2.1.219"`) sem esse texto.

**Já medido, não é suposição:** a suíte foi rodada no commit pré-entrega da 002
(`7d1bbf9`) e os três JÁ falhavam lá — ver `specs/002-quota-headroom/tasks.md`
(T209). Somam-se aos 2 de `previous-sessions.spec.ts` (dívida T013, feature de
restauração de sessões) e ao flake de contenção de `tabs-lifecycle.spec.ts:174`
(passa isolado em 9,4s; falha só na suíte completa, com várias instâncias de
Electron competindo).

**Por que resolver:** com 6 vermelhos permanentes, a suíte deixa de ser um sinal
— o próximo gate vai ter de reclassificar tudo à mão outra vez, e o risco real é
alguém ler um vermelho NOVO como "já era vermelho". Proposta: ancorar as
asserções em algo estável do wizard (ou num marcador determinístico próprio) em
vez de na cópia da tela do CLI, que muda a cada release.

**Relacionado:** B9 (log de resultado de testes) — um registro carimbado com
commit tornaria essa reclassificação consultável em vez de re-executável.

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
