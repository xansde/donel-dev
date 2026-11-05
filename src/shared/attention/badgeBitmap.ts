// notificacoes-completas (30/10) — the picture of the badge over the Donel button on the Windows taskbar
// (`BrowserWindow.setOverlayIcon`): a red disc with the number of sessions waiting for the owner, drawn here at
// runtime so the app ships no binary asset for it. Pure: the label in, the raw pixels out, in the layout
// `nativeImage.createFromBitmap` takes on Windows (BGRA, premultiplied alpha, rows top to bottom).

/** 5x7 glyphs of what a badge can say: `1`..`9`, `9+` (petView's `badgeOf`). `#` is ink. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_GAP = 1;

/** The disc: a clear red that reads on the light and the dark taskbar alike. */
const DISC = { r: 0xe5, g: 0x48, b: 0x4d } as const;
/** Supersampling of the disc's edge, per axis: 4 x 4 samples per pixel. */
const SAMPLES = 4;

/** The largest whole scale that keeps the text's box inside the disc, with a pixel of margin; at least 1. */
function textScale(size: number, columns: number): number {
  const radius = size / 2 - 1;
  let scale = 1;
  for (let next = 2; ; next += 1) {
    const halfW = (columns * next) / 2;
    const halfH = (GLYPH_H * next) / 2;
    if (Math.hypot(halfW, halfH) > radius) return scale;
    scale = next;
  }
}

/** Is the pixel (x, y) of the badge inked by the label? */
function inkAt(label: readonly string[], x: number, y: number, size: number): boolean {
  const columns = label.length * GLYPH_W + (label.length - 1) * GLYPH_GAP;
  const scale = textScale(size, columns);
  const left = Math.floor((size - columns * scale) / 2);
  const top = Math.floor((size - GLYPH_H * scale) / 2);
  const col = Math.floor((x - left) / scale);
  const row = Math.floor((y - top) / scale);
  if (x < left || y < top || col >= columns || row >= GLYPH_H) return false;
  const glyphIndex = Math.floor(col / (GLYPH_W + GLYPH_GAP));
  const inGlyph = col % (GLYPH_W + GLYPH_GAP);
  if (inGlyph >= GLYPH_W) return false; // the gap between two glyphs
  const glyph = GLYPHS[label[glyphIndex]];
  return glyph !== undefined && glyph[row][inGlyph] === '#';
}

/** How much of the pixel (x, y) the disc covers, 0..1. */
function discCoverage(x: number, y: number, size: number): number {
  const center = size / 2;
  const radius = size / 2;
  let inside = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const px = x + (sx + 0.5) / SAMPLES - center;
      const py = y + (sy + 0.5) / SAMPLES - center;
      if (px * px + py * py <= radius * radius) inside += 1;
    }
  }
  return inside / (SAMPLES * SAMPLES);
}

/**
 * The badge as `size` x `size` raw pixels: BGRA, premultiplied, 4 bytes per pixel. `label` is what the badge says
 * (`'1'`..`'9'`, `'9+'`); a character with no glyph is left blank rather than failing.
 */
export function renderBadgeBitmap(label: string, size: number): Uint8Array {
  const chars = [...label];
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coverage = discCoverage(x, y, size);
      if (coverage === 0) continue;
      const white = inkAt(chars, x, y, size);
      const alpha = Math.round(coverage * 255);
      const [r, g, b] = white ? [255, 255, 255] : [DISC.r, DISC.g, DISC.b];
      const at = (y * size + x) * 4;
      pixels[at] = Math.round((b * alpha) / 255);
      pixels[at + 1] = Math.round((g * alpha) / 255);
      pixels[at + 2] = Math.round((r * alpha) / 255);
      pixels[at + 3] = alpha;
    }
  }
  return pixels;
}
