// T032 (014-chat) - disk readers of the transcript: forward follower and
// backward pager (research.md R11; conversation-rows.md §3.4/§3.5).
// Real temp files; the transcript is NEVER read whole.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptFollower, type FollowBatch, type FollowedLine } from '../src/main/chat/transcript-follower';
import { readLineRef, readPageBackward } from '../src/main/chat/transcript-pager';
import { pollUntil, realDelay } from './helpers/fsWatchWait';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-chat-io-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Conditioned waits (see helpers/fsWatchWait.ts). Where a test needs "the
// follower has already looked at the file and found nothing", it awaits
// `follower.readNow()` (serialised on the follower's own read queue) instead
// of sleeping a fixed time.
// The waits poll a condition, so a generous ceiling costs nothing when the disk is fast; under a
// loaded parallel suite the watcher/debounce chain can take seconds. Kept below IO_TEST_TIMEOUT_MS
// so a real miss still fails with the waitFor message, not a bare vitest timeout.
const waitFor = (cond: () => boolean, timeoutMs = 10_000): Promise<void> => pollUntil(cond, timeoutMs);
// These tests write and read real files of up to tens of MB (each ~0.3-0.7 s on an idle machine);
// vitest's 5 s default was too tight with the whole suite competing for the same disk and CPU.
const IO_TEST_TIMEOUT_MS = 30_000;
// Only for "nothing more must arrive" windows after `stop()`/late writes, where
// there is no event to wait for; kept above 3x the 20 ms debounce.
const quietFor = realDelay;

function collector(): { batches: FollowBatch[]; lines: () => FollowedLine[]; onBatch: (b: FollowBatch) => void } {
  const batches: FollowBatch[] = [];
  return { batches, lines: () => batches.flatMap((b) => [...b.lines]), onBatch: (b) => batches.push(b) };
}

const userLine = (n: number, pad = 0): string =>
  JSON.stringify({ type: 'user', uuid: `u-${n}`, turnOrigin: 'human', promptSource: 'typed', message: { role: 'user', content: `prompt ${n}${'x'.repeat(pad)}` } });
const asstLine = (n: number, pad = 0): string =>
  JSON.stringify({ type: 'assistant', uuid: `a-${n}`, message: { id: `m-${n}`, content: [{ type: 'text', text: `resp ${n}${'y'.repeat(pad)}` }] } });

// ---------------------------------------------------------------------------
// follower
// ---------------------------------------------------------------------------

