---
name: Base do quadro do Mindscape
type: adr
status: accepted
created: 2026-10-24
updated: 2026-10-24
tags: [adr, mindscape, 017-mindscape, renderer, dependencias]
aliases: [ADR-0004, base do quadro, roughjs vs excalidraw]
---

# ADR 0004 — Base do quadro do Mindscape: quadro próprio em React + roughjs

O Mindscape é um quadro próprio em React: post-its como componentes DOM posicionados num
plano com pan, e o traço à mão (ligações e contorno dos cartões) desenhado como SVG pelo
`roughjs@4.6.6`. O `@excalidraw/excalidraw` foi descartado como base, apesar de trazer
rabisco, ligações e prints prontos e de o dono gostar do traço à mão.

Decidido por delegação do dono, 2026-10-24 ("Você pode seguir a estrutura atual da esteira,
só que vai tomando as decisões"). Design completo em `docs/design/mindscape.md`.

## Por quê

O critério que decide é o **post-it de sessão vivo**: glifo e destaque mudando a cada evento
do semáforo, pulso de estado (`StateDot`) e clique que leva ao terminal. No quadro próprio
isso é um componente React comum alimentado pelo `semaphoreStates` que o `App.tsx` já tem.
No Excalidraw os elementos são primitivas desenhadas em canvas, sem componente React dentro;
manter o estado vivo exigiria reescrever a cena (`updateScene`) a cada evento e traduzir
cliques por seleção — e o pulso do estado não existe lá (comportamento da API do Excalidraw
tirado da documentação, não medido em execução). O segundo critério é peso, para um
dono com pouca RAM (medido em 2026-10-24, sem instalar):

| | `@excalidraw/excalidraw@0.18.1` | `roughjs@4.6.6` |
|---|---|---|
| Licença | MIT | MIT |
| Pacote desempacotado (`npm view dist.unpackedSize`) | 46,8 MB | 0,17 MB |
| JS de produção carregado (unpkg `?meta`) | ~2,77 MB minificado (`dist/prod/index.js` 502 KB + chunks de 1.825 KB e 439 KB) + 145 KB de CSS | 27,7 KB (`bundled/rough.esm.js`, dependências embutidas) |
| Fontes no pacote | 26,2 MB (482 arquivos) | nenhuma |
| Dependências diretas | 32, entre elas `@excalidraw/mermaid-to-excalidraw` → `mermaid ^11` (o `mermaid@12.2.0` atual tem 122 MB desempacotado) | 4 pequenas, já embutidas no bundle |
| React | peer `^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0` (compatível com 18.3.1) | não depende de React (JS puro, gera SVG via `rough.generator()`) |
| Último publish | 0.18.1 em 2026-04-20 | 4.6.6 em 2023-11-20 |

O próprio Excalidraw desenha com `roughjs` (dependência `roughjs 4.6.4`): o traço à mão que o
dono quer vem da mesma biblioteca, a ~1% do peso.

## Consequências

- Rabisco à mão livre e prints **não** vêm de graça: ficam na V2 (`docs/versoes/mindscape.md`).
  Se a V2 pedir rabisco, o candidato é `perfect-freehand@1.2.3` (MIT, 112 KB desempacotado),
  outra dependência que o próprio Excalidraw usa.
- `roughjs` está sem release desde 2023-11. Risco baixo: é pequeno, puro e sem dependência
  nativa; se quebrar, dá para fixar a cópia no repo.
- Reabrir esta decisão só se a V2 exigir em conjunto rabisco, prints, texto livre e formas — aí
  o custo do Excalidraw passa a comprar coisa que seria cara de construir.
