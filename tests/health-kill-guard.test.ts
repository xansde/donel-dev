import { describe, expect, it, vi } from 'vitest';
import { checkKillRequest } from '../src/main/health/kill-guard';
import { createHealthService } from '../src/main/health/health-service';
import { analyzeHealth } from '../src/shared/health/analyze';
import { collectAppPids, isProtectedSystemProcess } from '../src/shared/health/protected';
import type { HealthFinding, HealthReport, HealthSnapshot, ProcessSample } from '../src/shared/health/types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function proc(overrides: Partial<ProcessSample> & { pid: number }): ProcessSample {
  return { parentPid: 1, name: `p${overrides.pid}.exe`, parentAlive: true, workingSetBytes: MB, writeBytesPerSec: 0, ...overrides };
}

const orphan = proc({ pid: 4242, name: 'yes.exe', parentPid: 999, parentAlive: false, writeBytesPerSec: 10 * MB });

function snap(processes: ProcessSample[], ownPids: number[] = [100]): HealthSnapshot {
  return {
    at: 0,
    ram: { totalBytes: 16 * GB, freeBytes: 8 * GB },
    disk: { path: 'C:', totalBytes: 500 * GB, freeBytes: 250 * GB },
    processes,
    ownPids,
  };
}

/** A report that offers to kill `pid` named `name`, whatever the analyzer would say (the guard must not trust it). */
function forgedReport(pid: number, name: string): HealthReport {
  const finding: HealthFinding = { id: `x-${pid}`, severity: 'critical', title: 't', detail: 'd', action: { kind: 'kill-process', pid, name, label: 'Encerrar processo' } };
  return { at: 0, ram: { totalBytes: 1, freeBytes: 1 }, disk: null, diskForecast: null, findings: [finding], topMemory: [], worst: 'critical' };
}

describe('checkKillRequest', () => {
  it('aceita o órfão que o último relatório ofereceu', () => {
    const snapshot = snap([orphan]);
    expect(checkKillRequest(4242, analyzeHealth(snapshot), snapshot)).toEqual({ ok: true, pid: 4242, name: 'yes.exe' });
  });

  it('recusa pid inválido', () => {
    const snapshot = snap([orphan]);
    const report = analyzeHealth(snapshot);
    for (const pid of [0, -1, 1.5, '4242', null, undefined, Number.NaN]) {
      expect(checkKillRequest(pid, report, snapshot)).toEqual({ ok: false, reason: 'invalid-pid' });
    }
  });

  it('recusa antes da primeira amostra', () => {
    expect(checkKillRequest(4242, null, null)).toEqual({ ok: false, reason: 'no-report' });
  });

  it('recusa pid que existe mas não foi oferecido para encerrar (ex.: só aparece no top de memória)', () => {
    const quiet = proc({ pid: 55, workingSetBytes: 4 * GB });
    const snapshot = snap([orphan, quiet]);
    const report = analyzeHealth(snapshot);
    expect(report.topMemory.some((p) => p.pid === 55)).toBe(true);
    expect(checkKillRequest(55, report, snapshot)).toEqual({ ok: false, reason: 'not-in-report' });
    expect(checkKillRequest(31337, report, snapshot)).toEqual({ ok: false, reason: 'not-in-report' });
  });

  it('nunca encerra processo do sistema, mesmo que o relatório peça', () => {
    for (const name of ['System', 'Idle', 'svchost.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'smss.exe', 'explorer.exe', 'MsMpEng.exe']) {
      const target = proc({ pid: 700, name, parentAlive: false, writeBytesPerSec: 9 * MB });
      expect(checkKillRequest(700, forgedReport(700, name), snap([target]))).toEqual({ ok: false, reason: 'protected-system' });
    }
    expect(checkKillRequest(4, forgedReport(4, 'whatever'), snap([]))).toEqual({ ok: false, reason: 'protected-system' });
  });

  it('nunca encerra o próprio app nem os filhos e netos dele', () => {
    const own = proc({ pid: 100, name: 'Donel Dev.exe' });
    const shell = proc({ pid: 101, parentPid: 100, name: 'pwsh.exe' });
    const claude = proc({ pid: 102, parentPid: 101, name: 'claude.exe' });
    const snapshot = snap([own, shell, claude], [100]);
    expect(checkKillRequest(100, forgedReport(100, 'Donel Dev.exe'), snapshot)).toEqual({ ok: false, reason: 'own-app' });
    expect(checkKillRequest(101, forgedReport(101, 'pwsh.exe'), snapshot)).toEqual({ ok: false, reason: 'own-app' });
    expect(checkKillRequest(102, forgedReport(102, 'claude.exe'), snapshot)).toEqual({ ok: false, reason: 'own-app' });
  });
});

describe('protected', () => {
  it('nomes do sistema sem diferenciar maiúsculas nem .exe', () => {
    expect(isProtectedSystemProcess(800, 'SVCHOST.EXE')).toBe(true);
    expect(isProtectedSystemProcess(800, 'yes.exe')).toBe(false);
  });

  it('collectAppPids segue a árvore inteira e sobrevive a ciclo', () => {
    const processes = [proc({ pid: 2, parentPid: 1 }), proc({ pid: 3, parentPid: 2 }), proc({ pid: 1, parentPid: 3 }), proc({ pid: 9, parentPid: 8 })];
    expect([...collectAppPids(processes, [1])].sort()).toEqual([1, 2, 3]);
  });
});

describe('HealthService.killProcess', () => {
  function service(overrides: { lookup?: (pid: number) => Promise<string | null>; terminate?: (pid: number) => void; ownPids?: number[] } = {}) {
    const terminate = vi.fn(overrides.terminate ?? (() => undefined));
    const svc = createHealthService({
      collect: async () => snap([orphan]),
      onReport: () => undefined,
      ownPids: () => overrides.ownPids ?? [100],
      lookupProcessName: overrides.lookup ?? (async () => 'yes.exe'),
      terminate,
      setTimer: () => null,
      clearTimer: () => undefined,
    });
    return { svc, terminate };
  }

  it('encerra o órfão oferecido depois de conferir que o pid ainda é dele', async () => {
    const { svc, terminate } = service();
    await svc.refresh();
    expect(await svc.killProcess(4242)).toEqual({ ok: true, pid: 4242, name: 'yes.exe' });
    expect(terminate).toHaveBeenCalledWith(4242);
  });

  it('não encerra se o pid agora é de outro programa ou sumiu', async () => {
    for (const lookup of [async () => 'chrome.exe', async () => null]) {
      const { svc, terminate } = service({ lookup });
      await svc.refresh();
      expect(await svc.killProcess(4242)).toEqual({ ok: false, reason: 'changed' });
      expect(terminate).not.toHaveBeenCalled();
    }
  });

  it('recusa do sistema vira "failed", sem derrubar o main', async () => {
    const { svc } = service({
      terminate: () => {
        throw new Error('EPERM');
      },
    });
    await svc.refresh();
    expect(await svc.killProcess(4242)).toEqual({ ok: false, reason: 'failed' });
  });

  it('antes da primeira amostra, nada é encerrado', async () => {
    const { svc, terminate } = service();
    expect(await svc.killProcess(4242)).toEqual({ ok: false, reason: 'no-report' });
    expect(terminate).not.toHaveBeenCalled();
  });

  it('pid que virou do app depois da amostra (ownPids atual) é recusado', async () => {
    const { svc, terminate } = service({ ownPids: [4242] });
    await svc.refresh();
    expect(await svc.killProcess(4242)).toEqual({ ok: false, reason: 'own-app' });
    expect(terminate).not.toHaveBeenCalled();
  });
});
