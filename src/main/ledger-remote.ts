// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — the PC's side when the ledger lives on the VPS. The same
// `LedgerService` the app already uses, over the daemon's API (src/oraculo/api.ts):
//
// - `load()` answers from memory: the last snapshot the daemon sent, or, before it answers, the mirror on disk.
//   Without the daemon it is READ-ONLY: nothing is queued on the PC, so the phone and the PC never disagree.
// - `apply()` goes to the daemon (the only writer) and the answer carries the new snapshot.
// - `<userData>/ledger.json` becomes the MIRROR: the snapshot marked with `schemaVersion` 1000 (far from the sequence,
//   so it never takes the number of a real next version) and `oraculoRemoto`. Older channels sharing the `userData`
//   open it read-only and never start a second ledger.
// - Proofs: the PC keeps a copy of `ledger-provas/` (what the app shows reads from there); a new one goes up as bytes.
//
// Also here: the move of the PC's ledger to the VPS (`moveLedgerToRemote`) and the way back (`bringLedgerBack`).

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { emptyLedgerDoc, isHttpUrl, parseLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp, type LedgerProof } from '../shared/ledger/contract';
import type { LedgerApplyResult, LedgerSnapshot } from '../shared/ledger/channels';
import { checkLedgerImport, ledgerProofFiles, sameLedger } from '../shared/ledger/remote-import';
import type { ConfigIoDeps } from './config-store';
import { checkLocalProofFile, ledgerProofsDir, type LedgerProofFs, type LedgerService, type RemoteProofFetch } from './ledger-store';

/** The mirror's version: read-only for every app that knows version 4 (and for a future 5). */
export const REMOTE_MIRROR_VERSION = 1000;
/** The PC's ledger as it was at the move. */
export const LEDGER_BEFORE_REMOTE = 'ledger.antes-da-vps.json';

export interface RemoteMarker {
  /** The remote place (`accounts.remotes[].id`) that holds the ledger. */
  readonly lugar: string;
  readonly desde: string;
}

export interface OracleResponseLike {
  readonly status: number;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

/** One call to the daemon; throws when it does not answer (network, timeout). */
export type OracleHttp = (method: string, path: string, body?: string | Uint8Array) => Promise<OracleResponseLike>;

export function fetchOracleHttp(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): OracleHttp {
  return async (method, path, body) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, text: () => response.text(), bytes: async () => new Uint8Array(await response.arrayBuffer()) };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The marker of a mirror on disk (`null` = a normal ledger, or no file). */
export function readRemoteMarker(io: ConfigIoDeps, ledgerFile: string): RemoteMarker | null {
  const text = io.readFileText(ledgerFile);
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== REMOTE_MIRROR_VERSION || !isRecord(raw.oraculoRemoto)) return null;
    const { lugar, desde } = raw.oraculoRemoto;
    return typeof lugar === 'string' && typeof desde === 'string' ? { lugar, desde } : null;
  } catch {
    return null;
  }
}

function writeAtomic(io: ConfigIoDeps, file: string, text: string): boolean {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    if (!io.existsSync(dirname(file))) io.mkdirSync(dirname(file));
    io.writeFileText(tmp, text);
    io.renameFile(tmp, file);
    return true;
  } catch {
    io.unlinkFile(tmp);
    return false;
  }
}

export function writeRemoteMirror(io: ConfigIoDeps, ledgerFile: string, doc: LedgerDoc, marker: RemoteMarker): boolean {
  return writeAtomic(io, ledgerFile, JSON.stringify({ ...doc, schemaVersion: REMOTE_MIRROR_VERSION, oraculoRemoto: marker }, null, 2));
}

async function readJson(response: OracleResponseLike): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return null;
  }
}

function snapshotOf(value: unknown): LedgerSnapshot | null {
  if (!isRecord(value) || !isRecord(value.doc) || !isRecord(value.doc.tasks)) return null;
  return { doc: parseLedgerDoc(value.doc), readOnly: value.readOnly === true };
}

