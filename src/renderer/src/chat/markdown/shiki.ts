// Syntax highlighting for chat code blocks (T051, R20/R21).
//
// Shiki CORE + Oniguruma engine in WASM (`shiki/wasm`, base64-inlined: it needs
// `'wasm-unsafe-eval'` in the CSP, never `unsafe-eval`). Grammars are loaded on
// demand, one dynamic import per language; the theme maps scopes to the
// `--code-*` variables (./shikiTheme.ts). Output is tokens, never HTML — the
// React layer turns them into <span>s.
import type { HighlighterCore, ThemedToken } from 'shiki/core';
import { LRUCache } from '../../../../shared/chat/t3/lruCache';
import { resolveLanguage } from './languages';
import { DONEL_CODE_THEME } from './shikiTheme';

/** One token: text + the `var(--code-*)` color Shiki resolved for it. */
export interface HighlightToken {
  readonly content: string;
  readonly color?: string;
  readonly italic?: boolean;
  readonly bold?: boolean;
}
export type HighlightedLine = readonly HighlightToken[];

/** Above this the block stays plain text — tokenizing it would freeze the UI. */
export const MAX_HIGHLIGHT_CHARS = 200_000;
const CACHE_ENTRIES = 200;
const CACHE_BYTES = 8 * 1024 * 1024;

type LangModule = () => Promise<unknown>;

// One literal import per grammar so the bundler emits one lazy chunk each.
const LOADERS: Readonly<Record<string, LangModule>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/oniguruma'),
      ]);
      return createHighlighterCore({
        themes: [DONEL_CODE_THEME],
        langs: [],
        engine: createOnigurumaEngine(import('shiki/wasm')),
      });
    })();
    // A failed init must be retryable (e.g. the chunk was not reachable once).
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

const loadedLanguages = new Map<string, Promise<void>>();

function ensureLanguage(highlighter: HighlighterCore, id: string): Promise<void> {
  let pending = loadedLanguages.get(id);
  if (pending === undefined) {
    const loader = LOADERS[id];
    pending = loader === undefined
      ? Promise.reject(new Error(`no grammar loader for ${id}`))
      : highlighter.loadLanguage(loader() as Parameters<HighlighterCore['loadLanguage']>[0]);
    loadedLanguages.set(id, pending);
    pending.catch(() => loadedLanguages.delete(id));
  }
  return pending;
}

const cache = new LRUCache<HighlightedLine[]>(CACHE_ENTRIES, CACHE_BYTES);

function toToken(token: ThemedToken): HighlightToken {
  // Shiki FontStyle bit flags: 1 italic, 2 bold.
  const style = token.fontStyle ?? 0;
  return {
    content: token.content,
    ...(token.color ? { color: token.color } : {}),
    ...(style & 1 ? { italic: true } : {}),
    ...(style & 2 ? { bold: true } : {}),
  };
}

/**
 * Tokens per line, or `null` when the block must stay plain text (no/unknown
 * language, empty or oversized code, grammar failed to load). Never throws.
 */
export async function highlightCode(code: string, language: string | null): Promise<HighlightedLine[] | null> {
  const resolved = resolveLanguage(language);
  if (resolved === null || code === '' || code.length > MAX_HIGHLIGHT_CHARS) return null;

  const key = `${resolved.id}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== null) return hit;

  try {
    const highlighter = await getHighlighter();
    await ensureLanguage(highlighter, resolved.id);
    const lines = highlighter
      .codeToTokensBase(code, { lang: resolved.id, theme: DONEL_CODE_THEME.name! })
      .map((line) => line.map(toToken));
    cache.set(key, lines, code.length * 8);
    return lines;
  } catch {
    return null;
  }
}
