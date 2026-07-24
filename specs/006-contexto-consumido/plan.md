# Plano técnico — 006 Contexto consumido

Referência: `spec.md` deste diretório (CA-1..CA-8 + decisões S1/C1/C3/C4/C5
resolvidas no clarify de 2026-07-24). Todos os paths relativos a
`C:/Users/xansd/seazone/donel-dev`. Branch: `feature/mvp-p0` (mesma; tudo
local, sem push).

**Gate:** nada aqui foi implementado. Aguarda OK do Alexandre.

## Arquitetura em uma tela

> ⚠️ **A 004 já está planejada e commitada** (`fc65258`) e a Fatia 3 dela
> constrói o watcher em `src/main/session-name-watcher.ts`, com decisões que a
> 006 **herda em vez de contradizer**: watch em **todas as abas `claude`
> vivas** (não só a em foco — a razão dada lá é "trocou de aba e o nome não
> seguiu"), **debounce ~300 ms**, e ciclo de vida amarrado ao
> `PTY_CHANNELS.create` / `PtyManager.onExit` (a fonte de verdade de morte do
> processo). Isso serve melhor a 006 também: uma aba em background continua com
> o `%` correto. O trabalho da 006 na Fatia 1 é **generalizar** aquele watcher
> (nome → nome + tokens), não criar um segundo.

```
                 ~/.claude/projects/<slug>/<sessionId>.jsonl
                                  │  (o CLI escreve)
                                  ▼
   MAIN   src/main/transcript-watcher.ts        ← Fatia 1
          (= o session-name-watcher.ts da 004, generalizado)
          fs.watch de CADA aba claude VIVA (ciclo de vida do PTY)
            → debounce ~300ms
            → readTranscriptTail(8KB)          (uma leitura, dois consumidores)
            → { sessionId, contextTokens, customTitle }
            → webContents.send('transcript:changed', {...})
                                  │
   PRELOAD src/preload/index.ts  onTranscriptChanged(cb)
                                  │
   RENDER  App.tsx: contextTokens por sessionId → tabId (useState)
            └─► SessionDetails ── computeContextPercent(tokens, model) ──┐
                                                                        │
          src/shared/contextWindow.ts  MODEL_CONTEXT_WINDOWS  ──────────┘
                                       (Fatia 0 — puro, TDD)
```

Duas peças puras (testáveis sem Electron) + uma peça de I/O + UI. A parte que
**não pode estar errada** (a tabela de janelas e a aritmética) é 100% pura.

---

## Fatia 0 — Núcleo puro: janelas + cálculo do % (entregável sozinho)

**Arquivo novo:** `src/shared/contextWindow.ts`
**Testes:** `tests/contextWindow.test.ts` (TDD — teste antes do código)

Módulo isolado, sem dependência de Electron, fs ou React. É a única coisa que
precisa ser revisitada quando a Anthropic mudar janelas.

```ts
/**
 * Tabela modelo → janela de contexto (max_input_tokens).
 * CONFERIDA na skill `claude-api` em 2026-07-24 — não editar de memória.
 * Ver spec.md §"[S1/C2] Tabela ... FIXADA" para a proveniência.
 */
export const MODEL_CONTEXT_WINDOWS: Record<ModelAlias, number> = {
  fable: 1_000_000,   // claude-fable-5
  opus: 1_000_000,    // claude-opus-5
  sonnet: 1_000_000,  // claude-sonnet-5
  haiku: 200_000,     // claude-haiku-4-5
};

/** Soma que representa o tamanho do contexto no turn (CA-2 / C1). */
export function contextTokensFromUsage(usage: unknown): number | null;

/** % 0–100 arredondado, ou null quando não há como calcular (CA-4). */
export function computeContextPercent(
  tokens: number | null,
  model: ModelAlias,
): number | null;

/** Normaliza sufixos de deployment (`[1m]`, etc.) → ModelAlias. */
export function normalizeModelAlias(raw: string): ModelAlias | null;
```

**Regras duras a implementar:**

1. `contextTokensFromUsage` soma `input_tokens + cache_read_input_tokens +
   cache_creation_input_tokens`. Campo ausente conta como 0; **usage sem
   nenhum dos três** → `null` (não 0). `output_tokens` **não** entra (é
   geração, não contexto de entrada).
2. `computeContextPercent(null, _)` → `null` (CA-4). Nunca 0.
3. **Clamp 0–100** (CA-8): `Math.min(100, Math.max(0, Math.round(...)))`.
4. `normalizeModelAlias('sonnet[1m]')` → `'sonnet'`; alias desconhecido →
   `null` (o chamador exibe `—`, não escolhe uma janela chutada).

**Testes (DoD):** vitest verde com a usage real da spec (290 + 1505 + 132807 =
134.602 → 13% em opus, 67% em haiku); usage vazia → null; usage parcial (só
`input_tokens`) → soma parcial; tokens > janela → 100%; alias `[1m]` → 1M;
alias inválido → null. Sem mock nenhum — é função pura.

---

## Fatia 1 — Generalizar o watcher da 004 (peça única compartilhada)

**Arquivo:** `src/main/session-name-watcher.ts` → renomear para
`src/main/transcript-watcher.ts` (a 004 ainda não escreveu código — é só o
plano dela; o rename é barato agora e impossível depois).
**Testes:** `tests/transcriptWatcher.test.ts`

A 004 precisa de `customTitle`, a 006 de `contextTokens`, **do mesmo arquivo,
na mesma cauda, no mesmo evento**. Uma leitura, dois consumidores. As decisões
de escopo (todas as abas vivas), debounce (~300 ms) e ciclo de vida (PTY
create/onExit) são as da 004 — não mexer.

### 1a. Leitura de cauda (puro-ish, testável com arquivo real em tmpdir)

```ts
export interface TranscriptTail {
  /** Soma da última usage; null se nenhuma linha assistant com usage na cauda. */
  readonly contextTokens: number | null;
  /** Último registro `custom-title` da cauda; null se nenhum. (Consumidor: 004.) */
  readonly customTitle: string | null;
}

export async function readTranscriptTail(
  filePath: string,
  size: number,
): Promise<TranscriptTail>;
```

- **Reutiliza a mecânica do `readLastActivity`** (`session-indexer.ts:210-240`):
  `fs.open` + `read` dos últimos `TAIL_READ_BYTES` (8KB), split por linha,
  varredura **de trás para frente**, `try/catch` por linha, `null` em qualquer
  falha, **nunca lança**. Extrair a leitura de cauda para uma helper
  compartilhada em vez de duplicar o bloco — o `readLastActivity` continua
  existindo e passa a usá-la (refactor sem mudança de comportamento).
- Varre de trás para frente e para **assim que tiver os dois campos**
  (`contextTokens` na primeira linha `assistant` com `usage`; `customTitle` no
  primeiro `custom-title` encontrado de baixo para cima = o último do arquivo).
- **Cuidado com a primeira linha do chunk:** a leitura de cauda pode cortar
  uma linha no meio; a linha inicial pode ser JSON inválido — o `try/catch`
  por linha já cobre, mas o teste tem de exercitar esse caso explicitamente.
- **Risco conhecido:** 8KB de cauda podem não conter nenhuma mensagem
  `assistant` (turnos longos com muitos `tool_result` no meio). Mitigação:
  se a varredura de 8KB não achar `usage`, tentar **uma** re-leitura com
  janela maior (64KB) antes de devolver `null`; nunca ler o arquivo inteiro.
  Retentativa única, ainda best-effort.

### 1b. Payload do evento (a única mudança de contrato que a 006 exige)

O watcher, ciclo de vida e debounce vêm da **Fatia 3 da 004** — a 006 não
redesenha nada disso. A mudança é o payload:

```ts
// antes (004 sozinha):   { sessionId, customTitle }
// depois (004 + 006):    { sessionId, customTitle, contextTokens }
export interface TranscriptChangedPayload {
  readonly sessionId: string;
  readonly customTitle: string | null;   // consumidor: 004
  readonly contextTokens: number | null; // consumidor: 006
}
```

- **Sem `focus()`.** O escopo é "todas as abas `claude` vivas" (decisão da
  004): abre no `PTY_CHANNELS.create`, fecha no `PtyManager.onExit`. Uma aba em
  background mantém o `%` correto e a troca de aba não perde nada.
- **Debounce ~300 ms** (o da 004) — latência bem dentro do ≤ ~1 s de CA-3.
- **Um emit por rajada com os dois campos.** A 004 planejava emitir só quando
  o `custom-title` mudasse; com a 006 no mesmo canal isso não serve — o
  `contextTokens` muda a cada turn **sem** `custom-title` novo. Regra nova:
  emitir quando **qualquer** dos dois campos mudar em relação ao último emit
  daquela sessão (comparação por valor, para não spammar o renderer).
- **Leitura imediata na abertura do watch** — aba recém-nascida sem escrita
  ainda mostra `—` (CA-4), e uma aba idle não fica sem número.
- `.jsonl` inexistente na abertura (o CLI cria na 1ª mensagem) já é risco
  mapeado no plano da 004 — herdar a mitigação dela, não inventar outra.
- Canal em `src/shared/` (ao lado de `SESSION_CHANNELS`), handler em
  `src/main/index.ts`, `onTranscriptChanged(cb): () => void` no preload.

**Testes (DoD):** `readTranscriptTail` com fixture `.jsonl` em tmpdir —
assistant com usage no fim → soma correta; várias usages → **a última**;
`custom-title` múltiplo → **o último**; cauda com linha cortada no início →
não lança; arquivo sem usage em 8KB → tenta 64KB; arquivo vazio/ausente →
`{ contextTokens: null, customTitle: null }`. Debounce e a regra "emite se
qualquer campo mudou" testados com timers fake. Sem abrir sessão real de
Claude em teste.

---

## Fatia 2 — Estado no renderer + UI na toolbar

**Arquivos:** `src/renderer/src/App.tsx`,
`src/renderer/src/SessionDetails.tsx` (+ `.module.css`)

- **App.tsx:** `useState<Record<string, number | null>>` mapeando
  `sessionId → contextTokens`. **Uma** assinatura de `onTranscriptChanged` no
  nível do App (não por aba — o watcher já cobre todas as abas vivas), gravando
  pelo `sessionId` do payload. A aba resolve o próprio número pelo `sessionId`
  dela na hora de renderizar. Abas `sessionType: 'shell'` não têm `sessionId`
  de Claude → `contextPercent={null}` sempre (CA-4).
  A 004 vai assinar o **mesmo** evento para o `customTitle` — se ela entrar
  primeiro, reaproveitar a assinatura existente em vez de abrir uma segunda.
  Atenção ao bug histórico do StrictMode: o cleanup da assinatura precisa ser
  idempotente (`mountEpochRef` dos PTYs é o precedente) — o cleanup de uma
  montagem antiga não pode cancelar a assinatura da nova.
- **SessionDetails.tsx:** nova prop **opcional**
  `contextPercent?: number | null` (opcional para não quebrar os smokes que já
  montam o componente). Renderiza depois do hint:

  ```tsx
  <span
    className={styles.context}
    data-testid="session-context"
    title={contextTooltip(contextTokens, model)}   // CA-7
  >
    contexto {contextPercent === null ? '—' : `${contextPercent}%`}
  </span>
  ```

  - O `%` sai de `computeContextPercent(tokens, model)` com o `model` **da
    própria prop já existente** — daí CA-6 (troca de modelo) sai de graça: o
    componente re-renderiza no `onSelectModel` e o denominador muda sem nenhum
    estado novo.
  - Tooltip: `134.602 / 1.000.000 tokens · opus` (separador de milhar pt-BR).
  - Rótulo literal **"contexto"** — nunca "cota"/"%" solto (CA-5, lição da
    rodada 6). Sem cor/barra: escopo é só o número.

**Testes (DoD):** teste de componente/render puro do `SessionDetails` com
`contextPercent` = null → `—`; = 13 → `contexto 13%`; tooltip presente.
Smoke roteirizado da toolbar isolado do `%APPDATA%` real, com fixture de
transcript — **nunca** abrindo sessão real só para ler contexto (padrão da
rodada 5).

---

## Ordem de entrega e dependências

```
Fatia 0 (puro) ─────────────┐
                            ├──► Fatia 2 (UI)
Fatia 1 (watcher + IPC) ────┘
```

- Fatia 0 é independente e mergeável sozinha (é só um módulo + testes).
- Fatia 1 é a **peça compartilhada** e a 004 já a especificou (Fatia 3 dela,
  `session-name-watcher.ts`, ainda sem código):
  - **004 antes da 006 (recomendado):** a 004 constrói o watcher; a 006 só
    adiciona `contextTokens` ao payload e a regra "emite se qualquer campo
    mudou". Fatia 1 encolhe para ~1 task.
  - **006 antes da 004:** a 006 constrói o watcher **já com os dois campos** e
    a 004 depois só consome `customTitle`.
  - **Nunca dois watchers.** Se a implementação da 004 já tiver começado, a
    006 estende o arquivo dela em vez de criar `transcript-watcher.ts` novo.
- Fatia 2 só fecha com as duas anteriores verdes.

## Fora deste plano (não implementar)

- Barra visual/gradiente, cor por faixa, "smart zone" — é o US-8 completo (003).
- Consultar `GET /v1/models` em runtime para `max_input_tokens` (o app não tem
  chave de API; tabela codificada é a decisão).
- Histórico do consumo, custo em $, contagem de mensagens, distância até o
  auto-compact.
- Renomear/persistir nome de sessão — é a 004, mesmo watcher, outra spec.
