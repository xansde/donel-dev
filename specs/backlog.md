# Backlog pós-MVP — Donel Dev

Melhorias registradas fora do ciclo 001-mvp. Fonte de cada item indicada.
Nada aqui entra em implementação sem passar pelo ciclo de spec
(specify → clarify → plan) — regra do projeto.

## Fila já especificada (spec 001, aguardando priorização do Alexandre)

- **P1**: US-8 tokens/smart zone · US-9 subagentes · US-10 post-its ·
  US-11 todo do projeto · US-12 quota das 15 contas · US-14 rotinas ·
  US-15 novo projeto decente · **002-auto-switch** (auto-seleção de perfil
  por headroom; insumo em `001-mvp/analise-switch-account-amanda.md`).
- **P2**: US-13 Modo Dev (task → fases da Esteira, ui-spec §11) ·
  US-16 Donel buddy.

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
Alternativa a avaliar no clarify: o endpoint oficial de uso OAuth
(`api.anthropic.com/api/oauth/usage`, visto no script da Amanda) devolve
five_hour/seven_day direto, sem o overhead do npx — mas exige ler o token
do perfil, o que esbarra na regra "o app nunca lê credenciais". Decidir
explicitamente.

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
