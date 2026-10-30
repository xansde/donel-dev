import { useEffect, useState } from 'react';
import { MindscapeImageLoader, type MindscapeImageEntry } from './mindscapeImageLoader';

export type { MindscapeImageEntry } from './mindscapeImageLoader';

const LOADING: MindscapeImageEntry = { status: 'loading' };

/**
 * Mindscape desenho, fatia 06 — the `blob:` URL of each print on the board.
 * The bytes come from the main (`mindscape:read-image`) through a
 * `MindscapeImageLoader` that lives while the Mindscape is mounted: one read
 * per imageId, the URL cached, every URL revoked when it unmounts. A file the
 * main cannot give (gone, unreadable) is `missing` — the layer draws the
 * dashed "imagem não encontrada" box — and is asked for again a few times,
 * with a wait between them, before it stays missing.
 */
export function useMindscapeImages(imageIds: readonly string[]): Readonly<Record<string, MindscapeImageEntry>> {
  const [loader, setLoader] = useState<MindscapeImageLoader | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const created = new MindscapeImageLoader(
      {
        read: (imageId) => window.donel.mindscape.readImage(imageId),
        createUrl: (bytes, mediaType) => URL.createObjectURL(new Blob([bytes], { type: mediaType })),
        revokeUrl: (url) => URL.revokeObjectURL(url),
        setTimeout: (cb, ms) => window.setTimeout(cb, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      () => setVersion((v) => v + 1),
    );
    setLoader(created);
    return () => created.dispose();
  }, []);

  const key = [...new Set(imageIds)].sort().join('|');
  useEffect(() => {
    loader?.want(key === '' ? [] : key.split('|'));
  }, [key, loader]);

  // Asked for and not answered yet: loading.
  const result: Record<string, MindscapeImageEntry> = {};
  for (const imageId of imageIds) result[imageId] = loader?.entry(imageId) ?? LOADING;
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
