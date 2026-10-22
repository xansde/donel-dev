// T061/T062 (015-jobu-pet, US5, FR-034) - the two TEST seams of the pet window, read from the environment.
// Like `DONEL_SMOKE_NOTIFICATIONS_LOG` and `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`, they exist for the smokes and for
// the real screenshots of the documentation and are off in the app the owner uses: only the exact value `1`
// turns one on.
//
// `DONEL_PET_SMOKE_INVISIBLE=1` - the ghost. The smokes run next to a person who is working, and a Jobu that
// pops up over that work, steals a click, takes the keyboard for the list or opens a native menu under the
// pointer is not a test, it is an interruption. In ghost mode the window has no opacity (the page, the CDP
// and the whole state go on exactly the same), never receives the mouse from the OS, never takes the focus,
// and the right-click menu is not shown: it is published in `globalThis.__donelPetSmoke` for the test to read
// and to choose from.
//
// `DONEL_PET_CAPTURABLE=1` - the protection against screen captures (FR-034) is never on, so the real prints of
// the documentation can show the Jobu. It is the override of `captureAllowed` (src/shared/pet/capture.ts).

export interface PetSeams {
  /** The window is a ghost for the OS: no pixels, no mouse, no focus, no native menu. */
  readonly ghost: boolean;
  /** The protection against screen captures is never on. */
  readonly capturable: boolean;
}

/**
 * What the ghost mode leaves in `globalThis.__donelPetSmoke` of the main process for a test to use through
 * `electronApp.evaluate`: the right-click menu the owner would have seen and the way to choose from it (the very
 * callback a click on an item runs), and the call the full-screen watcher makes when an app takes the screen.
 */
export interface PetSmokeHooks {
  menu?: {
    readonly entries: readonly import('../../shared/pet/menu').PetMenuEntry[];
    readonly choose: (action: import('../../shared/pet/menu').PetMenuAction) => void;
  } | null;
  setFullscreen?: (active: boolean) => void;
}

/** The slot of the hooks in the global object of the main process. */
export type PetSmokeGlobal = typeof globalThis & { __donelPetSmoke?: PetSmokeHooks };

export function readPetSeams(env: Readonly<Record<string, string | undefined>>): PetSeams {
  return {
    ghost: env.DONEL_PET_SMOKE_INVISIBLE === '1',
    capturable: env.DONEL_PET_CAPTURABLE === '1',
  };
}
