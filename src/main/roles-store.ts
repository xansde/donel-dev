// Papéis de sessão (item 12a) — the store of `<userData>/papeis/<id>.md`. Its own folder, out of
// `config.json`: the config sanitizer of an older channel would drop a key it does not know, and a
// role is text the owner may also open by hand. The main is the only writer (temp → rename).
//
// `promptFileFor` writes what the agent reads (identity + guidance, no header) to
// `<userData>/papeis-prompt/<id>.md` at every spawn, so an edit of the role is what the next
// launch, resume or renewal gets.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRoleId, parseRoleFile, rolePromptText, sanitizeRole, serializeRole, type RoleSaveResult, type SessionRole } from '../shared/roles';

export interface RolesStore {
  list(): SessionRole[];
  get(id: string): SessionRole | undefined;
  save(raw: unknown): RoleSaveResult;
  /** Writes the text the agent reads for `id`; `null` when the role does not exist or the write fails. */
  promptFileFor(id: string): string | null;
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function createRolesStore(userDataDir: string): RolesStore {
  const dir = join(userDataDir, 'papeis');
  const promptDir = join(userDataDir, 'papeis-prompt');

  const readOne = (id: string): SessionRole | undefined => {
    if (!isRoleId(id)) return undefined;
    try {
      return parseRoleFile(id, readFileSync(join(dir, `${id}.md`), 'utf8')) ?? undefined;
    } catch {
      return undefined;
    }
  };

  const list = (): SessionRole[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    return names
      .filter((name) => name.endsWith('.md'))
      .map((name) => readOne(name.slice(0, -3)))
      .filter((role): role is SessionRole => role !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  };

  return {
    list,
    get: readOne,
    save: (raw) => {
      const role = sanitizeRole(raw);
      if (!role) return { ok: false, reason: 'invalid' };
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeAtomic(join(dir, `${role.id}.md`), serializeRole(role));
        return { ok: true, roles: list() };
      } catch {
        return { ok: false, reason: 'write-failed' };
      }
    },
    promptFileFor: (id) => {
      const role = readOne(id);
      if (!role) return null;
      const path = join(promptDir, `${role.id}.md`);
      try {
        if (!existsSync(promptDir)) mkdirSync(promptDir, { recursive: true });
        writeAtomic(path, rolePromptText(role));
        return path;
      } catch {
        // Another session may be reading it right now (Windows locks): the last text written still serves.
        return existsSync(path) ? path : null;
      }
    },
  };
}
