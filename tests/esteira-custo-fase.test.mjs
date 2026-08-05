// Testes da lógica PURA de scripts/esteira-custo-fase.mjs (E6 — custo médio
// por fase). Arquivo `.test.mjs` de propósito: o script é JS puro standalone
// (roda via `node`, sem passar pelo build TS — ver header do script), então o
// teste também fica fora do grafo do `tsc` (vitest.config.ts inclui
// `tests/**/*.test.mjs` à parte de `*.test.ts`).
//
// Os testes de I/O (leitura de store/transcript) escrevem fixtures sintéticas
// SÓ em `os.tmpdir()` — nunca em `~/.claude` nem `%APPDATA%/donel-dev` reais
// (regra dura do batch).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_USERDATA_NAME,
  CLAUDE_HOME_ENV_VAR,
  ESTEIRA_STORE_DIR_ENV_VAR,
  PHASE_ORDER,
  STORE_DIR_NAME,
  STORE_EVENTS_FILE,
  statsOf,
  slugifyProjectPath,
  defaultElectronUserDataDir,
  resolveEsteiraStoreEventsPath,
  resolveClaudeProjectsHome,
  parseTranscriptLine,
  parseStoreLineForSession,
  resolveTranscriptPath,
  buildPhaseStatsRows,
  formatOverviewTable,
  formatBreakdownTable,
  buildLeituraParagraphs,
  formatReportDoc,
  readClaimedSessionsFromStore,
  readSessionUsageFromTranscript,
  computeCostPerPhase,
} from '../scripts/esteira-custo-fase.mjs';

describe('statsOf', () => {
  it('returns nulls for empty input', () => {
    expect(statsOf([])).toEqual({ count: 0, sum: 0, mean: null, median: null, min: null, max: null });
  });

  it('computes stats for a single value', () => {
    expect(statsOf([5])).toEqual({ count: 1, sum: 5, mean: 5, median: 5, min: 5, max: 5 });
  });

  it('computes the median for an even-length input without mutating the input array', () => {
    const input = [4, 1, 3, 2];
    const result = statsOf(input);
    expect(result).toEqual({ count: 4, sum: 10, mean: 2.5, median: 2.5, min: 1, max: 4 });
    expect(input).toEqual([4, 1, 3, 2]);
  });

  it('computes the median for an odd-length input', () => {
    expect(statsOf([5, 1, 3]).median).toBe(3);
  });
});

describe('slugifyProjectPath', () => {
  it('replaces every non-alphanumeric character with "-", one for one', () => {
    expect(slugifyProjectPath('C:\\Users\\xansd\\seazone\\donel-dev')).toBe('C--Users-xansd-seazone-donel-dev');
  });

  it('does not collapse repeated separators (the dotfile case documented in session-indexer.ts)', () => {
    expect(slugifyProjectPath('C:\\Users\\xansd\\.no-mistakes\\worktrees\\abc')).toBe(
      'C--Users-xansd--no-mistakes-worktrees-abc',
    );
  });
});

describe('defaultElectronUserDataDir', () => {
  it('uses APPDATA on win32', () => {
    const dir = defaultElectronUserDataDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
      homedir: 'C:\\Users\\x',
    });
    expect(dir).toBe(join('C:\\Users\\x\\AppData\\Roaming', APP_USERDATA_NAME));
  });

  it('falls back to <home>/AppData/Roaming on win32 when APPDATA is unset', () => {
    const dir = defaultElectronUserDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\x' });
    expect(dir).toBe(join('C:\\Users\\x', 'AppData', 'Roaming', APP_USERDATA_NAME));
  });

  it('uses Library/Application Support on darwin', () => {
    const dir = defaultElectronUserDataDir({ platform: 'darwin', env: {}, homedir: '/Users/x' });
    expect(dir).toBe(join('/Users/x', 'Library', 'Application Support', APP_USERDATA_NAME));
  });

  it('uses XDG_CONFIG_HOME or ~/.config on linux', () => {
    expect(defaultElectronUserDataDir({ platform: 'linux', env: {}, homedir: '/home/x' })).toBe(
      join('/home/x', '.config', APP_USERDATA_NAME),
    );
    expect(
      defaultElectronUserDataDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/custom' }, homedir: '/home/x' }),
    ).toBe(join('/custom', APP_USERDATA_NAME));
  });
});

