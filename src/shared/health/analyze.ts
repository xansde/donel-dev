// Saúde do computador - turns one sample of the machine (and the one before it) into what the owner
// reads: memory, disk, how fast the disk is filling, and which process is to blame. Pure and tested
// (tests/health-analyze.test.ts); the collector in src/main/health/ does the I/O.
//
// Born from a real day (28/10): 0,7 GB of RAM free out of 15,7 GB, and an orphan `yes.exe` writing
// 10 MB/s into a log in %TEMP% until the C: drive was down to 20 GB.

import { formatBytes } from '../format-bytes';
import { collectAppPids, protectionReason } from './protected';
import type { DiskForecast, HealthFinding, HealthReport, HealthSeverity, HealthSnapshot, ProcessSample, ProcessSummary } from './types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const HEALTH_THRESHOLDS = {
  ramWarnFreeRatio: 0.1,
  ramCriticalFreeRatio: 0.05,
  diskWarnFreeRatio: 0.15,
  diskCriticalFreeRatio: 0.05,
  /** A process writing above this in two samples in a row is a heavy writer. */
  heavyWriteBytesPerSec: 5 * MB,
  /** An orphan writing above this in one sample is critical. */
  orphanWriteBytesPerSec: 1 * MB,
  /** The disk forecast only speaks when the disk loses at least this fast... */
  forecastMinGbPerHour: 1,
  /** ...and lost at least this much between the two samples (one download is not a trend). */
  forecastMinDropBytes: 256 * MB,
  /** Two samples closer than this say nothing about a rate. */
  forecastMinIntervalMs: 30_000,
  forecastCriticalHours: 2,
  forecastWarnHours: 24,
  topMemoryCount: 5,
} as const;

const SEVERITY_RANK: Record<HealthSeverity, number> = { ok: 0, warn: 1, critical: 2 };

export function worstSeverity(findings: readonly HealthFinding[]): HealthSeverity {
  let worst: HealthSeverity = 'ok';
  for (const finding of findings) {
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst]) worst = finding.severity;
  }
  return worst;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function rate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** `45 min`, `1,5 h`, `30 h`. */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 10) return `${hours.toFixed(1).replace('.', ',')} h`;
  return `${Math.round(hours)} h`;
}

function formatGbPerHour(gbPerHour: number): string {
  return `${gbPerHour >= 10 ? Math.round(gbPerHour) : gbPerHour.toFixed(1).replace('.', ',')} GB/h`;
}

function ramFinding(snapshot: HealthSnapshot): HealthFinding | null {
  const { totalBytes, freeBytes } = snapshot.ram;
  if (totalBytes <= 0) return null;
  const ratio = freeBytes / totalBytes;
  const numbers = `Livre: ${formatBytes(freeBytes)} de ${formatBytes(totalBytes)} (${percent(ratio)}).`;
  if (ratio < HEALTH_THRESHOLDS.ramCriticalFreeRatio) {
    return {
      id: 'ram',
      severity: 'critical',
      title: 'Memória quase esgotada',
      detail: `${numbers} Programas e o chat podem falhar. Feche abas, sessões e programas que não está usando; a lista abaixo mostra quem mais usa memória.`,
    };
  }
  if (ratio < HEALTH_THRESHOLDS.ramWarnFreeRatio) {
    return {
      id: 'ram',
      severity: 'warn',
      title: 'Pouca memória livre',
      detail: `${numbers} Se o computador ficar lento, feche o que não está usando.`,
    };
  }
  return null;
}

function diskFinding(snapshot: HealthSnapshot): HealthFinding | null {
  const disk = snapshot.disk;
  if (!disk || disk.totalBytes <= 0) return null;
  const ratio = disk.freeBytes / disk.totalBytes;
  const numbers = `Livre no ${disk.path}: ${formatBytes(disk.freeBytes)} de ${formatBytes(disk.totalBytes)} (${percent(ratio)}).`;
  const action = { kind: 'open-temp', label: 'Abrir pasta temporária' } as const;
  if (ratio < HEALTH_THRESHOLDS.diskCriticalFreeRatio) {
    return {
      id: 'disk',
      severity: 'critical',
      title: 'Disco quase cheio',
      detail: `${numbers} Com o disco cheio, programas param de salvar. A pasta temporária costuma guardar arquivos grandes esquecidos.`,
      action,
    };
  }
  if (ratio < HEALTH_THRESHOLDS.diskWarnFreeRatio) {
    return {
      id: 'disk',
      severity: 'warn',
      title: 'Pouco espaço em disco',
      detail: `${numbers} Vale olhar a pasta temporária e apagar o que não precisa.`,
      action,
    };
  }
  return null;
}

/** GB/h lost between the two samples and the hours until the disk is full at that pace. `null` without two comparable samples. */
export function computeDiskForecast(snapshot: HealthSnapshot, previous: HealthSnapshot | undefined): DiskForecast | null {
  const current = snapshot.disk;
  const before = previous?.disk;
  if (!current || !before || current.path !== before.path) return null;
  const intervalMs = snapshot.at - (previous as HealthSnapshot).at;
  if (intervalMs < HEALTH_THRESHOLDS.forecastMinIntervalMs) return null;
  const gbPerHour = (before.freeBytes - current.freeBytes) / GB / (intervalMs / 3_600_000);
  const hoursToFull = gbPerHour > 0 ? current.freeBytes / GB / gbPerHour : null;
  return { gbPerHour, hoursToFull };
}

