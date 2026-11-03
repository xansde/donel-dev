// Navegador interno — what the panel may open. Pure, no I/O.
//
// Only http, https and `about:blank`. `file://` is refused (it would expose the disk to a page the agent
// drives), and so are `javascript:`, `data:`, `chrome:`, `devtools:`, `view-source:` and every other scheme.
// A URL with a user or password inside (`https://user:pass@host`) is refused too: the app never carries a
// credential, not even inside an address.

export type BrowserUrlResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 8192;

/** `true` for a URL the panel may show (used by the navigation guard of the panel's views). */
export function isAllowedPanelUrl(raw: string): boolean {
  if (raw === 'about:blank') return true;
  try {
    const url = new URL(raw);
    return ALLOWED_PROTOCOLS.has(url.protocol) && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** Host typed without a scheme that is a local dev server: gets `http://` instead of `https://`. */
function isLocalHostText(text: string): boolean {
  const host = text.split(/[/?#]/, 1)[0].replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * Turns what the owner typed in the address bar (or what the agent passed to `navegador_abrir`) into a URL
 * the panel loads. `example.com` becomes `https://example.com/`; `localhost:5173` becomes
 * `http://localhost:5173/`. Anything else is refused with a reason in pt-BR.
 */
export function normalizeBrowserUrl(input: string): BrowserUrlResult {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: false, reason: 'Endereço vazio.' };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: 'Endereço longo demais.' };
  if (text === 'about:blank') return { ok: true, url: 'about:blank' };
  if (/\s/.test(text)) return { ok: false, reason: 'Endereço inválido: tem espaço no meio.' };

  let candidate = text;
  const hostAndPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(text);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (hostAndPort) {
    candidate = `${isLocalHostText(text) ? 'http' : 'https'}://${text}`;
  } else if (scheme !== undefined) {
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, reason: `O navegador do Donel só abre endereços http e https (recebi "${scheme}:").` };
    }
  } else {
    candidate = `${isLocalHostText(text) ? 'http' : 'https'}://${text}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'Endereço inválido.' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.hostname === '') return { ok: false, reason: 'Endereço inválido.' };
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'Endereço com usuário ou senha embutidos não é aceito: faça o login na própria página.' };
  }
  return { ok: true, url: url.toString() };
}
