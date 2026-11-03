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
