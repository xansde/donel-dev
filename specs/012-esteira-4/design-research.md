# Research — estrutura da fase Design (esteira 4.0)

> Item `wi-esteira4-design-research` · o que este documento é: a RESPOSTA do
> spike, para ratificação do dono antes da spec `design.md`. Cada resposta
> carrega a evidência que a sustenta (fonte lida, com caminho ou URL).
>
> Forma deste documento: o mockup da fase Design
> (`.esteira/design/wi-esteira4-design-research/mockup-resposta-research.md`).
> Alcance: a pergunta aberta que o Discovery devolveu ("a fase menos
> estruturada") dentro do contorno que o Plano fixou (discovery técnico da
> estrutura-alvo, mapa em HTML com Mermaid, validação humana, reescrita das
> tasks do Plano). Este documento propõe; quem fecha é a ratificação — e a
> spec normativa é do item irmão, `design.md`.

## 0. Insumos lidos

| Fonte | O que se extraiu |
|---|---|
| `github.com/mattpocock/skills` (branch `main`): `skills/engineering/{research,wayfinder,prototype,improve-codebase-architecture,codebase-design,domain-modeling,to-spec,to-tickets,ask-matt}/SKILL.md`, `improve-codebase-architecture/HTML-REPORT.md`, `skills/productivity/{grilling,handoff,writing-for-agents}/SKILL.md`, `.out-of-scope/question-limits.md`, `AGENTS.md`, `CONTEXT.md` | Como um repo maduro estrutura discovery técnico dirigido: research contra fonte primária com citação; relatório HTML autocontido (Tailwind+Mermaid CDN) que termina num gate humano; "fog of war" (mapa deliberadamente incompleto); critério de terminado checável por passo; regeneração de tickets a partir de decisão (nunca patch cego) |
| As três rodadas manuais da Design da 012: `.esteira/design/wi-esteira4-catalogo-fases/`, `wi-esteira4-motor-spec/`, `wi-esteira4-conversa-spec/` (+ a quarta, migrada: `.esteira/ciclos/dsc-15a7e7f5-fbb/itens/wi-esteira4-layout-esteira-dir/design/`) | O molde empírico que funcionou: `diagrama-arquitetura.md` com cabeçalho de proveniência, lista de insumos com caminho, seções numeradas intercalando Mermaid + texto proposto + tabelas, e seção final de perguntas em aberto; mockup HTML autocontido com telas simuladas |
| `specs/012-esteira-4/catalogo.md` (§3.3, §4, §6 `[F-1..F-4]`, §7 `[P-1]`), `motor.md` (:56, :108, :192-274), `conversa.md` (:167, :203-204, :297, :394, :420) | O que já está ratificado sobre a fase: contorno do "Faz/Devolve/Roda", roteamento `[D-11]`/`[P-1]` (`needsDesign` no nó do grafo, derivado, nunca duplicado), gate "Você valida o Design" como parada da máquina de estados, e o requisito de alto nível da reescrita de tasks — sem mecânica normatizada em nenhuma das 4 specs |
| `.esteira/validar/wi-esteira4-catalogo-fases/review-2026-08-08.md`, `wi-esteira4-motor-spec-review.md`, `wi-esteira4-conversa-spec-review.md` | O que o dono aproveitou na validação (conteúdo conceitual dos diagramas, quase literal nas specs) e o que ficou sem uso (o HTML dos mockups não é citado linha a linha; os artefatos de Design não são re-revisados na Validar) |
| `~/.claude/skills/esteira-design-3/SKILL.md` + `.esteira/ciclos/dsc-15a7e7f5-fbb/runs/` (nenhum run com `"fase": "design"`) | O processo normativo 3.0 da fase (Iron Law dos dois artefatos ou nota) e o fato de as três rodadas terem sido manuais — o corpus é dos artefatos, não do fluxo formal |
| Itens completos SEM Design: `wi-011-etapa1-motor-mods`, `wi-demolicao-perfis-migracao`, `wi-registry-providers-classe-a` (ctx + handoffs em `.esteira/plano|implementar|validar|documentar/`) | Os exemplos reais do lado "não roteia" do critério da seção 4 |

