import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import { MAX_UPLOAD_BYTES, refusedUploadFile, secretUploadFile, type UploadFolderContext } from '../../shared/browser/upload';

// Navegador interno — pure helpers of browser-panels.ts (kept apart so vitest never imports `electron`).

/** Strips the `Electron/x` and app tokens of the user agent: some login pages refuse an "Electron" browser. */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s(?:Electron|donel-dev|Donel Dev[^/]*)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export type UploadFile = { readonly ok: true; readonly path: string; readonly name: string } | { readonly ok: false; readonly reason: string };

/**
 * The file `navegador_enviar_arquivo` asked for, resolved inside an authorized folder. Both paths go through
 * `realpath` first: a link inside the folder that points out of it is refused like `..` is, and a secret file is
 * refused by where it really is (`secretUploadFile`).
 */
export function resolveUploadFile(folder: string, requested: string, context: UploadFolderContext): UploadFile {
  let realFolder: string;
  let realFile: string;
  try {
    realFolder = realpathSync.native(folder);
  } catch {
    return { ok: false, reason: `A pasta autorizada ${folder} não existe mais. ${HOW_TO_GET_A_FOLDER}` };
  }
  try {
    realFile = realpathSync.native(isAbsolute(requested) ? requested : join(realFolder, requested));
  } catch {
    return { ok: false, reason: `Não achei esse arquivo na pasta autorizada (${realFolder}).` };
  }
  const refused = refusedUploadFile(relative(realFolder, realFile)) ?? secretUploadFile(realFile, context);
  if (refused) return { ok: false, reason: refused };
  const stat = statSync(realFile);
  if (!stat.isFile()) return { ok: false, reason: 'Esse caminho não é um arquivo.' };
  if (stat.size === 0) return { ok: false, reason: 'Esse arquivo está vazio.' };
  if (stat.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `Esse arquivo passa do limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  return { ok: true, path: realFile, name: basename(realFile) };
}

/** How the agent gets a folder: said in every refusal (owner, 07/11: the orchestrator liberates, not him). */
export const HOW_TO_GET_A_FOLDER =
  'Peça ao orquestrador do seu quadro (o Líder dele, ou o Líder único) que libere a pasta com navegador_liberar_pasta, dizendo o caminho completo dela; se você é o Líder, libere você mesmo. Não peça ao dono.';

/** The file the agent asked for, inside one of `folders` (absolute path, or relative to one of them). */
export function findUploadFile(folders: readonly string[], requested: string, context: UploadFolderContext): UploadFile {
  if (!isAbsolute(requested)) {
    const tries = folders.map((folder) => resolveUploadFile(folder, requested, context));
    const found = tries.find((file) => file.ok);
    if (found) return found;
    return { ok: false, reason: `Não achei "${requested}" nas pastas liberadas (${folders.join('; ')}). Passe o caminho COMPLETO do arquivo.` };
  }
  let real: string;
  try {
    real = realpathSync.native(requested);
  } catch {
    return { ok: false, reason: `Não achei esse arquivo: ${requested}.` };
  }
  for (const folder of folders) {
    let realFolder: string;
    try {
      realFolder = realpathSync.native(folder);
    } catch {
      continue; // the folder is gone: it simply covers nothing
    }
    const inside = relative(realFolder, real);
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) return resolveUploadFile(realFolder, real, context);
  }
  const secret = secretUploadFile(real, context);
  if (secret) return { ok: false, reason: secret };
  return { ok: false, reason: `A pasta desse arquivo não está liberada para o seu quadro. ${HOW_TO_GET_A_FOLDER}` };
}

/** File name a download gets: the suggested name without path pieces, made unique in `dir`. */
export function uniqueDownloadName(dir: string, suggested: string, exists: (path: string) => boolean = existsSync): string {
  const safe = basename(suggested.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')).trim() || 'download';
  const ext = extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  let name = safe;
  for (let i = 1; exists(join(dir, name)); i += 1) name = `${stem} (${i})${ext}`;
  return name;
}
