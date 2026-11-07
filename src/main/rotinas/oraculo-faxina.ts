// Faxina noturna do Oráculo (t-2c18d666) — a routine without a model, in the main, like `routine-runner.ts`. Once a
// night (the first check from 03:00 local time on, or the first one after the app opens later that day) it reads the
// ledger, asks `gh` about the PRs of the delivered and rejected tasks, and applies the rules of
// `shared/ledger/faxina.ts`: a low-risk task with a merged PR ends "concluída", an old orphan passes on.
//
// IN SHADOW for the first SHADOW_NIGHTS nights: it only writes what it would do. Everything goes to
// `<userData>/rotinas/faxina.log` (JSON Lines, rotated at 256 KB into `faxina.log.1`); the nights run are in
// `faxina-estado.json` (its own `schemaVersion`: a newer channel's file is never written over).

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerService } from '../ledger-store';
import type { MindscapeDoc } from '../../shared/mindscape/model';
import { LEADER_OF_ALL } from '../../shared/mindscape/leader';
import { mergedDecisions, oldOrphans, orphanPassReason, prCandidates, SHADOW_NIGHTS, type PrRef, type PrState } from '../../shared/ledger/faxina';

const STATE_SCHEMA_VERSION = 1;
const LOG_MAX_BYTES = 256 * 1024;
const CHECK_INTERVAL_MS = 30 * 60_000;
const FIRST_CHECK_DELAY_MS = 2 * 60_000;
/** The night's round runs from this local hour on. */
export const FAXINA_HOUR = 3;

export interface FaxinaEntry {
  readonly at: number;
  /** The local day of the night (`AAAA-MM-DD`). */
  readonly noite: string;
  readonly sombra: boolean;
  readonly acao: 'cancelaria' | 'cancelada' | 'fica-risco-alto' | 'passaria' | 'passada' | 'erro' | 'resumo';
  readonly tarefa?: string;
  readonly titulo?: string;
  readonly pr?: string;
  readonly de?: string;
  readonly para?: string;
  readonly motivo: string;
}

export interface FaxinaDeps {
  /** `<userData>/rotinas`. */
  readonly dir: string;
  ledger(): LedgerService | null;
  /** The boards (`mindscape.json`, read only). Throws when unreadable: no orphan moves this night. */
  loadBoards(): MindscapeDoc;
  /** The conversations open in a session right now. */
  liveSessionIds(): ReadonlySet<string>;
  prState(pr: PrRef): Promise<PrState>;
  /** One line to the session of a place (`placeId`) or to the Líder único (`'lider'`). */
  tell(projectPath: string, to: string, text: string): void;
  readonly now?: () => number;
}

export interface FaxinaRunner {
  start(): void;
  stop(): void;
  /** Runs tonight's round if it did not run yet (`force`: even before FAXINA_HOUR). Returns what it logged. */
  runNight(force?: boolean): Promise<FaxinaEntry[]>;
}

interface FaxinaState {
  schemaVersion: number;
  nights: string[];
}