## 1. O que a fase Design FAZ por dentro

Resposta à pergunta aberta do Discovery. Cinco passos, na ordem — cada um com
insumo → produto → quem consome. O desenho junta o molde empírico das três
rodadas (que o dono validou e cujo conteúdo entrou quase literal nas specs)
com as disciplinas do mattpocock/skills que faltavam nele (fonte primária
citada, critério de terminado por passo, gate explícito no fim).

**Passo 1 — Resolver os insumos.**
Insumo: o `run-input.json` (item + tasks do Plano) e as decisões já
ratificadas que tocam o item. Produto: a lista de insumos com caminho exato,
que abre os artefatos (o cabeçalho de proveniência das três rodadas —
presente nos três `diagrama-arquitetura.md`). Consome: todos os passos
seguintes, e o dono na validação — é o que permite auditar de onde cada
proposta veio.
*Evidência:* os três diagramas abrem com "insumos lidos com caminhos exatos";
`research/SKILL.md` do mattpocock exige "seguir toda alegação até a fonte que
a possui".

**Passo 2 — Discovery técnico dirigido da estrutura-alvo.**
Insumo: o código/API/tabelas/tools/infra REAIS que as tasks tocam — lidos na
fonte, não por resumo. Dirigido: só o território das tasks, não varredura
livre do repo. Produto: o levantamento factual (o que existe hoje, o que a
estrutura escolhida precisa tocar). Consome: o passo 3.
*Evidência:* `improve-codebase-architecture/SKILL.md` escopa antes de
escanear ("hot spots via git log", lê `CONTEXT.md`/ADRs); o relatório de
melhoria de 04/08 (`docs/relatorio-melhoria-sessao-2026-08-04.md`, falha 2)
registra o custo de referência aceita sem leitura.

**Passo 3 — Decidir a estrutura e desenhá-la: o diagrama de arquitetura.**
Insumo: o levantamento do passo 2. Produto: `diagrama-arquitetura.md` no
molde das três rodadas — seções numeradas intercalando Mermaid + texto
proposto + tabelas, obrigatoriamente com: a tabela "o que o item toca / não
toca" e a seção final de perguntas em aberto (vazia é resposta válida).
Consome: a spec do item (na 012, as três specs transcreveram esse conteúdo
quase literalmente — `catalogo.md` §6 `[F-1..F-4]` e §7 vêm do diagrama de
`wi-esteira4-catalogo-fases`) e a fase Implementar.
*Evidência:* seção 2.2 do levantamento local — o conteúdo conceitual dos
diagramas foi o que as specs aproveitaram; as divergências foram declaradas e
resolvidas a favor da spec (`catalogo.md:379-384`), nunca silenciadas.

