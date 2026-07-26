# Plano técnico — 007 Favoritos com sessões recentes na sidebar

Referência: `spec.md` e `discovery.md` deste diretório (CA-1..CA-11, decisões
D1–D9 do discovery e C1–C6 do clarify, todas de 2026-07-25). Paths relativos a
`C:/Users/xansd/seazone/donel-dev`. Branch: `feature/mvp-p0`.

**Princípio que atravessa o plano:** a **fonte de verdade da lista é o registro
do app**, não o disco (D9). Todo caminho que leia `~/.claude` neste plano é
exceção nomeada — a semeadura única do CA-8 — e nunca roda no boot.

## Arquitetura em uma tela

```
   RENDERER (único escritor do registro)
     abrir aba claude ─┐
     renomear sessão ──┼─► registerSessionVisit(sessionId, projectPath, label)
     transcript mudou ─┘        │  (debounce ~10 s; label = resolveSessionName)
     fixar/desfixar ──────────► setSessionPinned(sessionId, pinned)
                                │
   MAIN   ipcMain: sessions:registerVisit / sessions:setPinned
                                │
          config-store.ts  chave nova `sessionRegistry`
            (4 pontos do padrão do arquivo — igual à 004)
                                │  poda pura ao escrever
   SHARED src/shared/sessionRegistry.ts        ← Fatia 0 (puro, TDD)
            upsertVisit · setPinned · pruneProject · selectProjectSessions
                                │
   RENDERER  AppConfigDto.sessionRegistry ──► FavoriteSessions (sidebar, topo)
                                              ├─ cabeçalho: pior estado vivo
                                              └─ linhas: nome + pin + clique
```

Duas peças puras (registro + seleção) que decidem tudo o que pode dar errado, e
uma casca de UI. Nenhum mecanismo novo de I/O: reusa `ConfigStore` (escrita
atômica), `sessions:list` (só na semeadura) e o `transcript-watcher` que já
existe.

## Fatia 0 — Registro: modelo e regras (puro, entregável sozinho)

**Arquivo novo:** `src/shared/sessionRegistry.ts` · **Testes:**
`tests/sessionRegistry.test.ts` (TDD — teste antes do código)

```ts
export interface RegisteredSession {
  readonly sessionId: string;
  readonly projectPath: string;
  /** Rótulo em cache (C1) — o nome resolvido no momento da última visita. */
  readonly label: string;
  readonly lastActivityAt: number;
  readonly pinned: boolean;
}
export type SessionRegistry = Readonly<Record<string, RegisteredSession>>;

export const RECENT_PER_PROJECT = 5;

export function upsertVisit(registry, visit: { sessionId; projectPath; label; atMs }): SessionRegistry;
export function setPinned(registry, sessionId: string, pinned: boolean): SessionRegistry;
export function removeSession(registry, sessionId: string): SessionRegistry;
export function pruneProject(registry, projectPath: string): SessionRegistry;
export function selectProjectSessions(registry, projectPath: string): RegisteredSession[];
export function selectRegisteredIds(registry, projectPaths: readonly string[]): ReadonlySet<string>;
```

Regras duras:

1. **Poda na ESCRITA, não na leitura** (`pruneProject`, chamado por
   `upsertVisit`): por projeto, mantém as **5 não-fixadas mais recentes** +
   **todas as fixadas** (CA-2, sem teto — C4). É isso que mantém o
   `config.json` pequeno sem precisar de GC depois.
2. `upsertVisit` de sessão **já fixada** preserva `pinned: true` — visita não
   desfixa nada.
3. `setPinned(…, false)` **não remove** a entrada: ela volta a concorrer pelas 5
   vagas por recência (CA-5) e só sai na próxima poda se for velha.
4. `selectProjectSessions` devolve a **união** (5 recentes + fixadas) ordenada
   por `lastActivityAt` **desc**, com as fixadas marcadas — ordem única, para o
   grupo não inventar uma segunda ordenação.
5. `selectRegisteredIds` existe para o **dedupe do CA-3**: dá ao renderer o
   conjunto de `sessionId` que já aparecem em algum grupo, sem ele recalcular a
   regra.
6. Nada aqui conhece `fs`, Electron ou React.

**Testes (DoD):** 6ª visita empurra a mais antiga não-fixada; fixada NUNCA é
podada, mesmo com 10 visitas novas; desfixar volta a concorrer; visita em sessão
fixada mantém o pin; `selectProjectSessions` ordena por atividade desc e inclui
fixada fora das 5; projeto sem nada → `[]`; registro de OUTRO projeto não
interfere.

## Fatia 1 — Persistência: `sessionRegistry` no ConfigStore

