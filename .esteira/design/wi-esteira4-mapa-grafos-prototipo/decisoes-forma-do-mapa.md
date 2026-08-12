# Decisões de forma do mapa de grafos — fixadas pelo dono em 12/08/2026

> Fase **Design** do item `wi-esteira4-mapa-grafos-prototipo` · plano
> `pln-esteira4-forma-e-leitura` · repo `donel-dev`.
>
> Registro das decisões que o dono deu ao vivo na revisão deste design — em
> duas fontes: o veredito sobre o mockup (v3) e o esboço do caderno
> (`referencia-caderno-do-dono.png`, foto do planejamento original dele).
> Estas decisões são **requisito de forma** para a bancada do protótipo e
> para a issue do mapa; onde o mockup v3 e o caderno divergirem, **vence o
> caderno** — ele é a intenção original, o mockup é a aproximação.

## D-M1 — Estética Obsidian, forçada à horizontal

Grafo de nós circulares com rótulo embaixo, ar orgânico (força dirigida), mas
com viés horizontal: o tempo corre da esquerda para a direita no mapa inteiro.
A posição nasce de simulação com atração por profundidade no grafo — nunca de
coordenada à mão.

## D-M2 — Código de cores por estado

Concluído (verde) · rodando (azul) · esperando o dono (âmbar) · travado
(vermelho) · ainda não começou (cinza vazado). O estado é lido pela cor, de
relance, sem legenda obrigatória.

## D-M3 — Um nó por task do plano; nós pequenos para os arquivos

Cada task do plano é um nó próprio (médio). Cada arquivo/artefato gerado numa
etapa é um nó **pequeno** orbitando quem o gerou. Fases/gates são os nós
grandes.

## D-M4 — Hover é o mecanismo de leitura

Hover mostra descrição simples do que está sob o mouse e realça o nó + seus
vizinhos, apagando o resto (o gesto do Obsidian). Clique navega até o item
(mesmo `MapSelection` do carrossel — decisão herdada da vista atual).

## D-M5 — Duas físicas, separadas pela fronteira Plano+Design (do caderno)

- **À esquerda (Discovery):** um ARBUSTO — a raiz abre em muitos caminhos
  exploratórios (spikes, protótipos, research), com cruzamentos e
  convergências. Discovery é o nó mais povoado do mapa, não o mais vazio.
- **À direita (Implementar → Validar):** RAIAS horizontais, uma por item,
  correndo em paralelo, cada uma com seus nós pequenos, terminando no nó de
  entrega (PR).

## D-M6 — Becos sem saída ficam no mapa (do caderno)

Exploração de Discovery que morreu é desenhada com marca própria (o "x" do
caderno) e **permanece visível**. Caminho descartado é informação, não lixo.

## D-M7 — [SUPERADA] a faixa única "Plano+Design" do caderno é histórica

**Esclarecido pelo dono em 12/08, na sequência do registro:** o caderno
desenhava "Plano + Design" como faixa única porque era um planejamento
ANTIGO, anterior à evolução do catálogo. O que se preserva do caderno é a
ESTÉTICA (arbusto → convergência → raias, D-M5), não essa fusão: no mapa
real, Plano e Design são fases distintas, como o catálogo aprovado define
(Design roteada por item via `needsDesign`). Nenhuma decisão de apresentação
funde as duas.

## D-M8 — Loops desenhados como geometria (do caderno)

O ciclo fix↔validar aparece como laço visível na raia do item (o desenho do
caderno mostra o nó que sobe e volta), não como contador escondido. O teto do
laço segue sendo pergunta aberta do Discovery — o mapa só o torna visível.

## Consequência para a bancada (régua)

"Reproduz a forma fixada" (D-M1..D-M8) é o critério **eliminatório** da régua
da bancada. A pergunta do protótipo é: **qual motor reproduz esta forma com
menos briga?** Candidatos apontados (seleção final é de Implementar):
`d3-force` + SVG próprio, `sigma.js`/graphology (WebGL), React Flow
posicionado por `d3-force`. Atenção do teste: o arbusto do Discovery (D-M5)
pede física de força de verdade; as raias (D-M5) pedem contenção por
profundidade — o motor escolhido precisa das duas no MESMO canvas.

## Expectativa registrada sobre o contrato (fora do escopo deste item)

Hoje spikes/protótipos nascem como itens de plano (`item_type`), então
orbitariam o Plano no dado real. A expectativa do dono é vê-los ligados ao
Discovery (D-M5). Caminhos possíveis, a decidir quando a spec do mapa ou a
evolução do contrato forem discutidas: Discovery registrar mais
`artifact.recorded` próprios (já permitido), ou ligação explícita
spike→pergunta-do-Discovery (mudança de contrato).