**Passo 4 — Dar forma visível: o mapa HTML (com mockup quando há UI).**
Insumo: o diagrama do passo 3. Produto: o HTML da seção 2 abaixo. Consome: o
dono, no gate "Você valida o Design" — este artefato existe para ser LIDO por
um humano em uma passada, não para alimentar spec.
*Evidência:* o contorno do Plano ("mapa entregue como HTML com diagramas
Mermaid") + o precedente exato em `improve-codebase-architecture/HTML-REPORT.md`.

**Passo 5 — Reescrever as tasks invalidadas e declarar os fatos.**
Insumo: a estrutura decidida no passo 3 confrontada com as tasks do Plano.
Produto: as tasks reescritas (mecânica na seção 3) + os fatos do contrato
(`artifact.recorded` ×2 ou nota justificando, `phase.completed`). Consome: o
motor (que para no gate) e a fase Implementar (que parte das tasks já
corrigidas, não de duas versões competindo).
*Evidência:* `catalogo.md` §3.3 ("reescreve as tasks do Plano quando a
estrutura escolhida as invalida"); `wayfinder/SKILL.md` ("se a decisão
invalida outras partes do mapa, atualiza ou deleta esses tickets").

Critério de terminado da fase (no padrão `writing-for-agents`: condição
checável, não sensação): os dois artefatos existem (ou nota justificando o
ausente), a seção de perguntas em aberto está explícita, as tasks invalidadas
foram reescritas com rastro, e os fatos foram emitidos. Aí a fase PARA — o
gate é do dono, nunca da própria fase.

## 2. O que a fase ENTREGA e em que forma

O contorno do Plano: mapa como HTML com diagramas Mermaid. A research
responde estrutura, morada e recepção pelo gate.

**Estrutura do HTML** — um arquivo autocontido (CSS inline, sem CDN — o app
abre offline), no molde híbrido das rodadas empíricas + `HTML-REPORT.md` do
mattpocock:

1. **Cabeçalho de proveniência** — item, plano, data, insumos lidos, e a
   cláusula de conflito ("forma vence o design; alcance vence a spec").
2. **O mapa da estrutura-alvo** — uma seção por face do que o item toca, cada
   uma com o diagrama Mermaid do tipo certo:
   - encaixe/dependências entre módulos → `flowchart` (usado nas 4 rodadas);
   - ciclo de vida/estados → `stateDiagram-v2` (motor-spec, seção 2);
   - protocolo/handshake entre processos → `sequenceDiagram` (motor-spec,
     seção 4, o "conserto do Enter");
   - dados (tabelas, formatos de arquivo) → tabela HTML ou diagrama ER.
   Regra do mattpocock que vale adotar: Mermaid para o que tem forma de
   grafo; visual editorial (HTML/SVG à mão) para o resto — "não apoiar tudo
   em Mermaid, começa a ficar genérico".
3. **Telas simuladas (mockup)** — apenas quando o item tem superfície de UI.
   Nas rodadas empíricas os mockups de tela foram o artefato MENOS
   aproveitado (seção 2.4 do levantamento: as specs citam o conceito dos
   diagramas, nunca o HTML das telas linha a linha) — para item sem UI, esta
   seção é substituída pela nota justificando, como o §3.3 do catálogo já
   permite. (Formalizar isso no "Devolve" é a [P-A] da seção 5.)
4. **O que muda nas tasks** — a tabela de reescrita da seção 3, visível no
   próprio mapa: o dono valida a estrutura E a consequência dela no plano num
   único gesto.
5. **Perguntas em aberto** — espelho da seção homônima do diagrama, no padrão
   das `[P-n]`.
6. **Fecho de gate** — o documento termina perguntando, não afirmando: o que
   precisa do OK do dono, um item por linha. Precedente: `HTML-REPORT.md`
   termina com "Which of these would you like to explore?" antes de qualquer
   avanço.

**Onde mora**: `.esteira/ciclos/<dsc>/itens/<wi>/design/` (layout v2), ao
lado do `diagrama-arquitetura.md` — endereço já praticado pela rodada
migrada de `wi-esteira4-layout-esteira-dir` (git mv registrado no run
`20260808T015705317Z--implementar--run-8ac1a2d4-7e4.json`). Versionado no
repo alvo, nunca em temp: diferente do mattpocock (que joga o relatório em
tmpdir), aqui o artefato é registro do ciclo e o `artifact.recorded` exige
ponteiro que resolve.

**Como o gate recebe**: o motor, ao derivar que o próximo nó do canônico é o
gate "Você valida o Design", transiciona o card `Rodando → Esperando`
(`motor.md:108`) — e a tela do gate abre o HTML (é para isso que ele é
autocontido). A decisão do dono no gate é `decision.recorded`; reprovar não é
estado terminal do item — para onde volta é a [P-D] da seção 5.

## 3. Como a fase REESCREVE as tasks do Plano

Requisito do Plano: reescrever, NÃO gerar um segundo conjunto que compete. A
mecânica proposta, em três regras:

**O que pode mudar**: as tasks do próprio item ainda não iniciadas —
decomposição, ordem, conteúdo técnico, e criação/remoção de tasks que a
estrutura escolhida exige ou tornou órfãs. A edição é feita NO arquivo de
tasks que o Plano deixou, in-place: um conjunto só, sempre. É o padrão do
`wayfinder` ("atualiza ou deleta esses tickets" quando uma decisão os
invalida) — nunca o antipadrão que o Plano proibiu (dois conjuntos
competindo), e nunca patch incremental às cegas: cada mudança deriva de uma
decisão de estrutura nomeada no diagrama.

**O que é imutável**: o alcance. O escopo do item, as decisões ratificadas de
Discovery/Plano (`[D-n]`, `decision.recorded`) e o critério de aceite não são
reescreviveis pela Design — se a estrutura descoberta contradiz o alcance, a
fase não "conserta" a task: devolve a contradição como pergunta em aberto e o
item para no gate. É a mesma regra de conflito já ratificada no §3.3
("alcance ou comportamento → vence a spec, e a divergência vira nota, não
silêncio"), aplicada às tasks.

**Como fica rastreável para a Validar**: dois rastros, um mecânico e um
declarado —
1. a reescrita é um commit próprio na branch do item, só com o diff das
   tasks (o git é a trilha do "antes → depois");
2. um fato declarado no result da fase apontando esse commit e listando, por
   task alterada, QUAL decisão de estrutura a invalidou (formato: `task →
   decisão → o que mudou`). A mesma tabela aparece no HTML (seção 2, bloco
   4), então o dono valida a reescrita no próprio gate.
Hoje o contrato não tem fato específico para isso — se `note.recorded` basta
ou se nasce um fato próprio é a [P-B] da seção 5. O que a research fixa é o
invariante: reescrita sem rastro declarado não existe (o mesmo princípio da
Iron Law da Implementar — o que não se declara, não aconteceu), e a Validar
confere o diff das tasks contra a tabela declarada (hoje ela não re-revisa
artefatos de Design — review de `wi-esteira4-catalogo-fases`, linhas 89-90 —
mas tasks reescritas não são artefato de Design: são o plano vigente, e
entram no escopo da review; é a [P-C]).

## 4. Quando um item é roteado a Design

`[D-11]`: Design não é oferta livre; zero é o caso comum. O `[P-1]` já fixou
ONDE o roteamento vive (aresta fixa no canônico; `needsDesign` no nó do card,
escrito pelo Plano, derivado pelo app). O que faltava é o critério OBJETIVO
que o Plano aplica ao escrever `needsDesign`. Proposta — roteia a Design se
pelo menos UM vale:

1. **Fronteira nova ou movida com mais de uma forma viável** — o item cria ou
   muda API, tabela, contrato entre módulos, formato de arquivo ou protocolo,
   E existe mais de um desenho defensável. Uma escolha errada aqui invalida
   as tasks — exatamente o que o gate existe para impedir ("estrutura errada
   aceita em silêncio custa o plano inteiro", `catalogo.md` §4).
2. **Superfície de UI nova** — tem tela ou fluxo visual que o dono precisa
   ver antes de alguém codar (o lado "mockup" do par).
3. **Tasks condicionais** — o Plano só conseguiu escrever as tasks assumindo
   uma estrutura ainda não decidida ("se formos por X..."). Task condicional
   é o "fog" do wayfinder dentro de um item: a pergunta é enunciável com
   precisão, mas a resposta ainda não existe — e respondê-la é Design.

Teste negativo (vai direto a Implementar): as tasks do Plano determinam a
estrutura univocamente — correção de bug, extensão de módulo existente cujo
contrato não muda, refactor mecânico, item documental.

Exemplos reais dos dois lados:

| Lado | Itens | Por quê |
|---|---|---|
| Roteou (de fato passou por Design) | `wi-esteira4-catalogo-fases`, `wi-esteira4-motor-spec`, `wi-esteira4-conversa-spec`, `wi-esteira4-layout-esteira-dir` | todos definiam estrutura com mais de uma forma viável (grafo canônico, máquina de estados do motor, costura vivo/assíncrono, layout do `.esteira/`) — critério 1, e o catálogo também o 3 |
| Não roteou (ciclo completo sem Design, sob o kit 2.1.0) | `wi-011-etapa1-motor-mods`, `wi-demolicao-perfis-migracao`, `wi-registry-providers-classe-a` | a estrutura já estava decidida pela spec 011 — as tasks eram unívocas; nenhum teria passado no critério |
| Não roteou (o próprio item desta sessão, sob a 012) | `wi-esteira4-design-research` teve Design PARCIAL: mockup do formato da resposta, diagrama dispensado com nota | ilustra o par "critério 2 sem critério 1": havia forma a validar (o esqueleto da resposta), não havia fronteira de sistema |

Quem aplica o critério é o gate do Plano (o roteamento é `decision.recorded`,
`conversa.md:203-204`) — o critério dá ao Plano a régua e ao dono o motivo
escrito na linha desabilitada (`[D-11]`, mesmo padrão do item sem repo alvo).

## 5. Perguntas que a research devolve SEM responder

No padrão das `[P-n]`, prontas para a ratificação — o que só o dono fecha:

- **[P-A] O par de artefatos vira condicional por natureza do item?** Hoje o
  §3.3 exige mockup E diagrama (ou nota para o ausente). A evidência empírica
  diz que mockup de tela só pagou o custo quando havia UI (seção 2.4 do
  levantamento). Proposta em cima da mesa: o "Devolve" passa a ser "mapa HTML
  (sempre) + diagrama .md (sempre) + telas simuladas dentro do HTML (quando
  há UI, senão nota)". Muda texto ratificado do catálogo — só o dono.
- **[P-B] A reescrita de tasks ganha fato próprio no contrato?** A seção 3
  exige rastro declarado; `note.recorded` serve hoje, mas um fato tipado
  (task → decisão → mudança) deixaria a Validar conferir mecanicamente.
  Mudança de contrato — só o dono.
- **[P-C] A Validar passa a conferir a reescrita?** Hoje a review não
  re-revisa artefatos de Design (precedente registrado na review do
  catálogo). A research propõe que tasks reescritas entram no escopo da
  review (são o plano vigente, não artefato de fase fechada) — confirmar é
  régua de review, decisão do dono.
- **[P-D] Gate "Você valida o Design" reprovado: o item volta para onde?**
  Re-rodar Design contradiz o "0 ou 1× por item" do §3.3 lido ao pé da
  letra; voltar ao Plano reabre um gate já fechado. Nenhuma das 4 specs
  responde. A fila precisa da resposta para não inventar a dela.

## 6. Ratificação (dono, 2026-08-10)

As quatro perguntas foram respondidas pelo dono na própria sessão da Validar
deste item — cada resposta abaixo é decisão, não proposta, e a spec `design.md`
(item irmão) escreve o texto normativo a partir daqui:

- **[P-A] RATIFICADA a proposta.** O "Devolve" da fase passa a ser: mapa HTML
  (sempre) + diagrama `.md` (sempre) + telas simuladas dentro do HTML apenas
  quando o item tem superfície de UI; sem UI, nota curta. Emenda o texto do
  §3.3 do catálogo.
- **[P-B] Fato próprio no contrato.** A reescrita de tasks ganha registro
  tipado (task → decisão de estrutura → o que mudou); `note.recorded` deixa de
  ser o veículo. Mudança de contrato a especificar em `design.md`.
- **[P-C] Sim.** Tasks reescritas entram no escopo da review da Validar — ela
  confere o diff das tasks contra o fato declarado. Mockup e diagrama seguem
  fora da re-revisão (precedente mantido).
- **[P-D] Volta ao Plano.** Reprovação no gate "Você valida o Design" devolve o
  item à fase Plano: o desenho reprovado é sinal de plano mal posto, e o gate
  do Plano reabre para o item. O "0 ou 1× por item" do §3.3 fica intacto por
  passagem — a nova passagem pelo Plano pode rotear a Design de novo.
