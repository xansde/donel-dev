// Item 20 (PDA mindscape-openrig, D3) — the routines run inside the app: a timer in the main, which stops when the
// app closes. Each round: generator (read only) → keys → filter without an LLM → shadow log.
//
// IN SHADOW: nothing is woken and nothing is written outside `<userData>/rotinas/`, the only folder this module
// touches (single writer: the main):
//   config.json   the numbers the owner may change by hand (created with the defaults on the first round);
//   estado.json   the memory of the filter (dedup, hysteresis, caps, noise), with its own `schemaVersion`
//                 (`userData` is shared by the alfa/beta/stable channels: a newer version is never written);
//   sombra.log    JSON Lines of what would have woken, rotated at 256 KB into `sombra.log.1` (one old file).
//
// Leaving the shadow (next version): `wakeInShadow` gives way to a real wake. That is where the finding becomes a
// task of the ledger (item 19, `src/shared/ledger/`, origin `rotina:<id>:<key>`) and the message goes to the Líder
// by the same path as `sessao_enviar`. Nothing else in the round changes.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MindscapeDoc } from '../../shared/mindscape/model';
import type { Finding, ShadowEntry } from '../../shared/rotinas/contract';
import { emptySourceFilterState, filterRound, isSourceOff, type SourceFilterState } from '../../shared/rotinas/filter';
import {
  DEFAULT_STALLED_SESSIONS_CONFIG,
  findStalledSessions,
  STALLED_SESSIONS_ROUTINE_ID,
  type LiveSessionSignal,
  type StalledSessionsConfig,
} from '../../shared/rotinas/stalledSessions';

const STATE_SCHEMA_VERSION = 1;
const LOG_MAX_BYTES = 256 * 1024;
const ROUND_INTERVAL_MS = 5 * 60_000;
const FIRST_ROUND_DELAY_MS = 60_000;

export interface RoutineRunnerDeps {
  /** `<userData>/rotinas`. */
  readonly dir: string;
  /** The open session tabs with their semaphore. */
  listLive(): LiveSessionSignal[];
  /** The boards (`mindscape.json`, read only). Throws when unreadable: the round is skipped. */
  loadDoc(): MindscapeDoc;
  /** Something new went to the shadow log. */
  onChanged(): void;
  readonly now?: () => number;
}

export interface RoutineRunner {
  start(): void;
  stop(): void;
  /** The shadow entries of today (local day), oldest first. */
  today(): ShadowEntry[];
}

