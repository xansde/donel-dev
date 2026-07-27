# Plano técnico — 003 Modo Dev

Referência: `spec.md` deste diretório — CA-1..CA-26, invariantes 1–6, achados
técnicos 6–13, decisões `[MD-0x]` do Wayfinder e `[C1]`–`[C6]` do `/clarify`
(2026-07-27). Paths relativos a `C:/Users/xansd/seazone/donel-dev`. Branch:
`feature/mvp-p0`.

**Correção de citação:** o achado 6 da spec (linha 41-44) cita
`src/main/index.ts:357` para "config.json é lido no boot". Nessa linha vive
`getAppConfigPath()` (o resolvedor do path); a LEITURA de fato
(`readAppConfig(getAppConfigPath(), ...)`) acontece em `src/main/index.ts:673`,
dentro do boot. Path certo a citar daqui em diante: `src/main/index.ts:357`
(resolução do path) **e** `:673` (leitura no boot). Os demais 12 `path:linha`
dos achados técnicos foram conferidos linha a linha contra o código atual e
batem exatamente — nenhum outro ajuste.

**Princípio que atravessa o plano:** o app **lê** (disco + processo próprio) e
**pré-digita**; ele nunca decide por conta própria, nunca escreve fora do seu
próprio `config.json`, e nunca é o gate de nada (invariantes 2–5). Duas fatias,
dois PRs, exatamente como fechado no C5.

## Arquitetura em uma tela

```
   RENDERER
     Modo Dev (toggle) ──► layout de 4 zonas, tela de hoje intacta (CA-20)
       │
       ├─ Zona 1 · DevModeEntry.tsx ──► taskdex-board-client (leitura mínima,
       │                                 só a query da porta de entrada)
       ├─ Zona 2 · PhaseButton.tsx + openPhaseSession.ts
       │     cria/foca PTY (claude, model/effort da tabela CA-4)
       │     espera semáforo entrar em 'waiting' (sinal JÁ existente)
       │     ── window.donel.pty.input(ptyId, comando) SEM '\r' ──►  PTY_CHANNELS.input
       │                                                             (preload/index.ts:44-46
       │                                                              → main/index.ts:326-328,
       │                                                              achado 8 — canal existente)
       └─ Zona 3 · DiscoveryMap.tsx ──► devMode:readTree(cardId) ──► árvore
                                         (Fatia 2: + overlay de 4 fatos do board)

   MAIN
     devMode:* (IPC, src/main/index.ts + src/preload/index.ts)
       ├─ discovery-tree.ts     — monta a árvore (marcos × fases)
       │     └─ esteira-reader.ts — lê ctx.md/result.json do repo-alvo (fs puro-injetável)
       ├─ esteira-result-watcher.ts — fs.watch nos handoffs da fase ativa (CA-6)
       ├─ config-store.ts  chave nova `devMode` (4 pontos do padrão do arquivo)
       └─ taskdex-board-client.ts — Fatia 1: 1 query restrita (porta de entrada)
                                     Fatia 2: lista fechada de tools de leitura (CA-11)

   SHARED (puro, TDD)
     devMode.ts (tipos+canais) · devModeDefaults.ts (tabela CA-4) ·
     phaseState.ts (os 5 estados, CA-15) · boardAnnotation.ts (Fatia 2, CA-12/13/14)
```

Nenhuma peça de I/O nova além de: `fs.watch`/`fs.stat` nos artefatos da Esteira
(mesmo padrão de `transcript-watcher.ts`) e um cliente de leitura do TaskDex
(novo, mínimo, Fatia 1 → estendido na Fatia 2). PTY, semáforo e ConfigStore são
100% reuso do que já existe.

## Onde cada peça entra (código novo vs. extensão)

