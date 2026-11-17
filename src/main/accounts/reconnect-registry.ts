// 011-contas-e-provedores, etapa 3, Fase 2 (D3) — registro de quais contas
// precisam reconectar. O motor (account-engine.ts) marca uma conta quando a
// troca PARA ELA falha com `expired-credentials`, e o mod local marca quando a
// renovação de uma conta parada é recusada; a marca some quando uma troca
// bem-sucedida pra ela acontece, ou quando um login isolado a renova
// (isolated-login.ts/index.ts). index.ts mantém UM registro compartilhado entre
// reconstruções do motor (senão um rebuild de F6 perderia toda marca pendente).
//
// t-205b44c8 (16/11) — a marca sobrevive a reabrir o app: sem isso, cada
// abertura tentava de novo renovar a conta já sabida morta (uma recusa e uma
// linha `account-pair-refresh-failed` por conta, a cada abertura). O arquivo
// guarda SÓ os ids das contas (um array JSON) — nunca token, par ou e-mail.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountId } from '../../shared/accounts';

export interface ReconnectRegistry {
  has(id: AccountId): boolean;
  mark(id: AccountId): void;
  clear(id: AccountId): void;
}

/** Where the marks persist. Never throws: an unreadable store is empty, a failed save keeps the in-memory mark. */
export interface ReconnectStore {
  load(): readonly AccountId[];
  save(ids: readonly AccountId[]): void;
}

export interface ReconnectRegistryOptions {
  /** Absent = in memory only (the behaviour before t-205b44c8; the tests that build a bare registry keep it). */
  readonly store?: ReconnectStore;
}

/**
 * The store is read on the FIRST use, not at creation: index.ts creates the registry at module load, before
 * `app.setName` fixes the `userData` folder the file lives in.
 */
export function createReconnectRegistry(options: ReconnectRegistryOptions = {}): ReconnectRegistry {
  const { store } = options;
  let marked: Set<AccountId> | null = null;
  const current = (): Set<AccountId> => {
    if (marked === null) marked = new Set(loadSafely(store));
    return marked;
  };
  const persist = (set: Set<AccountId>): void => {
    try {
      store?.save([...set]);
    } catch {
      // the mark stays in memory for this run; the next app start just retries the refresh once.
    }
  };
  return {
    has: (id) => current().has(id),
    mark: (id) => {
      const set = current();
      if (set.has(id)) return;
      set.add(id);
      persist(set);
    },
    clear: (id) => {
      const set = current();
      if (!set.delete(id)) return;
      persist(set);
    },
  };
}

function loadSafely(store: ReconnectStore | undefined): readonly AccountId[] {
  try {
    return store?.load() ?? [];
  } catch {
    return [];
  }
}

export interface ReconnectFileIo {
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  rename(from: string, to: string): void;
  mkdir(path: string): void;
}

const realFileIo: ReconnectFileIo = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
};

/**
 * `<userData>/accounts-reconnect.json` — a JSON array of account ids, written atomically (tmp + rename). A missing,
 * unreadable or malformed file loads as no marks. `filePath` is resolved on each use (see `createReconnectRegistry`).
 */
export function createFileReconnectStore(filePath: () => string, io: ReconnectFileIo = realFileIo): ReconnectStore {
  return {
    load: () => {
      try {
        const parsed: unknown = JSON.parse(io.readFile(filePath()));
        return Array.isArray(parsed) ? parsed.filter((id): id is AccountId => typeof id === 'string' && id.length > 0) : [];
      } catch {
        return [];
      }
    },
    save: (ids) => {
      const path = filePath();
      const tmp = `${path}.tmp`;
      io.mkdir(dirname(path));
      io.writeFile(tmp, `${JSON.stringify(ids)}\n`);
      io.rename(tmp, path);
    },
  };
}