const UNREACHABLE = 'O Oráculo da VPS não respondeu; nada foi gravado. O PC mostra o último retrato só para ler até ela voltar.';
const MAX_INLINE_PROOF_BYTES = 5 * 1024 * 1024;

export interface RemoteLedgerDeps {
  readonly http: () => OracleHttp | null;
  /** `<userData>/ledger.json`: the mirror. */
  readonly ledgerFile: string;
  readonly io: ConfigIoDeps;
  readonly proofFs: LedgerProofFs;
  readonly marker: RemoteMarker;
  readonly now?: () => number;
  readonly onChange?: (snapshot: LedgerSnapshot) => void;
}

export interface RemoteLedgerService extends LedgerService {
  /** Re-reads the daemon's ledger; `false` = it did not answer (the PC stays read-only). */
  refresh(): Promise<boolean>;
  connected(): boolean;
  /** Copies the proofs the PC does not have yet (in the background after each refresh). */
  syncProofs(): Promise<void>;
}

export function createRemoteLedgerService(deps: RemoteLedgerDeps): RemoteLedgerService {
  const { io, ledgerFile, proofFs } = deps;
  const proofsDir = ledgerProofsDir(ledgerFile);
  const now = deps.now ?? Date.now;
  const seen = new Set<string>();
  const seenKey = (placeId: string, taskId: string, deliveredAt: number): string => `${placeId}\n${taskId}\n${deliveredAt}`;
  let cache: LedgerSnapshot | null = null;
  let online = false;
  let syncing: Promise<void> | null = null;

  // Before the daemon answers: the mirror on disk, read-only.
  const mirror = io.readFileText(ledgerFile);
  if (mirror !== null) {
    try {
      const raw = JSON.parse(mirror) as unknown;
      if (isRecord(raw) && isRecord(raw.tasks)) cache = { doc: parseLedgerDoc(raw), readOnly: true };
    } catch {
      cache = null;
    }
  }

  const view = (): LedgerSnapshot | null => (cache ? { doc: cache.doc, readOnly: cache.readOnly || !online } : null);

  function setOnline(next: boolean): void {
    if (online === next) return;
    online = next;
    const snapshot = view();
    if (snapshot) deps.onChange?.(snapshot);
  }

  function accept(snapshot: LedgerSnapshot): void {
    cache = snapshot;
    online = true;
    writeRemoteMirror(io, ledgerFile, snapshot.doc, deps.marker);
    deps.onChange?.({ doc: snapshot.doc, readOnly: snapshot.readOnly });
    void service.syncProofs();
  }

  async function call(method: string, path: string, body?: string | Uint8Array): Promise<OracleResponseLike | null> {
    const http = deps.http();
    if (!http) {
      setOnline(false);
      return null;
    }
    try {
      return await http(method, path, body);
    } catch {
      setOnline(false);
      return null;
    }
  }

  async function exists(path: string): Promise<boolean> {
    try {
      return (await proofFs.stat(path)).isFile();
    } catch {
      return false;
    }
  }

  async function download(file: string): Promise<boolean> {
    const target = join(proofsDir, file);
    if (await exists(target)) return true;
    const response = await call('GET', `/v1/provas/${encodeURIComponent(file)}`);
    if (!response || response.status !== 200) return false;
    try {
      await proofFs.mkdir(proofsDir);
      await proofFs.writeFile(target, Buffer.from(await response.bytes()));
      return true;
    } catch {
      return exists(target);
    }
  }

  const service: RemoteLedgerService = {
    load() {
      const snapshot = view();
      if (!snapshot) throw new Error('o Oráculo da VPS ainda não respondeu');
      return snapshot;
    },
    async apply(actor: LedgerActor, op: LedgerOp): Promise<LedgerApplyResult> {
      const response = await call('POST', '/v1/apply', JSON.stringify({ actor, op }));
      if (!response) return { ok: false, reason: UNREACHABLE };
      const body = await readJson(response);
      if (response.status === 401) {
        setOnline(false);
        return { ok: false, reason: UNREACHABLE };
      }
      if (response.status !== 200 || !isRecord(body)) return { ok: false, reason: `O Oráculo da VPS recusou (${isRecord(body) && typeof body.error === 'string' ? body.error : response.status}); nada foi gravado.` };
      if (body.ok !== true) return { ok: false, reason: typeof body.reason === 'string' ? body.reason : 'O Oráculo da VPS recusou.' };
      const snapshot = snapshotOf(body.snapshot);
      const id = isRecord(body.task) && typeof body.task.id === 'string' ? body.task.id : null;
      const task = id && snapshot ? snapshot.doc.tasks[id] : undefined;
      if (!snapshot || !task) {
        // Written on the VPS; the answer was odd: read it again.
        await service.refresh();
        const again = id ? cache?.doc.tasks[id] : undefined;
        return again ? { ok: true, task: again } : { ok: false, reason: 'O Oráculo da VPS gravou, mas a resposta veio estranha; confira com tarefa_listar.' };
      }
      accept(snapshot);
      return { ok: true, task };
    },
    async importProof(input, remote?: RemoteProofFetch) {
      if (input.tipo === 'texto') return { kind: 'texto', text: input.texto };
      if (input.tipo === 'link') return isHttpUrl(input.url) ? { kind: 'link', url: input.url } : { error: `"${input.url}" não é um link http(s).` };
      const source = input.caminho;
      let bytes: Buffer;
      let ext: string;
      if (remote) {
        const fetched = await remote(source);
        if (!fetched.ok) return { error: fetched.error };
        bytes = fetched.bytes;
        ext = fetched.ext;
      } else {
        const checked = await checkLocalProofFile(proofFs, source);
        if ('error' in checked) return checked;
        try {
          bytes = await proofFs.readFile(checked.real);
        } catch {
          return { error: `Não consegui ler "${source}" neste computador.` };
        }
        ext = checked.ext;
      }
      const response = await call('PUT', `/v1/provas?ext=${encodeURIComponent(ext)}`, new Uint8Array(bytes));
      if (!response) return { error: `Não enviei "${source}": ${UNREACHABLE}` };
      const body = await readJson(response);
      if (response.status !== 200 || !isRecord(body) || body.kind !== 'arquivo' || typeof body.file !== 'string' || typeof body.mediaType !== 'string')
        return { error: `O Oráculo da VPS recusou "${source}" (${isRecord(body) && typeof body.error === 'string' ? body.error : response.status}).` };
      // The PC's copy, so the app shows it at once.
      try {
        await proofFs.mkdir(proofsDir);
        await proofFs.writeFile(join(proofsDir, body.file), bytes);
      } catch {
        // the background copy brings it later
      }
      return { kind: 'arquivo', file: body.file, mediaType: body.mediaType };
    },
    async discardProofs(proofs) {
      for (const proof of proofs) {
        if (proof.kind !== 'arquivo') continue;
        await call('DELETE', `/v1/provas/${encodeURIComponent(proof.file)}`);
        await proofFs.unlink(join(proofsDir, proof.file)).catch(() => undefined);
      }
    },
    proofPath(proof: LedgerProof) {
      return proof.kind === 'arquivo' ? join(proofsDir, proof.file) : null;
    },
    async proofImage(proof) {
      if (proof.kind !== 'arquivo' || !proof.mediaType.startsWith('image/')) return null;
      if (!(await download(proof.file))) return null;
      const path = join(proofsDir, proof.file);
      try {
        if ((await proofFs.stat(path)).size > MAX_INLINE_PROOF_BYTES) return null;
        return { base64: (await proofFs.readFile(path)).toString('base64'), mimeType: proof.mediaType };
      } catch {
        return null;
      }
    },
    noteProofSeen(placeId, taskId, deliveredAt) {
      seen.add(seenKey(placeId, taskId, deliveredAt));
    },
    proofSeen(placeId, taskId, deliveredAt) {
      return seen.has(seenKey(placeId, taskId, deliveredAt));
    },
    now,
    async refresh() {
      const response = await call('GET', '/v1/ledger');
      const snapshot = response && response.status === 200 ? snapshotOf(await readJson(response)) : null;
      if (!snapshot) {
        setOnline(false);
        return false;
      }
      accept(snapshot);
      return true;
    },
    connected: () => online,
    syncProofs() {
      if (syncing) return syncing;
      const files = cache ? ledgerProofFiles(cache.doc) : [];
      syncing = (async () => {
        for (const file of files) if (!(await download(file))) break;
      })().finally(() => {
        syncing = null;
      });
      return syncing;
    },
  };
  return service;
}

