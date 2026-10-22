// T060 (015-jobu-pet, US5, FR-034/FR-035) - when the Jobu may show up in a screenshot or a screen share.
//
// By default the whole window of the pet (drawing, bubble, badge and list) is out of captures: the Windows
// display affinity of the window is `WDA_EXCLUDEFROMCAPTURE`, so a print, a recording or a Teams/Meet/Zoom
// share shows what is behind him (src/main/pet/pet-window.ts does the call; this file only decides WHEN).
// "Liberar print por 1 minuto" turns the protection off for 60 s and it comes back by itself, because the
// answer depends on the clock and nothing else; "Bloquear print agora" brings it back at once.
//
// `alwaysCapturable` is the test override (`DONEL_PET_CAPTURABLE=1`, read by src/main/pet/pet-seams.ts):
// the real screenshots of the documentation need the Jobu in the picture, so under it the protection is
// never on. It is not a release of the owner's and never shows up as one in the menu.
//
// Pure: no Electron, no timer, no `Date.now()`. The instant is an argument.

/** FR-035: how long "Liberar print" lasts. */
export const PET_CAPTURE_RELEASE_MS = 60_000;

export interface CaptureState {
  /** End of the release the owner asked for; `null` = protected (the default). */
  readonly releasedUntil: number | null;
  /** The test override: the protection is never on. */
  readonly alwaysCapturable: boolean;
}

export function createCaptureState(options: { readonly alwaysCapturable?: boolean } = {}): CaptureState {
  return { releasedUntil: null, alwaysCapturable: options.alwaysCapturable === true };
}

/** "Liberar print por 1 minuto": the minute counts from this click, also when a release was already on. */
export function releaseCapture(state: CaptureState, now: number): CaptureState {
  return { ...state, releasedUntil: now + PET_CAPTURE_RELEASE_MS };
}

/** "Bloquear print agora": the protection is back at once. */
export function blockCapture(state: CaptureState): CaptureState {
  return state.releasedUntil === null ? state : { ...state, releasedUntil: null };
}

/** The owner's release is on at `now` (the menu then offers "Bloquear print agora"). The override does not count. */
export function captureReleased(state: CaptureState, now: number): boolean {
  return state.releasedUntil !== null && now < state.releasedUntil;
}

/** The capture may show the Jobu at `now`: the owner released it, or the override is on. `false` is the protection. */
export function captureAllowed(state: CaptureState, now: number): boolean {
  return state.alwaysCapturable || captureReleased(state, now);
}
