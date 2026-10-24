# Handoff — Mindscape, etapa /arquitetura (2026-10-24)

Rodada com decisões delegadas pelo dono. Branch `feature/mindscape`. Modo esteira; guarda de
validação (item 05 do plano) satisfeita por delegação na etapa /versionamento.

## O que foi feito

- Registro TaskDex: herdado, `taskdex: []`.
- Self-assessment: `apto` (decidido por delegação do dono) → ramo apto, frentes cobertas sem
  pergunta. Gate: `aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-23`.
- Post no #arquitetura-champions: **não feito** — repo pessoal (xansde/donel-dev), fora da
  Seazone; postar em canal da empresa é mensagem a terceiros e não foi pedido (decidido por
  delegação; registrado em `champions-post`).
- Código lido: `App.tsx` (SegmentedControl "Uso geral | Dev" com `devModeOn` boolean, ~2.780
  linhas; `semaphoreStates` por `tab.id`; `EsteiraScreen` por cima do miolo),
  `session-semaphore-manager.ts` (payload inteiro chega em `handleHookBody` e via
  `BridgeEvent.payload`), `hook-bridge.ts`, `transcript-watcher.ts` (`extractTranscriptTail`,
  cauda de 64 KB), `config-store.ts` (temp+fsync+rename), `esteira-store.ts` (schema guard),
  `PostItCard`, `tabAppearance.ts` (`TabColorToken`).
- Medições (2026-10-24, sem instalar):
  - `npm view`: excalidraw 0.18.1 MIT, unpacked 46,8 MB, peer React ^17/^18.2/^19, 32 deps incl.
    `@excalidraw/mermaid-to-excalidraw` → `mermaid ^11` (`mermaid@12.2.0` = 122 MB unpacked).
    roughjs 4.6.6 MIT, unpacked 0,17 MB, sem peer, publicado 2023-11-20.
  - unpkg `?meta`: excalidraw `dist/prod` = 17,7 MB; JS principal ~2,77 MB (502 KB + 1.825 KB +
    439 KB), CSS 145 KB, fontes 26,2 MB (482 arquivos). roughjs `bundled/rough.esm.js` = 27,7 KB.
  - `claude.exe` 2.1.310: `last_assistant_message` presente no schema, `.optional()`.
- Artefatos: `docs/design/mindscape.md` (aprovado), `docs/adr/0004-base-do-quadro-mindscape.md`,
  linha-invariante no `CLAUDE.md` (seção Domínio), links em `specs/017-mindscape/README.md`.

## Decisões (por delegação)

- Base do quadro: React próprio + `roughjs@4.6.6` (ADR 0004).
- Modelo: `MindscapeDoc { schemaVersion: 1, boards[projectPath] { pan, cards, links } }`;
  cartões `session` (só posição), `session-note` (texto + hora + nome), `owner` (texto + cor
  none/accent/donel-accent); chave de sessão = `claudeSessionId`.
- Persistência: `<userData>/mindscape.json`, main único escritor, renderer dono do estado,
  save debounced 500 ms, schema guard.
- Fonte do post-it: `onTurnEnded` no `SessionSemaphoreManager` (Stop/StopFailure, os dois
  transportes); fallback `lastAssistantText` na cauda; canal `mindscape:turn-ended`.
- Destaque: `seenAt` em memória no App + função pura `sessionHighlight`.
- Ir ao terminal: `setAppMode('geral')` + `setActiveTabId`.
- Modo: `appMode` de 3 valores, `devModeOn` derivado.

## Riscos

- `last_assistant_message` é opcional; payload do `StopFailure` não medido → fallback na cauda,
  e se nada vier o post-it mantém o texto anterior.
- `/clear` ou `/resume` trocam o `claudeSessionId` da aba → par novo de cartões; o post-it antigo
  fica órfão até ser arquivado.
- `App.tsx` grande: a troca `devModeOn` → `appMode` toca muitos pontos; mitigação: `devModeOn`
  derivado.
- `roughjs` sem release desde 2023-11 (pequeno e puro; fixável no repo).
- Desempenho com muitas sessões não medido (cache de traço por geometria; arraste em rAF).
- Instalar `roughjs` é mudança de dependência: fica para a /implementacao.

## Não verificado

- Comportamento da API do Excalidraw para post-it vivo (tirado da documentação, não executado).
- Payload real do `StopFailure`.
