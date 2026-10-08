// T033 (014-chat) - forward follower of the transcript (research.md R11;
// conversation-rows.md §3.5). Reads ONLY the bytes appended since the last
// read (by offset), keeps the rest of an incomplete line, coalesces bursts with
// a 50 ms debounce, waits for a file (or directory) that is born later, and can
// be re-pointed to another file (`/clear`, `/resume`: R12).
//
// Read-only: it never writes and never reads the file whole. Chunks of 256 KB
// are delivered one batch at a time, yielding to the event loop in between.

import { promises as fs, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { LineRef } from '../../shared/chat/rows';
import { MAX_LINE_BYTES } from '../../shared/chat/transcriptEntry';

export interface FollowedLine {
  /** Complete line without the trailing `\n`. Empty when `tooLarge`. */
  readonly text: string;
  readonly ref: LineRef;
  readonly tooLarge?: true;
}

export interface FollowBatch {
  readonly lines: readonly FollowedLine[];
  /**
   * `true` on the first batch after a `repoint` or after the file shrank: the
   * consumer must restart its timeline from these lines.
   */
  readonly reset: boolean;
  /** Resume point after this batch (see `TranscriptFollower.forward`). */
  readonly forward: { readonly offset: number; readonly partial: string };
}

export interface TranscriptFollowerOptions {
  readonly path: string;
  /** Where to start reading. Default 0. Must be a line start (the pager's `endOffset`). */
  readonly offset?: number;
  readonly onBatch: (batch: FollowBatch) => void;
  readonly onError?: (err: unknown) => void;
  /** Coalescing window for write bursts. Default 50 ms (R11). */
  readonly debounceMs?: number;
  /** Retry interval while the directory cannot be watched yet. Default 250 ms. */
  readonly retryMs?: number;
  /** Safety poll in case the OS misses a change. 0 = off. Default 1000 ms. */
  readonly pollMs?: number;
  readonly chunkBytes?: number;
  readonly maxLineBytes?: number;
}

const NL = 0x0a;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class TranscriptFollower {
  private path: string;
  private readonly onBatch: (b: FollowBatch) => void;
  private readonly onError: (e: unknown) => void;
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly pollMs: number;
  private readonly chunk: number;
  private readonly maxLine: number;

  /** Bytes consumed from the file (end of the last chunk read). */
  private readEnd: number;
  /** Offset where the current incomplete line starts. */
  private lineStart: number;
  private pending: Buffer[] = [];
  private pendingLen = 0;
  private discarding = false;
  private resetNext = false;

  private gen = 0;
  private running = false;
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private total = 0;

  constructor(opts: TranscriptFollowerOptions) {
    this.path = opts.path;
    this.onBatch = opts.onBatch;
    this.onError = opts.onError ?? (() => undefined);
    this.debounceMs = opts.debounceMs ?? 50;
    this.retryMs = opts.retryMs ?? 250;
    this.pollMs = opts.pollMs ?? 1000;
    this.chunk = opts.chunkBytes ?? 256 * 1024;
    this.maxLine = opts.maxLineBytes ?? MAX_LINE_BYTES;
    this.readEnd = opts.offset ?? 0;
    this.lineStart = this.readEnd;
  }

  /** Total bytes read from disk since construction (diagnostics / "never whole" tests). */
  get bytesRead(): number {
    return this.total;
  }

  /**
   * Safe resume point: the start of the first line not delivered yet. The
   * incomplete line is NOT included (it is re-read), so no multi-byte split can
   * corrupt it. Matches `ConversationSource.forward` with an empty `partial`.
   */
  forward(): { offset: number; partial: string } {
    return { offset: this.lineStart, partial: '' };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.gen += 1;
    this.arm();
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.gen += 1;
    this.disarm();
  }

  /** Points the follower at another file; the next batch carries `reset: true`. */
  repoint(path: string, offset = 0): void {
    this.gen += 1;
    this.path = path;
    this.readEnd = offset;
    this.lineStart = offset;
    this.clearPending();
    this.resetNext = true;
    if (this.running) {
      this.disarm();
      this.arm();
      this.schedule(0);
    }
  }

  /** Reads what is on disk now (no debounce). Resolves when that read finished. */
  readNow(): Promise<void> {
    const gen = this.gen;
    this.queue = this.queue.then(() => this.readOnce(gen)).catch((err) => this.onError(err));
    return this.queue;
  }

  // ---------------------------------------------------------------------------

  private arm(): void {
    this.watchDir();
    if (this.pollMs > 0) {
      this.pollTimer = setInterval(() => this.schedule(this.debounceMs), this.pollMs);
      this.pollTimer.unref?.();
    }
  }

  private disarm(): void {
    if (this.watcher !== null) {
      try {
        this.watcher.close();
      } catch {
        /* already closed */
      }
      this.watcher = null;
    }
    for (const t of [this.debounceTimer, this.retryTimer]) if (t !== null) clearTimeout(t);
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
    this.pollTimer = null;
  }

  private watchDir(): void {
    if (!this.running) return;
    const gen = this.gen;
    const dir = dirname(this.path);
    const name = basename(this.path);
    try {
      const w = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename === null || filename === undefined || filename.toString() === name) this.schedule(this.debounceMs);
      });
      w.on('error', () => {
        try {
          w.close();
        } catch {
          /* ignore */
        }
        if (this.watcher === w) this.watcher = null;
        this.retryWatch(gen);
      });
      this.watcher = w;
    } catch {
      this.retryWatch(gen); // directory does not exist yet
    }
  }

  private retryWatch(gen: number): void {
    if (!this.running || gen !== this.gen) return;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.running || gen !== this.gen) return;
      this.watchDir();
      this.schedule(0);
    }, this.retryMs);
    this.retryTimer.unref?.();
  }

  /** Throttled trigger: the first event of a burst arms one read `delay` ms later. */
  private schedule(delay: number): void {
    if (!this.running || this.debounceTimer !== null) return;
    const gen = this.gen;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.running || gen !== this.gen) return;
      void this.readNow();
    }, delay);
    this.debounceTimer.unref?.();
  }

  private clearPending(): void {
    this.pending = [];
    this.pendingLen = 0;
    this.discarding = false;
  }

  private async readOnce(gen: number): Promise<void> {
    if (gen !== this.gen) return;
    let fh: fs.FileHandle;
    try {
      fh = await fs.open(this.path, 'r');
    } catch {
      return; // not born yet: the watcher / poll will call again
    }
    try {
      const size = (await fh.stat()).size;
      if (size < this.readEnd) {
        // truncated or replaced by a shorter file
        this.readEnd = 0;
        this.lineStart = 0;
        this.clearPending();
        this.resetNext = true;
      }
      while (this.readEnd < size) {
        if (gen !== this.gen) return;
        const n = Math.min(this.chunk, size - this.readEnd);
        const buf = Buffer.allocUnsafe(n);
        let got = 0;
        while (got < n) {
          const { bytesRead } = await fh.read(buf, got, n - got, this.readEnd + got);
          if (bytesRead === 0) break;
          got += bytesRead;
        }
        if (gen !== this.gen) return;
        if (got === 0) break;
        this.total += got;
        this.readEnd += got;
        const lines = this.consume(buf.subarray(0, got));
        if (lines.length > 0 || this.resetNext) {
          const reset = this.resetNext;
          this.resetNext = false;
          this.onBatch({ lines, reset, forward: this.forward() });
        }
        await yieldToLoop();
      }
    } finally {
      await fh.close();
    }
  }

  /** Splits a chunk into complete lines; the tail stays in `pending`. */
  private consume(buf: Buffer): FollowedLine[] {
    const out: FollowedLine[] = [];
    let start = 0;
    for (;;) {
      const i = buf.indexOf(NL, start);
      if (i < 0) break;
      const part = buf.subarray(start, i);
      const length = this.pendingLen + part.length;
      const pieces = this.pending;
      const wasDiscarding = this.discarding;
      const absStart = this.lineStart;
      this.clearPending();
      this.lineStart = absStart + length + 1;
      start = i + 1;
      if (length === 0) continue;
      const ref: LineRef = { path: this.path, offset: absStart, length };
      if (wasDiscarding || length > this.maxLine) {
        out.push({ text: '', ref, tooLarge: true });
      } else {
        out.push({ text: Buffer.concat([...pieces, part], length).toString('utf8'), ref });
      }
    }
    const tail = buf.subarray(start);
    if (tail.length > 0) {
      if (this.discarding || this.pendingLen + tail.length > this.maxLine) {
        this.discarding = true;
        this.pending = [];
        this.pendingLen += tail.length;
      } else {
        this.pending.push(Buffer.from(tail)); // copy: `buf` is reused by nobody, but do not pin the chunk
        this.pendingLen += tail.length;
      }
    }
    return out;
  }
}
