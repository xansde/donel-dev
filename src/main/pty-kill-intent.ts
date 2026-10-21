// T015 (015-jobu-pet, C3/R6) - did the owner close the tab, or did the process leave on its own?
// `PtyManager.kill` keeps no intent and its exit listener only gets `(id, exitCode, signal)`. The
// `pty:kill` handler marks the ptyId here before it kills; the exit listener consumes the mark and
// passes `byUser` on. "Retomar" and "Reabrir" go through the same kill, so they count as the owner's.
// An exit nobody marked (the CLI quit, crashed, or `/exit` was typed) is "encerrou".

const killRequested = new Set<string>();

export function markKillRequested(ptyId: string): void {
  killRequested.add(ptyId);
}

/** `true` once per mark: the first consume of a marked ptyId, then `false` again. */
export function consumeKillRequested(ptyId: string): boolean {
  return killRequested.delete(ptyId);
}
