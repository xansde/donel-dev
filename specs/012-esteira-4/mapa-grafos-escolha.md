# Escolha do motor do mapa de grafos — 012 Esteira 4.0

**Status:** 🟢 **RATIFICADA PELO DONO em 12/08/2026** — motor escolhido:
**A — d3-force + SVG próprio**. Vereditos colhidos na bancada, na fase
Validar (run `run-c79cc240-723`, segunda passada).
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
| A | d3-force + **SVG próprio** — o caminho do próprio Obsidian: render manual, simulação ao vivo, controle total da forma | `d3-force` — versão na seção 4 | `prototypes/mapa-grafos/src/tabs/TabForceSvg.tsx` |
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
| 2. Identifica (dono) | sim | sim | sim |
| 3. Navega (dono) | sim | sim | sim |
| 4. Bonito (dono) | **preferido** | — | — |
| 5. Integração | dependência mínima (d3-force puro); o custo é MANTER o render SVG manual (hover, pan/zoom, drag são nossos) | dependência nova (sigma+graphology); WebGL não lê CSS var — tokens resolvidos via `getComputedStyle` (`themeColors.ts`); React só orquestra | a lib o app já paga; nós circulares como componentes React; sem re-simulação ao arrastar |
| 6. Peso (gzip) + fôlego a ~300 nós (dono) | **5,57 kB** · 2º | 37,84 kB · **1º** | 58,70 kB (já pago pelo app) · 3º |

**Vereditos colhidos do dono em 12/08 (fase Validar, segunda passada):**
bateria 1 — as três abas passam em Identifica e Navega; A preferida no
Bonito. Bateria 2 — fôlego no dataset sintético: **B > A > C** (ranking
qualitativo dele; sem números de fps registrados). Bateria 3 — ratificação:
**A**.

Datasets da bancada: fluxo canônico (grafo-mesa, 12 nós) · **plano real com
estados** (o dataset do mockup v3, default) · sintético ~300 nós com contador
de fps.

## 2. A escolha

**A — d3-force + SVG próprio. Ratificada pelo dono em 12/08/2026.**

O porquê, em cima dos vereditos e do medido: A venceu exatamente onde o F25
doía (bonito, identifica, navega — com a física viva que é a estética
Obsidian de verdade), é a mais leve das três (5,6 kB gzip) e reproduz a
forma fixada sem brigar com lib nenhuma — o custo aceito é manter o render
SVG manual (hover, pan/zoom, drag nossos). B venceu só o fôlego no cenário
extremo (~300 nós), que o mapa real (~12–50 nós; centenas apenas com todos
os satélites) raramente alcança — e se um dia alcançar, o adapter e a física
são os mesmos: trocar o render continua possível. C não venceu critério
algum.

## 3. O que a issue do mapa herda

- **O adapter** (`src/adapter.ts` + 7 testes): parse/validação do
  `esteira.grafo` → modelo neutro — sobrevivente declarado desde o diagrama.
- **A física** (`src/forceLayout.ts` + testes de `computeDepth`): o viés
  horizontal por profundidade é a forma fixada, independe do motor vencedor.
- **O mapeamento estado→token** (`src/themeColors.ts`) e a forma dos nós
  (círculo + rótulo embaixo + raios lg/md/sm) como referência.
- **Morre com a bancada**: as abas perdedoras, o seletor de datasets, o
  scaffold Vite, o localStorage de anotações.
- **Avisos que a issue do mapa herda junto** (achados do review de olho novo
  na rodada de fixes, não corrigidos na bancada de propósito): (1) d3-force
  auto-inicia a simulação na criação — sob StrictMode, o double-mount cria
  uma simulação órfã que roda ~300 ticks em paralelo (criar a simulação
  dentro do effect, ou parar a descartada); (2) o drag usa `alphaTarget(0.1)`
  aquecida que só esfria no pointerup do `<svg>` — sem `setPointerCapture`,
  soltar o mouse fora do canvas deixa a simulação quente para sempre; (3) se
  a issue herdar o padrão do teste classes×CSS, importar as classes dos
  componentes (não hardcodar) e assertar que a regra pinta (`fill`), não só
  que existe.

## 4. Fatos medidos e divergências

Medidos em 12/08/2026 — `npx vitest run` **18/18** (adapter 7, computeDepth 5,
benchGraph 4, stateClasses 2 — os dois últimos entraram na rodada de fixes
pós-Validar, commit `eead2f1`), `npx tsc --noEmit` limpo, `vite build` ok —
re-executados na sessão, não herdados do worker. Suíte do repo raiz
**2198/2198** vista rodar na Validar.

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
