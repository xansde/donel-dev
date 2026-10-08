# Pesquisa — 014 Chat (Fase 0 do `/speckit.plan`)

**Data**: 2026-10-07 · **CLI verificado**: Claude Code 2.1.293 (Windows 11,
ConPTY) · **Plano**: `plan.md`

Cinco frentes em paralelo, em 07/10:

1. **Mapa do código do Donel**: spawn, PTY, servidor de hooks, leitores de
   transcript, auto-start da Esteira, clipboard, configuração e pilha.
2. **Hooks ao vivo**: node-pty via Electron-como-node e `--model haiku`.
   Sessões isoladas por `--setting-sources project,local`, mais uma rodada com
   a configuração real do dono.
3. **Entrada da TUI ao vivo**: node-pty + `@xterm/headless` 6.0.0 numa pasta
   temporária, 120×40, 9+ boots, 11 formas de mensagem.
4. **Catálogo do transcript**: só estrutura, ~145 mil linhas, versões
   2.1.286–2.1.293, nenhum conteúdo copiado.
5. **T3 Code**: `pingdotgg/t3code@9f48092`, v0.0.45, MIT.

As frentes 2 e 3 também usaram o spike de 07/10 (o que já estava provado
sobre `AskUserQuestion` e Bash por `PreToolUse`).

Legenda: **[VIVO]** provado rodando o CLI · **[BIN]** lido no schema embutido
no binário · **[CÓDIGO]** lido no repo · **[N/V]** não verificado.

Nenhuma configuração global foi alterada. Resíduos das verificações (só
dados do CLI, nada do app): transcripts das pastas temporárias em
`~/.claude/projects/`, três planos em `~/.claude/plans/plan-a-trivial-change-*`
e entradas de projeto no `~/.claude.json`.

## Itens a verificar da spec — resultado

| # | Item | Resultado | Ver |
|---|---|---|---|
| 1 | Gancho de "vou pedir permissão" | **Existe e serve**: `PermissionRequest` dispara só quando o CLI mostraria o diálogo, decide allow/deny com motivo, grava "permitir sempre" pelo próprio CLI e cobre `ExitPlanMode` e `AskUserQuestion`. O plano B não é necessário. | R1 |
| 2 | Teto do tempo de espera de hook | **Sem teto**: segundos por hook, 3.000.000 s aceitos. Default 600 s. | R2 |
| 3 | Fonte da lista de skills/comandos | **Três fontes reconciliadas**: comandos nativos (lista do app), skills/comandos em disco e o `skill_listing` gravado no transcript. Custo de cota zero. | R3 |
| 4 | Imagem por caminho colado | **Funciona**: caminho absoluto colado sozinho vira `[Image #N]` em ~0,6 s e chega como imagem. Não precisa do clipboard. | R4 |
| 5 | Prefixos especiais ao colar | **`!` colado entra em modo shell** (igual a digitado). `?` colado fica literal. `/` e `@` abrem menus, e o `/` pode **trocar o comando** no Enter. Tratamento definido. | R5 |

---

## R1 — Pendências pelo hook `PermissionRequest`

**Decisão**: um único hook `PermissionRequest` (tipo `http`) atende as três
pendências: permissão, pergunta (`AskUserQuestion`) e plano (`ExitPlanMode`).
`PreToolUse` fica só como apoio: ação ao vivo e o `tool_use_id`, que o
`PermissionRequest` não traz.

**Por quê** [VIVO]:

- **Dispara só quando o diálogo apareceria.** Um comando fora das regras
  dispara. O mesmo comando coberto por regra `allow` em
  `.claude/settings.local.json` não dispara, e `Read` não dispara.
  - Com a configuração real do dono (allow amplo para Bash/Edit/Write/Read),
    só sobram `AskUserQuestion`, `ExitPlanMode` e ferramentas fora da lista.
  - É exatamente o FR-022 e o AS 2.4.
- **Respostas.**
  - `allow` roda sem diálogo.
  - `deny` com `message` chega ao Claude como erro da ferramenta, que o cita.
  - `interrupt: true` aborta a rodada, sem a mensagem.
