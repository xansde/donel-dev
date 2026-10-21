# Plano técnico — 015 Jobu Donel, o assistente na área de trabalho

**Branch**: `015-jobu-pet` · **Data**: 2026-10-21 · **Spec**:
`specs/015-jobu-pet/spec.md`

Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Complementos deste
plano:

- `research.md` — R1–R21, com as decisões e os fatos do código que as
  sustentam;
- `data-model.md` — núcleo puro, vista, configuração e posição;
- `contracts/ipc-pet.md` — canais novos e alterados;
- `quickstart.md` — baterias B1–B6 (fonte da página de validação);
- `duvidas.md` — dúvidas acumuladas, cada uma com a decisão provisória
  aplicada (mandato do dono de 21/10).

## Sumário

O pet é uma **segunda janela do próprio Donel**: transparente, sem moldura,
sempre por cima e fora da barra de tarefas. Ela carrega o mesmo `index.html`
na rota `#pet` e só desenha. Quem decide é um **núcleo puro**
(`src/shared/pet/`) que roda no **main**, com relógio próprio, e recebe quatro
sinais:

1. o **semáforo** de cada aba `claude` (já está no main);
2. as **abas** — ptyId, nome e aba ativa —, por um canal novo e sempre ligado,
   vindo do renderer principal;
3. o **foco** da janela principal;
4. os eventos de **troca de conta**, **pendência do chat** e **saída de PTY**.

O núcleo devolve uma `PetView` (pose, selo, balão, lista, encaixe e
alinhamento). O main a manda ao pet só quando ela muda. Os gestos do pet
(clique, arraste, menu) voltam ao main, que traz a janela principal à frente na
aba certa.

Com o pet ligado, os avisos do Windows desses eventos se calam. Tudo fica atrás
de `pet.enabled` (desligado por padrão), que liga e desliga sem reiniciar.

A pesquisa revelou três ajustes no código existente:

- **C1:** o app supunha uma janela só;
- **C2:** um descasamento de ids entre abas e PTYs nas notificações do chat;
- **C3:** o main não sabia se foi o dono que fechou a aba.

Os três entram como correções com teste.

**Mandato do dono (21/10):** "vai tocando, confio em vc. Quero ver o resultado
final. Acumula as dúvidas." A execução vai do plano ao alfa sem parar. A Fase 0
continua existindo, mas o gate de protótipo é conferido pelo Claude, com prints
contra a spec. As dúvidas vão para `duvidas.md`, já com decisão provisória
aplicada.

## Technical Context

**Language/Version**: TypeScript 5.7 (main, preload e renderer), React 18.3.1, Node do Electron 43.2
**Primary Dependencies**: Electron 43.2 (`BrowserWindow` transparente, `screen`, `Menu`); nenhuma dependência npm nova. Arte recortada por script Python 3.12 + Pillow 12.2 (ferramenta de autor, fora do app)
**Storage**: `config.json` do app — chave de topo `pet` (`enabled`, `placement`); assets PNG empacotados pelo Vite em `out/renderer/assets/`
**Testing**: vitest (núcleo puro, posição, parser do auxiliar de tela cheia, mapeamento aba↔pty) + smoke Playwright/Electron `@pet` com o CLI falso + bateria no alfa (`quickstart.md`)
**Target Platform**: Windows 11 (alfa → beta → público), um ou mais monitores, escala de exibição variável
**Project Type**: desktop-app (Electron: main + preload + renderer; design system em workspace)
**Performance Goals**: evento de sessão vira rosto e balão em ≤ 2 s com o Donel minimizado (SC-001); tick de 1 s no main só com o pet ligado; zero custo com ele desligado
**Constraints**: nenhum conteúdo de sessão no balão; nenhuma dependência nova; nenhum código de credencial; a janela do pet nunca rouba foco nem clique fora do desenho; não cobre tela cheia; UI em pt-BR, código em inglês
**Scale/Scope**: um operador; dezenas de abas; 6 user stories, 32 FRs

## Gate de constituição

`.specify/memory/constitution.md` está **não preenchido** (template). A
constituição de fato é o `CLAUDE.md` do repo e o baseline do squad, como nos
planos da 011 e da 014.

