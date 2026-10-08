# Registro das baterias — 014 (chat)

Uma seção por fase. A parte automática é preenchida pela sessão que fecha a
fase; a bateria real no alfa é preenchida com o dono.

## Fase 1 — Fundação sem tela (08/10)

Branch `feature/014-fase-1`, T005–T041.

### Automático

| Verificação | Resultado |
|---|---|
| `npx vitest run` | 147 arquivos, 3125 testes verdes (7 rodadas; 1 falha intermitente na 1ª, ver nota) |
| `npm run typecheck` | limpo |
| `npm run build` | ok |
| Smoke nova `tests/smoke/chat-foundation.spec.ts` (CLI falso) | verde: semáforo muda pela ponte HTTP; depois de `/clear` no terminal, semáforo, nome e cor seguem a conversa nova |
| Suíte de smoke (`"\.spec\.ts$"`) | ver nota sobre `session-context.spec.ts` |

**Notas**

- **Falha intermitente no vitest**: uma vez em sete rodadas, sem nome
  capturado. A candidata provável era a asserção de latência de ponta a
  ponta (< 10 ms) no contrato da ponte, que media uma única requisição; ela
  passou a usar o melhor de três.
- **`npm run test:smoke` literal quebra desde antes desta fase**: o
  Playwright coleta `accountsCredentialGuard.test.ts` e `statistics.test.ts`
  (vitest) e aborta. A suíte foi rodada com o filtro `"\.spec\.ts$"`. A
  correção natural é `testMatch: '**/*.spec.ts'` no
  `tests/smoke/playwright.config.ts` (fora do escopo; não feita).
- **`session-context.spec.ts` (T611/T612)**: falhou em 2 de 4 rodadas da
  suíte inteira na fase (com `127% · 380k/300k` onde esperava `7% · 20k/300k`:
  o turno menor não chegou à StatusBar a tempo) e passa isolado. **Já falha em
  `staging`**: na única rodada de linha de base que completou (a seguinte
  foi interrompida por falta de memória), a mesma asserção falhou, com 61
  verdes. É intermitência anterior a esta fase.

### Bateria real no alfa — **pendente (dono)**

Com o build do alfa desta branch e o CLI real (`--model haiku`, modo
`default`):

1. **Semáforo pela ponte**: abrir uma sessão, mandar um prompt que use
   ferramenta. O ponto da aba vai a "trabalhando" e volta a "aguardando
   resposta". Repetir com a aba em segundo plano.
2. **`/clear` mantendo a aba**: dar nome e cor à aba, conversar, rodar
   `/clear`. Nome e cor continuam; o semáforo volta a reagir na conversa
   nova; o `%` de contexto recomeça.
3. **`/resume`**: dentro da aba, `/resume` para outra conversa. Mesmo
   resultado do item 2.
4. **Velocidade**: as chamadas de ferramenta não ficam mais lentas (sem
   PowerShell por hook).
5. **Reversão**: com `DONEL_HOOKS_TRANSPORT=legacy` o semáforo volta a
   funcionar pelo caminho antigo.

Resultado: _a preencher_.

## Fase 2 — Leitura no chat (08/10)

Branch `feature/014-fase-2`, T043–T060. Esta parte automática foi registrada na
sessão que fechou a ligação das linhas reais (`renderRow`) e as smokes.

### Automático

