# Escolha do motor do mapa de grafos — 012 Esteira 4.0

**Status:** 🟡 **AGUARDA RATIFICAÇÃO DO DONO** — bancada em reconstrução
contra a forma fixada; matriz preenche-se com as medições e com o veredito
do dono na bancada.
**Item:** `wi-esteira4-mapa-grafos-prototipo` (prototype) · plano
`pln-esteira4-forma-e-leitura` · discovery `dsc-15a7e7f5-fbb`.
**Origem:** F25 — a vista atual (`NodeGraphOverlay.tsx`) foi reprovada. A
fase Design terminou com a **forma fixada pelo dono em 12/08**
(`.esteira/design/wi-esteira4-mapa-grafos-prototipo/decisoes-forma-do-mapa.md`,
D-M1..D-M8, na branch `design/wi-esteira4-mapa-grafos-prototipo`): grafo
estilo **Obsidian forçado à horizontal** — nós circulares com rótulo embaixo,
força dirigida com viés horizontal por profundidade, cores por estado,
nós-satélite para arquivos, hover com realce de vizinhança.
**A pergunta do protótipo**, portanto, não é "qual estilo?" (já respondida
pelo Design): é **"qual motor reproduz esta forma com menos briga?"**
**Bancada:** `prototypes/mapa-grafos/` — standalone, descartável, fora de
`src/`. `npm install && npm run dev`; o mockup de referência fica em
`/mockup-referencia.html` para comparação lado a lado.

---

## 0. Abordagens testadas

Candidatos apontados pelo próprio design (diagrama v3), seleção confirmada em
Implementar. A **física é compartilhada** entre as três abas (d3-force com
viés horizontal por profundidade, `src/forceLayout.ts`) — o que se compara é
o **motor de render** e o custo de cada um reproduzir a forma.

| Aba | Abordagem | Lib / versão | Onde está o código |
|---|---|---|---|
| A | d3-force + **SVG próprio** — o caminho do próprio Obsidian: render manual, simulação ao vivo, controle total da forma | `d3-force` — versão na seção 4 | `prototypes/mapa-grafos/src/tabs/TabD3Svg.tsx` |
| B | **sigma.js / graphology** (WebGL) — feito para grafos orgânicos grandes; aposta: fps de sobra nas centenas de nós | `sigma` + `graphology` — versões na seção 4 | `prototypes/mapa-grafos/src/tabs/TabSigma.tsx` |
| C | **React Flow posicionado por d3-force** — mantém a lib que o repo já paga; posições estáticas pós-simulação ("perde o vivo", já previsto no design) | `@xyflow/react` — versão na seção 4 | `prototypes/mapa-grafos/src/tabs/TabReactFlow.tsx` |

**Registro de percurso (transparência):** a primeira rodada da bancada
(commit `c3a5768`) foi construída contra o design **desatualizado** (commit
`853f095`, anterior às decisões D-M1..D-M8) e comparou React Flow+elk,
Cytoscape+dagre e Reaflow em layout de camadas retangulares — a pergunta
antiga. Detectado pelo dono na verificação; cytoscape e reaflow saíram, e a
medição daquela rodada que segue válida é a do processo (as três instalaram
e buildaram em React 18.3.1 + Vite). A causa: a fase Implementar leu o
commit de design apontado no histórico do run, não o **tip** da branch de
design — lição registrada na seção 4.

## 1. Régua preenchida

O critério 1 é **eliminatório** (consequência das D-M1..D-M8). Células
**do dono** preenchem-se na bancada; células técnicas, com as medições.

