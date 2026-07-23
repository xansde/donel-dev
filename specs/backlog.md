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

## Decisões pendentes que alimentam este backlog

- Restauração de sessões no restart (rodada 5 do feedback-e2e): opções
  i/ii/iii investigadas, recomendação técnica = (iii) atalho "Retomar
  última sessão"; aguardando escolha do Alexandre.
- NFR de RAM (spec 001): re-baseline ~450–500 MB × task de otimização.
- Priorização geral da fila P1/P2 + itens B1–B5 acima.
