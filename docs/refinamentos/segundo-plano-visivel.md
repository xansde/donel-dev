---
tema: segundo-plano-visivel
data: 2026-11-03
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03
---

# Refinamento — Segundo plano visível

## Demanda

Dono, 03/11: "Eu sempre acesso o terminal para verificar se tem algum terminal em andamento. Se isso
não está fácil de acompanhar aqui, quero que se torne." Ele troca do chat para o terminal só para ver
o rodapé do CLI (shells, agentes e monitores em segundo plano).

## Regras fechadas (por delegação)

1. **Fonte é o transcript.** A lista sai das linhas da conversa: o lançamento (Bash/PowerShell com
   `run_in_background`, `Monitor`, `Agent` assíncrono, ou comando que o CLI mandou para o segundo
   plano sozinho, reconhecido pelo `backgroundTaskId` no resultado), a `<task-notification>` com
   `<status>` e o `TaskStop` que deu certo. Os hooks de subagente não decidem estado: o
   `SubagentStop` chega antes da notificação e não diz se terminou bem ou falhou.
2. **Rodando = lançada, sem notificação de fim, e lançada pelo processo vivo.** Tarefa em segundo
   plano morre com o processo do CLI. Lançamento anterior ao processo atual (conversa retomada) ou
   sessão encerrada vira **estado desconhecido**, nunca "rodando" nem um fim chutado.
3. **Evento de monitor não encerra.** Notificação sem `<status>` (evento do `Monitor`) não muda nada.
4. **Estados**: rodando · terminou · falhou · parada (`killed`/`stopped`/`TaskStop`) · estado
   desconhecido. Lançamento que deu erro conta como "falhou"; recusado ou interrompido antes de
   rodar não entra; shell que acabou rodando em primeiro plano sai da lista.
5. **Subagente de primeiro plano fica fora**: ele já aparece no rodapé "trabalhando" enquanto o
   turno anda. Só entra agente assíncrono.
6. **Alcance**: só o que está carregado da conversa (a última página e o que o dono rolou para
   cima). Lançamento mais antigo que isso não aparece; é raro uma tarefa viver tanto.
7. **Onde o dono vê**: no chat, acima da caixa ("⟳ 2 em segundo plano", abre a lista; clicar num
   item rola até a linha, abrindo o "trabalhou…" que a esconde); some quando a última termina,
   depois de mostrar "segundo plano terminou" por 8 s. Na aba, "⟳ 2" no slot curto (ao lado do ⎇);
   "esperando você" tem precedência. Na barra de status, "⟳ 3 em segundo plano · 2 sessões", com
   lista por sessão que leva à aba e à linha. No cartão de sessão do Mindscape, "· ⟳ 2 em segundo
   plano" na linha de estado.
8. **Lista**: as que rodam (ordem de lançamento) e as 5 últimas que acabaram.

## Onde mora

- Derivação pura: `src/shared/chat/backgroundTasks.ts` (`deriveBackgroundTasks`), sobre as linhas
  planas que o adaptador marca (`ActionRow.background`, `SubagentRow.endedAt`).
- O hub do chat (main) calcula por aba e manda em `LiveState.background`; o `ChatStore` junta todas
  as abas para a barra de abas, a de status e o Mindscape.
- Teste: `tests/background-tasks.test.ts` (rodando × terminou × processo morto).
