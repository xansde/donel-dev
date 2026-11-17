// Espelho do Oráculo — the cards for the phone (t-36a99827). After the tasks, the sink sends the whole list of cards
// waiting for the owner to `celular_cartas_gravar` (an RPC in `public`, run only by the service key: the schema
// `celular` stays out of the API), then uploads, one at a time, only the proof files the answer asks for
// (`celular_prova_gravar`, base64, checked by sha256 on the other side). A print up to 5 MB and a prototype up to 2 MB
// go as bytes; a video, a bigger file or a missing one goes as a mention (`sem_arquivo`) and the phone says "só no
// Oráculo". The prototype is masked as text before its hash (the hash is of what goes up); a print cannot be scanned.

import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { MAX_PROOF_HTML_BYTES, isProofFileName } from '../../shared/ledger/contract';
import { maskSecrets, type CartaProvaRef, type CartaProvaTipo, type CartaRow } from '../../shared/ledger/mirror';

/** The biggest print that goes to the phone as bytes (the app reads it over the database connection). */
export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;
/** The biggest prototype that goes as bytes: the same 2 MB a prototype may have. */
export const MAX_CARD_PROTOTYPE_BYTES = MAX_PROOF_HTML_BYTES;

export type ProofRead = { readonly kind: 'ok'; readonly bytes: Buffer } | { readonly kind: 'grande'; readonly size: number } | { readonly kind: 'sumiu' };

/** Reads `file` (a name inside `ledger-provas/`) when it has at most `maxBytes`; never follows a link. */
export type ProofReader = (file: string, maxBytes: number) => Promise<ProofRead>;

export interface ProofStat {
  isFile(): boolean;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
}