function forecastFinding(snapshot: HealthSnapshot, previous: HealthSnapshot | undefined, forecast: DiskForecast | null): HealthFinding | null {
  if (!forecast || forecast.hoursToFull === null || !snapshot.disk || !previous?.disk) return null;
  if (forecast.gbPerHour < HEALTH_THRESHOLDS.forecastMinGbPerHour) return null;
  if (previous.disk.freeBytes - snapshot.disk.freeBytes < HEALTH_THRESHOLDS.forecastMinDropBytes) return null;
  const detail = `O ${snapshot.disk.path} está perdendo ${formatGbPerHour(forecast.gbPerHour)}; nesse ritmo enche em ${formatHours(forecast.hoursToFull)}. Veja abaixo quem está gravando no disco.`;
  if (forecast.hoursToFull < HEALTH_THRESHOLDS.forecastCriticalHours) {
    return { id: 'disk-forecast', severity: 'critical', title: 'Disco enchendo rápido', detail };
  }
  if (forecast.hoursToFull < HEALTH_THRESHOLDS.forecastWarnHours) {
    return { id: 'disk-forecast', severity: 'warn', title: 'Disco enchendo', detail };
  }
  return null;
}

function processFindings(snapshot: HealthSnapshot, previous: HealthSnapshot | undefined): HealthFinding[] {
  const appPids = collectAppPids(snapshot.processes, snapshot.ownPids);
  const before = new Map<number, ProcessSample>();
  for (const process of previous?.processes ?? []) before.set(process.pid, process);

  const findings: HealthFinding[] = [];
  for (const process of snapshot.processes) {
    const protection = protectionReason(process.pid, process.name, appPids);
    const killAction =
      protection === null ? ({ kind: 'kill-process', pid: process.pid, name: process.name, label: 'Encerrar processo' } as const) : undefined;

    // An orphan writing to disk: whoever started it is gone, nobody will stop it.
    if (!process.parentAlive && protection === null && process.writeBytesPerSec > HEALTH_THRESHOLDS.orphanWriteBytesPerSec) {
      findings.push({
        id: `orphan-${process.pid}`,
        severity: 'critical',
        title: `Processo órfão gravando no disco: ${process.name}`,
        detail: `${process.name} (pid ${process.pid}) continua rodando depois que o programa que o abriu fechou, e está gravando ${rate(process.writeBytesPerSec)}. Ninguém vai pará-lo: se não reconhece, encerre.`,
        action: killAction,
      });
      continue;
    }

    const prior = before.get(process.pid);
    const sustained =
      prior !== undefined &&
      prior.name === process.name &&
      prior.writeBytesPerSec > HEALTH_THRESHOLDS.heavyWriteBytesPerSec &&
      process.writeBytesPerSec > HEALTH_THRESHOLDS.heavyWriteBytesPerSec;
    if (sustained) {
      findings.push({
        id: `heavy-write-${process.pid}`,
        severity: 'warn',
        title: `${process.name} está gravando muito no disco`,
        detail: `${process.name} (pid ${process.pid}) está gravando ${rate(process.writeBytesPerSec)} há pelo menos duas leituras seguidas. Se é uma cópia ou instalação sua, espere; se não reconhece, encerre.`,
        action: killAction,
      });
    }
  }
  return findings;
}

export function topMemoryProcesses(processes: readonly ProcessSample[], count: number = HEALTH_THRESHOLDS.topMemoryCount): ProcessSummary[] {
  return processes
    .filter((process) => process.pid !== 0)
    .slice()
    .sort((a, b) => b.workingSetBytes - a.workingSetBytes)
    .slice(0, count)
    .map(({ pid, name, workingSetBytes, writeBytesPerSec }) => ({ pid, name, workingSetBytes, writeBytesPerSec }));
}

/**
 * The report of one sample. `previous` is the sample before it (the collector's last one): it feeds the
 * disk forecast and the "two samples in a row" of the heavy writer. Findings come worst first; with
 * nothing wrong there is a single `ok` finding.
 */
export function analyzeHealth(snapshot: HealthSnapshot, previous?: HealthSnapshot): HealthReport {
  const diskForecast = computeDiskForecast(snapshot, previous);
  const found = [ramFinding(snapshot), diskFinding(snapshot), forecastFinding(snapshot, previous, diskForecast), ...processFindings(snapshot, previous)].filter(
    (finding): finding is HealthFinding => finding !== null,
  );
  const sorted = found
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
  const findings: HealthFinding[] =
    sorted.length > 0 ? sorted : [{ id: 'ok', severity: 'ok', title: 'Tudo certo', detail: 'Memória e disco com folga, e nenhum processo gravando demais.' }];

  return {
    at: snapshot.at,
    ram: snapshot.ram,
    disk: snapshot.disk,
    diskForecast,
    findings,
    topMemory: topMemoryProcesses(snapshot.processes),
    worst: worstSeverity(findings),
  };
}