| Regra | Como este plano cumpre |
|---|---|
| O app nunca lê, grava ou exibe credenciais; a exceção de `src/main/accounts/` não se generaliza | O pet consome só o `label` da conta, que já sai em `broadcastAccountsChanged` (`src/main/index.ts:791-802`). Nada importa de `src/main/accounts/`. |
| TDD com escopo | Nascem com vitest antes do código: núcleo de estado, balão, selo, lista, "visto", posição/encaixe/validade, resolução de pose, mapeamento aba↔pty e parser do auxiliar de tela cheia. Janela, IPC e tela vão por smoke `@pet`. |
| Spec é a fonte do escopo | O plano cobre FR-001–FR-032. Nenhum ajuste de spec foi preciso. |
| Protótipo antes de código de UI (memória de 07/10) | A Fase 0 entrega o protótipo navegável. Pelo mandato de 21/10, quem confere é o Claude, e o protótipo vai junto do resultado. |
| UI em pt-BR, código em inglês | Respeitado. |
| Espelho público | Os assets do Jobu ficam em `src/`. Promover ao stable espera a dúvida Q1. Nada de vocabulário interno novo em fixture: abas de teste se chamam `atlas`, `beacon`, `vega`. |
| Baseline: instalar dependência pede confirmação | Nenhuma dependência nova. A detecção de tela cheia usa PowerShell já presente no Windows (R10). |
| LGPD | O balão nunca traz conteúdo de sessão (FR-018); as fixtures são sintéticas. |
| PR para `staging` livre; merge em `staging` pelo Claude após verificação verde; `main` e público bloqueados | Um PR para `staging`, mergeado depois de typecheck, vitest, build e smokes verdes. `main` e público não são tocados. |

**Resultado**: passa.

## Arquitetura em uma tela

```text
renderer principal (App)                    main                                   janela do pet (#pet)
────────────────────────                    ────                                   ────────────────────
abas + nome + aba ativa ── pet:tabs ──────▶ PetService ── pet:view ─────────────▶ PetApp (pose, selo,
toasts (calados c/ pet) ◀─ pet:prefs-changed  ├─ núcleo puro (shared/pet)            balão, lista, vida)
app:activate-session ◀──────────────────────  ├─ semáforo (onUpdate)               ◀── pet:interactive
                                              ├─ foco da janela principal           ◀── pet:click / :open
Preferências ── config:setPetPrefs ───────▶   ├─ troca de conta (label)             ◀── pet:drag-*
                                              ├─ pendência do chat (tipo)           ◀── pet:context-menu
                                              ├─ saída de PTY (+ killRequested)     ◀── pet:list-open
                                              ├─ tick 1 s · posição · menu
                                              └─ auxiliar de tela cheia (PowerShell)
```

## Decisões de desenho

As decisões e os porquês estão em `research.md`. Resumo:

- **R1:** o núcleo roda no main, porque o renderer minimizado tem timer
  estrangulado.
- **R2:** sessão sem nenhum evento de hook conta como parada, nunca como
  "trabalhando".
- **R3:** o balão de "travou" só nasce vindo de trabalho. O tipo vem do chat
  quando há chat; sem chat, o texto é `quer permissão`.
- **R4/C2:** canal `pet:tabs` com o mapeamento aba↔pty certo. Os canais do chat
  passam a usar o mesmo mapeamento.
- **R5/C1:** a janela principal tem acessor próprio, e o pet morre com ela.
- **R6/C3:** a intenção do `pty:kill` é guardada, e "encerrou" é só a saída sem
  o dono ter pedido.
- **R7:** `app:activate-session` funciona sem o chat.
- **R8:** com o pet ligado, os dois emissores de aviso do Windows se calam.
- **R9:** a janela cresce com o tamanho do desenho (FR-033), não é focável e deixa o clique atravessar
  o vazio pelo alfa do desenho.
- **R10:** tela cheia é detectada por `SHQueryUserNotificationState`, via
  PowerShell.
- **R11:** o arraste é manual, encaixa na barra a até 24 px e a posição fica na
  config.
- **R12:** a lista fica focável só enquanto está aberta; Esc e `blur` a fecham.
- **R13:** o menu do botão direito é nativo.
- **R14:** tick de 1 s, e a vista só vai ao pet quando muda.
- **R15:** as poses são descobertas no build; as provisórias vêm de uma
  função pura.
