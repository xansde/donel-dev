// Espelho do Oráculo — the cards for the phone (t-36a99827). After the tasks, the sink sends the whole list of cards
// waiting for the owner to `celular_cartas_gravar` (an RPC in `public`, run only by the service key: the schema
// `celular` stays out of the API), then uploads, one at a time, only the proof files the answer asks for
// (`celular_prova_gravar`, base64, checked by sha256 on the other side). A print up to 5 MB and a prototype up to 2 MB
// go as bytes; a video, a bigger file or a missing one goes as a mention (`sem_arquivo`) and the phone says "só no
// Oráculo". The prototype is masked as text before its hash (the hash is of what goes up); a print cannot be scanned.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
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

export interface ProofReaderFs {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; size: number }>;
  readFile(path: string): Promise<Buffer>;
}

const nodeProofReaderFs: ProofReaderFs = { lstat: (path) => fs.lstat(path), readFile: (path) => fs.readFile(path) };

/** The reader over `ledger-provas/` (the main's own copies; in the remote mode, the ones `syncProofs` brought). */
export function createProofReader(proofsDir: string, io: ProofReaderFs = nodeProofReaderFs): ProofReader {
  return async (file, maxBytes) => {
    // Only a name the main gave: no folder, no `..`, a known extension.
    if (!isProofFileName(file)) return { kind: 'sumiu' };
    const path = join(proofsDir, file);
    try {
      const info = await io.lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) return { kind: 'sumiu' };
      if (info.size > maxBytes) return { kind: 'grande', size: info.size };
      const bytes = await io.readFile(path);
      // It grew between the look and the read.
      return bytes.length > maxBytes ? { kind: 'grande', size: bytes.length } : { kind: 'ok', bytes };
    } catch {
      return { kind: 'sumiu' };
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
}

const noBytes = (tamanho: number | null): PreparedProof => ({ sha256: null, tamanho, sem_arquivo: true, kinds: [] });

/** The bytes of a proof as they go up: a prototype masked, the hash of the result. */
export async function prepareProof(ref: CartaProvaRef, read: ProofReader): Promise<PreparedProof> {
  if (ref.tipo === 'video') return noBytes(null);
  const max = ref.tipo === 'prototipo' ? MAX_CARD_PROTOTYPE_BYTES : MAX_CARD_IMAGE_BYTES;
  const got = await read(ref.file, max);
  if (got.kind === 'sumiu') return noBytes(null);
  if (got.kind === 'grande') return noBytes(got.size);
  let bytes = got.bytes;
  let kinds: string[] = [];
  if (ref.tipo === 'prototipo') {
    const masked = maskSecrets(bytes.toString('utf8'));
    if (masked.hits.length > 0) {
      bytes = Buffer.from(masked.text, 'utf8');
      kinds = [...new Set(masked.hits.map((hit) => hit.kind))];
      if (bytes.length > max) return { ...noBytes(bytes.length), kinds };
    }
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), tamanho: bytes.length, sem_arquivo: false, bytes, kinds };
}

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

/** Sends the whole list (an empty one clears the phone), then the bytes it asks for. Rejects on the first failure. */
export async function pushCartas(cartas: readonly CartaRow[], deps: CartasPushDeps): Promise<void> {
  const keyOf = (ref: CartaProvaRef): string => `${ref.tipo}\n${ref.file}`;
  const inUse = new Set<string>();
  const wire: CartaWire[] = [];
  for (const carta of cartas) {
    const provas: ProvaWire[] = [];
    for (const ref of carta.provas) {
      const key = keyOf(ref);
      inUse.add(key);
      let prepared: PreparedProof | undefined = deps.cache.get(key);
      if (!prepared) {
        prepared = await prepareProof(ref, deps.read);
        if (prepared.kinds.length > 0) deps.log(`mascarado: tarefa ${carta.id}, campo prova ${ref.ordem} (protótipo) (${prepared.kinds.join(', ')})`);
        // Never keep the bytes between pushes: the upload reads them again. A missing file is looked for again next
        // time (in the remote mode the copy may still be on its way from the VPS).
        const missing = prepared.sem_arquivo && prepared.tamanho === null && ref.tipo !== 'video';
        if (!missing) deps.cache.set(key, { sha256: prepared.sha256, tamanho: prepared.tamanho, sem_arquivo: prepared.sem_arquivo, kinds: prepared.kinds });
      }
      provas.push({ ordem: ref.ordem, tipo: ref.tipo, media_type: ref.media_type, rotulo: ref.rotulo, sha256: prepared.sha256, tamanho: prepared.tamanho, sem_arquivo: prepared.sem_arquivo });
    }
    const { provas: _refs, ...card } = carta;
    wire.push({ ...card, provas });
  }
  for (const key of [...deps.cache.keys()]) if (!inUse.has(key)) deps.cache.delete(key);

  const asked = wanted(await deps.rpc(CARTAS_RPC, { p_cartas: wire }));
  for (const { tarefa, ordem } of asked) {
    const ref = cartas.find((carta) => carta.id === tarefa)?.provas.find((prova) => prova.ordem === ordem);
    const sent = wire.find((carta) => carta.id === tarefa)?.provas.find((prova) => prova.ordem === ordem);
    if (!ref || !sent || sent.sem_arquivo) continue;
    const prepared = await prepareProof(ref, deps.read);
    if (!prepared.bytes || prepared.sha256 !== sent.sha256) {
      // The file changed or left since the list went: the next push sends its new state.
      deps.cache.delete(keyOf(ref));
      continue;
    }
    const ok = await deps.rpc(PROVA_RPC, { p_tarefa: tarefa, p_ordem: ordem, p_sha256: prepared.sha256, p_dados: prepared.bytes.toString('base64') });
    deps.log(ok === true ? `prova enviada ao celular: tarefa ${tarefa}, prova ${ordem} (${prepared.tamanho} bytes)` : `prova recusada pelo Supabase: tarefa ${tarefa}, prova ${ordem}`);
  }
}
