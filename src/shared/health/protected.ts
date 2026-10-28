// Saúde do computador - which processes the panel never offers to end. Pure; used by the analyzer (no
// "Encerrar" button on them) and by the main's kill guard (refuses them even if asked).

import type { ProcessSample } from './types';

/**
 * Windows pieces that keep the session alive: ending one logs the user out or crashes the machine.
 * Lower case, without `.exe`.
 */
export const PROTECTED_PROCESS_NAMES: ReadonlySet<string> = new Set([
  'system',
  'idle',
  'system idle process',
  'registry',
  'memory compression',
  'secure system',
  'svchost',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'lsaiso',
  'smss',
  'explorer',
  'dwm',
  'fontdrvhost',
  'msmpeng',
  'nissrv',
]);

/** `Node.EXE` -> `node`. */
export function normalizeProcessName(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/, '');
}

export function isProtectedSystemProcess(pid: number, name: string): boolean {
  // pid 0 is the idle process and 4 is the kernel ("System") on every Windows.
  if (pid === 0 || pid === 4) return true;
  return PROTECTED_PROCESS_NAMES.has(normalizeProcessName(name));
}

/**
 * The app's own pids plus every descendant of them in `processes` (the terminals and the `claude`
 * sessions the app opened). A child whose parent pid matches is counted even if the parent looks
 * reused: on doubt, protect.
 */
export function collectAppPids(processes: readonly ProcessSample[], ownPids: readonly number[]): ReadonlySet<number> {
  const result = new Set<number>(ownPids);
  const childrenOf = new Map<number, number[]>();
  for (const process of processes) {
    if (process.pid === process.parentPid) continue;
    const list = childrenOf.get(process.parentPid);
    if (list) list.push(process.pid);
    else childrenOf.set(process.parentPid, [process.pid]);
  }
  const queue = [...ownPids];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of childrenOf.get(pid) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

export type ProtectionReason = 'system' | 'own-app';

/** Why `pid` must never be ended, or `null` when it may. */
export function protectionReason(pid: number, name: string, appPids: ReadonlySet<number>): ProtectionReason | null {
  if (isProtectedSystemProcess(pid, name)) return 'system';
  if (appPids.has(pid)) return 'own-app';
  return null;
}
