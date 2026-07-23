# Roteiro E2E — Batch 3: Cockpit (T007–T012)

**Status no momento da escrita: EM IMPLEMENTAÇÃO.** Só rode este roteiro
depois que o batch estiver marcado como concluído pela esteira — algumas
seções abaixo podem não existir ainda se você rodar cedo demais.

## O que este batch entregou

Sidebar de projetos com scan + favoritos (US-1, T007); launcher ligado ao
`CommandBuilder` (T008, CA-1); semáforo de sessões com os 5 estados,
`StateDot`, notificação Windows e atalhos `Ctrl+1..9`/`Ctrl+Tab` (T009,
FR-010, FR-013, CA-6); abas múltiplas + ciclo de vida + terminal livre sem
vazamento de PTY (T010, FR-006, FR-008); injeção de `/model` numa sessão
viva (T011, FR-011); `SessionIndexer` como módulo TDD, **ainda sem UI** —
a UI de sessões anteriores é T013, no batch 4 (T012).
Módulos principais: `src/main/project-scanner.ts`,
`src/renderer/src/Launcher.tsx`, `src/main/semaphore-state-machine.ts`,
`src/main/session-semaphore-manager.ts`, `src/shared/sessionShortcuts.ts`,
`src/renderer/src/SessionDetails.tsx`, `src/shared/liveSessionInjection.ts`,
`src/main/session-indexer.ts`.

**O que este roteiro cobre:** os testes automatizados (`tests/*.test.ts`,
`tests/smoke/*.spec.ts`) já cobrem o `SemaphoreStateMachine`,
`sessionShortcuts` e o smoke de `terminal.spec.ts`/`tabs-lifecycle.spec.ts`
via Playwright. Este roteiro foca no que só aparece rodando o app de
verdade com múltiplas sessões reais em paralelo — a interação humana entre
6 abas, o CA-6 na prática, e a injeção de modelo numa sessão que está de
fato ocupada.

## Pré-requisitos

```powershell
cd C:\Users\xansd\seazone\donel-dev
npm install
npm run dev
```

Ter pelo menos 2 projetos reais no disco sob um dos roots configurados
(default `~/seazone` e `~/pessoal`) para testar a sidebar — ex.:
`donel-dev` e mais um outro repo qualquer.

## Custos

