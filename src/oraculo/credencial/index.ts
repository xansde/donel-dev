// t-c441e144 (carta t-6b5092f6, docs/adr/0010) — the phone's credential box: `POST /api/v2/credencial` puts a password
// straight into the owner's vault, never through the chat. This folder is the ONLY code of the Oráculo that touches the
// password: the route in celular-v2.ts checks the device's signature and hands the RAW body here (never the generic
// parseBody, never a log). Contract: ~/seazone/_scratch/celular-tailnet/contrato-credencial.md (v1.5).
//
// Where the password never goes: argv, log, journal, a queue, the ledger, a file on disk, an error message, an answer.
// It lives in this request's memory, goes to the vault through the ssh child's stdin (cofre.ts) and its buffer is zeroed.
// What is kept, 24 h, is `id → {item_id, hash_curto, hash}` (`credencial-pedidos.json`, 600): the hash is a sha256 of
// the password salted with the request id, so the same id sent again answers the same, and another password under it
// is a conflict.

import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MobileResponse } from '../../main/celular/server';
import { criarNoCofre, type SshRunner } from './cofre';

export { COFRE_SCRIPT, cofreArgv, DEFAULT_SSH_HOST, readCofreAnswer, shellWord, sshHostOf, type SshResult, type SshRunner } from './cofre';

export const CREDENCIAL_PATH = 'credencial';
export const MAX_CREDENCIAL_BODY = 16 * 1024;
export const CREDENCIAL_PEDIDOS_FILE = 'credencial-pedidos.json';
const KEEP_MS = 24 * 60 * 60_000;
const MAX_NOME = 120;
const MAX_CAMPO = 300;
const MAX_SENHA = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export const JA_EXISTE_MENSAGEM = 'Já existe um item com esse nome no cofre. Use outro nome.';
export const COFRE_FORA_MENSAGEM = 'O cofre não respondeu; nada foi guardado. Tente de novo.';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json; charset=utf-8' } as const;
/** Every answer is built from fixed text and the vault's id and hash: never a field of the request. */
const answer = (status: number, value: Record<string, unknown>): MobileResponse => ({ status, headers: { ...HEADERS }, body: JSON.stringify(value) });

/** The line the Líder único and the phone's conversation get, once. Never the value. */
export const avisoLinha = (nome: string, itemId: string): string => `🔐 Credencial «${nome}» guardada no cofre, item ${itemId}.`;

/** The conversation line's own id, made of the request's (the same request is the same line). */
export function chatIdOf(id: string): string {
  const h = createHash('sha256').update(`donel-credencial-chat\n${id}`, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Kept {
  readonly item_id: string;
  readonly hash_curto: string;
  /** sha256 of the password salted with the id; never the password. */
  readonly hash: string;
  readonly em: number;
}

/**
 * Hands the line to the owner's chat queue: the Líder único gets it once by the chat's delivery, and the app's
 * conversation shows it (celular-v2.ts: `addChat` under `chatIdOf`, then the chat round).
 */
export type Anunciar = (chatId: string, linha: string) => void;

/** The route: the raw body, already authenticated by the device's signature. */
export type CredencialHandler = (rawBody: string, anunciar: Anunciar) => Promise<MobileResponse>;

export interface CredencialDeps {
  /** The Oráculo's directory: `credencial-pedidos.json` lives there. */
  readonly dir: string;
  /** The vault call (default: `ssh` to `DONEL_CREDENCIAL_SSH`, else `homologacoes-2222`). */
  readonly run?: SshRunner;
  readonly host?: string;
  readonly timeoutMs?: number;
  /** One line per request: short id, name, item_id, hash_curto, result. */
  readonly log: (line: string) => void;
  readonly now?: () => number;
}

interface Pedido {
  readonly id: string;
  readonly nome: string;
  readonly usuario: string | null;
  readonly url: string | null;
}

const optionalText = (value: unknown): string | null | false => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_CAMPO || CONTROL.test(value)) return false;
  return value.trim() || null;
};

/** The request, or null: a malformed body is answered `{"erro":"corpo"}` and nothing of it is said anywhere. */
function readPedido(raw: string): { readonly pedido: Pedido; senha: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const { id, nome, senha } = body;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof nome !== 'string' || CONTROL.test(nome) || nome.length > MAX_NOME || !nome.trim()) return null;
  if (typeof senha !== 'string' || senha.length < 1 || senha.length > MAX_SENHA) return null;
  const usuario = optionalText(body.usuario);
  const url = optionalText(body.url);
  if (usuario === false || url === false) return null;
  return { pedido: { id, nome: nome.trim(), usuario, url }, senha };
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The note on the vault item: fixed, with the day (São Paulo). */
const notaDe = (ms: number): string => `guardada pelo celular do dono, ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms))}`;

