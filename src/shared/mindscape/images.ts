// Mindscape desenho, fatia 06 — the pure side of the print (pasted or dropped
// image): the imageId pattern, the size a print is born with, the ids the
// boards still reference (boot sweep) and the limits. The binary lives in
// `<userData>/mindscape-images/<imageId>`, written only by the main
// (`src/main/mindscape-images.ts`); the JSON keeps only the imageId. Design:
// docs/design/mindscape-desenho.md, "Print".

import type { Point } from './view';

/**
 * The only name the main builds a path from: `img-<time base36>-<8 hex>.<png|jpg|webp>`.
 * No separator, no dot-dot, no drive mark can pass. Also the rule of the parse.
 */
export const IMAGE_ID_PATTERN = /^img-[0-9a-z]+-[0-9a-f]{8}\.(png|jpg|webp)$/;

/** Bigger than this is refused, in the renderer (warning) and again in the main. */
export const MAX_PRINT_BYTES = 10 * 1024 * 1024;
/** A print is born at most this wide (board units), keeping the proportion. */
export const PRINT_MAX_WIDTH = 480;
/** The boot sweep only takes away an orphan older than this (a print just pasted by another channel open at the same time). */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/** What the renderer takes from a paste or a drop. SVG is out (it can carry script). */
const PRINT_INPUT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** What the main stores: a GIF is decoded to PNG by the renderer first (a print does not animate). */
const PRINT_STORED_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_ID_PATTERN.test(value);
}

export function isPrintInputType(mediaType: unknown): mediaType is string {
  return typeof mediaType === 'string' && PRINT_INPUT_TYPES.includes(mediaType);
}

export function isPrintStoredType(mediaType: unknown): mediaType is string {
  return typeof mediaType === 'string' && PRINT_STORED_TYPES.includes(mediaType);
}

/** Tenth of a unit: what the file keeps. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The size a print is born with: `min(naturalWidth, 480)` wide, proportion kept. A size that is not positive and finite → `null`. */
export function fitImage(naturalWidth: number, naturalHeight: number, maxWidth: number = PRINT_MAX_WIDTH): { w: number; h: number } | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const w = Math.min(naturalWidth, maxWidth);
  return { w: round(w), h: round((naturalHeight * w) / naturalWidth) };
}

/** The box of a print of `size` centered on `center` (board units). */
export function imageBoxAt(center: Point, size: { readonly w: number; readonly h: number }): { x: number; y: number; w: number; h: number } {
  return { x: round(center.x - size.w / 2), y: round(center.y - size.h / 2), w: size.w, h: size.h };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The imageIds of every print of every board of a document, read loosely from
 * whatever came from disk (a print the parse would drop for another reason
 * still counts: the sweep errs on the side of keeping). Garbage → empty set.
 */
export function referencedImageIds(raw: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(raw) || !isRecord(raw.boards)) return ids;
  for (const board of Object.values(raw.boards)) {
    if (!isRecord(board) || !Array.isArray(board.drawings)) continue;
    for (const drawing of board.drawings) {
      if (isRecord(drawing) && drawing.kind === 'image' && isImageId(drawing.imageId)) ids.add(drawing.imageId);
    }
  }
  return ids;
}
