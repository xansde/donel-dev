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
