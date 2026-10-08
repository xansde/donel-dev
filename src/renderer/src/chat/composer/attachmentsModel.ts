// T088 (014-chat) - pure model of the composer attachments: which files are images, how a non-image file
// becomes an `@` mention (FR-015, decision 4), the "imagem colada N" label and the request the driver gets.

import type { SendRequest } from '../sendDriver';

/** A pasted/dropped/picked image already saved by the main (`chat:save-image`). */
export interface DraftImage {
  readonly id: string;
  /** Absolute path written by the main: what the send machine pastes. */
  readonly path: string;
  readonly mediaType: string;
  /** How the thumbnail was born, for the label ("imagem colada N" vs the file name). */
  readonly origin: 'pasted' | 'picked';
  /** Original file name, when there was one. */
  readonly name?: string;
}

export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const EXT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Media type of an image file (by the browser's type, then by extension); `null` = not an image we accept. */
export function imageTypeOf(file: { readonly name: string; readonly type: string }): string | null {
  if (IMAGE_MEDIA_TYPES.has(file.type)) return file.type;
  if (file.type !== '' && file.type !== 'application/octet-stream') return null;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_TYPES[ext] ?? null;
}

const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * Text that mentions a non-image file. Inside the tab's `cwd` it is `@relative/path`. Outside it, `@` with an
 * absolute path is NOT confirmed to work in the CLI (research R4 is open), so the plain path is inserted instead.
 * A path with spaces is quoted.
 */
export function mentionFor(absolutePath: string, cwd: string | undefined): string {
  const file = normalize(absolutePath);
  const base = cwd === undefined || cwd === '' ? null : normalize(cwd);
  const windows = /^[A-Za-z]:\//.test(file);
  const inside = base !== null && (windows ? file.toLowerCase().startsWith(`${base.toLowerCase()}/`) : file.startsWith(`${base}/`));
  const shown = inside && base !== null ? file.slice(base.length + 1) : file;
  const body = /\s/.test(shown) ? `"${shown}"` : shown;
  return inside ? `@${body}` : body;
}

/** Appends a mention to the draft text, separated by one space (or nothing, on an empty box). */
export function appendMention(text: string, mention: string): string {
  if (text === '') return `${mention} `;
  return `${text}${/\s$/.test(text) ? '' : ' '}${mention} `;
}

/** "imagem colada 1", "imagem colada 2"... by position among the pasted ones; picked files keep their name. */
export function imageLabels(images: readonly DraftImage[]): string[] {
  let pasted = 0;
  return images.map((image) => {
    if (image.origin === 'pasted') {
      pasted += 1;
      return `imagem colada ${pasted}`;
    }
    return image.name ?? 'imagem';
  });
}

export function canSend(text: string, images: readonly DraftImage[]): boolean {
  return text.trim() !== '' || images.length > 0;
}

/** What the driver gets: the text and one pasted path per image, in the order they sit in the draft. */
export function sendRequestOf(text: string, images: readonly DraftImage[], mode: 'normal' | 'interrupt-first'): SendRequest {
  return { text, mode, ...(images.length > 0 ? { imagePaths: images.map((i) => i.path) } : {}) };
}
