// t-fe46929a — a run ended from outside (no quit path) must be named at the next boot; one that quit must not.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunTrail } from '../src/main/run-trail';

const dirs: string[] = [];
function markerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-trail-'));
  dirs.push(dir);
  return join(dir, 'main-running.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('run trail', () => {
  it('names the previous run, with the last minute it was alive, when it ended without quitting', () => {
    const path = markerPath();
    let clock = new Date('2026-11-16T05:00:00.000Z');
    const killed = createRunTrail(path, { pid: 111, version: '26.1114.1333', startedAtMs: Date.parse('2026-11-15T13:44:00.000Z') }, () => clock);
    expect(killed.start()).toBeNull();
    clock = new Date('2026-11-16T06:08:00.000Z');
    killed.beat();
    // ended from outside: no end()

    const next = createRunTrail(path, { pid: 222, version: '26.1114.1333', startedAtMs: Date.parse('2026-11-16T06:10:35.000Z') });
    expect(next.start()).toEqual({
      pid: 111,
      version: '26.1114.1333',
      startedAt: '2026-11-15T13:44:00.000Z',
      lastAliveAt: '2026-11-16T06:08:00.000Z',
    });
  });

  it('says nothing at the next boot when the previous run quit on its own path, and never throws on a bad file', () => {
    const path = markerPath();
    const quit = createRunTrail(path, { pid: 111, version: 'v', startedAtMs: 1 });
    quit.start();
    quit.end();
    quit.beat(); // a late heartbeat after the quit must not bring the file back
    expect(createRunTrail(path, { pid: 222, version: 'v', startedAtMs: 2 }).start()).toBeNull();

    writeFileSync(path, '{not json', 'utf8');
    expect(createRunTrail(path, { pid: 333, version: 'v', startedAtMs: 3 }).start()).toBeNull();
  });
});