export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createFaxinaRunner(deps: FaxinaDeps): FaxinaRunner {
  const now = deps.now ?? Date.now;
  const statePath = join(deps.dir, 'faxina-estado.json');
  const logPath = join(deps.dir, 'faxina.log');
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  /** `null` = a newer channel owns the file: no round. */
  const readState = (): FaxinaState | null => {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    } catch {
      raw = null;
    }
    if (raw === null || typeof raw !== 'object') return { schemaVersion: STATE_SCHEMA_VERSION, nights: [] };
    const state = raw as Partial<FaxinaState>;
    if (typeof state.schemaVersion === 'number' && state.schemaVersion > STATE_SCHEMA_VERSION) return null;
    return { schemaVersion: STATE_SCHEMA_VERSION, nights: Array.isArray(state.nights) ? state.nights.filter((night): night is string => typeof night === 'string') : [] };
  };

  const writeState = (state: FaxinaState): void => {
    const tmp = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      renameSync(tmp, statePath);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing to clean
      }
    }
  };

  const appendLog = (entries: readonly FaxinaEntry[]): void => {
    if (entries.length === 0) return;
    try {
      if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
      appendFileSync(logPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
    } catch {
      // best effort: a failed log write never stops the app
    }
  };

  async function round(force: boolean): Promise<FaxinaEntry[]> {
    const at = now();
    if (!force && new Date(at).getHours() < FAXINA_HOUR) return [];
    if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true });
    const state = readState();
    const night = localDay(at);
    if (state === null || state.nights.includes(night)) return [];
    const service = deps.ledger();
    if (!service) return [];
    let snapshot;
    try {
      snapshot = service.load();
    } catch {
      return [];
    }
    if (snapshot.readOnly) return [];
    const shadow = state.nights.length < SHADOW_NIGHTS;
    const entries: FaxinaEntry[] = [];
    const log = (entry: Omit<FaxinaEntry, 'at' | 'noite' | 'sombra'>): void => {
      entries.push({ at: now(), noite: night, sombra: shadow, ...entry });
    };

    // Rule 1 — merged PRs.
    const states = new Map<string, PrState>();
    for (const { refs } of prCandidates(snapshot.doc)) {
      for (const pr of refs) {
        if (states.has(pr.url)) continue;
        const answer = await deps.prState(pr).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        states.set(pr.url, answer);
        if ('error' in answer) log({ acao: 'erro', pr: pr.url, motivo: `gh não respondeu: ${answer.error}` });
      }
    }
    for (const decision of mergedDecisions(snapshot.doc, states)) {
      const base = { tarefa: decision.task.id, ...(decision.task.title ? { titulo: decision.task.title } : {}), pr: decision.pr.url };
      if (decision.kind === 'fica-risco-alto') {
        log({ ...base, acao: 'fica-risco-alto', motivo: `PR #${decision.pr.number} mesclado em ${decision.mergedAt.slice(0, 10)}, mas risco alto nunca se encerra sozinho: espera o dono.` });
        continue;
      }
      if (shadow) {
        log({ ...base, acao: 'cancelaria', motivo: decision.reason });
        continue;
      }
      const result = service.apply({ kind: 'lugar', placeId: decision.task.ownerPlaceId }, { op: 'cancelar', id: decision.task.id, reason: decision.reason });
      log({ ...base, acao: result.ok ? 'cancelada' : 'erro', motivo: result.ok ? decision.reason : result.reason });
    }

    // Rule 2 — old orphans (on the ledger as it is now: a task just cancelled is closed).
    let boards: MindscapeDoc | null = null;
    try {
      boards = deps.loadBoards();
    } catch {
      log({ acao: 'erro', motivo: 'não consegui ler os quadros; nenhuma órfã foi passada nesta noite.' });
    }
    const told = new Map<string, { projectPath: string; to: string; lines: string[] }>();
    if (boards) {
      let doc = snapshot.doc;
      try {
        doc = service.load().doc;
      } catch {
        // keep the first read
      }
      for (const orphan of oldOrphans(doc, boards, deps.liveSessionIds(), now())) {
        const reason = orphanPassReason(orphan.task.ownerPlaceId, orphan.how);
        const base = { tarefa: orphan.task.id, ...(orphan.task.title ? { titulo: orphan.task.title } : {}), de: orphan.task.ownerPlaceId, para: orphan.to };
        if (shadow) {
          log({ ...base, acao: 'passaria', motivo: reason });
          continue;
        }
        const result = service.apply({ kind: 'lugar', placeId: orphan.task.ownerPlaceId }, { op: 'transferir', id: orphan.task.id, to: orphan.to, reason });
        log({ ...base, acao: result.ok ? 'passada' : 'erro', motivo: result.ok ? reason : result.reason });
        if (!result.ok) continue;
        const key = orphan.to === LEADER_OF_ALL ? LEADER_OF_ALL : `${orphan.task.projectPath}\n${orphan.to}`;
        const entry = told.get(key) ?? { projectPath: orphan.task.projectPath, to: orphan.to, lines: [] };
        entry.lines.push(`${orphan.task.id}${orphan.task.title ? ` «${orphan.task.title}»` : ''} (o lugar ${orphan.task.ownerPlaceId} ${orphan.how})`);
        told.set(key, entry);
      }
    }
    for (const { projectPath, to, lines } of told.values()) {
      deps.tell(projectPath, to, `◆ Faxina do Oráculo: ${lines.length === 1 ? 'esta tarefa estava' : 'estas tarefas estavam'} sem dono há mais de um dia e ${lines.length === 1 ? 'passou' : 'passaram'} para você: ${lines.join('; ')}. Leia com tarefa_ver e assuma com tarefa_assumir, passe adiante com tarefa_transferir ou encerre com tarefa_cancelar.`);
    }
    log({ acao: 'resumo', motivo: `${shadow ? `noite em sombra ${state.nights.length + 1} de ${SHADOW_NIGHTS}: só registrei` : 'noite de faxina'}; ${entries.length} registro(s).` });
    writeState({ ...state, nights: [...state.nights, night] });
    appendLog(entries);
    return entries;
  }

  const runNight = async (force = false): Promise<FaxinaEntry[]> => {
    if (running) return [];
    running = true;
    try {
      return await round(force);
    } catch (error) {
      console.error('[donel-dev] faxina do Oráculo falhou nesta noite:', error);
      return [];
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (firstTimer || checkTimer) return;
      firstTimer = setTimeout(() => {
        firstTimer = null;
        void runNight();
        checkTimer = setInterval(() => void runNight(), CHECK_INTERVAL_MS);
      }, FIRST_CHECK_DELAY_MS);
    },
    stop() {
      if (firstTimer) clearTimeout(firstTimer);
      if (checkTimer) clearInterval(checkTimer);
      firstTimer = null;
      checkTimer = null;
    },
    runNight,
  };
}
