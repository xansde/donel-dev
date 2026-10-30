import { useEffect, useRef, useState } from 'react';

/** What the screen knows about the file of a print. */
export type MindscapeImageEntry = { readonly status: 'loading' } | { readonly status: 'ready'; readonly url: string } | { readonly status: 'missing' };

const LOADING: MindscapeImageEntry = { status: 'loading' };

/**
 * Mindscape desenho, fatia 06 — the `blob:` URL of each print on the board.
 * The bytes come from the main (`mindscape:read-image`) once per imageId and
 * stay cached while the Mindscape is mounted; every URL is revoked when it
 * unmounts. A file the main cannot give (gone, unreadable) is `missing`: the
 * layer draws the dashed "imagem não encontrada" box in its place.
 */
export function useMindscapeImages(imageIds: readonly string[]): Readonly<Record<string, MindscapeImageEntry>> {
  const [entries, setEntries] = useState<Record<string, MindscapeImageEntry>>({});
  const requestedRef = useRef(new Set<string>());
  const urlsRef = useRef(new Map<string, string>());
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const urls = urlsRef.current;
    return () => {
      aliveRef.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const key = [...new Set(imageIds)].sort().join('|');
  useEffect(() => {
    const wanted = key === '' ? [] : key.split('|');
    for (const imageId of wanted) {
      if (requestedRef.current.has(imageId)) continue;
      requestedRef.current.add(imageId);
      void window.donel.mindscape
        .readImage(imageId)
        .then((result): MindscapeImageEntry => {
          if (!result.ok) return { status: 'missing' };
          if (!aliveRef.current) return { status: 'missing' };
          const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mediaType }));
          urlsRef.current.set(imageId, url);
          return { status: 'ready', url };
        })
        .catch((): MindscapeImageEntry => ({ status: 'missing' }))
        .then((entry) => {
          if (aliveRef.current) setEntries((current) => ({ ...current, [imageId]: entry }));
        });
    }
  }, [key]);

  // Asked for and not answered yet: loading.
  const result: Record<string, MindscapeImageEntry> = {};
  for (const imageId of imageIds) result[imageId] = entries[imageId] ?? LOADING;
  return result;
}

/** A print ready to go to the main: the bytes, the type it is stored as and its natural size. */
export interface PreparedPrint {
  readonly bytes: ArrayBuffer;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Fatia 06 — decodes a pasted or dropped image to learn its natural size. A
 * GIF becomes a PNG of its first frame (`createImageBitmap` → canvas): a print
 * does not animate. Bytes that do not decode → `null`.
 */
export async function preparePrint(file: Blob): Promise<PreparedPrint | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    if (file.type !== 'image/gif') return { bytes: await file.arrayBuffer(), mediaType: file.type, width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ? { bytes: await png.arrayBuffer(), mediaType: 'image/png', width, height } : null;
  } finally {
    bitmap.close();
  }
}
