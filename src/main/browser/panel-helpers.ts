import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

// Navegador interno — pure helpers of browser-panels.ts (kept apart so vitest never imports `electron`).

/** Strips the `Electron/x` and app tokens of the user agent: some login pages refuse an "Electron" browser. */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s(?:Electron|donel-dev|Donel Dev[^/]*)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