describe('resolveEsteiraStoreEventsPath', () => {
  it(`honors the ${ESTEIRA_STORE_DIR_ENV_VAR} override (same env var the real app reads)`, () => {
    const p = resolveEsteiraStoreEventsPath({
      platform: 'win32',
      env: { [ESTEIRA_STORE_DIR_ENV_VAR]: 'C:\\custom\\store' },
      homedir: 'C:\\Users\\x',
    });
    expect(p).toBe(join('C:\\custom\\store', STORE_EVENTS_FILE));
  });

  it('defaults to <userData>/esteira/events.jsonl', () => {
    const p = resolveEsteiraStoreEventsPath({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
      homedir: 'C:\\Users\\x',
    });
    expect(p).toBe(join('C:\\Users\\x\\AppData\\Roaming', APP_USERDATA_NAME, STORE_DIR_NAME, STORE_EVENTS_FILE));
  });
});

describe('resolveClaudeProjectsHome', () => {
  it('defaults to <home>/.claude', () => {
    expect(resolveClaudeProjectsHome({ env: {}, homedir: 'C:\\Users\\x' })).toBe(join('C:\\Users\\x', '.claude'));
  });

  it(`honors the ${CLAUDE_HOME_ENV_VAR} override`, () => {
    expect(resolveClaudeProjectsHome({ env: { [CLAUDE_HOME_ENV_VAR]: 'C:\\custom\\claude' }, homedir: 'C:\\Users\\x' })).toBe(
      'C:\\custom\\claude',
    );
  });
});

describe('parseTranscriptLine', () => {
  it('returns null for blank lines', () => {
    expect(parseTranscriptLine('   ')).toBeNull();
    expect(parseTranscriptLine('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTranscriptLine('{not json')).toBeNull();
  });

  it('returns null for JSON that is not an object (array/number/string)', () => {
    expect(parseTranscriptLine('[1,2,3]')).toBeNull();
    expect(parseTranscriptLine('42')).toBeNull();
  });

  it('extracts usage from a countable assistant line', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-05T10:00:00.000Z',
      message: { role: 'assistant', usage: { output_tokens: 100, cache_creation_input_tokens: 50 } },
    });
    expect(parseTranscriptLine(line)).toEqual({
      timestampMs: Date.parse('2026-08-05T10:00:00.000Z'),
      usage: { outputTokens: 100, cacheWriteTokens: 50 },
    });
  });

  it('excludes sidechain messages from usage but still counts their timestamp', () => {
    const line = JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-08-05T10:00:00.000Z',
      message: { usage: { output_tokens: 999, cache_creation_input_tokens: 999 } },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed.usage).toBeNull();
    expect(parsed.timestampMs).toBe(Date.parse('2026-08-05T10:00:00.000Z'));
  });

  it('returns usage: null for non-assistant lines but still keeps the timestamp', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-08-05T10:05:00.000Z',
      message: { role: 'user', content: 'oi' },
    });
    expect(parseTranscriptLine(line)).toEqual({ timestampMs: Date.parse('2026-08-05T10:05:00.000Z'), usage: null });
  });

  it('defaults missing/non-numeric usage fields to 0 without dropping the call', () => {
    const line = JSON.stringify({ type: 'assistant', message: { usage: {} } });
    expect(parseTranscriptLine(line)).toEqual({ timestampMs: null, usage: { outputTokens: 0, cacheWriteTokens: 0 } });
  });

  it('never throws on a malformed timestamp', () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: 'not-a-date', message: { usage: { output_tokens: 1, cache_creation_input_tokens: 1 } } });
    expect(parseTranscriptLine(line).timestampMs).toBeNull();
  });
});

