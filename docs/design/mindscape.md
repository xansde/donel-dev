---
demanda: mindscape
plano: docs/planos/mindscape.pda.md
data: 2026-10-24
taskdex: []  # sem card: ferramenta pessoal — esta execução não conta na adoção
autor: Claude por delegação de Alexandre Lentz
self-assessment: apto  # decidido por delegação do dono, 2026-10-23
complexidade: —
status: aprovado
aprovado-por: Claude por delegação de Alexandre Lentz, 2026-10-23
aprovado-em: 2026-10-24
champions-post: "não postado — repo pessoal fora da Seazone (xansde/donel-dev), sem canal; decidido por delegação do dono, 2026-10-24"
adrs: [0004-base-do-quadro-mindscape]
---

# Design — Mindscape (V1)

## Demanda

V1 do Mindscape: terceiro modo do casco com um quadro por projeto, post-its de sessão vivos,
post-it escrito pela sessão a cada fim de turno, post-its do dono, ligações, persistência e
"ir ao terminal". Artefatos consumidos: [versões](../versoes/mindscape.md) (V1),
[refinamento](../refinamentos/mindscape-regras-v1.md) (13 regras),
[pesquisa](../pesquisas/mindscape-fonte-postit-sessao.md),
[decisão do protótipo](../prototipos/mindscape/decisao.md) (variante A),
[spec](../produto/mindscape.spec.md), [glossário](../glossario.md).

