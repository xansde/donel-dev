import { beforeAll, describe, expect, it } from 'vitest';
import { resolveLanguage } from '../src/renderer/src/chat/markdown/languages';
import { highlightCode } from '../src/renderer/src/chat/markdown/shiki';

describe('resolveLanguage', () => {
  it('resolves ids, aliases and case', () => {
    expect(resolveLanguage('ts')?.label).toBe('typescript');
    expect(resolveLanguage('TypeScript')?.label).toBe('typescript');
    expect(resolveLanguage('sh')?.label).toBe('bash');
    expect(resolveLanguage('ps1')?.label).toBe('powershell');
    expect(resolveLanguage('yml')?.label).toBe('yaml');
  });

  it('returns null for missing or unknown languages (plain text)', () => {
    expect(resolveLanguage(null)).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage('klingon')).toBeNull();
    expect(resolveLanguage('text')).toBeNull();
  });
});

type Line = Awaited<ReturnType<typeof highlightCode>>;

function colorOf(lines: NonNullable<Line>, content: string): string | undefined {
  for (const line of lines) for (const token of line) if (token.content.trim() === content) return token.color;
  return undefined;
}

// The first call loads the Oniguruma WASM and the grammar: ~3 s on an idle machine, well past
// vitest's 5 s default once the whole suite runs in parallel. That cold start is paid once, here,
// with its own generous budget, so each test below only measures what it asserts (tokens, colors,
// cache). The describe-level timeout is a margin for the next grammars, loaded lazily.
beforeAll(async () => {
  await highlightCode('const warm = 1;', 'typescript');
}, 60_000);

describe('highlightCode (Shiki core + Oniguruma WASM)', { timeout: 20_000 }, () => {
  it('maps TextMate scopes to the --code-* roles of the approved palette', async () => {
    const lines = await highlightCode(
      ['// nota', 'export function soma(a: number): number {', '  const s = "x" + 42;', '  return s;', '}'].join('\n'),
      'typescript',
    );
    expect(lines).not.toBeNull();
    const out = lines!;
    expect(out).toHaveLength(5);
    expect(colorOf(out, '// nota')).toBe('var(--code-cm)');
    expect(colorOf(out, 'function')).toBe('var(--code-kw)');
    expect(colorOf(out, 'soma')).toBe('var(--code-fn)');
    expect(colorOf(out, 'number')).toBe('var(--code-ty)');
    expect(colorOf(out, '42')).toBe('var(--code-nu)');
    expect(colorOf(out, '"x"')).toBe('var(--code-st)');
  });

  it('keeps operators in the text color (only words are keywords)', async () => {
    const lines = (await highlightCode('a = b + 1', 'typescript'))!;
    expect(colorOf(lines, '=')).not.toBe('var(--code-kw)');
    expect(colorOf(lines, '+')).not.toBe('var(--code-kw)');
  });

  it('reproduces the source exactly, token by token', async () => {
    const code = 'const a = 1;\n\n  if (a) {\n    go();\n  }';
    const lines = (await highlightCode(code, 'ts'))!;
    expect(lines.map((line) => line.map((t) => t.content).join('')).join('\n')).toBe(code);
  });

  it('returns null for an unsupported language and for empty code', async () => {
    expect(await highlightCode('x', 'klingon')).toBeNull();
    expect(await highlightCode('', 'ts')).toBeNull();
  });

  it('caches by language + code (LRU) and returns the same lines', async () => {
    const code = 'let cached = true;';
    const first = await highlightCode(code, 'ts');
    const second = await highlightCode(code, 'typescript');
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('degrades to null (plain text) beyond the size cap', async () => {
    expect(await highlightCode('x'.repeat(200_001), 'ts')).toBeNull();
  });
});
