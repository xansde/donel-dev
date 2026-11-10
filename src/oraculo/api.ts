// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — the API the PC's app talks to. The daemon runs today's
// `createLedgerService` over its own `ledger.json`; this handler is pure (request → response) so the test needs no
// network, and `server.ts` puts the socket around it. Every route needs the PC's token, whose sha256 is the only
// thing on the VPS's disk (the PC writes it through its own ssh at each boot).

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { MAX_PROOF_FILE_BYTES, PROOF_FILE_TYPES, isProofFileName, maxProofBytes, type LedgerActor, type LedgerOp } from '../shared/ledger/contract';
import { checkLedgerImport, ledgerCount, ledgerProofFiles, sameLedger } from '../shared/ledger/remote-import';
import { ledgerProofsDir, type LedgerService } from '../main/ledger-store';
import { SERVICE_PATH, serviceActor, serviceOpRefusal, type ServiceOp } from './servicos';
import { LIVRO_PATH, parseRascunho, type LivroStore } from './livro';

export interface OracleRequest {
  readonly method: string;
  /** Path with query, as it came. */
  readonly url: string;
  readonly authorization?: string;
  readonly body: string;
  /** Only the binary routes (`isBinaryRoute`): the raw bytes. */
  readonly bytes?: Uint8Array;
}

export type OracleBody = string | { readonly filePath: string };

export interface OracleResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: OracleBody;
}

export type OracleApiHandler = (request: OracleRequest) => Promise<OracleResponse>;

export const PROOFS_PATH = '/v1/provas';
export const IMPORT_PATH = '/v1/importar';
/** The biggest binary body: a proof, or the PC's whole `ledger.json` on the move. */
export const MAX_UPLOAD_BYTES = MAX_PROOF_FILE_BYTES;
/** Any other body (an op with the owner's letter fits well under it). */
export const MAX_JSON_BYTES = 1024 * 1024;

/** The routes whose body is raw bytes (and may be big). */
export function isBinaryRoute(method: string, path: string): boolean {
  return (method === 'PUT' && (path === PROOFS_PATH || path.startsWith(`${PROOFS_PATH}/`))) || (method === 'POST' && path === IMPORT_PATH);
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;
const BYTES_HEADERS = { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } as const;

function json(status: number, value: unknown): OracleResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(value) };
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Constant-time check of `Bearer <token>` against the stored sha256 (hex). No hash yet = no token is good. */
export function bearerMatches(authorization: string | undefined, tokenHash: string | null): boolean {
  if (!authorization?.startsWith('Bearer ') || !tokenHash || !/^[0-9a-f]{64}$/.test(tokenHash)) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(authorization.slice('Bearer '.length)), 'hex'), Buffer.from(tokenHash, 'hex'));
}

/** Who is calling: the PC (every route) or a headless service (only `SERVICE_PATH`, src/oraculo/servicos.ts). */
export type OracleCaller = { readonly kind: 'pc' } | { readonly kind: 'servico'; readonly name: string };

export function callerOf(authorization: string | undefined, tokenHash: string | null, services: ReadonlyMap<string, string>): OracleCaller | null {
  if (bearerMatches(authorization, tokenHash)) return { kind: 'pc' };
  for (const [name, hash] of services) if (bearerMatches(authorization, hash)) return { kind: 'servico', name };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActor(value: unknown): LedgerActor | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'dono') return { kind: 'dono' };
  if (value.kind !== 'lugar' || typeof value.placeId !== 'string' || !value.placeId.trim()) return null;
  return { kind: 'lugar', placeId: value.placeId, ...(typeof value.roleId === 'string' ? { roleId: value.roleId } : {}) };
}

/** `/v1/provas/<name>` → the name, or `null` (bad escape, or not a proof name). */
function proofNameOf(path: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(path.slice(PROOFS_PATH.length + 1));
  } catch {
    return null;
  }
  return isProofFileName(name) ? name : null;
}

export interface OracleApiDeps {
  readonly ledger: LedgerService;
  /** The same file the service writes (the move writes it byte for byte; the way back reads it). */
  readonly ledgerFile: string;
  /** The sha256 (hex) the PC left on the VPS; `null` before the PC's first boot. */
  readonly tokenHash: () => string | null;
  /** The ledger changed outside `apply` (the move): the events stream hears it. */
  readonly changed?: () => void;
  /** More routes behind the same token (src/oraculo/admin.ts); `null` = not one of them. */
  readonly extra?: (request: OracleRequest, path: string) => Promise<OracleResponse | null>;
  /** t-a1ea2798 — the headless services' token hashes (name → sha256), read at each call; absent = none. */
  readonly services?: () => ReadonlyMap<string, string>;
  /** The way back's mark (src/oraculo/devolvido.ts): set, every writer of the daemon refuses. */
  readonly returned?: { returned(): boolean; set(returned: boolean): void };
  /** F6 do ledger bom — the journal (src/oraculo/livro.ts); absent = the daemon did not switch it on (no route). */
  readonly livro?: LivroStore;
}

/** What a service may append to the journal: the same as its op route (create, take, deliver), by the same rule. */
const SERVICE_LIVRO_TYPES: ReadonlySet<string> = new Set(['criar', 'assumir', 'entregar']);