describe('TranscriptFollower - forward by offset', { timeout: IO_TEST_TIMEOUT_MS }, () => {
  it('delivers appended lines with a LineRef that re-reads exactly the line', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await waitFor(() => c.lines().length === 1);
    appendFileSync(path, `${asstLine(1)}\n${userLine(2)}\n`);
    await waitFor(() => c.lines().length === 3);
    f.stop();

    const lines = c.lines();
    expect(lines.map((l) => l.text)).toEqual([userLine(1), asstLine(1), userLine(2)]);
    for (const l of lines) {
      expect(l.ref.path).toBe(path);
      expect(await readLineRef(l.ref)).toBe(l.text);
    }
    expect(lines[1].ref.offset).toBe(Buffer.byteLength(userLine(1)) + 1);
  });

  it('starts from a given offset and ignores what is before it', async () => {
    const path = join(dir, 's.jsonl');
    const first = `${userLine(1)}\n${asstLine(1)}\n`;
    writeFileSync(path, first);
    const c = collector();
    const f = new TranscriptFollower({ path, offset: Buffer.byteLength(first), onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await f.readNow();
    expect(c.lines()).toHaveLength(0);
    appendFileSync(path, `${userLine(2)}\n`);
    await waitFor(() => c.lines().length === 1);
    f.stop();
    expect(c.lines()[0].text).toBe(userLine(2));
    expect(c.lines()[0].ref.offset).toBe(Buffer.byteLength(first));
  });

  it('keeps the rest of an incomplete line until it is finished', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await waitFor(() => c.lines().length === 1);

    const full = asstLine(1);
    const cut = Math.floor(full.length / 2);
    appendFileSync(path, full.slice(0, cut));
    await f.readNow();
    expect(c.lines()).toHaveLength(1); // nothing delivered yet
    // resume point = start of the incomplete line, never inside it
    expect(f.forward()).toEqual({ offset: Buffer.byteLength(userLine(1)) + 1, partial: '' });

    appendFileSync(path, `${full.slice(cut)}\n`);
    await waitFor(() => c.lines().length === 2);
    f.stop();
    expect(c.lines()[1].text).toBe(full);
    expect(c.lines()[1].ref.offset).toBe(Buffer.byteLength(userLine(1)) + 1);
    expect(await readLineRef(c.lines()[1].ref)).toBe(full);
  });

  it('does not corrupt a multi-byte character split between two reads', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, '');
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    const line = Buffer.from(`${JSON.stringify({ type: 'user', t: 'ação é ü' })}\n`, 'utf8');
    const cut = line.indexOf(0xc3) + 1; // in the middle of the first 2-byte char
    appendFileSync(path, line.subarray(0, cut));
    await f.readNow();
    appendFileSync(path, line.subarray(cut));
    await waitFor(() => c.lines().length === 1);
    f.stop();
    expect(JSON.parse(c.lines()[0].text).t).toBe('ação é ü');
  });

  it('coalesces a burst of writes into one batch (debounce 50 ms)', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, '');
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch }); // default debounce = 50 ms
    f.start();
    await f.readNow();
    for (let i = 0; i < 10; i += 1) appendFileSync(path, `${userLine(i)}\n`);
    await waitFor(() => c.lines().length === 10);
    // No trailing sleep: the 10th line only shows up once its batch was delivered,
    // so a split burst would already be visible in `c.batches` here.
    f.stop();
    expect(c.batches.filter((b) => b.lines.length > 0)).toHaveLength(1);
  });

  it('waits for a file that is born later (directory exists, file does not)', async () => {
    const path = join(dir, 'later.jsonl');
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20, retryMs: 30 });
    f.start();
    await f.readNow();
    expect(c.lines()).toHaveLength(0);
    writeFileSync(path, `${userLine(1)}\n`);
    await waitFor(() => c.lines().length === 1);
    f.stop();
    expect(c.lines()[0].ref.offset).toBe(0);
  });

  it('waits for a directory that is born later too', async () => {
    const sub = join(dir, 'proj', 'nested');
    const path = join(sub, 'late.jsonl');
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20, retryMs: 30 });
    f.start();
    await f.readNow();
    mkdirSync(sub, { recursive: true });
    writeFileSync(path, `${userLine(1)}\n`);
    await waitFor(() => c.lines().length === 1);
    f.stop();
  });

  it('repoint: follows the new file from the start and forgets the old one', async () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, `${userLine(1)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path: a, onBatch: c.onBatch, debounceMs: 20, retryMs: 30 });
    f.start();
    await waitFor(() => c.lines().length === 1);

    f.repoint(b); // b is born ~50 ms later (as in /clear)
    await f.readNow(); // reads the (still missing) new file: nothing yet
    appendFileSync(a, `${userLine(99)}\n`); // late write to the old file must be ignored
    writeFileSync(b, `${userLine(2)}\n${asstLine(2)}\n`);
    await waitFor(() => c.lines().length === 3);
    await quietFor(60);
    f.stop();

    const texts = c.lines().map((l) => l.text);
    expect(texts).toEqual([userLine(1), userLine(2), asstLine(2)]);
    const afterRepoint = c.batches.find((b2) => b2.lines.some((l) => l.text === userLine(2)));
    expect(afterRepoint?.reset).toBe(true);
    expect(c.lines()[1].ref.path).toBe(b);
    expect(c.lines()[1].ref.offset).toBe(0);
  });

  it('a truncated or replaced file restarts from the beginning (reset batch)', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n${userLine(2)}\n${userLine(3)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await waitFor(() => c.lines().length === 3);
    writeFileSync(path, `${asstLine(9)}\n`); // shorter than before
    await waitFor(() => c.lines().length === 4);
    f.stop();
    expect(c.lines()[3].text).toBe(asstLine(9));
    expect(c.batches[c.batches.length - 1].reset).toBe(true);
  });

  it('reports lines above maxLineBytes as tooLarge (no text) and keeps going', async () => {
    const path = join(dir, 's.jsonl');
    const huge = userLine(2, 5000);
    writeFileSync(path, `${userLine(1)}\n${huge}\n${userLine(3)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20, maxLineBytes: 1000, chunkBytes: 512 });
    f.start();
    await waitFor(() => c.lines().length === 3);
    f.stop();
    const [l1, l2, l3] = c.lines();
    expect(l1.text).toBe(userLine(1));
    expect(l2.tooLarge).toBe(true);
    expect(l2.text).toBe('');
    expect(l2.ref.length).toBe(Buffer.byteLength(huge));
    expect(l2.ref.offset).toBe(Buffer.byteLength(userLine(1)) + 1);
    expect(l3.text).toBe(userLine(3));
  });

  it('never reads the whole file when it starts near the end', async () => {
    const path = join(dir, 'big.jsonl');
    const body = Array.from({ length: 3000 }, (_, i) => userLine(i, 1000)).join('\n');
    writeFileSync(path, `${body}\n`);
    const size = Buffer.byteLength(body) + 1;
    const c = collector();
    const f = new TranscriptFollower({ path, offset: size - 2000, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await f.readNow();
    appendFileSync(path, `${asstLine(1)}\n`);
    await waitFor(() => c.lines().some((l) => l.text === asstLine(1)));
    f.stop();
    expect(size).toBeGreaterThan(3_000_000);
    expect(f.bytesRead).toBeLessThan(size / 100);
  });

  it('reads a long catch-up in chunks, in order, and yields batches per chunk', async () => {
    const path = join(dir, 'big.jsonl');
    const lines = Array.from({ length: 400 }, (_, i) => userLine(i, 2000));
    writeFileSync(path, `${lines.join('\n')}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20, chunkBytes: 64 * 1024 });
    f.start();
    await waitFor(() => c.lines().length === 400);
    f.stop();
    expect(c.lines().map((l) => l.text)).toEqual(lines);
    expect(c.batches.length).toBeGreaterThan(5);
    expect(f.bytesRead).toBe(Buffer.byteLength(lines.join('\n')) + 1);
  });

  it('stop() is idempotent and silences further batches', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 20 });
    f.start();
    await waitFor(() => c.lines().length === 1);
    f.stop();
    f.stop();
    appendFileSync(path, `${userLine(2)}\n`);
    await quietFor(80);
    expect(c.lines()).toHaveLength(1);
  });

  it('readNow() forces a read without waiting for the watcher', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n`);
    const c = collector();
    const f = new TranscriptFollower({ path, onBatch: c.onBatch, debounceMs: 10_000, pollMs: 0 });
    // not started: only manual reads
    await f.readNow();
    expect(c.lines()).toHaveLength(1);
    appendFileSync(path, `${userLine(2)}\n`);
    await f.readNow();
    expect(c.lines()).toHaveLength(2);
    f.stop();
  });
});