**Arquivos:** `src/main/config-store.ts`, `src/shared/config.ts`

Chave nova `sessionRegistry: SessionRegistry`, tocando os **quatro** pontos do
padrão do arquivo — senão ela é silenciosamente descartada na leitura (foi
exatamente a armadilha da 004/T402): `AppConfig` (`:59-68`), `defaultAppConfig`
(`:72`), `sanitizeAppConfig` (campo a campo, **entrada a entrada**, nunca lança)
e `toAppConfigDto` + `AppConfigDto` (o renderer é quem desenha).
`CONFIG_SCHEMA_VERSION` **não** sobe (config legado sem a chave carrega com `{}`).

`sanitizeSessionRegistry` descarta entrada a entrada o que estiver malformado
(sem `projectPath`, `label` vazio, `lastActivityAt` não-numérico) preservando as
boas — mesmo espírito de `sanitizeSessionNames`.

**Testes:** `tests/config-store.test.ts` estendido — round-trip em disco
(tmpdir, **nunca** o `%APPDATA%` real), config legado sem a chave → `{}` sem
perder `favorites`/`sessionNames`, entrada malformada descartada isolada.

## Fatia 2 — IPC: dois canais de escrita e nada de polling

**Arquivos:** `src/shared/sessions.ts`, `src/main/index.ts`,
`src/preload/index.ts`

- `sessions:registerVisit(sessionId, projectPath, label)` — upsert + poda +
  `persistAppConfig()`; devolve `AppConfigDto` (padrão dos `config:set*` e do
  `sessions:setName` da 004).
- `sessions:setPinned(sessionId, pinned)` — idem.
- `sessions:seedProject(projectPath)` — **a exceção do CA-8**: só é chamado
  quando o projeto não tem NENHUMA entrada; roda `indexProjectSessions`
  (uma vez), converte as 5 mais recentes em visitas com o rótulo resolvido e
  devolve o config novo. O main valida o pedido: se o projeto já tem entrada,
  **não** lê disco (guarda contra o renderer chamar por engano em loop).
- **Remoção de órfã (CA-11):** no `seedProject`, entradas daquele projeto sem
  arquivo correspondente saem; e no caminho de retomar, quando o
  `PTY_CHANNELS.create` falha para um `-r <id>`, o renderer chama
  `sessions:setPinned`… **não** — chama um `sessions:forget(sessionId)` dedicado
  (3ª e última escrita), para não misturar "desfixar" com "esquecer".

**Quem escreve o registro é só o renderer.** O main tem o watcher e poderia
escrever sozinho, mas aí seriam dois escritores do mesmo mapa e o rótulo
(`resolveSessionName`, que depende de `sessionNames` + fallback do projeto) teria
de ser recalculado no main — duas fontes da mesma regra. Um escritor só, com o
main validando o payload.

**Testes:** unit da validação de payload (sessionId/projectPath vazios são
no-op); o resto é coberto pelos smokes da Fatia 4.

## Fatia 3 — Renderer: manter o registro em dia, sem enxurrada de escrita

**Arquivo:** `src/renderer/src/App.tsx`

Três gatilhos de visita, todos já existentes no código:

1. **aba `claude` nasce** — no `onClaudeSessionIdResolved` (T404/004) já se sabe
   `sessionId` + `cwd` + nome resolvido;
2. **rename** — `handleRenameTab` (004) muda o rótulo;
3. **transcript mudou** — a assinatura única de `onTranscriptChanged` (T412/004,
   compartilhada com a 006) é o "durante o trabalho" do D9.

O gatilho 3 dispara muito (a cada turn). **Debounce de ~10 s por sessão** no
renderer, e escrita só quando `label` ou `projectPath` mudarem, ou quando
passaram >10 s desde a última gravação daquela sessão. Sem isso, um turno longo
escreveria o `config.json` dezenas de vezes por minuto — e o config guarda
favoritos, roots e perfil ativo, então escrita à toa ali é risco desnecessário.

**Testes:** unit puro da decisão de gravar (`shouldRecordVisit(lastWriteMs,
nowMs, prev, next)`) — mesma sessão em <10 s sem mudança de rótulo → não grava;
rótulo mudou → grava na hora; sessão diferente → grava.

## Fatia 4 — UI: o grupo no topo da sidebar

**Arquivos:** `src/renderer/src/ProjectSidebar.tsx` (+ `.module.css`),
`src/renderer/src/App.tsx`

- **Seção nova ANTES de "Projetos"** (C5; hoje a ordem é Projetos `:158` →
  Sessões `:235`). Título: **"Favoritos"**.
