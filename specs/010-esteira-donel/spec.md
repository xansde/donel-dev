# Spec — 010 Esteira do Donel Dev (modelo de estado próprio)

**Status:** 🟡 **RASCUNHO** (2026-08-03) — nasce da entrevista `grilling` desta mesma
data, com 16 decisões fechadas e 6 pendências propostas (seção final).
**Gate:** nenhuma linha de código antes do Alexandre bater o martelo nas pendências.

**Sucede a 009.** Onde as duas discordarem, vence esta. A `009-modo-dev-v3` fica como
registro do que foi construído — inclusive dos erros que motivaram esta.

> **Legenda de proveniência:** `[D-n]` decisão fechada no grill de 03/08 — é requisito,
> não inventar além disto · `[E]` evidência medida em disco/código em 03/08, com caminho ·
> `[P-n]` pendência proposta, aguardando decisão.

---

## Problema

**O app não tem estado próprio.** Ele tenta inferir o estado do trabalho lendo artefatos
que outra ferramenta grava, num formato que ela não promete manter — e quando a inferência
falha, o app **afirma uma inverdade** em vez de admitir que não sabe.

Três evidências de 03/08, todas do mesmo dia de validação:

1. **[E]** O card `cmrthtbye…` (F3, coluna Validar) tem `discovery-result.json` e
   `plano-result.json` com `status: success` em `dalton/.esteira/`. O app mostrou as duas
   fases como **não realizadas** — porque procura `outputs.plan_cards[]` e `outputs.fases[]`,
   campos que as skills 2.1.0 **não gravam**, na raiz `~/.claude/esteira-state/`, onde só
   existem fixtures de teste. Duas camadas com contratos diferentes, nenhuma errada
   sozinha.

2. **[E]** A fase de um card do repo `dalton` abriu sessão em `~/seazone/spotsys`, porque
   o repo vinha do dropdown de board e dois repos compartilham o mesmo board em
   `repos.json`. Havia um fallback silencioso para o projeto em foco, comentado no código
   como "palpite honesto". Palpite não é estado.

3. **[E]** A trava de fase é etiqueta remota (`esteira:em-andamento:<fase>`) e ficou
   **órfã** após uma sessão interrompida, bloqueando o card até `/esteira-liberar`.

O padrão comum: **o estado real vive em três lugares** (`<repo>/.esteira/`,
`~/.claude/esteira-state/`, registro interno do app) e **nenhum é completo**. Consertar a
camada de apresentação — rótulo, navegação, foco — trata sintoma. Esta spec troca o modelo.

---

## Modelo

### Princípio

**Donel Dev e as skills da Esteira são atuadores; o sistema de registro é local.** O
tracker (hoje TaskDex) é um **plugue opcional**: quando existe, recebe reflexo de fatos;
nunca é consultado para saber estado. `[D-1]`

### Entidades

- **Discovery** — a raiz. Id próprio, o problema que define, referência **opcional** ao
  tracker (`{provider, cardId}`). Pode nascer sem repo: investiga um problema, não um
  repositório.
- **Plan** — um discovery produz N planos. É onde mora "o que vamos tratar".
- **WorkItem** — a unidade de trabalho. Tipada (abaixo), com repo e ciclo de vida.
- **Session** — cada sessão de terminal, amarrada a um alvo e a uma fase, guardando
  `sessionId` do CLI, cwd, modelo/esforço e tempos. É o que liga história de sessão ao
  trabalho.
- **Event** — log append-only de fatos. Fonte das métricas, do kanban e do que o adapter
  espelha.

### Tipos e ciclos de vida `[D-4]`

O tipo é **metadado**; o que varia de verdade é **o que significa terminar**. Três ciclos:

| Ciclo | Tipos | Termina quando |
|---|---|---|
| **Entrega de código** | `issue`, `spec` | PR mergeado e verificado |
| **Artefato revisado** | `process-map`, `adr` | documento publicado e aceito |
| **Pergunta respondida** | `prototype`, `spike`, `eval` | conclusão registrada — "não deu certo" é desfecho válido |

**Teste e CI/CD não são tipos.** Escrever a verificação é implementar; rodar a verificação
é validar. Tipo próprio para teste abriria a porta para issue concluída sem teste, com o
teste pendurado noutro card — enfraquecendo a disciplina de TDD do repo.

Glossário dos tipos, para não haver ambiguidade no uso:

- `issue` — trabalho de código definido; o *o quê* já está claro.
- `spec` — o que será construído, escrito antes de construir; a implementação é outro item.
- `process-map` — como um processo humano funciona e passa a funcionar; não é código.
- `prototype` — construção **descartável** que mostra como fica; o código não dura.
- `spike` — investigação **timeboxed** que responde uma pergunta fechada; "não dá" é
  resultado. Precedente no repo: **T001** (`CLAUDE_CONFIG_DIR` para perfis), bloqueante.
