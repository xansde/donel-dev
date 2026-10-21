// T028 (015-jobu-pet, US1, R9/FR-006) - the click test by alpha. The pet window is a wide transparent
// rectangle that ignores the mouse (`setIgnoreMouseEvents(true, { forward: true })`): the clicks of the
// owner must reach the app underneath, except over the Jobu itself. With the mouse ignored the page
// still receives the forwarded `mousemove`, so the screen asks, for the pixel under the pointer,
// "is this the Jobu?", and only then tells the main to start receiving the mouse (`pet:interactive`).
//
// "The Jobu" is every pixel of the drawing whose alpha is above `PET_HIT_ALPHA`, plus the elements
// marked `data-hit` (the badge now, the bubble and the list later). The alpha comes from a canvas that
// is never attached to the page: the PNG of the pose, drawn at the size it has on screen, so the hit
// area follows the drawing when it is resized (FR-033).
//
// Everything above `loadImage` is pure and tested (tests/pet-hit-test.test.ts); `loadImage` and
// `readAlphaMask` need a DOM and are exercised by the `@pet` smoke.

import { drawingMetrics } from '../../../shared/pet/art';

/** A pixel counts as part of the Jobu above this alpha (0-255): the soft edge of the art does not. */
export const PET_HIT_ALPHA = 40;

/** The alpha channel of a picture, row by row. */
export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array | Uint8ClampedArray;
}

/** Where the picture is on the page, in CSS pixels (what `getBoundingClientRect` gives). */
export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MaskCell {
  readonly column: number;
  readonly row: number;
}

/** The fourth byte of every pixel of RGBA data (what `getImageData` returns). */
export function alphaOfRgba(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const count = width * height;
  if (rgba.length < count * 4) throw new RangeError(`alphaOfRgba: ${rgba.length} bytes for ${width}x${height} pixels`);
  const alpha = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) alpha[i] = rgba[i * 4 + 3] ?? 0;
  return alpha;
}

/** The canvas the alpha is read from: the drawing at that size, in whole pixels. */
export function maskSizeFor(size: number): { readonly width: number; readonly height: number } {
  const metrics = drawingMetrics(size);
  return { width: Math.max(1, Math.round(metrics.width)), height: Math.max(1, Math.round(metrics.height)) };
}

/**
 * The cell of the mask under the pointer, through the rectangle the picture occupies. The rectangle
 * is fractional (a drawing 115.5 wide) and the mask is whole (116), so the mapping is proportional.
 * The left and top edges belong to the picture, the right and bottom ones do not.
 */
export function maskCellAt(mask: AlphaMask, where: PixelRect, clientX: number, clientY: number): MaskCell | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (mask.width <= 0 || mask.height <= 0 || !(where.width > 0) || !(where.height > 0)) return null;
  const dx = clientX - where.left;
  const dy = clientY - where.top;
  if (dx < 0 || dy < 0 || dx >= where.width || dy >= where.height) return null;
  return {
    column: Math.min(mask.width - 1, Math.floor((dx / where.width) * mask.width)),
    row: Math.min(mask.height - 1, Math.floor((dy / where.height) * mask.height)),
  };
}

/** The alpha under the pointer; 0 outside the picture. */
export function alphaAt(mask: AlphaMask, where: PixelRect, clientX: number, clientY: number): number {
  const cell = maskCellAt(mask, where, clientX, clientY);
  return cell === null ? 0 : (mask.alpha[cell.row * mask.width + cell.column] ?? 0);
}

/** Is the Jobu under the pointer? With no mask yet the answer is no: a click goes through before it is swallowed. */
export function isOpaqueAt(mask: AlphaMask | null, where: PixelRect, clientX: number, clientY: number, threshold: number = PET_HIT_ALPHA): boolean {
  return mask !== null && alphaAt(mask, where, clientX, clientY) > threshold;
}

// ---------------------------------------------------------------------------
// DOM: reading the alpha of a real picture
// ---------------------------------------------------------------------------

/** Decodes a picture. The art is a `data:` URI (PetApp.tsx), which no page treats as another origin. */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/**
 * Draws the picture at `width` x `height` on a canvas that is never put on the page and reads its
 * alpha. It throws if the canvas is not readable, which a picture from another origin would cause
 * (a `file://` page treats every file as another origin, which is why the art is inlined).
 */
export function readAlphaMask(image: CanvasImageSource, width: number, height: number): AlphaMask {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('readAlphaMask: o canvas 2D não está disponível');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, alpha: alphaOfRgba(data, width, height) };
}