Vários passos abrem sessões `claude` reais em paralelo. **Use sempre
`--model haiku` e prompts triviais** ("Responda apenas OK", "Conte até 3
devagar, uma linha por vez") — o objetivo é só ter sessões vivas o
suficiente para observar o semáforo mudar de estado, não gerar trabalho.
Evitar tarefas que chamem ferramentas caras ou demoradas desnecessariamente
— o passo 5 (permissão pendente) precisa de UMA chamada de ferramenta, não
mais que isso.

## Segurança

Nenhum passo pede login/credencial (perfis são batch 4). Todas as sessões
deste roteiro rodam na conta padrão já autenticada da máquina.

## Passos

### 1. Sidebar de projetos — scan e abertura (T007, US-1)

- [ ] **Ação:** abrir o app; observar a seção PROJETOS na sidebar.
- **Resultado esperado:** os projetos sob os roots configurados aparecem
  agrupados por root, até 2 níveis de profundidade, mostrando só
  diretórios com `.git/` ou `CLAUDE.md`.
- [ ] **Ação:** clicar num projeto na sidebar.
- **Resultado esperado:** abre uma aba com `cwd` = o diretório do projeto
  clicado (confirmar rodando `pwd`/`Get-Location` dentro da aba aberta).

### 2. Favoritos

- [ ] **Ação:** marcar um projeto como favorito (`★`) e reiniciar o app
  (`Ctrl+C` no terminal do `npm run dev` e rodar de novo, ou fechar/reabrir
  a janela se o app suportar).
- **Resultado esperado:** o favorito aparece no topo da lista de projetos
  mesmo depois do restart — **atenção:** se `ConfigStore` (persistência)
  ainda não estiver pronto neste batch (é T015, batch 5), o favorito pode
  não sobreviver ao restart; nesse caso marque este sub-passo como
  "(confirmar no batch 5)" e não bloqueie o batch 3 por isso.

### 3. Launcher monta o comando exato (T008, CA-1)

- [ ] **Ação:** no painel do launcher, escolher Modelo=`sonnet`,
  Esforço=`high`, Permissões=`acceptEdits`, Nome=`radar`, com o projeto
  `spotsys` (ou outro disponível) selecionado na sidebar; clicar
  "▶ Iniciar".
- **Resultado esperado:** uma aba abre executando exatamente
  `claude --model sonnet --effort high --permission-mode acceptEdits -n "radar"`
  com `cwd` do projeto selecionado — conferir o comando real (ex.: via
  Gerenciador de Tarefas → linha de comando do processo `claude.exe`, ou
  imprimindo `$env:*` relevante dentro da sessão). **Nota de custo:** troque
  o modelo para `haiku` na prática antes de interagir de verdade com a
  sessão — o passo serve para validar a MONTAGEM do comando, não para
  gastar cota em `sonnet`/`high`.

### 4. Semáforo — 3 estados simultâneos sem focar nenhuma aba (CA-6, parte 1)

- [ ] **Ação:** abrir 4 abas de sessão Claude (`--model haiku`). Deixe a
  aba 4 em foco. Nas abas 1–3, dispare situações que gerem: (1) uma
  gerando resposta agora ("escreva um parágrafo bem longo sobre café,
  devagar"), (2) uma com pedido de permissão pendente (peça algo que exija
  aprovação de ferramenta, ex.: "rode `Get-Process` via Bash" — se o
  `permission-mode` for `acceptEdits`/`bypassPermissions` isso não gera
  pendência; use `manual` ou o default nessa aba especificamente), (3) uma
  com turno concluído ("Responda apenas OK" e espere a resposta chegar).
- **Resultado esperado:** com a aba 4 em foco (nenhuma das 3 focada), a
  lista de sessões na sidebar mostra simultaneamente os 3 dots corretos:
  azul pulsando (trabalhando), vermelho-coral pulsando rápido (permissão
  pendente), âmbar fixo (aguardando resposta) — sem precisar clicar em
  nenhuma delas.

### 5. Ordenação por prioridade e contador de tempo (CA-6, parte 2)

- [ ] **Ação:** com a aba de permissão pendente do passo 4 ainda esperando,
  abrir uma quinta aba e também gerar nela um pedido de permissão pendente
  (mesma técnica). Deixar as duas pendências coexistirem por alguns
  minutos (ex.: 1min e 6min de diferença — não precisa esperar 6min reais,
  2-3min de diferença já é suficiente pra ver o contador mudar).
- **Resultado esperado:** a lista de sessões mostra a permissão pendente
  **mais antiga acima** da mais recente, cada uma com um contador de tempo
  visível ("há Xmin") que atualiza sozinho. Ordem geral da lista: permissão
  pendente > falha/quota > aguardando resposta > trabalhando > encerrada.

### 6. Notificação Windows (opcional em FR-010)

- [ ] **Ação:** com o app em segundo plano (foco em outra janela), deixar
  uma sessão background chegar num estado de "aguardando resposta" ou
  "permissão pendente".
- **Resultado esperado:** uma notificação nativa do Windows aparece (se a
  feature estiver implementada neste batch — é marcada como "opcional" no
  FR-010; se não disparar, verificar se é porque ainda não foi
  implementada vs. um bug — checar o changelog do batch antes de reportar
  como falha).

### 7. Atalhos de teclado — Ctrl+1..9 e Ctrl+Tab (FR-013)

- [ ] **Ação:** com 4+ abas abertas, apertar `Ctrl+3` (ou o número
  correspondente à posição de uma sessão específica na lista priorizada).
- **Resultado esperado:** foca a aba que está na 3ª posição da lista
  ordenada por prioridade (não necessariamente a 3ª aba aberta
  cronologicamente — é a posição no ranking do semáforo).
- [ ] **Ação:** apertar `Ctrl+Tab`.
- **Resultado esperado:** foca a próxima sessão que precisa de atenção
  (permissão pendente > aguardando resposta), pulando sessões que estão só
  "trabalhando" ou "encerradas".

### 8. Abas múltiplas e ciclo de vida (T010, FR-006)

- [ ] **Ação:** abrir 6 sessões simultâneas (mistura de Claude + terminal
  livre). Fechar uma aba com sessão ativa (processo vivo).
- **Resultado esperado:** modal de confirmação aparece ("Fechar sessão?"
  com botões "Fechar sessão"/"Cancelar"); confirmando, o processo morre de
  fato — checar no Gerenciador de Tarefas que não sobra um `claude.exe` ou
  `powershell.exe` órfão depois de fechar todas as 6 abas (vazamento de
  PTY).
- [ ] **Ação:** dentro de uma sessão Claude, digitar `/exit` e deixar o
  processo terminar sozinho.
- **Resultado esperado:** a aba mostra o estado "sessão encerrada" no
  corpo do terminal, com botões "Reabrir"/"Fechar aba" — distinto do dot
  cinza da lista de sessões.

### 9. Terminal livre (T010, FR-008)

- [ ] **Ação:** abrir uma aba de terminal comum (não Claude) no diretório
  de um projeto.
- **Resultado esperado:** abre um PowerShell simples no `cwd` do projeto,
  sem dot de semáforo na lista de abas (mostra ícone de shell no lugar,
  conforme ui-spec §2).

### 10. Injeção de modelo em sessão viva (T011, FR-011)

- [ ] **Ação:** com uma sessão Claude rodando e **ociosa** (prompt
  disponível, não no meio de gerar resposta), usar o controle de
  Modelo/Esforço nos detalhes da sessão para trocar de `haiku` para
  `sonnet` (ou qualquer outra troca disponível).
- **Resultado esperado:** o comando `/model <alias>` é injetado no PTY da
  sessão automaticamente; a sessão continua com o MESMO contexto (não
  reinicia) e passa a responder como o novo modelo — confirmar perguntando
  "qual modelo você é?" depois da troca.
- [ ] **Ação:** repetir a troca **enquanto a sessão está gerando uma
  resposta** (não ociosa).
- **Resultado esperado:** o app **não** injeta o comando no meio da
  geração (evita corromper o turno) — ou enfileira a injeção pro próximo
  momento ocioso, ou bloqueia o controle com uma indicação visual até a
  sessão ficar livre. Se não houver comando nativo `/model` disponível
  (CLI mais antigo, por exemplo), a UI deve degradar oferecendo "reiniciar
  a sessão com essa config" em vez de travar silenciosamente.

## Se falhar

| Grupo de passos | Sintoma | Investigar |
|---|---|---|
| 1-2 (sidebar/favoritos) | Projetos não aparecem ou favorito não persiste | `src/main/project-scanner.ts`; persistência de favoritos ainda depende do T015 (`ConfigStore`) — não é bug do batch 3 se sumir no restart |
| 3 (launcher/CA-1) | Comando montado difere do esperado | `src/shared/commandBuilder.ts` (já tem testes unitários — comparar contra `tests/commandBuilder.test.ts`), `src/renderer/src/Launcher.tsx` |
| 4-5 (semáforo/ordenação) | Estado não aparece ou ordenação errada | `src/main/semaphore-state-machine.ts`, `src/main/session-semaphore-manager.ts`, `src/shared/sessionOrdering.ts`; conferir se os hooks (`hooks-settings.ts`) estão sendo escritos e passados via `--settings` no spawn |
| 6 (notificação Windows) | Nunca dispara | Checar se `app.setAppUserModelId` foi configurado (ver risco no plan.md); pode ser limitação conhecida do `npm run dev` — testar de novo no batch 5 via atalho instalado |
| 7 (atalhos) | `Ctrl+1..9`/`Ctrl+Tab` não respondem ou focam aba errada | `src/shared/sessionShortcuts.ts`; conferir se o ranking usado pelos atalhos é o mesmo de `sessionOrdering.ts` |
| 8-9 (abas/terminal livre) | Processo órfão após fechar aba, ou modal não aparece | `src/main/pty-manager.ts` (`onExit`/kill), `src/renderer/src/App.tsx` (fluxo de confirmação) |
| 10 (injeção de modelo) | Comando injetado no meio de geração, ou não reflete troca | `src/shared/liveSessionInjection.ts`, `src/renderer/src/SessionDetails.tsx` |