interface RunnerState {
  schemaVersion: number;
  sources: Record<string, SourceFilterState>;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean
    }
  }
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createRoutineRunner(deps: RoutineRunnerDeps): RoutineRunner {
  const now = deps.now ?? Date.now;
  const configPath = join(deps.dir, 'config.json');
  const statePath = join(deps.dir, 'estado.json');
  const logPath = join(deps.dir, 'sombra.log');
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let roundTimer: ReturnType<typeof setInterval> | null = null;

  const readConfig = (): StalledSessionsConfig => {
    const raw = readJson(configPath);
    if (raw === null) {
      writeJsonAtomic(configPath, { sessaoParada: { horasParada: DEFAULT_STALLED_SESSIONS_CONFIG.stalledHours, minutosDono: DEFAULT_STALLED_SESSIONS_CONFIG.needsOwnerMinutes } });
      return DEFAULT_STALLED_SESSIONS_CONFIG;
    }
    const section = typeof raw === 'object' && raw !== null ? (raw as { sessaoParada?: Record<string, unknown> }).sessaoParada : undefined;
    return {
      stalledHours: positive(section?.horasParada, DEFAULT_STALLED_SESSIONS_CONFIG.stalledHours),
      needsOwnerMinutes: positive(section?.minutosDono, DEFAULT_STALLED_SESSIONS_CONFIG.needsOwnerMinutes),
    };
  };

  /** `null` = a newer channel owns the file: this round neither runs nor writes. */
  const readState = (): RunnerState | null => {
    const raw = readJson(statePath) as Partial<RunnerState> | null;
    if (raw === null || typeof raw !== 'object') return { schemaVersion: STATE_SCHEMA_VERSION, sources: {} };
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > STATE_SCHEMA_VERSION) return null;
    return { schemaVersion: STATE_SCHEMA_VERSION, sources: typeof raw.sources === 'object' && raw.sources !== null ? raw.sources : {} };
  };

  const appendLog = (entries: readonly ShadowEntry[]): void => {
    if (entries.length === 0) return;
    try {
      if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
      appendFileSync(logPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
    } catch {
      // the shadow log is best effort: a failed write never stops the app
    }
  };

  /** In shadow the wake is only a line in the log. */
  const wakeInShadow = (routineId: string, finding: Finding, at: number): ShadowEntry => ({
    at,
    routineId,
    decision: 'acordaria',
    key: finding.key,
    projectPath: finding.projectPath,
    placeId: finding.placeId,
    summary: finding.summary,
    wake: finding.wake,
  });

  const round = (): void => {
    try {
      if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true });
      const state = readState();
      if (state === null) return;
      const at = now();
      const routineId = STALLED_SESSIONS_ROUTINE_ID;
      const previous = state.sources[routineId] ?? emptySourceFilterState();
      if (isSourceOff(previous, at)) return;
      const doc = deps.loadDoc();
      const findings = findStalledSessions(doc, deps.listLive(), at, readConfig());
      const byKey = new Map(findings.map((finding) => [finding.key, finding]));
      const result = filterRound(previous, [...byKey.keys()], at);
      const entries: ShadowEntry[] = [];
      for (const item of result.decisions) {
        if (item.decision === 'fonte-desligada') {
          entries.push({ at, routineId, decision: 'fonte-desligada', summary: 'Mais da metade dos achados da semana sumiu sozinha: a rotina fica desligada por 7 dias.' });
          continue;
        }
        const finding = byKey.get(item.key);
        if (item.decision === 'acordaria' && finding) entries.push(wakeInShadow(routineId, finding, at));
        else if (item.decision === 'adiada' && finding) {
          entries.push({ ...wakeInShadow(routineId, finding, at), decision: 'adiada', summary: `${finding.summary} (teto da janela cheio)` });
        } else if (item.decision === 'descartada') {
          const placeId = item.key.slice(item.key.indexOf(':') + 1);
          const board = Object.values(doc.boards).find((candidate) => candidate.cards[placeId] !== undefined);
          entries.push({ at, routineId, decision: 'descartada', key: item.key, placeId, ...(board ? { projectPath: board.projectPath } : {}), summary: 'resolveu sozinha na rodada seguinte' });
        }
      }
      writeJsonAtomic(statePath, { ...state, sources: { ...state.sources, [routineId]: result.state } });
      appendLog(entries);
      if (entries.length > 0) deps.onChanged();
    } catch (error) {
      console.error('[donel-dev] rotina em sombra falhou nesta rodada:', error);
    }
  };

  const readLogFile = (path: string): ShadowEntry[] => {
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as ShadowEntry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  };

  return {
    start() {
      if (firstTimer || roundTimer) return;
      firstTimer = setTimeout(() => {
        firstTimer = null;
        round();
        roundTimer = setInterval(round, ROUND_INTERVAL_MS);
      }, FIRST_ROUND_DELAY_MS);
    },
    stop() {
      if (firstTimer) clearTimeout(firstTimer);
      if (roundTimer) clearInterval(roundTimer);
      firstTimer = null;
      roundTimer = null;
    },
    today() {
      const midnight = new Date(now());
      midnight.setHours(0, 0, 0, 0);
      const start = midnight.getTime();
      return [...readLogFile(`${logPath}.1`), ...readLogFile(logPath)].filter((entry) => typeof entry.at === 'number' && entry.at >= start);
    },
  };
}