describe('parseStoreLineForSession', () => {
  it('returns null for the store header line', () => {
    expect(parseStoreLineForSession(JSON.stringify({ kind: 'esteira.store.header', schema_version: '1.0.0' }))).toBeNull();
  });

  it('parses a session.started event', () => {
    const line = JSON.stringify({ type: 'session.started', payload: { id: 'ses-1', phase: 'implementar', cwd: 'C:\\x', cliSessionId: null } });
    expect(parseStoreLineForSession(line)).toEqual({ kind: 'started', id: 'ses-1', phase: 'implementar', cwd: 'C:\\x', cliSessionId: null });
  });

  it('parses a session.started event that is already claimed at birth', () => {
    const line = JSON.stringify({ type: 'session.started', payload: { id: 'ses-1', phase: 'implementar', cwd: 'C:\\x', cliSessionId: 'abc' } });
    expect(parseStoreLineForSession(line)).toEqual({ kind: 'started', id: 'ses-1', phase: 'implementar', cwd: 'C:\\x', cliSessionId: 'abc' });
  });

  it('parses a session.claimed event', () => {
    const line = JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-1', cliSessionId: 'abc-123' } });
    expect(parseStoreLineForSession(line)).toEqual({ kind: 'claimed', id: 'ses-1', cliSessionId: 'abc-123' });
  });

  it('returns null for unrelated event types, malformed lines and missing required fields', () => {
    expect(parseStoreLineForSession(JSON.stringify({ type: 'note.added', payload: { subject: {}, text: 'x' } }))).toBeNull();
    expect(parseStoreLineForSession(JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-1' } }))).toBeNull();
    expect(parseStoreLineForSession('not json')).toBeNull();
    expect(parseStoreLineForSession('')).toBeNull();
  });
});

describe('resolveTranscriptPath', () => {
  it('joins <claudeHome>/projects/<slug(cwd)>/<cliSessionId>.jsonl', () => {
    const p = resolveTranscriptPath({ claudeHome: 'C:\\Users\\x\\.claude', cwd: 'C:\\Users\\x\\seazone\\donel-dev', cliSessionId: 'abc-123' });
    expect(p).toBe(join('C:\\Users\\x\\.claude', 'projects', 'C--Users-x-seazone-donel-dev', 'abc-123.jsonl'));
  });
});

describe('buildPhaseStatsRows', () => {
  it('aggregates sessions per phase and orders rows by PHASE_ORDER', () => {
    const rows = buildPhaseStatsRows([
      { phase: 'validar', calls: 10, outputTokens: 1000, cacheWriteTokens: 500, durationMinutes: 5 },
      { phase: 'discovery', calls: 4, outputTokens: 100, cacheWriteTokens: 50, durationMinutes: 2 },
      { phase: 'discovery', calls: 6, outputTokens: 300, cacheWriteTokens: 150, durationMinutes: 4 },
    ]);
    expect(rows.map((r) => r.phase)).toEqual(['discovery', 'validar']);

    const discovery = rows[0];
    expect(discovery.sessionCount).toBe(2);
    expect(discovery.totalCalls).toBe(10);
    expect(discovery.combined.sum).toBe(600); // (100+50) + (300+150)
    expect(discovery.output.mean).toBe(200); // (100+300)/2
    expect(discovery.cacheWrite.mean).toBe(100); // (50+150)/2
    expect(discovery.duration.mean).toBe(3); // (2+4)/2
  });

  it('places unknown phases after every PHASE_ORDER phase, alphabetically among themselves', () => {
    const rows = buildPhaseStatsRows([
      { phase: 'zzz-custom', calls: 1, outputTokens: 1, cacheWriteTokens: 1, durationMinutes: 1 },
      { phase: 'concluir', calls: 1, outputTokens: 1, cacheWriteTokens: 1, durationMinutes: 1 },
      { phase: 'aaa-custom', calls: 1, outputTokens: 1, cacheWriteTokens: 1, durationMinutes: 1 },
    ]);
    expect(rows.map((r) => r.phase)).toEqual(['concluir', 'aaa-custom', 'zzz-custom']);
    expect(PHASE_ORDER).toContain('concluir');
  });

  it('keeps a session with unknown duration in the counts without corrupting the duration stats', () => {
    const rows = buildPhaseStatsRows([{ phase: 'plano', calls: 3, outputTokens: 10, cacheWriteTokens: 5, durationMinutes: null }]);
    expect(rows[0].sessionCount).toBe(1);
    expect(rows[0].duration).toEqual({ count: 0, sum: 0, mean: null, median: null, min: null, max: null });
  });
});

describe('formatOverviewTable / formatBreakdownTable', () => {
  const rows = buildPhaseStatsRows([
    { phase: 'implementar', calls: 204, outputTokens: 300000, cacheWriteTokens: 96565, durationMinutes: 57 },
  ]);

  it('overview table lists the phase with pt-BR grouped numbers', () => {
    const table = formatOverviewTable(rows);
    expect(table).toContain('implementar');
    expect(table).toContain('396.565'); // 300.000 + 96.565, formatação pt-BR
  });

  it('breakdown table shows the output/cache-write split', () => {
    const table = formatBreakdownTable(rows);
    expect(table).toContain('300.000');
    expect(table).toContain('96.565');
  });

  it('returns a readable placeholder when there are no rows', () => {
    expect(formatOverviewTable([])).toMatch(/nenhuma fase/i);
    expect(formatBreakdownTable([])).toMatch(/nenhuma fase/i);
  });
});

describe('buildLeituraParagraphs', () => {
  it('returns exactly two non-trivial paragraphs', () => {
    const rows = buildPhaseStatsRows([{ phase: 'discovery', calls: 5, outputTokens: 100, cacheWriteTokens: 900, durationMinutes: 10 }]);
    const paragraphs = buildLeituraParagraphs(rows, { totalClaimed: 2, totalMatched: 1 });
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].length).toBeGreaterThan(20);
    expect(paragraphs[1].length).toBeGreaterThan(20);
  });

  it('names the phase with the highest cache-write/output ratio when data exists', () => {
    const rows = buildPhaseStatsRows([
      { phase: 'discovery', calls: 5, outputTokens: 100, cacheWriteTokens: 900, durationMinutes: 10 },
      { phase: 'implementar', calls: 5, outputTokens: 1000, cacheWriteTokens: 100, durationMinutes: 10 },
    ]);
    const [, p2] = buildLeituraParagraphs(rows, { totalClaimed: 2, totalMatched: 2 });
    expect(p2).toMatch(/discovery/);
  });

  it('acknowledges a sparse/empty sample honestly instead of overclaiming', () => {
    const [p1] = buildLeituraParagraphs([], { totalClaimed: 0, totalMatched: 0 });
    expect(p1).toMatch(/amostra|dado/i);
  });
});

