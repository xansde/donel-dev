import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildExitWatchdogCommand, createExitWatchdog } from '../src/main/exit-watchdog';

// t-eda2f8a1 (13/11) — a copy of the app stayed alive 7 h with no window after its main window closed. The vigia de
// saída ends it from outside; it kills a process, so what it must never do is end the wrong one (a pid reused by
// another program or by the next copy of the app).

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('vigia de saída', () => {
  it.runIf(process.platform === 'win32')(
    'encerra o processo com o pid e o início dados, e poupa o pid cujo início não bate',
    async () => {
      const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      const spared = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      const startedAtMs = Date.now();
      try {
        const kill = buildExitWatchdogCommand({ pid: victim.pid!, startedAtMs, graceSeconds: 1 });
        // Same pid check, but a start one hour off: another process now owns the pid.
        const keep = buildExitWatchdogCommand({ pid: spared.pid!, startedAtMs: startedAtMs - 3_600_000, graceSeconds: 1 });
        spawnSync(kill.file, kill.args, { windowsHide: true, timeout: 60_000 });
        spawnSync(keep.file, keep.args, { windowsHide: true, timeout: 60_000 });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(alive(victim.pid!)).toBe(false);
        expect(alive(spared.pid!)).toBe(true);
      } finally {
        victim.kill();
        spared.kill();
      }
    },
    90_000,
  );

  it('arma uma vez só, e só no Windows', () => {
    const calls: string[] = [];
    const fakeSpawn = (file: string) => {
      calls.push(file);
      return { unref() {} };
    };
    const watchdog = createExitWatchdog(fakeSpawn, 'win32');
    expect(watchdog.arm({ pid: 1234, startedAtMs: 1_700_000_000_000, graceSeconds: 20 })).toBe(true);
    expect(watchdog.arm({ pid: 1234, startedAtMs: 1_700_000_000_000, graceSeconds: 20 })).toBe(false);
    expect(createExitWatchdog(fakeSpawn, 'linux').arm({ pid: 1234, startedAtMs: 1_700_000_000_000, graceSeconds: 20 })).toBe(false);
    expect(calls).toEqual(['powershell.exe']);
  });

  // Revisão do #428: no Atualizar, o electron-updater lança o instalador como filho do app ANTES do app.quit(). Um
  // `taskkill /T` no app travado derrubaria o instalador no meio da instalação.
  it('não arma quando a saída é para atualizar, para não derrubar o instalador', () => {
    const calls: string[] = [];
    const fakeSpawn = (file: string) => {
      calls.push(file);
      return { unref() {} };
    };
    const watchdog = createExitWatchdog(fakeSpawn, 'win32');
    watchdog.exitingForUpdate();
    expect(watchdog.arm({ pid: 1234, startedAtMs: 1_700_000_000_000, graceSeconds: 20 })).toBe(false);
    expect(calls).toEqual([]);
  });
});
