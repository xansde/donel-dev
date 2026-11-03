# browser-use como referência para o navegador integrado (03/11/2026)

Pedido do dono: "veja o repo do browser-use no github". Contexto: o navegador integrado do Donel
(`docs/design/navegador-interno.md`, PRs #155 e #158) já está no alfa: painel `WebContentsView`
por sessão, controle por CDP da própria view, árvore de acessibilidade numerada `[N]` e dez
ferramentas `navegador_*` no MCP `donel`, para qualquer motor.

Fontes: `github.com/browser-use/browser-use` (MIT, ~120 mil estrelas, Python, release 0.13.14 de
26/10/2026) e `github.com/browser-use/browser-harness` (MIT, ~19 mil estrelas), lidos via API do
GitHub em 03/11.

## O que é

- **browser-use**: biblioteca Python de agente de navegador. Roda local com qualquer LLM, ou na
  nuvem deles (navegador "stealth", CAPTCHA, proxy, cobrado por hora). Tem CLI, servidor MCP e um
  modelo próprio (BU2).
- **browser-harness**: o produto que eles recomendam para Claude Code, Codex e Cursor. Liga o
  agente ao **Chrome do próprio usuário, logado**, pelo CDP (`chrome://inspect` → permitir). Vem
  com um `SKILL.md` e um workspace onde o agente **escreve os próprios helpers** quando falta um,
  e o harness melhora a cada tarefa. Também tem MCP (`browser-harness-mcp`).

## O que serve ao Donel

| browser-use | No Donel | Quando |
|---|---|---|
| **Leitura da página em camadas**: `DOM.getDocument` com `pierce` (shadow DOM e iframes, inclusive de outra origem) + `DOMSnapshot.captureSnapshot` (layout e ordem de pintura) + árvore de acessibilidade; só entra o que é clicável **e visível** (o que está coberto por outro elemento sai, pela ordem de pintura) | Hoje o `navegador_ler` usa só a árvore de acessibilidade, e iframes de outra origem ficaram fora da V1. Trazer o filtro por visibilidade/ordem de pintura e a perfuração de iframe e shadow DOM | V2 do navegador, primeira coisa |
| **`extract`**: a página vira Markdown e o modelo lê o texto, não a árvore | `navegador_extrair(pergunta?)`: Markdown da página (tabelas e listas preservadas), cortado com aviso, para ler conteúdo sem gastar a árvore | V2 |
| **Ações que faltam** (31 lá, 10 aqui): `select_dropdown`/`dropdown_options`, `upload_file`, `find_text` (rolar até o texto), `find_elements` (CSS), abas (`switch`, `close`), `save_as_pdf`, clique por coordenada, `evaluate` | Prioridade: escolher opção de lista, rolar até um texto, abas do painel. `enviar_arquivo` só de pasta autorizada pelo dono. `evaluate` (rodar JS) **fica fora**: é porta grande demais para uma página de terceiro | V2 |
| **Watchdogs** (um vigia por assunto: downloads, popups, crash, permissões, captcha, segurança) | O painel já trata downloads, popups e permissões. Falta o **vigia de domínio**: `allowed_domains`/`prohibited_domains` por sessão — o dono diz onde o agente pode navegar | V2, junto da trava de senha/cartão/pagar já planejada |
| **Benchmark público** (BU Bench V2.1) e a tabela comparando Browser Harness, Playwright MCP, Chrome DevTools MCP, agent-browser e Claude in Chrome | Rodar um punhado de tarefas do bench no navegador do Donel para medir de verdade, em vez de achar | Depois, quando a V2 existir |
| **CLI + SKILL.md gastam menos que MCP**: na medição deles o harness usou a metade dos tokens (2,1 M contra 4,4–6,7 M por tarefa) com a mesma nota | Reforça o que o estudo do OpenRig já disse: a CLI `donel` é a porta mais barata e mais agnóstica. `donel navegador ler/clicar/…` com o mesmo vocabulário do MCP, mais uma skill curta | Junto da CLI `donel` (P1 do PDA mindscape-openrig) |
| **Agente escreve os próprios helpers** num workspace protegido do núcleo | Ideia boa para depois: receitas por site (ex.: "baixar extrato do banco X") guardadas pelo agente e reaproveitadas, sem tocar no código do app | Depois; avaliar |

## O que não serve

- **Nuvem, stealth, CAPTCHA resolvido por terceiro, proxy residencial**: fora do propósito (o
  navegador é do dono, logado como ele) e contra a regra de nada fixo num fornecedor.
- **Ligar no Chrome do usuário por CDP** (o jeito do harness): é exatamente o que o dono rejeitou
  com o Claude in Chrome. O Donel tem o navegador **dentro** do app, com partição própria.
- **Abrir `--remote-debugging-port`** para essas ferramentas dirigirem o painel: continua
  proibido (D8 do design) — exporia o renderer do app. Se um dia quisermos que Playwright MCP ou
  o próprio browser-use dirijam o painel, o caminho é um **proxy CDP só daquela página**, em
  loopback, com token por sessão. Fica como spike, sem data.
- **Adotar a biblioteca**: é Python e traz um agente inteiro; o Donel já tem o laço (o motor da
  sessão) e só precisa das ferramentas. Usar como referência de código, com crédito (MIT).

## Proposta para a V2 do navegador (ordem)

1. Leitura melhor: visibilidade por ordem de pintura, iframes de outra origem e shadow DOM.
2. `navegador_extrair` (Markdown da página).
3. Lista, rolar até texto, abas do painel.
4. Vigia de domínio por sessão + trava de senha/cartão/pagar (já na V2 do design).
5. Comandos `donel navegador …` na CLI, com a mesma lista do MCP.
6. Medir com um recorte do BU Bench.

## Estudo do código (03/11, para a V2)

Clone raso de `browser-use/browser-use` (MIT), só lido: nada instalado nem rodado. O que vira **ideia**
reescrita em TypeScript no Donel (com crédito no comentário do arquivo que se inspirou), e o porquê:

| Arquivo do browser-use | O que faz lá | O que o Donel reaproveita |
|---|---|---|
| `browser_use/dom/service.py` (`_get_all_trees`, `_get_ax_tree_for_all_frames`, `get_dom_tree`) | Pede em paralelo `DOMSnapshot.captureSnapshot` (com `includePaintOrder`/`includeDOMRects` e poucos estilos computados), a árvore de acessibilidade **de cada frame** (`Page.getFrameTree` → `Accessibility.getFullAXTree({frameId})`) e o DOM com `pierce`. iframe de outra origem: acha o **alvo** do frame (auto-attach com `flatten`) e repete a coleta naquela sessão CDP, somando o deslocamento do iframe. | A mesma coleta, por sessão: a da página e uma por iframe de outra origem (`Target.setAutoAttach` com `flatten` no `webContents.debugger`, que aceita `sessionId` no `sendCommand`). A árvore de cada frame entra no lugar do nó `Iframe` do pai, achado por `DOM.getFrameOwner`. Os números `[N]` guardam também a sessão do frame. |
| `browser_use/dom/service.py` (`is_element_visible_according_to_all_parents`) | Visível = `display`≠none, `visibility`≠hidden, `opacity`>0, tem caixa, e cai dentro da viewport de cada frame da cadeia (descontando a rolagem). | A mesma regra, com uma diferença: o que cai fora da viewport **não some calado**, vira a contagem "N acima / N abaixo" (lá isso é texto do prompt, `agent/prompts.py`). |
| `browser_use/dom/enhanced_snapshot.py` | Índices do snapshot → `backendNodeId`; caixa, estilos, ordem de pintura; **não deixa sair o valor** de `type=password/file/hidden` e `autocomplete=cc-*`/`one-time-code`. | O mesmo índice (`nodes.backendNodeId` + `layout.nodeIndex`), e a lista de campos sensíveis como ponto de partida da **trava** de senha/cartão. |
| `browser_use/dom/serializer/paint_order.py` (`RectUnionPure`, `PaintOrderRemover`) | Percorre a ordem de pintura de cima para baixo mantendo a união de retângulos opacos; elemento cuja caixa já está toda coberta sai. Fundo transparente ou opacidade < 0,8 não cobre. Teto de retângulos para página pesada. | A subtração de retângulos (um retângulo menos outro = até 4 pedaços) e o critério de "opaco". **Mudança**: lá um filho opaco que preenche o botão esconde o próprio botão; aqui só cobre quem **não é descendente** do elemento, e só elemento (texto não cobre). |
| `browser_use/dom/serializer/clickable_elements.py` | Heurística larga de "clicável" (tags, papéis ARIA, `cursor: pointer`, ouvintes de clique). | **Não** adotado: o Donel continua decidindo o que é acionável pela árvore de acessibilidade (papéis), que já é curta e diz o que se pode fazer. `cursor: pointer` fica como ideia para quando aparecer site com `div` clicável sem papel. |
| `browser_use/dom/markdown_extractor.py` + `serializer/html_serializer.py` | Reconstrói HTML (com shadow DOM e iframes) e passa no `markdownify`; limpa JSON de SPA e quebras de linha em excesso; fatia o Markdown por estrutura (não corta tabela no meio). | `navegador_extrair`: o Markdown sai direto do DOM perfurado (`DOM.getDocument` com `pierce`), sem dependência nova. Pula `script/style/head/noscript/template` e elemento sem caixa; descarta linha longa que é JSON; corta no fim de um bloco, com aviso. |
| `browser_use/tools/service.py` (`dropdown_options`, `select_dropdown`, `find_text`, `upload_file`, `switch`, `close`) e `browser/watchdogs/default_action_watchdog.py` | Lista: `<select>` nativo pelas `options`; combobox ARIA pelo `aria-controls`. Rolar até texto: `DOM.performSearch` + `DOM.scrollIntoViewIfNeeded`. Upload: `DOM.setFileInputFiles`, **só** de caminho que o usuário listou em `available_file_paths` (e corrigiram um *path traversal*, GHSA-j9hj-92j8-jv9h). | Os mesmos comandos CDP. `navegador_enviar_arquivo` só aceita arquivo **dentro da pasta que o dono autorizou no painel**, com caminho resolvido (`realpath`) e conferido contra a pasta (a lição do GHSA). `evaluate` (rodar JS) segue fora. |
| `browser_use/browser/watchdogs/security_watchdog.py` | `allowed_domains`/`prohibited_domains`: confere antes de navegar e de novo quando a navegação termina (pega redirect); `about:blank` sempre passa; `*.dominio` casa subdomínios e o próprio; variante `www.` automática. | O vigia de domínio por sessão: confere o `navegador_abrir`, o link clicado (`will-navigate`), o redirect (`will-redirect`) e o popup, só enquanto uma ferramenta **do agente** roda. Regra mais simples para o dono: `dominio.com` vale para ele e para todos os subdomínios. |

O que **não** veio: o laço do agente, o modelo próprio, nuvem/stealth/proxy, a detecção de ouvintes de clique
por `DOMDebugger.getEventListeners` (cara por elemento) e o fatiamento do Markdown em pedaços numerados (o
Donel corta com aviso; o resto se lê com `navegador_achar_texto` ou `navegador_rolar` + `navegador_extrair`).