export function createOracleApiHandler(deps: OracleApiDeps): OracleApiHandler {
  const { ledger, ledgerFile } = deps;
  const proofsDir = ledgerProofsDir(ledgerFile);

  /**
   * The move. The VPS takes the PC's file when it has no task, when its copy was returned (the dead copy is kept as
   * `ledger.devolvido-<hora>.json`), or when `se` is the sha256 of what is there now (the PC re-copying after its
   * own file changed during the copy).
   */
  function importLedger(bytes: Uint8Array, se: string | null): OracleResponse {
    let current;
    try {
      current = ledger.load();
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
    const onDisk = existsSync(ledgerFile) ? readFileSync(ledgerFile) : null;
    const isReturned = deps.returned?.returned() ?? false;
    const casMatches = se !== null && onDisk !== null && createHash('sha256').update(onDisk).digest('hex') === se;
    if (Object.keys(current.doc.tasks).length > 0 && !isReturned && !casMatches) return json(409, { error: 'o Oráculo da VPS já tem tarefas; nada foi trocado' });
    if (se !== null && !casMatches) return json(409, { error: 'o Oráculo da VPS mudou desde a última cópia; nada foi trocado' });
    const text = Buffer.from(bytes).toString('utf8');
    const check = checkLedgerImport(text, (file) => existsSync(join(proofsDir, file)));
    if (!check.ok) return json(409, { error: check.reason });
    const previous = onDisk;
    if (isReturned && previous && !casMatches) {
      try {
        writeFileSync(`${ledgerFile.replace(/\.json$/, '')}.devolvido-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, previous, { mode: 0o600, flag: 'wx' });
      } catch {
        return json(500, { error: 'não consegui guardar a cópia devolvida da VPS; nada foi trocado' });
      }
    }
    const tmp = `${ledgerFile}.tmp-import-${process.pid}`;
    try {
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, ledgerFile);
    } catch {
      if (existsSync(tmp)) unlinkSync(tmp);
      return json(500, { error: 'não consegui gravar o ledger.json na VPS' });
    }
    // Re-read through the service: same ids, same events, or the VPS goes back to what it had.
    let reread;
    try {
      reread = ledger.load();
    } catch {
      reread = null;
    }
    if (!reread || !sameLedger(check.doc, reread.doc)) {
      if (previous) writeFileSync(ledgerFile, previous, { mode: 0o600 });
      else unlinkSync(ledgerFile);
      return json(500, { error: 'a releitura na VPS não bateu; voltei ao que estava' });
    }
    deps.returned?.set(false);
    deps.changed?.();
    const count = ledgerCount(reread.doc);
    return json(200, { ok: true, tarefas: count.tasks, eventos: count.events, provas: check.proofFiles.length });
  }

  /** A service's one route: the actor comes from its token, never from the body. */
  async function serviceApply(name: string, body: string): Promise<OracleResponse> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(400, { error: 'corpo não é JSON' });
    }
    const op = isRecord(parsed) ? parsed.op : undefined;
    const why = serviceOpRefusal(op);
    if (why) return json(400, { error: why });
    try {
      const result = await ledger.apply(serviceActor(name), op as ServiceOp);
      return result.ok ? json(200, { ok: true, id: result.task.id, estado: result.task.state }) : json(400, result);
    } catch {
      return json(400, { error: 'op malformada' });
    }
  }

  /** F6: `GET ?ultimos=N` or `?desde=<seq>` (and `limite`) reads; `POST` appends one entry with its key. */
  function livroRoute(livro: LivroStore, caller: OracleCaller, method: string, url: URL, body: string): OracleResponse {
    const num = (name: string): number | undefined => {
      const value = url.searchParams.get(name);
      return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : undefined;
    };
    try {
      if (method === 'GET') return json(200, livro.ler({ desde: num('desde'), ultimos: num('ultimos'), limite: num('limite') }));
      if (method !== 'POST') return json(405, { error: 'GET lê, POST lança' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(400, { error: 'corpo não é JSON' });
      }
      const draft = parseRascunho(parsed, caller.kind === 'pc' ? ['quem'] : []);
      if (typeof draft === 'string') return json(400, { error: draft });
      let quem: LedgerActor;
      if (caller.kind === 'servico') {
        if (!SERVICE_LIVRO_TYPES.has(draft.tipo)) return json(403, { error: 'serviço só lança criar, assumir e entregar' });
        const why = serviceOpRefusal({ ...draft.dados, op: draft.tipo });
        if (why) return json(400, { error: why });
        quem = serviceActor(caller.name);
      } else {
        const actor = parseActor((parsed as Record<string, unknown>).quem);
        if (!actor) return json(400, { error: 'quem inválido' });
        quem = actor;
      }
      const result = livro.lancar(quem, draft);
      return result.ok ? json(200, { ok: true, novo: result.novo, lancamento: result.lancamento }) : json(result.status, { error: result.error });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return async (request) => {
    const caller = callerOf(request.authorization, deps.tokenHash(), deps.services?.() ?? new Map());
    if (!caller) return json(401, { error: 'token' });
    const url = new URL(request.url, 'http://oraculo');
    const path = url.pathname;
    const { method } = request;
    if (path === LIVRO_PATH) return deps.livro ? livroRoute(deps.livro, caller, method, url, request.body) : json(404, { error: 'rota' });
    if (caller.kind === 'servico') {
      if (method !== 'POST' || path !== SERVICE_PATH) return json(403, { error: 'credencial de serviço só cria, assume e entrega tarefas' });
      return serviceApply(caller.name, request.body);
    }

    if (method === 'GET' && path === '/v1/ledger') {
      try {
        return json(200, ledger.load());
      } catch (error) {
        return json(500, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // The way back: the VPS's file itself, byte for byte.
    if (method === 'GET' && path === '/v1/ledger/arquivo') {
      return existsSync(ledgerFile) ? { status: 200, headers: BYTES_HEADERS, body: { filePath: ledgerFile } } : json(404, { error: 'sem ledger.json' });
    }

    if (method === 'POST' && path === '/v1/apply') {
      let body: unknown;
      try {
        body = JSON.parse(request.body);
      } catch {
        return json(400, { error: 'corpo não é JSON' });
      }
      const actor = isRecord(body) ? parseActor(body.actor) : null;
      const op = isRecord(body) && isRecord(body.op) && typeof body.op.op === 'string' ? (body.op as unknown as LedgerOp) : null;
      if (!actor || !op) return json(400, { error: 'actor ou op inválido' });
      try {
        const result = await ledger.apply(actor, op);
        if (!result.ok) return json(200, result);
        return json(200, { ...result, snapshot: ledger.load() });
      } catch {
        // A malformed op from the PC (an older or newer app) throws inside the pure apply: nothing was written.
        return json(400, { error: 'op malformada' });
      }
    }

    if (method === 'POST' && path === IMPORT_PATH) {
      if (!request.bytes) return json(400, { error: 'sem corpo' });
      const se = url.searchParams.get('se');
      return importLedger(request.bytes, se && /^[0-9a-f]{64}$/.test(se) ? se : null);
    }

    // The way back: from here on every writer of the VPS refuses (the PC takes the ledger); `retomar` undoes it
    // when the way back failed half way.
    if (method === 'POST' && (path === '/v1/devolver' || path === '/v1/retomar')) {
      if (!deps.returned) return json(404, { error: 'rota' });
      deps.returned.set(path === '/v1/devolver');
      deps.changed?.();
      return json(200, { ok: true, devolvido: deps.returned.returned() });
    }

    // A new proof: the VPS names it (as the local ledger does).
    if (method === 'PUT' && path === PROOFS_PATH) {
      const ext = (url.searchParams.get('ext') ?? '').toLowerCase();
      const mediaType = PROOF_FILE_TYPES[ext];
      const bytes = request.bytes;
      if (!mediaType || !bytes) return json(400, { error: 'a prova em arquivo é print, vídeo ou protótipo HTML' });
      if (bytes.byteLength > maxProofBytes(mediaType)) return json(400, { error: 'prova grande demais' });
      const proof = await ledger.importProof({ tipo: 'arquivo', caminho: `upload.${ext}` }, async () => ({ ok: true, bytes: Buffer.from(bytes), ext, mediaType }));
      return 'error' in proof ? json(400, proof) : json(200, proof);
    }

    if (path.startsWith(`${PROOFS_PATH}/`)) {
      const name = proofNameOf(path);
      if (!name) return json(404, { error: 'prova' });
      const filePath = join(proofsDir, name);

      if (method === 'GET') return existsSync(filePath) ? { status: 200, headers: BYTES_HEADERS, body: { filePath } } : json(404, { error: 'prova' });

      // The move: a proof keeps its name. Written once; the same bytes again is fine (a retry), others are not.
      if (method === 'PUT') {
        const bytes = request.bytes;
        if (!bytes) return json(400, { error: 'sem corpo' });
        if (bytes.byteLength > maxProofBytes(PROOF_FILE_TYPES[extname(name).slice(1)] ?? '')) return json(400, { error: 'prova grande demais' });
        if (existsSync(filePath)) return readFileSync(filePath).equals(Buffer.from(bytes)) ? json(200, { ok: true }) : json(409, { error: 'já existe outra prova com este nome' });
        try {
          mkdirSync(proofsDir, { recursive: true });
          writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return json(500, { error: 'não consegui gravar a prova' });
        }
        return json(200, { ok: true });
      }

      // A delivery refused after its proof went up: the copy goes, unless a delivery names it.
      if (method === 'DELETE') {
        let cited: boolean;
        try {
          cited = ledgerProofFiles(ledger.load().doc).includes(name);
        } catch {
          return json(500, { error: 'não consegui ler o Oráculo' });
        }
        if (cited) return json(409, { error: 'uma entrega cita esta prova' });
        try {
          if (statSync(filePath).isFile()) unlinkSync(filePath);
        } catch {
          // already gone
        }
        return json(200, { ok: true });
      }
    }

    const extra = await deps.extra?.(request, path);
    return extra ?? json(404, { error: 'rota' });
  };
}
