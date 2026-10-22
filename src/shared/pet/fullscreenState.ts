// T045/T050 (015-jobu-pet, US5, R10/FR-007) - what the full-screen helper prints, as data. The helper
// (src/main/pet/fullscreen-watcher.ts) is a long-lived PowerShell that asks `SHQueryUserNotificationState`
// (shell32) every 1.5 s and prints the state as a number, one per line. These values hide the Jobu:
//
//   2  QUNS_BUSY                      a full-screen app is running, or Presentation Settings are on
//   3  QUNS_RUNNING_D3D_FULL_SCREEN   a Direct3D full-screen game
//   4  QUNS_PRESENTATION_MODE         presentation mode
//
// Anything else leaves him on screen: not present (1), accepts notifications (5), quiet time (6), an app (7),
// a failed call (the helper prints -1) and plain garbage. A helper that does not know must never leave the
// Jobu hidden, so "I could not tell" is always "free". Pure: no Electron, no process, no clock.

/** The `SHQueryUserNotificationState` values (2, 3 and 4) that mean an app has the whole screen. */
const HIDING_LINE = /^[2-4]$/;

/** More than this without a line break is not a number: the helper is lost, and the line is dropped as garbage. */
const MAX_LINE_LENGTH = 4096;

/** One line of the helper's output: `true` = an app has the whole screen. Only a line that is exactly 2, 3 or 4 counts. */
export function parseFullscreenLine(line: string): boolean {
  return HIDING_LINE.test(line.trim());
}

export interface FullscreenParser {
  /**
   * Feeds a chunk of the helper's stdout and returns one answer per COMPLETE line, in order. The tail of a
   * line that is not finished stays until its break arrives. A blank line is no event; a line of garbage
   * is `false` ("free").
   */
  push(chunk: string | { toString(): string }): boolean[];
}

export function createFullscreenParser(): FullscreenParser {
  let tail = '';
  /** The line being read grew past the limit and was dropped: when its break arrives it counts as garbage. */
  let overflowed = false;

  return {
    push(chunk) {
      const lines = (tail + chunk.toString()).split('\n');
      tail = lines.pop() ?? '';
      const answers: boolean[] = [];
      for (const line of lines) {
        if (overflowed) {
          overflowed = false;
          answers.push(false);
        } else if (line.trim() !== '') {
          answers.push(parseFullscreenLine(line));
        }
      }
      if (tail.length > MAX_LINE_LENGTH) {
        tail = '';
        overflowed = true;
      }
      return answers;
    },
  };
}
