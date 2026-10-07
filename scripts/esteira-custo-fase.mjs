#!/usr/bin/env node
// E6 — custo médio por fase da Esteira.
//
// Cruza o store local da Esteira (`session.started`/`session.claimed`, que dá
// a fase de cada sessão e o `cliSessionId` que o CLI devolveu) com os
// transcripts do CLI (`~/.claude/projects/<slug>/*.jsonl`, campo `usage` por
// mensagem), e agrega por fase: sessões, chamadas, tokens de custo e duração.
//
// A métrica que importa é OUTPUT TOKENS + CACHE WRITE — nunca o total
// processado. 96,6% do input típico de uma sessão é cache READ (contexto já
// existente, reaproveitado a uma fração do preço); somar isso mediria o
// quanto a sessão LEU, não o quanto ela CUSTOU. Cache write é o oposto: é o
// preço de RECONSTRUIR contexto do zero quando uma sessão nova começa fria —
// e é exatamente esse número que decide se vale fundir fases.
//
// Script standalone de propósito — roda via `node scripts/esteira-custo-fase.mjs`
// puro, sem Electron, sem dependência nova, sem build TS. Por isso é `.mjs`
// plano em vez de TypeScript: importar isto de dentro de `src/` ou testá-lo
// com um `tests/*.test.ts` puxaria o arquivo para o grafo do `tsc` sem uma
// declaração de tipos — o teste correspondente é
// `tests/esteira-custo-fase.test.mjs` (fora do grafo do typecheck de propósito;
// ver `vitest.config.ts`).
//
// Invariantes duras:
//   - SÓ LEITURA. Nunca escreve no store (`events.jsonl`/`snapshot.json`) nem
//     em nenhum transcript — a única escrita deste script é o relatório em
//     `docs/custo-por-fase.md`.
//   - Transcript NUNCA é lido inteiro em memória: streaming linha a linha
//     (`readline` sobre `createReadStream`), o mesmo padrão de
//     `src/main/session-indexer.ts`.
//   - Nenhum nome de cliente/proprietário/pessoa sai daqui (LGPD) — a saída é
//     só contagem, tokens e minutos por fase; `cliSessionId`/`cwd` nunca vão
//     para o relatório gerado.
//
// Duplicação deliberada (não importável de `src/` sem sair do "sem build TS"
// acima — mantenha em sincronia se a fonte mudar):
//   - `slugifyProjectPath`      ~ src/main/session-indexer.ts
//   - `STORE_DIR_NAME`/`STORE_EVENTS_FILE`/`ESTEIRA_STORE_DIR_ENV_VAR`
//                               ~ src/shared/esteira/store/storeFormat.ts,
//                                 src/main/esteira-store.ts
//   - nomes de fase (`PHASE_ORDER`) ~ skills/esteira-donel-3.0.0/skills/esteira-*

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Nome do app no `userData` do Electron (`app.setName('donel-dev')`, src/main/index.ts). */
export const APP_USERDATA_NAME = 'donel-dev';
/** ~ src/shared/esteira/store/storeFormat.ts */
export const STORE_DIR_NAME = 'esteira';
export const STORE_EVENTS_FILE = 'events.jsonl';
/** ~ src/main/esteira-store.ts — mesma variável que o app real honra. */
export const ESTEIRA_STORE_DIR_ENV_VAR = 'DONEL_ESTEIRA_STORE_DIR';
/** Override só deste script, para apontar `~/.claude` alternativo sem tocar no real. */
export const CLAUDE_HOME_ENV_VAR = 'ESTEIRA_CUSTO_CLAUDE_HOME';

/** Ordem canônica de fase — nomes das skills em skills/esteira-donel-3.0.0/skills/. */
export const PHASE_ORDER = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'concluir'];

const NPM_SCRIPT_NAME = 'esteira:custo';

// ---------------------------------------------------------------------------
// Estatística pura
// ---------------------------------------------------------------------------

function sum(numbers) {
  return numbers.reduce((a, b) => a + b, 0);
}

