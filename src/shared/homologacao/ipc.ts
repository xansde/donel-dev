// Mindscape de homologação V1 — the IPC contract of `window.donel.homologacao`. Read-only: no channel here writes
// anything on the factory's place.

import type { FactoryMetricsParse } from './factoryMetrics';
import type { RigsParse } from './rigs';
import type { RemoteFileState } from './remoteFile';

export const HOMOLOGACAO_CHANNELS = {
  /** invoke -> `FactoryMetricsView | null` (null = the `homologacao` key, or its `metricas`, is not in the config). */
  metricsGet: 'homologacao:metricsGet',
  /** invoke -> reads `metricas.json` now (unless a read is running) and resolves with the view. */
  metricsRefresh: 'homologacao:metricsRefresh',
  /** main -> renderer, after every read. */
  metricsChanged: 'homologacao:metricsChanged',
  /** invoke -> `FactoryRigsView | null` (null = the `homologacao` key, or its `rigs`, is not in the config). */
  rigsGet: 'homologacao:rigsGet',
  /** invoke -> reads `rigs.json` now (unless a read is running) and resolves with the view. */
  rigsRefresh: 'homologacao:rigsRefresh',
  /** main -> renderer, after every read. */
  rigsChanged: 'homologacao:rigsChanged',
} as const;

/** Fatia 2 — the shape of the factory's rigs, as the factory describes itself in `rigs.json` (decision D1). */
export interface FactoryRigsView {
  /** The board whose "Cadeiras" lens draws the rigs (`homologacao.quadro`). */
  readonly board: string;
  readonly place: string;
  readonly placeFound: boolean;
  readonly file: RemoteFileState<RigsParse>;
}

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
  rigsGet(): Promise<FactoryRigsView | null>;
  rigsRefresh(): Promise<FactoryRigsView | null>;
  onRigsChanged(listener: (view: FactoryRigsView | null) => void): () => void;
}
