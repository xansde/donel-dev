// Faxineiro com gatilhos (t-b3b26e60) — the renderer asks the main for a round once a minute, with the open sessions
// it sees; the main adds the machines, the config and the memory, and answers whom to wake and which idle Faxineiro to
// close. The renderer reports back what it did, for the log.

import type { FaxineiroLogEntry, SessionView } from './triggers';

export const FAXINEIRO_CHANNELS = {
  /** Renderer → main (invoke): one round with the open sessions → `FaxineiroRoundAnswer`. */
  round: 'faxineiro:round',
  /** Renderer → main (send): lines for `<userData>/rotinas/faxineiro.log`. */
  log: 'faxineiro:log',
} as const;

export interface FaxineiroWakeOrder {
  readonly projectPath: string;
  readonly text: string;
  readonly reasons: readonly string[];
  /** Where the Faxineiro opens when it has no live tab: absent = this computer. */
  readonly remoteId?: string;
}

export interface FaxineiroRoundAnswer {
  readonly wakes: readonly FaxineiroWakeOrder[];
  readonly closeIdle: readonly { readonly projectPath: string; readonly placeId: string }[];
}

export interface DonelFaxineiroApi {
  round(sessions: readonly SessionView[]): Promise<FaxineiroRoundAnswer>;
  log(entries: readonly FaxineiroLogEntry[]): void;
}