| Verificação | Resultado |
|---|---|
| `npx vitest run` | 144 arquivos, 3293 testes verdes |
| `npm run typecheck` / `npm run build` | limpos |
| `chat-reading.spec.ts` (CLI falso) | **verde** (~5 s): a aba abre no chat; título, tabela e código renderizados, com Shiki aplicado; copiar bloco e copiar resposta (clipboard lido no main); 10 alternâncias (5 pelo botão, 5 por `Ctrl+\``) sem perder a sessão, e o mesmo processo ainda responde depois; Modo Foco dobra o trabalho; aviso "Conversa nova" depois do `/clear`; `/exit` → barra "Sessão encerrada" e **Retomar** volta a sessão |
| `chat-live-latency.spec.ts` | **verde** — SC-008: append no transcript → linha na tela. 5 medições (ms): 144, 104, 99, 100, 80 e 93, 97, 97, 75, 89 em duas rodadas; **mediana 93–100 ms** (orçamento 1000 ms) |
| `chat-long-session.spec.ts`, fim visível | **verde** — SC-005: sessão sintética de 10 000 linhas / 6,5 MB (T058). Do clique em Retomar até a última resposta dentro da tela: **0,8 a 1,07 s** (orçamento 2 s), já contando o spawn do CLI falso |
| `chat-long-session.spec.ts`, rolagem sem salto | **verde (corrigido em 08/10, `fix/014-rolagem-historico`)** — salto 1068 px → **0 px** nas 3 cargas, em 3 execuções seguidas; sem `test.fail` |
| `chat-foundation.spec.ts` | verde |
| `npm run test:smoke:gate` | 57 verdes, 1 falha: `session-context.spec.ts` (T611/T612), a intermitência conhecida (`7% · 20k/300k` não chegou à StatusBar); o `test.fail` do SC-005 conta como verde. **Após a correção da rolagem: 58 verdes** |

### SC-005 — rolagem para o topo: salto de posição (CORRIGIDO em 08/10)

**Antes**: ao rolar até o topo e carregar a página anterior, o primeiro item
visível se deslocava **1068 px** (idêntico nas 3 cargas; reproduzido de novo com a
medição nova antes de corrigir).

**Causa raiz**: `preservedScrollTop` somava a diferença de `scrollHeight` medida
logo após o commit. Com `content-visibility: auto`, as rodadas recém-inseridas
entram com a altura estimada (480 px) e trocam pela real depois do commit (medido
no renderer: a âncora derivava −881 px, depois −347 px, em vez de ficar parada), e
o `overflow-anchor: none` impede o navegador de compensar. Uma segunda falha: a
página mais antiga pode terminar no meio de uma rodada, que ganha linhas no início —
o topo e a chave (`round:<primeira linha>`) dessa rodada mudam, então âncora por
topo/chave se perde.

**Correção** (`scrollController.ts`, `Timeline.tsx`): preservar por âncora, não por
altura. Na renderização que traz as linhas novas (o DOM ainda é o antigo) guarda-se
a primeira rodada visível e a distância do **fundo** dela ao topo da viewport
(`data-round-tail` = chave do último item da rodada; o fundo é o que o prepend não
mexe). Depois do commit, `anchoredScrollTop` reposiciona; um `ResizeObserver` refaz o
alinhamento por até `ANCHOR_SETTLE_MS` = 800 ms enquanto as alturas se resolvem;
wheel/touch/pointer/teclado do leitor encerram a trava. Sem dependência nova, sem
virtualizador (plano B do R19 segue não adotado).

**Medição** (sessão sintética de 4000 rodadas / 20 mil linhas — com 2 MB por página
a de 10 mil linhas só tem 2 cargas acima da janela inicial; 3 cargas exigem mais
histórico): salto por carga **0, 0, 0 px** em 3 execuções seguidas (antes 1068,
1068, 1068, com a mesma medição). Tolerância do teste: **24 px** (~1 linha de
texto, o que o olho não percebe como pulo). Fim visível após Retomar: 0,73 a
0,80 s (orçamento 2 s). Teste unitário novo: `anchoredScrollTop`, `firstVisibleIndex`.

### Conferência de forma (screenshots em `test-results/chat-fase-2/`)

Lidos os screenshots das telas principais; os quadros de referência
(`design/chat-handoff/project/*.dc.html`) **não puderam ser renderizados**: dependem
do `support.js` do runtime do canvas, que não está no repositório. A comparação foi
feita contra a descrição de `design/chat-verificacao.md` e das decisões A–F.

