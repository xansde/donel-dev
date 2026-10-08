# Verificação — handoff de design "Chat" × spec 014

**Data:** 2026-10-07 · **Handoff:** `design/chat-handoff/`: 11 quadros em `project/*.dc.html` (índice em
`project/canvas.json`), lidos inteiros (~3.500 linhas de HTML), mais `notas-do-designer.md` · **Spec:**
`specs/014-chat/spec.md` (44 cenários, FR-001..FR-035, SC-001..SC-008) · **Brief:** `design/prompt-design-chat.md` ·
**Plano e contratos:** `plan.md`, `data-model.md`, `contracts/` (`conversation-rows`, `hook-bridge`,
`send-protocol`), `tasks.md`.

Este documento tem para a 014 o papel que o `design/modo-dev-v3-verificacao.md` teve para a 009: dizer onde desenho
e spec discordam antes que alguém descubra isso implementando. O dono aprovou o protótipo em 07/10. Esta conferência
não reabre a forma.

**Regra que decide** (fixada pelo dono):
- divergência de **forma** (layout, visual, estilo de texto, posição) → vence o desenho, sem abrandar;
- divergência de **alcance ou comportamento** (o que acontece, o que aparece e quando, contagens, estados, fluxos) →
  vence a spec. Abaixo dela valem os contratos do plano, aprovados junto com ele.

O canvas onde os quadros nasceram era **temporário** e será apagado a pedido do dono. O backup é
`design/chat-handoff/`. Para abrir um quadro, copie o bundle do design system de
`design/modo-dev-v3-handoff/project/_ds/…` para `project/donel/`, como explica o README do handoff. A pasta `prints/`
que o T002 previa não existe: a referência visual é o próprio HTML.

| Quadro | Tela | Tipo |
|---|---|---|
| `Main` | 1 · Modo Foco ligado | janela inteira, interativo |
| `T02` | 2 · Modo Foco desligado | janela inteira |
| `T03` | 3 · pergunta | janela inteira, interativo |
| `T04` | 4 · permissão: comando, edição, subagente | folha de especificação, sem a janela |
| `T05` | 5 · plano | folha de especificação, sem a janela |
| `T06` | 6 · caixa de escrever | folha de especificação, sem a janela |
| `T07` | 7 · subagentes | janela inteira, interativo |
| `T07b` | 7b · subagentes em 1280×760 | janela inteira |
| `T08` | 8 · faixas e avisos | folha de especificação, sem a janela |
| `T09` | 9 · começo e carregamento | folha de especificação, sem a janela |
| `T10` | 10 · a aba | janela inteira |

## 1. Cobertura

Legenda:
- **desenhado**: o quadro mostra o requisito;
- **parcial**: falta um estado ou um texto;
- **só comportamento**: o requisito não tem face própria além do que já está desenhado;
- **lacuna**: nenhum quadro dá a forma. A implementação desenha a partir da spec, com as peças da §4.

### 1.1 Cenários de aceite

| Cenário | Quadro(s) | Situação |
|---|---|---|
| AS 1.1 abre no chat, caixa focada | `T09-A` | desenhado |
| AS 1.2 "enviando…" → "entrou" / "não foi" + tentar de novo | `T06-G`; `Main` (ciclo vivo) | desenhado; falta o motivo do "não foi" (D-C10) |
| AS 1.3 markdown, código colorido, copiar bloco e resposta | `Main` | desenhado; a cópia só é simulada (D-C9) |
| AS 1.4 "trabalhando — <ação>" + Parar | `Main`, `T07`, `T10` | desenhado (tempo verbal: D-C4) |
| AS 1.5 alternar para o terminal e voltar sem perder | `Main` (atalho vivo), `T10` (dica) | só comportamento |
| AS 1.6 retomada: recentes primeiro, anteriores ao rolar | `T09-D` | desenhado |
| AS 1.7 "novas mensagens ↓" | `Main` | desenhado (D-C9) |
| AS 1.8 avisos de compactação, troca de conta e limite | `T08-D` | desenhado |
| AS 1.9 troca de conversa | `T09-C` | parcial: só o `/clear`; falta o texto do `/resume` ("Conversa retomada — a anterior está em Sessões anteriores") |
| AS 1.10 sessão encerrada | `T08-C` | desenhado |
| AS 2.1 pergunta: cartões, prévia, múltipla, "Outra", até 4 + um Responder | `T03` | desenhado (2 perguntas; 3–4 empilham no miolo que rola) |
| AS 2.2 a resposta chega sem passar pelo terminal | `T03` (rodapé) | só comportamento |
| AS 2.3 permissão em português, diff, 3 saídas, motivo | `T04-A`, `T04-B` | desenhado (D-C12, D-C13, D-C14) |
| AS 2.4 não pergunta o que o CLI aprovaria sozinho | — | só comportamento |
| AS 2.5 plano: "Aprovar e seguir" / "Pedir ajuste" → caixa | `T05` | desenhado (D-C16) |
| AS 2.6 "esperando você" + notificação do sistema | `T03`, `T10` (aba e barra lateral) | parcial: notificação não desenhada (D-C17) |
| AS 2.7 faixa "o terminal precisa de você" | `T08-A` | parcial: só o caso "tela interativa"; faltam os textos de `hook-timeout`, `permission-dialog` e `unrecognized` |
| AS 2.8 "pedido do subagente <descrição>" | `T04-C` | desenhado |
| AS 2.9 uma por vez + "mais N esperando" | `T03`, `T04-C` | desenhado (D-C15) |
| AS 3.1 linha curta + detalhe (diff, saída + "ver tudo", lista de arquivos) | `Main`, `T02` | parcial: falta a lista de arquivos da busca (usar a moldura do `CommandOutput`) |
| AS 3.2 grupo "N ações — …" que expande | `Main`, `T02` | desenhado (D-C1, D-C2) |
| AS 3.3 erro visível sem expandir | `Main` (Foco desligado) | desenhado |
| AS 3.4 Modo Foco: "trabalhou — N ações, M notas" | `Main`, `T03`, `T07`, `T09-D`, `T10` | desenhado |
| AS 3.5 selo "tem pergunta aqui" | `Main` | desenhado |
| AS 3.6 selo de skill | `Main`, `T02` | parcial: "usou a skill" está desenhado; "skill <nome> carregada" (pelo dono) não, mas usa o mesmo selo com outro texto |
| AS 3.7 "pensou" recolhido que abre | `Main`, `T02` | parcial: o estado aberto não foi desenhado (D-C5) |
| AS 4.1 Shift+Enter; a caixa cresce até ~10 linhas | `T06-A` | desenhado |
| AS 4.2 menu `/` com nome e descrição | `T06-D` | desenhado; falta a ficha de origem "plugin" |
| AS 4.3 menu `@` | `T06-E` | desenhado |
| AS 4.4 o CLI recebe o texto exato | — | só comportamento |
| AS 4.5 imagem → miniatura removível | `T06-F` | desenhado |
| AS 4.6 arquivo arrastado → `@caminho` | — | só comportamento (vira texto na caixa) |
| AS 4.7 colagem grande → "texto colado — N linhas" | `T06-F` | parcial: "abre para conferir" não tem o estado aberto; usar o `Modal` existente, só leitura, em mono |
| AS 4.8 ↑ volta à mensagem anterior | `T06-A` (dica) | só comportamento |
| AS 4.9 selo do `!` | `T06-B` | desenhado |
| AS 4.10 rascunho por aba | `T10` (dica) | só comportamento |
| AS 4.11 comando da Esteira na caixa | — | lacuna: entra como rascunho, com a semântica do `ArmedPrompt` já aprovado (`Banner` compacto "Comando preparado — nada foi enviado", `Kbd` Enter, Descartar) |
| AS 5.1 linha viva: descrição, tipo, modelo, estado | `T07`, `T07b` | parcial: faltam "falhou" e os estados `killed`, `stopped` e `unknown` (`data-model.md` §7). Mesma linha, com ✕ e "falhou em <tempo>"; `unknown` = "estado desconhecido" |
| AS 5.2 painel lateral ao vivo, fecha com × ou Esc | `T07`, `T07b` | desenhado |
| AS 5.3 faixa no topo com quantos são | `T07`, `T07b` | desenhado (contagem: D-C18) |
| AS 5.4 subagente em segundo plano segue rodando | `T07` | desenhado |
| AS 5.5 aninhado com "ver" | `T07` | desenhado |
| AS 6.1 "na fila" até entrar | `T06-G`, `Main`, `T09-B` | desenhado (D-C10) |
| AS 6.2 "interromper e mandar agora" | — | lacuna (decisão 5) |

