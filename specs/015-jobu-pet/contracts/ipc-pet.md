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
| `app:activate-session` | `{ ptyId: string }` | ativa a aba cujo PTY é `ptyId` (mapa reverso do `tabPtyMap`, feito com o ÚLTIMO ptyId de cada aba, também a de um processo que encerrou: o balão "encerrou" leva a ela); o main já trouxe a janela à frente |
| `pet:prefs-changed` | `{ enabled: boolean }` | atualiza `appConfig.pet.enabled` (toggle e supressão dos toasts) |

## Main → janela do pet

| Canal | Payload | Efeito |
|---|---|---|
| `pet:view` | `PetView` (ver `data-model.md`) | redesenha; enviado só quando muda |
| `pet:close-list` | — | a janela do pet perdeu o foco com a lista aberta (o dono clicou em outro lugar): a tela fecha a lista. A página nunca recebe o `blur` do DOM nesse caso (medido no Electron 43: `document.hasFocus()` segue `true`), então é o evento `blur` da própria janela, ouvido no main, que avisa |

## Janela do pet → main

| Canal | Tipo | Payload | Efeito no main |
|---|---|---|---|
| `pet:ready` | `send` | — | manda a vista atual e mostra a janela (`showInactive`), salvo se um app tem a tela inteira (aí ela fica escondida e aparece quando a tela é devolvida) |
| `pet:interactive` | `send` | `{ interactive: boolean }` | `setIgnoreMouseEvents(!interactive, { forward: true })` |
| `pet:click` | `send` | — | o main decide com o estado dele (`decideClick`): uma esperando → ativa; nenhuma → traz o Donel; várias → nada (a lista é da tela). Quando age, dispensa o balão |
| `pet:open` | `send` | `{ target: { kind: 'session', ptyId } \| { kind: 'donel' } }` | traz o Donel à frente (`restore`, `show`, `focus`; a reserva `setAlwaysOnTop(true)`, `focus`, `setAlwaysOnTop(false)` só roda se o foco não pegar, R7) e, se for sessão, `app:activate-session`. Dispensa o balão, também o de uma sessão que já não espera |
| `pet:list-open` | `send` | `{ open: boolean }` | `open` → `setFocusable(true)` e `focus()`; fechar → `blur()` (se ela é a janela ativa) e `setFocusable(false)`, para a janela transparente não ficar com o teclado do dono |
| `pet:context-menu` | `send` | `{ screenX, screenY }` opcional | o main monta o menu com o estado de agora (`buildPetMenu`, `src/shared/pet/menu.ts`) e abre o nativo no ponto do clique (`Menu.popup` com as coordenadas de tela convertidas para o conteúdo da janela); sem payload abre no ponteiro. Itens: Silenciar por 1 hora / Retomar avisos · Liberar print por 1 minuto / Bloquear print agora · Tamanho (Pequeno 100, Médio 140, Grande 200, Muito grande 260, com marca no atual) · separador · Voltar ao canto · Esconder. A escolha cai em `PetService.handleMenuAction` |
| `pet:drag-start` | `send` | `{ screenX, screenY }` | guarda o ponteiro e a âncora de agora (e os monitores) |
| `pet:drag-move` | `send` | `{ screenX, screenY }` | a âncora anda o que o ponteiro andou; a janela recebe o retângulo inteiro (`setBounds`, **nunca `setPosition`**: a 125% cada `setPosition` faz a janela transparente crescer, medido — 300 chamadas fizeram 480x340 virar 780x681); `docked` e `align` saem na vista na hora, sem gravar nada |
| `pet:drag-end` | `send` | `{ screenX, screenY }` | encaixe (≤ 24 px da borda da barra do monitor onde a base está), grava `pet.placement` (a âncora), recalcula `docked` e `align`. Uma soltura que deixa menos da metade do desenho em toda tela é **recusada**: ele volta à âncora do começo do arraste e nada é gravado (Q26) |
| `pet:resize-step` | `send` | `{ direction: 1 \| -1 }` | Ctrl + roda sobre o desenho (uma volta de 100 px = um passo, o touchpad acumula): `pet.size ± 10`, limitado a 80–320; recalcula a janela e grava. Num lugar que o dono escolheu a âncora fica fixa; na posição padrão o canto manda (a borda direita fica a 16 px da tela, Q24) |

O submenu **Tamanho** do `pet:context-menu` (Pequeno 100 · Médio 140 · Grande
200 · Muito grande 260, com marca no atual) grava `pet.size` pelo mesmo caminho.
O `PetView` ganha `size: number`, que é a altura do desenho em DIP.

## Regras

- O main ignora qualquer canal `pet:*` vindo de uma janela que não seja a
  esperada: `pet:tabs` só da principal, e os gestos só do pet.
- `pet:view` nunca carrega comando, pergunta, trecho de conversa, caminho de
  arquivo nem credencial (FR-018). Só nome de aba, tipo de evento e rótulo de
  conta.
- O `data-*` de teste da tela do pet (`data-pose`, `data-art`, `data-badge`, `data-bubble`,
  `data-list`, `data-docked`, `data-align`, `data-size`, `data-silenced`) espelha a vista; `data-interactive`,
  `data-dragging` e `data-blinking` dizem o que a tela decidiu sozinha. É a superfície do smoke `@pet`.
- A janela do pet nasce **fora de capturas** (`setContentProtection(true)`, `WDA_EXCLUDEFROMCAPTURE` = `0x11` no
  Windows 11) e só o dono a libera, por 1 minuto, pelo menu (FR-034, FR-035). Medido no Electron 43: a afinidade
  só chega ao SO quando a janela é mostrada, e o que se muda com ela escondida vale no próximo `show`.

## Canais existentes alterados (C2)

| Canal | Antes | Depois |
|---|---|---|
| `chat:focus-state` | `activePtyId` e `tabNames` indexados por `tab.id` | indexados por **ptyId** (`tabPtyMap`), como diz `specs/014-chat/contracts/ipc-chat.md` |
| `chat:focus-pending` | o renderer usava o ptyId como `tab.id` | o renderer mapeia ptyId → `tab.id` antes de ativar |

Os dois lados do mapa saem de `src/shared/pet/tabPtyMap.ts` (`buildChatFocusState` para o `chat:focus-state`,
`tabPtyMap(...).tabIdOf` para a ativação), com testes em `tests/pet-tab-pty-map.test.ts`.

## Seams de teste (só ambiente, só o valor exato `1`)

Como `DONEL_SMOKE_NOTIFICATIONS_LOG`, existem para os smokes e para os prints da documentação, e não mudam o app de
quem não os liga (`src/main/pet/pet-seams.ts`, Q32).

| Variável | Efeito |
|---|---|
| `DONEL_PET_SMOKE_INVISIBLE=1` | O Jobu vira um **fantasma** para o SO: `setOpacity(0)` (sem pixel na tela de quem trabalha), nunca recebe o mouse do SO (`pet:interactive` não liga o clique), nunca toma o foco (a lista não torna a janela focável) e o menu do botão direito **não abre o nativo**: o modelo fica em `globalThis.__donelPetSmoke.menu = { entries, choose }` do main, e `choose(action)` é o callback que o clique num item roda. `globalThis.__donelPetSmoke.setFullscreen(active)` faz o serviço ouvir o que o vigia diria. A página, o CDP e o estado seguem iguais. |
| `DONEL_PET_CAPTURABLE=1` | A proteção contra captura nunca liga (`captureAllowed` sempre `true`), para os prints reais mostrarem o Jobu. Não conta como liberação do dono: o menu continua dizendo "Liberar print por 1 minuto". |
