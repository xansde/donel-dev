// Hill climbing — IPC of `window.donel.hillClimb`. The main is the only writer of `hill-climb.json`; the
// renderer reads the snapshot (the left bar) and sends the owner's gestures on a closed rodada.

import type { HillClimbDoc, OwnerGesture } from './contract';
import type { CouncilStatus } from './council';

export const HILL_CLIMB_CHANNELS = {
  load: 'hillclimb:load',
  /** main → renderer push after every write (`HillClimbSnapshot`). */
  changed: 'hillclimb:changed',
  gesture: 'hillclimb:gesture',
} as const;

export interface HillClimbSnapshot {
  readonly doc: HillClimbDoc;
  /** A newer channel wrote the file, or it could not be read: it is shown, never written. */
  readonly readOnly: boolean;
  /** Why the file is read-only, in the owner's words; `null` = writable. */
  readonly warning: string | null;
  readonly council: CouncilStatus;
}

export interface HillClimbGestureRequest {
  readonly missionId: string;
  readonly gesture: OwnerGesture;
}

export type HillClimbGestureResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface DonelHillClimbApi {
  load(): Promise<HillClimbSnapshot>;
  onChanged(listener: (snapshot: HillClimbSnapshot) => void): () => void;
  gesture(request: HillClimbGestureRequest): Promise<HillClimbGestureResult>;
}
