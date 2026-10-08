import { execSync } from 'node:child_process';
import { expect } from '@playwright/test';

// Real `tasklist` proof of process leaks: assertions use PID DIFFERENCES
// (snapshot before vs after one action), never absolute counts, because the
// machine runs many concurrent claude/powershell processes.

/** Live PIDs of `imageName` right now (CSV, no header: 2nd column is the PID). */
export function listPids(imageName: string): Set<number> {
  let output: string;
  try {
    output = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`, { encoding: 'utf8' });
  } catch {
    return new Set();
  }
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('"')) continue; // "INFO: No tasks..." when nothing is running
    const cols = trimmed.split('","').map((col) => col.replace(/^"|"$/g, ''));
    const pid = Number(cols[1]);
    if (Number.isFinite(pid)) pids.add(pid);
  }
  return pids;
}

/** New PIDs that appeared after `before`; retries until at least `minNew` (or exactly `minNew` when `exact`). */
export async function waitForNewPids(
  imageName: string,
  before: Set<number>,
  minNew: number,
  timeoutMs = 20_000,
  exact = false,
): Promise<number[]> {
  let added: number[] = [];
  await expect(async () => {
    added = [...listPids(imageName)].filter((pid) => !before.has(pid));
    if (exact) expect(added.length).toBe(minNew);
    else expect(added.length).toBeGreaterThanOrEqual(minNew);
  }).toPass({ timeout: timeoutMs });
  return added;
}

/** None of `pids` is alive anymore: the process really ended, not just the UI state. */
export async function waitForPidsGone(imageName: string, pids: number[], timeoutMs = 15_000): Promise<void> {
  await expect(async () => {
    const now = listPids(imageName);
    for (const pid of pids) expect(now.has(pid)).toBe(false);
  }).toPass({ timeout: timeoutMs });
}