- `adr` — decisão que vale daqui para frente, com contexto e consequências. Só vira ADR o
  que **transcende o item**: se alguém em três meses precisaria saber o porquê e não
  descobriria lendo o código.
- `eval` — medição de sistema **não determinístico** contra casos conhecidos (golden set,
  replay, métricas, gate). Tem duas pernas: construir o harness (implementar) e rodar o
  gate (validar).

### Grafo `[D-5]`

O trabalho é um grafo com duas relações de primeira classe: **originou** (spike originou
issue; discovery originou plano) e **desagua em** (implementar ou validar — é o que dá
resposta rastreável a "por que esse gate existe?").

A forma esperada é a **ampulheta**: discovery expande, converge em specs, expande em
issues. Mas ela é **convenção, não lei** — bug direto é issue sem spec. O app **sinaliza**
desvios de forma visível no card (issue órfã, sem origem) e **nunca bloqueia**. Processo que
bloqueia na urgência é processo contornado.

**Camadas são layout, não estrutura.** Discovery/Planos/Implementação/Validação são a
disposição padrão do grafo na tela. Foi tratar nível como estrutura que fez tudo que não
cabia virar mentira ou invisibilidade.

### Repo: alvo × escopo `[D-6][D-7]`

- **Alvo** — onde a sessão abre e o PR acontece. `issue` tem **exatamente um**; sem repo,
  não dispara (é o que impede a repetição da evidência 2).
- **Escopo** — o que o artefato abrange: 0..N repos. Uma user story do Spotsys abrange
  front e back e por isso gera issues nos dois, cada uma com seu PR.
- Issues que precisam entrar juntas se ligam por **"entra junto"** — o co-merge fica
  visível, que é o erro caro no fluxo `spotsys`/`api-spotsys`.
- O item **herda** o repo do discovery por default, e pode ser trocado.

### Onde os artefatos moram `[D-8]`

- Documentação (`spec`, `process-map`, `adr`) vai para o **repo âncora da família** — no
  Spotsys, tudo em `spotsys`, mesmo afetando `api-spotsys`. O repo âncora é configuração
  do projeto.
- `prototype` e `spike` **nunca** vão para repo: são efêmeros, versionar não paga.
- Quando não faz sentido versionar, o artefato fica só no disco.
- O store guarda **o ponteiro** — "cadê o artefato?" tem resposta única, esteja ele onde
  estiver.

### Macro etapas derivadas `[D-13]`

A etapa do card de origem é **calculada** do grafo, nunca digitada — etapa marcada à mão é
a primeira coisa a ficar desatualizada, e etapa desatualizada é o "estado que mente".

| Situação | Etapa derivada |
|---|---|
| Discovery não iniciado ou em curso | Discovery |
| Discovery concluído, nenhum plano ainda | Discovery, com sinal "concluído sem plano" |
| Plano existe, nenhum item começou | Planejado |
| Qualquer item em curso | Execução |
| Todos os itens fechados ou abandonados | Concluído |
| Item reaberto depois de concluído | volta para Execução |

A segunda linha é exatamente o card F3 da evidência 1: um estado legítimo que o modelo
atual não sabia expressar. A última atende ao pedido literal de 01/08 — *"posso querer
voltar e refazer alguma etapa sempre"*: a etapa **retrocede**.

**Override** manual existe, sempre marcado como tal e com o valor calculado visível ao
lado — o ajuste nunca engana quem lê.

---

## Store `[D-9]`

- Mora no `userData` do app, **compartilhado entre os três canais** — como já é hoje, por
  decisão de 28/07, e sem problema observado.
- **Arquivo próprio**, fora do sanitizador de config, com **versão de esquema** no
  cabeçalho: canal que não entende a versão **lê o que consegue e não escreve**, em vez de
  reescrever por cima.
- **Eventos append-only** (JSONL) + snapshot derivado. No pior caso, um canal antigo ignora
  eventos que não entende; nunca apaga histórico.
- **Sem SQLite**: dependência nativa esbarraria na ABI do Electron a cada atualização — o
  mesmo problema que o node-pty já impõe.
- **Seed suportado**: caminho explícito para forçar discoveries em andamento direto nos
  dados, sem edição manual às cegas. `[D-2]`

---

## Contrato app ↔ skills `[D-10]`

**A skill grava `result.json` num local combinado; o app ingere.** A skill nunca toca o
store.

- **Schema versionado**, um arquivo só, referenciado pelos dois lados, com **teste de
  contrato em ambos**. É isso que impede um `plan_cards[]` de existir só de um lado.
- Documento fora do contrato → **erro de ingestão visível no card**, jamais o silêncio de
  hoje (campo ausente lido como "nunca aconteceu").