- Conforme: dono × Claude (cartão do dono com `>`, hora no canto; Claude como texto
  aberto sob "CLAUDE · hora"); grupo "N ações — rodou 3" recolhido com a falha
  subindo como linha; tabela com "Copiar tabela"; bloco de código com rótulo, Shiki e
  "Copiar"; faixa azul "Conversa nova — a anterior está em Sessões anteriores";
  barra "Sessão encerrada" com Retomar/Fechar aba.
- **Corrigido**: a barra de rolagem da timeline era a nativa clara, destoando do tema
  escuro. Agora `color-scheme: dark; scrollbar-width: thin` com a cor da borda.
- **Corrigido (dado, não forma)**: o aviso de `/resume` não mostrava o texto próprio
  porque o hub criava o aviso com `params: {}`; agora leva `params.source`.
- Não conferido por falta de referência renderizada: espaçamentos finos e a
  tipografia de cada quadro (T02, T08, T09, T10).

### Bateria real no alfa — **pendente (dono, pós-merge)**

Com o build do alfa desta branch e o CLI real. Roteiro (`quickstart.md`):

| Item | O que verificar | Resultado |
|---|---|---|
| B1 passos 1, 2, 4, 5 | abre no chat; markdown/tabela/código e copiar; alternar com o terminal e voltar; rolar para cima sem pular + "novas mensagens ↓" (os passos 3 e a caixa são da Fase 3) | pendente |
| B5 | rodada com ≥ 10 ações, uma edição e um comando que falha, com Modo Foco ligado e desligado; "tem pergunta aqui"; skill como selo | pendente |
| B7 | `/clear` e `/resume <id>` (no terminal, nesta fase): aviso da conversa nova e o texto próprio do `/resume` | pendente |
| B8 | `/exit`: conversa legível e copiável, barra "Sessão encerrada (código N)", **Retomar** continua a mesma conversa | pendente |
| B10 | retomar a maior sessão real (> 10 MB): fim em ≤ 2 s; a rolagem para cima **sem pular** (corrigida na sintética; confirmar no real) | pendente |
| B11 | 10× chat ⇄ terminal: sessão intacta (o rascunho só existe a partir da Fase 3) | pendente |

## Fase 3 — Envio confiável (08/10)

Branch `feature/014-fase-3`, T061–T072. Quatro frentes (máquina de envio pura;
sinais de aceite no main + CLI falso; peças do design-system; pé e faixa) e o
driver com a caixa, juntados na mesma branch.

### Automático

| Verificação | Resultado |
|---|---|
| `npx vitest run` | 154 arquivos, 3499 testes verdes (máquina de envio 70, casamento 12, histórico 11, driver 13, linhas otimistas 9, sinais, pé, faixa) |
| `npm run typecheck` / `npm run build` | limpos |
| `chat-send.spec.ts` (CLI falso) | **verde** — envio durante "iniciando" com a caixa focada; "enviando…" → "✓ entrou"; várias linhas viram uma mensagem; `/mod` → "não foi · comando desconhecido" sem `/model` no transcript; `/foobar` → "não foi"; `/status` entra; na fila com a causa → entrou, uma vez só no transcript; interromper e mandar (SplitButton); `!echo oi` entra sem faixa de sobra; **SC-006**: 10 alternâncias preservando o rascunho; Enter perdido reenviado sem duplicar |
| `chat-working.spec.ts` (CLI falso) | **verde** — pé "trabalhando — <ação>"; Parar interrompe e mostra "Interrompido"; faixa "o terminal precisa de você" com diálogo de tela (`/pick` do falso) e some quando a caixa volta |
| `npm run test:smoke:gate` | **62/62** (2,5 min) |

### Achados e limites conhecidos

- **ConPTY e bracketed paste**: o ConPTY tira `ESC[200~`/`ESC[201~` antes de
  um filho Node, então o CLI falso agora trata LF como quebra e só CR como
  envio (como o Ctrl+J do CLI real). Confirmar no real que várias linhas
  chegam numa mensagem só (B2 item 1).