- **"Permitir sempre".** `updatedPermissions` com `addRules` e
  `destination: localSettings` gravou a regra, e o mesmo comando deixou de
  perguntar. `permission_suggestions` já traz a regra pronta (ex.:
  `git init *`); para `Edit`/`Write` só vem `setMode`/`addDirectories`, e
  usamos `{toolName}`.
- **`ExitPlanMode`.**
  - Chega com `tool_input: { plan, planFilePath }`.
  - `allow` **sem** `updatedInput` é ignorado: é preciso ecoar o
    `tool_input`. Vale também para `AskUserQuestion`, a outra ferramenta que
    exige interação.
  - Aprovado, o modo volta ao anterior ao plano; `setMode` escolheria outro.
  - `deny` com mensagem mantém o modo plano, e o Claude reescreve.
- **`AskUserQuestion`.** Passa por `PreToolUse` e, ~140 ms depois, por
  `PermissionRequest`; os dois aceitam `updatedInput.answers`. Seleção
  múltipla = rótulos unidos por `", "`, e texto livre é aceito ("The user
  answered: …").

**Alternativas**:

- `PreToolUse` como canal principal (o spike de 07/10): dispara em **toda**
  chamada e não sabe se o CLI perguntaria. Violaria o FR-022.
- Plano B da spec (aviso de permissão + faixa): só sinaliza, não responde.

**Consequência a registrar**: enquanto o app segura a resposta, a TUI desenha
o mesmo diálogo no terminal oculto, e vale a primeira resposta, dada no chat
ou na TUI [VIVO]. É o que torna verdadeiro o caso de borda "responder pelo
terminal". O AS 2.2 diz "sem nada aparecer na TUI": do ponto de vista do
chat ele vale, mas a redação literal não. **Ajuste proposto ao dono**: "sem
precisar passar pela TUI".

## R2 — Tempo de espera do hook: 86400 s

**Decisão**: `timeout: 86400` (24 h) no `PermissionRequest`. Se o CLI fechar a
conexão (timeout ou abort), a pendência vira `expired` e aparece a faixa "o
terminal precisa de você" (FR-025).

**Por quê**: o timeout é por hook, em segundos, sem teto no código; 3.000.000
foi aceito [BIN]. Um hook de 200 s com timeout 400 foi esperado e honrado
[VIVO]. No estouro, o CLI mata o hook e segue com o diálogo da TUI
(fail-open). Se a TUI responder primeiro, a resposta tardia do hook é
ignorada: o hook não é morto, e a requisição `http` não é abortada [VIVO].

**Alternativas**: o default de 600 s derrubaria o painel após 10 min de
ausência do dono, sem ganho nenhum.

## R3 — Catálogo do menu `/`

**Decisão**: unir três fontes, por aba e com cache por `cwd` invalidado por
`mtime`.

1. **Comandos nativos do CLI**: lista estática no app (nome, apelidos,
   descrição em português, marca `opensScreen`). Revista quando a versão
   suportada do CLI mudar.
2. **Skills e comandos em disco**, lendo só o frontmatter:
   - `~/.claude/skills/*/SKILL.md` e `~/.claude/commands/**/*.md`;
   - `<cwd>/.claude/skills|commands`;
   - plugins habilitados (registro de plugins do CLI).
3. **`skill_listing` do transcript da sessão**: nomes e descrições como a
   sessão enxerga, inclusive `plugin:skill`, uma vez por sessão [catálogo].

O que só existe no disco, como as skills de uso exclusivo do usuário, entra
assim mesmo.

**Por quê**: nenhum attachment enumera comandos nativos [catálogo]. Pegar a
lista "oficial" do CLI exigiria rodar `claude -p`, ou seja, uma execução extra
por aba. Comando nativo que não esteja na lista do app continua funcionando
quando digitado; só não aparece no menu.

**Alternativas**: só disco (perde o conjunto efetivo de plugins); `-p` com
`system/init` (processo extra e risco de cota).

## R4 — Imagem: arquivo temporário + caminho colado

**Decisão**:

- A imagem colada ou arrastada é gravada em
  `userData/chat-attachments/<sessionId>/<n>.<ext>`.
- No envio, cada caminho absoluto é colado **numa colagem própria**, e o app
  espera aparecer `[Image #N]` antes do texto.
- Arquivo não-imagem arrastado vira `@caminho`: relativo ao `cwd` quando
  estiver dentro dele.

**Por quê** [VIVO]:

- O caminho absoluto de arquivo existente colado vira `[Image #N]` em
  ~0,6 s. Aceita `C:\…`, `C:/…`, aspas e espaços.
- O transcript recebe o bloco `image` em base64, mais a linha meta
  `[Image: source: caminho]`, e o modelo descreveu a imagem.
- **Não** converte: caminho dentro de texto, relativo, `file://`, espaço
  escapado.

**Alternativas**: Alt+V com o clipboard (mecanismo da 005) — sobrescreve o
clipboard do dono e depende de ~1,5 s de leitura do CLI; `@relativo` — vira
attachment de arquivo, não imagem anexada.

**[N/V]**: `@` com caminho absoluto fora do projeto. Se não for aceito, o
chat insere o caminho como texto, e o Claude o lê.

## R5 — Prefixos e menus da TUI

**Decisão** (FR-018):

| Começo da mensagem | Comportamento verificado | Tratamento no chat |
|---|---|---|
| `!` | Colado **ou** digitado: entra em modo shell; o Enter roda local, e o modelo comenta depois (1 turno). Não dispara `UserPromptSubmit`. | Selo "vai rodar como comando de shell"; só sai com o CLI ocioso; aceite = `<bash-input>` no transcript. |
| `?` | Digitado abre o painel de atalhos; **colado fica literal**. | Nada (o chat sempre cola). |
| `/` | Abre o menu. **`/mod` + Enter com o menu aberto executa `/model`.** Com argumento (`/skill x`) o menu fecha e o texto fica intacto. Comando desconhecido → "Unknown command" local. | Só sai com o CLI ocioso. Se o menu estiver aberto depois de colar, **um Esc** fecha só o menu e o texto é reconferido antes do Enter. Desconhecido → "não foi" com motivo. |
| `@` | Abre o menu; o Enter envia o literal (3/3). | Nada além da colagem. |
| `#`, `&`, `*`, `\` | Literais. | Nada. |

**Sanitização antes de colar** [VIVO]: `\r\n` e `\r` viram `\n`, e os
controles C0/DEL/C1 são removidos. Um ESC dentro do texto **descartaria o
caractere seguinte**. TAB vira 4 espaços no CLI, e o chat já mostra assim.

## R6 — Prontidão do CLI

**Decisão**: o gate de escrita na PTY é **caixa de entrada visível** (linha
`❯` entre duas réguas `─`) **+ rodapé** ("? for shortcuts" ou "esc to
interrupt") **+ nenhum diálogo**. O gate se repete depois de spawn, `/clear`
e `/resume`.

**Por quê** [VIVO, 9 boots]:

- O REPL "arma" o stdin em 1,85–2,05 s. Bytes escritos entre ~1 s e esse
  instante **se perdem**, com parte ecoada crua na tela.
- O `SessionStart` chega ora antes, ora depois do arming, então não serve de
  gate.
- O primeiro envio de uma sessão confirma em 4–5 s, a frio; os seguintes, em
  0,2–0,75 s.
- O usuário usa `tui: fullscreen` (tela alternativa). O layout inline tem a
  mesma caixa e o mesmo rodapé, e os detectores valem para os dois.

**Correções no código existente** [CÓDIGO + VIVO]:

- `src/shared/trustDialog.ts` exige "2. No, exit", que não existe na
  2.1.293: hoje o diálogo de confiança **não é detectado**.
- `src/shared/cliInputBox.ts` lê placeholder (`Try "…"`) e sugestão fantasma
  como texto (são *dim*), ignora o prompt `!` e limita a caixa a 8 linhas
  (ela vai a 15).

Os dois são usados pelo auto-start da Esteira, que também ganha com a
correção.

## R7 — Protocolo de envio

**Decisão**: protocolo em `contracts/send-protocol.md`. Colagem com bracketed
paste, Enter em escrita separada, aceite pelo hook `UserPromptSubmit` (texto
exato) ou pelo transcript, reenvio **só do Enter** e **nunca** recolagem às
cegas.

**Por quê** [VIVO]:

- O bracketed paste está ligado desde o primeiro frame. Colagem + `\r`
  separado funcionou com 0–200 ms de intervalo, e 200 KB numa escrita só.
- Enter duplo não duplica a mensagem.
- `UserPromptSubmit` dispara ~110 ms após o Enter, com o texto exato. Na
  colagem longa vem embrulhado em `<pasted_content id=…>`, que o chat
  desembrulha para comparar.
- O auto-start da Esteira já provou "conferir o eco antes do Enter e reenviar
  o Enter": 7/7, contra 0/6 com Enter às cegas
  (`docs/relatorio-bateria-enter-2026-08-13.md`).
- O mesmo envio passa a servir à Esteira (FR-020).

## R8 — Texto que sobrou na caixa do terminal

**Decisão**: se a caixa da TUI tiver texto **real** (não *dim*) quando o chat
for enviar, o envio não apaga nada sozinho. O chat mostra "Há texto não
enviado no terminal: «prévia»", com duas ações:

- **Descartar e enviar**: `\x1b\x1b` numa escrita só e releitura da caixa;
- **Abrir terminal**.

**Por quê** [VIVO]: Esc Esc limpa todas as formas (várias linhas, wrap,
`[Pasted text]`, `[Image]`). Em caixa **vazia**, porém, abre o Rewind; com
turno rodando, interrompe. Ctrl+C limpa, mas arma a saída do CLI. O texto foi
escrito pelo dono, e o FR-017 exige exatidão: apagar sem perguntar ou juntar
na mensagem violaria os dois.

**Alternativas**: limpar sempre (perde texto em silêncio); fundir no rascunho
do chat (wrap e quebra de linha real são indistinguíveis na tela).

## R9 — Parar e "interromper e mandar agora"

**Decisão**:

- **Parar** = `\x1b`, só com "esc to interrupt" visível. Com pendência
  aberta, Parar = `deny` + `interrupt: true` pelo hook.
- **"Interromper e mandar agora"** = Esc e, em seguida, o envio normal.
- O fim de uma rodada interrompida é detectado pelo marcador
  `[Request interrupted by user…]` no transcript ou pela tela "Interrupted ·
  What should Claude do instead?".

**Por quê** [VIVO, 3 rodadas]: colar + Enter 62–674 ms após o Esc foi aceito
3/3, sem espera. A interrupção **não dispara hook** (nem `Stop`), e a ordem
das linhas no transcript não é garantida: a mensagem nova pode ser gravada
antes do `tool_result` da interrupção.

## R10 — "Na fila" = fila do CLI

**Decisão** (clarificação Q5):

- **"Na fila"**: Enter com o CLI trabalhando leva a mensagem para a fila do
  CLI. O chat mostra "na fila" ao ver `queue-operation enqueue` (~13 ms) ou
  `UserPromptSubmit`.
- **"Entrou"**: quando chegam `queue-operation remove` (`absorbed_mid_turn`) +
  attachment `queued_command`.

**Por quê** [VIVO]:

- A entrega acontece depois do próximo `tool_result`.
- O texto é gravado verbatim, sem linha `user`.
- Duas mensagens podem ser entregues juntas.

## R11 — Leitura do transcript

**Decisão**: três peças no main.

- **Seguidor adiante**:
  - `fs.watch` no diretório do projeto, como o watcher atual;
  - offset em bytes, com o resto de linha guardado;
  - debounce de 50 ms.
- **Paginador para trás**:
  - blocos de 256 KB a partir do fim, tolerando linhas de até 8 MB;
  - página = 30 rodadas ou 2 MB.
- **Adaptador puro**, que reconstrói a **cadeia ativa** pelo `parentUuid`.

Conteúdo pesado fica no disco (`LineRef`). Algoritmo e regras:
`contracts/conversation-rows.md` §3.

**Por quê** [catálogo]:

- **Tamanhos.** Transcripts principais: p90 4,2 MB, máx. 13,8 MB.
  Subagentes: máx. 38 MB. Linhas de até 1,4 MB, e 17 passam de 1 MB.
- **É uma árvore.** Rewind, prompts abandonados e resultados de chamadas
  paralelas criam galhos. "Qualquer folha" ou ordenar por `timestamp` (15%
  dos passos voltam no tempo) dariam conversa errada.
- **O leitor atual não basta.** Ele lê só os últimos 64 KB por mudança
  (`transcript-watcher.ts`) e não tem leitor adiante nem paginador.

**Meta de latência**: linha nova na tela em até **1 s** depois de o CLI
gravar. Precedente: a 004 mostra o `/rename` na aba em menos de 1 s.

## R12 — Troca de conversa na aba

**Decisão** (FR-033):

- `SessionStart` com `source` `clear`, `resume` ou `fork` e `session_id`
  novo re-aponta a fonte da aba: seguidor do chat, watcher de
  nome/contexto/cor e chaves por sessão (nome, aparência).
- `SessionEnd` com `reason` `clear`/`resume` deixa de ser fim.
- "Retomar" depois do fim do processo = `claude -r <sessionId atual>` com os
  mesmos flags (FR-034).

**Por quê** [VIVO]:

- No `/clear` chega `SessionEnd(clear)` do id velho e, +176 ms depois,
  `SessionStart(clear)` com **novo** `session_id` e `transcript_path`.
- O arquivo nasce ~54 ms depois, ou nunca, se a conversa não tiver mensagem:
  o seguidor espera o caminho aparecer.
- `/resume` gera `SessionEnd(resume)` + `SessionStart(resume)`.
- `/compact` gera `SessionStart(compact)` com o **mesmo** id.

Hoje [CÓDIGO], o `SessionEnd` leva o semáforo a `done` e o `SessionStart`
seguinte é descartado (`session-semaphore-manager.ts:196-197`); o "Reabrir"
inicia conversa **nova** (`TerminalPane.tsx:586-592`).

## R13 — Transporte dos hooks

**Decisão**:

- Hooks `type: "http"` para todos os eventos que o aceitam, com um arquivo
  `--settings` **por sessão** e o token da aba literal no cabeçalho.
- `SessionStart`, onde o `http` não vale, usa `command`:
  `curl.exe --data-binary @-`.
- O encaminhador PowerShell atual sai.

Detalhes em `contracts/hook-bridge.md`.

**Por quê** [VIVO]:

- `http` funciona em loopback, com cabeçalho e corpo UTF-8 do próprio CLI.
  Sem processo intermediário, sem problema de acento em caminho.
- Com a porta fechada, o CLI desiste em ~30 ms e segue pela TUI.
- O token identifica a aba e **sobrevive** ao `/clear`, que troca o
  `session_id`. É ele que permite seguir a troca de conversa (R12).
- No arquivo, e não no ambiente, o token não é herdado pelos comandos que a
  sessão roda.
- Ganho lateral: hoje cada chamada de ferramenta dispara dois
  `powershell.exe` para o semáforo, com corte de 2 s.

**Alternativas**:

- **Encaminhador PowerShell segurando a resposta**: decodificação de stdin e
  resposta sujeita à página de código do console (caminhos com "Área de
  Trabalho") e 300–600 ms de spawn por evento.
- **Token em variável de ambiente**: sintaxe diferente entre cmd e bash nos
  hooks `command`, e herdado pelos processos filhos.

## R14 — Convívio com hooks globais

**Decisão**: o chat responde `{}` imediato em `PreToolUse` (neutro) e decide
só no `PermissionRequest`. Se outro hook decidir antes, a pendência fecha
como `resolved-elsewhere`.

**Por quê** [VIVO + BIN]:

- **Soma, não substitui.** `--settings` soma aos hooks globais, de projeto e
  de plugin: o `pretooluse-safety-check.ps1` do dono rodou junto. Hooks
  idênticos são deduplicados.
- **`PreToolUse`.** O CLI espera todos, e vale **deny > ask > allow**, em
  qualquer ordem.
- **`PermissionRequest`.** O **primeiro** a decidir vence, e os demais não
  são esperados.

Hoje o dono não tem `PermissionRequest` global: sem conflito.

## R15 — Subagentes ao vivo

**Decisão**:

- **Linha viva**: nasce no `tool_use` `Agent` e é completada pelo
  `.meta.json`.
- **Início e última ação**: vêm de `SubagentStart` e dos `PreToolUse` com
  `agent_id`.
- **Fim**: vem da notificação `<task-notification>` e do `SubagentStop`.
- **Painel lateral**: segue `agent-<id>.jsonl` com o mesmo adaptador.
- **Agentes internos** (`agent_type` vazio e sem `SubagentStart`) são
  filtrados.

**Por quê** [VIVO + catálogo]:

- **Hooks.** `PreToolUse`, `PermissionRequest` e `PostToolUse` trazem
  `agent_id`/`agent_type`. O `SubagentStop` traz `agent_transcript_path`,
  `last_assistant_message` e `background_tasks`.
- **Vínculo.** `meta.toolUseId === tool_use.id` e
  `toolUseResult.agentId === agentId`.
- **Segundo plano.** O `Agent` roda em segundo plano por padrão: o `Stop` do
  principal chega **antes** das ações do subagente, e uma pendência de
  subagente pode surgir com o principal ocioso.

O painel e a fila de pendências precisam aceitar isso.

## R16 — "O terminal precisa de você"

**Decisão**: a faixa (FR-004/FR-025) acende por qualquer destas fontes e
apaga quando a caixa de entrada volta a aparecer sem diálogo.

1. Pendência `expired` (R2).
2. `Notification` dos tipos `permission_prompt`, `elicitation_dialog`,
   `agent_needs_input` ou `worker_permission_prompt` sem pendência aberta. O
   CLI a emite 6 s depois de um diálogo não respondido [VIVO].
3. Detectores de tela:
   - diálogo de confiança, incluindo "external imports";
   - telas sem caixa de entrada (barra `▔▔▔` + título conhecido: "Select
     model", "Resume session", abas "Settings/Status/Config/Usage/Stats",
     "Permissions", "Manage MCP servers", "Hooks", "Memory", "Theme",
     "Skills", "Plugins", "Export conversation", "Rewind", "Add directory to
     workspace", "Background", "Effort", "Help");
   - diálogo do modelo desenhado há mais de 2 s sem pendência;
   - "Transcript saving is off".
4. Envio de comando nativo marcado `opensScreen` (R3): a faixa já é esperada.

**Por quê** [VIVO]: diálogos de inicialização não geram hook nenhum. Os
títulos foram levantados um a um, e o Esc fecha todos (`/config` precisa de
dois). No diálogo de confiança o default é "No, exit" e `j`/`k` navegam:
**nunca** escrever texto ali.

## R17 — Ambiente herdado e modo de permissão (FR-030)

**Decisão**:

- **Ambiente**:
  - Mantém o strip pontual de `buildPtyEnv`, que já remove
    `CLAUDE_CODE_CHILD_SESSION`.
  - Acrescenta `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` como garantia.
  - Remove variáveis de ponte/mensageria herdadas de uma sessão-mãe (nomes
    exatos confirmados na implementação).
  - O overlay dos provedores (`ANTHROPIC_*`) continua por cima, e não há
    varredura de `CLAUDE_*`, como manda o comentário de
    `pty-manager.ts:67-74`.
- **Modo de permissão**: todo caminho de spawn passa `--permission-mode`. A
  escolha do launcher; senão o default do CLI do usuário
  (`permissions.defaultMode` em `~/.claude/settings.json`, só leitura, sem
  credencial); senão `default`. O modo vivo segue as linhas `permission-mode`
  do transcript e o campo `permission_mode` dos hooks.

**Por quê** [VIVO + CÓDIGO]:

- **Só uma variável desliga a gravação.** É `CLAUDE_CODE_CHILD_SESSION`,
  com aviso na tela; `CLAUDECODE`, `ENTRYPOINT`, `SESSION_ID` e afins gravam
  normal.
- **Hoje só o launcher passa o modo.** Barra lateral, retomar/fork,
  favoritos, mapa e Esteira não passam nada (`App.tsx:742-1502`).
- **O nome `manual`.** O help lista `--permission-mode manual`, mas o
  payload reporta `default`.

## R18 — Markdown, código e diff

**Decisão**:

- **Markdown**: `react-markdown` 10 + `remark-gfm` 4, **sem HTML cru** (sem
  `rehype-raw`). Links e caminhos do Windows tratados à parte.
- **Destaque de código**:
  - Shiki: núcleo + motor Oniguruma em WASM, gramáticas sob demanda;
  - tema em variáveis CSS mapeadas para os tokens do design-system;
  - destaque só quando o bloco fica visível (IntersectionObserver), com
    cache LRU.
- **Copiar**: por bloco e a resposta inteira, como markdown.
- **Diff**: renderizado a partir do `structuredPatch` que o próprio
  transcript traz. Nenhuma biblioteca de diff.

**Por quê**: escolhas do T3 Code com licença MIT e compatíveis com React
18.3.1. O transcript já entrega os hunks de cada edição [catálogo]. Shiki
precisa de `'wasm-unsafe-eval'` na CSP (R21); o T3 rejeitou o motor
JavaScript do Shiki por travar com regex de backtracking.

**Alternativas**: `highlight.js`, mais leve e sem WASM, mas de fidelidade
menor — reserva caso o dono não queira relaxar a CSP; `@pierre/diffs`
(Apache-2.0, 666 KB) — desnecessário.

## R19 — Rolagem e histórico

**Decisão**:

- Sem virtualizador na v1: paginação por rodadas (R11) e
  `content-visibility: auto` em cada rodada.
- **Rolagem**:
  - modo "seguindo o fim" quando a rolagem está a até 40 px do fim;
  - modo livre caso contrário, com a pílula "novas mensagens ↓";
  - prepend preservando a posição pela diferença de `scrollHeight`.
- **Gate de medição do SC-005**: sessão sintética de 10 mil linhas. Se
  falhar, entra o `react-virtuoso` (MIT).

**Por quê**: o T3 abre a frio com ~75 linhas e usa um virtualizador com
patch próprio de ~70 linhas, que não vale importar. O comportamento de
âncora é portado, não o código.

## R20 — Reaproveitamento do T3 Code

**Decisão**:

| Destino | Peças do T3 Code |
|---|---|
| **Copiar com atribuição** (lógica sem importações) | gatilhos `/`/`@` (`composerTrigger`), ranking fuzzy (`searchRanking`), realce do menu (`composerMenuHighlight`), histórico com ↑ (`composerPromptHistory`), assistente de perguntas (`pendingUserInput`), utilitários de plano (`proposedPlan`), rótulo de comando de shell (`commandLabel`), cópia como markdown (`markdown-clipboard`), `lruCache` |
| **Adaptar** | classificação de ferramentas (`toolActivity`/`toolOutput`) para os nomes do Claude Code, resumo de grupo (`presentation`) reescrito em português, geometria de âncora de rolagem, CSS `.chat-markdown` (vira CSS module) |
| **Só inspiração** | `ChatMarkdown`, timeline, `WorkLog`, painel de aprovação, cartão de plano, fila |
| **Evitar** | Tiptap, `@legendapp/list` com patch, `heic-to` (LGPL), `effect`, `base-ui` |

**Atribuição**:

- `src/renderer/src/chat/vendor/t3code/LICENSE` com o texto MIT ("Copyright
  (c) 2026 T3 Tools Inc.");
- cabeçalho em cada arquivo adaptado: `Adapted from
  pingdotgg/t3code@9f48092 <caminho> — MIT, (c) 2026 T3 Tools Inc.`;
- o arquivo de licença no instalador (`extraResources`).

Ficando em `src/`, a atribuição vai ao espelho público junto com o código
(FR-032).

**Por quê**: o T3 usa React 19 e Tailwind 4. Os componentes TSX precisam ser
reescritos para React 18 e para o design-system do Donel; só a lógica pura
atravessa limpa.

## R21 — Segurança da janela

**Decisão**:

- **CSP**: `script-src 'self' 'wasm-unsafe-eval'` e
  `img-src 'self' data: blob: donel-asset:`.
- **Navegação**: `will-navigate` bloqueado e `setWindowOpenHandler`
  negando tudo.
- **Links do chat**: abrem pelo IPC `chat:open-external`, só `http`/`https`,
  via `shell.openExternal`.
- **Arquivos gerados**: `shell.openPath` só para extensões de documento ou
  imagem, nunca executáveis.
- **Protocolo `donel-asset:`** (`protocol.handle`): serve as imagens do
  transcript e os anexos por referência, só de caminhos validados (arquivos
  da sessão e pasta de anexos).

**Por quê** [CÓDIGO]: hoje não há guarda de navegação nenhuma. Um link no
markdown navegaria a janela que expõe `window.donel.pty.input`. A CSP atual
(`default-src 'self'`) bloqueia imagens `data:`/`blob:` e o WASM do Shiki.

## R22 — Entrega atrás de interruptor

**Decisão**: `chat.enabled` em `config.json`, desligado até a Fase 7 do plano.
Com ele desligado, o app é o de hoje. A Fase 7 vira o padrão (D5) e atualiza
as 11 smokes que esperam `terminal-pane` visível.

**Por quê**: precedente da 011 ("motor inerte por default"). Cada fase pode
cair no alfa sem mudar o uso diário do dono, e ele liga o chat quando quiser
testar.

## R23 — Notificações e sinal da aba

**Decisão**:

- **Notificação do sistema** (`Notification` do Electron, no main), quando
  uma pendência abre e a **janela não está em foco ou a aba não está ativa**
  (FR-024).
- **Clique** foca a janela, ativa a aba e põe o foco no painel.
- **Preferência**: respeita `notificationPreference`; pendência conta como
  permissão.
- **Aba**: mostra "esperando você" pelo estado `permission` do semáforo
  enquanto houver pendência aberta.

**Por quê** [CÓDIGO]: a notificação de hoje é a `Notification` web do
renderer, pula a aba ativa mesmo com a janela fora de foco
(`App.tsx:1723`) e sofre com o throttling de timers em segundo plano.

## R24 — Estratégia de teste

**Decisão**:

- **vitest** (ambiente node) para todo módulo puro, com fixtures
  **sintéticas** de transcript (nomes genéricos `atlas`/`beacon`/`vega`;
  nada de conteúdo real, por LGPD e pelo espelho público) e fixtures de
  **tela** derivadas das capturas da frente 3, nos layouts fullscreen e
  inline.
- **Testes de contrato da ponte de hooks**: servidor HTTP real + cliente que
  imita o CLI. Cobrem segurar, responder, primeira resposta vence, `expired`,
  `401` e limite de corpo.
- **CLI falso roteirizado** (evolução do `DONEL_CLAUDE_EXECUTABLE_FIXTURE`).
  Ele:
  - desenha a caixa e o rodapé;
  - ecoa colagens;
  - grava o JSONL no caminho da sessão;
  - chama os hooks do arquivo `--settings`.

  Com ele, as smokes Playwright do chat ficam determinísticas e sem cota:
  SC-002, SC-003 e SC-006.
- **Gerador de transcript grande** para medir o SC-005.
- **Bateria com o CLI real** no alfa (`quickstart.md`), com `--model haiku`,
  para SC-001 a SC-005, e diário de uma semana para o SC-007.

## Fora da v1 (anotado para depois)

- Hook `MessageDisplay`: entrega o texto da resposta em deltas de linha
  durante o stream, antes do transcript [VIVO]. Abriria "texto chegando por
  linha" numa spec futura; a spec atual mantém texto por bloco.
- Agentes de workflow na faixa de subagentes (hoje ficam na ação
  `Workflow`).
