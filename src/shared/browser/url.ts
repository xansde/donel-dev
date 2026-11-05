// Navegador interno — what the panel may open. Pure, no I/O.
//
// Only http, https and `about:blank`, plus one local file at a time (owner's decision, 04/11: the HTML a session
// generated opens right in the panel). A local file is a page (HTML), an image or a PDF of this computer, opened
// only by an explicit load (address bar or `navegador_abrir`): never a folder, never a network share, and a page
// never navigates to `file:` by itself (`isAllowedPanelUrl` stays http/https; see the panel guard).
// `javascript:`, `data:`, `chrome:`, `devtools:`, `view-source:` and every other scheme are refused. A URL with a
// user or password inside (`https://user:pass@host`) is refused too: the app never carries a credential, not even
// inside an address.

export type BrowserUrlResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 8192;

/** Extensions of a local file the panel opens: a page, an image or a PDF. */
const LOCAL_FILE_EXTENSIONS = new Set(['html', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'pdf']);
const LOCAL_FILE_REFUSED = 'O navegador do Donel abre arquivo local só de página (HTML), imagem ou PDF, nunca uma pasta.';

function localFileExtension(url: URL): string | null {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = last.slice(dot + 1).toLowerCase();
  return LOCAL_FILE_EXTENSIONS.has(ext) ? ext : null;
}

/** `true` for a `file:` URL of this computer that is a page, an image or a PDF (what `load` accepts besides web). */
export function isAllowedLocalFileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'file:' && url.hostname === '' && localFileExtension(url) !== null;
  } catch {
    return false;
  }
}

/** What a page opened on purpose may pull from its own folder (and below): static assets, never data files. */
const LOCAL_ASSET_EXTENSIONS = new Set(['css', 'js', 'mjs', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'woff', 'woff2', 'ttf', 'otf']);

/** Decoded path of a `file:` URL, compared case-insensitively on a Windows drive. `null` when it is not one. */
function localPathKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:' || url.hostname !== '') return null;
    const path = decodeURIComponent(url.pathname);
    return /^\/[a-z]:\//i.test(path) ? path.toLowerCase() : path;
  } catch {
    return null;
  }
}

/**
 * The panel's `file:` handler (#211 review): a local page runs script, and Chromium would let it `fetch` any file
 * of the disk (`.credentials.json` included) and send it away. So the partition serves ONLY a file opened on purpose
 * (`load`), plus static assets (`LOCAL_ASSET_EXTENSIONS`) under the folder of an HTML page opened on purpose, so a
 * generated report still shows its images and styles. Everything else is refused.
 */
export function canServeLocalFile(requestUrl: string, openedUrls: Iterable<string>): boolean {
  const wanted = localPathKey(requestUrl);
  if (wanted === null) return false;
  const name = wanted.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  for (const opened of openedUrls) {
    const key = localPathKey(opened);
    if (key === null) continue;
    if (key === wanted) return true;
    if (!/\.html?$/i.test(key) || !LOCAL_ASSET_EXTENSIONS.has(ext.toLowerCase())) continue;
    const folder = key.slice(0, key.lastIndexOf('/') + 1);
    if (wanted.startsWith(folder)) return true;
  }
  return false;
}

/**
 * A local path or `file:` URL typed by the owner or passed by the agent, as the URL the panel loads.
 * `null` when the text is not a local path at all (the caller tries it as a web address).
 */
function normalizeLocalFile(text: string): BrowserUrlResult | null {
  if (/^\\\\|^\/\//.test(text)) return { ok: false, reason: 'Arquivo em pasta de rede não é aceito: só arquivo deste computador.' };
  let url: URL;
  if (/^file:/i.test(text)) {
    try {
      url = new URL(text);
    } catch {
      return { ok: false, reason: 'Endereço de arquivo inválido.' };
    }
    if (url.hostname !== '') return { ok: false, reason: 'Arquivo em pasta de rede não é aceito: só arquivo deste computador.' };
  } else if (/^[a-z]:[\\/]/i.test(text) || text.startsWith('/')) {
    // Windows (`C:\pasta\relatorio.html`) or POSIX (`/home/x/relatorio.html`). The pathname setter encodes
    // spaces, `#` and `?`, so a folder named "a#b" stays part of the path.
    url = new URL('file:///');
    url.pathname = (text.startsWith('/') ? '' : '/') + text.replace(/\\/g, '/');
  } else {
    return null;
  }
  if (localFileExtension(url) === null) return { ok: false, reason: LOCAL_FILE_REFUSED };
  return { ok: true, url: url.toString() };
}

/** `true` for a URL the panel may navigate to by itself (navigation guard of the panel's views). Never `file:`. */
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
 * `http://localhost:5173/`; `C:\pasta\relatorio.html` becomes `file:///C:/pasta/relatorio.html`. Anything else is
 * refused with a reason in pt-BR.
 */
export function normalizeBrowserUrl(input: string): BrowserUrlResult {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: false, reason: 'Endereço vazio.' };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: 'Endereço longo demais.' };
  if (text === 'about:blank') return { ok: true, url: 'about:blank' };
  const local = normalizeLocalFile(text);
  if (local !== null) return local;
  if (/\s/.test(text)) return { ok: false, reason: 'Endereço inválido: tem espaço no meio.' };

  let candidate = text;
  const hostAndPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(text);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (hostAndPort) {
    candidate = `${isLocalHostText(text) ? 'http' : 'https'}://${text}`;
  } else if (scheme !== undefined) {
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, reason: `O navegador do Donel só abre endereços http e https, ou um arquivo deste computador (recebi "${scheme}:").` };
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
