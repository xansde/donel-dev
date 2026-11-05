# Protótipo Mindscape: relato (2026-10-23)

Skill `/prototipo` da esteira, em modo direto (sem plano). Não criei branch, não fiz commit e
não toquei em `src/`.

## Entregue

- `docs/prototipos/mindscape/index.html` tem 78 KB, é autocontido e não usa CDN, fetch nem
  fonte remota. As 4 variantes ficam em `<section class="proto-variant">`, com o switcher
  copiado de `templates/switcher-snippet.html` no fim do body.
- `docs/prototipos/mindscape/decisao.md` foi feito a partir do template, com
  `status: pendente-de-escolha` e `taskdex: []`. As seções Escolha e Descartado estão vazias.
- O casco compartilhado tem titlebar (Donel Dev, pill do projeto, SegmentedControl "Uso geral |
  Mindscape", AccountBadge), sidebar de projetos com StateDot, barra de abas com glifo e faixa
  de cor, e StatusBar. As variantes ocupam o lugar do terminal.
- A gaveta de detalhe é compartilhada e usa as ações do PostItCard: Enviar para sessão…,
  Copiar e Arquivar. O botão "Abrir aba" só mostra um toast.

## Variantes

- **A — Canvas livre**: abas de mindscape no topo (atlas, beacon, vega, Esteira dev e
  Homologação, mais "＋ Mindscape"), cada uma com a contagem de sessões paradas. O mundo tem
  pan (arrastar o fundo), zoom (roda do mouse e botões) e minimapa clicável. Os post-its são
  arrastáveis e abrem a gaveta com um clique. Os grupos tracejados vêm de cada fluxo da esteira,
  mais um grupo "Soltos". Os post-its do usuário ficam levemente inclinados.
- **B — Trilhas da esteira**: uma faixa por esteira. A esteira dev tem 6 colunas com os chips
  reais de fase. A de homologação tem 5 colunas, com chip neutro. As linhas são os projetos e as
  células mostram sessões e post-its. A célula "fronteira" (fase com sessão viva) recebe um
  fundo leve. O cabeçalho da coluna conta as sessões e fica vermelho quando há sessão parada.
  Há filtro por projeto e uma faixa "Fora de esteira" para post-its soltos.
- **C — Mural por projeto + parados**: cada projeto é uma zona com as subáreas "Parado,
  esperando você" (cards grandes), "Trabalhando" (linhas compactas com o último post-it),
  "Post-its" e "Encerradas" (prateleira de chips). A faixa da direita, "Precisa de você", ordena
  por permissão, depois falha, depois aguardando, e dentro de cada estado a mais antiga vem
  primeiro. Um clique rola até o card e faz ele piscar. O dropdown troca o mindscape entre Mural
  geral, Esteira dev e Esteira de homologação.
- **D — Mapa de nós**: a lista de mindscapes fica à esquerda (Tudo, por projeto, por esteira).
  As sessões são pílulas, os post-its são cartões pequenos e as arestas são SVG: sequência com
  seta, sessão para post-it tracejada, post-it do usuário pontilhado. Clicar num nó acende a
  cadeia e mostra o detalhe no painel direito. O botão "Destacar o que está parado" apaga o
  resto. Sem nada selecionado, o painel lista os parados.

As 4 discordam em layout, hierarquia e affordance primária. Não precisei refazer nenhuma por
semelhança.

## Fontes dos tokens

Os tokens foram copiados literalmente, e cada grupo no `:root` cita a origem:
- `design-system/src/tokens.css`: todos os grupos de cor, tipografia, espaço, raio, densidade,
  sombra, motion e foco.
- `src/shared/tabAppearance.ts` com `TerminalTab.module.css` e `TerminalTab.tsx`: a paleta de
  aba (none, accent, donel-accent, permission → `--border`, `--accent`, `--donel-accent`,
  `--state-permission`), os rótulos pt-BR e os glifos de estado.
- `StateDot.tsx` e `StateDot.module.css`: os rótulos dos 5 estados, o pulso e o halo.
- `src/main/semaphore-state-machine.ts`: os 4 estados vindos dos hooks. O error vem do exit code.
- `PostItCard`, `PhaseChip`, `SegmentedControl`, `StatusBar` e `AccountBadge` (`*.module.css`),
  `src/renderer/src/App.module.css`, `ProjectSidebar.module.css` e `global.css`.
- Ground truth de densidade: `design/modo-dev-v3-handoff/prints/modo-dev-v3-2a-tela-principal.png`.

Achado: o repo já tem um `PostItCard` ("Carta do Tomo do Donel", Brief 8 em
`design/design-handoff.md`) e o token `--postit-bg`. Os post-its do protótipo partem dele.

## Prova

- `node --check` passou nos 2 `<script>` extraídos. As 4 sections existem com `data-name`, e
  não há URL http nem `fetch(` no arquivo.
- Abri no Edge headless (`--dump-dom`, com captura de `window.onerror` numa cópia instrumentada
  no scratchpad) e não houve nenhum erro de JS.
- Rodei Playwright pelo cache do npx (`npm-cache/_npx/e41f203b7505f1fb`, nada instalado), com o
  Edge, em viewport 1440×900. O console e o `pageerror` não mostraram erros. Resultados:
  - as 4 variantes ficaram visíveis;
  - A: arrastar moveu o post-it de 320px para 508px, um clique abriu a gaveta e a troca para
    "beacon" mostrou 11 itens;
  - B: o filtro "vega" deixou 3 faixas e 4 sessões;
  - C: o clique na faixa piscou o card certo (s11), e o mindscape de homologação mostrou 2 zonas;
  - D: selecionar s2 deixou 12 nós acesos e 20 apagados;
  - a seta → no switcher passou de D para A.
- Screenshots ficaram no scratchpad
  (`C:\Users\compu\AppData\Local\Temp\claude\C--Users-compu-seazone-Donel-Dev\4bb5c240-cf3f-48a2-930c-208b247e4135\scratchpad\`):
  `proto-A.png`, `proto-B.png`, `proto-C.png`, `proto-D.png`, mais `proto-C-goto.png` e
  `proto-D-sel.png`. Conferi todos visualmente.

## Limitações

- As fontes Inter e JetBrains Mono não estão embutidas, e a tela usa o fallback do sistema.
  Isso muda um pouco a métrica do texto em relação ao app.
- As fases de homologação não têm token de cor no repo e ficaram com chip neutro. Se o dono
  quiser cor por fase de homologação, isso é um token novo e depende de decisão de design.
- A cor "Vermelho" da paleta de aba é igual a "Permissão pendente". No post-it isso pode
  confundir, e é uma questão para a escolha.
- Onde o Mindscape mora (modo do SegmentedControl, aba fixada, tela própria) não foi decidido.
  O mock assume que é um modo.
- O switcher só lê o `#hash` no carregamento: trocar o hash à mão exige recarregar a página.
  Esse é o comportamento do snippet padrão.
- Na D, a cadeia do atlas passa da largura visível a 1440px, então é preciso rolar.
- Não testei tela menor, volume grande nem teclado dentro dos canvases.