### 1.2 FRs com face além dos cenários

| Requisito | Quadro(s) | Situação |
|---|---|---|
| FR-001 abas que não são do `claude` ficam sem alternância | `T10` (nota) | desenhado |
| FR-002 botão + atalho `Ctrl+\`` | `Main` (vivo), cabeçalhos | desenhado |
| FR-004/FR-025 faixa para o que o chat não resolve | `T08-A` | parcial (ver AS 2.7) |
| FR-005 mensagem do dono com anexos (imagem, menção `@`) | — | lacuna: miniatura na forma do `T06-F`, dentro do `OwnerMessage` |
| FR-005/FR-007 linhas `shell` (`!` do dono) e `local-command` (`/color`, `/model x`) | — | lacuna: `OwnerMessage` em mono + `CommandOutput` (`T02`) |
| FR-007 avisos `api-error`, `interrupted` e `informational` | `T08-D` (os outros) | parcial: mesmo `NoticeLine` (G3) |
| FR-012 conteúdo não reconhecido | `T08-D` | desenhado (D-C8) |
| FR-016 colagem acima de 20 linhas ou 2.000 caracteres | `T06-F` | desenhado |
| FR-018 `/login` e `/logout`: selo "afeta a conta — use o painel de Contas" (plano) | — | lacuna: mesmo selo do `!` (`T06-B`) |
| FR-024 notificação do sistema | — | lacuna (D-C17) |
| FR-029 semáforo, cor do `/color`, statusbar | cromo de todos os quadros | contexto: nada muda (D-C22) |
| FR-030 "não estou recebendo a conversa" | `T08-B` | parcial: falta o texto do caso `missing` (o arquivo não nasce); o caso `stale` está desenhado |
| FR-031 credencial nunca aparece | `T08-D`, `T09-A`, avisos | desenhado: só o rótulo da conta, nunca o e-mail |
| FR-033 nome, semáforo, contexto e cor acompanham a troca | `T09-C` | desenhado |
| FR-034 rascunho guardado até retomar | `T08-C` | desenhado |
| FR-035 fila de pendências | `T03`, `T04-C` | desenhado (D-C15) |
| `question` e `plan` já resolvidos na conversa (T053) | — | lacuna: `ActionLine` com o resumo da resposta; o plano entra recolhido, com o desfecho |
| texto que sobrou no terminal com o CLI trabalhando (sem "Descartar", `send-protocol` §3) | `T06-C` (só o ocioso) | parcial |

Casos de borda com face:
- hook estourado e tela interativa → `T08-A`;
- arquivo ausente ou parado → `T08-B`;
- linha que o chat não entende → `T08-D`;
- mensagem que não entra → `T06-G`;
- prefixo `!` → `T06-B`.

Os demais são só comportamento.

SC com face:
- SC-002 → `T03`, `T04`, `T05` e `T08-A`;
- SC-003 → `T06-G`;
- SC-005 → `T09-D`;
- SC-006 → `Main` e `T10`.

**Placar:**

| Conjunto | Desenhado | Parcial | Só comportamento | Lacuna | Contexto |
|---|---|---|---|---|---|
| 44 cenários | 27 | 8 | 7 | 2 | — |
| 18 linhas extras de FR | 8 | 4 | — | 5 | 1 |

## 2. Divergências

Cada item diz, nesta ordem: o quadro e o elemento, o que o desenho mostra, o que a spec ou o contrato diz, a
**classe** e a instrução.

### Conversa e linhas (US1, US3)

**D-C1 · Grupo aberto no `T02`.** O grupo "9 ações — …" vem com `aria-expanded="true"`, com diff e saída abertos. O
designer avisou que abriu o grupo para caber o detalhe. AS 3.2: as ações se agrupam numa linha "que expande".
**Comportamento → vence a spec.** O grupo nasce recolhido, com a falha içada, como o `Main` mostra com o Foco
desligado. O `T02` vale só como referência do estado aberto.

**D-C2 · Composição e rótulo do grupo.** No `Main` e no `T02`, o selo "usou a skill `tdd`" fica dentro do grupo. O
rótulo "9 ações — leu 4, editou 2, rodou 3" não fecha com as linhas desenhadas: são 2 leituras, 1 busca, 1 skill, 2
edições e 3 comandos. Na rodada 2 do `Main`, três ações seguidas aparecem soltas. O contrato
(`conversation-rows.md` §5) diz que `skill` quebra o grupo e que 2 ou mais ações seguidas viram grupo, com até 3
categorias por contagem mais "e mais k". **Comportamento → vence o contrato.** Agrupamento e números saem de
`grouping.ts` e `focusFold.ts`; os do desenho vieram do brief. Com os dados do brief, a sequência fica: "2 ações —
leu 1, buscou 1", o selo da skill, "6 ações — rodou 3, editou 2, leu 1".

**D-C3 · Resultado de teste e código de saída na linha.** O `Main` e o `T02` mostram "Rodou `npm test` — falhou: 1
de 42" e "— 42 passaram", este com ✓ verde, enquanto o `npm run lint`, também bem-sucedido, leva o ícone de terminal.
Mostram ainda "saiu com código 1". O contrato (§4) diz que o resumo de `Bash` é verbo + comando e que o estado vem do
`tool_result` (`is_error`), sem ler a saída. **Alcance → vence o contrato.** Instrução:
- erro: ✕ + "— falhou", na cor de falha;
- sucesso: o ícone da categoria, sem texto;
- `denied`: "— negado";
- `interrupted`: "— interrompido";
- código de saída: só se o `tool_result` começar com "Exit code N";
- nunca contar testes.