| Peça | Novo ou extensão | Onde |
|---|---|---|
| Pré-digitar (CA-3) | **Extensão** — reusa `PTY_CHANNELS.input` (`src/preload/index.ts:44-46` → `src/main/index.ts:326-328`, achado 8) | Nenhum canal novo |
| Model/effort da sessão de fase | **Extensão** — `buildClaudeArgs` (`src/shared/commandBuilder.ts:43-78`) já aceita `--model`/`--effort`; a tabela CA-4 só escolhe os valores | `PtyCreateOptions.args` |
| Retomar fase concluída (CA-9) | **Extensão** — `SessionContinuation.resume` já existe (`commandBuilder.ts:30-33`, vira `-r <id>`) | Idem |
| Correlação sessão↔jsonl | **Extensão** — `session-correlation.ts:24-34` já resolve/impõe o id | Sem mudança |
| Leitura de `ctx.md`/`result.json` | **Código novo** — `src/main/esteira-reader.ts` | Novo |
| Árvore do discovery | **Código novo** — `src/main/discovery-tree.ts` | Novo |
| Arquivamento por manifesto (CA-6) | **Código novo**, mesmo padrão de `transcript-watcher.ts` (`fs.watch` do diretório, nunca do arquivo) | `src/main/esteira-result-watcher.ts` |
| Estado próprio do app (CA-21) | **Extensão** do padrão de `sessionRegistry`/`AppConfig` (4 pontos, ver 007) | `config-store.ts` + `shared/config.ts` |
| Cliente de leitura do board | **Código novo** | `src/main/taskdex-board-client.ts` |
| UI das 3 zonas do Modo Dev | **Código novo** (React, `src/renderer/src/DevMode/`) | Novo diretório |
| Modo/layout (CA-20) | **Extensão** de `App.tsx` (mesmo padrão de toggle de painel que já existe para Preferências/Launcher) | `App.tsx` |

**Achado 9 (precedente 004) respeitado:** nenhuma peça nova envia `/rename` ou
qualquer outro comando com `\r`. A única exceção deliberada continua sendo o
pré-digitar do CA-3, e ela nunca inclui o Enter.

## As duas fatias (C5 — respeitadas ao pé da letra)

- **Fatia 1 — condução e mapa** (CA-1 a CA-10, CA-15 a CA-23): tudo o que roda
  de **disco + processo próprio**. A **única** leitura de board nesta fatia é a
  consulta restrita da porta de entrada (CA-1/CA-2: lista de cards de um board
  único, colunas Backlog/Discovery/Plano) — sem ela não há como abrir
  discovery. `taskdex-board-client.ts` nasce aqui **minúsculo** (uma função,
  uma query) e ganha o conjunto fechado de tools de leitura só na Fatia 2.
- **Fatia 2 — espelho** (CA-11 a CA-14): credencial de serviço dedicada +
  conjunto fechado de tools de leitura do TaskDex; anota os 4 fatos que o
  disco não sabe em cima da árvore que a Fatia 1 já desenha; nunca escreve.
- **Cada fatia fecha com seu próprio PR**, exatamente como o C5 fixou. Nada da
  Fatia 2 é pré-requisito de código para a Fatia 1 — só a Fatia 1 dá valor
  sozinha (US-A, US-B, US-C, US-E, US-F, US-G já funcionam sem o espelho).

### Nota — CA-5 (trava avisa) e a fronteira entre fatias