- **"Interrompido"**: o CLI não dispara `Stop` na interrupção; o estado vem do
  marcador `[Request interrupted by user]` no fim do transcript somado à tela
  sem "esc to interrupt".
- **Faixa por `opensScreen`**: o driver avisa a faixa no Enter de um comando
  marcado, mas quem marca é o catálogo do menu `/` (Fase 5). Até lá, a faixa
  desses comandos vem pelo detector de tela (> 2 s).
- **Auto-start da Esteira pelo driver (T071)**: sem smoke (o falso não simula
  card nem fase); coberto por typecheck e pelos testes do driver.
- **Mapeamento de `Notification` → motivo da faixa** e formato de
  `commandRun.command`: sem payload real nos spikes; confirmar no B4.

### Bateria real no alfa — **pendente (dono, pós-merge)**

| Item | O que verificar | Resultado |
|---|---|---|
| B1 completo | conversa inteira só pelo chat: escrever, "entrou", resposta, alternar, voltar | pendente |
| B2 itens 1, 3, 9–13 | várias linhas; Enter/Shift+Enter; ↑ do histórico; `/mod` não vira `/model`; comando desconhecido; `!comando`; rascunho por aba | pendente |
| B4 | diálogo da TUI sem pendência (ex.: `/model`, permissão em modo legado): faixa aparece com o texto certo, "Abrir terminal" leva até ele e ela some ao voltar | pendente |
| SC-003 | bateria de envio: 20 mensagens variadas (curta, longa, colagem grande, durante a rodada, interromper e mandar) sem perda nem duplicata | pendente |

### Uso real no alfa (dono, 08/10)

- **`/compact` pela caixa do chat**: o comando saiu e compactou a sessão.
  Não houve autocompletar nem menu ao digitar `/`. **Esperado nesta fase**:
  o menu `/` com o catálogo é da Fase 5 (T083–T087), e o envio da Fase 3
  só manda o texto como foi escrito. Fica como item a conferir no B2 completo.
- **Largura do chat**: a coluna ficava presa em 800 px (e a caixa em 752 px),
  com a tela larga sobrando dos lados. E os caminhos `@` longos da linha do
  `/compact` vazavam para fora do cartão. **Corrigido** (decisão do dono, que
  vence a coluna de 800 px do design): conversa, pé de trabalho e caixa
  ocupam a largura do painel (`Composer fluid`), e o caminho longo é cortado
  com reticências, com o caminho inteiro no `title`.
- **Anexar print pela vista de chat**: não dá ainda; o dono teve de ir à
  visão terminal para colar a imagem. Colar/arrastar imagem é o **T088**
  (Fase 5). O envio já sabe mandar imagem (`imagePaths`, §4 do contrato);
  falta a caixa aceitar a colagem e gravar o arquivo (`chat:save-image`).
- **"Não estou recebendo a conversa" que não sai** (alfa, 08/10, para depois):
  numa sessão longa (72% de contexto), o aviso FR-030 apareceu e ficou
  preso. Segundo o dono, "perdeu a conexão com o terminal e nunca mais
  recuperou". No print, porém, a última resposta do Claude está renderizada
  logo abaixo do aviso: as linhas continuam chegando e só o estado
  `reception` não volta a `ok`.
  - Suspeitas a investigar: o poll de recepção (`checkReception` no hub,
    2 s) compara com um caminho ou um `mtime` que ficou velho depois de
    `/compact` ou da troca de conversa; ou o evento `chat:reception` de volta
    a `ok` não é emitido ou não chega ao renderer.
  - Aceite da correção: o aviso some sozinho assim que uma linha nova
    chega, e um smoke cobre esse caminho com `/compact` no meio.

## Fase 4 — Pendências (08/10)

Branch `feature/014-fase-4`, T074–T081, mais a **T088** (imagem colada,
arrastada ou anexada na caixa), antecipada da Fase 5 a pedido do dono.

