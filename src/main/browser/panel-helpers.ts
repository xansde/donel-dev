import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import { MAX_UPLOAD_BYTES, refusedUploadFile } from '../../shared/browser/upload';

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
 * The file `navegador_enviar_arquivo` asked for, resolved inside the folder the owner authorized. Both paths go
 * through `realpath` first: a link inside the folder that points out of it is refused like `..` is.
 */
export function resolveUploadFile(folder: string, requested: string): UploadFile {
  let realFolder: string;
  let realFile: string;
  try {
    realFolder = realpathSync.native(folder);
  } catch {
    return { ok: false, reason: 'A pasta autorizada não existe mais. Peça ao dono para escolher de novo (navegador_pedir_humano).' };
  }
  try {
    realFile = realpathSync.native(isAbsolute(requested) ? requested : join(realFolder, requested));
  } catch {
    return { ok: false, reason: `Não achei esse arquivo na pasta autorizada (${realFolder}).` };
  }
  const refused = refusedUploadFile(relative(realFolder, realFile));
  if (refused) return { ok: false, reason: refused };
  const stat = statSync(realFile);
  if (!stat.isFile()) return { ok: false, reason: 'Esse caminho não é um arquivo.' };
  if (stat.size === 0) return { ok: false, reason: 'Esse arquivo está vazio.' };
  if (stat.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `Esse arquivo passa do limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  return { ok: true, path: realFile, name: basename(realFile) };
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