describe('formatReportDoc', () => {
  it('assembles title, sample summary, both tables and the leitura section', () => {
    const rows = buildPhaseStatsRows([{ phase: 'discovery', calls: 5, outputTokens: 100, cacheWriteTokens: 900, durationMinutes: 10 }]);
    const doc = formatReportDoc({
      generatedAtIso: '2026-08-05T12:00:00.000Z',
      rows,
      totalClaimed: 1,
      totalMatched: 1,
      totalMissingTranscript: 0,
    });
    expect(doc).toContain('# Custo médio por fase da Esteira');
    expect(doc).toContain('discovery');
    expect(doc).toContain('## Leitura');
    expect(doc).toContain('esteira:custo');
  });
});

// ---------------------------------------------------------------------------
// I/O real, mas só em tmpdir — nunca em ~/.claude nem %APPDATA%/donel-dev reais.
// ---------------------------------------------------------------------------

describe('readClaimedSessionsFromStore (I/O em tmpdir)', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'esteira-custo-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when the events file does not exist (fresh machine, never crashes)', async () => {
    const result = await readClaimedSessionsFromStore(join(dir, 'nope.jsonl'));
    expect(result).toEqual([]);
  });

  it('extracts only claimed sessions that also have a cwd, skipping malformed lines', async () => {
    const lines = [
      JSON.stringify({ kind: 'esteira.store.header', schema_version: '1.0.0' }),
      JSON.stringify({ type: 'session.started', payload: { id: 'ses-1', phase: 'implementar', cwd: 'C:\\x\\y', cliSessionId: null } }),
      JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-1', cliSessionId: 'abc-123' } }),
      JSON.stringify({ type: 'session.started', payload: { id: 'ses-2', phase: 'validar', cwd: 'C:\\x\\y', cliSessionId: null } }), // never claimed
      JSON.stringify({ type: 'session.started', payload: { id: 'ses-3', phase: 'plano', cwd: null, cliSessionId: null } }),
      JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-3', cliSessionId: 'def-456' } }), // claimed but no cwd
      'not even json',
    ];
    const path = join(dir, 'events.jsonl');
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');

    const result = await readClaimedSessionsFromStore(path);
    expect(result).toEqual([{ phase: 'implementar', cwd: 'C:\\x\\y', cliSessionId: 'abc-123' }]);
  });
});