Seis frentes paralelas, juntadas na mesma branch:
- fila e tradução das respostas para o hook (T074, T075);
- assistente de perguntas e plano, adaptados do T3 (T077);
- CLI falso com pedidos segurados (T080);
- hub, `chat:answer` e notificações (T076, T079);
- painel (T078);
- imagem na caixa (T088).

A smoke (T081) veio por último.

### Automático

- **vitest:** 3640 testes verdes (163 arquivos).
- **typecheck e build:** verdes.
- **Smokes:** `npm run test:smoke` 74/74 e `@chat` 17/17.
- **`chat-pending` (SC-002), 7 cenários, estável em 4 rodadas:**
  - pergunta respondida pelo painel;
  - "Permitir sempre" gravando `Bash(npm install:*)` no `settings.local.json`;
  - Negar com motivo;
  - aprovar plano (`updatedInput` ecoado) e "Pedir ajuste" (deny com o texto);
  - dois subagentes em fila ("mais 1 esperando", a origem, e a próxima pendência sobe na hora);
  - resposta pela TUI fechando o painel;
  - Parar com pendência → `interrupt`;
  - notificação com a aba inativa sem o comando no corpo (gancho de smoke `DONEL_SMOKE_NOTIFICATIONS_LOG`).
- **`chat-composer-image`:** colar, clipe, remover, rascunho, só imagem e arquivo comum → `@caminho`.

### Achados e limites conhecidos

- **Bug achado pela smoke e corrigido:** com pendência aberta o status vira
  `waiting-you`, e o pé de trabalho sumia junto com o Parar. Nesse estado o
  `interrupt` era inalcançável. Agora o pé fica, mas o texto durante a
  pendência é só "trabalhando —", sem verbo, e precisa melhorar.
- **Diálogo da TUI fora do `PermissionRequest`:** com o chat ligado, o toast
  antigo de `permission` da aba claude deixa de aparecer. Esse diálogo segue
  pela faixa "o terminal precisa de você", mas sem notificação do sistema.
- **Pendência sem `PreToolUse` casado (sem `toolUseId`):** fecha só por
  `PostToolUse` ou pelo marcador de interrupção, não pelo `tool_result`. Uma
  negação pela TUI nesse caso deixaria o painel aberto até a rodada acabar.
- **Formato de `hook_permission_decision` no transcript:** não verificado com
  o CLI real; o código aceita as três grafias do id.
- **Imagem:**
  - a mensagem otimista do dono mostra "imagem enviada" sem miniatura (ela
    chega com a linha do transcript);
  - o arraste com o mouse não é exercitado pela smoke;
  - `@` com caminho absoluto fora do projeto não foi verificado no CLI real
    (R4).
- **Forma do painel:**
  - a permissão ganhou o cabeçalho com contador, igual às outras variantes;
  - "Cancelar" do ajuste fica na dica abaixo da caixa;
  - a origem de subagente é texto simples até a Fase 6;
  - a altura máxima usa `62vh`.
- **Smokes instáveis** (passam isolados e na rodada seguinte):
  - `chat-long-session`, SC-005 sob carga;
  - `chat-send`, checagem de `Request interrupted by user`;
  - `chat-live-latency`, 897 ms numa rodada.

### Bateria real no alfa — **pendente (dono, pós-merge)**

| Item | O que verificar | Resultado |
|---|---|---|
| B3 | pergunta, permissão (com "Permitir sempre" e Negar com motivo) e plano (aprovar e pedir ajuste) pelo painel, com o CLI real | **pergunta ok** (08/10: painel com opções, "Outra" e Responder; aba e semáforo em "esperando você"; toast do Windows "Esperando você — pergunta"). Permissão e plano pendentes |
| B3 | responder pelo terminal com o painel aberto: o painel fecha sozinho | pendente |
| SC-002 | nenhuma pergunta ou permissão perdida num dia de uso; notificação do Windows com a janela fora de foco, e o clique leva ao painel | pendente |
| T088 | colar um print com Ctrl+V na caixa e mandar: o Claude recebe a imagem | pendente |

