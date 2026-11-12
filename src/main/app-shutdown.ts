// Fechamento do app — every step of the teardown runs on its own, and the app quits at the end no matter what.
// 10/11: the window of the Donel vanished and the main process stayed alive for hours with no window. The
// `window-all-closed` handler ran a dozen `dispose()`/`stop()` before `app.quit()`; one of them throwing was enough
// for the quit never to happen. Pure of Electron: the caller passes the steps and the quit.

/** One step of the teardown: a name for the log and the call (a returned promise is not awaited, only watched). */
export type ShutdownStep = readonly [name: string, run: () => unknown];

/** Runs every step even when one throws (or its promise rejects), reporting each failure to `onError`. */
export function runShutdownSteps(steps: readonly ShutdownStep[], onError: (name: string, error: unknown) => void): void {
  for (const [name, run] of steps) {
    try {
      const result = run();
      if (result instanceof Promise) result.catch((error: unknown) => onError(name, error));
    } catch (error) {
      onError(name, error);
    }
  }
}

/** The teardown, then `quit` — always, even when a step throws or `onError` itself throws. */
export function shutdownThenQuit(
  steps: readonly ShutdownStep[],
  deps: { readonly quit: () => void; readonly onError: (name: string, error: unknown) => void },
): void {
  try {
    runShutdownSteps(steps, (name, error) => {
      try {
        deps.onError(name, error);
      } catch {
        // a failing log never holds the quit back
      }
    });
  } finally {
    deps.quit();
  }
}
