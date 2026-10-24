---
demanda: mindscape
plano: invocação direta
taskdex: []  # URLs dos cards do TaskDex (registro de uso)
status: decidido
decidido-por: Alexandre Lentz
decidido-em: 2026-10-23
---

# Decisão de UI — Mindscape

## Pergunta

Como o Mindscape deve estruturar a visão de sessões e post-its para que o dono acompanhe,
de relance, o que está acontecendo e o que está parado, em vários projetos e esteiras?

## Base visual

Design system real do app. Nenhum token foi inventado; cada grupo no `:root` do `index.html`
cita o arquivo de origem.

- `design-system/src/tokens.css`: superfícies e texto, estados do semáforo (`--state-*`),
  smart zone, `--donel-accent`, `--postit-bg`, chips de fase (`--phase-*`), tipografia,
  espaçamento, raio, densidade, sombra, motion e foco.
- `src/shared/tabAppearance.ts` (`TAB_COLOR_TOKENS`) e
  `design-system/src/components/TerminalTab/TerminalTab.module.css` (`.swatch-*`): a paleta
  de 4 cores de aba (Sem cor, Azul, Dourado, Vermelho), usada como código de cores dos post-its.
  Os rótulos vêm de `TAB_COLOR_LABEL_PT` (`TerminalTab.tsx`).
- `design-system/src/components/TerminalTab/TerminalTab.tsx` (`SESSION_STATE_ICON`): glifos
  de estado ▶ ◐ ! ■ ✕ e ❯ para shell. Rótulos de `SESSION_STATE_LABEL_PT` (`StateDot.tsx`).
  Pulso de 2000ms/1000ms e halo de permissão de `StateDot.module.css`.
- `src/main/semaphore-state-machine.ts`: os estados working, waiting, permission e done. O
  estado error vem do exit code, em `session-semaphore-manager.ts`.
- `design-system/src/components/PostItCard/*`: cartão do post-it (`#3A3526`, 220px, meta a 65%).
  `PhaseChip.module.css` dá o chip de fase; `SegmentedControl`, `StatusBar` e `AccountBadge`
  dão o casco.
- Casco: `src/renderer/src/App.module.css` (titlebar de 34px, tabBar de 36px, grid) e
  `ProjectSidebar.module.css`. Reset de `src/renderer/src/global.css`.
- Referência de densidade: `design/modo-dev-v3-handoff/prints/modo-dev-v3-2a-tela-principal.png`.
- Fontes: o app usa Inter e JetBrains Mono self-hosted (`@fontsource`). O protótipo não embute
  essas fontes e usa o fallback da própria pilha de `--font-ui` e `--font-mono`.
- As fases da esteira de homologação (Triagem, Preparar repo, Conferir técnico, Atesto do
  dono, Subir pra produção) não têm token de cor no repo. Os chips delas usam
  `--text-muted`, que é neutro.

## Ângulos gerados

- **A — Canvas livre**: espaço infinito com post-its arrastáveis, grupos soltos por fluxo,
  minimapa e zoom. O mindscape é escolhido por abas no topo, por projeto ou por esteira.
  Prioriza a arrumação espacial que o próprio dono faz.
- **B — Trilhas da esteira**: cada esteira (dev e homologação) é uma faixa, as colunas são as
  fases e as linhas são os projetos. Cada sessão e cada post-it cai na célula da sua fase.
  Prioriza ver em que fase cada coisa está.
- **C — Mural por projeto com foco no parado**: uma zona por projeto, com as subáreas parado,
  trabalhando, post-its e encerradas. A faixa lateral "Precisa de você" ordena as sessões
  paradas por urgência e leva até o card. Prioriza a triagem.
- **D — Mapa de nós**: sessões e post-its são nós ligados por linhas (SVG). A sequência é
  sessão, post-its que ela escreveu e próxima etapa. O mindscape é escolhido numa lista
  lateral, e clicar num nó acende a cadeia dele. Prioriza o encadeamento e a causalidade.

Convenções comuns às 4 variantes, também em teste:
- O post-it de sessão tem o selo "SESSÃO", o glifo de estado e o nome em mono.
- O post-it escrito pela sessão traz o nome da sessão em mono.
- O post-it do usuário tem o canto dobrado e "✎ você".
- O post-it da sessão herda a cor da aba da sessão. O do usuário recebe a cor que ele escolher.

## Escolha

**Variante A — Canvas livre**, sem composição com as outras. Nas palavras do dono (2026-10-23): "Opção A, disparado o mais próximo da minha ideia final".

Versão final, tela única e sem switcher: `final.html`.

## Descartado

- **B — Trilhas da esteira**: não escolhida — o dono apontou a A como a mais próxima da ideia.
- **C — Mural por projeto com foco no parado**: não escolhida — o dono apontou a A como a mais próxima da ideia.
- **D — Mapa de nós**: não escolhida — o dono apontou a A como a mais próxima da ideia.

## Limitações do mock

- Os dados são mockados: 3 projetos genéricos, 13 sessões, 19 post-its e 2 esteiras. Não há
  leitura real de sessão nem de esteira, e post-it criado, editado, arquivado ou enviado é só
  um toast.
- O protótipo não decide onde o Mindscape mora. Ele aparece como segundo modo do
  SegmentedControl ("Uso geral | Mindscape"), no lugar do "Dev", com as abas visíveis em cima.
  Isso é suposição.
- A paleta de aba tem "Vermelho" = `--state-permission`, a mesma cor do estado "Permissão
  pendente". No post-it, a cor do usuário pode ser confundida com o estado. Isso vale para o
  repo real e não só para o mock.
- O significado de cada cor está em aberto. O mock só mostra a cor, sem semântica.
- Não testado: tela menor que 1440×900, tema claro (o app não tem), muitas sessões (50 ou mais),
  acessibilidade por teclado dentro do canvas.
- A posição arrastada na A vale só até recarregar a página. Na D, o layout é manual e a coluna
  de post-its da cadeia do atlas passa da largura visível a 1440px, então é preciso rolar.
- Ficaram fora, por decisão do dono: Excalidraw, prints no canvas e sessão que lê post-its.
- As fontes Inter e JetBrains Mono não estão embutidas; a tela usa o fallback do sistema, o que muda um pouco a métrica do texto em relação ao app.
- As fases de homologação não têm token de cor no repo e ficaram com chip neutro. Cor por fase seria token novo e depende de decisão de design.
- Em `final.html` as posições arrastadas na A valem só até recarregar a página.

## Validação com o cliente (opcional)

<!-- Registre se acontecer. -->