| Critério | A — d3+SVG | B — sigma/WebGL | C — React Flow+d3 |
|---|---|---|---|
| 1. Reproduz a forma fixada (eliminatório) | sim, com simulação ao vivo — render manual dá controle total da forma | sim, mas o rótulo embaixo exigiu override de baixo nível (`drawLabelBelow` sobre `defaultDrawNodeLabel` — a API pensa rótulo lateral); física entregue estabilizada, não ao vivo | sim, com posições estáticas pós-simulação — "perde o vivo", característica prevista no design |
| 2. Identifica (dono) | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ |
| 3. Navega (dono) | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ |
| 4. Bonito (dono) | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ | _aguarda veredito na Validar_ |
| 5. Integração | dependência mínima (d3-force puro); o custo é MANTER o render SVG manual (hover, pan/zoom, drag são nossos) | dependência nova (sigma+graphology); WebGL não lê CSS var — tokens resolvidos via `getComputedStyle` (`themeColors.ts`); React só orquestra | a lib o app já paga; nós circulares como componentes React; sem re-simulação ao arrastar |
| 6. Peso (gzip) + fps no grafo grande | **5,57 kB** · fps: _medir na Validar_ | 37,84 kB · fps: _medir na Validar_ (aposta da aba: WebGL nas centenas de nós) | 58,70 kB (já pago pelo app) · fps: _medir na Validar_ |

**Sessão de 12/08, verificação do dono na bancada:** a forma fixada foi
reconhecida ("agora sim") após a reconstrução contra o design v3 — o veredito
aba a aba (células 2–4) e os fps do sintético ficam para a fase Validar, com
o dono na bancada.

Datasets da bancada: fluxo canônico (grafo-mesa, 12 nós) · **plano real com
estados** (o dataset do mockup v3, default) · sintético ~300 nós com contador
de fps.

## 2. A escolha

_(preencher: brigas medidas por motor + recomendação de Implementar +
ratificação do dono)_

## 3. O que a issue do mapa herda

- **O adapter** (`src/adapter.ts` + 7 testes): parse/validação do
  `esteira.grafo` → modelo neutro — sobrevivente declarado desde o diagrama.
- **A física** (`src/forceLayout.ts` + testes de `computeDepth`): o viés
  horizontal por profundidade é a forma fixada, independe do motor vencedor.
- **O mapeamento estado→token** (`src/themeColors.ts`) e a forma dos nós
  (círculo + rótulo embaixo + raios lg/md/sm) como referência.
- **Morre com a bancada**: as abas perdedoras, o seletor de datasets, o
  scaffold Vite, o localStorage de anotações.

## 4. Fatos medidos e divergências

Medidos em 12/08/2026 — `npx vitest run` **16/16** (adapter 7, computeDepth 5,
benchGraph 4), `npx tsc --noEmit` limpo, `vite build` ok — re-executados na
sessão, não herdados do worker.

**Versões exatas:** react/react-dom 18.3.1 · d3-force 3.0.0 · sigma 3.0.3 ·
graphology 0.26.0 · `@xyflow/react` 12.11.3.

**Chunks (raw / gzip):** vendor-d3force 14,56 / 5,57 kB · vendor-sigma
158,86 / 37,84 kB · vendor-reactflow 180,94 / 58,70 kB (+15,87 kB css) ·
vendor-react 141,83 / 45,44 kB · app 24,59 / 9,72 kB.

**Brigas de cada motor contra a forma (o resultado do experimento):**

- **sigma**: rótulo embaixo não é declarativo — exigiu função de desenho
  canvas custom sobre `defaultDrawNodeLabel`; hover/realce via
  `nodeReducer`/`edgeReducer` funcionou; física ao vivo é possível mas não
  foi ligada (entregue estabilizada).
- **React Flow**: reproduz a forma com nó custom circular, mas estático —
  sem o "vivo" da simulação (previsto no design como característica da aba).
- **d3+SVG**: nenhuma briga de lib — a briga é o custo de manutenção do
  render manual (hover, pan/zoom, drag escritos à mão na bancada).

**Lições e divergências já registradas:**

- **Processo:** o histórico do run apontava o design no commit `853f095`;
  a branch de design tinha 4 commits além dele, com as decisões de forma do
  dono. Implementar deve ler o **tip** da branch de design do item, não o
  commit citado no histórico — proposta para o contrato/skill da fase.
- O diagrama de design fala "React 19"; o repo real está em **React 18.3.1**
  + Electron 43 — bancada medida contra as versões reais.
- Estados não existem no `esteira.grafo` (o molde não os carrega) — na
  bancada eles vêm do dataset; na tela real virão do log/store, como a spec
  do mapa definir.