- **R16:** o riso vem só da visita.
- **R17:** a arte fica em `src/`; o stable espera a Q1.
- **R18:** rota `#pet` no mesmo `index.html` e o mesmo preload, com um domínio
  `pet` novo.
- **R19:** `pet:prefs-changed` mantém o renderer principal em dia quando o
  "Esconder" desliga o pet.
- **R20:** a chave de topo `pet` sobrevive a canal antigo pelo passthrough da
  config.
- **R21:** a janela do pet só nasce depois do `ready-to-show` da principal,
  então `firstWindow()` dos smokes continua sendo a principal.

### Valores que a spec deixou para o plano

| Valor | Escolha |
|---|---|
| Altura do desenho | Médio 140 px a 100% de escala; presets 100/140/200/260; Ctrl + roda de 10 em 10, entre 80 e 320 (FR-033, pedido do dono em 21/10) |
| Janela do pet | `max(480, 3,4 × tamanho)` × `tamanho + 200` DIP, ancorada na base do desenho |
| Balão | 6 s; evento de sessão até 1 s depois do nascimento se junta a ele (mesmo `id`, sem segundo pulinho) |
| Escalada | 10 min |
| Riso | 2,5 s |
| Waffle | 20 min sereno → 8 s, uma vez por período |
| Encaixe | a até 24 px da base da área útil |
| Folga do canto | 16 px da borda direita da área útil |
| Tela cheia | consulta a cada 1,5 s |
| Corte de nome | 28 caracteres + `…` |

## Correções em código existente (reveladas pela pesquisa)

| # | Onde | Problema | Correção |
|---|---|---|---|
| C1 | `src/main/index.ts:936,1114,1125,1013-1025,2605-2617` | `mainWindow` é local. "Qualquer janela" serve como janela principal no foco e no clique da notificação. Uma segunda janela viva impediria o app de encerrar. | Acessor `getMainWindow()`; os dois usos passam a ele; o pet é destruído no `closed` da principal, antes do `killAll`. |
| C2 | `src/renderer/src/App.tsx:1917-1935` | `chat:focus-state` manda `tab.id` (`tab-N`) onde o main espera ptyId, e `chat:focus-pending` usa o ptyId como `tab.id`. Efeito pelo código: notificação de pendência até para a aba ativa, título "Donel Dev" e clique que não ativa a aba. | Helper puro `tabPtyMap` (`tab.id ↔ ptyId`), usado pelos dois canais do chat e pelo `pet:tabs`, com teste. |
| C3 | `src/main/index.ts:1394-1396`, `src/main/pty-manager.ts:269-275` | O main não distingue "o dono fechou" de "saiu sozinha". | Conjunto `killRequested` marcado no `pty:kill` e consultado na saída. |

## Fases

O mandato de 21/10 vale para todas: sem parada para revisão do dono entre as
fases. A verificação automática de cada gate é feita pelo orquestrador, que
roda os comandos e lê a saída. Ele não confia no relatório do executor.

### Fase 0 — Arte e protótipo *(gate de forma; sem código de produção)*

- **Arte:** `scripts/pet/slice-sprites.py` recorta a folha v2 em
  `src/renderer/src/pet/assets/poses/*.png`, 12 poses com fundo transparente,
  âncora comum e 320 px de altura, mais `manifest.json`. A opção `--extra` fica
  pronta para as poses novas. A prancha de conferência vai para
  `design/jobu-pet/poses-contact-sheet.png`.
- **Protótipo:** `design/jobu-pet/prototipo.html`, autocontido, com área de
  trabalho falsa, painel de simulação e o comportamento da spec. Os prints vão
  para `design/jobu-pet/prints/`.
- **Gate:** prancha sem resto de fundo e prints conferidos contra a spec, pelo
  Claude (mandato).

### Fase 1 — Núcleo puro (TDD)

- `src/shared/pet/`:
  - `types.ts`;
  - `petState.ts` — reducer: sinais, eventos, tick, silêncio, foco;
  - `bubble.ts` — textos, corte, agregação;
  - `petView.ts` — pose por prioridade, selo, lista, rótulo de espera;
  - `placement.ts` — padrão, encaixe, validade, `align`;
  - `poses.ts` — resolução com provisórias;
  - `fullscreenState.ts` — parser da saída do auxiliar;
  - `tabPtyMap.ts`.
