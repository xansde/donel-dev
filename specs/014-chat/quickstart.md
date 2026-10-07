# Quickstart — como validar a 014

Roteiro para conferir que o chat entrega o que a spec promete. A parte
automática roda a cada fase; a bateria com o CLI real roda no **alfa** ao
fim das fases que a citam (`plan.md`, "Fases"), com o dono.

## 0. Preparação

- **Canal**: alfa (`staging`), com `npm run dist:alfa`. Para desenvolvimento:
  `npm run dev`.
- **Ligar o chat**: em Configurações, "Chat (experimental)", que grava
  `chat.enabled: true` no `config.json`. Desligar devolve as abas ao terminal.
- **CLI**: `claude --version` na faixa verificada (2.1.29x). Em versão
  diferente, a bateria vale assim mesmo. O que o adaptador não reconhecer
  aparece como bloco "conteúdo não reconhecido" e é anotado em
  `userData/chat-diagnostics.log`.
- **Bateria real**: use `--model haiku` no launcher (barato) e modo de
  permissão `default`. O global do dono aprova tudo, e aí nenhuma permissão
  aparece.

## 1. Automático (a cada fase)

```powershell
npm test                     # vitest: adaptador, cadeia ativa, foco, grupos, resumos,
                             # fila de pendências, máquina de envio, detectores de tela,
                             # catálogo, ponte de hooks (contrato HTTP)
npm run typecheck
npm run build; npm run test:smoke   # Playwright + CLI falso roteirizado (tests/smoke/chat-*.spec.ts)
```

- O CLI falso desenha a caixa e o rodapé, ecoa colagens, grava o JSONL e
  chama os hooks da sessão. As smokes do chat não gastam cota e são
  determinísticas.
- **Sessão longa (SC-005)**: o gerador sintético cria uma conversa de ~10 mil
  linhas, e a smoke `chat-long-session` mede abrir no fim em até 2 s e rolar
  sem saltos.
- **Latência ao vivo (SC-008)**: a smoke `chat-live-latency` mede o tempo
  entre o CLI falso acrescentar uma linha ao transcript e a linha aparecer na
  tela. Passa com até 1 s.

## 2. Bateria com o CLI real

Cada passo diz o que fazer, o que deve acontecer e o que cobre.
"Pendência" = pergunta, permissão ou plano.

### B1 — Conversa (US1 · SC-001)

1. Abrir sessão nova pelo launcher. → A aba abre no **chat**, com a caixa
   focada.
2. Pedir uma resposta com título, lista, tabela, link e bloco de código. →
   Tudo renderizado; código colorido; copiar o bloco e copiar a resposta
   inteira (markdown) funcionam.
3. Enviar duas mensagens. → "enviando…" e depois "entrou", sempre.
4. Atalho para o terminal, digitar algo lá, voltar. → A mesma conversa
   aparece, com o que foi feito no terminal; o rascunho do chat está
   intacto.
5. Rolar para cima durante uma resposta. → A posição não pula; aparece
   "novas mensagens ↓".

### B2 — Envios (US4, US6 · SC-003)

Anote em cada envio se terminou em "entrou" ou em "não foi".

| # | Envio | Esperado |
|---|---|---|
| 1 | 5 linhas com Shift+Enter | uma mensagem, quebras preservadas |
| 2 | `/` → escolher uma skill → argumento | o CLI recebe exatamente `/skill argumento` |
| 3 | `/mod` (sem argumento) | **não** vira `/model`: o chat fecha o menu e envia o literal |
| 4 | `@` → escolher arquivo | menção `@caminho` intacta |
| 5 | colar 500 linhas | ficha "texto colado — 500 linhas"; o Claude recebe tudo |
| 6 | colar uma imagem (print) | miniatura removível; o Claude descreve a imagem |
| 7 | arrastar um `.md` | vira `@caminho` |
| 8 | `!echo oi` | selo "vai rodar como comando de shell"; roda local |
| 9 | mensagem durante uma rodada | "na fila", depois "entrou" quando o Claude a lê |
| 10 | "interromper e mandar agora" | a rodada para e a mensagem entra em seguida |
| 11 | `/comando-que-nao-existe` | "não foi", com o motivo "comando desconhecido" |
| 12 | fase da Esteira com auto-start | envia sozinha pelo mesmo envio confiável |
| 13 | ↑ com a caixa vazia | volta a mensagem anterior |

**Passa** com zero "enviando…" eterno, zero duplicado e zero comando
trocado.

