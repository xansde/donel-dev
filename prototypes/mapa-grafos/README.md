# Bancada — protótipo do mapa de grafos

Código descartável do item `wi-esteira4-mapa-grafos-prototipo`. A rodada
anterior comparava React Flow, Cytoscape.js e Reaflow contra um design
DESATUALIZADO. O dono fixou a forma final na revisão da fase Design
(12/08/2026, `decisoes-forma.md`, D-M1..D-M8): grafo estilo **Obsidian** —
nós circulares com rótulo embaixo, física de força dirigida com viés
horizontal por profundidade, cores por estado, satélites pequenos para
arquivos/artefatos, hover como mecanismo de leitura (tooltip + realce de
vizinhança). Cytoscape e Reaflow não reproduzem essa forma (nós
retangulares/rótulo ao lado) — saíram. Esta rodada testa 3 motores contra a
forma fixada, todos sobre a MESMA física compartilhada
(`src/forceLayout.ts`): a comparação é de motor de render, não de física.

Não faz parte de `src/` do app — não é buildado, empacotado nem versionado
como produto. Fica fora do escopo de `design-system/` (só lê `tokens.css`).

## Abas

- **A — d3-force + SVG próprio**: o caminho do Obsidian. Simulação AO VIVO
  (nós chegam se acomodando, tick a tick), círculos + texto em SVG puro,
  drag de nó, pan/zoom manuais.
- **B — sigma.js + graphology**: renderização WebGL. Posições vêm da física
  compartilhada JÁ estabilizada; hover/realce via `nodeReducer`/`edgeReducer`
  do sigma.
- **C — React Flow posicionado por d3-force**: mantém `@xyflow/react`, mas
  com nó circular custom e posições estáticas pós-simulação — "perde o vivo"
  de propósito (característica registrada, não bug).

## Datasets (seletor na UI)

1. **Fluxo canônico (mesa)** — `grafo-mesa.json` via o adapter existente
   (`src/adapter.ts`, intocado), convertido para o shape de bancada por
   `neutralToBench()`. Sem estado no dado → todo nó nasce `future`.
2. **Plano real (com estados)** — `src/data/planoReal.ts`, transcrito do
   dataset do mockup-v3.html (14 nós, 13 arestas, com estado real).
   Dataset default.
3. **Sintético (fps)** — `src/data/synthetic.ts`, gerador determinístico
   (LCG com seed fixa, sem `Math.random`) de ~300 nós (8 fases, 60 tasks,
   resto arquivos). Mostra contador de FPS no canto do canvas, nas 3 abas.

## Como rodar

```bash
cd prototypes/mapa-grafos
npm install
npm run dev       # abre a bancada em modo dev
npm test          # roda os testes (adapter, forceLayout, benchGraph)
npm run typecheck # tsc --noEmit
npm run build     # build de produção — usado só para medir o peso de cada lib
```

Mockup de referência (mesma forma que a régua cobra): link "mockup de
referência ↗" no cabeçalho da bancada, ou diretamente
`public/mockup-referencia.html`.

## Régua de avaliação

Ver a coluna direita da UI (mesma em toda aba): 1. Reproduz a forma fixada
(eliminatório) · 2. Identifica · 3. Navega · 4. Bonito · 5. Integração ·
6. Peso. Anotações por aba salvam em `localStorage`.
