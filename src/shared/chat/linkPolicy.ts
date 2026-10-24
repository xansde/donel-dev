// T044 (014-chat) - what the chat may open outside the window (research.md R21).
// Pure; used by the main process (`chat:open-external`, `chat:open-generated`,
// the `donel-asset:` protocol). The renderer never decides this on its own.

import { extname, isAbsolute, relative, resolve } from 'node:path';

/** Document and image extensions a generated file may have to be opened (never executables). */
export const OPENABLE_EXTENSIONS: readonly string[] = ['html', 'md', 'pdf', 'png', 'jpg', 'svg', 'csv', 'txt'];

/** Only `http:` / `https:` URLs leave the app (via `shell.openExternal`). */
export function isExternalUrlAllowed(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** `child` is an absolute path strictly inside `root` (no traversal, not the root itself). */
function isInsideRoot(child: string, root: string): boolean {
  if (!isAbsolute(root)) return false;
  const rel = relative(resolve(root), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function isSafeAbsolutePath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && !path.includes('\0') && isAbsolute(path);
}

/** Absolute path strictly inside one of `roots` (the conversation's files, the attachments folder). */
export function isAssetPathAllowed(path: string, roots: readonly string[]): boolean {
  if (!isSafeAbsolutePath(path)) return false;
  return roots.some((root) => isInsideRoot(path, root));
}

/**
 * A file the chat may hand to the system's default app: a document/image
 * extension, inside the session `cwd` or the attachments folder (`roots`).
 */
export function isGeneratedFileOpenable(path: string, roots: readonly string[]): boolean {
  if (!isSafeAbsolutePath(path)) return false;
  const ext = extname(path).slice(1).toLowerCase();
  if (!OPENABLE_EXTENSIONS.includes(ext)) return false;
  return isAssetPathAllowed(path, roots);
}
