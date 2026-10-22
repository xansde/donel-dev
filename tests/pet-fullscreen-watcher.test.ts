// T050 (015-jobu-pet, US5, R10/FR-007) - the watcher of apps in full screen: a long-lived PowerShell that asks
// `SHQueryUserNotificationState` every 1.5 s and prints the state. With fakes for the process and the timers this
// proves what must hold in the app: it reports only CHANGES; a helper that dies counts as "free" (the Jobu is never left
// hidden by a watcher that does not know) and comes back with a growing wait; stopping kills it and silences it; and the
// script is the one the task asks for (Add-Type + P/Invoke of shell32, polling every 1.5 s, a loop that ends when
// nobody reads the pipe any more).
import { describe, expect, it } from 'vitest';
import {
  FULLSCREEN_HELPER_SCRIPT,
  FULLSCREEN_POLL_MS,
  FULLSCREEN_RESTART_MAX_MS,
  FULLSCREEN_RESTART_MIN_MS,
  FULLSCREEN_STABLE_MS,
  createFullscreenWatcher,
  encodePowerShellCommand,
  type WatcherChild,
} from '../src/main/pet/fullscreen-watcher';

type Listener = (...args: never[]) => void;

class FakeChild implements WatcherChild {
  killed = false;
  private readonly handlers = new Map<string, Listener[]>();
  readonly stdout = {
    on: (event: 'data', listener: (chunk: Buffer | string) => void): void => {
      this.add(`stdout:${event}`, listener as unknown as Listener);
    },
  };
  on(event: 'exit' | 'error', listener: () => void): void {
    this.add(event, listener as unknown as Listener);
  }
  kill(): void {
    this.killed = true;
  }
  say(text: string): void {
    for (const listener of this.handlers.get('stdout:data') ?? []) (listener as unknown as (chunk: string) => void)(text);
  }
  die(event: 'exit' | 'error' = 'exit'): void {
    for (const listener of this.handlers.get(event) ?? []) (listener as unknown as () => void)();
  }
  private add(key: string, listener: Listener): void {
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), listener]);
  }
}

function world(over: { spawnThrows?: number } = {}) {
  const children: FakeChild[] = [];
  const spawns: { command: string; args: readonly string[] }[] = [];
  const timers: { id: number; at: number; callback: () => void }[] = [];
  const changes: boolean[] = [];
  let now = 0;
  let nextId = 1;
  let throwsLeft = over.spawnThrows ?? 0;
  const watcher = createFullscreenWatcher({
    onChange: (active) => void changes.push(active),
    spawn: (command, args) => {
      spawns.push({ command, args });
      if (throwsLeft > 0) {
        throwsLeft -= 1;
        throw new Error('spawn powershell.exe ENOENT');
      }
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    setTimeout: (callback, ms) => {
      const timer = { id: nextId, at: now + ms, callback };
      nextId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (handle) => {
      const at = timers.findIndex((timer) => timer.id === handle);
      if (at >= 0) timers.splice(at, 1);
    },
    now: () => now,
    log: () => undefined,
  });
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      now = due.at;
      due.callback();
    }
    now = until;
  };
  return { watcher, children, spawns, changes, advance, timers, current: () => children[children.length - 1] };
}

