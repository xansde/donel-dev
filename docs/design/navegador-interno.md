# Navegador interno — design da V1

Painel de navegador dentro da aba de sessão. O agente da sessão controla por ferramentas MCP;
o dono vê tudo, pode **assumir** e **devolver**. Desenho decidido por delegação do dono em
30/10, a partir da pesquisa de mercado (`docs/produto/pesquisa-mercado-2026-10-30.md`, item 12)
e do que o T3 Code e o Seazone Studio OS fazem.

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | **Um navegador por PTY** (aba de sessão), não por projeto. | O token do MCP já é por PTY; a chave é uma só nos três lados (view, token, painel). Reiniciar a sessão = navegador novo (os cookies ficam, são da partição). |
| D2 | `WebContentsView` filha da janela principal, presa ao `viewport` do painel por `setBounds`. O renderer mede o retângulo a cada frame e só manda IPC quando muda; o main multiplica pelo zoom da página. DIP cuida do DPI. | É o jeito suportado no Electron 43 (`BrowserView` morreu). Medir por frame pega resize, colapso de painel e troca de monitor sem ouvinte especial. |
| D3 | Teto de **4 views**; criar a quinta destrói a menos usada que esteja escondida e ociosa. View escondida e parada há **15 min** é destruída. | Cada view é um processo de renderer do Chromium. |
| D4 | `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, **sem preload**, `backgroundThrottling: false` (o agente usa a página escondida). Permissões negadas, menos `clipboard-sanitized-write` e `fullscreen`. User-agent sem `Electron/…` (alguns logins recusam). | A página é de terceiro e não pode falar com o app. |
| D5 | Partição **`persist:donel-browser`**. Nada de cookie do Chrome do usuário. | Login no painel é o dono digitando; o Chromium guarda os cookies da partição, o código do app não lê nem grava credencial (por isso **não** precisa de exceção na regra de credenciais do `CLAUDE.md`). |
| D6 | **Exceção nomeada** no `navigation-guard.ts`: `guardBrowserPanelNavigation`, instalada só nas views do painel. Deixa passar http/https/`about:blank`; bloqueia `file://` e qualquer outro esquema; popup (`window.open`, `_blank`) abre no próprio painel; `<webview>` recusado. A janela principal segue com o `guardNavigation` de sempre. | O guard da janela principal protege o `window.donel`; as views não têm `window.donel`. |
| D7 | Downloads (`will-download`) só em `<userData>/browser-downloads`, com nome saneado e único. | Nenhum diálogo, nenhum caminho escolhido pela página. |
| D8 | **Controle por CDP da própria view**: `webContents.debugger.attach()`. **Nunca** `--remote-debugging-port` — a porta exporia o renderer do app. | CDP só daquela página. |
| D9 | **Servidor MCP local** em `127.0.0.1` (porta efêmera), Streamable HTTP mínimo à mão (JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`; resposta `application/json`, sem SSE). Token bearer de 128 bits **por PTY**; `Origin` presente é recusado e o `Host` tem de ser o loopback. Chega ao `claude` por `--mcp-config <userData>/browser-mcp/<ptyId>.json` (servidor `donel`), montado no CommandBuilder. | O SDK de MCP não está no `node_modules` e a regra é sem dependência nova. Mesmo padrão do `--settings` da ponte de hooks. |
| D10 | Ferramentas: `navegador_abrir(url)`, `navegador_ler()`, `navegador_clicar(n)`, `navegador_digitar(n, texto)`, `navegador_teclar(tecla)`, `navegador_rolar(direcao)`, `navegador_voltar()`, `navegador_print()`, `navegador_esperar(ms\|texto)`, `navegador_pedir_humano(motivo)`. `ler` devolve a árvore de acessibilidade resumida com os elementos de ação numerados `[N]`; os números valem até a próxima leitura. | Árvore de acessibilidade é curta, estável e diz o que se pode fazer. |
| D11 | **Dois donos com geração.** "Assumir" dá ao dono uma geração nova (borda laranja + barra "Você está no controle · Devolver ao agente"). "Devolver" só solta o agente se trouxer a geração atual — um Devolver atrasado de um Assumir antigo é ignorado. Com o dono no controle, **toda** ferramenta do agente espera; teto de 10 min, depois erro "o dono ainda está usando o navegador". | O dono pode precisar do navegador a qualquer momento (login, captcha) sem brigar com o agente. |
| D12 | `navegador_pedir_humano(motivo)` abre o painel, mostra o motivo e é um Assumir feito pelo agente: bloqueia até o Devolver (teto de 30 min). O app **não digita nada no PTY**. | Mão humana em login, 2FA, captcha. |
| D13 | **Registro**: cada navegação do agente vira uma linha "Agente abriu: ‹url›" no rodapé do painel; o botão "Navegador" do cabeçalho da sessão mostra quantas linhas chegaram com o painel fechado. | Discreto e sem mexer na timeline do chat (outra frente mexe nela). |
| D14 | **Overlay**: a view nativa fica por cima do DOM. O painel amostra cinco pontos do `viewport` com `elementFromPoint`; se qualquer coisa do app estiver por cima (menu, modal, Mindscape, Esteira), a view se esconde e um print da página entra no lugar. | Genérico: não depende de cada menu avisar que abriu. |

## Emenda agnóstica (03/11, decisão do dono)

> "Odiei a opção do claude in chrome. Abomino essa funcionalidade. Quando disse de ter um navegador a seu
> dispor, é um navegador MESMO, integrado, para uso de qualquer LLM." — Alexandre, 03/11.

- **O navegador é este, integrado.** O toggle "Navegador (Chrome/Edge)" do Launcher (`--chrome`, Claude in
  Chrome, PR #134) saiu no PR #155. `launcherDefaults.chrome` gravado por versão antiga é aceito e descartado
  pelo sanitize.
- **As ferramentas são contrato do app, não do `claude`.** O servidor se chama `donel` e as ferramentas
  `navegador_*` são as mesmas para qualquer agente que fale MCP.
- **A entrega da config do MCP fica atrás de uma função por CLI**: `mcpDeliveryFor(cli, endpoint, configPath)`
  em `src/shared/commandBuilder.ts` devolve o conteúdo do arquivo por sessão e o argv. Hoje há um caso,
  `claude-code` (`--mcp-config <userData>/browser-mcp/<ptyId>.json`), que vale também com provedor de
  terceiro (o provedor troca o endpoint do modelo, não o CLI). Outro CLI que fale MCP (Codex, Gemini CLI…)
  vira mais um `case` ali, com o seu teste; o spawn chama a função com o CLI da sessão e nada mais muda.
- **Texto de UI sem "Claude"**: "Agente abriu: ‹url›", "O agente pediu sua ajuda: ‹motivo›", "Devolver ao
  agente" (D11 e D13 acima já atualizados).

## Peças

- `src/shared/browser/url.ts` — o que o painel abre (puro).
- `src/shared/browser/ipc.ts` — canais e tipos main ↔ renderer.
- `src/shared/browser/axTree.ts` — árvore numerada a partir do `Accessibility.getFullAXTree` (puro).
- `src/shared/browser/keys.ts` — `Ctrl+Enter` etc. para eventos de tecla do CDP (puro).
- `src/shared/browser/control.ts` — máquina de controle com geração e espera (puro).
- `src/shared/browser/mcp.ts` — ferramentas e o JSON-RPC do MCP (puro, executor injetado).
- `src/shared/commandBuilder.ts` — `mcpDeliveryFor` (ponto de extensão por CLI), `buildBrowserMcpConfig` / `browserMcpConfigArgs`.
- `src/main/browser/browser-panels.ts` — as views, partição, downloads, teto e faxina.
- `src/main/browser/cdp-driver.ts` — as ações por CDP.
- `src/main/browser/browser-mcp-server.ts` — o servidor HTTP local.
- `src/main/browser/browser-service.ts` — junta tudo: IPC, tokens por PTY, controle, registro.
- `src/renderer/src/browser/` — painel, botão do cabeçalho, store e a detecção de cobertura.

## Riscos conhecidos

- **Permissão das ferramentas**: o `claude` pede permissão para `mcp__donel__navegador_*` como para qualquer MCP; o app não pré-aprova nada.
- **Página escondida**: o agente pode dirigir o navegador com o painel fechado (`backgroundThrottling: false`, `capturePage` com `stayHidden`). Algumas páginas tratam `document.hidden` diferente.
- **Números `[N]` vencem** a cada navegação; a ferramenta responde pedindo `navegador_ler` de novo.
- **iframes** de outra origem não entram na árvore da V1.
- **Foco emulado**: o driver liga `Emulation.setFocusEmulationEnabled` ao anexar o CDP; sem isso, com o painel
  escondido ou a janela sem foco, `navegador_digitar` não chegava ao campo (visto no teste de 03/11).
- **Senha**: o Chromium mascara o valor de campo de senha na árvore de acessibilidade; o `navegador_ler`
  mostra só "(oculto)", nem a máscara.
- `--mcp-config` é variádico no CLI: o app o põe por último, antes só do `--permission-mode`.
- Canal antigo aberto no mesmo `userData` não conhece o `browser-mcp/`; ele só cria e apaga os próprios arquivos.

## V2 (fora desta entrega)

- Trava de campos de senha e cartão e de botões de comprar/pagar/excluir (o agente pede humano).
- Links do terminal e dev servers detectados abrindo no painel.
- Marcar elemento ou região e mandar como anexo do prompt.
- Gravação da sessão do navegador.
- Perfis (partições) por projeto.
- Importar cookies do Chrome.
- Painel redimensionável e opção de desligar o MCP por sessão no Launcher.