// ---------------------------------------------------------------------------
// pager
// ---------------------------------------------------------------------------

function writeRounds(path: string, rounds: number, pad = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < rounds; i += 1) {
    out.push(userLine(i, pad), asstLine(i, pad));
  }
  writeFileSync(path, `${out.join('\n')}\n`);
  return out;
}

describe('readPageBackward', { timeout: IO_TEST_TIMEOUT_MS }, () => {
  it('returns lines in reverse order with exact refs', async () => {
    const path = join(dir, 's.jsonl');
    const all = writeRounds(path, 5);
    const page = await readPageBackward(path);
    expect(page.lines.map((l) => l.text)).toEqual([...all].reverse());
    expect(page.done).toBe(true);
    expect(page.startOffset).toBe(0);
    for (const l of page.lines) expect(await readLineRef(l.ref)).toBe(l.text);
  });

  it('stops at 30 rounds and does not read the whole file', async () => {
    const path = join(dir, 's.jsonl');
    const all = writeRounds(path, 200, 3000); // ~1.2 MB
    const page = await readPageBackward(path);
    const openers = page.lines.filter((l) => l.text.includes('"type":"user"'));
    expect(openers).toHaveLength(30);
    expect(page.lines[page.lines.length - 1].text).toBe(userLine(170, 3000)); // the 30th opener from the end
    expect(page.done).toBe(false);
    expect(page.startOffset).toBe(page.lines[page.lines.length - 1].ref.offset);
    expect(page.bytesRead).toBeLessThan(Buffer.byteLength(all.join('\n')) / 2);
  });

  it('chains pages with beforeOffset until the start of the file, losing nothing', async () => {
    const path = join(dir, 's.jsonl');
    const all = writeRounds(path, 100, 500);
    const got: string[] = [];
    let before: number | undefined;
    let pages = 0;
    for (;;) {
      const page = await readPageBackward(path, { beforeOffset: before });
      got.push(...page.lines.map((l) => l.text));
      pages += 1;
      if (page.done) break;
      before = page.startOffset;
      expect(pages).toBeLessThan(50);
    }
    expect(pages).toBeGreaterThan(2);
    expect(got).toEqual([...all].reverse());
  });

  it('stops at the byte budget (2 MB) when no round boundary shows up', async () => {
    const path = join(dir, 's.jsonl');
    const lines = Array.from({ length: 80 }, (_, i) => asstLine(i, 100_000)); // 8 MB of assistant lines
    writeFileSync(path, `${lines.join('\n')}\n`);
    const size = Buffer.byteLength(lines.join('\n')) + 1;
    const page = await readPageBackward(path);
    expect(page.done).toBe(false);
    expect(page.bytesRead).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    expect(page.bytesRead).toBeLessThan(2 * 1024 * 1024 + 2 * 256 * 1024 + 100_100);
    expect(page.bytesRead).toBeLessThan(size / 2);
    expect(page.lines.length).toBeGreaterThan(10);
    expect(page.lines.length).toBeLessThan(30);
  });

  it('reads a line that crosses several 256 KB blocks intact', async () => {
    const path = join(dir, 's.jsonl');
    const big = userLine(7, 700_000);
    const lines = [userLine(1), big, asstLine(7)];
    writeFileSync(path, `${lines.join('\n')}\n`);
    const page = await readPageBackward(path);
    expect(page.lines.map((l) => l.text)).toEqual([...lines].reverse());
    expect(page.lines[1].ref.offset).toBe(Buffer.byteLength(userLine(1)) + 1);
    expect(page.lines[1].ref.length).toBe(Buffer.byteLength(big));
  });

  it('reads a 5 MB line (blocks of 256 KB) and keeps the neighbours', async () => {
    const path = join(dir, 's.jsonl');
    const big = asstLine(3, 5 * 1024 * 1024);
    const lines = [userLine(1), asstLine(1), userLine(2), big, userLine(4)];
    writeFileSync(path, `${lines.join('\n')}\n`);
    const page = await readPageBackward(path, { maxRounds: 100, maxBytes: 64 * 1024 * 1024 });
    expect(page.lines.map((l) => l.text)).toEqual([...lines].reverse());
    expect(page.lines[1].tooLarge).toBeUndefined();
  });

  it('flags a line above 8 MB as tooLarge (no text, exact ref) and still reads the lines around it', async () => {
    const path = join(dir, 's.jsonl');
    const big = asstLine(3, 9 * 1024 * 1024);
    const lines = [userLine(1), big, userLine(4)];
    writeFileSync(path, `${lines.join('\n')}\n`);
    const page = await readPageBackward(path, { maxRounds: 100, maxBytes: 64 * 1024 * 1024 });
    expect(page.lines).toHaveLength(3);
    expect(page.lines[0].text).toBe(userLine(4));
    expect(page.lines[1].tooLarge).toBe(true);
    expect(page.lines[1].text).toBe('');
    expect(page.lines[1].ref.offset).toBe(Buffer.byteLength(userLine(1)) + 1);
    expect(page.lines[1].ref.length).toBe(Buffer.byteLength(big));
    expect(page.lines[2].text).toBe(userLine(1));
  });

  it('ignores an incomplete last line and reports where the forward follower must start', async () => {
    const path = join(dir, 's.jsonl');
    const complete = `${userLine(1)}\n${asstLine(1)}\n`;
    writeFileSync(path, `${complete}{"type":"assistant","message":{"id":"cut`);
    const page = await readPageBackward(path);
    expect(page.lines.map((l) => l.text)).toEqual([asstLine(1), userLine(1)]);
    expect(page.endOffset).toBe(Buffer.byteLength(complete));
  });

  it('endOffset is the file size when the file ends with a newline', async () => {
    const path = join(dir, 's.jsonl');
    writeRounds(path, 2);
    const page = await readPageBackward(path);
    expect(page.endOffset).toBe(Buffer.byteLength(`${[userLine(0), asstLine(0), userLine(1), asstLine(1)].join('\n')}\n`));
  });

  it('handles an empty file and a file with no newline at all', async () => {
    const empty = join(dir, 'e.jsonl');
    writeFileSync(empty, '');
    expect(await readPageBackward(empty)).toMatchObject({ lines: [], done: true, startOffset: 0, endOffset: 0 });
    const partial = join(dir, 'p.jsonl');
    writeFileSync(partial, '{"type":"us');
    expect(await readPageBackward(partial)).toMatchObject({ lines: [], done: true, endOffset: 0 });
  });

  it('decodes multi-byte characters that straddle block boundaries', async () => {
    const path = join(dir, 's.jsonl');
    const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ type: 'assistant', uuid: `a-${i}`, t: 'ação é ü 日本語'.repeat(5) }));
    writeFileSync(path, `${lines.join('\n')}\n`);
    for (const blockBytes of [7, 13, 64, 101]) {
      const page = await readPageBackward(path, { blockBytes, maxRounds: 1000 });
      expect(page.lines.map((l) => l.text)).toEqual([...lines].reverse());
    }
  });

  it('skips blank lines', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n\n\n${asstLine(1)}\n`);
    const page = await readPageBackward(path);
    expect(page.lines.map((l) => l.text)).toEqual([asstLine(1), userLine(1)]);
  });

  it('counts rounds with a custom predicate', async () => {
    const path = join(dir, 's.jsonl');
    const lines = Array.from({ length: 10 }, (_, i) => asstLine(i));
    writeFileSync(path, `${lines.join('\n')}\n`);
    const page = await readPageBackward(path, { maxRounds: 3, isRoundStart: (t) => t.includes('"uuid":"a-5"') || t.includes('"uuid":"a-3"') || t.includes('"uuid":"a-1"') });
    expect(page.lines[page.lines.length - 1].text).toBe(asstLine(1));
    expect(page.lines).toHaveLength(9);
  });

  it('reads the real fixtures: first page has the last round and a usable endOffset', async () => {
    const path = join(__dirname, 'fixtures', 'chat', 'edge-incomplete-last.jsonl');
    const page = await readPageBackward(path);
    expect(page.done).toBe(true);
    expect(page.lines.length).toBeGreaterThan(0);
    expect(page.lines.every((l) => l.text.startsWith('{') && l.text.endsWith('}'))).toBe(true);
    const big = await readPageBackward(join(__dirname, 'fixtures', 'chat', 'edge-big-line.jsonl'));
    expect(big.lines.some((l) => l.ref.length > 1_000_000)).toBe(true);
  });
});

describe('readLineRef', { timeout: IO_TEST_TIMEOUT_MS }, () => {
  it('rereads a line by path, offset and length', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1)}\n${asstLine(1)}\n`);
    const off = Buffer.byteLength(userLine(1)) + 1;
    expect(await readLineRef({ path, offset: off, length: Buffer.byteLength(asstLine(1)) })).toBe(asstLine(1));
  });

  it('refuses to read more than the given cap', async () => {
    const path = join(dir, 's.jsonl');
    writeFileSync(path, `${userLine(1, 5000)}\n`);
    await expect(readLineRef({ path, offset: 0, length: 6000 }, 1000)).rejects.toThrow(/too large/i);
  });
});
