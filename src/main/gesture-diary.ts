// Diário de gestos (rules 9–11 of docs/refinamentos/mindscape-lugar-principal.md) — the single
// writer of `<userData>/aprendizado/gestos-AAAA-MM.jsonl`. Append only, one event per line, never
// throws: a failed write is logged and dropped (the diary must never get in the owner's way).
// Writes are chained so two events never interleave inside the same line.

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gestureFileName, gestureLine, type GestureEvent } from '../shared/learning/gestures';

export interface GestureDiaryDeps {
  /** `<userData>/aprendizado`. */
  readonly dir: string;
  readonly appendFile?: (path: string, data: string) => Promise<void>;
  readonly mkdir?: (path: string) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface GestureDiary {
  record(event: GestureEvent): Promise<void>;
}

export function createGestureDiary(deps: GestureDiaryDeps): GestureDiary {
  const append = deps.appendFile ?? ((path, data) => appendFile(path, data, 'utf8'));
  const makeDir = deps.mkdir ?? (async (path) => void (await mkdir(path, { recursive: true })));
  const log = deps.log ?? ((line) => console.error(line));
  let chain: Promise<void> = Promise.resolve();
  let dirReady = false;
  return {
    record(event) {
      chain = chain.then(async () => {
        try {
          if (!dirReady) {
            await makeDir(deps.dir);
            dirReady = true;
          }
          await append(join(deps.dir, gestureFileName(event.at)), gestureLine(event));
        } catch (error) {
          log(`[donel-dev] diário de gestos: falha ao gravar (${error instanceof Error ? error.message : String(error)})`);
        }
      });
      return chain;
    },
  };
}