describe('the helper process', () => {
  it('is Windows PowerShell with no profile, no prompt, and the script as a command it cannot misquote', () => {
    const w = world();
    expect(w.spawns).toHaveLength(1);
    expect(w.spawns[0]?.command).toBe('powershell.exe');
    expect(w.spawns[0]?.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(w.spawns[0]?.args).toHaveLength(4);
    expect(Buffer.from(w.spawns[0]?.args[3] ?? '', 'base64').toString('utf16le')).toBe(FULLSCREEN_HELPER_SCRIPT);
  });

  it('is started right away by the watcher, and only once', () => {
    const w = world();
    w.advance(10_000);
    expect(w.spawns).toHaveLength(1);
    expect(w.children).toHaveLength(1);
  });
});

describe('the script it runs (the task: Add-Type with a P/Invoke of SHQueryUserNotificationState, every 1.5 s)', () => {
  it('polls every 1.5 s', () => {
    expect(FULLSCREEN_POLL_MS).toBe(1_500);
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('Start-Sleep -Milliseconds 1500');
  });

  it('declares the P/Invoke of shell32 with Add-Type', () => {
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('Add-Type -TypeDefinition');
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('[DllImport("shell32.dll")]');
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('SHQueryUserNotificationState(out int state)');
  });

  it('prints the state as a number, and a failed call as -1 (which the parser reads as "free")', () => {
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('$state = -1');
    expect(FULLSCREEN_HELPER_SCRIPT).toContain('$out.WriteLine($state)');
  });

  it('ends when nobody reads the pipe any more, so a helper whose parent died does not live on', () => {
    expect(FULLSCREEN_HELPER_SCRIPT).toMatch(/try \{ \$out\.WriteLine\(\$state\); \$out\.Flush\(\) \} catch \{ exit \}/);
  });

  it('closes the here-string where PowerShell wants it: `\'@` alone at the start of a line', () => {
    expect(FULLSCREEN_HELPER_SCRIPT.split('\n')).toContain("'@");
  });

  it('encodePowerShellCommand is the base64 of the UTF-16LE text, which is what -EncodedCommand reads', () => {
    expect(Buffer.from(encodePowerShellCommand('Write-Output "é"'), 'base64').toString('utf16le')).toBe('Write-Output "é"');
  });
});

describe('what it reports', () => {
  it('only CHANGES: the screen free at the start is not news, a full screen is, the same state again is not', () => {
    const w = world();
    w.current()?.say('5\r\n');
    expect(w.changes).toEqual([]);
    w.current()?.say('3\r\n');
    expect(w.changes).toEqual([true]);
    w.current()?.say('3\r\n2\r\n');
    expect(w.changes).toEqual([true]);
    w.current()?.say('5\r\n');
    expect(w.changes).toEqual([true, false]);
  });

  it('2, 3 and 4 are "an app has the whole screen"; everything else, and garbage, is free', () => {
    const w = world();
    w.current()?.say('2\r\n');
    w.current()?.say('1\r\n');
    w.current()?.say('4\r\n');
    w.current()?.say('lixo\r\n');
    w.current()?.say('3\r\n');
    w.current()?.say('-1\r\n');
    expect(w.changes).toEqual([true, false, true, false, true, false]);
  });

  it('reads a line that comes in pieces', () => {
    const w = world();
    w.current()?.say('3');
    expect(w.changes).toEqual([]);
    w.current()?.say('\r\n');
    expect(w.changes).toEqual([true]);
  });
});

describe('a helper that dies', () => {
  it('counts as "free": the Jobu is never left hidden by a watcher that does not know', () => {
    const w = world();
    w.current()?.say('3\r\n');
    expect(w.changes).toEqual([true]);
    w.current()?.die();
    expect(w.changes).toEqual([true, false]);
  });

  it('comes back after a wait, and the new process is read like the first one', () => {
    const w = world();
    w.current()?.die();
    expect(w.spawns).toHaveLength(1);
    w.advance(FULLSCREEN_RESTART_MIN_MS - 1);
    expect(w.spawns).toHaveLength(1);
    w.advance(1);
    expect(w.spawns).toHaveLength(2);
    w.current()?.say('4\r\n');
    expect(w.changes).toEqual([true]);
  });

  it('waits longer each time it dies young, up to a limit', () => {
    const w = world();
    const waits: number[] = [];
    for (let round = 0; round < 9; round += 1) {
      const before = w.spawns.length;
      w.current()?.die();
      let waited = 0;
      while (w.spawns.length === before && waited <= FULLSCREEN_RESTART_MAX_MS * 2) {
        w.advance(1_000);
        waited += 1_000;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    expect(FULLSCREEN_RESTART_MIN_MS).toBe(1_000);
    expect(FULLSCREEN_RESTART_MAX_MS).toBe(60_000);
  });

  it('forgets the bad times once a process lived long enough to count as working', () => {
    const w = world();
    w.current()?.die();
    w.advance(FULLSCREEN_RESTART_MIN_MS); // second process
    w.current()?.die();
    w.advance(2_000); // third process, after the doubled wait
    expect(w.spawns).toHaveLength(3);
    w.current()?.say('5\r\n');
    w.advance(FULLSCREEN_STABLE_MS);
    w.current()?.die();
    const before = w.spawns.length;
    w.advance(FULLSCREEN_RESTART_MIN_MS);
    expect(w.spawns).toHaveLength(before + 1); // back to the first wait, not the fourth
  });

  it('an error of the process is the same as its end, and both together do not make two restarts', () => {
    const w = world();
    const first = w.current();
    first?.die('error');
    first?.die('exit');
    w.advance(FULLSCREEN_RESTART_MIN_MS * 4);
    expect(w.spawns).toHaveLength(2);
  });

  it('a PowerShell that cannot even start is "free" too, and is tried again later', () => {
    const w = world({ spawnThrows: 2 });
    expect(w.spawns).toHaveLength(1);
    expect(w.changes).toEqual([]);
    w.advance(FULLSCREEN_RESTART_MIN_MS);
    expect(w.spawns).toHaveLength(2);
    w.advance(FULLSCREEN_RESTART_MIN_MS * 2);
    expect(w.spawns).toHaveLength(3);
    w.current()?.say('3\r\n');
    expect(w.changes).toEqual([true]);
  });

  it('what a dead process said late is not heard: only the live one counts', () => {
    const w = world();
    const old = w.current();
    old?.die();
    w.advance(FULLSCREEN_RESTART_MIN_MS);
    old?.say('3\r\n');
    expect(w.changes).toEqual([]);
    w.current()?.say('3\r\n');
    expect(w.changes).toEqual([true]);
  });
});

describe('stopping it', () => {
  it('kills the process and says nothing more, whatever it says', () => {
    const w = world();
    const child = w.current();
    w.watcher.stop();
    expect(child?.killed).toBe(true);
    child?.say('3\r\n');
    child?.die();
    expect(w.changes).toEqual([]);
  });

  it('cancels the restart that was waiting: a helper that died and was stopped never comes back', () => {
    const w = world();
    w.current()?.die();
    w.watcher.stop();
    w.advance(10 * 60_000);
    expect(w.spawns).toHaveLength(1);
    expect(w.timers).toHaveLength(0);
  });

  it('is harmless twice, and when the process is already dead', () => {
    const w = world();
    w.current()?.die();
    expect(() => {
      w.watcher.stop();
      w.watcher.stop();
    }).not.toThrow();
  });

  it('a stopped watcher does not start anything even if a timer fires late', () => {
    const w = world({ spawnThrows: 1 });
    w.watcher.stop();
    w.advance(10 * 60_000);
    expect(w.spawns).toHaveLength(1);
  });
});
