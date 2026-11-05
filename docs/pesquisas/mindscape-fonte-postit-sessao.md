---
tema: mindscape-fonte-postit-sessao
plano: docs/planos/mindscape.pda.md
item: 02 — De onde vem o texto do post-it escrito pela sessão
data: 2026-10-23
taskdex: []  # sem card: ferramenta pessoal — esta execução não conta na adoção
fontes-consultadas: [repos-locais]
---

# Pesquisa — De onde vem o texto do post-it escrito pela sessão

## Pergunta

O Mindscape mostra, ao lado de cada sessão, um post-it "escrito pela sessão" com o que ela
fez, sem chamar modelo. De onde o app tira esse texto hoje, com o menor custo, e em que
momento ele fica disponível? O app já lê o transcript `.jsonl` ou recebe algo pronto?

## Resposta (gist)

O hook `Stop`, que o app já recebe em toda sessão a cada fim de turno, traz o campo
`last_assistant_message` com a última resposta do assistente em texto. O payload JSON chega
inteiro ao `SessionSemaphoreManager`, que hoje só lê `session_id`, `hook_event_name` e
`reason`. Basta ler mais um campo, sem tocar no transcript. Fallback, se o campo faltar: a
última linha `assistant` com bloco `text` na cauda do `.jsonl`, que o adapter do chat já sabe
extrair.

## Achados

- O spike T002 mediu o payload do `Stop`: campos `last_assistant_message`,
  `stop_hook_active`, `background_tasks` e `session_crons`; dispara sempre ao final de cada
  turno completo, 2–8 s após a última ação — **fonte:** `specs/001-mvp/spike-t002-resultado.md:63`
- Exemplo real capturado:
  `{"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"OK",...}` —
  **fonte:** `specs/001-mvp/spike-t002-resultado.md:95`
- O `Stop` (e o `StopFailure`) é um dos eventos que o app injeta em toda sessão, pelo
  `--settings` por sessão — **fonte:** `src/main/hooks-settings.ts:27` e
  `src/main/hooks-settings.ts:84`
- O manager recebe o corpo inteiro do hook e faz `JSON.parse` do payload completo; hoje lê
  apenas `session_id`, `hook_event_name` e `reason` — **fonte:**
  `src/main/session-semaphore-manager.ts:201-228`
- `Stop` e `StopFailure` mapeiam para o evento `stop`, que leva o semáforo a `waiting` —
  **fonte:** `src/main/session-semaphore-manager.ts:53-55` e
  `src/main/semaphore-state-machine.ts:97-101`
- Estado `error` não vem de hook: o manager marca o pty com exit code != 0 e troca `done`
  por `error` na emissão pública — **fonte:** `src/main/session-semaphore-manager.ts:161-165`
  e `src/main/session-semaphore-manager.ts:275`
- Fallback por transcript: o adapter do chat transforma linhas `assistant` com bloco `text`
  em linhas `kind: 'assistant'` com `markdown`, e já calcula a última resposta do turno
  (`finalRowId`) — **fonte:** `src/shared/chat/adapter.ts:654-660` e
  `src/shared/chat/adapter.ts:1030-1041`
- A leitura de cauda do `.jsonl` já existe e é barata (64 KB, varredura reversa), usada para
  título, contexto e cor — **fonte:** `src/main/transcript-watcher.ts:315-351`
- Não existe hoje registro de "última vez que o dono acessou a sessão" (necessário para o
  destaque "apagadinha") — **fonte:** busca por `lastSeen|lastViewed|seenAt` em `src/`, sem
  resultado

## Lacunas

- O tamanho máximo de `last_assistant_message` não foi medido: uma resposta longa pode
  chegar inteira. O corte para caber no post-it é decisão de forma (refinamento/arquitetura).
- `StopFailure` (fim de turno por erro de API) não teve o payload medido; pode não trazer
  `last_assistant_message`.
- Se o campo continua presente na versão atual do CLI não foi re-medido desde o spike; o
  fallback por transcript cobre a ausência.

## Trilha de busca

- repos locais — termos: `last_assistant_message`, `lastAssistant` em `src/` — nenhum uso
  em código de produção; só em `specs/001-mvp/` e `specs/014-chat/research.md:394`
- repos locais — termos: `lastSeen`, `lastViewed`, `seenAt`, `unread` em `src/` — nada
  relacionado a sessão