- **Gate:** vitest verde com cobertura de cada regra da `data-model.md`, e
  typecheck limpo.

### Fase 2 — Fatia vertical

- **Config** `pet` (`enabled`, `placement`) com sanitize, DTO,
  `config:setPetPrefs` e push `pet:prefs-changed`. O toggle "Jobu na área de
  trabalho" entra nas Preferências.
- **`PetService` no main:**
  - sinais de semáforo, `pet:tabs`, foco da principal, troca de conta, saída
    de PTY e pendência do chat;
  - tick de 1 s;
  - vista para a janela.
- **Janela do pet** (R9, R18, R21) e rota `#pet` com o `PetApp`: pose, selo e
  balão, sem gestos ainda.
- **C1, C2 e C3.**
- **Gate:** typecheck, vitest e build verdes, mais o smoke `@pet` básico:
  dormindo → sereno → lendo → balão "terminou" → impaciente com selo 1.

### Fase 3 — Avisos e gestos

- **Avisos:** os quatro tipos de balão com agregação, e a supressão dos dois
  avisos do Windows (R8).
- **Gestos:**
  - clique no Jobu (uma sessão, lista ou Donel) e no balão;
  - lista com Esc e clique fora (R12);
  - `app:activate-session`;
  - menu nativo (Silenciar/Retomar, Esconder, Voltar ao canto);
  - arraste com encaixe e esmaecimento, e posição lembrada e revalidada
    (eventos de `screen`).
- **Gate:** smoke `@pet` completo:
  - clique leva à aba;
  - lista com duas sessões;
  - Esconder desliga e o renderer fica sabendo;
  - nenhum aviso do Windows no stub do main.

### Fase 4 — Tela cheia e vida

- **Tela cheia:** auxiliar PowerShell (R10) com ciclo de vida preso ao pet
  ligado.
- **Vida:** balanço, pulinho, riso, waffle e piscar quando houver arte.
  `prefers-reduced-motion` é respeitado.
- **Gate:** vitest (parser e prazos) e smoke `@pet`. A tela cheia real fica
  para a bateria B5.5.

### Fase 5 — Entrega

- **Verificação completa:** suíte inteira, smokes do gate por área e o `@pet`.
- **PR para `staging`** e merge após verde.
- **Alfa:** `dist:alfa` do `staging` atualizado.
- **Página de resultado** (HTML local, sem Artifact):
  - prints **reais** do pet sobre a área de trabalho, capturados do app
    rodando;
  - o protótipo;
  - as dúvidas;
  - a bateria com "funcionou / não funcionou" gravando em `localStorage`, com
    botão de baixar `.json`.
- **Vault:** `context.md` e `todo.md` atualizados.

## Estratégia de teste

- **vitest antes do código** em todo `src/shared/pet/*`:
  - cada linha da tabela de prioridade;
  - as transições do "visto";
  - o `waiting → permission` sem balão (R3);
  - nascimento otimista ignorado (R2);
  - riso só por visita;
  - waffle uma vez por período;
  - agregação de 1 s;
  - corte de nome;
  - silêncio;
  - `9+`;
  - encaixe e validade de posição com monitores sintéticos;
  - provisórias;
  - parser do PowerShell;
  - mapeamento aba↔pty com Retomar.
- **Testes de contrato leves** para C2 e C3: o mapeamento nos dois canais do
  chat, e `killRequested`.
- **Smoke `@pet`** (`tests/smoke/pet.spec.ts`), com o CLI falso e roteiro com
  espera antes do `Stop`:
  - config semeada com `pet.enabled`;
  - pet localizado por URL `#pet`;
  - estado lido de atributos `data-pose`, `data-badge` e `data-bubble`;
  - janela principal minimizada pelo `electronApp.evaluate`;
  - clique no desenho e conferência da aba ativa;
  - Esconder pelo IPC equivalente ao menu.
- **Bateria no alfa:** B1–B6 do `quickstart.md`, entregue como página HTML.

## Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Janela transparente sempre por cima no Windows (DPI misto, GPU) | Borda preta, desenho borrado ou janela em escala errada | `backgroundColor: '#00000000'`; centro do desenho sempre num monitor só; poses a 320 px reduzidas por CSS; conferência na bateria B5 |
| Clique atravessando errado | Rouba clique da janela de baixo ou ignora o do Jobu | Teste de alfa por pixel no desenho; `forward: true`; smoke clica no desenho e no vazio |
| Windows recusa trazer a janela principal à frente | Só a barra de tarefas pisca | O clique é gesto do dono no próprio app; reserva `setAlwaysOnTop` liga e desliga (R7) |
| Auxiliar PowerShell cai ou demora a subir | Pet não some em tela cheia | Reinício com recuo; falha conta como "livre" (mostra o pet), o que nunca esconde aviso |
| Rota `#pet` carregando o app inteiro | Memória e efeitos colaterais do `App` no pet | `main.tsx` passa a importar `App` e `PetApp` dinamicamente: o pet nunca avalia o módulo do `App` |
| Nascimento otimista e `idle_prompt` do semáforo | Rosto mentindo ("lendo" ou "travou" falsos) | R2 e R3, com teste |
| Dois canais abertos com o pet ligado (userData compartilhado) | Dois Jobus | Risco já aceito dos canais lado a lado; o beta só terá pet quando a 015 subir |
| `firstWindow()` dos smokes | Smoke pegando o pet | O pet nasce depois do `ready-to-show` da principal (R21); o `@pet` acha a janela pela URL |

## Complexidade

| Item | Por que é preciso | Alternativa mais simples rejeitada porque |
|---|---|---|
| Processo auxiliar PowerShell | FR-007: o Electron não enxerga tela cheia de outro app | FFI exige dependência nova; sem detecção, fere a spec |
| Rota `#pet` no mesmo HTML e preload | Segunda entrada no electron-vite quebra o `tsc` com o Vite 5 (`electron.vite.config.ts:5-13`), e preload sandboxed não carrega chunk compartilhado | Segundo HTML e segundo preload: hack de tipos e risco de chunk em preload sandboxed |
| Push `pet:prefs-changed` | O "Esconder" muda a config pelo main, e o renderer não tem `config:changed` | Reler a config ao abrir as Preferências não corrige a supressão de toasts, que lê `appConfig` |

## Estrutura do projeto

### Documentação (esta feature)

```text
specs/015-jobu-pet/
├── spec.md
├── plan.md            # este arquivo
├── research.md
├── data-model.md
├── quickstart.md
├── duvidas.md
├── contracts/
│   └── ipc-pet.md
├── checklists/requirements.md
└── tasks.md           # /speckit.tasks
design/jobu-pet/       # protótipo, prancha das poses, prints
scripts/pet/           # recorte da arte e build do protótipo
```

### Código (novo e alterado)

```text
src/shared/pet/                 # NOVO — núcleo puro
  types.ts  petState.ts  bubble.ts  petView.ts  placement.ts
  poses.ts  fullscreenState.ts  tabPtyMap.ts  ipc.ts
src/main/pet/                   # NOVO
  pet-service.ts      # sinais → núcleo → vista; tick; menu; silêncio
  pet-window.ts       # BrowserWindow, clique que atravessa, posição, screen
  fullscreen-watcher.ts
src/renderer/src/pet/           # NOVO
  PetApp.tsx  PetApp.module.css  mountPet.tsx  hitTest.ts  usePetDrag.ts
  assets/poses/*.png  assets/poses/manifest.json
src/main/index.ts               # C1, C3, ligação do PetService, troca de conta, pendência, config
src/main/config-store.ts        # chave `pet`
src/shared/config.ts            # DTO + canal setPetPrefs
src/shared/index.ts             # DonelApi.pet
src/preload/index.ts            # domínio `pet` + config.setPetPrefs
src/renderer/src/main.tsx       # rota #pet; App e PetApp por import dinâmico
src/renderer/src/App.tsx        # pet:tabs, app:activate-session, supressão do toast, C2
src/renderer/src/Preferences.tsx  # toggle "Jobu na área de trabalho"
src/main/chat/notifications.ts  # isPetEnabled na regra
tests/pet-*.test.ts             # NOVOS
tests/smoke/pet.spec.ts         # NOVO (@pet)
tests/config-store.test.ts, tests/chat-config.test.ts  # forma exata ganha `pet`
```

## Re-check do gate (pós-desenho)

O desenho mantém as regras do gate:

- nada toca credencial;
- nenhuma dependência nova;
- decisão pura com teste;
- balão sem conteúdo;
- UI em pt-BR;
- PR só para `staging`.

**Passa.**