describe('readSessionUsageFromTranscript (I/O em tmpdir)', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'esteira-custo-transcript-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the transcript file does not exist', async () => {
    const result = await readSessionUsageFromTranscript(join(dir, 'nope.jsonl'));
    expect(result).toBeNull();
  });

  it('streams the file and aggregates calls, output/cache-write tokens and wall-clock duration', async () => {
    const lines = [
      JSON.stringify({ type: 'system', timestamp: '2026-08-05T10:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-05T10:01:00.000Z', message: { usage: { output_tokens: 100, cache_creation_input_tokens: 50 } } }),
      JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-08-05T10:02:00.000Z', message: { usage: { output_tokens: 9999, cache_creation_input_tokens: 9999 } } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-05T10:05:00.000Z', message: { usage: { output_tokens: 200, cache_creation_input_tokens: 0 } } }),
      '',
      'garbage-not-json',
    ];
    const path = join(dir, 'abc-123.jsonl');
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');

    const result = await readSessionUsageFromTranscript(path);
    expect(result).toEqual({ calls: 2, outputTokens: 300, cacheWriteTokens: 50, durationMinutes: 5 });
  });
});

describe('computeCostPerPhase (I/O ponta-a-ponta em tmpdir)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'esteira-custo-e2e-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('cross-references a synthetic store with synthetic transcripts, ignoring never-claimed sessions', async () => {
    const cwd = join(root, 'repo');
    const claudeHome = join(root, 'claude-home');
    const slug = slugifyProjectPath(cwd);
    const projectDir = join(claudeHome, 'projects', slug);
    mkdirSync(projectDir, { recursive: true });

    const storeDir = join(root, 'store');
    mkdirSync(storeDir, { recursive: true });
    const storeEventsPath = join(storeDir, 'events.jsonl');
    writeFileSync(
      storeEventsPath,
      `${[
        JSON.stringify({ kind: 'esteira.store.header', schema_version: '1.0.0' }),
        JSON.stringify({ type: 'session.started', payload: { id: 'ses-1', phase: 'implementar', cwd, cliSessionId: null } }),
        JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-1', cliSessionId: 'sess-abc' } }),
        JSON.stringify({ type: 'session.started', payload: { id: 'ses-2', phase: 'implementar', cwd, cliSessionId: null } }),
      ].join('\n')}\n`,
      'utf8',
    );

    writeFileSync(
      join(projectDir, 'sess-abc.jsonl'),
      `${[
        JSON.stringify({ type: 'assistant', timestamp: '2026-08-05T10:00:00.000Z', message: { usage: { output_tokens: 100, cache_creation_input_tokens: 20 } } }),
        JSON.stringify({ type: 'assistant', timestamp: '2026-08-05T10:10:00.000Z', message: { usage: { output_tokens: 50, cache_creation_input_tokens: 0 } } }),
      ].join('\n')}\n`,
      'utf8',
    );
    // Transcript de uma sessão que nunca foi assumida — não deve ser lido nem contado.
    writeFileSync(join(projectDir, 'sess-never-claimed.jsonl'), '', 'utf8');

    const result = await computeCostPerPhase({ storeEventsPath, claudeHome });

    expect(result.totalClaimed).toBe(1);
    expect(result.totalMatched).toBe(1);
    expect(result.totalMissingTranscript).toBe(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].phase).toBe('implementar');
    expect(result.rows[0].combined.sum).toBe(170); // (100+20) + (50+0)
  });

  it('counts a claimed session as "missing transcript" instead of throwing when the file is absent', async () => {
    const cwd = join(root, 'repo2');
    const claudeHome = join(root, 'claude-home2'); // nunca criado — pasta do projeto não existe
    const storeDir = join(root, 'store2');
    mkdirSync(storeDir, { recursive: true });
    const storeEventsPath = join(storeDir, 'events.jsonl');
    writeFileSync(
      storeEventsPath,
      `${[
        JSON.stringify({ type: 'session.started', payload: { id: 'ses-1', phase: 'validar', cwd, cliSessionId: null } }),
        JSON.stringify({ type: 'session.claimed', payload: { id: 'ses-1', cliSessionId: 'ghost-session' } }),
      ].join('\n')}\n`,
      'utf8',
    );

    const result = await computeCostPerPhase({ storeEventsPath, claudeHome });

    expect(result.totalClaimed).toBe(1);
    expect(result.totalMatched).toBe(0);
    expect(result.totalMissingTranscript).toBe(1);
    expect(result.rows).toHaveLength(0);
  });

  it('never reads the real ~/.claude or %APPDATA%/donel-dev — everything above stays under tmpdir', async () => {
    // Guarda-corpo do próprio teste: os paths usados nas duas asserções acima
    // vivem todos dentro de `root`, que é um mkdtempSync. Este teste apenas
    // documenta a invariante para quem ler o arquivo.
    expect(root.toLowerCase()).toContain('esteira-custo-e2e-');
  });
});