### B3 — Pendências (US2 · SC-002)

1. Pedir uma pergunta com 2 opções (depois com seleção múltipla e com
   "Outra"). → Painel acima da caixa; o Claude recebe exatamente o que foi
   escolhido.
2. Pedir um comando Bash fora das regras.
   - **Permitir**: roda.
   - **Permitir sempre neste projeto**: a regra aparece em
     `.claude/settings.local.json` do projeto, e o mesmo comando não pergunta
     de novo.
   - **Negar** com motivo: o Claude cita o motivo.
3. Modo plano: pedir um plano.
   - Cartão em markdown com **Aprovar e seguir** (sai do modo plano).
   - **Pedir ajuste**: a caixa vira o campo do ajuste, e o Claude reescreve
     o plano.
4. Pendência aberta com o app em segundo plano. → Notificação do Windows; a
   aba mostra "esperando você".
5. Dois subagentes pedindo permissão ao mesmo tempo. → Uma por vez, "mais 1
   esperando", e o painel diz "pedido do subagente <descrição>".
6. Com o painel aberto, responder pelo terminal. → O painel fecha sozinho.
7. Ação que o CLI aprova sozinho (Read; ou comando coberto por regra). → O
   chat não pergunta nada.

### B4 — "O terminal precisa de você" (FR-004 · FR-025)

1. Enviar `/model` sem argumento. → Faixa com "abrir o terminal"; escolher
   lá e voltar. → A faixa some.
2. Abrir sessão numa pasta nunca usada. → O diálogo de confiança aparece
   como faixa; nada é digitado nele.

### B5 — Rodada sem ruído (US3)

Tarefa com pelo menos 10 ações, uma edição e um comando que falha.

- Com Modo Foco **ligado** (padrão): mensagem do dono, resposta final e
  "trabalhou — N ações, M notas". O erro aparece no bloco recolhido.
- Com Modo Foco **desligado**: linhas curtas em português, agrupadas, com o
  diff, a saída ("ver tudo") e a lista de arquivos ao expandir.
- Nota intermediária terminando em "?" → selo "tem pergunta aqui".
- Skill carregada → selo recolhido, não o texto da skill.

### B6 — Subagentes (US5)

Tarefa com dois subagentes em paralelo, um em segundo plano.

- Linhas vivas com tipo, modelo, tempo e última ação.
- Faixa no topo com a contagem.
- Clicar abre o **painel lateral à direita**, ao vivo; Esc fecha.
- O de segundo plano segue "rodando" depois da resposta do principal e
  muda sozinho ao terminar.

### B7 — Troca de conversa (FR-033)

1. `/clear` enviado pelo chat. → "entrou" (sem ficar "enviando…"), timeline
   nova com "conversa nova — a anterior está em Sessões anteriores".
   Semáforo, nome e cor acompanham.
2. `/resume <id>`. → O chat passa à conversa retomada.

### B8 — Fim e Retomar (FR-034)

`/exit`. → A conversa continua legível e copiável; no lugar da caixa, a
barra "Sessão encerrada (código N)". **Retomar** continua a mesma conversa,
e o rascunho volta.

### B9 — Integridade (SC-004)

Com a aba no chat:

- Troca de conta em voo: o aviso aparece e a sessão segue.
- `/color`: a faixa de cor da aba muda.
- O semáforo acompanha.
- Uma fase da Esteira roda.

As smokes existentes (`npm run test:smoke`) passam.

### B10 — Sessão longa (SC-005)

Retomar a maior sessão real disponível (mais de 10 MB).

- O fim aparece em até 2 s.
- A rolagem para cima carrega o histórico sem pular a posição.

### B11 — Alternância (SC-006)

10 vezes chat ⇄ terminal com rascunho escrito. → Sessão e rascunho intactos
nas 10.

### B12 — Uma semana de uso (SC-007)

Diário em `specs/014-chat/diario-sc007.md`: cada vez que precisou da vista do
terminal, o quê e por quê.

**Passa** se só houver telas interativas do CLI.

## 3. Se algo der errado

- **Desligar**: Configurações → "Chat (experimental)". As abas voltam ao
  terminal, e as pendências ficam com a TUI.
- **Diagnóstico**: `userData/chat-diagnostics.log` (JSONL, sem conteúdo de
  conversa). Registra tipos não reconhecidos, tempos de hook e envios que
  terminaram em "não foi" com o motivo.
- **Faixa "não estou recebendo a conversa"**: abrir o terminal e procurar
  "Transcript saving is off".
