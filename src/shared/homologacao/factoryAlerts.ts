// Mindscape de homologação — what is wrong with the factory's numbers, from what the factory wrote and from the
// read itself: shared by the numbers panel (fatia 1) and the board's band (fatia 4), so both count the same thing.
// The Donel judges no number: a lock is broken only when the factory wrote `travaRompida: true`. Pure.

import { FACTORY_METRICS_STALE_MS } from './factoryMetrics';
import type { FactoryMetricsView } from './ipc';

export function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export interface FreshnessLine {
  readonly tone: 'ok' | 'stale' | 'down';
  readonly line: string;
  readonly generatedAt: number | null;
}

/** "sem sinal" (the place or the file did not answer), "parado" (the file is older than 2 h) or "atualizado". */
export function freshnessOf(view: FactoryMetricsView, now: number): FreshnessLine | null {
  const { file } = view;
  const parsed = file.value;
  const generatedAt = parsed?.kind === 'ok' ? parsed.generatedAt : null;
  if (file.status === 'unreachable' || file.status === 'missing') {
    const why = file.status === 'missing' ? 'o arquivo não está lá' : `${view.place} não respondeu`;
    return { tone: 'down', generatedAt, line: file.lastOkAt === null ? `sem sinal: ${why}` : `sem sinal desde ${hhmm(file.lastOkAt)}: ${why}` };
  }
  if (generatedAt === null) return null;
  const stale = now - generatedAt > FACTORY_METRICS_STALE_MS;
  return { tone: stale ? 'stale' : 'ok', generatedAt, line: stale ? `parado desde ${hhmm(generatedAt)}` : `atualizado às ${hhmm(generatedAt)}` };
}

export interface Alert {
  readonly level: 'problema' | 'atencao';
  readonly text: string;
  /** The card to bring into view. */
  readonly metricId?: string;
}

/** What is wrong, from what the factory wrote and from the read itself; the Donel judges no number. */
export function alertsOf(view: FactoryMetricsView, now: number): Alert[] {
  const alerts: Alert[] = [];
  const fresh = freshnessOf(view, now);
  const parsed = view.file.value;
  if (!view.placeFound) alerts.push({ level: 'problema', text: `lugar “${view.place}” não encontrado` });
  if (fresh?.tone === 'down') alerts.push({ level: 'problema', text: fresh.line });
  if (parsed?.kind === 'unsupported') alerts.push({ level: 'problema', text: `formato ${parsed.format}: nenhum número mostrado` });
  if (parsed?.kind === 'invalid') alerts.push({ level: 'problema', text: 'arquivo fora do contrato: nenhum número mostrado' });
  if (parsed?.kind === 'ok') {
    for (const metric of parsed.metrics) if (metric.lockBroken) alerts.push({ level: 'problema', text: `trava rompida: ${metric.name}`, metricId: metric.id });
  }
  if (fresh?.tone === 'stale') alerts.push({ level: 'atencao', text: fresh.line });
  if (parsed?.kind === 'ok') {
    for (const metric of parsed.metrics) if (metric.unknownOrigin) alerts.push({ level: 'atencao', text: `origem desconhecida: ${metric.name}`, metricId: metric.id });
    if (parsed.outOfContract.length > 0) {
      const count = parsed.outOfContract.length;
      alerts.push({ level: 'atencao', text: `${count} ite${count === 1 ? 'm' : 'ns'} fora do contrato` });
    }
  }
  return alerts;
}