/** What the app holds: the local or the remote ledger behind it, swapped by the move and the way back. */
export interface SwitchableLedger extends LedgerService {
  set(next: LedgerService): void;
}

export function createSwitchableLedger(initial: LedgerService): SwitchableLedger {
  let current = initial;
  return {
    set: (next) => {
      current = next;
    },
    load: () => current.load(),
    apply: (actor, op) => current.apply(actor, op),
    importProof: (input, remote) => current.importProof(input, remote),
    discardProofs: (proofs) => current.discardProofs(proofs),
    proofPath: (proof) => current.proofPath(proof),
    proofImage: (proof) => current.proofImage(proof),
    noteProofSeen: (placeId, taskId, deliveredAt) => current.noteProofSeen(placeId, taskId, deliveredAt),
    proofSeen: (placeId, taskId, deliveredAt) => current.proofSeen(placeId, taskId, deliveredAt),
    now: () => current.now(),
  };
}

// ── The move and the way back ────────────────────────────────────────────────────────────────────────────────────

export interface MoveDeps {
  readonly http: OracleHttp;
  readonly ledgerFile: string;
  readonly io: ConfigIoDeps;
  readonly proofFs: LedgerProofFs;
  readonly marker: RemoteMarker;
}

export type MoveResult = { readonly ok: true; readonly tarefas: number } | { readonly ok: false; readonly reason: string };