- Uma linha por projeto favoritado (`projects.filter(p => p.favorite)`),
  colapsável. Estado de colapso persistido — mesma chave nova, campo
  `collapsedFavorites: string[]` no `AppConfigDto`, ou `expanded` por projeto:
  decidir na implementação, mas **persistir** (CA-1).
- **Cabeçalho (CA-6):** nome do projeto + `StateDot` do **pior estado entre as
  abas VIVAS daquele projeto** + contagem. O pior estado sai da mesma tabela de
  precedência de `sessionOrdering.ts` (`permission > error > waiting > working >
  done`) — **reusar**, não escrever uma segunda ordem. Sem abas vivas, sem dot.
- **Linhas:** `EditableLabel`? **Não** — renomear pelo grupo está fora de escopo;
  a linha é texto + botão de pin. Rótulo = `registry.label` (cache do CA-7),
  substituído pelo `resolveSessionName` ao vivo quando a sessão tem aba aberta
  (aí o dado fresco existe de graça).
- **Clique (CA-4):** se existe aba com `claudeSessionId === sessionId` → foca;
  senão → mesmo caminho de `handleResumeSession` (`-r <id>`).
- **Dedupe (CA-3):** `sidebarSessions` passa a filtrar quem está em
  `selectRegisteredIds(...)` dos projetos favoritados. **O CA-6 é o que paga o
  preço disso** — sem o dot no cabeçalho, uma sessão em `permission` sumiria da
  vista (é o conflito nº 1 do discovery).
- **Pin (C2):** o botão de pin da linha da sidebar passa a chamar
  `sessions:setPinned` (persistente) **e** o `pinned` do `TabState` continua
  alimentando `sortSessions` para a aba viva — a UI expõe **um** gesto, os dois
  efeitos saem dele.
- **Semeadura (CA-8):** ao expandir um projeto favoritado que não tem nenhuma
  entrada, chamar `sessions:seedProject` uma vez, com estado de "carregando" na
  linha (é a única espera visível da feature).

**Testes:** smoke novo `tests/smoke/favorite-sessions.spec.ts`, isolado do
`%APPDATA%` real (`userDataIsolation.ts`) e com fixture de transcript — **nunca**
abrindo sessão claude real só para popular o grupo (padrão da rodada 5 e o que
deixou os smokes da 004 em ~6 s).

## Fatia 5 — Medição do CA-7

Medir e **registrar o número** em `medicao-ca7.md`: tempo entre o
`domcontentloaded` e a sidebar pintada com o grupo, com o registro cheio (5
favoritos × 5 sessões + fixadas). Alvo **< 100 ms**. Medir com polling apertado,
não com `expect().toPass` (lição da 004: o amostrador do Playwright reportou
852 ms para algo que levava ~350 ms).

## Ordem de entrega

```
Fatia 0 (puro) ──► Fatia 1 (config) ──► Fatia 2 (IPC) ──► Fatia 3 (gatilhos)
                                                             │
                                                             ▼
                                                        Fatia 4 (UI) ──► Fatia 5 (medição)
```

- Batch A = Fatias 0+1+2 (invisível; fecha com typecheck + unit verdes, sem
  empacotar).
- Batch B = Fatias 3+4+5 (o que ele vê; fecha com suíte completa + build + dist
  + roteiro E2E).

## Riscos

| Risco | Mitigação |
|---|---|
| Escrita do `config.json` a cada turn | Fatia 3: debounce de 10 s + gravar só quando algo mudou, com teste puro da decisão |
| Dedupe esconder sessão em `permission` | CA-6 (dot no cabeçalho) reusando a precedência de `sessionOrdering.ts` |
| Registro divergir do disco | Aceito por decisão (C1/C6); CA-11 remove órfã na semeadura e na falha de retomada |
| Fixada desaparecer sem aviso (C3) | Decisão dele, registrada na spec — não "consertar" achando que é bug |
| Reintroduzir I/O no boot sem perceber | CA-7 com medição obrigatória (Fatia 5) |
| Dois escritores do registro | Fatia 2: só o renderer escreve; o main valida |
| Chave nova descartada em silêncio | Fatia 1: os quatro pontos do `config-store.ts`, com teste de config legado |
| Colisão com a 006 | Nenhuma: a 006 mexe em `contextWindow`/`SessionDetails`; esta mexe em sidebar/registro. Só `App.tsx` é compartilhado — **rebase antes de começar** |

## Fora deste plano

Restaurar sessões no boot (D1/D7 — cancelado); fork no grupo; renomear pelo
grupo (é a 004); busca no grupo; `%` de contexto na linha (é a 006); GC geral do
`config.json` (§B12).
