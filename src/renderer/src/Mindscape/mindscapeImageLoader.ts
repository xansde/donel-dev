/** What the screen knows about the file of a print. */
export type MindscapeImageEntry = { readonly status: 'loading' } | { readonly status: 'ready'; readonly url: string } | { readonly status: 'missing' };

export type MindscapeImageReadResult = { readonly ok: true; readonly bytes: Uint8Array; readonly mediaType: string } | { readonly ok: false };

export interface MindscapeImageLoaderPorts {
  /** `mindscape:read-image`. */
  read(imageId: string): Promise<MindscapeImageReadResult>;
  /** `URL.createObjectURL(new Blob(...))`. */
  createUrl(bytes: Uint8Array, mediaType: string): string;
  revokeUrl(url: string): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Waits before each new attempt of a print that failed: three more tries, then it stays missing. */
export const MINDSCAPE_IMAGE_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000];

interface ImageRecord {
  status: 'loading' | 'ready' | 'missing';
  url: string | null;
  failures: number;
  inFlight: boolean;
  timer: unknown;
}

/**
 * Mindscape desenho, fatia 06 — the `blob:` URL of each print on the board, outside React so it is tested
 * without a DOM (`tests/mindscape-image-loader.test.ts`).
 *
 * - One read per imageId at a time; a ready URL stays cached while the loader lives, and `dispose` revokes
 *   every URL it created. A read that resolves after `dispose` creates no URL.
 * - A read that fails shows `missing` at once (the dashed "imagem não encontrada" box) and tries again after
 *   each wait of `retryDelaysMs`; when they run out, the print stays missing. No loop: the only other way to
 *   new attempts is the print leaving the board and coming back (deleted and undone, board reloaded), which
 *   starts its count from zero.
 */
export class MindscapeImageLoader {
  private readonly records = new Map<string, ImageRecord>();
  private wanted: ReadonlySet<string> = new Set();
  private disposed = false;

  constructor(
    private readonly ports: MindscapeImageLoaderPorts,
    private readonly onChange: () => void,
    private readonly retryDelaysMs: readonly number[] = MINDSCAPE_IMAGE_RETRY_DELAYS_MS,
  ) {}

  /** The prints on the board now. New ones are read; a failed one that left forgets its failures. */
  want(imageIds: readonly string[]): void {
    if (this.disposed) return;
    this.wanted = new Set(imageIds);
    for (const [imageId, record] of this.records) {
      if (this.wanted.has(imageId) || record.status === 'ready' || record.inFlight) continue;
      this.ports.clearTimeout(record.timer);
      this.records.delete(imageId);
    }
    for (const imageId of this.wanted) {
      if (this.records.has(imageId)) continue;
      const record: ImageRecord = { status: 'loading', url: null, failures: 0, inFlight: false, timer: undefined };
      this.records.set(imageId, record);
      this.request(imageId, record);
    }
  }

  entry(imageId: string): MindscapeImageEntry {
    const record = this.records.get(imageId);
    if (record === undefined || record.status === 'loading') return { status: 'loading' };
    if (record.status === 'ready' && record.url !== null) return { status: 'ready', url: record.url };
    return { status: 'missing' };
  }

  dispose(): void {
    this.disposed = true;
    for (const record of this.records.values()) {
      this.ports.clearTimeout(record.timer);
      if (record.url !== null) this.ports.revokeUrl(record.url);
    }
    this.records.clear();
  }

  private request(imageId: string, record: ImageRecord): void {
    record.inFlight = true;
    record.timer = undefined;
    let read: Promise<MindscapeImageReadResult>;
    try {
      read = this.ports.read(imageId);
    } catch {
      read = Promise.resolve({ ok: false });
    }
    void read
      .catch((): MindscapeImageReadResult => ({ ok: false }))
      .then((result) => this.settle(imageId, record, result));
  }

  private settle(imageId: string, record: ImageRecord, result: MindscapeImageReadResult): void {
    if (this.disposed || this.records.get(imageId) !== record) return;
    record.inFlight = false;
    if (result.ok) {
      record.url = this.ports.createUrl(result.bytes, result.mediaType);
      record.status = 'ready';
      this.onChange();
      return;
    }
    record.failures += 1;
    if (!this.wanted.has(imageId)) {
      // Left the board while it was being read: forget it, so coming back is a fresh start.
      this.records.delete(imageId);
      return;
    }
    const changed = record.status !== 'missing';
    record.status = 'missing';
    if (changed) this.onChange();
    const wait = this.retryDelaysMs[record.failures - 1];
    if (wait === undefined) return;
    record.timer = this.ports.setTimeout(() => {
      record.timer = undefined;
      if (this.disposed || this.records.get(imageId) !== record || !this.wanted.has(imageId)) return;
      this.request(imageId, record);
    }, wait);
  }
}