- Descartado: skill escrevendo direto no store (acopla a esteira ao formato interno) e
  skill chamando o app (exigiria o app rodando — e skill roda em terminal comum).
- Custo aceito: registro não é instantâneo, depende da ingestão (boot + watcher). Em troca,
  a esteira funciona com o app fechado e o rastro continua auditável a olho nu.

**Fork `esteira-donel-3.0.0`** `[D-3]` — livre para divergir da 2.x; a base comum é a
**estrutura de dados**, não o código. A 3.0 escreve **só** no formato novo: gravar nos dois
"por compatibilidade" é o que produziu o desencontro atual.

---

## Tracker: adapter opcional `[D-11][D-12]`

- **Trava é local**, com espelho opcional no board. A razão original da trava remota (o
  board era o registro) deixou de valer: o tracker agora é opcional, e a evidência 3
  mostrou o modo de falha da etiqueta órfã. A exigência que se preserva da decisão original
  é que a trava **não seja invisível**: ela é fato com dono, hora e sessão, aparece no card
  e libera num gesto.
- **Espelho só no card de origem**: etiqueta, comentário de conclusão resumindo o que
  nasceu, e movimentação pelas **macro etapas**, com o mapeamento etapa → coluna sendo
  **configuração** (as colunas mudam).
- Itens **não** viram cards no tracker automaticamente. Publicar um item é gesto explícito,
  quando outra pessoa vai tocá-lo.
- Espelho **nunca bloqueia** o trabalho local: falha vai para fila e reenvia, com o card
  mostrando "espelho pendente".

---

## Entrada e sessões `[D-14]`

- Sessão nova nasce **só** de: card do tracker **em Discovery**, ou discovery **local**
  novo.
- Card fora de Discovery **é bloqueado** neste primeiro momento. A liberação para outras
  etapas fica para depois, deliberadamente — a limitação será testada primeiro.
- Qualquer outra sessão é **continuação** de algo que já existe no store.

---

## Criação de itens `[D-16]`

Passa **sempre pela skill** — o app não ganha formulário de criação —, e pode ser invocada
a qualquer momento, não só ao fim do plano. Item criado pela skill nasce marcado como tal e
pode ser descartado num gesto, sem bloqueio.

---

## Fora de escopo desta entrega

- Métricas, gráficos e kanban visual (o store os viabiliza; a tela vem depois).
- Importação do legado — **o store nasce limpo** `[D-2]`.
- Liberação de entrada por etapas além de Discovery `[D-14]`.
- Qualquer trabalho novo sobre o mapa atual: **#41 e #42 ficam congelados** e **#35 será
  revertido** no desenho novo — ele pinta "não realizada" o que é, na verdade, "não
  consegui ler", que é pior que o bug original.

---

## Cadência de entrega `[D-15]`

1. **Passo zero** — schema do contrato e formato do store, escritos e revisados. Sem UI.
2. **Vertical pequeno** — um discovery **sem tracker**, de ponta a ponta: plano → item →
   disparo de fase → ingestão → mapa como projeção. Rede e board ficam de fora para que
   falha de contrato não seja confundida com falha de rede.
3. **Horizontal pequeno** — generalizar o que a fatia provou: tipos e ciclos completos,
   derivação de etapa, relações, trava, adapter do tracker, erros de ingestão.
4. **Verticais finais** — fases restantes, publicação sob demanda, kanban e métricas.

O risco aqui é **de modelo, não de código**: todo erro de 03/08 foi desencontro entre o que
uma camada grava e o que a outra lê, e isso só aparece com as duas rodando juntas sobre dado
real.

---

## Pendências (proposta aguardando decisão)

- **[P-1] Numeração e nome** — `specs/010-esteira-donel/` (este arquivo). Proposta: manter.
- **[P-2] Backup do store** — `userData` não sincroniza; máquina perdida leva histórico
  junto. Proposta: export periódico para o vault, **fora** do OneDrive em tempo real
  (append-only + sync gera conflito).
- **[P-3] Aposentadoria da 2.x** — sem critério, o fork vira dívida e as correções se
  dividem entre duas esteiras. Proposta: quando o Donel Dev rodar um card real de ponta a
  ponta, os repos migram e a 2.x sai de `~/.claude/skills/`.
- **[P-4] Fases de cada ciclo** — os nomes exatos das fases por ciclo de vida. Proposta:
  definir no **horizontal pequeno**, com uso real na mão, não antes.
- **[P-5] Remoção do código atual** — quando deletar `discovery-tree.ts`, o
  `esteira-reader` e o mapa atual. Proposta: ao fim do vertical pequeno, quando o novo
  provar a espinha.
- **[P-6] Granularidade da sessão** — uma sessão por item+fase, ou sessão livre associada
  ao alvo. Proposta: por item+fase, para a história do card ser reconstruível.