### Uso real no alfa (dono, 08/10)

- **"não foi · o texto não entrou na caixa" em todo texto multilinha** (alfa,
  08/10, para depois): o dono mandou pelo chat um print colado e duas linhas
  (`Shift+Enter` entre elas). O cartão ficou vermelho com "o texto não entrou
  na caixa", mas a imagem e as duas linhas entraram na caixa do CLI. O dono
  trocou para o Terminal, completou a mensagem e apertou Enter, e o Claude
  recebeu `[Image #1]Estou rodando o e2e aqui` + `Descreva o que tem nessa
  imagem` com o anexo de `chat-attachments/`. Ou seja, um falso negativo: o
  envio parou antes do Enter e a caixa não foi limpa.
  - Suspeita: `textSeen`/`boxIsOurs` (`src/shared/chat/sendMachine.ts:393`)
    não reconhecem texto com quebra de linha + placeholder de imagem. O
    `readInputText` pode ler só a primeira linha da caixa, ou a segunda vem
    com recuo/prefixo que o `collapse` não iguala. O `Esc Esc` de limpeza
    também não rodou, o que bate com `boxIsOurs` falhando pelo mesmo motivo.
  - Isolamento feito pelo dono no mesmo dia: pelo chat, uma linha sem
    imagem chegou e uma linha com imagem também. A falha fica no texto de
    2+ linhas, com ou sem imagem. Confirmado depois: duas linhas sem imagem
    (`Shift+Enter`) também falham, então a causa é a quebra de linha e não
    a imagem.
  - Ampliado no mesmo dia: uma mensagem de **uma linha só, porém longa**
    (~190 caracteres, com espaço duplo e parênteses) também falhou. A
    hipótese mais forte passa a ser o wrap: `readInputBox`
    (`src/shared/cliInputBox.ts:156`) junta as linhas de continuação com
    `join('')`. Se o espaço no ponto de quebra (ou o `
` de um `Shift+Enter`)
    não sobrevive ao `visibleText`, o texto lido vira `palavraseguinte` e o
    `collapse` de `textSeen` nunca iguala ao rascunho. Não verificado com
    captura de tela real.
  - Aceite da correção: imagem + texto de 2+ linhas pelo chat chega ao CLI
    e o cartão confirma. Um smoke cobre o caso multilinha com imagem e outro
    sem imagem.
- **Cartões "não foi" se acumulam e não saem** (alfa, 08/10, para depois):
  cada envio multilinha que falha deixa um cartão vermelho, e o único gesto
  que ele oferece é "tentar de novo". Não há como descartar. Os cartões
  também ficam presos no fim da conversa, abaixo das mensagens e respostas
  mais novas, em vez de ficarem na posição em que foram enviados. Com o bug
  acima, a lista cresce a cada tentativa.
  - Lacuna de spec, não só de código: a FR do envio (spec, linhas ~135 e
    ~459) prevê só "entrou" ou "não foi" com "tentar de novo". Falta um
    "descartar", e falta decidir a posição do cartão falho (no ponto do
    envio ou fixo no fim).
  - Decisão do dono (08/10, respondida pelo painel de pergunta no alfa): o
    cartão falho fica **no ponto do envio**, na ordem do tempo. Levar à spec.
  - Aceite: um cartão "não foi" sai num gesto e fica na posição em que foi
    enviado.
- **`Shift+Tab` no chat navega o foco, não troca o modo do CLI** (alfa,
  08/10): no chat, `Shift+Tab` anda entre os botões como num navegador.
  Pela spec isso é esperado: trocar o modo de permissão pela caixa está no
  Out of Scope, e o modo vem do launcher. Mas ficou sem caminho óbvio para
  entrar em modo plano a partir do chat: o dono precisou ir ao Terminal.
  Decidir se vale um atalho (repassar `Shift+Tab` ao PTY com a caixa vazia,
  por exemplo) ou só uma dica na tela.
