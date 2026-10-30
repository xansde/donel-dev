// Saúde do computador - the gate in front of "Encerrar". Pure and tested (tests/health-kill-guard.test.ts).
// The renderer is not trusted: a pid is ended only when the LAST report offered to end it, and never
// when it is a Windows piece or the app itself (or a terminal/session the app opened).

import { collectAppPids, protectionReason } from '../../shared/health/protected';
import type { KillRefusal } from '../../shared/health/ipc';
import type { HealthReport, HealthSnapshot } from '../../shared/health/types';

export type KillCheck = { readonly ok: true; readonly pid: number; readonly name: string } | { readonly ok: false; readonly reason: KillRefusal };

export function checkKillRequest(pid: unknown, report: HealthReport | null, snapshot: HealthSnapshot | null): KillCheck {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'invalid-pid' };
  if (!report || !snapshot) return { ok: false, reason: 'no-report' };

  const offered = report.findings.find((finding) => finding.action?.kind === 'kill-process' && finding.action.pid === pid);
  if (!offered || offered.action?.kind !== 'kill-process') return { ok: false, reason: 'not-in-report' };
  const name = offered.action.name;

  // Re-checked here even though the analyzer never offers them: the guard does not rely on the analyzer.
  const appPids = collectAppPids(snapshot.processes, snapshot.ownPids);
  const protection = protectionReason(pid, name, appPids);
  if (protection === 'system') return { ok: false, reason: 'protected-system' };
  if (protection === 'own-app') return { ok: false, reason: 'own-app' };

  return { ok: true, pid, name };
}
