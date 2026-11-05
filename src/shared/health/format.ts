// Saúde do computador - the short line of the status bar. Pure.

import { formatBytes } from '../format-bytes';
import type { HealthReport } from './types';
import type { KillRefusal } from './ipc';

/** `PC · RAM 96% · disco 85 GB`: RAM in use, disk free. Without a report, `PC · —`. */
export function formatHealthIndicator(report: HealthReport | null): string {
  if (!report) return 'PC · —';
  const parts = ['PC'];
  if (report.ram.totalBytes > 0) {
    const used = 1 - report.ram.freeBytes / report.ram.totalBytes;
    parts.push(`RAM ${Math.round(used * 100)}%`);
  }
  if (report.disk) parts.push(`disco ${formatBytes(report.disk.freeBytes)}`);
  return parts.join(' · ');
}

export function formatKillRefusal(reason: KillRefusal): string {
  switch (reason) {
    case 'invalid-pid':
    case 'not-in-report':
    case 'no-report':
      return 'Esse processo não está mais na lista. Atualize e tente de novo.';
    case 'protected-system':
      return 'Esse é um processo do Windows; encerrar ele derrubaria o computador.';
    case 'own-app':
      return 'Esse processo é do próprio Donel Dev ou de uma sessão aberta nele. Feche a aba em vez disso.';
    case 'changed':
      return 'O processo já terminou ou o número dele agora é de outro programa. Nada foi encerrado.';
    case 'failed':
      return 'O Windows não deixou encerrar esse processo (pode já ter terminado ou exigir administrador).';
  }
}
