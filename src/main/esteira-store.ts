// Spec 010 (D-9) — vertical pequeno, passo 2: o STORE em disco. Este e o unico
// modulo que escreve o `events.jsonl`; reducer e traducao de fatos sao puros e
// moram em `src/shared/esteira/`.
//
//   <userData>/esteira/
//     events.jsonl      APPEND-ONLY; linha 1 e o cabecalho
//     snapshot.json     derivado e descartavel
//
// Tres disciplinas de escrita, cada uma deliberada:
//
// 1. **`events.jsonl` e append + fsync — NUNCA temp+rename.** O padrao atomico
//    de `config-store.ts` (temp → fsync → rename) reescreve o arquivo inteiro;
//    num log append-only isso troca "acrescentar uma linha" por "reescrever o
//    historico", e uma falha no meio custaria tudo o que ja estava la.
// 2. **`snapshot.json` USA temp+rename**, porque ele e reescrito por inteiro a
//    cada gravacao — e derivado e descartavel: apagar forca reconstrucao.
// 3. **Cabecalho incompativel = nao escreve.** `userData` e compartilhado pelos
//    tres canais (decisao de 28/07); um canal de major menor le o que consegue
//    e NAO toca no arquivo. E o que impede a repeticao do caso do sanitizador
//    de config derrubando chave que so o canal novo conhecia.
//
// Nunca lanca para fora: falha de I/O vira resultado tipado (mesmo padrao de
// `trySaveProjectBindingToDisk`).

import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EventDraft } from '../shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../shared/esteira/store/reducer';
import {
  parseEventLine,
  parseStoreHeader,
  storeCompatibility,
  STORE_DIR_NAME,
  STORE_EVENTS_FILE,
  STORE_SCHEMA_VERSION,
  STORE_SNAPSHOT_FILE,
  type EventSource,
  type StoreCompatibility,
  type StoreEvent,
  type StoreHeader,
  type StoreSnapshot,
} from '../shared/esteira/store/storeFormat';

/** Isola o smoke do store REAL da maquina (mesmo espirito de `DONEL_ESTEIRA_STATE_ROOT`/`DONEL_ESTEIRA_CONFIG_DIR`). */
export const ESTEIRA_STORE_DIR_ENV_VAR = 'DONEL_ESTEIRA_STORE_DIR';

export function esteiraStoreDir(env: Record<string, string | undefined>, userDataPath: string): string {
  const override = env[ESTEIRA_STORE_DIR_ENV_VAR];
  return override && override.trim() ? override : join(userDataPath, STORE_DIR_NAME);
}

export function storeEventsPath(dir: string): string {
  return join(dir, STORE_EVENTS_FILE);
}

export function storeSnapshotPath(dir: string): string {
  return join(dir, STORE_SNAPSHOT_FILE);
}

export type StoreWriteRefusal = 'read-only' | 'needs-migration' | 'unreadable' | 'write-failed';

export type AppendResult =
  | { readonly ok: true; readonly events: readonly StoreEvent[] }
  | { readonly ok: false; readonly reason: StoreWriteRefusal };

export type PersistResult = { readonly ok: true } | { readonly ok: false; readonly reason: StoreWriteRefusal };

export interface OpenStoreOptions {
  readonly dir: string;
  /** `alfa` | `beta` | `stable` — so diagnostico no cabecalho. */
  readonly channel?: string | null;
  readonly now?: () => string;
  readonly newEventId?: () => string;
}

export interface EsteiraStore {
  readonly dir: string;
  readonly compatibility: StoreCompatibility;
  readonly header: StoreHeader | null;
  /** Eventos lidos, na ordem do arquivo. */
  readonly events: readonly StoreEvent[];
  /** Snapshot derivado (memoizado ate a proxima escrita/refresh). */
  snapshot(): StoreSnapshot;
  /**
   * Acrescenta os eventos ao log. Recusa (sem tocar o arquivo) quando a
   * compatibilidade nao libera escrita. `source` diz de ONDE o fato veio —
   * `ingest` carrega o `run_id`, e e dele que sai a idempotencia.
   */
  append(drafts: readonly EventDraft[], source?: EventSource): AppendResult;
  /** Grava o `snapshot.json`. Derivado — perde-lo nao perde nada. */
  persistSnapshot(): PersistResult;
  /** Le o que foi acrescentado por outro processo desde a ultima leitura. `true` = havia novidade. */
  refresh(): boolean;
}

/** Le do offset ate o fim. O log so cresce; reler tudo a cada refresh seria desperdicio previsivel. */
function readFrom(path: string, offset: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    if (size <= offset) return '';
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function appendWithFsync(path: string, text: string): void {
  appendFileSync(path, text, 'utf8');
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Temp + fsync + rename — o padrao de `config-store.ts`, aqui so para o snapshot (que E reescrito por inteiro). */
function writeAtomic(path: string, text: string): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fd = openSync(tmpPath, 'w');
  try {
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort — mesmo espirito de config-store.ts
    }
    throw error;
  }
}