CA-5 pede que o botão da próxima fase mostre um aviso quando há **trava**
registrada (`esteira:em-andamento:<fase>`) — mas essa trava é um **label do
card no TaskDex** (`preflight.py:75` no `esteira-do-xande`, `LOCK_LABEL_PREFIX`),
não um fato de disco. Isso pareceria contradizer o C5 ("board só para a porta
de entrada" na Fatia 1). A leitura de CA-12 resolve a aparente tensão: **"trava
ativa" é, literalmente, um dos quatro fatos que o espelho (CA-12, Fatia 2)
sobrepõe à árvore.** Resolução adotada — **sem reabrir o clarify**:
- **Fatia 1** entrega o **contrato de UI** do CA-5 (o botão sempre clicável tem
  um slot de aviso) **vazio** — não existe fonte de dado para a trava ainda,
  então o slot nunca acende. Nenhuma UI falsa, nenhuma promessa quebrada: o
  botão continua clicável (o requisito central de CA-5 já vale), só o aviso
  específico de trava não tem dado antes da Fatia 2.
- **Fatia 2** liga o slot ao dado real via CA-12. Nenhuma linha de CA-5
  precisa ser reescrita depois — só o dado passa a chegar.
- Isto é diferente do estado **"travada"** do CA-15 (ctx.md presente,
  result.json ausente, sessão não mais viva) — esse é 100% disco + processo
  próprio, já funciona inteiro na Fatia 1, e é o que dispara CA-16 (retomada
  por `/esteira-liberar`).

## Modelo de dados do estado próprio do app (CA-21/CA-22)

Chave nova `devMode` em `AppConfig`/`AppConfigDto`, tocando os **quatro pontos**
do padrão do arquivo (`AppConfig`, `defaultAppConfig`, `sanitizeAppConfig`
campo a campo/entrada a entrada, `toAppConfigDto`+`AppConfigDto`) — a mesma
armadilha documentada em `sessionRegistry` (T704/007): chave esquecida em um
dos quatro pontos é descartada em silêncio na leitura. `CONFIG_SCHEMA_VERSION`
**não sobe** (config sem a chave carrega com os defaults abaixo).

```ts
// src/shared/devMode.ts

export type EsteiraPhase = 'discovery' | 'plano' | 'implementar' | 'validar' | 'concluir';

/** Um discovery = 1 card de entrada do board (achado do Modelo de domínio da spec). */
export interface DevModeDiscovery {
  readonly cardId: string; // = discoveryId
  readonly repoPath: string; // vínculo discovery ↔ repo (escolhido na criação, CA-21)
  readonly epicId: string | null;
  readonly openedAt: number;
  /** CA-23: marcado quando o gate de esteira-concluir de TODOS os marcos deu "success". */
  readonly closedAt: number | null;
}

export type DevModeDiscoveries = Readonly<Record<string /* cardId */, DevModeDiscovery>>;

/** CA-21 + CA-9: session-id arquivado por etapa concluída, com o perfil em que rodou (CA-22). */
export interface ArchivedPhaseSession {
  readonly sessionId: string;
  readonly profileSlug: string;
  readonly archivedAt: number;
}

/** Chave = `${cardId}:${marcoId}:${fase}` — uma entrada por etapa concluída. */
export type ArchivedPhaseSessions = Readonly<Record<string, ArchivedPhaseSession>>;

/** CA-4/C6 — fase → modelo, esforço e o TEXTO EXATO do comando a pré-digitar. */
export interface PhaseDefault {
  readonly model: 'fable' | 'opus' | 'sonnet' | 'haiku';
  readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** `{card_id}` é o único placeholder — substituído na hora de pré-digitar. */
  readonly commandTemplate: string;
  /** C6, exceção da fase concluir: roda inline na sessão em foco, nunca spawna sessão própria. */
  readonly opensOwnSession: boolean;
}

export type PhaseDefaultsTable = Readonly<Record<EsteiraPhase, PhaseDefault>>;

/** CA-1 — um único board configurado; ausente = porta de entrada desligada. */
export interface DevModeBoardConfig {
  readonly workspaceId: string;
  readonly teamId: string;
}

export interface DevModeState {
  readonly discoveries: DevModeDiscoveries;
  readonly focusedDiscoveryId: string | null; // CA-21: "vários abertos, um em foco"
  readonly archivedPhaseSessions: ArchivedPhaseSessions;
  readonly phaseDefaults: PhaseDefaultsTable; // CA-4, editável
  readonly boardConfig: DevModeBoardConfig | null;
}
```

`sanitizeDevModeState` segue o mesmo espírito de `sanitizeSessionRegistry`:
descarta **entrada a entrada** o que estiver malformado (sem `repoPath`,
`sessionId` vazio, `model`/`effort` fora do enum conhecido), preservando o
resto — nunca lança, nunca derruba o config inteiro.

**Tudo o que não está nesta lista é leitura** (disco via `esteira-reader.ts`/
`discovery-tree.ts`, ou board via `taskdex-board-client.ts` — Fatia 2). Um
fato, um dono (CA-21).

## Leitura dos artefatos da Esteira (`.esteira/<fase>/...`)

`src/main/esteira-reader.ts` — mesmo estilo de `config-store.ts`: I/O
injetável (`existsSync`/`readFileText`), nunca lança, degrada para "não sei"
em vez de crashar (C4). Formato do manifesto medido em `dalton/.esteira/*`
(3 fases reais lidas: discovery, plano, implementar — campos conferidos):

```ts
// shape lido de <fase>-result.json (produzido pela SKILL, nunca pelo app)
export interface EsteiraResultManifest {
  readonly card_id: string;
  readonly fase: string;
  readonly status: string; // "success" | outro valor = falhou (CA-15)
  readonly started_at: string;
  readonly finished_at: string;
  readonly executor: string;
  readonly model: string;
  readonly effort: string;
  readonly outputs: {
    readonly summary?: string;
    /** só no discovery-result.json — mapa card_id → marco_id (Modelo de domínio da spec). */
    readonly fanout_cards?: readonly { card_id: string; marco_id: string }[];
    /** CA-8: os ÚNICOS artefatos declarados por uma fase — nunca varredura. */
    readonly artifact_paths?: readonly string[];
    readonly e2e_path?: string;
    readonly documents?: readonly string[];
    readonly knowledge?: { readonly repo_lessons?: string; readonly consulted?: unknown };
    readonly [key: string]: unknown;
  };
  readonly registrations?: {
    readonly taskdex?: unknown;
    readonly vault?: { readonly path: string | null; readonly section: string | null };
  };
  readonly next_fase_suggested?: string | null;
}

export interface PhaseArtifacts {
  readonly ctxPath: string; // .esteira/<fase>/<card_id>-ctx.md
  readonly resultPath: string; // .esteira/<fase>/handoffs/<card_id>/<fase>-result.json
  readonly ctxExists: boolean;
  readonly result: EsteiraResultManifest | null; // null = ausente OU ilegível
  /** C4 — distingue "ausente" (fase não rodou) de "ilegível" (JSON corrompido): o nó mostra
   *  o que der pra ler + um marcador discreto, nunca crash nem tela vazia. */
  readonly resultUnreadable: boolean;
}

export function readPhaseArtifacts(repoPath: string, fase: EsteiraPhase, cardId: string, io: EsteiraReaderIoDeps): PhaseArtifacts;
export function readDiscoveryFanout(repoPath: string, cardId: string, io: EsteiraReaderIoDeps): readonly { cardId: string; marcoId: string }[];
```

**Skills internas do CA-8:** o manifesto não tem um campo "skills executadas" —
conferido nos 3 tipos de manifesto lidos (discovery/plano/implementar) e no
schema documentado de `esteira-do-xande` (`documentar-result.schema.md`), nenhum
carrega essa lista. A fase↔skill é **1:1 e estática** (a mesma tabela do CA-4:
`discovery`→`/esteira-discovery`, `plano`→os 5 comandos speckit encadeados pela
skill, etc.) — então "as skills internas que ela rodou" (CA-8) **é a mesma
tabela de defaults, exibida como anotação fixa**, não um dado novo extraído do
manifesto. Isto respeita a "Fora de escopo" da spec ("reconhecer skill
parseando o transcript... as skills internas do CA-8 saem do manifesto, não de
parsing novo") lendo "manifesto" como "o que já se sabe sobre a fase", não como
um campo JSON a inventar.

**Árvore do discovery (CA-7/CA-9/CA-10/CA-23):**

```ts
// src/main/discovery-tree.ts
export interface PhaseNode {
  readonly phase: EsteiraPhase;
  readonly status: PhaseStatus; // CA-15, de phaseState.ts
  readonly artifacts: PhaseArtifacts;
  readonly archivedSession: ArchivedPhaseSession | null; // CA-9/CA-21
}
export interface MarcoNode {
  readonly marcoId: string; // "M1", "M2"... (outputs.fanout_cards)
  readonly cardId: string; // card de Plano deste marco
  readonly phases: Readonly<Record<EsteiraPhase, PhaseNode>>;
}
export interface DiscoveryTree {
  readonly discoveryCardId: string;
  readonly marcos: readonly MarcoNode[];
  readonly focusedMarcoId: string | null;
  /** CA-23 — true quando TODO marco tem a fase concluir com status "success". Disco puro, sem board. */
  readonly allMarcosComplete: boolean;
}

export function buildDiscoveryTree(repoPath: string, discoveryCardId: string, archived: ArchivedPhaseSessions, io: EsteiraReaderIoDeps): DiscoveryTree;
```

**Pool de artefatos consultável (CA-10):** função separada, `resolveArtifactPool`
— **não é varredura**: confere a EXISTÊNCIA de uma lista FIXA de paths
candidatos (`specs/<slug>/spec.md|plan.md|tasks.md|research.md|data-model.md`,
`specs/<slug>/contracts/`, `specs/<slug>/e2e.md`, `lessons.md`,
`docs/processos/**` só como diretório-alvo, não recursão livre, `.html`
commitados apontados pelo próprio manifesto). "Lista aberta" (CA-10) = a lista
de candidatos é uma constante versionada no código, cresce por PR, nunca por
descoberta em runtime.

## Tabela de defaults (CA-4/C6) — config editável

```ts
// src/shared/devModeDefaults.ts
export const DEFAULT_PHASE_DEFAULTS: PhaseDefaultsTable = {
  discovery:   { model: 'fable', effort: 'high', commandTemplate: '/esteira-discovery {card_id}', opensOwnSession: true },
  plano:       { model: 'opus',  effort: 'high', commandTemplate: '/esteira-plano {card_id}',      opensOwnSession: true },
  implementar: { model: 'opus',  effort: 'high', commandTemplate: '/esteira-implementar {card_id} ultracode', opensOwnSession: true },
  validar:     { model: 'sonnet', effort: 'high', commandTemplate: '/esteira-validar {card_id}',   opensOwnSession: true },
  concluir:    { model: 'haiku', effort: 'low',  commandTemplate: '/esteira-concluir {card_id}',    opensOwnSession: false },
};

export function resolveCommandText(entry: PhaseDefault, cardId: string): string {
  return entry.commandTemplate.replace('{card_id}', cardId);
}
```

Editável em runtime (`devMode:setDefaults`, persistido em `AppConfig.devMode.
phaseDefaults`) — é o que permite trocar o `fable` de `discovery` por outro
modelo num dia de cota apertada sem tocar em código (nota da spec no C6). O
texto exato do `implementar` já nasce com `ultracode`; nenhuma lógica de app
decide isso em runtime — é dado, não código.

## O caminho do pré-digitar (CA-3) — o gesto central

1. `openPhaseSession(phase, discovery, marcoId, defaults)` (novo,
   `src/renderer/src/DevMode/openPhaseSession.ts`, função de orquestração com
   um núcleo puro testável — `resolveCommandText` acima + a decisão de
   `opensOwnSession`):
   - **Fase normal** (`opensOwnSession: true`): chama `window.donel.pty.create`
     com `sessionType: 'claude'`, `cwd` = `repoPath` (ou `worktree_path` do
     `ctx.md`/manifesto quando existir — a Esteira roda em worktree própria
     por card), `args` de `buildClaudeArgs({ model, effort })`. Isto é
     **reuso puro** de `commandBuilder.ts:43-78`.
   - **Fase `concluir`** (`opensOwnSession: false`, C6): **não** cria PTY —
     resolve o `ptyId` da aba **em foco no momento** e pré-digita nela. É a
     única exceção ao "uma sessão por etapa" (C6, achado direto da tabela).
   - **Retomada de fase concluída** (CA-9): usa
     `continuation: { type: 'resume', sessionId: archived.sessionId }` —
     reuso de `SessionContinuation` (`commandBuilder.ts:30-33`), sem PTY novo
     conceito.
2. **Quando digitar:** espera o **semáforo** (`semaphore.onUpdate`, canal já
   existente, `SemaphoreState`) entrar em `'waiting'` pela primeira vez depois
   do `create` — é o sinal de que o CLI terminou de subir e está pronto para
   input. **Nenhum mecanismo novo de "pronto"**: reuso do que o T009 já
   calcula. (Alternativa descartada: delay fixo — frágil e não medido; ver
   Riscos.)
3. **O disparo:** `window.donel.pty.input(ptyId, commandText)` — **sem**
   concatenar `\r`/`\n`. É literalmente o canal do achado 8
   (`preload/index.ts:44-46` → `main/index.ts:326-328`), hoje só chamado pelo
   xterm em resposta a digitação humana. Nada no app chama
   `ptyManager.input` com um `\n` embutido em lugar nenhum — é a superfície
   auditada pelo invariante 2.
4. **CA-16 (retomada por estado):** fase **falhou** → passo 1 de novo com o
   mesmo `commandTemplate`. Fase **travada** → dois pré-digitares em
   sequência, **cada um com seu próprio Enter humano**: primeiro
   `/esteira-liberar {card_id}` na mesma sessão; a app espera o semáforo
   voltar a `'waiting'` (fim do `esteira-liberar`) e SÓ ENTÃO pré-digita o
   comando da fase — nunca envia os dois de uma vez, nunca envia Enter por
   quem for.

## Riscos técnicos e mitigação

| Risco | Mitigação |
|---|---|
| Pré-digitar cedo demais (CLI ainda não aceitando stdin) | Reusa o sinal de semáforo `'waiting'` (já calculado, já testado no T009) — não é heurística nova de tempo |
| CA-16 travada: pré-digitar o 2º comando antes do 1º terminar | Sequenciamento pelo mesmo sinal de semáforo; se não voltar a `'waiting'` num teto (medido, não estimado), o app para no 1º passo e deixa a retomada manual — nunca força o 2º |
| Manifesto ilegível (C4) | `esteira-reader.ts` nunca lança; `resultUnreadable: true` vira marcador discreto no nó, nunca crash/tela vazia |
| Alguém "otimizar" o CA-3 concatenando `\r` | Auditoria: `pty.input` só é chamado a partir de `openPhaseSession.ts` e do xterm; nenhum outro ponto do código pode chamar `PTY_CHANNELS.input` (grep no CI/review, não em runtime) |
| Trava (CA-5) sem dado até a Fatia 2 | Documentado acima ("Nota — CA-5") — o slot existe vazio, não é bug, é a ordem das fatias |
| Token do board (Fatia 2) vazar em repo/log | Credencial de serviço fora do repo, mesmo padrão do `~/.claude/esteira-config/` (fora do versionamento); nunca logada |
| Árvore custar RAM/tempo num app que já está no teto (C1/C2) | Medição própria obrigatória (ver Estratégia de teste), cerca de regressão em ~2× o pior caso medido — nunca estimativa |
| `devMode` esquecido em um dos 4 pontos do ConfigStore | Mesma lição já paga pela 007 (T704): checklist explícito na task, teste de round-trip com config legado sem a chave |
| Board mudar de coluna enquanto a árvore está aberta (Fatia 2) | Aceito por CA-5/CA-13 — a UI avisa "segundos atrasado", nunca bloqueia; Validar nunca move coluna, então essa divergência específica nunca alarma |
| Fase `concluir` digitar no terminal errado (não é o "em foco") | `opensOwnSession: false` resolve explicitamente a aba em foco no momento do clique, nunca a última aberta nem uma escolhida por heurística |

## Estratégia de teste

**Unitário (vitest, TDD — onde a feature se decide):**
- `phaseState.ts` — os 5 estados do CA-15, tabela completa + caso
  `resultUnreadable` (C4).
- `esteira-reader.ts` — ctx sem result, result malformado (nunca lança),
  `fanout_cards` ausente → `[]`.
- `discovery-tree.ts` — montagem com N marcos, `allMarcosComplete` (CA-23),
  pool de artefatos (CA-10) só confere a lista fixa.
- `devMode.ts`/`devModeDefaults.ts` — sanitização entrada a entrada, resolução
  do texto do comando (`{card_id}` substituído), `implementar` contém
  `ultracode`, `concluir` tem `opensOwnSession: false`.
- `config-store.ts` — round-trip da chave `devMode` nos 4 pontos, config
  legado sem a chave, entrada malformada isolada.
- `openPhaseSession.ts` (núcleo puro) — decide `create` vs. `resume` vs.
  "usar aba em foco" sem depender de Electron; sequenciamento do CA-16
  (2 comandos, 2 esperas) como máquina de estados pura.
- `boardAnnotation.ts` (Fatia 2) — mapeamento dos 4 fatos + detecção de
  divergência, com fixtures de card mockado.

**Smoke (Playwright, `tests/smoke/`, isolado de `%APPDATA%` real):**
- Fatia 1: fluxo completo Zona 1→2→3 com fixture de `.esteira/` e board
  mockado — abrir discovery, ver árvore, clicar numa fase e **assertar o texto
  exato escrito no PTY e a ausência de `\r`** (é o teste mais importante da
  feature), fase falhou/travada retomando certo, clique numa concluída
  reabrindo a sessão arquivada, alternar Modo Dev preservando a tela de hoje.
- Fatia 2: overlay dos 4 fatos, marcador de divergência, sessão de
  conciliação pré-digitada.
- **UI pura de forma** (cores, ícones, densidade) não tem teste nesta fase —
  isso é a sessão de design (CA-24); os smokes verificam **alcance**
  (o dado certo aparece, o clique certo dispara a ação certa), nunca pixel.

**Medição (C1/C2, obrigatória, nunca estimada):**
- RAM: delta de ligar o Modo Dev com um discovery de ~3 marcos sobre o modo
  Uso geral — alvo `+50 MB`, vira cerca de regressão em ~2× o medido.
- Montagem da árvore: `< 200 ms` para até 5 marcos partindo dos manifestos em
  disco — mesmo método de `medicao-ca7.md` (007): polling apertado, não
  `expect().toPass`.
- Cada número ganha seu `medicao-*.md` no diretório desta spec.

## O que NÃO entra (resumo da spec, para o plano não vazar escopo)

- Escrita do app no board (mover coluna, vincular PR) — v1 é espelho
  somente-leitura.
- Migrar a ownership dos fatos de esteira para o app.
- Aposentar a tela atual do Donel Dev.
- Visão de portfólio de todos os cards ativos (é Mission Control).
- Trabalho sem card do board, incluindo o próprio `donel-dev` (achado 13).
- Resolver a aparência (cor, ícone, layout, densidade) — é a sessão de design
  (CA-24/25/26); as tasks de UI deste plano são de **alcance**, nunca de forma.
- Operação offline.
- Reconhecer skill parseando o transcript além do que `transcript-watcher.ts`
  já extrai (`customTitle`/`contextTokens`) — nenhuma leitura nova de `.jsonl`
  nesta feature.
- Zero código novo em `preflight.py`/`gate_concluir.py` — nada neste plano os
  toca, direta ou indiretamente.