**D-C4 · Tempo verbal da ação em andamento.** Os quadros se contradizem:
- o pé do `Main` diz "trabalhando — Rodou `npm test`", texto que veio do brief;
- a linha viva da rodada 2 diz "Rodando `npm test`";
- o pé do painel do `T07` diz "trabalhando — Buscou …".

**Forma → vence a linha viva.** A ação `running` vai no gerúndio ("Lendo", "Editando", "Rodando", "Buscando") na
linha, no pé ("trabalhando — Rodando `npm test`") e no painel. A ação concluída fica no passado. O contrato §4 ganha
a coluna "verbo em andamento".

**D-C5 · "Pensou" com chevron.** No `Main` a linha não tem clique; no `T02` é um botão com `aria-expanded`. O AS 3.7
diz que ela "abre com um clique", mas o `data-model.md` §4 registra que o texto vem vazio em ~98% dos casos
(`hasText`). **Comportamento → vence a spec com o modelo.** Chevron e expansão só aparecem quando `hasText` for
verdadeiro. Sem texto, a linha é fixa: "Pensou · 6 s". O estado aberto não foi desenhado: texto em `--text-muted`,
recuado como o detalhe das ações.

**D-C6 · Caminho no cabeçalho do bloco de código.** O `Main` mostra "typescript · src/simulador/parcelas.ts". O
FR-005 pede linguagem e copiar, e a cerca do markdown quase nunca traz caminho. **Comportamento → vence a spec.** O
caminho só aparece quando a cerca o traz (`ts title=…`, `ts:caminho`); sem linguagem, o rótulo é "texto". Nunca
inferir o caminho.

**D-C7 · Corte do diff na conversa.** O `T02` mostra "… mais 10 linhas alteradas · ver tudo", mas o contrato (§4) só
corta a saída de comando (40 linhas / 8 KB). **Forma → vence o desenho:** o detalhe inteiro segue a um clique. O
limite não foi desenhado: usar 40 linhas, como na saída. O corte em 5 linhas do quadro é exemplo.

**D-C8 · "Conteúdo não reconhecido" sem o tipo.** O `T08-D` mostra "Conteúdo não reconhecido — ver bruto". O
contrato (§9) pede o rótulo do tipo e o bruto truncado em 4 KB. **Comportamento → vence o contrato.** O texto passa a
"Conteúdo não reconhecido (`progress`) — ver bruto". O bloco aberto fica como o desenhado.

**D-C9 · Copiar e "novas mensagens" só simulados.** No `Main`, copiar só troca o rótulo, e a pílula aparece sempre
que a rolagem sai do fim (a 48 px), mesmo sem nada novo. FR-005, FR-011 e AS 1.7. **Comportamento → vence a spec.**
Copiar tem de copiar de verdade: o bloco como texto cru e a resposta como markdown (`markdownClipboard` do T3). A
pílula só aparece com linha nova abaixo da posição de leitura, com o limiar de 40 px da T055.

### Envio (US1, US4, US6)

**D-C10 · Motivos dos estados de envio.** No `T06-G`, "na fila" diz sempre "entra na próxima pausa do Claude", e
"não foi · tentar de novo" vem sem motivo. Em `T03`–`T05`, a caixa segue ativa com uma pendência aberta. O contrato
de envio diz outra coisa:
- §1: o envio fica em `waiting-cli` ("na fila") enquanto houver pendência, faixa ou CLI iniciando;
- §5–§6: cada `failed` tem motivo ("o Claude não ficou pronto", "a imagem não entrou", "comando desconhecido");
- a T072 espera "não foi" com motivo.

**Comportamento → vence o contrato.** A legenda do "na fila" diz a causa:

| Causa | Legenda |
|---|---|
| CLI trabalhando | "entra na próxima pausa do Claude" |
| CLI iniciando | "entra assim que o Claude ficar pronto" (`T09-B`) |
| pendência aberta | "entra depois que você responder" |
| faixa do terminal | "entra quando o terminal liberar" |

O "não foi" mostra o motivo em `--text-muted`, antes do "tentar de novo".

**D-C11 · Estados em que os quadros se contradizem.** É forma, então resolvo item a item.
- **"entrou"**: `Main`, `T06`, `T07` e `T10` mostram "14:09 · ✓ entrou" na rodada 2. O `T03` mostra só a hora, e as
  mensagens enviadas ao vivo no `Main` só o rótulo. Regra: o que o chat enviou neste uso da aba mantém "hh:mm · ✓
  entrou"; o que veio do histórico mostra só a hora.
- **Forma dos estados**: vale a do `T06-G`, com ponto piscando no "enviando…" e etiqueta âmbar no "na fila". O
  texto colorido do `Main` ("na fila — entra quando o Claude fizer uma pausa") é aproximação do protótipo.
- **Comando enviado**: o `/model` sai em fonte de UI no `T08-A`, mas a caixa (`T06-B`, `T06-D`) usa mono. Regra:
  mensagem do dono que começa com `/` ou `!` vai em mono.
- **Esc ao lado do Parar**: o `Kbd` aparece no `Main` e no `T07`, mas não no `T10`. Fica nos três (D-C24).

### Pendências (US2)

