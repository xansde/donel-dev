import { describe, expect, it } from 'vitest';
import { joinAnswerMarkdown } from '../src/renderer/src/chat/markdown/answerText';
import { parseFence } from '../src/renderer/src/chat/markdown/codeFence';
import { classifyLink, isWindowsPath } from '../src/renderer/src/chat/markdown/links';
import { parseUnifiedDiff } from '../src/renderer/src/chat/markdown/unifiedDiff';

describe('isWindowsPath', () => {
  it.each([
    'C:\\Users\\x\\file.txt',
    'c:/Users/x/file.txt',
    'D:\\',
    '\\\\server\\share\\a.txt',
  ])('detects %s', (value) => {
    expect(isWindowsPath(value)).toBe(true);
  });

  it.each(['https://example.com', 'src/a.ts', '/usr/bin', 'C', 'mailto:a@b.co', '#ancora', 'C:foo'])(
    'rejects %s',
    (value) => {
      expect(isWindowsPath(value)).toBe(false);
    },
  );
});

describe('classifyLink', () => {
  it('opens http(s) and mailto externally', () => {
    expect(classifyLink('https://example.com/a?b=1')).toEqual({ kind: 'external', url: 'https://example.com/a?b=1' });
    expect(classifyLink('http://example.com')).toEqual({ kind: 'external', url: 'http://example.com' });
    expect(classifyLink('mailto:a@b.co')).toEqual({ kind: 'external', url: 'mailto:a@b.co' });
  });

  it('never makes a Windows path a link', () => {
    expect(classifyLink('C:\\Users\\x\\a.txt')).toEqual({ kind: 'path', path: 'C:\\Users\\x\\a.txt' });
    expect(classifyLink('C:/Users/x/a.txt')).toEqual({ kind: 'path', path: 'C:/Users/x/a.txt' });
  });

  it('treats everything else as plain text', () => {
    for (const href of ['javascript:alert(1)', 'file:///C:/a.txt', 'data:text/html,x', '#sec', 'src/a.ts', '', undefined]) {
      expect(classifyLink(href).kind).toBe('none');
    }
  });

  it('is case-insensitive on the scheme and trims whitespace', () => {
    expect(classifyLink('  HTTPS://Example.com ')).toEqual({ kind: 'external', url: 'HTTPS://Example.com' });
  });
});

describe('parseFence', () => {
  it('reads the language from the class and shows no path by default', () => {
    expect(parseFence('language-typescript', undefined)).toEqual({ language: 'typescript', path: null });
  });

  it('takes the path only from the fence: ts:path', () => {
    expect(parseFence('language-ts:src/a.ts', undefined)).toEqual({ language: 'ts', path: 'src/a.ts' });
  });

  it('takes the path from title= / path= / file= in the meta', () => {
    expect(parseFence('language-ts', 'title=src/a.ts')).toEqual({ language: 'ts', path: 'src/a.ts' });
    expect(parseFence('language-ts', 'title="src/my file.ts" {1,3}')).toEqual({ language: 'ts', path: 'src/my file.ts' });
    expect(parseFence('language-ts', "path='src/a.ts'")).toEqual({ language: 'ts', path: 'src/a.ts' });
    expect(parseFence('language-ts', 'file=src/a.ts')).toEqual({ language: 'ts', path: 'src/a.ts' });
  });

  it('never infers a path and handles a fence without language', () => {
    expect(parseFence(undefined, undefined)).toEqual({ language: null, path: null });
    expect(parseFence('', 'sem chave')).toEqual({ language: null, path: null });
    expect(parseFence(['foo', 'language-sh'], undefined)).toEqual({ language: 'sh', path: null });
  });

  it('keeps a Windows drive in ts:C:\\x as part of the path', () => {
    expect(parseFence('language-ts:C:\\x\\a.ts', undefined)).toEqual({ language: 'ts', path: 'C:\\x\\a.ts' });
  });
});

describe('joinAnswerMarkdown', () => {
  it('joins the blocks of one answer with a blank line and drops empties', () => {
    expect(joinAnswerMarkdown(['um', '', '  dois  \n', 'três'])).toBe('um\n\ndois\n\ntrês');
    expect(joinAnswerMarkdown([])).toBe('');
  });
});

describe('parseUnifiedDiff', () => {
  const patch = ['@@ -18,4 +18,5 @@', ' keep', '-old one', '-old two', '+new one', '+new two', '+new three', ' tail'].join('\n');

  it('numbers lines from the hunk header and counts +a -b', () => {
    const parsed = parseUnifiedDiff(patch);
    expect(parsed.added).toBe(3);
    expect(parsed.removed).toBe(2);
    expect(parsed.hunk).toBe('@@ -18,4 +18,5 @@');
    expect(parsed.lines).toEqual([
      { kind: 'ctx', text: 'keep', number: 18 },
      { kind: 'del', text: 'old one', number: 19 },
      { kind: 'del', text: 'old two', number: 20 },
      { kind: 'add', text: 'new one', number: 19 },
      { kind: 'add', text: 'new two', number: 20 },
      { kind: 'add', text: 'new three', number: 21 },
      { kind: 'ctx', text: 'tail', number: 22 },
    ]);
  });

  it('handles a created file (all additions)', () => {
    const parsed = parseUnifiedDiff('@@ -0,0 +1,2 @@\n+a\n+b');
    expect(parsed.lines.map((l) => [l.kind, l.number])).toEqual([
      ['add', 1],
      ['add', 2],
    ]);
    expect(parsed.removed).toBe(0);
  });

  it('separates several hunks and drops the single hunk label', () => {
    const parsed = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,1 @@\n-c\n+d');
    expect(parsed.hunk).toBeUndefined();
    expect(parsed.lines.map((l) => l.text)).toEqual(['a', 'b', '⋯', 'c', 'd']);
    expect(parsed.lines[2]).toEqual({ kind: 'ctx', text: '⋯' });
  });

  it('ignores "\\ No newline" markers, CRLF and empty input', () => {
    expect(parseUnifiedDiff('@@ -1,1 +1,1 @@\r\n-a\r\n\\ No newline at end of file\r\n+b').lines).toHaveLength(2);
    expect(parseUnifiedDiff('')).toEqual({ lines: [], added: 0, removed: 0 });
  });

  it('accepts a body without a header, with no numbers', () => {
    const parsed = parseUnifiedDiff('-x\n+y');
    expect(parsed.lines).toEqual([
      { kind: 'del', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });
});
