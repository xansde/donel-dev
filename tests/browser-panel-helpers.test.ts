// Navegador interno — user agent cleaning and the name a download gets in `<userData>/browser-downloads`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanUserAgent, uniqueDownloadName } from '../src/main/browser/panel-helpers';

describe('cleanUserAgent', () => {
  it('removes the Electron and app tokens and keeps Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) donel-dev/0.4.0 Chrome/140.0.0.0 Electron/43.2.0 Safari/537.36';
    expect(cleanUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  });
});

describe('uniqueDownloadName', () => {
  const dir = join('C:', 'dl');
  it('keeps a plain name and strips path pieces and reserved characters', () => {
    expect(uniqueDownloadName(dir, 'relatorio.pdf', () => false)).toBe('relatorio.pdf');
    expect(uniqueDownloadName(dir, '..\\..\\evil.exe', () => false)).toBe('.._.._evil.exe');
    expect(uniqueDownloadName(dir, 'a:b?.txt', () => false)).toBe('a_b_.txt');
    expect(uniqueDownloadName(dir, '', () => false)).toBe('download');
  });

  it('numbers a name that already exists', () => {
    const taken = new Set([join(dir, 'a.pdf'), join(dir, 'a (1).pdf')]);
    expect(uniqueDownloadName(dir, 'a.pdf', (p) => taken.has(p))).toBe('a (2).pdf');
  });
});
