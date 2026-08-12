# Escolha da abordagem do mapa de grafos — 012 Esteira 4.0

**Status:** 🟡 **AGUARDA RATIFICAÇÃO DO DONO** — a bancada está construída e a
matriz traz a avaliação técnica medida; as células que são veredito do dono
(Identifica · Navega · Bonito) só se preenchem com ele usando a bancada.
**Item:** `wi-esteira4-mapa-grafos-prototipo` (prototype) · plano
`pln-esteira4-forma-e-leitura` · discovery `dsc-15a7e7f5-fbb`.
**Origem:** F25 — a vista atual (`NodeGraphOverlay.tsx`) foi reprovada: "feia,
não navega, difícil identificar". Direção dada pelo dono:
[awesome-node-based-uis](https://github.com/xyflow/awesome-node-based-uis).
**Bancada:** `prototypes/mapa-grafos/` — standalone, descartável, fora de
`src/`. Roda com `npm install && npm run dev` dentro da pasta. As 2–3 abas
renderizam o MESMO `grafo-mesa.json` (12 nós/12 arestas) via um adapter único.

---

## 0. Abordagens testadas

Seleção feita em Implementar (12/08/2026) sobre a lista real do
awesome-node-based-uis, com três filtros: (1) serve a um mapa de **leitura**
com auto-layout — editores de programação visual (rete, litegraph, drawflow,
flume) ficaram de fora; (2) licença livre — GoJS, JointJS (open core) e yFiles
são comerciais e já perderiam "Peso/Integração" na licença; (3) roda em
React 18.3.1 + Electron 43 (versões reais do repo — o diagrama de design dizia
"React 19", divergência anotada na seção 4).

| Aba | Abordagem | Lib / versão | Onde está o código |
|---|---|---|---|
| A | React Flow retrabalhado — a lib que já está no repo, com auto-layout de verdade (elkjs) e custom nodes por kind; o F25 reprovou a vista, não necessariamente a lib | `@xyflow/react` + `elkjs` — versões na seção 4 | `prototypes/mapa-grafos/src/tabs/TabReactFlow.tsx` |
| B | Renderer canvas de teoria dos grafos — filosofia oposta: imperativo, framework-agnostic, layouts consolidados (dagre) | `cytoscape` + `cytoscape-dagre` — versões na seção 4 | `prototypes/mapa-grafos/src/tabs/TabCytoscape.tsx` |
| C | Lib React de workflow com auto-layout embutido (elk) — o extremo declarativo: layout zero-config, custo de integração mínimo em tese | `reaflow` — versão na seção 4 | `prototypes/mapa-grafos/src/tabs/TabReaflow.tsx` |

As três representam três filosofias de render — node-UI com nós DOM e layout
plugável (A), canvas puro (B), wrapper React com layout embutido (C) — para a
comparação dizer algo além de "duas variações da mesma coisa".

## 1. Régua preenchida (F25)

Células **técnicas** medidas em Implementar; células **do dono** aguardam a
bancada. Anotações livres por aba ficam na própria bancada (localStorage) até
serem transcritas para cá.

| Critério | A — React Flow | B — Cytoscape | C — Reaflow |
|---|---|---|---|
| Identifica (dono) | _aguarda bancada_ | _aguarda bancada_ | _aguarda bancada_ |
| Navega (dono) | _aguarda bancada_ | _aguarda bancada_ | _aguarda bancada_ |
| Bonito (dono) | _aguarda bancada_ | _aguarda bancada_ | _aguarda bancada_ |
| Auto-layout | elkjs `layered`/RIGHT, zero coordenadas à mão | dagre LR, zero coordenadas à mão | elk embutido na lib, zero coordenadas à mão |
| Integração | **baixa fricção**: `@xyflow/react` já é dependência do app; nós são componentes React/DOM — tokens CSS entram direto; custo incremental = elkjs | **média**: dependência nova; render em canvas — nó não é DOM, tema exige traduzir tokens para estilos cytoscape em JS; integração React é manual (ref + lifecycle) | **alta**: dependência nova que arrasta `framer-motion`, `reablocks` e `react-use-gesture` (deprecated) como transitivas; nó custom via `foreignObject`; manutenção da lib morna |
| Peso (gzip do chunk) | 950,79 kB — **mas** `@xyflow/react` o app já paga hoje; o incremental real é o elkjs | 175,59 kB — a mais leve, de longe | 792,43 kB — a mais pesada em dependências novas |

Nota da célula Auto-layout: "sem sobreposição" nos 12 nós é conferência
visual — feita na bancada, não no build. O fato técnico registrado é que as
três dispensam coordenada à mão (os `x`/`y` do arquivo são ignorados, como o
molde `[G-4]` permite).

## 2. A escolha

**Recomendação técnica de Implementar (12/08/2026): Aba A — React Flow
retrabalhado (`@xyflow/react` + elkjs).** O porquê, em cima do medido:

1. **Integração é o critério que separa** — a lib já está no repo e no bundle
   do app; nós como componentes React consomem os tokens do design-system sem
   camada de tradução. B exige reescrever o tema em estilos canvas; C traz o
   pior pacote de dependências das três.
2. **O F25 reprovou a vista, não a lib** — a bancada mostra que com
   auto-layout de verdade (elkjs) e custom nodes por kind a apresentação muda
   de figura mantendo a base já autorizada pelo dono.
3. **Peso incremental honesto**: o único acréscimo real de A é o elkjs; B é a
   mais leve no absoluto, mas some diante do custo de integração canvas; C é
   cara nos dois eixos.

**Cenário em que a recomendação cai**: se na bancada o dono achar a navegação
ou a estética de B visivelmente superiores, o peso baixo de cytoscape torna a
troca defensável — o adapter é o mesmo, só o render muda.

**Ratificação do dono:** _pendente — preencher após a sessão com a bancada._

## 3. O que a issue do mapa herda

- **O adapter** (`prototypes/mapa-grafos/src/adapter.ts` + teste): parse e
  validação leve do `esteira.grafo` → modelo neutro. É a peça que o diagrama
  de design já declarou sobrevivente — a issue do mapa o move para `src/`
  quando nascer.
- **Os custom nodes por kind** da abordagem vencedora (forma: gate/fase/
  artefato/nota com os tokens do design-system) — como referência de forma,
  reescritos no padrão do app.
- **A decisão de tema**: a bancada consome `design-system/src/tokens.css`
  direto; a issue do mapa herda o custo medido de cada lib respeitá-lo.
- **Morre com a bancada**: as abas perdedoras, o scaffold Vite standalone, o
  localStorage de anotações.

## 4. Fatos medidos e divergências

Medidos em 12/08/2026, `npx vitest run` (7/7 verdes no adapter),
`npx tsc --noEmit` limpo e `vite build` com `manualChunks` separando cada lib
em chunk próprio — verificados na sessão de Implementar, não estimados.

**Versões exatas instaladas** (package-lock da bancada): react/react-dom
18.3.1 · `@xyflow/react` 12.11.3 · elkjs 0.9.3 · cytoscape 3.34.1 ·
cytoscape-dagre 2.5.0 · reaflow 5.4.1 (embute o próprio elkjs 0.10.2, sem
conflito).

**Tamanhos de chunk** (vite build, raw / gzip): vendor-react 194,99 / 63,39 kB
· vendor-cytoscape 538,69 / 175,59 kB · vendor-reaflow 2 466,71 / 792,43 kB ·
vendor-reactflow (inclui elkjs) 3 082,75 / 950,79 kB · app 14,07 / 5,68 kB.

**Divergências e ressalvas:**

- O diagrama de design falava "React 19 + Electron"; o repo real está em
  **React 18.3.1** + Electron 43 — a bancada usa as versões reais, e o
  critério Integração foi medido contra elas.
- `cytoscape-dagre` não publica tipos nem tem `@types` — a bancada declara um
  `.d.ts` mínimo; a issue do mapa herdaria esse custo se B vencer.
- `npm audit` da bancada reporta 5 vulnerabilidades (1 critical) e 4 pacotes
  deprecated nas transitivas (`react-use-gesture` vem do reaflow). Não
  investigado a fundo por ser bancada descartável e local — mas pesa contra C
  em Integração.
- O smoke **visual** das 3 abas (`npm run dev`) não foi feito nesta fase — é
  exatamente a bateria manual do dono na bancada, e a aba C (custom node via
  `foreignObject`) é a de maior risco de renderizar mal.