export function openEsteiraStore(options: OpenStoreOptions): EsteiraStore {
  const { dir, channel = null, now = () => new Date().toISOString(), newEventId = () => `evt-${randomUUID()}` } = options;
  const eventsPath = storeEventsPath(dir);

  let header: StoreHeader | null = null;
  let compatibility: StoreCompatibility = 'unreadable';
  let events: StoreEvent[] = [];
  let readOffset = 0;
  /** Sobra de uma linha ainda sem `\n` — outro processo pode estar no meio de um append. */
  let pending = '';
  let maxSeq = 0;
  let cachedSnapshot: StoreSnapshot | null = null;
  /** Chaves naturais ja gravadas — a idempotencia da ingestao vive aqui. */
  const dedupeKeys = new Set<string>();

  function ingestChunk(chunk: string, isFirstRead: boolean): void {
    const text = pending + chunk;
    const lines = text.split('\n');
    pending = lines.pop() ?? '';

    let index = 0;
    if (isFirstRead) {
      header = parseStoreHeader(lines[0] ?? null);
      compatibility = storeCompatibility(header, STORE_SCHEMA_VERSION);
      index = 1;
    }

    for (; index < lines.length; index += 1) {
      const parsed = parseEventLine(lines[index]);
      // Linha ilegivel e PULADA, nunca fatal: um registro ruim nao pode custar
      // os outros. Historico nao se apaga por causa de um byte torto.
      if (!parsed.ok) continue;
      events.push(parsed.event);
      if (parsed.event.dedupe_key !== null) dedupeKeys.add(parsed.event.dedupe_key);
      if (parsed.event.seq > maxSeq) maxSeq = parsed.event.seq;
    }
  }

  function load(): void {
    if (!existsSync(eventsPath)) {
      // Store nasce limpo (D-2): sem importacao de legado, so o cabecalho.
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const headerLine = JSON.stringify({
          kind: 'esteira.store.header',
          schema_version: STORE_SCHEMA_VERSION,
          created_at: now(),
          created_by_channel: channel,
        });
        appendWithFsync(eventsPath, `${headerLine}\n`);
      } catch {
        compatibility = 'unreadable';
        return;
      }
    }

    try {
      const chunk = readFrom(eventsPath, 0);
      readOffset = Buffer.byteLength(chunk, 'utf8');
      ingestChunk(chunk, true);
    } catch {
      compatibility = 'unreadable';
    }
  }

  load();

  function snapshot(): StoreSnapshot {
    if (cachedSnapshot === null) cachedSnapshot = reduceEvents(events, { builtAt: now() });
    return cachedSnapshot;
  }

  function refresh(): boolean {
    let size: number;
    try {
      size = statSync(eventsPath).size;
    } catch {
      return false;
    }
    if (size <= readOffset) return false;

    try {
      const chunk = readFrom(eventsPath, readOffset);
      readOffset += Buffer.byteLength(chunk, 'utf8');
      const before = events.length;
      ingestChunk(chunk, false);
      if (events.length === before) return false;
      cachedSnapshot = null;
      return true;
    } catch {
      return false;
    }
  }

  function append(drafts: readonly EventDraft[], source: EventSource = { kind: 'app' }): AppendResult {
    if (compatibility !== 'read-write') {
      // Nao escreve E nao toca no arquivo — nem para "consertar" o cabecalho.
      return { ok: false, reason: compatibility };
    }
    if (drafts.length === 0) return { ok: true, events: [] };

    // Pega o que outro processo escreveu antes de numerar: `seq` nunca se repete.
    refresh();

    // Fato ja gravado nao vira LINHA NOVA. O reducer tambem deduplica na
    // leitura (cinto e suspensorio), mas filtrar aqui e o que impede o log de
    // inchar a cada boot que reprocessa o mesmo `result.json`.
    const fresh = drafts.filter((draft) => draft.dedupe_key === null || !dedupeKeys.has(draft.dedupe_key));
    if (fresh.length === 0) return { ok: true, events: [] };

    const written: StoreEvent[] = [];
    let text = '';
    for (const draft of fresh) {
      maxSeq += 1;
      const event: StoreEvent = {
        seq: maxSeq,
        event_id: newEventId(),
        at: draft.at,
        type: draft.type,
        source,
        dedupe_key: draft.dedupe_key,
        payload: draft.payload,
      };
      written.push(event);
      if (event.dedupe_key !== null) dedupeKeys.add(event.dedupe_key);
      text += `${JSON.stringify(event)}\n`;
    }

    try {
      appendWithFsync(eventsPath, text);
    } catch {
      // Nada foi para o disco: desfaz a numeracao e as chaves em memoria, para
      // que uma nova tentativa grave o mesmo fato com o mesmo `seq`.
      maxSeq -= written.length;
      for (const event of written) if (event.dedupe_key !== null) dedupeKeys.delete(event.dedupe_key);
      return { ok: false, reason: 'write-failed' };
    }

    readOffset += Buffer.byteLength(text, 'utf8');
    events.push(...written);
    cachedSnapshot = null;
    return { ok: true, events: written };
  }

  function persistSnapshot(): PersistResult {
    if (compatibility !== 'read-write') return { ok: false, reason: compatibility };
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeAtomic(storeSnapshotPath(dir), JSON.stringify(snapshot(), null, 2));
      return { ok: true };
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
  }

  return {
    dir,
    get compatibility() {
      return compatibility;
    },
    get header() {
      return header;
    },
    get events() {
      return events;
    },
    snapshot,
    append,
    persistSnapshot,
    refresh,
  };
}
