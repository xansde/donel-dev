import { useCallback, useEffect, useState } from 'react';
import type { HillClimbGestureResult, HillClimbSnapshot } from '../../../shared/hillClimb/channels';
import type { OwnerGesture } from '../../../shared/hillClimb/contract';

/** The missions snapshot (pushed by the main on every write) and the owner's gesture on a closed rodada. */
export function useHillClimb(): {
  snapshot: HillClimbSnapshot | null;
  gesture: (missionId: string, gesture: OwnerGesture) => Promise<HillClimbGestureResult>;
} {
  const [snapshot, setSnapshot] = useState<HillClimbSnapshot | null>(null);

  useEffect(() => {
    const api = window.donel.hillClimb;
    if (!api) return undefined;
    void api.load().then(setSnapshot).catch(() => undefined);
    return api.onChanged(setSnapshot);
  }, []);

  const gesture = useCallback(async (missionId: string, next: OwnerGesture): Promise<HillClimbGestureResult> => {
    const result = await window.donel.hillClimb.gesture({ missionId, gesture: next });
    // The push brings the new snapshot; reload anyway so a refused gesture still shows the latest state.
    void window.donel.hillClimb.load().then(setSnapshot).catch(() => undefined);
    return result;
  }, []);

  return { snapshot, gesture };
}
