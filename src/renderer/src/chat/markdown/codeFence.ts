// Fence info of a markdown code block (T051, D-C6). Pure.
//
// The header path comes ONLY from the fence — never inferred:
//   ```ts:src/a.ts          (path after the first colon)
//   ```ts title="src/a.ts"  (title= / path= / file= in the meta)

export interface ParsedFence {
  /** Language exactly as written in the fence, or null. */
  readonly language: string | null;
  readonly path: string | null;
}

const LANGUAGE_PREFIX = 'language-';
const META_PATH = /(?:^|\s)(?:title|path|file)=(?:"([^"]*)"|'([^']*)'|(\S+))/;

function firstLanguageClass(className: string | readonly string[] | undefined): string | null {
  if (className === undefined) return null;
  const list = typeof className === 'string' ? className.split(/\s+/) : className;
  for (const entry of list) {
    if (typeof entry === 'string' && entry.startsWith(LANGUAGE_PREFIX)) {
      return entry.slice(LANGUAGE_PREFIX.length) || null;
    }
  }
  return null;
}

export function parseFence(
  className: string | readonly string[] | undefined,
  meta: string | undefined,
): ParsedFence {
  const raw = firstLanguageClass(className);
  let language: string | null = null;
  let path: string | null = null;
  if (raw !== null) {
    const colon = raw.indexOf(':');
    if (colon === -1) {
      language = raw;
    } else {
      language = raw.slice(0, colon) || null;
      path = raw.slice(colon + 1) || null;
    }
  }
  if (path === null && meta) {
    const match = META_PATH.exec(meta);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value) path = value;
  }
  return { language, path };
}