> Todas as decisões abaixo foram **decididas por delegação do dono, 2026-10-23/24** ("Você pode
> seguir a estrutura atual da esteira, só que vai tomando as decisões"). Critério: a opção mais
> simples que respeita o spec. Topologia, região e domínio não se aplicam: app desktop local,
> sem servidor (padrão Seazone de web app não se aplica).

## Decisões

### Base do quadro — ADR 0004

- Quadro próprio em React + `roughjs@4.6.6` (MIT, 27,7 KB de JS) para o traço à mão das
  ligações e do contorno dos cartões. Excalidraw descartado: ~2,77 MB de JS + 26 MB de fontes
  no pacote, `mermaid` transitivo, e post-it vivo difícil dentro de elementos de canvas.
  Evidência medida em [ADR 0004](../adr/0004-base-do-quadro-mindscape.md).
- **Dependência nova: `roughjs@4.6.6`**, versão exata (o repo fixa versões). Instalação é na
  `/implementacao`. Nenhuma outra.

### Modelo de dados (`src/shared/mindscape/model.ts`, puro)

```ts
type MindscapeDoc = { schemaVersion: 1; boards: Record<string /* projectPath */, MindscapeBoard> };

type MindscapeBoard = {
  projectPath: string;
  pan: { x: number; y: number };
  cards: Record<string /* cardId */, MindscapeCard>;
  links: MindscapeLink[];
};

type MindscapeCard =
  | { kind: 'session'; id: `session:${string}`; sessionId: string; x: number; y: number }
  | { kind: 'session-note'; id: `note:${string}`; sessionId: string; sessionName: string;
      text: string; writtenAt: number; x: number; y: number }
  | { kind: 'owner'; id: string /* randomUUID */; text: string;
      color: 'none' | 'accent' | 'donel-accent'; createdAt: number; x: number; y: number };

type MindscapeLink = { id: string; from: string /* cardId */; to: string; arrow: boolean };
```

- **Identidade**: a chave de sessão é o `claudeSessionId` (o mesmo que nomeia o `.jsonl` e já
  chaveia nome e cor da aba). `ptyId` não entra no modelo: não sobrevive a restart.
- **Mindscape = um `MindscapeBoard` por `projectPath`** (o `cwd` da aba, igual ao `project.path`
  da barra lateral). Criado sozinho na primeira sessão do projeto (regra 9). Aba sem projeto
  (shell ou home) não entra.
- **Post-it de sessão**: só a posição é persistida. Estado, nome e cor vêm ao vivo das abas
  abertas; sem aba aberta, o cartão não é desenhado (regra 11), mas a posição fica para quando a
  sessão voltar.
- **Post-it escrito pela sessão**: um por sessão (`note:<sessionId>`), sobrescrito a cada fim de
  turno (regra 2). Guarda o nome da sessão para sobreviver ao fechamento da aba. Texto cortado em
  4.000 caracteres no store; o cartão mostra 8 linhas (`line-clamp`) e o texto inteiro no
  `title`.
- **Post-it do dono**: cor só entre `none | accent | donel-accent` (Sem cor, Azul, Dourado); o
  `permission` (Vermelho) não é aceito (regra 6). O post-it de sessão herda o `TabColorToken`
  da aba.
- **Arquivar** (do dono ou escrito pela sessão) = remover do quadro, junto com as ligações que
  tocam o cartão. Sem lixeira na V1.
- **Ligação**: entre dois cartões quaisquer do mesmo quadro, `arrow` liga/desliga a seta
  (regra 5). Ligação para cartão de sessão sem aba aberta fica guardada e só não é desenhada.
- **Reducers puros** (testados com vitest): `ensureBoard`, `placeSessionCard`, `writeSessionNote`,
  `moveCard`, `addOwnerCard`, `editOwnerCard`, `setOwnerColor`, `archiveCard`, `addLink`,
  `toggleLinkArrow`, `removeLink`, `parseMindscapeDoc` (sanitiza o que vem do disco).

### Persistência (`src/main/mindscape-store.ts`)

- Arquivo próprio `<userData>/mindscape.json` (regra 7), gravado inteiro com temp → fsync →
  rename, reaproveitando `createSystemConfigIoDeps()` de `config-store.ts`. Override para smoke:
  `DONEL_MINDSCAPE_FILE`.
- **Único escritor**: o main grava; o renderer é dono do estado em memória e manda o documento
  inteiro (`mindscape:save`), com debounce de 500 ms. O main nunca altera o documento por conta
  própria — evita dois escritores.
- `schemaVersion` maior que o conhecido → o main lê e **não grava** (o `userData` é compartilhado
  pelos canais alfa/beta/stable; mesmo princípio do cabeçalho do `esteira-store`). Arquivo
  ausente ou inválido → documento vazio.

### Fonte do post-it escrito pela sessão

- O `SessionSemaphoreManager` ganha `onTurnEnded(listener: (ptyId, lastAssistantMessage: string | null) => void)`,
  disparado em `Stop` e `StopFailure`. Cobre os dois transportes: a ponte (`BridgeEvent.payload`
  já traz o payload inteiro, `hook-bridge.ts:29`) e o servidor legado (`handleHookBody`).
- O campo `last_assistant_message` existe no CLI atual: o binário `claude.exe` 2.1.310 declara
  `last_assistant_message: …optional().describe("Text content of the last assistant message
  before stop…")` (grep no binário, 2026-10-24). Como é **opcional**, o fallback da regra 1
  continua: `extractTranscriptTail` (`transcript-watcher.ts`) ganha um quarto campo,
  `lastAssistantText`, na mesma varredura reversa de 64 KB; o main só lê a cauda quando o
  campo veio vazio. Se nenhum dos dois der texto, o post-it mantém o texto anterior.
- O main traduz `ptyId → claudeSessionId` por `activeSessionByPty` e manda ao renderer
  `mindscape:turn-ended` `{ sessionId, text, at }`. O renderer aplica `writeSessionNote` e salva.

### Contratos IPC (`src/shared/mindscape/channels.ts`, `window.donel.mindscape`)

| Canal | Direção | Payload | Retorno |
|---|---|---|---|
| `mindscape:load` | renderer → main (invoke) | — | `MindscapeDoc` |
| `mindscape:save` | renderer → main (invoke) | `MindscapeDoc` | `{ ok: true } \| { ok: false, reason: 'read-only' \| 'write-failed' }` |
| `mindscape:turn-ended` | main → renderer (push) | `{ sessionId: string; text: string; at: number }` | — |

O main valida o payload do `save` com `parseMindscapeDoc` antes de gravar (nunca confia no
renderer).

### Renderer

- **Modo**: `devModeOn: boolean` vira `appMode: 'geral' | 'dev' | 'mindscape'`; `devModeOn`
  continua existindo como `const devModeOn = appMode === 'dev'`, para o Modo Dev não mudar
  (spec). O `SegmentedControl` ganha a terceira opção "Mindscape" (regra 8). O Mindscape cobre
  o miolo por cima, como o `EsteiraScreen` já faz; as abas de terminal continuam montadas
  (nenhum PTY recriado na troca).
- **Estado no `App.tsx`**: hook `useMindscapeDoc()` carrega no boot, ouve `turn-ended` e salva com
  debounce — vive no App para gravar o post-it da sessão mesmo com o Mindscape fechado. A tela
  `MindscapeScreen` só monta com o modo ativo (menos memória com ela fechada).
- **Sessões vivas**: a tela recebe a lista derivada das abas `claude` com projeto —
  `{ tabId, sessionId, name, projectPath, projectName, color, state, stateEnteredAt }` — a partir de
  `tabs` + `semaphoreStates` que o App já mantém. Estado muda → re-render do cartão, sem I/O.
- **"Sem novidade desde o último acesso"**: mapa em memória `seenAt[sessionId]` no App, carimbado
  quando a aba fica focada no Uso geral (troca de `activeTabId` com `appMode === 'geral'`) e
  quando o dono sai do Uso geral com a aba em foco (regra 4). Função pura
  `sessionHighlight(state, stateEnteredAt, seenAt)` em `src/shared/mindscape/highlight.ts`:
  `working` → normal; demais estados → destacada se `stateEnteredAt > (seenAt ?? 0)`, senão
  apagadinha (regra 3). Não persiste: o app nasce sem abas, e reabrir a sessão já é acesso.
- **Ir ao terminal**: duplo clique no post-it de sessão, ou o botão "Ir ao terminal" do cartão
  selecionado → `setAppMode('geral')` + `setActiveTabId(tabId)` (regra 10), que já carimba o
  `seenAt`.
- **Quadro**: plano com `transform: translate(pan)`; arrastar o fundo move o pan, arrastar o
  cartão move o cartão (pointer events, posição aplicada em `requestAnimationFrame` e gravada no
  `pointerup`). Novo post-it de sessão sem posição cai numa grade automática; o escrito pela sessão
  nasce ao lado do dela. Ligações numa camada SVG sob os cartões; criar ligação = modo "Ligar" na
  barra do quadro, clicar origem e destino.
- **Traço à mão**: `roughShapes.ts` gera os `d` do SVG com `rough.generator()` e `seed` fixo por
  id (o traço não "treme" a cada render), com cache por geometria.
- **Forma**: `final.html` (variante A) manda na forma; o cartão reusa os tokens do
  `PostItCard` (`--postit-bg`, meta a 65%) e o `StateDot`/glifos de `TerminalTab`. UI em pt-BR.

### Módulos novos

- `src/shared/mindscape/model.ts`, `highlight.ts`, `channels.ts` (puros; vitest)
- `src/main/mindscape-store.ts` (vitest com `ConfigIoDeps` injetado)
- `src/renderer/src/Mindscape/` — `MindscapeScreen.tsx`, `MindscapeBoard.tsx`, `MindscapeCard.tsx`,
  `roughShapes.ts`, `useMindscapeDoc.ts`, `*.module.css`
- Alterados: `session-semaphore-manager.ts` (`onTurnEnded`), `transcript-watcher.ts`
  (`lastAssistantText`), `index.ts` (IPC + encaminhamento), `preload/index.ts`, `App.tsx` (modo de 3
  valores + hook + `seenAt`).
- Testes: vitest nos módulos puros e no store (TDD com escopo do `CLAUDE.md`); a tela valida por
  smoke Playwright (`tests/smoke/`), com fixtures de projetos `atlas`, `beacon`, `vega`.

## O que fica de fora

- Rabisco, prints, zoom, minimapa, histórico de post-its da sessão, mindscape por esteira (V2).
- Captura relâmpago, cartas do dia, "virar prompt", sessão lendo post-its (V3).
- Contador de baselines (regra 12).
- Lixeira ou "desfazer" ao arquivar.
- Persistir `seenAt` entre execuções do app.
- Qualquer mudança no Modo Dev, em `src/main/accounts/` ou no `config.json`.
- Não-funcionais de web (cache, paginação, feature flag, idempotência de API): não há servidor.
  O que vale aqui: escrita atômica, schema guard e debounce, já acima.

## Trade-offs

- `@excalidraw/excalidraw` como base — descartado (ADR 0004): peso e post-it vivo.
- Persistir dentro do `config.json` — descartado: o sanitizador do config e os outros canais
  instalados poderiam derrubar a chave nova (risco já conhecido no `CLAUDE.md`); arquivo próprio
  isola.
- Main como dono do estado (renderer só envia operações) — descartado: duplica os reducers dos dois
  lados; com um renderer só, o renderer ser o dono e o main só gravar é mais simples.
- Ler o post-it só da cauda do `.jsonl` (sem o hook) — descartado: o watcher dispara no meio do
  turno, e a regra 1 pede o texto no fim do turno; o `Stop` já traz o texto pronto.
- Desenhar os cartões em `<canvas>` — descartado: cartão DOM reusa os componentes e tokens do
  design system, e o número de cartões por projeto é pequeno.
