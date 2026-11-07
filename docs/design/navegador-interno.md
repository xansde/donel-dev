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
| D6 | **Exceção nomeada** no `navigation-guard.ts`: `guardBrowserPanelNavigation`, instalada só nas views do painel. Deixa passar http/https/`about:blank`; bloqueia `file://` e qualquer outro esquema; popup (`window.open`, `_blank`) abre no próprio painel (aba nova desde a V2); `<webview>` recusado. A janela principal segue com o `guardNavigation` de sempre. **Emenda de 04/11 (arquivo local):** ver abaixo. | O guard da janela principal protege o `window.donel`; as views não têm `window.donel`. |
| D7 | Downloads (`will-download`) só em `<userData>/browser-downloads`, com nome saneado e único. | Nenhum diálogo, nenhum caminho escolhido pela página. |
| D8 | **Controle por CDP da própria view**: `webContents.debugger.attach()`. **Nunca** `--remote-debugging-port` — a porta exporia o renderer do app. | CDP só daquela página. |
| D9 | **Servidor MCP local** em `127.0.0.1` (porta efêmera), Streamable HTTP mínimo à mão (JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`; resposta `application/json`, sem SSE). Token bearer de 128 bits **por PTY**; `Origin` presente é recusado e o `Host` tem de ser o loopback. Chega ao `claude` por `--mcp-config <userData>/browser-mcp/<ptyId>.json` (servidor `donel`), montado no CommandBuilder. | O SDK de MCP não está no `node_modules` e a regra é sem dependência nova. Mesmo padrão do `--settings` da ponte de hooks. |
| D10 | Ferramentas: `navegador_abrir(url)`, `navegador_ler()`, `navegador_clicar(n)`, `navegador_digitar(n, texto)`, `navegador_teclar(tecla)`, `navegador_rolar(direcao)`, `navegador_voltar()`, `navegador_print()`, `navegador_esperar(ms\|texto)`, `navegador_pedir_humano(motivo)`. `ler` devolve a árvore de acessibilidade resumida com os elementos de ação numerados `[N]`; os números valem até a próxima leitura. | Árvore de acessibilidade é curta, estável e diz o que se pode fazer. |
| D11 | **Dois donos com geração.** "Assumir" dá ao dono uma geração nova (borda laranja + barra "Você está no controle · Devolver ao agente"). "Devolver" só solta o agente se trouxer a geração atual — um Devolver atrasado de um Assumir antigo é ignorado. Com o dono no controle, **toda** ferramenta do agente espera; teto de 10 min, depois erro "o dono ainda está usando o navegador". | O dono pode precisar do navegador a qualquer momento (login, captcha) sem brigar com o agente. |
| D12 | `navegador_pedir_humano(motivo)` abre o painel, mostra o motivo e é um Assumir feito pelo agente: bloqueia até o Devolver (teto de 30 min). O app **não digita nada no PTY**. | Mão humana em login, 2FA, captcha. |
| D13 | **Registro**: cada navegação do agente vira uma linha "Agente abriu: ‹url›" no rodapé do painel; o botão "Navegador" do cabeçalho da sessão mostra quantas linhas chegaram com o painel fechado. | Discreto e sem mexer na timeline do chat (outra frente mexe nela). |
| D14 | **Overlay**: a view nativa fica por cima do DOM. O painel amostra cinco pontos do `viewport` com `elementFromPoint`; se qualquer coisa do app estiver por cima (menu, modal, Mindscape, Esteira), a view se esconde e um print da página entra no lugar. | Genérico: não depende de cada menu avisar que abriu. |

## Emenda do arquivo local (04/11, pedido do dono)

O dono teve de abrir fora do app o HTML que uma sessão gerou, porque o `navegador_abrir` recusava `file:`.
Agora o painel abre **um arquivo deste computador** que seja página (HTML), imagem ou PDF:

- **Porta única: o carregamento explícito.** A barra de endereço e o `navegador_abrir` aceitam o caminho completo
  (`C:\pasta\relatorio.html`, `/home/x/a.pdf`) ou `file:///`; `shared/browser/url.ts` converte e confere o tipo pela
  extensão. Pasta, arquivo de outro tipo (`.txt`, `.env`…) e pasta de rede (`\\servidor\…`, `file://host/`) são
  recusados. `BrowserPanels.load` é o único lugar que aceita `file:` (`isAllowedLocalFileUrl`).
- **De dentro, a página não sai do lugar.** O guard do painel continua sem deixar passar `file:`: link,
  redirecionamento e popup para outro arquivo ou pasta são bloqueados. Como o `will-navigate` só vê o quadro
  principal, o guard também escuta `will-frame-navigate` e bloqueia todo quadro (`<iframe>`, `<object>`) que aponte
  para `file:`; sem isso, uma página local listaria a pasta ou abriria o arquivo ao lado num quadro.
- **De dentro, a página não lê o disco (revisão do #211).** A regra do Chromium **não** basta: com o fuse
  `GrantFileProtocolExtraPrivileges` ligado (padrão do Electron), uma página `file:` faz `fetch` de qualquer arquivo
  (o Revisor leu `C:\Windows\win.ini`) e o manda para a internet. Por isso a partição do painel trata o protocolo
  `file` (`session.protocol.handle`) e só serve o que `canServeLocalFile` libera: o arquivo aberto de propósito por
  `load` e, abaixo da pasta de um HTML aberto de propósito, só recurso estático (imagem, CSS, JS, fonte), para o
  relatório gerado mostrar as imagens dele. JSON, texto, outro HTML e tudo fora da pasta: 403.
- **Vigia de domínio:** arquivo local não é site, então a lista de domínios do dono não o cobre.
- **Fora daqui:** arquivo que está na VPS. A sessão remota hoje nem tem o MCP `donel` (B38 do `specs/backlog.md`).

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

## V2 (03/11)

Pedido do dono, a partir da análise do browser-use (`docs/pesquisas/browser-use-navegador-2026-11.md`, seção "Estudo do
código"): "Faz o estudo e vai mandando bala. Faz o que for necessário."

| # | Decisão | Por quê |
|---|---|---|
| V1 | **`navegador_ler` mostra a tela, não a página.** Elemento de ação fora da viewport vira contagem ("N acima / N abaixo / N ao lado"); coberto sai e é contado à parte. Texto e títulos fora da tela também saem. Só existe número `[N]` para o que está visível. | Saída menor e sem número para o que não se pode clicar. O conteúdo inteiro é o trabalho do `navegador_extrair`. |
| V2 | **Coberto = ordem de pintura do `DOMSnapshot.captureSnapshot`**: a parte visível do elemento fica toda sob caixas opacas pintadas depois dele (`shared/browser/visibility.ts`). Diferente do browser-use: **descendente não cobre** o próprio elemento, e caixa menor que 4 px não é testada (input escondido atrás do rótulo). `opacity: 0` esconde, menos controle de formulário (checkbox e arquivo customizados ficam assim por cima do desenho). | Sem isso, botão com um `span` de fundo sumiria da leitura. Rolagem dentro de um `div` com `overflow` ainda não entra na conta. |
| V3 | **iframe de outra origem**: `Target.setAutoAttach` com `flatten` na própria `webContents.debugger` dá uma sessão CDP por frame, sem porta (D8 segue valendo). Cada `[N]` guarda a sessão do seu frame; o clique soma o deslocamento da caixa do frame no pai. Até 12 frames de outra origem por leitura. Frame do mesmo processo: `Accessibility.getFullAXTree({ frameId })`. Shadow DOM aberto já vem na árvore de acessibilidade. | É o caminho do browser-use. Teto porque página cheia de anúncio tem dezenas de frames. |
| V4 | **`navegador_extrair(pergunta?, a_partir?)`**: a página inteira como Markdown, 30 mil caracteres por chamada, cortada no fim de um bloco com aviso; `a_partir` continua de onde parou (acréscimo ao pedido, sem ele o resto de uma página longa ficaria inacessível). O app não chama LLM: a pergunta volta só como anotação. **O shadow DOM do próprio navegador nunca é lido**: o de um `<input>` guarda o que foi digitado, senha inclusive. | Sem dependência nova e sem HTML intermediário. |
| V5 | **Popup vira aba**, ativa, até **4 abas por navegador**; passou disso, troca a página como na V1. Teto de 4 navegadores (D3) continua, então o pior caso são 16 renderers. Faixa de abas só com 2 ou mais. Um driver CDP por aba, então os números de uma aba sobrevivem à ida para outra. | Popup não pode tirar o agente da página em que ele está. O popup segue **sem `window.opener`** (a guarda nega e abre a URL), então login em popup que devolve o token ao opener continua sem funcionar; passar para `createWindow` é a evolução natural. |
| V6 | **`navegador_opcoes` / `navegador_selecionar`**: `<select>` nativo por índice, com `input` e `change`; lista acessível por `aria-controls`/`listbox`, abrindo com clique real quando fechada. Texto exato, depois valor, depois trecho se só uma opção casar. | Opção escolhida por trecho ambíguo seria um clique errado calado. |
| V7 | **`navegador_enviar_arquivo` só de uma pasta que o dono autoriza.** **Emenda de 05/11 (pedido do dono)**: as pastas autorizadas são **do app**, valem para todas as sessões e ficam na config (`browserUploads.folders`, chave de topo; canal que não a conhece a preserva em `unknownFields`). O dono vê e remove a lista em Regras → Envio de arquivos, e acrescenta pelo seletor nativo. Arquivo fora delas: o próprio `navegador_enviar_arquivo` (com caminho completo) mostra a pasta e o nome do arquivo no painel com **Permitir / Negar** e espera até 30 min (um pedido por sessão de cada vez: o segundo é recusado enquanto o primeiro espera); pasta larga (Documentos, Área de Trabalho, Downloads, raiz do OneDrive, ou pasta que contém uma delas) mostra um aviso e só libera com um segundo clique explícito (no seletor, uma caixa de confirmação); o caminho a autorizar fica no main, o renderer só manda a resposta. Remover pode vir do renderer, porque só estreita. O caminho pedido passa por `realpath` e é conferido contra a pasta. Até 100 MB. | Gesto do dono, nunca do agente. **Regra de credenciais**: raiz do disco, a casa inteira, `.claude`, `.ssh`, `.aws`, `AppData` e o `userData` não são autorizáveis (nem no pedido, nem relidas da config); dentro da pasta, arquivo ou pasta oculta e nome com cara de segredo são recusados (`shared/browser/upload.ts`). **Emenda de 07/11 (pedido do dono: "receba o poder de liberar as pastas através do orquestrador de cada quadro/projeto")**: o pedido Permitir / Negar ao dono **saiu**. Quem libera pasta nova é o orquestrador: o Líder de um quadro, para as sessões do próprio quadro, e o Líder único, em qualquer quadro (`navegador_liberar_pasta`, com `quadro`). A liberação fica na config (`browserUploadGrants`, chave de topo: quadro, pasta, quem, quando) e aparece em Regras, onde o dono remove. Os anexos do chat (`<userData>/chat-attachments`) saem sempre. A regra de credenciais passou da **pasta** para o **arquivo** (`secretUploadFile`): só a raiz do disco e a casa inteira seguem não autorizáveis; recusado, onde quer que esteja, é o arquivo de segredo (nomes de chave e credencial, cookies e logins de navegador, texto chamado token/secret/senha, tudo de `.ssh`/`.gnupg`/`.aws`/`.azure`/`.kube`, `~/.claude.json`, `settings*.json` de `.claude*`, `~/.docker/config.json`, `~/.config/gh/hosts.yml` e, no `userData`, tudo fora de `chat-attachments`, `browser-downloads` e `pedidos-audio`). |
| V8 | **Vigia de domínio por sessão** (`shared/browser/guardrails.ts`): qualquer site (padrão), só estes, ou qualquer um menos estes, em Regras. `dominio.com` vale para ele e para os subdomínios. Vale **só enquanto uma ferramenta do agente roda**: `navegador_abrir`, `navegador_voltar`, link (`will-navigate`), redirect (`will-redirect`) e popup. Página fora da regra (o dono foi até lá, ou um script redirecionou depois) trava as ferramentas que leem ou agem nela; abrir, voltar e abas seguem. Bloqueio vira erro de ferramenta e linha no rodapé. Sem persistência: morre com a sessão. | O dono navega livre. Iframe de domínio fora da regra **não** é bloqueado, como no browser-use: só a navegação de topo. |
| V9 | **Trava**: o agente não digita nem cola em senha ou cartão, não escolhe opção em lista de cartão, e não clica nem aperta Enter/Espaço em comprar, pagar ou excluir. Recebe erro pedindo `navegador_pedir_humano`, e o rodapé registra. Campo: `type=password`, `autocomplete` `cc-*`, `current-password`, `new-password`, `one-time-code`, ou nome, id, placeholder, `aria-label`, título e nome acessível em pt/en (`search` fica de fora, para "cartões" na busca não travar). Botão: rótulo que **começa** com o verbo ("Pagar agora" trava, "Como pagar" não) ou frase em qualquer posição ("Finalizar compra", "Place order"). Enter num campo também olha o botão de envio do formulário. Lido do elemento **na hora da ação**, não da leitura. Vale em todos os frames. | Heurística sobre o que a página declara, **não é fronteira de segurança**: página hostil pode não declarar nada, e botão só com ícone passa. Falso positivo ("Excluir filtro") só custa um `pedir_humano`. Não há como desligar. |

**`evaluate` (rodar JS) continua fora.** Os scripts que o driver roda na página são fixos, com argumentos passados como valor.


- `src/shared/browser/url.ts` — o que o painel abre (puro).
- `src/shared/browser/ipc.ts` — canais e tipos main ↔ renderer.
- `src/shared/browser/axTree.ts` — árvore numerada a partir do `Accessibility.getFullAXTree`, com frames e contagem do que está fora da tela (puro).
- `src/shared/browser/visibility.ts` — onde cada elemento está, pelo `DOMSnapshot.captureSnapshot` (puro).
- `src/shared/browser/markdown.ts` — DOM perfurado para Markdown (puro).
- `src/shared/browser/guardrails.ts` — vigia de domínio e trava (puro).
- `src/shared/browser/upload.ts` — que pasta e que arquivo podem ser enviados (puro).
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
- **Trava e vigia** param um agente de boa-fé ou enganado pelo que leu; não seguram uma página feita para escapar deles (V9).
- **Foco emulado**: o driver liga `Emulation.setFocusEmulationEnabled` ao anexar o CDP; sem isso, com o painel
  escondido ou a janela sem foco, `navegador_digitar` não chegava ao campo (visto no teste de 03/11).
- **Senha**: o Chromium mascara o valor de campo de senha na árvore de acessibilidade; o `navegador_ler`
  mostra só "(oculto)", nem a máscara.
- `--mcp-config` é variádico no CLI: o app o põe por último, antes só do `--permission-mode`.
- Canal antigo aberto no mesmo `userData` não conhece o `browser-mcp/`; ele só cria e apaga os próprios arquivos.

## Depois da V2

- CLI `donel navegador …` (depende da API local) e a medição com o BU Bench.
- Popup com `window.opener` de verdade.
- Elementos clicáveis sem papel de acessibilidade (`div` com `cursor: pointer`).
- Links do terminal e dev servers detectados abrindo no painel.
- Marcar elemento ou região e mandar como anexo do prompt.
- Gravação da sessão do navegador.
- Perfis (partições) por projeto.
- Importar cookies do Chrome.
- Painel redimensionável e opção de desligar o MCP por sessão no Launcher.
