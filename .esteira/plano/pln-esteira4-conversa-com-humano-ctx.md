# Contexto do plano — pln-esteira4-conversa-com-humano

Fase Plano rodada em 09-10/08/2026 (run `run-7a2a0410-101`). Item único emitido:
`wi-esteira4-conversa-spec` — spec dos gates Discovery e Plano da esteira 4.0, um
arquivo em `specs/012-esteira-4/`, ao lado de `catalogo.md` e `motor.md`.

Este arquivo é o **dossiê de leitura das referências** que o dono nomeou no
discovery. Todas foram LIDAS (por subagentes de exploração, 10/08) — a sessão que
escrever a spec parte daqui, não do zero. Instrução explícita do dono: **adaptar ao
propósito da esteira, não copiar** skills/agentes/repos.

## Restrições já fixadas (não reabrir)

- Catálogo ratificado 09/08: Discovery e Plano são `kind=gate` (`catalogo.md`
  §3.1/§3.2, `[F-4]`) — fecham com decisão humana ao vivo, 1× por assunto/plano.
- Emenda do dono (09/08): o insumo do Plano é **"um assunto fechado"** (um só e
  inteiro), não "uma spec".
- Do discovery: pesquisa/protótipo/spike/formulário voltam como **material de
  decisão, nunca como decisão tomada**; Discovery gera os planos + perguntas
  abertas; Plano gera tasks + evals (quando o alvo é processo agêntico), sequência
  de merge e roteamento a Design.

## Fontes lidas

### 1. Discovery do IA Hub — três repos `seazone-tech`