**D-C12 · Explicação da permissão inventada.** O `T04-A` diz "… Altera package.json e package-lock.json e baixa
pacotes da internet."; o `T04-C` diz "… Só lê, não altera nada." O app não tem fonte para essa análise: a pendência
traz ferramenta, entrada, diff e sugestões (`data-model.md` §8). O FR-022 pede a ação "em português", e o chat
pergunta o que o Claude perguntaria, sem interpretar. **Alcance → vence a spec.** O painel mostra uma frase-modelo
por ferramenta ("O Claude quer rodar `cmd`", "quer editar `x`", "quer criar `x`", "quer usar `servidor ·
ferramenta`"). Abaixo, a `description` que o Claude escreveu na chamada, verbatim e marcada como dele. Nunca afirmar
efeito ou segurança ("só lê").

**D-C13 · Escopo do "Permitir sempre".** O `T04-B` diz "edições só neste arquivo". Mas o `hook-bridge.md` §3 manda,
quando o CLI não dá sugestão (caso de `Edit` e `Write`), gravar `{"toolName":"Edit"}` em `localSettings`. Isso libera
**todas** as edições do projeto, para sempre: o texto promete menos do que concede. **Comportamento → vence o
contrato.** O rótulo diz a regra real: "sempre: todas as edições neste projeto"; no comando, "sempre: `Bash(npm
install:*)`". O `T04-A` ganha o mesmo rótulo, no mesmo lugar. Como o desenho revela outra expectativa, o caso vai à
**decisão 2**.

**D-C14 · Diff da permissão com numeração do arquivo.** O `T04-B` mostra o gutter com as linhas 18–31 e
"@@ −18,9 +18,18 @@". Só que, na pendência, ainda não há `structuredPatch` (ele nasce com o `tool_result`). A
entrada traz `old_string` e `new_string` (no `Write`, o arquivo inteiro), e o R18 descarta biblioteca de diff.
**Comportamento → vence o contrato.** Instrução:
- as linhas de `old_string` entram como − e as de `new_string` como +, sem LCS e sem número de linha do arquivo;
- um `Write` de arquivo novo entra todo como +;
- `+a −b` conta linhas;
- registrar no `data-model.md` §8 (`PermissionPayload.diff`) que "o app não recalcula diff" vale só para ações
  concluídas.

**D-C15 · Depois de responder.** No `T03`, o painel tem "mais 2 esperando". Depois de responder, ele vira "✓ Resposta
enviada ao Claude … a próxima pendência aparece aqui — 1 esperando", com "Reabrir (demo)". O FR-035 diz: "responder
uma MUST mostrar a próxima". **Comportamento → vence a spec.** Instrução:
- a próxima pendência aparece na hora, com "mais N−1 esperando", sem estado intermediário;
- com a fila vazia, o painel some e a resposta vira a linha `question` da conversa (lacuna, §1.2);
- "Reabrir (demo)" é do protótipo;
- o "(Recomendado)" vem desenhado à parte, mas o contrato devolve os rótulos exatos: estilizar o sufixo sem alterar
  o texto enviado.

**D-C16 · Cartão do plano: metadados e recolher.** O `T05` tem o rodapé "4 arquivos tocados · nenhum contrato
público muda · nada foi alterado ainda", a ficha "5 passos" e a nota "mais de 8 passos abre recolhido, com título e
3 primeiros passos". O FR-023 pede um cartão em markdown, o app não calcula arquivos nem impacto, e a T077 adota a
regra de recolher do T3 (`proposedPlan.ts`). Cada aspecto tem sua classe:
- o que mostrar: **alcance → vence a spec**;
- quando recolher: **vence o plano** (T077);
- como fica recolhido: **vence o desenho**.

Instrução: só o markdown do plano. "N passos" aparece apenas com lista numerada de primeiro nível. O rodapé calculado
sai; as frases fixas "Aprovar libera o Claude para executar o plano." e "Nada é editado antes da sua aprovação."
ficam.

**D-C17 · Notificação do sistema não desenhada.** Ficaram o pulso da aba, o "esperando você" e o rótulo na barra
lateral. O AS 2.6 e o FR-024 exigem a notificação. **Comportamento → vence a spec.** A forma é a `Notification` do
Windows (R23):
- título: o nome da aba;
- corpo: "Esperando você — pergunta", "— permissão para rodar um comando", "— permissão para editar `<arquivo>`" ou
  "— plano proposto", com "(pedido do subagente <descrição>)" quando couber;
- de fora: o comando, o texto da pergunta e o conteúdo de arquivo. A Central de Ações guarda o histórico, e um comando
  pode carregar segredo (FR-031);
- o clique foca a janela, a aba e o painel.

### Subagentes (US5)

**D-C18 · Contagem na faixa e no pé.** No `T07` e no `T07b`, a faixa diz "3 subagentes rodando" com um já concluído
(o designer apontou). O pé diz "trabalhando — Aguardando 2 subagentes" com só um em primeiro plano rodando. Valem o
AS 5.3, o FR-028 e o `LiveState.activeSubagents`. **Comportamento → vence a spec.** Instrução:
- a faixa conta só os `running`: "2 subagentes rodando · 1 concluído", como o designer sugeriu;
- os concluídos seguem como ficha com ✓ enquanto a faixa existir;
- a faixa some quando o último `running` termina;
- o pé conta só os de primeiro plano que o principal espera.

**D-C19 · Subagentes fora da dobra do Modo Foco.** No `T07` e no `T07b`, com o Foco ligado, a mensagem que lançou os
subagentes fica fora de "trabalhando — 3 ações, 1 nota": a nota "Vou levantar o impacto…", o "Subagentes lançados 3"
e as linhas. Já o FR-009 e o `data-model.md` §5 mostram só a mensagem do dono e a resposta final; todo o resto dobra,
inclusive as linhas `subagent`. **Comportamento: pela regra, vence a spec.** Mas aí as linhas vivas sumiriam no modo
padrão, e restaria só a faixa do topo. Isso contraria o protótipo aprovado e o pedido da US5 → **decisão 1**.

### Aba e janela

**D-C20 · "esperando você" na aba e no estado.** O `T03` e o `T10` escrevem "esperando você" no campo `model` do
`TerminalTab` e repetem o rótulo na barra lateral e no `StateDot`. No código, `SESSION_STATE_LABEL_PT.permission` é
"Permissão pendente", texto também usado no título da notificação de hoje (`App.tsx:1729`), e o `TerminalTab` v3 já
pisca o `!` a cada 1 s. **Forma → vence o desenho**; o AS 2.6 usa o mesmo texto. Instrução:
- na aba, o texto vem por uma prop própria (extensão 14), nunca pelo `model`;
- na barra lateral, o rótulo fica como no `T10`;
- `SESSION_STATE_LABEL_PT.permission` passa a "Esperando você", porque pergunta e plano caem no mesmo estado.

**D-C21 · A vista Terminal.** No `Main`, com a vista Terminal aberta, o cabeçalho segue com o Toggle "Modo Foco", e o
terminal ganha uma moldura escrita "vista Terminal — a mesma sessão". No `T10`, o lado Terminal não tem o Toggle. A
D6 diz que o Foco do chat não vale no terminal. **Forma, com quadros em contradição → vale o `T10`.** Na vista
Terminal ficam só o Chat | Terminal e o `Kbd`. O terminal é o `TerminalPane` de hoje, sem moldura: o brief pediu esse
lado "só como referência".

**D-C22 · Cromo da janela.** Os quadros de janela inteira repetem:
- titlebar com três pontos estilo macOS;
- `AccountBadge` com rótulo fixo (apontado pelo designer);
- barra lateral "Projeto + Sessões", sem o painel "Sessão em foco";
- cabeçalho com o ramo no lugar do caminho;
- StatusBar "212k/400k".

**Forma fora do escopo da 014.** O brief limitou o desenho à área da aba. O cromo segue o v3 implementado, e D-V1,
D-V2 e D-V6 continuam valendo. Instrução:
- o chat só **acrescenta** o Toggle, o Chat | Terminal e o `Kbd` ao cabeçalho de sessão de hoje (`sessionHeader`,
  `App.tsx`), e só nas abas `claude`;
- o rótulo no `AccountBadge` (prop `label`) vira pedido à parte, da área de contas (011);
- a única mudança no cromo é o trilho da decisão F.

**D-C23 · Modo Dev não desenhado.** Os 11 quadros estão em "Uso geral". No Modo Dev, a aba fica entre o mapa
(480 px) e o `PhaseDetailsPanel` (316 px): a 1280 sobram ~484 px para o chat, e o painel do subagente (420–460 px)
não cabe ao lado. **Sem desenho, a regra não resolve** → **decisão 3**.

### Transversais

**D-C24 · Quatro gestos para o Esc.** Cada quadro dá ao Esc um papel diferente:
- `Main`: um `Kbd` "Esc" ao lado do Parar, e o Esc na caixa interrompe;
- `T04-A`: "Esc nega";
- `T05`: "Esc cancela" o ajuste;
- `T06`: "Esc fecha" os menus;
- `T07`: o Esc fecha o painel. É o único gesto que a spec define (FR-027).

O contrato de envio (§9) proíbe Esc na PTY fora do Parar e do "interromper e mandar". **Comportamento → vence a
spec.** As adições valem nesta precedência, só com o foco na vista Chat; ganha o primeiro caso que se aplicar:
1. menu `/` ou `@` aberto → fecha o menu;
2. campo de motivo ou de ajuste em edição → cancela o campo;
3. painel lateral aberto → fecha o painel;
4. pendência na cabeça do painel → "Negar" sem motivo (o `deny` simples; o Parar com pendência é `deny` +
   `interrupt`);
5. Claude trabalhando → Parar.

Esc = Parar e Esc = Negar são alcance novo → **decisão 4**.

**D-C25 · Aditivos de alcance.** Três peças foram desenhadas e aprovadas, mas estão fora da spec:
- "Copiar tabela" (`Main`): está no brief, não no FR-005;
- o clipe em todas as caixas: o FR-015 só fala em colar e arrastar;
- "resultado: <primeira linha>" no subagente concluído (`T07`): não está no `data-model.md` §7.

Somam-se a elas os gestos de Esc da D-C24. **Alcance → vence a spec**, porque nada disso é obrigatório. Ainda assim,
a recomendação é aceitar → **decisão 4**.

**D-C26 · Cor de falha.** O `Main`, o `T02` e o `T06` usam `--state-permission` (coral) na falha, no "não foi", no
"saiu com código" e nas linhas removidas do diff. O `design/design-system.md` reserva o coral para "precisa de você
agora" e o roxo (`--state-error`) para falha. **Forma → vence o desenho.** Há precedente aprovado: o
`PhaseStateGlyph` já pinta `failed` de coral. Os sinais se separam pelo movimento: coral **pulsando** = precisa de
você (aba, `StateDot`); coral **fixo** = falhou ou removido. Atualizar a regra de cor do `design-system.md` na T050.

**D-C27 · Acessibilidade.** A forma fica; a semântica muda.
- **Links como ação**: "ver tudo" (`T02`), "abrir" e "ver bruto" (`T08-D`) e "abrir" (`T09-C`) estão desenhados
  como `<a href="#…">`. Viram botões (`Button · link`); a guarda de navegação do R21 bloquearia o `href` de qualquer
  jeito.
- **Rótulos de ícone**: os `<svg>` com `aria-label` mas sem `role="img"` ("Você", "Pergunta") ganham `role="img"`
  ou texto oculto.
- **Alça do painel lateral** (`T07`/`T07b`): hoje é `aria-hidden` e não funciona pelo teclado. Vira
  `role="separator"` com `aria-orientation="vertical"`, e as setas ajustam a largura.
- **Opções da pergunta** (`T03`): o `radiogroup` ganha tabindex itinerante para navegar com as setas.
- **Pendência nova**: anunciada em `aria-live="polite"`, sem roubar o foco da caixa.
- **Contraste** (medido com os tokens): todos os pares de texto ficam em 4,5:1 ou mais. O mais baixo é o número de
  linha do diff sobre a faixa verde, com 4,50:1, no limite.
- **Vocabulário**: nenhum termo interno nos textos. A conta aparece só pelo rótulo, nunca pelo e-mail.

## 3. Pede decisão do dono

1. **Subagentes e Modo Foco (D-C19).** Duas saídas:
   - (a) a spec como está: as linhas `subagent` dobram com o resto, e o acesso ao vivo fica na faixa do topo;
   - (b) como desenhado: a mensagem que lança subagentes, com as linhas, fica fora da dobra.

   **Recomendo (b):** é o protótipo aprovado e o que a US5 pede. Custo: uma frase no FR-009 e no `focusFold`
   (`data-model.md` §5).
2. **Escopo do "Permitir sempre" em edições (D-C13).** Duas saídas:
   - (a) o contrato como está, com rótulo honesto: "sempre: todas as edições neste projeto";
   - (b) como o desenho promete: uma regra por arquivo, com `ruleContent` levando o caminho em `Edit` e `Write`.

   **Recomendo (b):** concede menos e bate com o que foi aprovado. Muda uma linha do `hook-bridge.md` §3, depois de
   confirmar no CLI a sintaxe do caminho, com o mesmo rigor do R1. Custo: o chat volta a perguntar a cada arquivo
   novo.
3. **Modo Dev (D-C23).** **Recomendo:** no Modo Dev, enquanto estiver aberto, o painel do subagente ocupa a coluna
   direita no lugar do `PhaseDetailsPanel`. É o mesmo precedente do Launcher, que já divide essa coluna. O painel fica
   com a largura dela (316 px), sem tirar espaço do chat, e o mapa não se mexe.
4. **Aditivos (D-C24, D-C25).** **Recomendo aceitar os quatro**, como extensões dos FR-005, FR-015, FR-008/FR-022 e
   FR-027:
   - copiar tabela, como markdown;
   - clipe: abre o seletor de arquivos; imagem vira anexo, outro arquivo vira `@caminho`;
   - Esc = Parar e Esc = Negar, na precedência da D-C24;
   - "resultado:" do subagente: a primeira linha não vazia do texto final, sem IA.
5. **"Interromper e mandar agora" (AS 6.2), não desenhado.** **Recomendo:** com o Claude trabalhando, o "Enviar"
   vira `SplitButton`, que já existe. O clique envia para a fila, e o menu traz "Interromper e mandar agora". Sem
   atalho novo.

**Decidido pelo dono em 07/10/2026:**

| # | Decisão |
|---|---|
| 1 | **(b)**, como recomendado. |
| 2 | **(a)**: "Permitir sempre neste projeto" vale para o **projeto inteiro**. Nas edições, o rótulo diz "sempre: todas as edições neste projeto"; o `hook-bridge.md` §3 fica como está. |
| 3 | Aceita a recomendação. |
| 4 | Aceita os quatro aditivos. |
| 5 | Aceita a recomendação. |

As decisões entraram na spec (FR-005, FR-008, FR-009, FR-015, FR-022, FR-027 e clarificações), no `data-model.md` §5
e nas tarefas da §7.

## 4. Extensões

As peças do DS são apresentacionais: recebem props e não fazem IPC. Os arquivos que o plano lista em
`src/renderer/src/chat/**` são os contêineres que as montam.

| Origem | Total | Aceitar como extensão | Variante | Não precisa | Absorvida |
|---|---|---|---|---|---|
| propostas do designer | 14 | 11 | 2 | 1 (`AnnotationTag`, já existe) | — |
| peças sem nome achadas nos quadros | 5 | — | 1 (`Button · link`) | 1 (tooltip) | 3 |

| # | Proposta | Recomendação | Nome final | Por quê |
|---|---|---|---|---|
| 1 | ConversationRow (Owner, Claude, Notice) | aceitar como extensão nomeada | `OwnerMessage`, `MessageHeader`, `NoticeLine` | cartão do dono, legenda "CLAUDE · hora" com o copiar, aviso de uma linha; nenhuma peça atual é linha de conversa |
| 2 | ActionLine / ActionGroup / WorkFold | aceitar como extensão nomeada | `ActionLine` (variante `thinking`, estado `running`), `ActionGroup`, `WorkFold` | carregam a decisão B; usadas na conversa e no painel do subagente |
| 3 | AnnotationTag | não precisa | `AnnotationTag` (já em `design-system/src/components/`) | só faltava no bundle do canvas; serve a "tem pergunta aqui", "na fila", selos, fichas e "mais N esperando" (o ícone vai no `children`) |
| 4 | CodeBlock + CodePalette | aceitar como extensão nomeada | `CodeBlock` + tokens `--code-*` | o Shiki precisa de tema em variáveis; a paleta está abaixo |
| 5 | DiffBlock / CommandOutput | aceitar como extensão nomeada | `DiffBlock`, `CommandOutput` | detalhe na conversa e no painel de permissão: gutter, faixas ±, "ver tudo" |
| 6 | PendingPanel (OptionCard, PreviewPane, PlanCard) | aceitar `PendingPanel` e `OptionCard`; `PreviewPane` e `PlanCard` viram slot e variante | `PendingPanel` (`question`/`permission`/`plan`, faixa de origem, contador), `OptionCard` (rádio/caixa, `recommended`, slot de prévia) | prévia e plano são markdown, que fica no renderer; no DS mora só a moldura |
| 7 | Composer | aceitar como extensão nomeada | `TextArea` (genérica, prevista no plano) + `Composer` | cresce até ~10 linhas, com anexos, selo e modo de ajuste; o `TextInput` tem uma linha só |
| 8 | CommandMenu | aceitar como peça genérica | `Listbox` (o `CommandMenu` de `/` e `@` é composição no renderer) | o plano já previa "Menu/Popover"; o `Select` não filtra e não tem cabeçalho nem rodapé de teclas |
| 9 | Banner | aceitar como extensão nomeada | `Banner` (tons `permission`/`waiting`/`accent`/`muted`; variantes `compact` e `live`) | faixas, "texto não enviado", "Conversa nova", aviso de segundo plano e as barras do pé (trabalhando, Interrompido, Sessão encerrada); o `Toast` some sozinho |
| 10 | SidePanel (com SessionRail) | aceitar `SidePanel`; `SessionRail` é variante da barra lateral do app | `SidePanel` | painel genérico com alça, cabeçalho, corpo e pé; o trilho é cromo do `App.tsx` |
| 11 | SubagentRow / SubagentStrip | aceitar como extensão nomeada | `SubagentRow`, `SubagentStrip` | linha viva na conversa e no painel (aninhado) e faixa do topo |
| 12 | SendState | variante de componente | prop `sendState` do `OwnerMessage` | só existe dentro da mensagem do dono |
| 13 | Kbd | aceitar como extensão nomeada | `Kbd` | 8 ou mais usos idênticos; evita que cada um derive |
| 14 | TerminalTab · pendência | variante de componente existente | prop `statusText` do `TerminalTab` v3 | o slot do `model` está livre no app; não reaproveitar o `model` (D-C20) |

**Peças sem nome nos quadros.** O brief diz que extensão silenciosa não passa, então cada uma recebe um destino:

| Peça | Onde aparece | Destino |
|---|---|---|
| `Button · link` | "ver tudo", "abrir", "ver bruto", "tentar de novo", nome do subagente, "ver" | aceitar como variante (D-C27) |
| tooltip rico | `T10` | não precisa: o texto vai no `title` do controle. Se o dono quiser o balão, vira a extensão `Tooltip` |
| pílula "novas mensagens ↓" | `Main` | parte do `Timeline` do renderer |
| spinner | linha viva, "iniciando o Claude…", "carregando mensagens anteriores…" | dentro do `ActionLine` e das linhas de carregamento, respeitando `prefers-reduced-motion` |
| cartão "Tarefa recebida do Claude principal" | `T07` | `OwnerMessage` com a variante `task` |

**Paleta de código.** Os componentes leem só `--code-*`, nunca a fase direto. O contraste foi medido sobre
`--bg-panel`:

| Papel | Token novo | Aponta para | Contraste |
|---|---|---|---|
| texto e pontuação | `--code-tx` | `--text-primary` | 12,8:1 |
| `kw` palavra-chave | `--code-kw` | `--phase-plano` | 6,1:1 |
| `fn` função | `--code-fn` | `--accent` | 6,1:1 |
| `ty` tipo | `--code-ty` | `--phase-implementar` | 6,9:1 |
| `nu` número e constante | `--code-nu` | `--phase-validar` | 7,6:1 |
| `st` string | `--code-st` | `--zone-ok` | 8,7:1 |
| `cm` comentário | `--code-cm` | `--text-muted` | 5,2:1 |

No tema do Shiki, cada escopo TextMate cai num papel:

| Escopos TextMate | Papel |
|---|---|
| `keyword`, `storage` | `kw` |
| `entity.name.function`, `support.function` | `fn` |
| `entity.name.type`, `support.type`, `support.class` | `ty` |
| `constant.numeric`, `constant.language` | `nu` |
| `string` | `st` |
| `comment` | `cm` |

No diff, + usa `--zone-ok` e − usa `--state-permission` (D-C26), com faixas a 12%. Nenhum hex novo.

## 5. Mapa tela → componentes

| Quadro | DS existente que monta | Peças novas (nome final da §4) |
|---|---|---|
| `Main` | `SegmentedControl` (Modo; Chat \| Terminal), `AccountBadge`, `TerminalTab`, `StateDot`, `Toggle` ("Modo Foco"), `Button` (ghost, secondary "Parar", primary "Enviar"), `StatusBar` | `OwnerMessage` (+`sendState`), `WorkFold` (+`AnnotationTag` "tem pergunta aqui"), `ActionGroup`, `ActionLine` (`thinking`, `running`), selo de skill (`AnnotationTag`), `MessageHeader`, `CodeBlock`, tabela com copiar (markdown do renderer), `Banner·live` (pé e "Interrompido"), `Composer`/`TextArea`, `Kbd`, pílula |
| `T02` | os mesmos | + `DiffBlock`, `CommandOutput`, `ActionLine` com a falha aberta |
| `T03` | `TerminalTab` (`statusText`), `StateDot` `permission`, `TextInput` ("Outra"), `Button` primary | `PendingPanel·question`, `OptionCard` (rádio/caixa, `recommended`, prévia), `AnnotationTag` "mais 2 esperando", `WorkFold` "esperando você" |
| `T04` | `Button` (primary, secondary, danger), `TextInput` "Motivo (opcional)" | `PendingPanel·permission` (+ faixa de origem com `Button·link`), `DiffBlock` com rolagem própria, `Kbd`, `Composer` |
| `T05` | `Button` (primary, secondary, ghost) | `PendingPanel·plan` (recolhível, `AnnotationTag` "N passos"), markdown do renderer, `Composer` em modo ajuste (`AnnotationTag` accent "Ajuste no plano", `Kbd`) |
| `T06` | `Button` | `Composer` (multilinha, selo `!` com `AnnotationTag` warn, miniatura, ficha de texto colado), `Banner·waiting` (texto não enviado), `Listbox` (`/` com ficha de origem; `@`), `OwnerMessage` nos 4 `sendState`, `Button·link` "tentar de novo" |
| `T07` | `StateDot`, `Button` | `SubagentStrip`, `MessageHeader`, `SubagentRow` (+`AnnotationTag` de tipo e modelo), `WorkFold`, `Banner·live` ("Aguardando N subagentes"), `SidePanel` (fichas, `StateDot` com rótulo, trilha do aninhado, `OwnerMessage·task`, `Banner·muted` de segundo plano, pé só leitura) |
| `T07b` | os mesmos | + trilho de 48 px (barra lateral do app, botões com `StateDot` e `aria-label`) |
| `T08` | `StateDot`, `Button` | `Banner·permission` ("O terminal precisa de você"), `Banner·waiting` ("Não estou recebendo a conversa"), `Banner·live` ("Sessão encerrada (código N)"), `NoticeLine` ×5 (+`Button·link`), bloco bruto na moldura do `CommandOutput` |
| `T09` | `StateDot`, `Button` | estado vazio (nome; "modelo · esforço · conta"; `Kbd` com 3 dicas), linha "iniciando o Claude…", `OwnerMessage` em `waiting-cli`, `Banner·compact` accent ("Conversa nova…" + `Button·link` "abrir"), "carregando mensagens anteriores…", `WorkFold`, `Composer` |
| `T10` | `TerminalTab` (`statusText`), `Toggle`, `SegmentedControl`, `StateDot`, `StatusBar` | rótulo "esperando você" na barra lateral (app), `Kbd`, dica no `title`, `WorkFold`, `Banner·live`, `Composer`; a vista Terminal é o `TerminalPane` de hoje |

## 6. Decisões de forma (canônicas)

**A. Dono × Claude.** A conversa é uma transcrição, sem balões.
- **Mensagem do dono**: é o único cartão preenchido. Fundo `--bg-panel`, filete de 1 px, raio 6, padding 10/12,
  marcador `>` de 14 px em `--accent`, texto 13/1,55. A linha de meta fica à direita, em mono de 11 px, com a hora e
  o estado de envio.
- **Claude**: texto aberto sobre `--bg-app`, sob a legenda "CLAUDE · hh:mm" (11 px, caixa alta, `--text-muted`),
  com "copiar resposta" (ghost) na ponta. No painel lateral, a legenda é "SUBAGENTE".
- **Barra "trabalhou"**: só contorno, com 36 px e fundo transparente.
- **Medidas**:
  - ~~coluna de até 800 px, centrada~~ — **o dono, em 08/10, pediu a largura inteira** (uso real no alfa):
    a coluna e a caixa ocupam o painel todo; padding 20/24;
  - 28 px entre rodadas e 12 px dentro delas;
  - caixa e painel de pendência na largura da coluna (eram até 752 px; mesma decisão de 08/10).

**B. Linha de ação e grupo.**
- **Linha**: 28 px de altura.
  - Ícone de 16 px por categoria: arquivo = leitura, lupa = busca, lápis = edição, terminal = comando, faísca =
    skill, lâmpada = pensou.
  - Verbo em `--text-muted`; objeto em mono de 12,5 px.
  - Contagem em mono de 11 px: `+a` em `--zone-ok`, `−b` em coral (`−0` em muted).
  - Resultado colorido só quando é estado (falha). Duração à direita, em mono de 11 px.
- **Grupo recolhido**: ícone de camadas, "N ações — …" e a duração total. As falhas sobem para uma linha logo abaixo
  do cabeçalho (recuo de 26 px, coral a 8%, ✕), visível sem expandir. Essa linha substitui o "1 falhou: …" do
  contrato §5.
- **Grupo aberto**: trilho de 1 px à esquerda, com margem 11 e recuo 14.
- **Diff e saída**: recuados 26 px, numa caixa com fundo `--bg-panel` e raio 6. Têm cabeçalho de 24 px em
  `--bg-raised` e rodapé de 22 px com "… N linhas ocultas · ver tudo".

**C. Painel de pendência.**
- **Moldura**: acoplada acima da caixa, na mesma largura.
  - Borda coral a 40% sobre `--border`, raio 8, fundo `--bg-panel`.
  - Cabeçalho de 36–40 px: ícone coral, título, subtítulo e, à direita, "mais N esperando". O contador vale nas três
    variantes.
  - O miolo rola; o rodapé com os botões fica fixo.
  - Altura máxima: 62% da área útil da aba (~470 px numa janela de 900).
- **Pergunta**:
  - número, título e "escolha uma" ou "escolha uma ou mais";
  - escolha única com prévia: cartões à esquerda e a prévia da opção escolhida numa coluna de 270 px; sem prévia, o
    texto "Esta opção não tem prévia.";
  - escolha múltipla: grade de 3 colunas, com cartões de 38 px;
  - "Outra" fica sempre por último, com `TextInput` embutido;
  - um só "Responder", que habilita quando todas as perguntas têm resposta.
- **Permissão**:
  - escudo, "O Claude quer <verbo>" e o objeto numa ficha mono;
  - os botões, sempre nesta ordem: Permitir (primary), Permitir sempre neste projeto (secondary) e Negar (danger);
  - Negar abre "Motivo (opcional)" e "Negar e enviar";
  - o diff rola por dentro.
- **Pedido de subagente**: faixa de origem no topo, com "pedido do subagente" e o nome, que abre o painel lateral.
- **Plano**:
  - o cabeçalho recolhe;
  - depois de "Pedir ajuste", o cartão encolhe para o título, e a caixa vira o campo do ajuste: borda `--accent`,
    etiqueta "Ajuste no plano", "Enviar ajuste" / "Cancelar";
  - o ajuste vai pelo hook, sem estado de envio nem anexo;
  - o rascunho comum volta depois.

**D. Modo Foco.**
- O `Toggle` "Modo Foco" fica no cabeçalho da aba, ao lado do Chat | Terminal e do `Kbd` `Ctrl+\``, só na vista Chat.
- A preferência é global (`chat.focusMode`).
- Clicar na barra de uma rodada abre só aquela rodada, e isso não é lembrado.

**E. Estados de envio.** Ficam na linha de meta da mensagem do dono, na forma do `T06-G`:
- "enviando…": `--text-muted`, com ponto de 6 px piscando;
- "hh:mm · ✓ entrou": ✓ em `--zone-ok`;
- "✕ não foi · <motivo> · ↻ tentar de novo": borda do cartão em coral a 50%, e "tentar de novo" como `Button·link`;
- "na fila": borda tracejada, etiqueta âmbar e a causa em `--text-muted` (D-C10).

**F. Painel lateral.**
- **Largura**:
  - 460 px a 1440, com alça de arraste;
  - 420 px a 1280×760. Nesse tamanho, enquanto o painel está aberto, a barra de sessões vira um trilho de 48 px e a
    conversa fica com ~810 px. O trilho tem o botão "Mostrar a barra de sessões", que a abre por cima sem fechar o
    painel, e um `StateDot` por sessão, com `aria-label`;
  - entre os dois tamanhos: o trilho entra quando a coluna principal ficaria abaixo de 740 px, a largura dela a 1440;
  - abaixo de ~1180 px: não foi desenhado. Manter lado a lado, com o painel em no mínimo 360 px.
- **Estrutura**:
  - cabeçalho de 44 px: ícone, nome e ×, com "(Esc)" no rótulo;
  - sub-cabeçalho de 34 px: fichas de tipo e modelo e `StateDot` com o estado por extenso;
  - trilha do aninhado, com volta;
  - corpo: o cartão "Tarefa recebida do Claude principal" e a mesma conversa, com as mesmas peças e o mesmo Foco;
  - pé: "Somente leitura — este subagente responde ao Claude principal."

**Regras de forma que os quadros fixam além de A–F:**
- **G1.** A barra da dobra muda com o estado:
  - "trabalhando — …", com `StateDot` working e tempo vivo;
  - "esperando você — …", com `StateDot` permission;
  - "trabalhou — …", com o ícone de camadas e a duração.
- **G2.** O pé vivo fica acima da caixa: `StateDot`, "trabalhando — <ação>", tempo, `Kbd` Esc e "Parar"
  (secondary). Depois do Parar, até o próximo envio, ele diz "Interrompido — o Claude parou depois de <ação> ·
  escreva para continuar". A linha `interrupted` da conversa continua como registro.
- **G3.** Aviso é uma linha: ícone de 14 px, texto de 12 px e filete até a borda. Só ganha cor quando pede decisão:
  - âmbar no limite da conta;
  - pelo mesmo critério, âmbar em `api-error` e em `informational` com `level: warning`;
  - o resto, em muted.
- **G4.** As faixas ficam no topo da conversa, abaixo do cabeçalho e da faixa de subagentes:
  - coral: "O terminal precisa de você";
  - âmbar: "Não estou recebendo a conversa" e "Há texto não enviado no terminal";
  - azul, compacta: "Conversa nova — a anterior está em Sessões anteriores", com "abrir". Fica fixa enquanto a
    conversa nova está vazia; depois vira a primeira linha da conversa e rola com ela.
- **G5.** A barra "Sessão encerrada (código N)" ocupa o lugar da caixa, com "Retomar" (primary) e "Fechar aba"
  (secondary).
- **G6.** Pendência de subagente aparece no painel da coluna principal, nunca no painel lateral.
- **G7.** Ordem vertical da aba: cabeçalho (44 px) → faixa de subagentes (36 px) → faixas → conversa → painel de
  pendência → pé vivo → caixa.
- **G8.** A sessão nova mostra o nome, "modelo · esforço · conta" e três dicas: `/` skills e comandos, `@` arquivos e
  colar imagem. Durante "iniciando o Claude…", a caixa já aceita texto, e o que for enviado fica "na fila".

## 7. O que este handoff desbloqueia

Este documento fecha a **T003**. A **T004**, aprovação do dono na seção abaixo, é o gate: sem ela, nada das Phases
3–7 do `tasks.md` começa.

Com a T004 aprovada:
- a **Phase 3** (Fase 2 do plano: chat de leitura, T043–T060) começa quando a **Phase 2** fechar. A Phase 2 é a
  fundação (T005–T042): corre em paralelo e não depende deste desenho. A forma de T050–T057 está aqui;
- as Phases 4–7 (T061–T096) também têm forma, exceto em três pontos:
  - o gesto da T069 (decisão 5);
  - o painel do subagente no Modo Dev, na T094 (decisão 3);
  - o texto da notificação da T079, proposto na D-C17.

Textos de tarefa a ajustar (aplicados no `specs/014-chat/tasks.md` em 07/10, já com as decisões da §3):

| Tarefa | Ajuste |
|---|---|
| T050 | trocar "ex.: faixa de aviso, linha de conversa, cabeçalho de alternância" pelas peças da §4 que a leitura usa: `OwnerMessage`, `MessageHeader`, `NoticeLine`, `ActionLine`, `ActionGroup`, `WorkFold`, `CodeBlock` + `--code-*`, `DiffBlock`, `CommandOutput`, `Banner`, `Kbd`, `Button·link` e `SubagentRow` (só leitura). Atualizar a regra de cor do `design-system.md` (D-C26) |
| T051 | "paleta aprovada" = `--code-*` (§4); caminho no cabeçalho do bloco só pela cerca (D-C6) |
| T052 | `Notice` → `NoticeLine`, com o critério G3; `Unknown` com o tipo (D-C8); `ShellRow` e `LocalCommand` = `OwnerMessage` mono + `CommandOutput`; anexos no `OwnerMessage` |
| T053 | sem estatística de teste (D-C3); verbo em andamento (D-C4), com nota no `conversation-rows.md` §4; chevron do "Pensou" só com `hasText` (D-C5); diff cortado em 40 linhas (D-C7); `QuestionRow` e `PlanRow` a partir do `ActionLine` |
| T054 | o liga/desliga é o `Toggle` do cabeçalho + o clique na barra da rodada; rótulo da dobra por estado (G1); exceção dos subagentes, se a decisão 1 for (b) |
| T055 | a pílula só aparece com linha nova (D-C9) |
| T056 | controles somados ao `sessionHeader` de hoje (D-C22); Toggle escondido na vista Terminal (D-C21); `SESSION_STATE_LABEL_PT.permission` → "Esperando você" (D-C20); aviso de troca como `Banner·compact`, com "abrir" e texto próprio para o `/resume` |
| T065 | a faixa de texto não enviado é `Banner·waiting`; com o CLI trabalhando, fica sem "Descartar" |
| T067 | causa do "na fila" e motivo do "não foi" (D-C10); regra do "entrou" (D-C11) |
| T068 | gerúndio; "Aguardando N subagentes" (D-C18); estado "Interrompido" (G2); precedência do Esc (D-C24) |
| T069 | "gesto conforme o design" → decisão 5 |
| T070 | um texto por `terminalNeeded.reason` |
| T078 | frase-modelo + `description` do Claude (D-C12); rótulo do escopo do "sempre" (D-C13); diff da pendência a partir da entrada (D-C14), com nota no `data-model.md` §8; próxima pendência na hora e "(Recomendado)" intacto (D-C15); plano sem metadados calculados (D-C16) |
| T079 | texto da notificação (D-C17); `statusText` na aba e rótulo na barra lateral (D-C20) |
| T087 | `Listbox`; o Enter envia o que está escrito e o Tab escolhe; ficha de origem com "plugin"; selo de `/login` e `/logout` |
| T088 | clipe, se a decisão 4 aceitar; a miniatura colada se chama "imagem colada N" |
| T089 | a ficha de texto colado abre num `Modal` só leitura, em mono |
| T094 | contagem (D-C18); estados `failed`/`killed`/`stopped`/`unknown`; largura e trilho (F); alça acessível (D-C27); Modo Dev (decisão 3) |

## Aprovação

- **07/10/2026 — protótipo aprovado pelo dono** ("lindo lindo perfeito
  maravilhoso perfeito") sobre as 11 telas do canvas, cujo backup está em
  `design/chat-handoff/`. O canvas não teve edição nem comentário depois da
  publicação.
- **Divergências da seção 2 que a regra de conflito resolve** (forma → vence o
  desenho; comportamento → vence a spec): valem a partir desta data.
- **07/10/2026 — as 5 decisões da seção 3 respondidas pelo dono**: 1 (b), 2
  (a) projeto inteiro, 3, 4 e 5 como recomendado. **Gate da Fase 0 fechado
  (T004).**
