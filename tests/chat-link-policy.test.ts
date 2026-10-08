// T044 (014-chat) - link / generated-file / asset path policy (research.md R21).
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAssetPathAllowed, isExternalUrlAllowed, isGeneratedFileOpenable } from '../src/shared/chat/linkPolicy';

describe('isExternalUrlAllowed', () => {
  it('allows only http and https', () => {
    expect(isExternalUrlAllowed('https://example.com/a?b=1')).toBe(true);
    expect(isExternalUrlAllowed('http://localhost:3000')).toBe(true);
    expect(isExternalUrlAllowed('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isExternalUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isExternalUrlAllowed('data:text/html,<b>x</b>')).toBe(false);
    expect(isExternalUrlAllowed('donel-asset://image/x')).toBe(false);
    expect(isExternalUrlAllowed('ms-msdt:/id')).toBe(false);
  });

  it('rejects things that are not absolute URLs', () => {
    expect(isExternalUrlAllowed('')).toBe(false);
    expect(isExternalUrlAllowed('example.com')).toBe(false);
    expect(isExternalUrlAllowed('//example.com')).toBe(false);
    expect(isExternalUrlAllowed('C:\\Users\\x\\a.html')).toBe(false);
    expect(isExternalUrlAllowed(undefined as unknown as string)).toBe(false);
  });
});

describe('isGeneratedFileOpenable', () => {
  const cwd = resolve('/work/project');
  const attachments = resolve('/data/chat-attachments');
  const roots = [cwd, attachments];

  it('allows document and image extensions inside the cwd or the attachments folder', () => {
    for (const ext of ['html', 'md', 'pdf', 'png', 'jpg', 'svg', 'csv', 'txt']) {
      expect(isGeneratedFileOpenable(resolve(cwd, `out/report.${ext}`), roots)).toBe(true);
    }
    expect(isGeneratedFileOpenable(resolve(attachments, 's1/img.png'), roots)).toBe(true);
    expect(isGeneratedFileOpenable(resolve(cwd, 'REPORT.HTML'), roots)).toBe(true);
  });

  it('refuses executables and unknown extensions', () => {
    for (const name of ['a.exe', 'a.bat', 'a.cmd', 'a.ps1', 'a.lnk', 'a.js', 'a.msi', 'a.html.exe', 'noext', 'a.']) {
      expect(isGeneratedFileOpenable(resolve(cwd, name), roots)).toBe(false);
    }
  });

  it('refuses paths outside the roots, traversal and relative paths', () => {
    expect(isGeneratedFileOpenable(resolve('/etc/passwd.txt'), roots)).toBe(false);
    expect(isGeneratedFileOpenable(`${cwd}/../secret.txt`, roots)).toBe(false);
    expect(isGeneratedFileOpenable(resolve('/work/project-evil/a.txt'), roots)).toBe(false);
    expect(isGeneratedFileOpenable('out/report.html', roots)).toBe(false);
    expect(isGeneratedFileOpenable(cwd, roots)).toBe(false);
    expect(isGeneratedFileOpenable(resolve(cwd, 'a.txt'), [])).toBe(false);
    expect(isGeneratedFileOpenable(`${cwd}/a\0.txt`, roots)).toBe(false);
  });
});

describe('isAssetPathAllowed', () => {
  const sessions = resolve('/home/u/.claude/projects/p');
  const attachments = resolve('/data/chat-attachments');

  it('allows files under the given roots only', () => {
    expect(isAssetPathAllowed(resolve(sessions, 's.jsonl'), [sessions, attachments])).toBe(true);
    expect(isAssetPathAllowed(resolve(attachments, 'a/b.png'), [sessions, attachments])).toBe(true);
    expect(isAssetPathAllowed(resolve('/home/u/.ssh/id_rsa'), [sessions, attachments])).toBe(false);
    expect(isAssetPathAllowed(`${sessions}/../../.credentials.json`, [sessions])).toBe(false);
    expect(isAssetPathAllowed('rel/x.png', [sessions])).toBe(false);
    expect(isAssetPathAllowed(sessions, [sessions])).toBe(false);
  });
});