- **`discovery-agent`** (clonado em `C:/Users/xansd/seazone/discovery-agent`) — a
  versão v2, em produção: skill `/discovery` de 8 etapas (entender → classificar →
  perguntas por tipo → pesquisas profundas → viabilidade/T-shirt → faseamento →
  validação+review → handoff). Pesquisadores (Slack/Jira/GitHub/Nekt) e designer
  rodam em subagentes background; entrevista é "uma pergunta por vez", papel de
  questionador ativo (confronta solução-antes-de-problema; só registra "decisão do
  cliente" se o stakeholder insistir).
- **`discovery`** (clone shallow no scratchpad da sessão; repo remoto
  `seazone-tech/discovery`) — versão v1/experimental como app Next.js+Supabase:
  state machine de 9 stages (`DISCUSS→CLASSIFY→DEEPEN→RESEARCH→DESIGN→CONSOLIDATE→
  REVIEW→DELIVER→FEEDBACK`) com flow profiles por tipo de demanda (bugfix pula
  RESEARCH/DESIGN). Aparentemente pausada em favor da skill — não misturar as duas
  como se fossem um sistema coeso.
- **`discovery-handoffs`** (clone shallow no scratchpad) — só o repositório de
  saída/publicação (site estático com 21 handoffs reais). Vale como corpus de
  exemplos do formato; a convenção `AAAA-MM-DD-nome/` com handoff.md + mockups +
  diagramas é reaproveitável, a camada de publicação pública não.

**Mecânicas a ADAPTAR (as mais valiosas):**

1. **Gate de qualidade combinado** (`discovery/src/lib/agent/validators/quality-score.ts`):
   4 eixos (clareza_problema, completude_requisitos, profundidade_tecnica,
   objetivo_negocio); score = 0.3×determinístico (% campos obrigatórios do eixo) +
   0.7×LLM (checkpoint a cada 3 mensagens, modelo barato); threshold mínimo por
   estágio × tipo de demanda. É a resposta mais defensável para "quando o Discovery
   pode fechar" — melhor que heurística de prosa.
2. **Checklist declarativo por tipo de demanda** (`discovery/src/lib/agent/validators/checklist.ts`):
   5 tipos (bugfix/ajuste/evolucao/feature/produto), campos `required` por fase,
   `getMissingRequired()` puro decide "pode avançar".
3. **Pesquisa é material, nunca decisão** (nos dois repos): pesquisadores
   assíncronos com timeout (45s no app); falha vira marcador explícito
   (`[NEEDS TECHNICAL REVIEW — pesquisa X indisponível]`) em vez de travar ou
   inventar; o handoff nunca espera pesquisador morto.
4. **Handoff em Parte A (negócio, legível) / B1 (spec imutável) / B2 (plano
   sugerido, alterável)** — exemplo real com 741 linhas em
   `discovery-agent/handoffs/2026-03-23-simulador-tir-szi/handoff.md`. B1 é o
   melhor modelo do "assunto fechado" que o Discovery entrega ao Plano; B2 é insumo
   bruto (não decisão) para tasks+evals. Inclui Registro de Decisões (D1..Dn com
   contexto e quem decidiu), Fora de Escopo explícito, Itens Pendentes com owner.
5. **Revisor com BLOCKER/WARNING calibrados** (`discovery-agent/prompts/revisor-handoff.md`):
   score X/10, calibração escrita ("seção poderia ser mais detalhada" NÃO é
   problema; "dev não sabe em qual repo codificar" É blocker), máximo 3 iterações,
   depois escala ao humano — nunca libera sozinho.
6. **Aprovação explícita e idempotente do autor** (app, US-04/RN-02): quem fecha o
   ciclo é o humano num gesto; falha de integração externa não invalida o trabalho
   feito, só deixa o gesto disponível para retry.

**NÃO copiar:** MCPs corporativos (Slack/Jira/Nekt), roteamento para squads, cadeia
CTO→EM, servidor visual companion (cliente não-técnico no browser), publicação
pública com sanitização de PII, Supabase/RLS/Next multiusuário.

### 2. Kit Matt Pocock (`C:/Users/xansd/seazone/spotsys/.claude/skills/`)

- **`wayfinder`** — a referência mais valiosa para a fronteira Discovery/Plano.
  Tipologia **HITL vs AFK por tipo de ticket**: `research`=AFK, `prototype`=HITL,
  `grilling`=HITL (default), `task`=HITL-ou-AFK — é exatamente o vocabulário para
  "o que se pergunta ao vivo vs. o que se busca assíncrono". Mais: **fog of war**
  (teste: "consigo formular a pergunta com precisão agora?" — sim=ticket,
  não=fog), **out-of-scope nunca regressa a fog**, mapa é índice (decisão vive num
  lugar só), claim por atribuição antes de trabalhar, "plan, don't do", assets de
  research/protótipo ficam **linkados na resolução, nunca colados como decisão**.
- **`prototype`** — throwaway desde o dia 1, nomeado como tal; **declarar a
  pergunta por escrito antes de codar**; dois ramos (LOGIC: módulo puro + TUI
  mínimo; UI: 3 variantes estruturalmente diferentes com switcher); captura ao
  final: decisão validada funde no código real, protótipo vai para branch
  throwaway com ponteiro de contexto. Quando ambíguo sem humano: decide e
  **declara a suposição no topo**.
- **`research`** — AFK puro: subagente background, **fontes primárias
  obrigatórias com citação por claim**, output = 1 arquivo .md em local de
  convenção do repo (declarado se não houver convenção).
- **`grill-with-docs`** — uma linha: roda `/grilling` usando `/domain-modeling`.
  Prova que gate pode ser composição de skills existentes (a entrevista do
  Discovery 4.0 pode reusar `/grilling` em vez de reinventar).
  `disable-model-invocation: true` — só roda quando chamada.
- **`to-spec`** — o análogo em espírito do gate Plano: **não entrevista**, só
  sintetiza o que a conversa já fechou. Template com campos nomeados (Problem
  Statement / Solution / User Stories / Implementation Decisions / Testing
  Decisions / Out of Scope); regra "sem paths nem snippets — exceto quando um
  protótipo encapsula a decisão melhor que prosa (aí inline, com nota da
  origem)"; **seams de teste**: preferir existentes, a mais alta possível, ideal
  uma só, e o ÚNICO checkpoint humano é confirmar as seams.

**NÃO copiar:** acoplamento ao tracker do Spotsys (labels `wayfinder:*`,
`ready-for-agent`, child issues + blocking nativo do GitHub), stack frontend
(`?variant=`, Tailwind), `/setup-matt-pocock-skills`. A regra "1 ticket por
sessão" não vale para o Plano da esteira (que gera todas as tasks de uma vez).

### 3. `no-mistakes` (`~/.claude/skills/no-mistakes/`, global)

Já decidido (07/08): roda entre Implementar e Validar. O que a spec dos gates pode
emprestar dela:

- **Tríade `auto-fix` / `no-op` / `ask-user`** como régua de escalação: tudo que
  seria `ask-user` (desafia intenção deliberada ou toca comportamento de produto)
  = pergunta ao vivo no gate; o resto pode ir para busca assíncrona. Finding
  `ask-user` é relatado **verbatim**, nunca parafraseado/pré-julgado.
- **`--intent` obrigatório** ("o objetivo por trás, não a descrição do diff,
  enriquecido com tradeoffs da conversa") — o "assunto fechado" que o Plano
  consome deve carregar o equivalente, para o Plano não reinterpretar decisão
  tomada como achado a revisitar.
- **Gate ativo não se contorna por atalho do agente** — só se resolve pela
  resposta certa ao gate.

**NÃO copiar:** a mecânica CLI (`axi run/respond`, TOON, monitor de PR) — é
produto pronto, a esteira só o invoca.

## Ênfase do dono (10/08, ao vivo)

**O wayfinder é a referência MAIS importante** do dossiê — a tipologia HITL/AFK e o
fog of war são o coração do que a spec dos dois gates precisa formalizar.

## O que NÃO copiar — consolidado (pedido do dono, 10/08)

Lista única, separada de propósito: tudo aqui é acoplamento das fontes que **não
atravessa** para a esteira 4.0. A sessão da spec trata isto como cerca, não como
sugestão.

**Do discovery do IA Hub (3 repos):**
- MCPs e integrações corporativas: Slack, Jira, Nekt, GitHub App própria, e-mail
  fixo do CTO.
- Roteamento para squads Seazone (AIOps/SIA/Dados/SRE) via `teams.md`.
- Cadeia de aprovação multi-humana CTO→EM (RLS por role, `approval_stage`).
- Servidor visual companion (Node+WebSocket para stakeholder não-técnico no
  browser) — overkill para esteira dev-facing.
- Publicação pública (GitHub Pages + checklist de sanitização de PII) — um
  diretório local de handoffs cumpre o papel de histórico.
- Stack de produto da v1: Supabase/RLS/Storage/Realtime, Next.js multiusuário,
  bot Slack dedicado.
- Misturar mecanismos da v1 (app) com a v2 (skill) como se fossem coesos — são
  duas implementações divergentes; a v2 é a atual.

**Do kit Matt Pocock:**
- Acoplamento ao tracker do Spotsys: labels `wayfinder:*` e `ready-for-agent`,
  child issues + blocking nativo do GitHub — adaptar a ideia (índice + itens +
  dependência), não a mecânica de issues.
- Stack frontend do `prototype`: `?variant=` no Next router, Tailwind/shadcn,
  gating por `NODE_ENV`.
- Dependência de `/setup-matt-pocock-skills` e do glossário de domínio pré-existente.
- A regra "1 ticket por sessão" ao pé da letra — o Plano da esteira gera todas as
  tasks de uma vez.

**Da no-mistakes:**
- A mecânica CLI inteira (`axi run/respond`, TOON, exit codes, monitor de PR,
  rebase automático) — é produto pronto que a esteira invoca, não reimplementa.
- O acoplamento a feature-branch/PR/CI do GitHub como forma — só o *padrão de
  decisão* (tríade + escalação única em `ask-user`) atravessa.

## Pendências herdadas para a sessão da spec

- A skill de discovery do IA Hub referida pelo dono é o MISTO dos três repos acima
  (dito por ele em 10/08) — os clones shallow de `discovery` e `discovery-handoffs`
  estão em scratchpad de sessão (efêmero); se a sessão da spec quiser reler o
  código-fonte, clonar de novo de `github.com/seazone-tech/{discovery,discovery-handoffs}`.
- Perguntas que o discovery deixou abertas e que NÃO são deste item: teto do laço
  fix↔validar (fechado no catálogo: 3 rodadas, definido pelo Plano) e estrutura da
  fase Design (plano irmão).
