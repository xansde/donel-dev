// Navegador interno — what the panel may open (address bar and `navegador_abrir`).
import { describe, expect, it } from 'vitest';
import { isAllowedPanelUrl, normalizeBrowserUrl } from '../src/shared/browser/url';

describe('normalizeBrowserUrl', () => {
  it('keeps http and https URLs', () => {
    expect(normalizeBrowserUrl('https://example.com/a?b=1#c')).toEqual({ ok: true, url: 'https://example.com/a?b=1#c' });
    expect(normalizeBrowserUrl('  http://example.com ')).toEqual({ ok: true, url: 'http://example.com/' });
  });

  it('adds https to a bare host and http to a local dev server', () => {
    expect(normalizeBrowserUrl('example.com')).toEqual({ ok: true, url: 'https://example.com/' });
    expect(normalizeBrowserUrl('github.com/xansde')).toEqual({ ok: true, url: 'https://github.com/xansde' });
    expect(normalizeBrowserUrl('localhost:5173')).toEqual({ ok: true, url: 'http://localhost:5173/' });
    expect(normalizeBrowserUrl('127.0.0.1:3000/api')).toEqual({ ok: true, url: 'http://127.0.0.1:3000/api' });
    expect(normalizeBrowserUrl('app.localhost')).toEqual({ ok: true, url: 'http://app.localhost/' });
    expect(normalizeBrowserUrl('example.com:8443')).toEqual({ ok: true, url: 'https://example.com:8443/' });
  });

  it('accepts about:blank', () => {
    expect(normalizeBrowserUrl('about:blank')).toEqual({ ok: true, url: 'about:blank' });
  });

  it('refuses a local file that is not a page, image or PDF, and every scheme other than http/https', () => {
    for (const input of ['file:///C:/Users/x/a.txt', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'chrome://settings', 'view-source:https://a.com', 'devtools://x']) {
      const result = normalizeBrowserUrl(input);
      expect(result.ok, input).toBe(false);
    }
    expect(normalizeBrowserUrl('file:///C:/x')).toEqual({ ok: false, reason: 'O navegador do Donel abre arquivo local só de página (HTML), imagem ou PDF, nunca uma pasta.' });
  });

  it('refuses a user or password embedded in the URL', () => {
    const result = normalizeBrowserUrl('https://alice:s3cret@example.com/');
    expect(result.ok).toBe(false);
  });

  it('refuses empty, spaced and malformed input', () => {
    expect(normalizeBrowserUrl('')).toEqual({ ok: false, reason: 'Endereço vazio.' });
    expect(normalizeBrowserUrl('   ')).toEqual({ ok: false, reason: 'Endereço vazio.' });
    expect(normalizeBrowserUrl('como fazer bolo').ok).toBe(false);
    expect(normalizeBrowserUrl('https://').ok).toBe(false);
    expect(normalizeBrowserUrl(`https://a.com/${'x'.repeat(9000)}`).ok).toBe(false);
  });
});

describe('isAllowedPanelUrl', () => {
  it('allows http, https and about:blank only', () => {
    expect(isAllowedPanelUrl('https://example.com/')).toBe(true);
    expect(isAllowedPanelUrl('http://localhost:3000/x')).toBe(true);
    expect(isAllowedPanelUrl('about:blank')).toBe(true);
    expect(isAllowedPanelUrl('file:///C:/x')).toBe(false);
    expect(isAllowedPanelUrl('blob:https://example.com/123')).toBe(false);
    expect(isAllowedPanelUrl('https://u:p@example.com/')).toBe(false);
    expect(isAllowedPanelUrl('not a url')).toBe(false);
  });
});
