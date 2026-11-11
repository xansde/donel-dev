// Registro do main — `<userData>/main-events.log`, one line per event that ends or hurts the app's window: the
// renderer gone, the window not answering, a child process gone (GPU, utility), the main window closed, the quit.
// 10/11: the window vanished with no dump and no Application Error, and the app had written nothing anywhere, so
// the reason could not be proved. Writing never throws: a full disk must not take the app down with it.

import { appendFileSync, renameSync, statSync } from 'node:fs';

/** Past this size the file moves to `.1` (the older `.1` is dropped), so the log never grows without bound. */
export const MAIN_EVENTS_LOG_MAX_BYTES = 1_000_000;

export type MainEventLogger = (event: string, detail?: Readonly<Record<string, unknown>>) => void;

export function createMainEventsLog(path: string, now: () => Date = () => new Date()): MainEventLogger {
  return (event, detail) => {
    try {
      try {
        if (statSync(path).size > MAIN_EVENTS_LOG_MAX_BYTES) renameSync(path, `${path}.1`);
      } catch {
        // no file yet
      }
      const line = `${now().toISOString()} ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}\n`;
      appendFileSync(path, line, 'utf8');
    } catch (error) {
      console.error('[donel-dev] main-events.log não foi gravado:', error);
    }
  };
}
