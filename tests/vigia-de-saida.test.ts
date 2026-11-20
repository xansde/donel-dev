import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESCENDANTS_TO_END_SCRIPT, buildExitWatchdogCommand, createExitWatchdog } from '../src/main/exit-watchdog';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { timeout: 20_000 }).status === 0;

function decodeEncoded(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf16le');
}

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

async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !alive(pid);
}

describe('vigia de saída', () => {
  // t-f2dcadf5 (17/11) — armado pelo app, o vigia nunca rodava: o PowerShell 5.1 lançado `detached`, sem console e com
  // stdio ignorado, sai com 0 sem executar nada. Aqui ele é armado como o app arma, com o spawn de verdade.
  it.runIf(process.platform === 'win32')(
    'armado como o app arma, encerra mesmo o processo depois do prazo',
    async () => {
      const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      try {
        const watchdog = createExitWatchdog(spawn, 'win32');
        expect(watchdog.arm({ pid: victim.pid!, startedAtMs: Date.now(), graceSeconds: 1 })).toBe(true);
        expect(await waitDead(victim.pid!, 30_000)).toBe(true);
      } finally {
        victim.kill();
      }
    },
    60_000,
  );

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
        // the command only starts the watchdog (Start-Process) and leaves; the watchdog itself waits the grace first
        expect(await waitDead(victim.pid!, 30_000)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
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

  // t-6b1fc5e0 (revisão do #466) — o VS Code ou o Cursor aberto por "Abrir no editor" (ou por `code .` num terminal do
  // app) é filho do app quando o editor não estava aberto; o `taskkill /T` de uma saída travada o levava junto, com
  // arquivo não salvo. O vigia encerra o app e a árvore dele, menos cada editor com a própria árvore.
  it.runIf(hasPwsh)('escolhe a árvore do app para encerrar e deixa de fora cada editor com os filhos dele', () => {
    const all = [
      [101, 100, 'Donel Dev.exe'], // renderer
      [102, 101, 'node.exe'], // filho do renderer
      [200, 100, 'Code.exe'], // editor aberto pelo app
      [201, 200, 'Code.exe'], // processo auxiliar do editor
      [202, 201, 'node.exe'], // terminal do editor
      [300, 100, 'cmd.exe'], // terminal do app
      [301, 300, 'Cursor.exe'], // `cursor .` no terminal do app
      [302, 301, 'Cursor.exe'],
      [400, 1, 'Code.exe'], // fora da árvore
      [500, 1, 'node.exe'],
      [103, 103, 'loop.exe'], // pai de si mesmo: não pode prender o laço
    ];
    const fake = all
      .map(([id, parent, name]) => `[pscustomobject]@{ProcessId=${id};ParentProcessId=${parent};Name='${name}'}`)
      .join(',');
    const script = `$root = 100; $all = @(${fake}); ${DESCENDANTS_TO_END_SCRIPT}; ($kill | Sort-Object) -join ','`;
    const out = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60_000 });
    expect(out.stderr).toBe('');
    expect(out.stdout.trim()).toBe('101,102,300');
  }, 90_000);

  it('salta para fora da árvore do app (Start-Process), sem detached, e não usa o taskkill /T', () => {
    const calls: { file: string; args: readonly string[]; options: object }[] = [];
    const fakeSpawn = (file: string, args: readonly string[], options: object) => {
      calls.push({ file, args, options });
      return { unref() {} };
    };
    expect(createExitWatchdog(fakeSpawn, 'win32').arm({ pid: 4321, startedAtMs: 1_700_000_000_000, graceSeconds: 20 })).toBe(true);
    const [call] = calls;
    // t-f2dcadf5: detached, o PowerShell 5.1 sem console sai com 0 sem rodar nada
    expect(call.options).not.toHaveProperty('detached');
    const hop = decodeEncoded(call.args[call.args.indexOf('-EncodedCommand') + 1]);
    expect(hop).toMatch(/^Start-Process -FilePath powershell\.exe /);
    const inner = decodeEncoded(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(hop)![1]);
    expect(inner).toContain('Stop-Process -Id $root -Force');
    expect(inner).not.toMatch(/taskkill/i);
  });

  it.runIf(process.platform === 'win32')(
    'encerra o app travado e poupa o editor que ele abriu',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vigia-editor-'));
      const editorExe = join(dir, 'Code.exe');
      copyFileSync(process.execPath, editorExe);
      const opener = `const c = require('node:child_process').spawn(${JSON.stringify(editorExe)}, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000)`;
      const victim = spawn(process.execPath, ['-e', opener], { stdio: ['ignore', 'pipe', 'ignore'] });
      let editorPid = 0;
      try {
        editorPid = await new Promise<number>((resolve) => victim.stdout!.once('data', (d) => resolve(Number(String(d).trim()))));
        const watchdog = createExitWatchdog(spawn, 'win32');
        expect(watchdog.arm({ pid: victim.pid!, startedAtMs: Date.now(), graceSeconds: 1 })).toBe(true);
        expect(await waitDead(victim.pid!, 30_000)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        expect(alive(editorPid)).toBe(true);
      } finally {
        victim.kill();
        if (editorPid) {
          try {
            process.kill(editorPid);
          } catch {
            /* já saiu */
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        rmSync(dir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
