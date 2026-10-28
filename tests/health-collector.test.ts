import { describe, expect, it, vi } from 'vitest';
import { parseProcessQueryOutput, parseTasklistName, systemDiskPath } from '../src/main/health/collector';
import { createHealthService } from '../src/main/health/health-service';
import type { HealthReport, HealthSnapshot } from '../src/shared/health/types';

describe('parseProcessQueryOutput', () => {
  it('junta perf (por IDProcess) e Win32_Process, e marca órfão pelo pai morto', () => {
    const stdout = JSON.stringify({
      perf: [
        { i: 10, w: 0 },
        { i: 4242, w: 10485760 },
      ],
      procs: [
        { p: 10, pp: 1, n: 'explorer.exe', ws: 200, c: 1000 },
        { p: 11, pp: 10, n: 'node.exe', ws: 300, c: 2000 },
        { p: 4242, pp: 999, n: 'yes.exe', ws: 50, c: 3000 },
      ],
    });
    const result = parseProcessQueryOutput(stdout);
    expect(result).toEqual([
      { pid: 10, parentPid: 1, name: 'explorer.exe', parentAlive: false, workingSetBytes: 200, writeBytesPerSec: 0 },
      { pid: 11, parentPid: 10, name: 'node.exe', parentAlive: true, workingSetBytes: 300, writeBytesPerSec: 0 },
      { pid: 4242, parentPid: 999, name: 'yes.exe', parentAlive: false, workingSetBytes: 50, writeBytesPerSec: 10485760 },
    ]);
  });

  it('pai com o mesmo pid mas nascido DEPOIS do filho é pid reaproveitado: órfão', () => {
    const stdout = JSON.stringify({
      perf: [],
      procs: [
        { p: 50, pp: 60, n: 'child.exe', ws: 1, c: 1000 },
        { p: 60, pp: 1, n: 'other.exe', ws: 1, c: 5000 },
      ],
    });
    expect(parseProcessQueryOutput(stdout)[0]?.parentAlive).toBe(false);
  });

  it('PowerShell devolve objeto solto quando há um item só, e BOM no começo', () => {
    const stdout = '\uFEFF' + JSON.stringify({ perf: { i: 7, w: 5 }, procs: { p: 7, pp: 7, n: 'solo.exe', ws: 1, c: null } });
    expect(parseProcessQueryOutput(stdout)).toEqual([{ pid: 7, parentPid: 7, name: 'solo.exe', parentAlive: false, workingSetBytes: 1, writeBytesPerSec: 5 }]);
  });

  it('kernel (0 e 4) nunca é órfão', () => {
    const stdout = JSON.stringify({ perf: [], procs: [{ p: 0, pp: 0, n: 'System Idle Process', ws: 0 }, { p: 4, pp: 0, n: 'System', ws: 0 }] });
    expect(parseProcessQueryOutput(stdout).every((p) => p.parentAlive)).toBe(true);
  });

  it('saída ilegível vira lista vazia', () => {
    expect(parseProcessQueryOutput('')).toEqual([]);
    expect(parseProcessQueryOutput('not json')).toEqual([]);
    expect(parseProcessQueryOutput('null')).toEqual([]);
    expect(parseProcessQueryOutput(JSON.stringify({ procs: [{ n: 'sem pid' }] }))).toEqual([]);
  });
});

describe('parseTasklistName', () => {
  it('lê o nome da primeira linha CSV', () => {
    expect(parseTasklistName('"yes.exe","4242","Console","1","1.234 K"\r\n')).toBe('yes.exe');
  });

  it('sem tarefa: null', () => {
    expect(parseTasklistName('INFO: No tasks are running which match the specified criteria.\r\n')).toBeNull();
  });
});

describe('systemDiskPath', () => {
  it('usa o SystemDrive no Windows', () => {
    expect(systemDiskPath({ SystemDrive: 'D:' }, 'win32')).toBe('D:\\');
    expect(systemDiskPath({}, 'win32')).toBe('C:\\');
    expect(systemDiskPath({}, 'linux')).toBe('/');
  });
});

describe('HealthService — amostragem', () => {
  function snapshot(at: number): HealthSnapshot {
    return { at, ram: { totalBytes: 100, freeBytes: 50 }, disk: null, processes: [], ownPids: [] };
  }

  it('uma coleta por vez: refresh durante uma coleta junta-se a ela', async () => {
    let release: (value: HealthSnapshot) => void = () => undefined;
    const collect = vi.fn(() => new Promise<HealthSnapshot>((resolve) => (release = resolve)));
    const svc = createHealthService({
      collect,
      onReport: () => undefined,
      ownPids: () => [],
      lookupProcessName: async () => null,
      terminate: () => undefined,
      setTimer: () => null,
      clearTimer: () => undefined,
    });
    const first = svc.refresh();
    const second = svc.refresh();
    expect(collect).toHaveBeenCalledTimes(1);
    release(snapshot(1));
    expect(await first).toBe(await second);
  });

  it('passa a amostra anterior para a análise e avisa o renderer a cada amostra', async () => {
    const reports: HealthReport[] = [];
    let at = 0;
    const svc = createHealthService({
      collect: async () => snapshot((at += 60_000)),
      onReport: (report) => reports.push(report),
      ownPids: () => [],
      lookupProcessName: async () => null,
      terminate: () => undefined,
      setTimer: () => null,
      clearTimer: () => undefined,
    });
    await svc.refresh();
    await svc.refresh();
    expect(reports.map((r) => r.at)).toEqual([60_000, 120_000]);
    expect(svc.getReport()?.at).toBe(120_000);
  });

  it('coleta que falha mantém o último relatório', async () => {
    let fail = false;
    const svc = createHealthService({
      collect: async () => {
        if (fail) throw new Error('boom');
        return snapshot(1);
      },
      onReport: () => undefined,
      ownPids: () => [],
      lookupProcessName: async () => null,
      terminate: () => undefined,
      setTimer: () => null,
      clearTimer: () => undefined,
    });
    await svc.refresh();
    fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await svc.refresh())?.at).toBe(1);
    warn.mockRestore();
  });

  it('start agenda a primeira amostra com atraso e repete; stop cancela', async () => {
    const timers: { callback: () => void; ms: number }[] = [];
    const clearTimer = vi.fn();
    const collect = vi.fn(async () => snapshot(1));
    const svc = createHealthService({
      collect,
      onReport: () => undefined,
      ownPids: () => [],
      lookupProcessName: async () => null,
      terminate: () => undefined,
      intervalMs: 60_000,
      firstDelayMs: 10_000,
      setTimer: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length;
      },
      clearTimer,
    });
    svc.start();
    svc.start();
    expect(timers.map((t) => t.ms)).toEqual([10_000]);
    timers[0]?.callback();
    await vi.waitFor(() => expect(timers.map((t) => t.ms)).toEqual([10_000, 60_000]));
    expect(collect).toHaveBeenCalledTimes(1);
    svc.stop();
    expect(clearTimer).toHaveBeenCalledWith(2);
  });
});