async function vpsLedger(http: OracleHttp): Promise<LedgerSnapshot | null> {
  try {
    const response = await http('GET', '/v1/ledger');
    return response.status === 200 ? snapshotOf(await readJson(response)) : null;
  } catch {
    return null;
  }
}

function freeName(io: ConfigIoDeps, dir: string, name: string): string {
  const first = join(dir, name);
  if (!io.existsSync(first)) return first;
  return join(dir, name.replace(/\.json$/, `-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}.json`));
}

/**
 * The PC's `ledger.json` goes to the VPS byte for byte (checked on both ends), and only THEN the PC's file becomes
 * `ledger.antes-da-vps.json` and the mirror takes its place. Nothing changes on the PC when any step fails.
 */
export async function moveLedgerToRemote(deps: MoveDeps): Promise<MoveResult> {
  const { http, io, ledgerFile, proofFs } = deps;
  const proofsDir = ledgerProofsDir(ledgerFile);
  const text = io.readFileText(ledgerFile);
  if (text === null && io.existsSync(ledgerFile)) return { ok: false, reason: 'não consegui ler o ledger.json deste PC' };
  const onVps = await vpsLedger(http);
  if (!onVps) return { ok: false, reason: 'o Oráculo da VPS não respondeu' };

  let local: LedgerDoc = emptyLedgerDoc();
  if (text !== null) {
    const check = checkLedgerImport(text, (file) => io.existsSync(join(proofsDir, file)));
    if (!check.ok) return { ok: false, reason: check.reason };
    local = check.doc;
    const vpsTasks = Object.keys(onVps.doc.tasks).length;
    // A move cut in the middle (the import went through, the PC did not finish): the same ledger is fine.
    const alreadyThere = vpsTasks > 0 && sameLedger(local, onVps.doc);
    if (vpsTasks > 0 && !alreadyThere) return { ok: false, reason: `o Oráculo da VPS já tem ${vpsTasks} tarefa(s); nada foi trocado` };
    if (!alreadyThere && Object.keys(local.tasks).length > 0) {
      for (const file of check.proofFiles) {
        let bytes: Buffer;
        try {
          bytes = await proofFs.readFile(join(proofsDir, file));
        } catch {
          return { ok: false, reason: `não consegui ler a prova ${file} neste PC` };
        }
        let response: OracleResponseLike;
        try {
          response = await http('PUT', `/v1/provas/${encodeURIComponent(file)}`, new Uint8Array(bytes));
        } catch {
          return { ok: false, reason: 'o Oráculo da VPS parou de responder no meio das provas; nada foi trocado' };
        }
        if (response.status !== 200) return { ok: false, reason: `a VPS recusou a prova ${file} (${response.status})` };
      }
      let response: OracleResponseLike;
      try {
        response = await http('POST', '/v1/importar', new Uint8Array(Buffer.from(text, 'utf8')));
      } catch {
        return { ok: false, reason: 'o Oráculo da VPS parou de responder na cópia; nada foi trocado' };
      }
      const body = await readJson(response);
      if (response.status !== 200) return { ok: false, reason: `a VPS recusou a cópia: ${isRecord(body) && typeof body.error === 'string' ? body.error : response.status}` };
    }
  }

  const now = await vpsLedger(http);
  if (!now || !sameLedger(local, now.doc)) return { ok: false, reason: 'a VPS não confirmou o mesmo registro; nada foi trocado neste PC' };
  if (text !== null) {
    try {
      io.renameFile(ledgerFile, freeName(io, dirname(ledgerFile), LEDGER_BEFORE_REMOTE));
    } catch {
      return { ok: false, reason: 'a cópia está na VPS, mas não consegui guardar o ledger.json deste PC; nada mudou aqui' };
    }
  }
  if (!writeRemoteMirror(io, ledgerFile, now.doc, deps.marker)) return { ok: false, reason: 'não consegui gravar o espelho neste PC' };
  return { ok: true, tarefas: Object.keys(now.doc.tasks).length };
}

