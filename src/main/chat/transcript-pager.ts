// T033 (014-chat) - backward pager of the transcript (research.md R11;
// conversation-rows.md §3.4). The file is NEVER read whole: blocks of 256 KB
// from the end, lines of up to 8 MB may cross blocks, and a page ends after
// 30 rounds OR 2 MB read, whichever comes first. The event loop is yielded
// between blocks so the main process never stalls.

import { promises as fs } from 'node:fs';
import { isRoundOpenerLine, MAX_LINE_BYTES } from '../../shared/chat/transcriptEntry';
import type { LineRef } from '../../shared/chat/rows';

export const PAGE_BLOCK_BYTES = 256 * 1024;
export const PAGE_MAX_ROUNDS = 30;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface PageOptions {
  /** Read the region [0, beforeOffset). Default: the whole file (first page). Must be a line start. */
  readonly beforeOffset?: number;
  readonly maxRounds?: number;
  /** Byte budget; checked between blocks, so a page may overshoot by one block / one line. */
  readonly maxBytes?: number;
  readonly blockBytes?: number;
  readonly maxLineBytes?: number;
  /** Text test that marks the line opening a round. Default: `isRoundOpenerLine`. */
  readonly isRoundStart?: (text: string) => boolean;
}

export interface PagedLine {
  /** Empty when `tooLarge`. */
  readonly text: string;
  readonly ref: LineRef;
  readonly tooLarge?: true;
}

export interface Page {
  /** Last line of the region FIRST (reverse file order). */
  readonly lines: readonly PagedLine[];
  /** Offset of the earliest returned line: pass as `beforeOffset` for the next page. */
  readonly startOffset: number;
  /**
   * End of the region that was paged. For the first page this is the end of the
   * last COMPLETE line (just after its `\\n`): where the forward follower starts.
   */
  readonly endOffset: number;
  /** The start of the file was reached. */
  readonly done: boolean;
  /** Bytes actually read from disk. */
  readonly bytesRead: number;
}

const NL = 0x0a;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function readPageBackward(path: string, opts: PageOptions = {}): Promise<Page> {
  const maxRounds = opts.maxRounds ?? PAGE_MAX_ROUNDS;
  const maxBytes = opts.maxBytes ?? PAGE_MAX_BYTES;
  const block = opts.blockBytes ?? PAGE_BLOCK_BYTES;
  const maxLine = opts.maxLineBytes ?? MAX_LINE_BYTES;
  const isRoundStart = opts.isRoundStart ?? isRoundOpenerLine;

  const fh = await fs.open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    const regionEnd = Math.min(opts.beforeOffset ?? size, size);
    // The segment after the last newline of the file is a line still being written.
    let dropTrailing = opts.beforeOffset === undefined;
    let endOffset = regionEnd;

    const lines: PagedLine[] = [];
    let rounds = 0;
    let bytesRead = 0;
    let stopped = false;

    // Current (unfinished) segment: pieces already read, in file order.
    let carry: Buffer[] = [];
    let carryLen = 0;
    let discarding = false; // segment exceeded maxLine: only its length is tracked

    const finish = (parts: Buffer[], absStart: number): void => {
      const length = parts.reduce((n, p) => n + p.length, 0) + carryLen;
      const pieces = [...parts, ...carry];
      carry = [];
      carryLen = 0;
      const wasDiscarding = discarding;
      discarding = false;
      if (dropTrailing) {
        dropTrailing = false;
        endOffset = absStart;
        return;
      }
      if (length === 0) return;
      const ref: LineRef = { path, offset: absStart, length };
      if (wasDiscarding || length > maxLine) {
        lines.push({ text: '', ref, tooLarge: true });
        return;
      }
      const text = Buffer.concat(pieces, length).toString('utf8');
      lines.push({ text, ref });
      if (isRoundStart(text)) {
        rounds += 1;
        if (rounds >= maxRounds) stopped = true;
      }
    };

    let pos = regionEnd;
    while (pos > 0 && !stopped) {
      const n = Math.min(block, pos);
      const buf = Buffer.allocUnsafe(n);
      pos -= n;
      let got = 0;
      while (got < n) {
        const { bytesRead: r } = await fh.read(buf, got, n - got, pos + got);
        if (r === 0) break;
        got += r;
      }
      bytesRead += got;

      let segEnd = got;
      let i = got > 0 ? buf.lastIndexOf(NL, got - 1) : -1;
      while (i >= 0 && !stopped) {
        finish([buf.subarray(i + 1, segEnd)], pos + i + 1);
        segEnd = i;
        i = i > 0 ? buf.lastIndexOf(NL, i - 1) : -1;
      }
      if (stopped) break;

      if (segEnd > 0) {
        if (discarding || carryLen + segEnd > maxLine) {
          discarding = true;
          carry = [];
          carryLen += segEnd; // length only
        } else {
          carry.unshift(buf.subarray(0, segEnd));
          carryLen += segEnd;
        }
      }
      if (bytesRead >= maxBytes && lines.length > 0) break;
      await yieldToLoop();
    }

    if (pos === 0 && !stopped) {
      // start of the file: whatever is left is the first line
      if (carryLen > 0 || dropTrailing) finish([], 0);
    }

    const startOffset = lines.length > 0 ? lines[lines.length - 1].ref.offset : pos === 0 ? 0 : endOffset;
    return { lines, startOffset, endOffset, done: startOffset === 0, bytesRead };
  } finally {
    await fh.close();
  }
}

/** Rereads one line by address (expanding a tool output, an image, a diff...). */
export async function readLineRef(ref: LineRef, maxBytes: number = MAX_LINE_BYTES): Promise<string> {
  if (ref.length > maxBytes) throw new Error(`line too large to read (${ref.length} > ${maxBytes} bytes)`);
  const fh = await fs.open(ref.path, 'r');
  try {
    const buf = Buffer.allocUnsafe(ref.length);
    let got = 0;
    while (got < ref.length) {
      const { bytesRead } = await fh.read(buf, got, ref.length - got, ref.offset + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    return buf.subarray(0, got).toString('utf8');
  } finally {
    await fh.close();
  }
}
