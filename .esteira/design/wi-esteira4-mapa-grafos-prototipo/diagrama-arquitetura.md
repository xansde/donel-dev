# Diagrama de arquitetura — protótipo do mapa de grafos (bancada + escolha)

> Fase **Design** do item `wi-esteira4-mapa-grafos-prototipo` · plano
> `pln-esteira4-forma-e-leitura` · discovery `dsc-15a7e7f5-fbb` · repo
> `donel-dev` · 12/08/2026.
>
> Este item é um **prototype**: a bancada é descartável, e o que sobrevive
> dela é a ESCOLHA (documento ratificado) mais o adapter de dados. Este
> diagrama fixa as fronteiras — o que a bancada lê, o que ela nunca toca, e
> por onde o resultado desagua na issue do mapa. **Forma** daqui vence em
> Implementar; se a realidade divergir, a divergência vira nota, não silêncio.

## Onde o protótipo se encaixa

```mermaid
flowchart LR
  subgraph fontes["Dados canônicos (só leitura)"]
    grafo["esteira.grafo\n(grafo-mesa.json — 12 nós/12 arestas,\nmolde: specs/012-esteira-4/formato-grafo.md)"]
  end

  subgraph bancada["Bancada (descartável — fora de src/)"]
    adapter["adapter único\nesteira.grafo → modelo neutro\n(nós tipados + arestas + títulos)"]
    a["Aba A\nReact Flow retrabalhado\n(@xyflow/react já no repo)"]
    b["Aba B\ncandidato do\nawesome-node-based-uis"]
    c["Aba C\ncandidato do\nawesome-node-based-uis"]
    regua["régua fixa F25\n(identifica · navega · bonito ·\nauto-layout · integração · peso)"]
  end

  escolha["specs/012-esteira-4/\nmapa-grafos-escolha.md\n(matriz preenchida + escolha)"]
  dono{{"Dono ratifica"}}
  issue["issue do mapa de grafos\n(item irmão do plano —\naí sim toca src/)"]

  grafo --> adapter
  adapter --> a & b & c
  a & b & c --> regua
  regua --> escolha --> dono --> issue
```

## Fronteiras — o que a bancada toca e o que não toca

| Componente | Papel | Toca? |
|---|---|---|
| `grafo-mesa.json` (`.esteira/plano/pln-esteira4-catalogo-e-grafo/`) | dado de entrada, o MESMO nas 2–3 abas | lê, nunca escreve |
| `formato-grafo.md` (🟢 decidida, [G-1]…[G-6]) | molde do dado — o adapter implementa contra ela | lê |
| `src/renderer/src/DevMode/NodeGraphOverlay.tsx` (+ `nodeGraphView.ts`, `nodeGraphLayout.ts`) | a vista ATUAL, reprovada pelo F25 — é a régua do "antes", não base de código da bancada | **não toca** |
| `src/` em geral | app real | **não toca** — bancada mora fora (ex.: `prototypes/mapa-grafos/`, standalone Vite) |
| design-system (`@donel-dev/design-system` tokens) | tema — critério "Integração" mede o custo de cada lib respeitá-lo | lê tokens, não altera |

Duas notas de fronteira que Implementar não deve redescobrir:

1. **A bancada renderiza o `esteira.grafo`, não o `StoreSnapshot`.** A vista
   atual projeta o store (`nodeGraphView.ts`); o mapa novo da 4.0 deriva do
   grafo canônico (`formato-grafo.md`: "a tela deriva a linha Design dele").
   Comparar as libs já no dado certo evita repetir a comparação depois.
2. **A forma foi fixada pelo dono em 12/08, na revisão deste design** (v3 do
   mockup): grafo estilo Obsidian forçado à horizontal — nós circulares com
   rótulo embaixo, força dirigida com viés horizontal por profundidade,
   código de cores por estado (concluído/rodando/esperando/travado/futuro),
   nós pequenos para os arquivos de cada etapa, um nó por task do plano,
   hover com descrição simples e realce de vizinhança. Com isso a pergunta
   da bancada virou "qual motor reproduz esta forma com menos briga?" — e
   "reproduz a forma fixada" é o critério eliminatório da régua. Candidatos
   na direção do awesome-node-based-uis: `d3-force` + SVG próprio (o caminho
   do Obsidian), `sigma.js`/graphology (WebGL), React Flow com posições de
   `d3-force` (`@xyflow/react@12` já no repo). A seleção final dos 2–3 é
   decisão de Implementar, registrada na seção 0 do documento de escolha.

## Por onde o dado passa

`grafo-mesa.json` → adapter (validação leve contra o molde + tipagem dos nós
`fase`/`gate`/`artefato`/`nota`) → cada aba recebe o modelo neutro e só faz
RENDER (layout, tema, interação). Anotações do dono por aba ficam na própria
bancada (localStorage basta — é descartável) até serem transcritas para a
matriz do documento de escolha.

## O que depende do quê

- A **bancada** depende só do export da mesa e do molde — nada do motor
  headless, nada da rodada 012 em andamento.
- A **issue do mapa** (quem toca `src/`) depende da escolha ratificada — este
  item é o desaguadouro dela, como o Plano declarou.
- Nenhuma dependência reversa: o app não sabe que a bancada existe.
