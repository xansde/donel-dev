# Contrato IPC — 015 (pet do Jobu Donel)

Constantes em `src/shared/pet/ipc.ts` (`PET_CHANNELS`), no padrão
`'<domínio>:<ação>'` do repo. Validação de payload no main por funções
`isValid…` em `src/shared/pet/`, como os outros domínios. O preload ganha o
domínio `pet` no `DonelApi`, exposto nas duas janelas (R18). Cada janela usa só
a sua parte.

## Renderer principal → main

| Canal | Tipo | Payload | Quando |
|---|---|---|---|
| `pet:tabs` | `send` | `{ activePtyId: string \| null, sessions: { ptyId: string, name: string }[] }` | a cada mudança de abas, nomes ou aba ativa, com dedupe. Só abas `claude` com PTY; `name` = `resolveTabName`. Sempre ligado, com ou sem chat. |
| `config:setPetPrefs` | `invoke` | `{ enabled?: boolean }` → `AppConfigDto` | toggle das Preferências; aplica na hora (cria ou destrói a janela do pet) |

## Main → renderer principal

| Canal | Payload | Efeito |
|---|---|---|
| `app:activate-session` | `{ ptyId: string }` | ativa a aba cujo PTY é `ptyId` (mapa reverso do `tabPtyMap`); o main já trouxe a janela à frente |
| `pet:prefs-changed` | `{ enabled: boolean }` | atualiza `appConfig.pet.enabled` (toggle e supressão dos toasts) |

## Main → janela do pet

| Canal | Payload | Efeito |
|---|---|---|
| `pet:view` | `PetView` (ver `data-model.md`) | redesenha; enviado só quando muda |

## Janela do pet → main

| Canal | Tipo | Payload | Efeito no main |
|---|---|---|---|
| `pet:ready` | `send` | — | manda a vista atual e mostra a janela (`showInactive`) |
| `pet:interactive` | `send` | `{ interactive: boolean }` | `setIgnoreMouseEvents(!interactive, { forward: true })` |
| `pet:click` | `send` | — | uma esperando → ativa; nenhuma → traz o Donel; várias → nada (a lista é da tela) |
| `pet:open` | `send` | `{ target: { kind: 'session', ptyId } \| { kind: 'donel' } }` | traz o Donel à frente e, se for sessão, `app:activate-session` |
| `pet:list-open` | `send` | `{ open: boolean }` | `setFocusable(open)`; `open` → `focus()` |
| `pet:context-menu` | `send` | — | `Menu.popup` com Silenciar por 1 hora / Retomar avisos · Esconder · Voltar ao canto |
| `pet:drag-start` | `send` | `{ screenX, screenY }` | guarda o deslocamento ponteiro→janela |
| `pet:drag-move` | `send` | `{ screenX, screenY }` | `setPosition` (arredondado) |
| `pet:drag-end` | `send` | `{ screenX, screenY }` | encaixe (≤ 24 px), grava `pet.placement`, recalcula `docked` e `align` |

## Regras

- O main ignora qualquer canal `pet:*` vindo de uma janela que não seja a
  esperada: `pet:tabs` só da principal, e os gestos só do pet.
- `pet:view` nunca carrega comando, pergunta, trecho de conversa, caminho de
  arquivo nem credencial (FR-018). Só nome de aba, tipo de evento e rótulo de
  conta.
- O `data-*` de teste da tela do pet (`data-pose`, `data-badge`,
  `data-bubble`, `data-docked`) espelha a vista. É a superfície do smoke `@pet`.

## Canais existentes alterados (C2)

| Canal | Antes | Depois |
|---|---|---|
| `chat:focus-state` | `activePtyId` e `tabNames` indexados por `tab.id` | indexados por **ptyId** (`tabPtyMap`), como diz `specs/014-chat/contracts/ipc-chat.md` |
| `chat:focus-pending` | o renderer usava o ptyId como `tab.id` | o renderer mapeia ptyId → `tab.id` antes de ativar |
