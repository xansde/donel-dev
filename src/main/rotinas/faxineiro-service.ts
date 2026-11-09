// Faxineiro com gatilhos (t-b3b26e60) — the main half of a round: the machines (PC and remote places, from the health
// services that already read them), the `faxineiro` section of `<userData>/rotinas/config.json`, the memory in
// `faxineiro-estado.json` and the log `faxineiro.log`. The judgement is `src/shared/faxineiro/triggers.ts`; the
// waking is the renderer's bridge, which owns the tabs.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaxineiroRoundAnswer, FaxineiroWakeOrder } from '../../shared/faxineiro/ipc';
import {
  evaluateFaxineiro,
  faxineiroConfigSection,
  machineReasons,
  PC_MACHINE_ID,
  readFaxineiroConfig,
  readFaxineiroState,
  type FaxineiroConfig,
  type FaxineiroLogEntry,
  type MachineReading,
  type SessionView,
} from '../../shared/faxineiro/triggers';
import type { HealthReport } from '../../shared/health/types';
import type { RemoteHealthReport } from '../../shared/health/remote';

const LOG_MAX_BYTES = 256 * 1024;

export interface FaxineiroServiceDeps {
  /** `<userData>/rotinas` (shared with the routines in shadow: same `config.json`). */
  readonly dir: string;
  readonly pcReport: () => HealthReport | null;
  readonly remoteReports: () => readonly RemoteHealthReport[];
  readonly now?: () => number;
}

export interface FaxineiroService {
  round(sessions: readonly SessionView[]): FaxineiroRoundAnswer;
  log(entries: readonly FaxineiroLogEntry[]): void;
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

/** The PC and the remote places as the triggers read them. A remote place with no read yet is left out. */
export function machineReadings(pc: HealthReport | null, remotes: readonly RemoteHealthReport[]): MachineReading[] {
  const out: MachineReading[] = [];
  if (pc) {
    out.push({
      id: PC_MACHINE_ID,
      label: 'PC',
      reachable: true,
      checkedAt: pc.at,
      ramFreeRatio: pc.ram.totalBytes > 0 ? pc.ram.freeBytes / pc.ram.totalBytes : null,
      ramAvailableBytes: pc.ram.totalBytes > 0 ? pc.ram.freeBytes : null,
      swapUsedRatio: null,
      swapInPerSec: null,
      swapOutPerSec: null,
      load5PerCpu: null,
      diskUsedRatio: pc.disk && pc.disk.totalBytes > 0 ? 1 - pc.disk.freeBytes / pc.disk.totalBytes : null,
    });
  }
  for (const report of remotes) {
    if (report.status === 'pending') continue;
    const reading = report.reading;
    out.push({
      id: report.id,
      label: report.label,
      reachable: report.status === 'ok',
      checkedAt: report.checkedAt,
      ramFreeRatio: reading?.ram ? reading.ram.freeBytes / reading.ram.totalBytes : null,
      ramAvailableBytes: reading?.ram ? reading.ram.freeBytes : null,
      swapUsedRatio: reading?.swap ? 1 - reading.swap.freeBytes / reading.swap.totalBytes : null,
      swapInPerSec: reading?.swapIo?.inPerSec ?? null,
      swapOutPerSec: reading?.swapIo?.outPerSec ?? null,
      load5PerCpu: reading?.load && reading.cpus ? reading.load.five / reading.cpus : null,
      diskUsedRatio: reading?.disk ? 1 - reading.disk.freeBytes / reading.disk.totalBytes : null,
    });
  }
  return out;
}

/** Where a Faxineiro opens: never on the machine in trouble. From the PC in trouble, to a healthy remote place. */
export function faxineiroPlace(avoid: string | undefined, machines: readonly MachineReading[], config: FaxineiroConfig): string | undefined {
  if (avoid !== PC_MACHINE_ID) return undefined;
  const healthy = machines.find((machine) => machine.id !== PC_MACHINE_ID && machine.reachable && machineReasons(machine, 0, config).length === 0);
  return healthy?.id;
}

export function createFaxineiroService(deps: FaxineiroServiceDeps): FaxineiroService {
  const now = deps.now ?? Date.now;
  const configPath = join(deps.dir, 'config.json');
  const statePath = join(deps.dir, 'faxineiro-estado.json');
  const logPath = join(deps.dir, 'faxineiro.log');

  const ensureDir = (): void => {
    if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true });
  };

  /** The section, written with the defaults when missing (keeping every other section of the file). */
  const readConfig = (): FaxineiroConfig => {
    if (!existsSync(configPath)) {
      writeJsonAtomic(configPath, { faxineiro: faxineiroConfigSection() });
      return readFaxineiroConfig(undefined);
    }
    const raw = readJson(configPath);
    // An unreadable file is the owner's half-edit: never written over (the defaults hold meanwhile).
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return readFaxineiroConfig(undefined);
    const file = raw as Record<string, unknown>;
    if (file.faxineiro === undefined) writeJsonAtomic(configPath, { ...file, faxineiro: faxineiroConfigSection() });
    return readFaxineiroConfig(file.faxineiro);
  };

  const log = (entries: readonly FaxineiroLogEntry[]): void => {
    if (entries.length === 0) return;
    try {
      ensureDir();
      if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
      appendFileSync(logPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
    } catch {
      // the log is best effort: a failed write never stops the app
    }
  };

  return {
    round(sessions) {
      try {
        ensureDir();
        const state = readFaxineiroState(readJson(statePath));
        if (state === null) return { wakes: [], closeIdle: [], fullMachines: {} }; // a newer channel owns the memory
        const config = readConfig();
        const machines = machineReadings(deps.pcReport(), deps.remoteReports());
        const result = evaluateFaxineiro({ config, machines, sessions }, state, now());
        writeJsonAtomic(statePath, result.state);
        log(result.held);
        const wakes: FaxineiroWakeOrder[] = result.wakes.map((wake) => {
          const remoteId = faxineiroPlace(wake.avoidMachine, machines, config);
          return { projectPath: wake.projectPath, text: wake.text, reasons: wake.reasons, ...(remoteId ? { remoteId } : {}) };
        });
        return { wakes, closeIdle: result.closeIdle, fullMachines: result.fullMachines };
      } catch (error) {
        console.error('[donel-dev] faxineiro: a rodada falhou:', error);
        return { wakes: [], closeIdle: [], fullMachines: {} };
      }
    },
    log,
  };
}