export interface ProofFileHandle {
  stat(): Promise<ProofStat>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ProofReaderFs {
  lstat(path: string): Promise<ProofStat & { isSymbolicLink(): boolean }>;
  /** Read-only; refuses a link where the OS can (O_NOFOLLOW) and never waits on a FIFO (O_NONBLOCK). */
  open(path: string): Promise<ProofFileHandle>;
}

// Windows has neither flag (`undefined` there): the same-file check below covers the link there.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

const nodeProofReaderFs: ProofReaderFs = {
  lstat: (path) => fs.lstat(path),
  open: async (path) => {
    const handle = await fs.open(path, OPEN_FLAGS);
    return {
      stat: () => handle.stat(),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      close: () => handle.close(),
    };
  },
};

/** The reader over `ledger-provas/` (the main's own copies; in the remote mode, the ones `syncProofs` brought). */
export function createProofReader(proofsDir: string, io: ProofReaderFs = nodeProofReaderFs): ProofReader {
  return async (file, maxBytes) => {
    // Only a name the main gave: no folder, no `..`, a known extension.
    if (!isProofFileName(file)) return { kind: 'sumiu' };
    const path = join(proofsDir, file);
    let handle: ProofFileHandle | null = null;
    try {
      const seen = await io.lstat(path);
      if (seen.isSymbolicLink() || !seen.isFile()) return { kind: 'sumiu' };
      if (seen.size > maxBytes) return { kind: 'grande', size: seen.size };
      // The look and the read are about the same file: what is open is still that regular file (not a link, a
      // device or a FIFO swapped in since the look), and at most `maxBytes + 1` is read from it.
      handle = await io.open(path);
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== seen.dev || info.ino !== seen.ino) return { kind: 'sumiu' };
      if (info.size > maxBytes) return { kind: 'grande', size: info.size };
      const buffer = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      // It grew between the look and the read.
      if (total > maxBytes) return { kind: 'grande', size: total };
      return { kind: 'ok', bytes: Buffer.from(buffer.subarray(0, total)) };
    } catch {
      return { kind: 'sumiu' };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };
}

/** One proof as `celular_cartas_gravar` receives it (no file name, no bytes). */
export interface ProvaWire {
  readonly ordem: number;
  readonly tipo: CartaProvaTipo;
  readonly media_type: string;
  readonly rotulo: string;
  /** Hex sha256 of the bytes that go up; `null` when no bytes go (`sem_arquivo`). */
  readonly sha256: string | null;
  /** Bytes of what goes up (or of the file too big to go); `null` = unknown (a video, a missing file). */
  readonly tamanho: number | null;
  readonly sem_arquivo: boolean;
}

export type CartaWire = Omit<CartaRow, 'provas'> & { readonly provas: readonly ProvaWire[] };

export interface PreparedProof {
  readonly sha256: string | null;
  readonly tamanho: number | null;
  readonly sem_arquivo: boolean;
  readonly bytes?: Buffer;
  /** What the prototype's scan replaced (kinds only). */
  readonly kinds: readonly string[];
  /** A prototype in no text encoding the scan can read: it goes only as a mention. */
  readonly undecodable?: true;
}

const noBytes = (tamanho: number | null): PreparedProof => ({ sha256: null, tamanho, sem_arquivo: true, kinds: [] });

/**
 * The prototype as text, by its byte-order mark (UTF-16 is what the Windows PowerShell `>` writes), else strict
 * UTF-8. `null` when it is neither, or has a NUL: UTF-16 without a mark passes as "valid" UTF-8 with a NUL between
 * every letter, where no pattern matches and the secret would go up unmasked.
 */
export function decodeHtml(bytes: Buffer): string | null {
  try {
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      if (bytes.length % 2 !== 0) return null;
      text = new TextDecoder('utf-16le', { fatal: true }).decode(Buffer.from(bytes).swap16());
    } else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

/** The bytes of a proof as they go up: a prototype masked and always in UTF-8, the hash of the result. */
export async function prepareProof(ref: CartaProvaRef, read: ProofReader): Promise<PreparedProof> {
  if (ref.tipo === 'video') return noBytes(null);
  const max = ref.tipo === 'prototipo' ? MAX_CARD_PROTOTYPE_BYTES : MAX_CARD_IMAGE_BYTES;
  const got = await read(ref.file, max);
  if (got.kind === 'sumiu') return noBytes(null);
  if (got.kind === 'grande') return noBytes(got.size);
  let bytes = got.bytes;
  let kinds: string[] = [];
  if (ref.tipo === 'prototipo') {
    const text = decodeHtml(bytes);
    if (text === null) return { ...noBytes(bytes.length), undecodable: true };
    const masked = maskSecrets(text);
    kinds = [...new Set(masked.hits.map((hit) => hit.kind))];
    bytes = Buffer.from(masked.text, 'utf8');
    if (bytes.length > max) return { ...noBytes(bytes.length), kinds };
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), tamanho: bytes.length, sem_arquivo: false, bytes, kinds };
}

/** The failed uploads of one content (`tarefa`, `ordem`, `sha256`): how many, and not before when to try again. */
export interface UploadFailure {
  readonly count: number;
  readonly until: number;
}

/** After this many failures of the same bytes the upload stops until the file changes (a body the API refuses). */
export const MAX_PROOF_UPLOAD_FAILURES = 4;
const PROOF_RETRY_MS = 60_000;
const MAX_PROOF_RETRY_MS = 30 * 60_000;

export interface CartasPushDeps {
  /** POST `/rest/v1/rpc/<fn>` with the service key; resolves to the parsed JSON answer, rejects free of secrets. */
  readonly rpc: (fn: string, body: unknown) => Promise<unknown>;
  readonly read: ProofReader;
  readonly log: (line: string) => void;
  /**
   * file → what was computed for it. A proof file never changes once in `ledger-provas/` (the main names it once and
   * writes it exclusively), so a push reads only the new ones, and the upload checks the hash again.
   */
  readonly cache: Map<string, PreparedProof>;
  /** `tarefa\nordem\nsha256` → its failed uploads, kept between pushes (the sink's). */
  readonly failures: Map<string, UploadFailure>;
  readonly now: () => number;
  /** A newer list is waiting: stop uploading for this one (that list asks again for what is still missing). */
  readonly stale?: () => boolean;
}

export interface CartasPushResult {
  /** Something may still go on a later try: a file not on this PC yet, an upload that failed or waits its turn. */
  readonly incomplete: boolean;
}

export const CARTAS_RPC = 'celular_cartas_gravar';
export const PROVA_RPC = 'celular_prova_gravar';

function wanted(answer: unknown): Array<{ tarefa: string; ordem: number }> {
  if (!Array.isArray(answer)) throw new Error(`${CARTAS_RPC} respondeu fora do formato`);
  return answer.flatMap((item: unknown) => {
    const { tarefa, ordem } = (item ?? {}) as { tarefa?: unknown; ordem?: unknown };
    return typeof tarefa === 'string' && typeof ordem === 'number' ? [{ tarefa, ordem }] : [];
  });
}

const uploadKey = (tarefa: string, ordem: number, sha: string): string => `${tarefa}\n${ordem}\n${sha}`;

/**
 * Sends the whole list (an empty one clears the phone), then the bytes it asks for. Rejects only when the list does
 * not go; a proof that fails is logged and the next ones still go, and the same bytes are not sent again before
 * their backoff, nor after `MAX_PROOF_UPLOAD_FAILURES`.
 */
export async function pushCartas(cartas: readonly CartaRow[], deps: CartasPushDeps): Promise<CartasPushResult> {
  const keyOf = (ref: CartaProvaRef): string => `${ref.tipo}\n${ref.file}`;
  const inUse = new Set<string>();
  const wire: CartaWire[] = [];
  // A file not on this PC yet (in the remote mode the copy may still be on its way from the VPS): try again later.
  let incomplete = false;
  for (const carta of cartas) {
    const provas: ProvaWire[] = [];
    for (const ref of carta.provas) {
      const key = keyOf(ref);
      inUse.add(key);
      let prepared: PreparedProof | undefined = deps.cache.get(key);
      if (!prepared) {
        prepared = await prepareProof(ref, deps.read);
        if (prepared.kinds.length > 0) deps.log(`mascarado: tarefa ${carta.id}, campo prova ${ref.ordem} (protótipo) (${prepared.kinds.join(', ')})`);
        if (prepared.undecodable) deps.log(`protótipo fora de UTF-8/UTF-16: tarefa ${carta.id}, prova ${ref.ordem} vai só como menção`);
        // Never keep the bytes between pushes: the upload reads them again. A missing file is looked for again.
        const missing = prepared.sem_arquivo && prepared.tamanho === null && ref.tipo !== 'video';
        if (missing) incomplete = true;
        else deps.cache.set(key, { sha256: prepared.sha256, tamanho: prepared.tamanho, sem_arquivo: prepared.sem_arquivo, kinds: prepared.kinds });
      }
      provas.push({ ordem: ref.ordem, tipo: ref.tipo, media_type: ref.media_type, rotulo: ref.rotulo, sha256: prepared.sha256, tamanho: prepared.tamanho, sem_arquivo: prepared.sem_arquivo });
    }
    const { provas: _refs, ...card } = carta;
    wire.push({ ...card, provas });
  }
  for (const key of [...deps.cache.keys()]) if (!inUse.has(key)) deps.cache.delete(key);
  const current = new Set(wire.flatMap((carta) => carta.provas.flatMap((prova) => (prova.sha256 ? [uploadKey(carta.id, prova.ordem, prova.sha256)] : []))));
  for (const key of [...deps.failures.keys()]) if (!current.has(key)) deps.failures.delete(key);

  const asked = wanted(await deps.rpc(CARTAS_RPC, { p_cartas: wire }));
  for (const { tarefa, ordem } of asked) {
    if (deps.stale?.()) return { incomplete: true };
    const ref = cartas.find((carta) => carta.id === tarefa)?.provas.find((prova) => prova.ordem === ordem);
    const sent = wire.find((carta) => carta.id === tarefa)?.provas.find((prova) => prova.ordem === ordem);
    if (!ref || !sent || sent.sem_arquivo || !sent.sha256) continue;
    const failKey = uploadKey(tarefa, ordem, sent.sha256);
    const failed = deps.failures.get(failKey);
    if (failed && failed.count >= MAX_PROOF_UPLOAD_FAILURES) continue; // given up until the file changes
    if (failed && deps.now() < failed.until) {
      incomplete = true;
      continue;
    }
    try {
      const prepared = await prepareProof(ref, deps.read);
      if (!prepared.bytes || prepared.sha256 !== sent.sha256) {
        // The file changed or left since the list went: the next try sends its new state.
        deps.cache.delete(keyOf(ref));
        incomplete = true;
        continue;
      }
      const ok = await deps.rpc(PROVA_RPC, { p_tarefa: tarefa, p_ordem: ordem, p_sha256: prepared.sha256, p_dados: prepared.bytes.toString('base64') });
      if (ok !== true) throw new Error('o Supabase recusou');
      deps.failures.delete(failKey);
      deps.log(`prova enviada ao celular: tarefa ${tarefa}, prova ${ordem} (${prepared.tamanho} bytes)`);
    } catch (error) {
      const count = (failed?.count ?? 0) + 1;
      deps.failures.set(failKey, { count, until: deps.now() + Math.min(PROOF_RETRY_MS * 2 ** (count - 1), MAX_PROOF_RETRY_MS) });
      const reason = error instanceof Error ? error.message : 'falhou';
      if (count >= MAX_PROOF_UPLOAD_FAILURES) {
        deps.log(`prova não foi ao celular: tarefa ${tarefa}, prova ${ordem} (${reason}); desisto dela até o arquivo mudar`);
      } else {
        incomplete = true;
        deps.log(`prova não foi ao celular: tarefa ${tarefa}, prova ${ordem} (${reason}); tento de novo depois`);
      }
    }
  }
  return { incomplete };
}