/** The way back: the VPS's `ledger.json`, byte for byte, replaces the mirror; the proofs the PC lacks come too. */
export async function bringLedgerBack(deps: { readonly http: OracleHttp; readonly ledgerFile: string; readonly io: ConfigIoDeps; readonly proofFs: LedgerProofFs }): Promise<MoveResult> {
  const { http, io, ledgerFile, proofFs } = deps;
  const proofsDir = ledgerProofsDir(ledgerFile);
  let text: string;
  try {
    const response = await http('GET', '/v1/ledger/arquivo');
    if (response.status === 404) text = JSON.stringify(emptyLedgerDoc(), null, 2);
    else if (response.status !== 200) return { ok: false, reason: `a VPS não entregou o registro (${response.status})` };
    else text = Buffer.from(await response.bytes()).toString('utf8');
  } catch {
    return { ok: false, reason: 'o Oráculo da VPS não respondeu; use o caminho manual do plano (docs/planos/oraculo-na-vps.md, "Volta atrás")' };
  }
  const check = checkLedgerImport(text, () => true);
  if (!check.ok) return { ok: false, reason: check.reason };
  for (const file of check.proofFiles) {
    const target = join(proofsDir, file);
    if (io.existsSync(target)) continue;
    try {
      const response = await http('GET', `/v1/provas/${encodeURIComponent(file)}`);
      if (response.status !== 200) return { ok: false, reason: `faltou trazer a prova ${file}; nada mudou neste PC` };
      await proofFs.mkdir(proofsDir);
      await proofFs.writeFile(target, Buffer.from(await response.bytes()));
    } catch {
      if (!io.existsSync(target)) return { ok: false, reason: `faltou trazer a prova ${file}; nada mudou neste PC` };
    }
  }
  if (!writeAtomic(io, ledgerFile, text)) return { ok: false, reason: 'não consegui gravar o ledger.json neste PC' };
  return { ok: true, tarefas: check.count.tasks };
}