/** Média, mediana, min/max e soma de uma lista de números. Nunca muta o input. */
export function statsOf(numbers) {
  const n = numbers.length;
  if (n === 0) return { count: 0, sum: 0, mean: null, median: null, min: null, max: null };

  const sorted = [...numbers].sort((a, b) => a - b);
  const total = sum(numbers);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return { count: n, sum: total, mean: total / n, median, min: sorted[0], max: sorted[n - 1] };
}

// ---------------------------------------------------------------------------
// Resolução de paths (store da Esteira + home do CLI)
// ---------------------------------------------------------------------------

/**
 * Slug real observado em `~/.claude/projects/`: todo caractere não-alfanumérico
 * do path absoluto vira `-`, um por um, sem colapsar repetições. Cópia
 * deliberada de `slugifyProjectPath` em `src/main/session-indexer.ts` — ver
 * nota de duplicação no topo do arquivo.
 */
export function slugifyProjectPath(absoluteProjectPath) {
  return absoluteProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Reproduz a convenção do `app.getPath('userData')` do Electron por plataforma. */
export function defaultElectronUserDataDir({ platform, env, homedir: home }) {
  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.trim() ? env.APPDATA : join(home, 'AppData', 'Roaming');
    return join(appData, APP_USERDATA_NAME);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', APP_USERDATA_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(xdg, APP_USERDATA_NAME);
}

/** `<userData>/esteira/events.jsonl`, honrando o mesmo override que o app real usa. */
export function resolveEsteiraStoreEventsPath({ platform, env, homedir: home }) {
  const override = env[ESTEIRA_STORE_DIR_ENV_VAR];
  const storeDir = override && override.trim() ? override : join(defaultElectronUserDataDir({ platform, env, homedir: home }), STORE_DIR_NAME);
  return join(storeDir, STORE_EVENTS_FILE);
}

/** `~/.claude`, com override próprio deste script (nunca aponta pro real sem pedir). */
export function resolveClaudeProjectsHome({ env, homedir: home }) {
  const override = env[CLAUDE_HOME_ENV_VAR];
  return override && override.trim() ? override : join(home, '.claude');
}

/** `<claudeHome>/projects/<slug(cwd)>/<cliSessionId>.jsonl` — só arquivos de raiz, nunca `subagents/`. */
export function resolveTranscriptPath({ claudeHome, cwd, cliSessionId }) {
  return join(claudeHome, 'projects', slugifyProjectPath(cwd), `${cliSessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Parsing de UMA linha — puro, nunca lança, nunca lê o resto do arquivo
// ---------------------------------------------------------------------------

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTimestampMs(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function strOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Uma linha de transcript → `{ timestampMs, usage }`, ou `null` se a linha
 * não for um registro legível. `usage` só é não-nulo para uma mensagem
 * `assistant` NÃO-sidechain com `message.usage` — o resto da conversa
 * (system/user/subagent) ainda contribui `timestampMs` para o cálculo de
 * duração, mas não conta tokens.
 *
 * Usa os campos de TOPO de `usage` (`output_tokens`,
 * `cache_creation_input_tokens`) — já são os totais da mensagem; somar
 * também `usage.iterations[]` duplicaria a conta.
 */
export function parseTranscriptLine(rawLine) {
  const line = typeof rawLine === 'string' ? rawLine.trim() : '';
  if (line.length === 0) return null;

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  const timestampMs = parseTimestampMs(obj.timestamp);

  const message = obj.message;
  const usageRaw =
    obj.type === 'assistant' && obj.isSidechain !== true && typeof message === 'object' && message !== null
      ? message.usage
      : undefined;

  if (typeof usageRaw !== 'object' || usageRaw === null) {
    return { timestampMs, usage: null };
  }

  return {
    timestampMs,
    usage: {
      outputTokens: numberOr(usageRaw.output_tokens, 0),
      cacheWriteTokens: numberOr(usageRaw.cache_creation_input_tokens, 0),
    },
  };
}

/**
 * Uma linha de `events.jsonl` → fato mínimo sobre uma sessão, ou `null`
 * (cabeçalho, evento irrelevante ou linha malformada — "lê o que consegue",
 * mesmo espírito de `storeFormat.parseEventLine`).
 */
export function parseStoreLineForSession(rawLine) {
  const line = typeof rawLine === 'string' ? rawLine.trim() : '';
  if (line.length === 0) return null;

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  if (obj.kind === 'esteira.store.header') return null;

  const type = obj.type;
  const payload = obj.payload;
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) return null;

  if (type === 'session.started') {
    const id = strOrNull(payload.id);
    const phase = strOrNull(payload.phase);
    if (id === null || phase === null) return null;
    return { kind: 'started', id, phase, cwd: strOrNull(payload.cwd), cliSessionId: strOrNull(payload.cliSessionId) };
  }

  if (type === 'session.claimed') {
    const id = strOrNull(payload.id);
    const cliSessionId = strOrNull(payload.cliSessionId);
    if (id === null || cliSessionId === null) return null;
    return { kind: 'claimed', id, cliSessionId };
  }

  return null;
}

// ---------------------------------------------------------------------------
// I/O em streaming — nunca carrega o arquivo inteiro em memória
// ---------------------------------------------------------------------------

/**
 * Sessões ASSUMIDAS (`session.claimed` com `cliSessionId`) que também têm
 * `cwd` — sem `cwd` não dá para resolver o transcript, e a sessão é excluída
 * silenciosamente (o chamador não perde a fase por isso; só não consegue
 * medir custo dela). Arquivo ausente → `[]`, nunca lança (máquina nova).
 */
export async function readClaimedSessionsFromStore(storeEventsPath) {
  if (!existsSync(storeEventsPath)) return [];

  const sessions = new Map();
  const stream = createReadStream(storeEventsPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of rl) {
      const parsed = parseStoreLineForSession(rawLine);
      if (parsed === null) continue;

      if (parsed.kind === 'started') {
        sessions.set(parsed.id, { phase: parsed.phase, cwd: parsed.cwd, cliSessionId: parsed.cliSessionId });
      } else {
        const current = sessions.get(parsed.id);
        if (current !== undefined) sessions.set(parsed.id, { ...current, cliSessionId: parsed.cliSessionId });
      }
    }
  } catch {
    // Erro de leitura a meio (ex.: arquivo trocado por diretório, IO falhou) —
    // "lê o que consegue": devolve o que já foi acumulado até aqui, nunca lança.
  } finally {
    rl.close();
    stream.destroy();
  }

  const result = [];
  for (const session of sessions.values()) {
    if (session.cliSessionId !== null && session.cwd !== null) {
      result.push({ phase: session.phase, cwd: session.cwd, cliSessionId: session.cliSessionId });
    }
  }
  return result;
}

/**
 * Agrega `calls`/`outputTokens`/`cacheWriteTokens`/`durationMinutes` de UM
 * transcript. `durationMinutes` é a janela entre o primeiro e o último
 * `timestamp` válido do arquivo inteiro (não só das linhas com `usage`) —
 * reflete o tempo de parede real da sessão. Arquivo ausente → `null`
 * (sessão assumida cujo transcript sumiu/nunca existiu; o chamador conta
 * isso à parte, nunca lança).
 */
export async function readSessionUsageFromTranscript(transcriptPath) {
  if (!existsSync(transcriptPath)) return null;

  let calls = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let minTs = null;
  let maxTs = null;

  const stream = createReadStream(transcriptPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of rl) {
      const parsed = parseTranscriptLine(rawLine);
      if (parsed === null) continue;

      if (parsed.timestampMs !== null) {
        if (minTs === null || parsed.timestampMs < minTs) minTs = parsed.timestampMs;
        if (maxTs === null || parsed.timestampMs > maxTs) maxTs = parsed.timestampMs;
      }
      if (parsed.usage !== null) {
        calls += 1;
        outputTokens += parsed.usage.outputTokens;
        cacheWriteTokens += parsed.usage.cacheWriteTokens;
      }
    }
  } catch {
    // Mesmo espírito de readClaimedSessionsFromStore: erro de leitura a meio
    // devolve o que já foi somado até aqui em vez de derrubar o script inteiro
    // por causa de UMA sessão.
  } finally {
    rl.close();
    stream.destroy();
  }

  const durationMinutes = minTs !== null && maxTs !== null ? (maxTs - minTs) / 60000 : null;
  return { calls, outputTokens, cacheWriteTokens, durationMinutes };
}

// ---------------------------------------------------------------------------
// Agregação por fase
// ---------------------------------------------------------------------------

function comparePhase(a, b) {
  const ia = PHASE_ORDER.indexOf(a.phase);
  const ib = PHASE_ORDER.indexOf(b.phase);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.phase.localeCompare(b.phase);
}

/**
 * `sessionUsages`: `{ phase, calls, outputTokens, cacheWriteTokens, durationMinutes }[]`
 * (uma entrada por sessão assumida com transcript encontrado) → uma linha de
 * estatística por fase, ordenada por `PHASE_ORDER`.
 */
export function buildPhaseStatsRows(sessionUsages) {
  const byPhase = new Map();
  for (const s of sessionUsages) {
    const list = byPhase.get(s.phase);
    if (list) list.push(s);
    else byPhase.set(s.phase, [s]);
  }

  const rows = [];
  for (const [phase, sessions] of byPhase) {
    const combined = sessions.map((s) => s.outputTokens + s.cacheWriteTokens);
    const output = sessions.map((s) => s.outputTokens);
    const cacheWrite = sessions.map((s) => s.cacheWriteTokens);
    const calls = sessions.map((s) => s.calls);
    const durations = sessions.map((s) => s.durationMinutes).filter((d) => d !== null && d !== undefined);

    rows.push({
      phase,
      sessionCount: sessions.length,
      totalCalls: sum(calls),
      combined: statsOf(combined),
      output: statsOf(output),
      cacheWrite: statsOf(cacheWrite),
      duration: statsOf(durations),
    });
  }

  rows.sort(comparePhase);
  return rows;
}

// ---------------------------------------------------------------------------
// Formatação — markdown em pt-BR (mesmo estilo numérico do baseline da etapa 3)
// ---------------------------------------------------------------------------

const NO_ROWS_MESSAGE = '_Nenhuma fase com sessão assumida e transcript localizado nesta amostra._';

function fmtIntStat(n) {
  return n === null ? '—' : Math.round(n).toLocaleString('pt-BR');
}

function fmtMinutes(n) {
  return n === null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatOverviewTable(rows) {
  if (rows.length === 0) return NO_ROWS_MESSAGE;

  const header = '| Fase | Sessões | Chamadas (total) | Tokens-custo — média | mediana | mín | máx | Duração média (min) | Duração mín–máx (min) |';
  const sep = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const lines = rows.map((r) => {
    const c = r.combined;
    const d = r.duration;
    const durRange = d.min === null ? '—' : `${fmtMinutes(d.min)}–${fmtMinutes(d.max)}`;
    return `| ${r.phase} | ${r.sessionCount} | ${r.totalCalls.toLocaleString('pt-BR')} | ${fmtIntStat(c.mean)} | ${fmtIntStat(c.median)} | ${fmtIntStat(c.min)} | ${fmtIntStat(c.max)} | ${fmtMinutes(d.mean)} | ${durRange} |`;
  });
  return [header, sep, ...lines].join('\n');
}

export function formatBreakdownTable(rows) {
  if (rows.length === 0) return NO_ROWS_MESSAGE;

  const header = '| Fase | Output — média/sessão | Cache write — média/sessão | Cache write ÷ Output |';
  const sep = '| --- | ---: | ---: | ---: |';
  const lines = rows.map((r) => {
    const ratio =
      r.output.mean !== null && r.output.mean > 0
        ? `${(r.cacheWrite.mean / r.output.mean).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
        : '—';
    return `| ${r.phase} | ${fmtIntStat(r.output.mean)} | ${fmtIntStat(r.cacheWrite.mean)} | ${ratio} |`;
  });
  return [header, sep, ...lines].join('\n');
}

/** Baseline medido manualmente na etapa 3 (05/08) — ponto de comparação enquanto o store local ainda não acumulou amostra própria de todas as fases. */
const BASELINE_ETAPA_3 =
  'cockpit 197 turnos (output 160.017, cache write 897.792, cache read 29.946.079); ' +
  'workers Implementar (sonnet) 396.565 tk / 204 chamadas / ~57 min, ' +
  'Validar (opus) 138.540 tk / 37 chamadas / ~7 min, ' +
  'Documentar (sonnet) 155.280 tk / 22 chamadas / ~4,4 min (etapa 3, 05/08)';

/**
 * Dois parágrafos: (1) por que a métrica é output+cache-write e não o total
 * processado, (2) o que os números dizem para a decisão de fundir fases —
 * nomeando, quando há dado, a fase com maior razão cache-write/output (a
 * candidata mais forte, porque é a que mais paga para RECONSTRUIR contexto
 * por unidade de trabalho gerado).
 */
export function buildLeituraParagraphs(rows, { totalClaimed = 0, totalMatched = 0 } = {}) {
  const withOutput = rows.filter((r) => r.output.mean !== null && r.output.mean > 0);
  const ranked = [...withOutput].sort((a, b) => b.cacheWrite.mean / b.output.mean - a.cacheWrite.mean / a.output.mean);
  const worst = ranked[0] ?? null;

  const p1 =
    rows.length === 0
      ? `Esta amostra local não tem nenhuma fase com sessão assumida (\`session.claimed\`) e transcript localizado: ${totalClaimed} sessão(ões) assumida(s) no store, ${totalMatched} com dado de custo cruzado. O mecanismo (store → \`cliSessionId\` → transcript → \`usage\` por mensagem) está pronto e coberto por teste; falta o store acumular sessões de mais fases para a tabela ganhar corpo — cada rodada de \`npm run ${NPM_SCRIPT_NAME}\` recalcula do zero, então basta rodar de novo depois que mais fases passarem pela Esteira. Até lá, a leitura abaixo se apoia no baseline medido manualmente na etapa 3 (05/08): ${BASELINE_ETAPA_3}.`
      : `Nesta amostra, ${rows.length} fase(s) tinham sessão assumida com transcript localizado (${totalMatched} de ${totalClaimed} sessões assumidas no store). A métrica que decide é output tokens + cache write — nunca o total processado: 96,6% do input de uma sessão típica é cache READ (contexto já existente, reaproveitado a uma fração do preço); somar isso mediria o quanto a sessão LEU, não o quanto ela CUSTOU. Para comparar escala, o baseline medido manualmente na etapa 3 (05/08) foi: ${BASELINE_ETAPA_3}.`;

  const p2 =
    worst === null
      ? `Sem sessões suficientes nesta amostra para apontar uma fase específica, a leitura do baseline já é direcional: Implementar concentrou 204 chamadas em ~57 minutos contra 37/~7 min de Validar e 22/~4,4 min de Documentar — ou seja, as fases curtas pagam proporcionalmente mais pela reconstrução de contexto (abrir sessão nova, reler card/diff/arquivos do zero) do que pelo trabalho em si. São Validar e Documentar as melhores candidatas a testar fusão com a fase vizinha primeiro; Implementar já roda como sessão longa e bem aproveitada, então fundir ali tende a economizar menos do que arrisca (sessão única gigante, mais handoff por estouro de contexto). A confirmar rodando este script de novo quando o store acumular sessões dessas fases.`
      : `Nesta amostra, "${worst.phase}" é a fase com maior razão cache-write/output (${(worst.cacheWrite.mean / worst.output.mean).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x) — cada sessão dessa fase gasta proporcionalmente mais reconstruindo contexto do que efetivamente respondendo. É a candidata mais forte a fundir com a fase vizinha: menos sessões novas abertas para aquele trabalho significa menos vezes pagando essa reconstrução. Fases com razão baixa (mais perto de 1x) já amortizam esse custo dentro da própria sessão e ganham menos com a fusão — o oposto, reconstruir contexto, é o que de fato pesa, não reusá-lo.`;

  return [p1, p2];
}

export function formatReportDoc({ generatedAtIso, rows, totalClaimed, totalMatched, totalMissingTranscript }) {
  const [p1, p2] = buildLeituraParagraphs(rows, { totalClaimed, totalMatched });

  return `# Custo médio por fase da Esteira

> Gerado por \`npm run ${NPM_SCRIPT_NAME}\` em ${generatedAtIso}. Cruza o store
> local da Esteira (\`session.started\`/\`session.claimed\` → \`cliSessionId\`)
> com os transcripts do CLI (\`~/.claude/projects/<slug>/*.jsonl\`, campo
> \`usage\` por mensagem). Leitura estritamente read-only — nunca escreve no
> store nem em transcript — e sem nenhum nome de pessoa: só contagem, tokens
> e minutos de sessões de trabalho.

## Amostra desta máquina

${totalClaimed} sessão(ões) assumida(s) (\`session.claimed\`) encontrada(s) no store; ${totalMatched} tiveram transcript localizado e entraram na conta; ${totalMissingTranscript} ficaram de fora (transcript não encontrado).

## Tabela 1 — custo por fase (output + cache write, por sessão)

${formatOverviewTable(rows)}

## Tabela 2 — o que pesa mais: gerar resposta ou reconstruir contexto

${formatBreakdownTable(rows)}

## Leitura

${p1}

${p2}
`;
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/**
 * `storeEventsPath`/`claudeHome` são parâmetros explícitos (nunca lidos de
 * `process.env` aqui dentro) para o teste poder cruzar fixtures de tmpdir
 * sem qualquer risco de tocar o store ou o `~/.claude` reais.
 */
export async function computeCostPerPhase({ storeEventsPath, claudeHome }) {
  const claimedSessions = await readClaimedSessionsFromStore(storeEventsPath);

  const sessionUsages = [];
  let totalMatched = 0;
  let totalMissingTranscript = 0;

  for (const session of claimedSessions) {
    const transcriptPath = resolveTranscriptPath({ claudeHome, cwd: session.cwd, cliSessionId: session.cliSessionId });
    const usage = await readSessionUsageFromTranscript(transcriptPath);
    if (usage === null) {
      totalMissingTranscript += 1;
      continue;
    }
    totalMatched += 1;
    sessionUsages.push({
      phase: session.phase,
      calls: usage.calls,
      outputTokens: usage.outputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      durationMinutes: usage.durationMinutes,
    });
  }

  return {
    rows: buildPhaseStatsRows(sessionUsages),
    totalClaimed: claimedSessions.length,
    totalMatched,
    totalMissingTranscript,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const options = { platform: process.platform, env: process.env, homedir: homedir() };
  const storeEventsPath = resolveEsteiraStoreEventsPath(options);
  const claudeHome = resolveClaudeProjectsHome(options);

  const result = await computeCostPerPhase({ storeEventsPath, claudeHome });
  const generatedAtIso = new Date().toISOString();
  const doc = formatReportDoc({ generatedAtIso, ...result });

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const docsDir = join(repoRoot, 'docs');
  const outPath = join(docsDir, 'custo-por-fase.md');
  await mkdir(docsDir, { recursive: true });
  await writeFile(outPath, doc, 'utf8');

  console.log(`Store lido:                  ${storeEventsPath}`);
  console.log(`Claude home:                 ${claudeHome}`);
  console.log(`Sessões assumidas no store:  ${result.totalClaimed}`);
  console.log(`Com transcript localizado:   ${result.totalMatched}`);
  console.log(`Sem transcript localizado:   ${result.totalMissingTranscript}`);
  console.log('');
  console.log(formatOverviewTable(result.rows));
  console.log('');
  console.log(formatBreakdownTable(result.rows));
  console.log('');
  console.log(`Relatório escrito em: ${outPath}`);
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((error) => {
    console.error('esteira-custo-fase falhou:', error);
    process.exitCode = 1;
  });
}