export function createCredencialHandler(deps: CredencialDeps): CredencialHandler {
  const now = deps.now ?? Date.now;
  const file = join(deps.dir, CREDENCIAL_PEDIDOS_FILE);
  /** The same id twice at once (the phone retried while the first was at the vault) waits for the first. */
  const inFlight = new Map<string, Promise<unknown>>();

  const load = (): Record<string, Kept> => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
      const cutoff = now() - KEEP_MS;
      const out: Record<string, Kept> = {};
      for (const [id, entry] of Object.entries(raw as Record<string, Partial<Kept>>)) {
        if (typeof entry?.item_id === 'string' && typeof entry.hash_curto === 'string' && typeof entry.hash === 'string' && typeof entry.em === 'number' && entry.em > cutoff) {
          out[id] = { item_id: entry.item_id, hash_curto: entry.hash_curto, hash: entry.hash, em: entry.em };
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const save = (kept: Record<string, Kept>): void => {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(kept), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };

  const logLine = (id: string, nome: string | null, itemId: string | null, hashCurto: string | null, resultado: string): void => {
    try {
      deps.log(`[credencial] ${id.slice(0, 8) || '-'} «${nome ?? '-'}» item=${itemId ?? '-'} hash=${hashCurto ?? '-'} resultado=${resultado}`);
    } catch {
      // the log is not worth a failed answer
    }
  };

  const announce = (anunciar: Anunciar, pedido: Pedido, itemId: string): void => {
    try {
      anunciar(chatIdOf(pedido.id), avisoLinha(pedido.nome, itemId));
    } catch (error) {
      logLine(pedido.id, pedido.nome, itemId, null, `aviso-falhou (${error instanceof Error ? error.name : 'erro'})`);
    }
  };

  async function handle(raw: string, anunciar: Anunciar): Promise<MobileResponse> {
    if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENCIAL_BODY) {
      logLine('', null, null, null, 'grande-demais');
      return answer(413, { erro: 'grande-demais' });
    }
    const read = readPedido(raw);
    if (!read) {
      logLine('', null, null, null, 'corpo');
      return answer(400, { erro: 'corpo' });
    }
    const { pedido } = read;
    const hashCurto = sha256(read.senha).slice(0, 10);
    const hash = sha256(`donel-credencial-v1\n${pedido.id}\n${read.senha}`);

    const pending = inFlight.get(pedido.id);
    if (pending) await pending.catch(() => undefined);

    const kept = load()[pedido.id];
    if (kept) {
      read.senha = '';
      if (kept.hash !== hash) {
        logLine(pedido.id, pedido.nome, kept.item_id, hashCurto, 'conflito');
        return answer(409, { erro: 'conflito' });
      }
      announce(anunciar, pedido, kept.item_id);
      logLine(pedido.id, pedido.nome, kept.item_id, kept.hash_curto, 'repetido');
      return answer(200, { ok: true, item_id: kept.item_id, hash_curto: kept.hash_curto, nova: false });
    }

    const senha = Buffer.from(read.senha, 'utf8');
    read.senha = '';
    const call = criarNoCofre({ nome: pedido.nome, usuario: pedido.usuario, url: pedido.url, nota: notaDe(now()) }, senha, {
      ...(deps.run ? { run: deps.run } : {}),
      ...(deps.host ? { host: deps.host } : {}),
      ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    });
    inFlight.set(pedido.id, call);
    let result: Awaited<typeof call>;
    try {
      result = await call;
    } finally {
      if (inFlight.get(pedido.id) === call) inFlight.delete(pedido.id);
    }

    if (!result.ok) {
      if (result.erro === 'ja-existe') {
        logLine(pedido.id, pedido.nome, null, hashCurto, 'ja-existe');
        return answer(409, { erro: 'ja-existe', mensagem: JA_EXISTE_MENSAGEM });
      }
      logLine(pedido.id, pedido.nome, null, hashCurto, `cofre-indisponivel (${result.motivo})`);
      return answer(503, { erro: 'cofre-indisponivel', mensagem: COFRE_FORA_MENSAGEM });
    }
    if (result.hashCurto !== hashCurto) logLine(pedido.id, pedido.nome, result.itemId, result.hashCurto, 'aviso: o hash do cofre difere do recebido');
    try {
      save({ ...load(), [pedido.id]: { item_id: result.itemId, hash_curto: hashCurto, hash, em: now() } });
    } catch (error) {
      // Saved in the vault all the same: a repeat of this id would then hear ja-existe, never a second item.
      logLine(pedido.id, pedido.nome, result.itemId, hashCurto, `idempotencia-nao-gravada (${error instanceof Error ? error.name : 'erro'})`);
    }
    announce(anunciar, pedido, result.itemId);
    logLine(pedido.id, pedido.nome, result.itemId, hashCurto, 'guardada');
    return answer(200, { ok: true, item_id: result.itemId, hash_curto: hashCurto, nova: true });
  }

  return async (raw, anunciar) => {
    try {
      return await handle(raw, anunciar);
    } catch {
      // Never the error itself: it could carry what it was handed.
      logLine('', null, null, null, 'erro-interno');
      return answer(500, { erro: 'interno' });
    }
  };
}
