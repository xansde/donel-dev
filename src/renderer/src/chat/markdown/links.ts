// Link classification for assistant markdown (T051). Pure.
//
// The chat only opens http(s) and mailto, and only through `chat:open-external`
// (R21). Everything else is shown as text — in particular a Windows path
// (`C:\Users\...`) that the model wrote as a link must NOT become a broken
// anchor: it renders as a plain path.

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\/]/;
const EXTERNAL = /^(https?:\/\/|mailto:)/i;

export function isWindowsPath(value: string): boolean {
  return WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value);
}

export type LinkKind =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'none' };

export function classifyLink(href: string | undefined): LinkKind {
  const value = (href ?? '').trim();
  if (value === '') return { kind: 'none' };
  if (isWindowsPath(value)) return { kind: 'path', path: value };
  if (EXTERNAL.test(value)) return { kind: 'external', url: value };
  return { kind: 'none' };
}
