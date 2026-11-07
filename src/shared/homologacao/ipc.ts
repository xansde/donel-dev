// Mindscape de homologação V1 — the IPC contract of `window.donel.homologacao`. Read-only: no channel here writes
// anything on the factory's place.

import type { FactoryMetricsParse } from './factoryMetrics';
import type { RemoteFileState } from './remoteFile';

export const HOMOLOGACAO_CHANNELS = {
  /** invoke -> `FactoryMetricsView | null` (null = the `homologacao` key, or its `metricas`, is not in the config). */
  metricsGet: 'homologacao:metricsGet',
  /** invoke -> reads `metricas.json` now (unless a read is running) and resolves with the view. */
  metricsRefresh: 'homologacao:metricsRefresh',
  /** main -> renderer, after every read. */
  metricsChanged: 'homologacao:metricsChanged',
} as const;

export interface FactoryMetricsView {
  /** The board where the panel shows up (`homologacao.quadro`). */
  readonly board: string;
  /** The remote place of the config (`homologacao.lugar`). */
  readonly place: string;
  /** `false` = no remote place with that label or id: nothing is read. */
  readonly placeFound: boolean;
  readonly file: RemoteFileState<FactoryMetricsParse>;
}

export interface DonelHomologacaoApi {
  metricsGet(): Promise<FactoryMetricsView | null>;
  metricsRefresh(): Promise<FactoryMetricsView | null>;
  onMetricsChanged(listener: (view: FactoryMetricsView | null) => void): () => void;
}
