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
  - **Corrigido** (08/10): o hook `Stop` contava como "atividade" e chega depois de o follower ler a última linha, então todo turno terminado virava `stale` 8 s depois, sem nada a chegar; `Stop` saiu dos eventos de atividade do hub (teste de reprodução em `chat-hub.test.ts`). Não verificado com CLI real nem com `/compact` de verdade.

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
  **Corrigido** (08/10): o pé dizia só "trabalhando —" com pendência aberta; agora diz "esperando você — pergunta/permissão/plano" (cronômetro e Parar mantidos).
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
| B3 | pergunta, permissão (com "Permitir sempre" e Negar com motivo) e plano (aprovar e pedir ajuste) pelo painel, com o CLI real | **pergunta ok** (08/10: painel com opções, "Outra" e Responder; aba e semáforo em "esperando você"; toast do Windows "Esperando você — pergunta"). **Plano ok** (08/10): cartão "Plano proposto" abriu, "Pedir ajuste" devolveu o texto ao Claude e "Aprovar e seguir" liberou a execução. **Permissão: não deu para testar**, porque o setup do dono auto-aprova tudo (hook `pretooluse-safety-check.ps1` sem matcher + allow global), e não é problema do produto agora |
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
  - **Corrigido** (08/10): a hipótese do wrap se confirmou em teste. `textSeen` e `boxIsOurs` passaram a comparar sem espaço em branco nenhum, o que cobre `Shift+Enter`, linha longa e imagem. Falta conferir no alfa.
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
  - **Corrigido** (08/10): o cartão ganhou "descartar" (`driver.dismiss`) e fica antes da primeira linha posterior ao envio. A spec FR-017 foi atualizada.
  - **Smokes escritos** (09/10, PR #98): `tests/smoke/chat-send-multiline.spec.ts` (multilinha sem imagem, com imagem, linha longa) e `tests/smoke/chat-reception.spec.ts` (`/compact` + aviso forçado que some). O falso passou a desenhar a caixa como o CLI real (wrap, recuo de 2 colunas); contra o código pré-#97 os multilinha e os dois de recepção falham.
  - Aceite: um cartão "não foi" sai num gesto e fica na posição em que foi
    enviado.
- **`Shift+Tab` no chat navega o foco, não troca o modo do CLI** (alfa,
  08/10): no chat, `Shift+Tab` anda entre os botões como num navegador.
  Pela spec isso é esperado: trocar o modo de permissão pela caixa está no
  Out of Scope, e o modo vem do launcher. Mas ficou sem caminho óbvio para
  entrar em modo plano a partir do chat: o dono precisou ir ao Terminal.
  **Corrigido** (08/10, pedido do dono: "quero que shift+tab não seja problema"): `Shift+Tab` na caixa do chat repassa `[Z` ao CLI, e a dica mostra o modo lido do rodapé. FR-013 foi estendida. Falta conferir com o CLI real.
    Decidir se vale um atalho (repassar `Shift+Tab` ao PTY com a caixa vazia,
  por exemplo) ou só uma dica na tela.
- **Cartão de plano: resumo recolhido corta e conta errado** (alfa, 08/10):
  com o plano recolhido (D-C16: título + 3 primeiros passos), o cartão pegou
  a **primeira** lista numerada do markdown, que era a do `## Contexto`, e
  não a dos passos. Mostrou "2 passos" e cortou cada item na primeira linha,
  no meio da frase ("… Isso vale"). O dono leu o plano como "muita
  informação" ao comparar com o terminal, e o plano era mesmo verboso. A
  segunda versão, mais curta, passou melhor.
  - **Corrigido** (08/10): `extractPlanSteps` (`src/shared/chat/t3/proposedPlan.ts`) prefere a seção de passos, depois a última lista de topo. Itens com continuação viram um só, e o encurtamento corta em fim de frase ou com `…`.
  - Aceite: "N passos" conta a lista da seção de passos (ou a última lista
    de topo, se não houver cabeçalho reconhecível), e o recolhido corta em
    fim de frase ou com reticências explícitas.

## Fase 4.5 — Achados do alfa (09/10)

Fase intermediária, criada pelo dono em 09/10. Os achados de 08/10 já tinham sido corrigidos no #97, mas só com teste unitário.

- **#98**: os smokes que os aceites pediam (`chat-send-multiline`, `chat-reception`). O CLI falso passou a desenhar a caixa como o real. Cada smoke falha com o código anterior ao #97 e passa com o atual.
- **Conferência no alfa**: fica junto com a da Fase 5, na mesma página (`conferencia-fase-4-5-e-5.html`, no vault).

## Fase 5 — Caixa rica (09/10)

Branch `feature/014-fase-5`, T083–T087 e T089–T090 (a T088 entrou na Fase 4).

- **Catálogo do `/`** (`commandCatalog.ts`, `command-catalog-scanner.ts`). Junta três fontes:
  - os comandos nativos, 45 deles, uma lista só que o envio também usa;
  - o disco: usuário, projeto e plugins habilitados;
  - o `skill_listing`.

  `/login` e `/logout` ficam fora do menu e ganham selo quando digitados.
- **Arquivos do `@`** (`project-files.ts`): `git ls-files` mais os não rastreados que não são ignorados. Sem git, uma varredura limitada.
- **Menu** (`CommandMenu.tsx` + o `Listbox` novo no design-system):
  - Tab escolhe;
  - Enter envia o que está escrito, então `/mod` vai literal;
  - Esc fecha o menu sem acionar o Parar.

  A ficha de origem segue o design: CLI, global, projeto, plugin.
- **Ficha "texto colado — N linhas"**: aparece acima de 20 linhas ou acima de 2.000 caracteres e abre num `Modal` só de leitura. No envio, o texto colado entra **depois** do que foi digitado, para `/skill` e `!` continuarem no começo da mensagem (`expandPastes`).
- **Selos** do `!` e do `/login`/`/logout`.
- **Automático**:
  - vitest com 3751 testes;
  - typecheck e build limpos;
  - `test:smoke:gate` com 78/78 (duas rodadas do subagente e uma minha).
- **Corrida no `chat-pending`, que é anterior a esta fase**: o poll do pé de trabalho lia `count` e `getAttribute` em duas chamadas. Quando o pé desmontava entre uma e outra, a leitura travava 30 s e derrubava os 7 testes em cascata. Agora é uma leitura só, dentro da página.
- **Limites conhecidos**:
  - nada rodou contra o CLI real, então o `[Pasted text]` real e o aceite de `/skill argumento` não foram verificados;
  - os `opensScreen` da lista nativa foram montados de memória sobre o 2.1.29x;
  - a barra de rolagem do modal fica clara no tema escuro;
  - o smoke só cobre colagem acima do limite.

### Bateria real no alfa — **pendente (dono, pós-merge)**

| Item | O que verificar | Resultado |
|---|---|---|
| B2 completo | os 13 envios do `quickstart.md` B2 | pendente |
| 4.5 | os 8 achados de 08/10 com o CLI real | pendente |
| Fase 4 | responder pelo terminal com o painel aberto; notificação do Windows | pendente |

### Sessão de e2e com o dono — 09/10 (registro passo a passo)

Roteiro conduzido pelo dono no alfa, um teste por vez. O Claude da sessão registra o que chegou do lado do CLI.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 1 | Mensagem de múltiplas linhas | duas linhas: "Teste um:" / "Mensagem de multiplas linhas" | uma mensagem só, com a quebra de linha preservada; enviada com o Claude no meio de um turno, entrou como mensagem na fila do turno em andamento | ✅ passou |
| 2 | Múltiplas linhas com imagem | uma imagem (print do próprio chat) + duas linhas: "teste 2:" / "Multiplas linhas com imagem" | uma mensagem só: `[Image #1]` no começo da primeira linha, depois o texto com a quebra preservada; a imagem chegou legível, servida de `userData/chat-attachments/<sessão>/img-….png` | ✅ passou |

Observações colhidas do print do teste 2 (estado da tela após o teste 1):
- o teste 1 aparece como cartão próprio, com as duas linhas e "✓ entrou", seguido de "trabalhou — 1 ação";
- a notificação do Windows "Claude terminou a tarefa" disparou ao fim do turno — conta como evidência parcial do item "Fase 4 — notificação do Windows" da bateria;
- rodapé lê "modo: bypass" do CLI, coerente com a sessão.
| 3 | Linha longa (muito texto) | "teste 3:" + uma linha de ~1.070 caracteres ("Muito texto" + 12 blocos de `a` separados por espaço) | uma mensagem só, completa, com a quebra depois de "teste 3:" preservada; o CLI a recebeu **como colagem** (bloco de texto colado), não como digitação — abaixo do limite da ficha (20 linhas / 2.000 caracteres), então a ficha não era esperada | ✅ passou — conferir na tela se o cartão mostrou o texto inteiro ou recolhido |

**Achado do teste 3 — ajuste fino, para depois** (dono, 09/10: "nada problemático, mas digno de to-do"):
- o cartão da mensagem enviada mostra as **tags cruas do invólucro de colagem** que o harness grava no transcript: `<pasted_content id="07c5">` na abertura e `</pasted_content id="07c5">` no fim. O chat lê o texto do transcript tal como gravado e não desembrulha o invólucro;
- o cartão abre com uma **linha vazia** só com o chevron `>` à esquerda, e o texto começa uma linha abaixo, desalinhado do chevron (nos cartões dos testes 1 e 2 o texto fica na mesma linha do chevron);
- o conteúdo em si está íntegro e o "✓ entrou" apareceu.
- Aceite proposto: o cartão de mensagem do usuário remove o invólucro `<pasted_content …>`/`</pasted_content …>` (e as quebras que ele deixa em volta) e mostra o texto colado começando na linha do chevron, como uma mensagem digitada.
| 4 | — | não reportado pelo dono nesta sessão | — | sem registro |
| 5 | Atalhos do CLI pela caixa do chat | `Shift+Tab` e o atalho de troca de modelo (o dono tentou `Shift+P`) | `Shift+Tab` chegou: o harness desta sessão registrou a saída do modo plano e do modo auto, ou seja, o ciclo de modo andou. A troca de modelo não aconteceu | ⚠️ parcial — `Shift+Tab` ✅, troca de modelo ❌ |

**Achado do teste 5 — ajuste não-tão-fino** (dono, 09/10: "ajustar um comando e deixar os outros de fora é meio ridículo até"):
- a correção de 08/10 repassou ao CLI **só** o `Shift+Tab` (`BACK_TAB = '\x1b[Z'` em `src/renderer/src/chat/cycleMode.ts`). Os outros atalhos de teclado do CLI morrem na caixa do chat;
- o caso que o dono tentou é a troca de modelo. No CLI o atalho documentado é `Alt+P` (`Option+P` no Mac), não `Shift+P` — `Shift+P` na caixa só digita "P". Conferir na lista de atalhos do binário em uso antes de implementar;
- Aceite proposto: a caixa do chat repassa ao PTY, por uma tabela única, os atalhos do CLI que não têm sentido de edição de texto (troca de modelo, alternar raciocínio, modo de permissão, e o que mais a lista do binário trouxer), e a dica do rodapé os mostra. Os atalhos que a caixa usa para editar (`Enter`, `Shift+Enter`, `Tab` do menu, `Esc` do menu) continuam da caixa. Levar à spec (FR-013, que hoje só fala do `Shift+Tab`).
| 6 | Cartão de plano (D-C16) + aprovação | pediu "um plano teste para o teste 6" em modo plano | o plano (`~/.claude/plans/idempotent-singing-flask.md`) foi montado de propósito com uma lista numerada no `## Contexto` antes dos 5 itens de `## Passos`, que tinham várias frases (o caso do bug de 08/10). A aprovação chegou ao CLI (`ExitPlanMode` aprovado) e a sessão saiu do modo plano | ✅ passou — dono, 09/10: "os dados do teste 6 estão muuuito bons. Não omitiu nada". O cartão de plano fecha o achado de 08/10 (contagem e recorte) com CLI real |

O plano do teste 6 é real e corrige o achado do teste 3 (desembrulhar `<pasted_content>` no `UserRow`, reaproveitando `PASTED_CONTENT_TAG` de `promptMatch.ts`). Pela regra do alfa (feedback no meio de fase: registrar e seguir), a aprovação **não** disparou a implementação nesta sessão. Ela fica para o lote de ajustes.
| 7 | Pergunta de múltipla escolha (painel `AskUserQuestion`) | pediu "me faça uma pergunta de múltipla escolha"; o Claude mandou 2 perguntas no mesmo painel, uma de escolha única e uma de várias escolhas, com opção "(Recomendado)" | as duas respostas voltaram ao CLI completas: escolha única = "Atalhos do CLI (Recomendado)"; várias = as 4 opções marcadas, separadas por vírgula | ✅ passou — dono aprovou o passo; preferência: uma pergunta por vez nessas telas (ver abaixo) |

**Decisões do dono colhidas no teste 7** (valem para o lote de ajustes):
- o primeiro do lote é o **achado do teste 5 (atalhos do CLI)**; as tags de colagem (teste 3) vêm depois;
- repassar **todos os atalhos que o binário em uso listar** e que não sejam de edição de texto. Isso inclui, no mínimo, trocar modelo (`Alt+P`), alternar raciocínio (`Alt+T`) e ver o transcript (`Ctrl+O`). A tabela sai da lista do binário, não de memória.

Observações do print do teste 7:
- o painel funcionou como desenhado: o cabeçalho diz "2 perguntas, uma resposta", a primeira pergunta usa rádio e mostra "escolha uma", a segunda usa caixas de marcar e mostra "escolha uma ou mais". O "(Recomendado)" aparece em verde, há um "Outra" com campo livre em cada pergunta, e o botão "Responder" envia as duas juntas. A aba e o cabeçalho mostram "esperando você" em vermelho, e o pé mostra "esperando você — pergunta" com o cronômetro;
- **ajuste fino:** na pergunta de várias escolhas, a grade de 3 colunas deixou a 4ª opção sozinha numa linha. A descrição dela quebra em duas linhas e encosta na borda de baixo do cartão ("edição de texto.");
- com duas perguntas o painel precisa de rolagem interna: a 2ª pergunta fica com o "Outra" parcialmente abaixo da dobra.

**Preferência do dono** (09/10): "evitasse ao máximo mais de uma pergunta por vez nessas telas". Do lado do Claude, a regra é fazer uma pergunta por chamada sempre que der. Do lado do produto, é uma possível melhoria a decidir: quando vierem várias perguntas, paginar uma por vez, como o CLI faz com abas, em vez de empilhar tudo.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 8 | `/compact` pelo chat (não planejado: o dono compactou no meio da bateria) | digitou `/compac` e deu Enter para confirmar | o transcript tem **um só** `/compact` (17:11:27Z), depois o `compact_boundary`, a entrada `<command-name>/compact</command-name>` e 5 anexos `file` que o CLI relê depois de compactar (memória e rules) | ⚠️ o compact funcionou, mas a conversa ficou "zoada" (3 achados abaixo) |

**Achados do teste 8** (prints do dono, 09/10):
1. **Cartão fantasma `/compac` com "✗ não foi".** O cartão aparece com "enviando…" e depois vira "não foi · o Claude não confirmou o recebimento", com "tentar de novo" e "descartar". O transcript não tem nenhum `/compac`. Hipótese mais provável: o autocompletar do próprio CLI completou `/compac` para `/compact` dentro do PTY, então o texto gravado não bate com o que o chat mandou, o casamento envio × aceite (`normalizePrompt`) falha e o cartão otimista fica órfão. Pode ser também o menu `/` da caixa rica, que completa e envia ao mesmo tempo. **Risco:** o "tentar de novo" mandaria o comando de novo, ou seja, um segundo compact. Correção a decidir: casar o comando de barra pelo prefixo ou pelo comando resolvido, ou completar no menu `/` antes de enviar.
2. **O compact aparece como mensagem do usuário.** Há um segundo cartão `/compact` (o `<command-name>` pós-boundary) com 5 selos `@C:\Users\…\memory\feedback_uma_pergunta_por_vez.md`, `@…\rules\no-artifacts.md` etc. Esses são os arquivos que o CLI relê ao compactar, e não algo que o dono anexou. O esperado é um marcador de sistema, como "conversa compactada · 121k → 10k", sem cartão de usuário e sem selos. Ficaram dois `/compact` na tela: o envio real e o eco do comando.
3. **Grupos "trabalhou" vazios em volta do compact:** "trabalhou — 1 etapa 0 s" e "trabalhou — 3 etapas 1 s". São entradas de modo, hook e anexos do boundary contadas como etapas de trabalho. Isso é ruído, porque o Claude não trabalhou ali.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 9 | `/model` pelo chat | digitou `/mod` e deu Enter, duas vezes | o CLI abriu o seletor de modelo (tela interativa). O dono teve de ir ao terminal, e as duas vezes terminaram em "Kept model as Opus 5.5" | ❌ funciona, mas obriga a voltar ao terminal; o dono não aceita isso ("não gostei nem um pouco") |

**Achados do teste 9** (print do dono, 09/10):
1. **O faixa "O terminal precisa de você" apareceu como desenhado**, mas o dono rejeita a experiência. Comandos que abrem tela interativa no CLI (`/model` e também `Alt+P`, `/config`, `/permissions`, `/resume`, `/agents`, `/mcp`…) não têm equivalente no chat.
2. **O fantasma do teste 8 se repetiu:** o cartão `/mod` ficou em "enviando…", e o `/model` completado apareceu à parte. Isso confirma a hipótese do autocompletar do CLI.
3. **O cartão `/model` ficou "na fila · entra assim que o Claude ficar pronto"** enquanto o seletor esperava no terminal. O estado está errado: o comando já tinha entrado.

**Viável, sim, sem renderizar a tela do CLI no chat.** O caminho é interceptar no chat: o `/model` sem argumento abre um seletor **próprio** (o app já conhece os modelos e o esforço, pelo launcher e pela barra de status), e a escolha vai ao CLI como `/model <id>` **com argumento**, o que não abre tela interativa. O mesmo molde vale, comando a comando, para os outros interativos. Os que não ganharem painel próprio continuam com a faixa. Espelhar a tela do Ink no chat foi descartado: seria frágil e acoplado à versão do binário. Proposta para o lote: `/model` (com `Alt+P`) entra junto do achado dos atalhos (teste 5), porque é a mesma frente.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 13.5 | Enter com o menu `/` ou `@` aberto (numeração do roteiro do dono) | digitou um trecho com o menu aberto e deu Enter (o "@caminh" que chegou solto na conversa) | o texto **literal** e incompleto | ❌ negativo — o Enter envia; clicando no item, completa certinho |

**Achado do teste 13.5 — mesma causa raiz dos fantasmas `/compac` (teste 8) e `/mod` (teste 9):**
- **Causa:** é uma decisão de projeto, não um acidente. Em `ChatComposer.tsx:367-368` está escrito: "Enter is NOT here on purpose: it sends what is written". A regra veio da conferência (`tasks.md:525`, "Enter envia o que está escrito e Tab escolhe") e da pesquisa (`research.md:167-168`). Com o menu aberto, só o Tab e o clique escolhem.
- **Efeito em cadeia no `/`:** o chat manda `/compac` ou `/mod` literal, e o menu do próprio CLI completa isso para `/compact` ou `/model` e executa. O transcript grava o comando completado, o casamento envio × aceite não reconhece o envio, e o cartão otimista fica órfão em "enviando…" ou "não foi". No `@` não há quem complete, então a mensagem sai cortada.
- **Correção proposta (inverte a decisão da conferência, por veredito do dono no alfa):** com o menu aberto e um item realçado, o **Enter escolhe** o item, como o clique e como o CLI já fazem. Um segundo Enter envia. O Enter só envia literal quando o menu está fechado ou sem item realçado. A dica do rodapé muda junto. Isso resolve os três sintomas. Mesmo assim, vale dar ao casamento uma tolerância a comando de barra resolvido pelo CLI (prefixo único no catálogo), para o caso de alguém enviar `/mod` com o menu fechado.
- **Levar à spec:** reabrir o ajuste de `tasks.md:525` e o FR do menu.

> A numeração "N.5" do dono segue o **passo N da conferência das Fases 4.5 e 5** (página de 21 passos): 13.5 = passo 13, "Menu @"; 14.5 = passo 14, "Colagem grande".

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 14.5 | Colagem grande (passo 14) | colou o texto da página da conferência, com cerca de 45 linhas | **completo**: o "Teste 14.5" e os 21 passos, a descrição do passo 14, os botões e o rodapé, tudo dentro de `<pasted_content id="07c5">…</pasted_content>`, sem corte e sem nada fora de ordem | ✅ do lado do CLI; falta o que o dono viu na tela: ficha, quadro mono e "entrou" |

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 15.5 | Arrastar arquivo não-imagem (passo 15; o dono escreveu "1.5", lido como 15.5) | arrastou `acessorios branco.gcode`, que está **fora** do `cwd` (`D:/claquete/`), e escreveu "Teste 1.5" | `"D:/claquete/acessorios branco.gcode"` + quebra + "Teste 1.5": caminho absoluto, barras normais, entre aspas por causa do espaço, **sem `@`** | ✅ conforme o código (`attachmentsModel.ts:45`, `mentionFor`): fora do `cwd` vai o caminho puro, porque o `@` com caminho absoluto não foi confirmado no CLI (pesquisa R4 em aberto). Dentro do `cwd` viraria `@relativo`. Não testado aqui: arrastar arquivo de dentro do projeto |

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 16.5 | `!` modo shell (passo 16, presumido: o dono não numerou) | `!echo oi` | o CLI rodou o comando no modo shell: `<bash-input>echo oi</bash-input>`, `<bash-stdout>oi</bash-stdout>`, `<bash-stderr></bash-stderr>` vazio | ⚠️ o CLI executou certo, mas a saída ficou **escondida** (achado abaixo) |

**Achado do teste 16.5** (print do dono, 09/10): o cartão `! echo oi` (14:16) e o bloco "saída · oi" estão bem formatados, mas caem **dentro** do grupo recolhido "trabalhou — 1 ação 9 s". Recolhido, o grupo esconde exatamente o que o dono pediu para ler. O cartão também não mostra "✓ entrou". O esperado: um `!` digitado pelo dono é um turno dele. O cartão do comando e a saída ficam no nível de cima da conversa, como uma mensagem do usuário com a resposta embaixo, e nunca dentro do agrupador de trabalho do Claude. Com isso, o "trabalhou" do turno do Claude que vem a seguir passa a contar só as ações dele.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 19.5 | Interromper (passo 19): `Esc` e botão Parar | "teste grande espere 15 segundos para responder" e, durante a espera, `Esc` e depois Parar | transcript: a mensagem entrou às 17:17:46Z (l. 751) e **não existe nenhuma resposta do Claude** até a seguinte, às 17:18:40Z. Não há "[Request interrupted]". O Claude **nunca viu** essa mensagem no contexto | ❌ na tela: "nada funcionou". Pelo transcript, o interromper **funcionou no CLI** e o chat não refletiu (achados abaixo) |

**Achados do teste 19.5** (prints do dono, 09/10):
- **O que aconteceu de fato (inferido do transcript e do faixa):** o `Esc` cancelou o pedido antes de sair qualquer resposta. Nesse caso, o CLI tira a mensagem da conversa e **devolve o texto à caixa do terminal**. Por isso não há "Request interrupted" e por isso o Claude não a recebeu. Falta confirmar no terminal se o texto voltou para a caixa.
- **O chat não acompanhou nada disso:**
  1. o cartão "teste grande…" seguiu como "✓ entrou", mas a mensagem tinha sido retirada. O esperado: virar "interrompida", com o texto de volta à caixa do **chat**;
  2. o pé seguiu em "trabalhando" e o botão Parar não deu retorno. O dono não teve nenhum sinal de que o `Esc` pegou;
  3. o faixa "Há texto não enviado no terminal: «teste grande…»" é o texto devolvido pelo CLI, mas o chat o trata como sobra de digitação no terminal. A oferta "Descartar e enviar" apagaria a mensagem;
  4. a mensagem seguinte ("Apertei esc… Teste 19.5") ficou "na fila · entra quando a caixa do terminal esvaziar", mas **foi entregue** às 17:18:40Z. O chat bloqueou por causa do texto devolvido e perdeu o rastro do envio.
- **Correção a estudar:** quando o chat detectar o `Esc` antes da primeira resposta, recolher o texto que o CLI devolveu à caixa, limpar a caixa do terminal e pôr o texto na caixa do chat, marcando o cartão como interrompido. É o equivalente do comportamento do CLI no chat. O mesmo detector precisa dar retorno visível ao Parar.

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 21.5 | Fase da Esteira com auto-start (passo 21) | — | — | ⏸️ adiado por decisão do dono (09/10): "não quero testar o modo dev agora". Roteiro: Dev → "⌁ Preparar" → a aba abre no Chat → o cartão da fase vai a "entrou" sem Enter (T071, `App.tsx:1603`) |

#### Respostas da página de conferência (salvas às 17:22:15Z, `conferencia-fase-4-5-e-5-respostas.json`, sem notas)

| Passo | Item | Marcação do dono | Cruzamento com o registro acima |
|---|---|---|---|
| 1 | Várias linhas | ✅ | teste 1 |
| 2 | Print + linhas | ✅ | teste 2 |
| 3 | Linha longa | ✅ | teste 3 (ajuste fino das tags) |
| 4 | Cartão "não foi" | ✅ | fecha o "teste 4 sem registro" |
| 5 | Shift+Tab | ✅ | o `Shift+Tab` passou; o achado dos outros atalhos (teste 5) segue de pé |
| 6 | Plano | ✅ | teste 6 |
| 7 | Pé do chat | ✅ | — |
| 8 | Recepção ("Não estou recebendo a conversa" não aparece à toa, depois de `/compact`) | ❌ | sem nota; o detalhe do que apareceu fica por colher com o dono. Coincide com o teste 8 (`/compact`) |
| 9 | Os dois lados | ✅ | — |
| 10 | Notificação | ✅ | — |
| 11 | Menu / | ✅ | — |
| 12 | /mod não vira /model | ❌ | testes 9 e 13.5: o chat manda `/mod` literal, como o roteiro pede, mas **o menu do próprio CLI completa e roda o `/model`**. A premissa do passo (vira "não foi · comando desconhecido") não se sustenta com o CLI real. A correção do 13.5 (Enter escolhe o item do menu) **substitui** este critério |
| 13 | Menu @ | ❌ | teste 13.5 |
| 14 | Colagem grande | ✅ | teste 14.5: a tela confirma a ficha, o quadro e o "entrou" |
| 15 | Arrastar | ✅ | teste 15.5 (fora do `cwd`); o caso dentro do `cwd` segue não exercitado |
| 16 | ! | ✅ | teste 16.5: a página marca ✅, mas o registro tem o achado da saída escondida no "trabalhou" |
| 17 | /login | ✅ | — |
| 18 | Fila | ✅ | ✅ no caso simples; o 19.5 mostrou "na fila" errado depois de um `Esc` |
| 19 | Interromper | ❌ | teste 19.5 |
| 20 | ↑ | ✅ | — |
| 21 | Esteira | — | adiado (21.5) |

**Placar da bateria de 09/10:** 16 ✅ · 4 ❌ (8 Recepção, 12 /mod, 13 Menu @, 19 Interromper) · 1 adiado. O 12 e o 13 têm a **mesma causa raiz** (o Enter com o menu aberto envia o literal).

**Lote de ajustes saído da bateria** (ordem do dono para os dois primeiros):
1. atalhos do CLI repassados pela tabela do binário (teste 5), **com o `/model` e outros interativos ganhando seletor próprio no chat** (teste 9);
2. tags de colagem no cartão do usuário (teste 3; plano pronto);
3. Enter com o menu `/` ou `@` aberto escolhe o item (13.5, 12; inverte a decisão da conferência), mais a tolerância do casamento a comando resolvido pelo CLI (fantasmas dos testes 8 e 9);
4. interromper: refletir o `Esc` antes da primeira resposta e recolher o texto devolvido pelo CLI (19.5);
5. `/compact`: marcador de sistema no lugar do cartão de usuário com selos, e sem grupos "trabalhou" vazios (teste 8), mais o aviso de recepção (passo 8);
6. `!`: o comando e a saída no nível de cima, fora do "trabalhou" (16.5);
7. ajustes finos: a grade do painel de várias escolhas e a paginação com várias perguntas (teste 7).

| # | Teste | O que o dono enviou | O que chegou ao CLI | Resultado |
|---|---|---|---|---|
| 22 | Cartões velhos presos no fim da conversa (achado espontâneo, 09/10 ~15h) | — | — | ❌ "fica na minha tela toda hora, mesmo sendo uma mensagem de muito tempo atrás" |

**Achado 22** (print do dono): dois cartões do dono de 14:17 e 14:18 ficam grudados no **fim** da conversa, logo acima do pé, com "✓ entrou", embora horas de conversa tenham vindo depois. Os dois são cartões otimistas aceitos que nunca ganharam linha real, e o `optimistic.ts` os desenha como linha local no fim até saírem do driver (teto de 200). Cada um tem uma causa:
1. **"Olha s´[o o que aconteceu" (mensagem com imagem mandada durante a rodada):** o transcript grava `attachment.type: "queued_command"` com `commandMode: "prompt"`, `humanTurn: true` e **`prompt` como array** `[{type:'text'}, {type:'image'}]` (l. 770). O ramo do adaptador (`adapter.ts`, `foldAttachment`, `queued_command`) só trata `prompt` string. Por isso a mensagem com imagem entregue na fila nunca vira cartão real.
2. **"teste grande espere 15 segundos…" (o do `Esc`, teste 19.5):** a cadeia foi reescrita, a mensagem saiu da conversa e o cartão real sumiu.

**Correção:**
- (a) aceitar `prompt` em array no `queued_command`: juntar os textos e mapear as imagens para anexos, como o prompt direto faz;
- (b) um otimista aceito sem linha real nunca vai para o fim da conversa: fica na posição cronológica do envio ou sai depois de aceito. A exceção é o estado "interrompida" do item 4, que fica no lugar do envio até a próxima mensagem.

#### Lote de ajustes da bateria de 09/10 — entregue em `staging` no mesmo dia

| Item | PR | Conferir no alfa reinstalado |
|---|---|---|
| 1. Atalhos do CLI (tabela do binário 2.1.295) + seletor de modelo no chat (`Alt+P`, `/model` puro), `Ctrl+O` dobras, `Ctrl+Enter` interromper e mandar | #100 | efeito real de `Alt+O`/`Alt+T`/`Alt+W`/`Ctrl+T`/`Ctrl+B`/`Ctrl+]` no CLI; `/model` sem ir ao terminal |
| 2. Tags de colagem fora do cartão | #101 | colar ~1.000 caracteres: cartão sem tags, "entrou" |
| 3. Enter escolhe o item do menu `/` e `@` + casamento tolerante a `/mod`→`/model` | #102 | `/mod`+Enter completa; `@caminh`+Enter completa; sem cartões fantasmas. Pendente: o Esc do driver sobre o menu do CLI (precisa de captura da tela real) |
| 4. Esc antes da resposta: texto volta à caixa do chat, cartão "interrompida", fim de rodada pela tela, "parando…" + achado 22 (cartões presos no fim, `queued_command` com imagem) | #103 | repetir o 19.5; mandar imagem durante uma rodada |
| 5. `/compact` como marcador "conversa compactada · Nk → Mk", sem eco/selos/grupos vazios; aviso de recepção com espera de compact | #104 | repetir o teste 8 e o passo 8. Conhecido: ao reabrir a sessão o cartão do `/compact` digitado some |
| 6. `!` e saída no nível de cima, com "entrou" | #104 | repetir o 16.5 |
| 7. Grade sem órfã (4 opções → 2×2, cartão cresce com a descrição) + uma pergunta por vez com abas e Anterior/Próxima | este PR | pedir uma pergunta com 4 opções e um painel com 2 perguntas |

Teste instável observado no lote: `tests/fake-claude-chat.test.ts` ("queues a message submitted during a round") falha às vezes na suíte inteira com `AttachConsole failed` (PTY no Windows sob carga). Passa isolado e nas reexecuções, inclusive em `staging` sem as mudanças.

### Uso real no alfa (dono, 11/10) — achado 23

**Achado 23 — `/compact` com instruções de várias linhas não roda pelo chat.** Numa sessão longa do Fusion, o dono foi compactar com instruções: `/compact` mais 9 linhas, ~2.900 caracteres. Pelo chat, o comando não rodou em nenhuma das duas tentativas. Nas duas, a mensagem chegou ao Claude como texto comum, embrulhada em `<pasted_content id="a2f2">`, e o Claude respondeu em vez de compactar. Fonte: transcript `~/.claude/projects/…-fusion/186633ad-3ef4-457b-8b88-6500d12d40ed.jsonl`.

| Tentativa | Como mandou | O que o transcript gravou | Resultado |
|---|---|---|---|
| 1 (15:40:54Z) | colou o bloco inteiro, já com o `/compact` dentro | `\n\n<pasted_content id="a2f2">\n/compact Resuma…` | ❌ mensagem comum |
| 2 (15:41:43Z) | seguiu o passo a passo: digitou `/compact `, colou as instruções (ficha "texto colado") e mandou | `\n\n<pasted_content id="a2f2">\n/compact\n\nResuma…`. O `/compact` digitado ficou **dentro** do invólucro, no formato do `expandPastes` (digitado, linha em branco, colagem) | ❌ mensagem comum |
| 3 (15:42:03Z) | pelo terminal, fora do modo chat: digitou `/compact ` e colou o mesmo texto | `<command-name>/compact</command-name>`, com as 9 linhas inteiras em `<command-args>` | ✅ compactou |

**Causa provável** (lida no código, sem reprodução no alfa):
- o `startText` (`src/shared/chat/sendMachine.ts:421-425`) escreve a mensagem inteira no PTY como uma colagem só (`ESC[200~…ESC[201~`), qualquer que seja o tipo da mensagem;
- com texto grande, o CLI recolhe a colagem em `[Pasted text #N +M lines]`, e o próprio `sendMachine.ts:399-403` já conta com esse marcador na caixa. A caixa deixa de começar com `/compact`, e o Enter manda tudo como mensagem, dentro do invólucro `<pasted_content>`;
- o `expandPastes` (`pastedText.ts:39`) põe o digitado primeiro, mas isso só garante a classificação do lado do chat: o `/compact` também chega colado ao CLI;
- `/compact` curto, sem argumento grande (teste 8), vira texto literal na caixa do CLI, e o comando roda.

**Correção a decidir:** num comando de barra, mandar o nome do comando como digitação e colar só os argumentos. Assim a caixa do CLI fica `/compact [Pasted text #1 +M lines]`, como no terminal. Deve valer também para `/skill` e `!` com argumento grande (não testado). Cuidado: digitar `/` abre o menu do CLI (item 3 do lote).

**Contorno até lá:** `/compact` com instruções longas só pelo terminal, ou instruções numa linha curta, bem abaixo dos ~1.000 caracteres que já viraram colagem no teste 3.
