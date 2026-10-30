import { describe, expect, it } from 'vitest';
import { analyzeHealth, computeDiskForecast, formatHours, worstSeverity } from '../src/shared/health/analyze';
import { formatHealthIndicator } from '../src/shared/health/format';
import type { HealthSnapshot, ProcessSample } from '../src/shared/health/types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function proc(overrides: Partial<ProcessSample> & { pid: number }): ProcessSample {
  return { parentPid: 1000, name: `p${overrides.pid}.exe`, parentAlive: true, workingSetBytes: 10 * MB, writeBytesPerSec: 0, ...overrides };
}

function snap(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    at: 1_000_000,
    ram: { totalBytes: 16 * GB, freeBytes: 8 * GB },
    disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 250 * GB },
    processes: [],
    ownPids: [],
    ...overrides,
  };
}

const ids = (snapshot: HealthSnapshot, previous?: HealthSnapshot) => analyzeHealth(snapshot, previous).findings.map((f) => `${f.id}:${f.severity}`);

describe('analyzeHealth — tudo certo', () => {
  it('sem problema: um único achado ok', () => {
    const report = analyzeHealth(snap());
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ id: 'ok', severity: 'ok' });
    expect(report.worst).toBe('ok');
    expect(report.diskForecast).toBeNull();
  });
});

describe('analyzeHealth — memória', () => {
  it('menos de 10% livre: atenção', () => {
    expect(ids(snap({ ram: { totalBytes: 16 * GB, freeBytes: 1.5 * GB } }))).toEqual(['ram:warn']);
  });

  it('menos de 5% livre: crítico (o caso real: 0,7 de 15,7 GB)', () => {
    const report = analyzeHealth(snap({ ram: { totalBytes: 15.7 * GB, freeBytes: 0.7 * GB } }));
    expect(report.findings.map((f) => `${f.id}:${f.severity}`)).toEqual(['ram:critical']);
    expect(report.findings[0]?.detail).toContain('4%');
    expect(report.worst).toBe('critical');
  });

  it('exatamente 10% livre ainda é ok', () => {
    expect(ids(snap({ ram: { totalBytes: 10 * GB, freeBytes: 1 * GB } }))).toEqual(['ok:ok']);
  });
});

describe('analyzeHealth — disco', () => {
  it('menos de 15% livre: atenção, com a ação de abrir a pasta temporária', () => {
    const report = analyzeHealth(snap({ disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 10 * GB } }));
    expect(report.findings[0]).toMatchObject({ id: 'disk', severity: 'warn', action: { kind: 'open-temp' } });
  });

  it('menos de 5% livre: crítico', () => {
    expect(ids(snap({ disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 4 * GB } }))).toEqual(['disk:critical']);
  });

  it('disco ilegível: sem achado de disco, sem quebrar', () => {
    expect(ids(snap({ disk: null }))).toEqual(['ok:ok']);
  });
});

describe('analyzeHealth — previsão de disco cheio', () => {
  const minute = 60_000;

  it('calcula GB/h e horas até encher a partir de duas amostras', () => {
    const before = snap({ at: 0, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 21 * GB } });
    const now = snap({ at: 10 * minute, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 20 * GB } });
    const forecast = computeDiskForecast(now, before);
    expect(forecast?.gbPerHour).toBeCloseTo(6, 5);
    expect(forecast?.hoursToFull).toBeCloseTo(20 / 6, 5);
  });

  it('o caso real: ~10 MB/s com 20 GB livres enche em ~34 min: crítico', () => {
    const before = snap({ at: 0, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 20 * GB + 600 * MB } });
    const now = snap({ at: minute, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 20 * GB } });
    const report = analyzeHealth(now, before);
    const finding = report.findings.find((f) => f.id === 'disk-forecast');
    expect(finding?.severity).toBe('critical');
    expect(finding?.detail).toMatch(/enche em \d+ min/);
    expect(report.diskForecast?.gbPerHour).toBeCloseTo(35.16, 1);
  });

  it('enchendo, mas com mais de 2 h e menos de 24 h: atenção', () => {
    const before = snap({ at: 0, disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 51 * GB } });
    const now = snap({ at: 30 * minute, disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 50 * GB } });
    // 2 GB/h -> 25 h até encher: ainda nada. A 10 GB/h -> 5 h: atenção.
    expect(ids(now, before)).toEqual(['ok:ok']);
    const faster = snap({ at: 6 * minute, disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 50 * GB } });
    expect(ids(faster, before)).toEqual(['disk-forecast:warn']);
  });

  it('disco esvaziando ou parado: previsão sem horas e sem achado', () => {
    const before = snap({ at: 0, disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 20 * GB } });
    const now = snap({ at: minute, disk: { path: 'C:', totalBytes: 100 * GB, freeBytes: 25 * GB } });
    expect(computeDiskForecast(now, before)?.hoursToFull).toBeNull();
    expect(ids(now, before)).toEqual(['ok:ok']);
  });

  it('queda pequena demais (menos de 256 MB) não é tendência', () => {
    const before = snap({ at: 0, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 1 * GB + 100 * MB } });
    const now = snap({ at: minute, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 1 * GB } });
    expect(ids(now, before).some((id) => id.startsWith('disk-forecast'))).toBe(false);
  });

  it('sem amostra anterior, amostras coladas ou disco diferente: sem previsão', () => {
    const now = snap({ at: minute });
    expect(computeDiskForecast(now, undefined)).toBeNull();
    expect(computeDiskForecast(now, snap({ at: minute - 1000 }))).toBeNull();
    expect(computeDiskForecast(now, snap({ at: 0, disk: { path: 'D:', totalBytes: 1, freeBytes: 1 } }))).toBeNull();
  });
});

describe('analyzeHealth — processos', () => {
  it('órfão gravando mais de 1 MB/s: crítico, com a ação de encerrar', () => {
    const yes = proc({ pid: 4242, name: 'yes.exe', parentPid: 999, parentAlive: false, writeBytesPerSec: 10 * MB });
    const report = analyzeHealth(snap({ processes: [yes] }));
    expect(report.findings[0]).toMatchObject({
      id: 'orphan-4242',
      severity: 'critical',
      action: { kind: 'kill-process', pid: 4242, name: 'yes.exe' },
    });
    expect(report.findings[0]?.detail).toContain('10 MB/s');
  });

  it('órfão quieto (≤ 1 MB/s) não é achado', () => {
    expect(ids(snap({ processes: [proc({ pid: 5, parentAlive: false, writeBytesPerSec: 0.5 * MB })] }))).toEqual(['ok:ok']);
  });

  it('órfão que é peça do Windows não é oferecido', () => {
    const wininit = proc({ pid: 600, name: 'wininit.exe', parentAlive: false, writeBytesPerSec: 3 * MB });
    expect(ids(snap({ processes: [wininit] }))).toEqual(['ok:ok']);
  });

  it('gravando mais de 5 MB/s em duas amostras seguidas: atenção, com a ação de encerrar', () => {
    const before = snap({ at: 0, processes: [proc({ pid: 77, name: 'copy.exe', writeBytesPerSec: 8 * MB })] });
    const now = snap({ at: 60_000, processes: [proc({ pid: 77, name: 'copy.exe', writeBytesPerSec: 6 * MB })] });
    const report = analyzeHealth(now, before);
    expect(report.findings[0]).toMatchObject({ id: 'heavy-write-77', severity: 'warn', action: { kind: 'kill-process', pid: 77 } });
  });

  it('pico numa amostra só não é achado', () => {
    const before = snap({ at: 0, processes: [proc({ pid: 77, writeBytesPerSec: 1 * MB })] });
    const now = snap({ at: 60_000, processes: [proc({ pid: 77, writeBytesPerSec: 50 * MB })] });
    expect(ids(now, before)).toEqual(['ok:ok']);
    expect(ids(now)).toEqual(['ok:ok']);
  });

  it('pid reaproveitado por outro programa entre as amostras não conta como "seguida"', () => {
    const before = snap({ at: 0, processes: [proc({ pid: 77, name: 'a.exe', writeBytesPerSec: 9 * MB })] });
    const now = snap({ at: 60_000, processes: [proc({ pid: 77, name: 'b.exe', writeBytesPerSec: 9 * MB })] });
    expect(ids(now, before)).toEqual(['ok:ok']);
  });

  it('órfão que também grava muito vira um achado só (o de órfão)', () => {
    const p = proc({ pid: 9, parentAlive: false, writeBytesPerSec: 20 * MB });
    const before = snap({ at: 0, processes: [p] });
    const now = snap({ at: 60_000, processes: [p] });
    expect(ids(now, before)).toEqual(['orphan-9:critical']);
  });

  it('processo pesado do próprio app (ou filho dele) é avisado mas sem botão de encerrar', () => {
    const shell = proc({ pid: 21, parentPid: 20, name: 'node.exe', writeBytesPerSec: 9 * MB });
    const before = snap({ at: 0, processes: [shell], ownPids: [20] });
    const now = snap({ at: 60_000, processes: [shell], ownPids: [20] });
    const finding = analyzeHealth(now, before).findings[0];
    expect(finding?.id).toBe('heavy-write-21');
    expect(finding?.action).toBeUndefined();
  });

  it('top 5 por memória, do maior ao menor', () => {
    const processes = [1, 2, 3, 4, 5, 6, 7].map((n) => proc({ pid: n, workingSetBytes: n * 100 * MB }));
    const report = analyzeHealth(snap({ processes: [proc({ pid: 0, name: 'Idle', workingSetBytes: 99 * GB }), ...processes] }));
    expect(report.topMemory.map((p) => p.pid)).toEqual([7, 6, 5, 4, 3]);
  });
});

describe('analyzeHealth — ordem e pior severidade', () => {
  it('críticos primeiro, depois atenção', () => {
    const yes = proc({ pid: 4242, parentAlive: false, writeBytesPerSec: 10 * MB });
    const report = analyzeHealth(snap({ ram: { totalBytes: 16 * GB, freeBytes: 1.5 * GB }, processes: [yes] }));
    expect(report.findings.map((f) => f.severity)).toEqual(['critical', 'warn']);
    expect(report.worst).toBe('critical');
  });

  it('worstSeverity de lista vazia é ok', () => {
    expect(worstSeverity([])).toBe('ok');
  });
});

describe('formatação', () => {
  it('linha do rodapé: RAM em uso e disco livre', () => {
    const report = analyzeHealth(snap({ ram: { totalBytes: 16 * GB, freeBytes: 0.64 * GB }, disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 85 * GB } }));
    expect(formatHealthIndicator(report)).toBe('PC · RAM 96% · disco 85 GB');
    expect(formatHealthIndicator(null)).toBe('PC · —');
  });

  it('horas legíveis', () => {
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(1.5)).toBe('1,5 h');
    expect(formatHours(30)).toBe('30 h');
  });
});
