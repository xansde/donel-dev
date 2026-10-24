#!/usr/bin/env python3
"""Slice the Jobu Donel sprite sheet into aligned, transparent pose PNGs.

Input : design/referencia/donel-buddy-sprites-v2.png
        (1920x1920, 4 x 3 grid of busts on a flat grey, empty bands between the frames)
Output: src/renderer/src/pet/assets/poses/<pose>.png  + manifest.json
        design/jobu-pet/poses-contact-sheet.png

Pipeline
  1. Frames come from the empty bands between the busts (no fixed coordinates).
  2. Per frame, the background is what is connected to the frame border:
       a. flood fill (4-connected) of every pixel within a tolerance of the corner colour;
          the light art inside the figure (silver mirror, white feather, "Zzz" balloon, smoke)
          is never reached: dark outlines wall it in;
       b. enclosed pockets are dropped only when big, flat and neutral grey (the gaps between
          beak, mirror and shoulder...); small or tinted ones are art highlights and stay;
       c. the resampling that made the sheet rings up to +60 levels in the slits between hair
          spikes: neutral greys reachable from the outside are background too, and so are the
          closed ends of those slits (walled by dark pixels on both sides);
       d. leftover specks and floating islands are dropped;
       e. the 2 px soft edge is un-mixed: each edge pixel is explained as a blend of the
          background and a nearby solid colour, which gives its alpha and a decontaminated
          colour, so no grey fringe is left on dark desktops.
  3. Cut line = lowest opaque row. Anchor = midpoint of that row (between its leftmost and
     rightmost opaque pixels), measured on the bottom edge of the row.
  4. Every pose goes on ONE canvas with the anchors coinciding (union of the extents around the
     anchor + 8 px of slack) and is resampled with LANCZOS so the canvas is 320 px tall. The
     anchor lands on an exact integer pixel row, so the base is a crisp horizontal line.

Extra art (--extra <dir>): PNGs named impatient, very-impatient, calling, blink-neutral,
blink-impatient, sweeping, with a transparent or flat #00FF00 background. They are scaled so the robe
width at the cut line matches the median of the 12 sheet poses, and share the same anchor and
the same output scale. The scale of the sheet never changes because of extras, so the 12 sheet
poses stay byte-identical when the extras fit the canvas (a warning says when they do not).

Usage
  python scripts/pet/slice-sprites.py
  python scripts/pet/slice-sprites.py --extra path/to/new-art
Needs only Pillow and numpy.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]

SHEET_POSES = [
    # row 1
    "neutral", "talking", "sleeping", "skeptical",
    # row 2
    "waffle", "incense", "reading", "mirror",
    # row 3
    "laughing", "sad", "angry", "surprised",
]
GRID_COLS, GRID_ROWS = 4, 3
EXTRA_POSES = ["impatient", "very-impatient", "calling", "blink-neutral", "blink-impatient", "sweeping"]
# FR-029: until the new art exists the behaviour uses these stand-ins. The two blink poses have
# no stand-in on purpose: without the art the Jobu simply does not blink.
FALLBACKS = {
    "impatient": "skeptical",
    "very-impatient": "angry",
    "calling": "talking",
}

# ---- output geometry
OUT_HEIGHT = 320          # px, whole canvas (art + slack)
PADDING = 8               # px of slack on every side of the art, in output pixels
BOTTOM_EXTENSION = 8      # source px the cut row is repeated downward before resampling

# ---- frame detection
FRAME_MARGIN = 16         # px of background kept around each frame
GAP_MERGE = 7             # empty bands up to this size do not split frames
MIN_FRAME_SIDE = 60       # runs narrower than this are noise, not frames

# ---- background removal: what is "outside"
MIN_TOL, MAX_TOL = 12, 24     # flood tolerance clamp (max channel distance), from the corner noise
POCKET_MIN_AREA = 100         # enclosed flat-grey pockets at least this big are background...
POCKET_MAX_DEVIATION = 6.5    # ...when their mean colour sits this close to the background
NEUTRAL_SPREAD = 10           # (pixel - bg) varies less than this across channels: "neutral"
GROW_MAX, GROW_FLOOR = 48, -10    # neutral greys from this much darker to this much lighter than bg
SLIT_LEVEL = 100              # slit ends: neutral greys at least this bright (max channel)...
SLIT_SPREAD = 20              # ...with a channel spread up to this...
SLIT_REACH = 3                # ...walled by dark pixels (>= 2 within this reach) on BOTH sides
SPECK_DARK = 75               # "dark" = max channel up to this
SPECK_MAX_AREA = 80           # enclosed light specks near the silhouette: max area...
SPECK_MAX_SIDE = 10           # ...max bounding-box side...
SPECK_NEAR = 8                # ...max distance to the outside...
SPECK_MIN_LEVEL = 80          # ...neutral greys at least this bright (max channel)...
SPECK_MAX_SPREAD = 20         # ...channel spread up to this...
SPECK_DARK_SHARE = 0.75       # ...with at least this share of the ring around them dark...
SPECK_PEAK = 200              # ...and one pixel this bright (resampling overshoot, lighter than bg)
ISLAND_MIN_AREA = 60          # floating components smaller than this are specks...
ISLAND_NEAR = 2               # ...unless they touch a real component within this many px

# ---- background removal: the soft edge
WINDOW, WINDOW_FAR = 3, 7     # solid colour searched within +-3 px, then +-7 px if unexplained
RESIDUAL_OK = 14              # max channel error to accept "blend of bg and a solid colour"
OVERSHOOT_D = 22              # unexplained pixels this close to the bg colour are bg
LIGHT_FLOOR = -30             # unexplained neutral greys at most this much darker than bg are junk
UNEXPLAINED_D_REF = 48        # other unexplained pixels: alpha = distance from bg / this
OUTLINE_COLOUR = np.array([3.0, 4.0, 8.0])   # near-black outline that frames the silhouettes


# --------------------------------------------------------------------------------------
# small image helpers
# --------------------------------------------------------------------------------------

def label_components(mask: np.ndarray, connectivity: int = 8) -> tuple[np.ndarray, int]:
    """Connected components of a boolean mask (run-length union-find, no scipy).

    Returns (labels, count); labels are 1..count, 0 is "not in the mask".
    """
    h, w = mask.shape
    parent = [0]

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            if ra < rb:
                parent[rb] = ra
            else:
                parent[ra] = rb

    reach = 1 if connectivity == 8 else 0
    prev: list[tuple[int, int, int]] = []
    rows: list[list[tuple[int, int, int]]] = []
    nid = 0
    for y in range(h):
        d = np.diff(np.concatenate(([0], mask[y].astype(np.int8), [0])))
        starts = np.flatnonzero(d == 1).tolist()
        ends = (np.flatnonzero(d == -1) - 1).tolist()
        cur: list[tuple[int, int, int]] = []
        for s, e in zip(starts, ends):
            nid += 1
            parent.append(nid)
            cur.append((s, e, nid))
        if prev and cur:
            j = 0
            for s, e, i in cur:
                lo, hi = s - reach, e + reach
                while j < len(prev) and prev[j][1] < lo:
                    j += 1
                k = j
                while k < len(prev) and prev[k][0] <= hi:
                    union(i, prev[k][2])
                    k += 1
        rows.append(cur)
        prev = cur

    remap = np.zeros(nid + 1, dtype=np.int32)
    roots: dict[int, int] = {}
    for i in range(1, nid + 1):
        r = find(i)
        if r not in roots:
            roots[r] = len(roots) + 1
        remap[i] = roots[r]
    labels = np.zeros((h, w), dtype=np.int32)
    for y, cur in enumerate(rows):
        for s, e, i in cur:
            labels[y, s:e + 1] = remap[i]
    return labels, len(roots)


def dilate8(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Chebyshev dilation (8-neighbourhood), ``iterations`` times."""
    out = mask.copy()
    for _ in range(iterations):
        grown = out.copy()
        grown[1:] |= out[:-1]
        grown[:-1] |= out[1:]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        grown[1:, 1:] |= out[:-1, :-1]
        grown[1:, :-1] |= out[:-1, 1:]
        grown[:-1, 1:] |= out[1:, :-1]
        grown[:-1, :-1] |= out[1:, 1:]
        out = grown
    return out


def grow4(mask: np.ndarray) -> np.ndarray:
    """One 4-neighbour dilation step."""
    grown = mask.copy()
    grown[1:] |= mask[:-1]
    grown[:-1] |= mask[1:]
    grown[:, 1:] |= mask[:, :-1]
    grown[:, :-1] |= mask[:, 1:]
    return grown


def window_count(mask: np.ndarray, ya: int, yb: int, xa: int, xb: int) -> np.ndarray:
    """For every pixel, how many True pixels lie in rows y+ya..y+yb and cols x+xa..x+xb."""
    h, w = mask.shape
    integral = np.zeros((h + 1, w + 1), dtype=np.int32)
    integral[1:, 1:] = mask.astype(np.int32).cumsum(0).cumsum(1)
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    y0 = np.clip(ys + ya, 0, h)
    y1 = np.clip(ys + yb + 1, 0, h)
    x0 = np.clip(xs + xa, 0, w)
    x1 = np.clip(xs + xb + 1, 0, w)
    return integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]


def runs_of_true(v: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate(([0], v.astype(np.int8), [0])))
    return list(zip(np.flatnonzero(d == 1).tolist(), (np.flatnonzero(d == -1) - 1).tolist()))


def merge_runs(runs: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for s, e in runs:
        if out and s - out[-1][1] - 1 <= max_gap:
            out[-1] = (out[-1][0], e)
        else:
            out.append((s, e))
    return out


def median_background(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate([rgb[:20].reshape(-1, 3), rgb[-20:].reshape(-1, 3),
                             rgb[:, :20].reshape(-1, 3), rgb[:, -20:].reshape(-1, 3)])
    return np.median(border, axis=0)


# --------------------------------------------------------------------------------------
# frame detection
# --------------------------------------------------------------------------------------

def detect_frames(sheet: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Return frame boxes (x0, y0, x1, y1), inclusive, in reading order."""
    bg = median_background(sheet)
    fg = np.abs(sheet.astype(np.int16) - bg).max(axis=2) > MIN_TOL
    row_runs = [r for r in merge_runs(runs_of_true(fg.sum(1) >= 2), GAP_MERGE)
                if r[1] - r[0] + 1 >= MIN_FRAME_SIDE]
    if len(row_runs) != GRID_ROWS:
        raise SystemExit(f"expected {GRID_ROWS} rows of poses, found {len(row_runs)}: {row_runs}")
    frames: list[tuple[int, int, int, int]] = []
    for y0, y1 in row_runs:
        col_runs = [r for r in merge_runs(runs_of_true(fg[y0:y1 + 1].sum(0) >= 2), GAP_MERGE)
                    if r[1] - r[0] + 1 >= MIN_FRAME_SIDE]
        if len(col_runs) != GRID_COLS:
            raise SystemExit(f"expected {GRID_COLS} poses in the row y={y0}..{y1}, found "
                             f"{len(col_runs)}: {col_runs}")
        frames.extend((x0, y0, x1, y1) for x0, x1 in col_runs)
    return frames


# --------------------------------------------------------------------------------------
# background removal
# --------------------------------------------------------------------------------------

@dataclass
class Cutout:
    rgba: np.ndarray                      # (h, w, 4) uint8
    info: dict = field(default_factory=dict)


def estimate_background(rgb: np.ndarray) -> tuple[np.ndarray, int, float]:
    """Background colour from the four corners + a tolerance derived from their noise."""
    h, w = rgb.shape[:2]
    k = max(2, min(8, h // 4, w // 4))
    patches = np.concatenate([p.reshape(-1, 3) for p in
                              (rgb[:k, :k], rgb[:k, -k:], rgb[-k:, :k], rgb[-k:, -k:])]).astype(np.float64)
    bg = np.median(patches, axis=0)
    noise = float(np.percentile(np.abs(patches - bg).max(axis=1), 99))
    tol = int(np.clip(round(2 * noise + 8), MIN_TOL, MAX_TOL))
    return bg, tol, noise


def find_outside(rgb: np.ndarray, bg: np.ndarray, tol: int) -> tuple[np.ndarray, dict]:
    """Boolean mask of the background: everything that is connected to the frame border."""
    rgb_i = rgb.astype(np.int16)
    bg_i = bg.astype(np.int16)
    bg_like = np.abs(rgb_i - bg_i).max(axis=2) <= tol

    # a. 4-connected: pixel-art outlines are 8-connected staircases, an 8-connected fill would
    #    leak through their corners
    labels, n = label_components(bg_like, connectivity=4)
    border_labels = set(np.unique(np.concatenate(
        [labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist()) - {0}
    outside = np.isin(labels, list(border_labels))
    areas = np.bincount(labels.ravel(), minlength=n + 1)

    # b. enclosed pockets: only big, flat and neutral grey ones are background
    pockets: list[dict] = []
    for lab in range(1, n + 1):
        if lab in border_labels or areas[lab] < POCKET_MIN_AREA:
            continue
        sel = labels == lab
        px = rgb[sel].astype(np.float64)
        if float(np.abs(px.mean(axis=0) - bg).max()) <= POCKET_MAX_DEVIATION and float(px.std(axis=0).max()) <= 8:
            ys, xs = np.nonzero(sel)
            pockets.append({"area": int(areas[lab]), "center": [int(xs.mean()), int(ys.mean())]})
            outside |= sel

    # c. narrow slits between hair spikes ring above the background (resampling overshoot):
    #    neutral greys slightly lighter than bg, reachable from the outside through
    #    4-neighbours, are background too. Pure white art (>= +60) is untouched. The closed ends
    #    of the slits ring far brighter: neutral light pixels walled by dark pixels on both sides.
    diff = rgb_i - bg_i
    mean_diff = diff.mean(axis=2)
    ringing = ((diff.max(axis=2) - diff.min(axis=2)) <= NEUTRAL_SPREAD) \
        & (mean_diff >= GROW_FLOOR) & (mean_diff <= GROW_MAX)
    level = rgb_i.max(axis=2)
    dark = level <= SPECK_DARK
    r = SLIT_REACH
    walled_h = (window_count(dark, -1, 1, -r, -1) >= 2) & (window_count(dark, -1, 1, 1, r) >= 2)
    walled_v = (window_count(dark, -r, -1, -1, 1) >= 2) & (window_count(dark, 1, r, -1, 1) >= 2)
    ringing |= ((level - rgb_i.min(axis=2)) <= SLIT_SPREAD) & (level >= SLIT_LEVEL) & (walled_h | walled_v)
    for _ in range(64):
        new = ringing & grow4(outside) & ~outside
        if not new.any():
            break
        outside |= new

    # d. enclosed light specks near the silhouette: the background seen through a gap, brightened
    #    by the resampling, walled in by dark outlines. Compact, near the silhouette, holding a
    #    peak lighter than the background itself (soft-edge pixels are blends and never exceed
    #    it): the silver rim highlights of the mirror have silver around them and stay.
    chan_spread = level - rgb_i.min(axis=2)
    lightish = (level >= SPECK_MIN_LEVEL) & (chan_spread <= SPECK_MAX_SPREAD) & ~outside
    sp_labels, sp_n = label_components(lightish, connectivity=8)
    sp_areas = np.bincount(sp_labels.ravel(), minlength=sp_n + 1)
    near_outside = dilate8(outside, SPECK_NEAR)
    specks: list[dict] = []
    for lab in range(1, sp_n + 1):
        if sp_areas[lab] > SPECK_MAX_AREA:
            continue
        ys, xs = np.nonzero(sp_labels == lab)
        if (ys.max() - ys.min() + 1) > SPECK_MAX_SIDE or (xs.max() - xs.min() + 1) > SPECK_MAX_SIDE:
            continue
        if not near_outside[ys, xs].any() or level[ys, xs].max() < SPECK_PEAK:
            continue
        comp = np.zeros_like(outside)
        comp[ys, xs] = True
        solid_ring = dilate8(comp) & ~comp & ~outside
        if solid_ring.any() and dark[solid_ring].mean() >= SPECK_DARK_SHARE:
            outside |= comp
            specks.append({"area": int(sp_areas[lab]), "center": [int(xs.mean()), int(ys.mean())],
                           "level": int(level[ys, xs].max())})

    # e. tiny background-coloured crumbs touching the outside only diagonally
    crumbs = 0
    touching = dilate8(outside) & bg_like & ~outside
    for lab in np.unique(labels[touching]).tolist():
        if lab and areas[lab] <= 40:
            outside |= labels == lab
            crumbs += 1

    return outside, {"pockets_removed": pockets, "notch_specks": specks, "crumbs": crumbs}


def drop_islands(outside: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """Drop floating components that are specks (kept when they touch a real component)."""
    fg = ~outside
    fg_labels, fn = label_components(fg, connectivity=8)
    sizes = np.bincount(fg_labels.ravel(), minlength=fn + 1)
    big = (sizes[fg_labels] >= ISLAND_MIN_AREA) & fg
    keep = fg & dilate8(big, ISLAND_NEAR)
    islands: list[dict] = []
    for i in range(1, fn + 1):
        if sizes[i] < ISLAND_MIN_AREA:
            ys, xs = np.nonzero(fg_labels == i)
            if not keep[ys, xs].any():
                islands.append({"area": int(sizes[i]), "center": [int(xs.mean()), int(ys.mean())]})
    return ~keep, islands


def unmix_edge(rgb: np.ndarray, outside: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """RGBA from the foreground mask, un-mixing the 2 px soft edge (alpha + clean colour)."""
    fg = ~outside
    layer1 = fg & dilate8(outside)                       # chebyshev distance 1 from the outside
    layer2 = fg & dilate8(outside, 2) & ~layer1          # ...and 2
    alpha = fg.astype(np.float64)
    out_rgb = rgb.astype(np.float64).copy()
    solid = fg & ~layer1 & ~layer2

    def explain(ys: np.ndarray, xs: np.ndarray, candidates: np.ndarray, radius: int):
        """Best "bg + nearby solid colour" explanation for the pixels (ys, xs).

        Returns (alpha, solid colour, residual); the residual is inf when no solid colour within
        ``radius`` can explain the pixel.
        """
        size = 2 * radius + 1
        rgb_p = np.pad(out_rgb, ((radius, radius), (radius, radius), (0, 0)))
        cand_p = np.pad(candidates, ((radius, radius), (radius, radius)))
        swv_rgb = np.lib.stride_tricks.sliding_window_view(rgb_p, (size, size), axis=(0, 1))
        swv_c = np.lib.stride_tricks.sliding_window_view(cand_p, (size, size))
        win = swv_rgb[ys, xs].reshape(len(ys), 3, size * size).transpose(0, 2, 1)   # (n, k, 3)
        ok = swv_c[ys, xs].reshape(len(ys), size * size)                            # (n, k)
        p = rgb[ys, xs].astype(np.float64)                                          # (n, 3)
        pb = p - bg
        qb = win - bg                                                               # (n, k, 3)
        den = (qb ** 2).sum(axis=2)
        ok &= den > 400
        a_raw = np.where(ok, (qb * pb[:, None, :]).sum(axis=2) / np.maximum(den, 1), 0.0)
        a = np.clip(a_raw, 0.0, 1.0)
        mix = a[..., None] * win + (1.0 - a[..., None]) * bg
        res = np.abs(p[:, None, :] - mix).max(axis=2)
        res = np.where(ok & (a_raw > 0.04), res, np.inf)
        best = np.argmin(res - 1e-3 * np.sqrt(den), axis=1)    # ties go to the most contrasting colour
        idx = np.arange(len(ys))
        return a[idx, best], win[idx, best], res[idx, best]

    def unmix(target: np.ndarray, candidates: np.ndarray) -> None:
        ys, xs = np.nonzero(target)
        if len(ys) == 0:
            return
        best_a = np.zeros(len(ys))
        best_q = np.zeros((len(ys), 3))
        best_res = np.full(len(ys), np.inf)
        for radius in (WINDOW, WINDOW_FAR):       # look further only for what stays unexplained
            todo = np.flatnonzero(~(best_res <= RESIDUAL_OK))
            if len(todo) == 0:
                break
            best_a[todo], best_q[todo], best_res[todo] = explain(ys[todo], xs[todo], candidates, radius)
        p = rgb[ys, xs].astype(np.float64)
        pb = p - bg
        d_own = np.abs(pb).max(axis=1)
        neutral = (pb.max(axis=1) - pb.min(axis=1)) <= NEUTRAL_SPREAD
        explained = best_res <= RESIDUAL_OK
        # Not a blend of bg and a nearby solid colour:
        #  - ringing of the resampling is bg: anything very close to the bg colour, and any
        #    neutral grey at least as light as the bg;
        #  - a neutral grey DARKER than the bg with no solid colour in reach is a blend of bg and
        #    the near-black outline that frames every silhouette of this art;
        #  - anything else (lavender fringe of the smoke, ...) is real art, partly transparent
        #    in proportion to how far it is from the background.
        overshoot = ~explained & ((d_own <= OVERSHOOT_D) | (neutral & (pb.mean(axis=1) >= LIGHT_FLOOR)))
        outline_blend = ~explained & ~overshoot & neutral
        unexplained = ~explained & ~overshoot & ~outline_blend
        outline_dir = OUTLINE_COLOUR - bg
        a_outline = np.clip((pb * outline_dir).sum(axis=1) / (outline_dir ** 2).sum(), 0.0, 1.0)
        new_a = np.where(explained, best_a,
                         np.where(outline_blend, a_outline,
                                  np.where(unexplained, np.clip(d_own / UNEXPLAINED_D_REF, 0, 1), 0.0)))
        # near-opaque pixels keep their own colour; real blends take the solid colour
        new_rgb = np.where((explained & (best_a < 0.97))[:, None], best_q,
                           np.where((outline_blend & (a_outline < 0.97))[:, None], OUTLINE_COLOUR, p))
        alpha[ys, xs] = np.where(new_a < 0.04, 0.0, new_a)
        out_rgb[ys, xs] = new_rgb

    unmix(layer2, solid)
    unmix(layer1, solid | (layer2 & (alpha >= 0.98)))

    a8 = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
    rgba = np.dstack([np.clip(np.round(out_rgb), 0, 255).astype(np.uint8), a8])
    rgba[a8 == 0, :3] = 0
    return rgba


def remove_background(rgb: np.ndarray, estimate: tuple[np.ndarray, int, float] | None = None) -> Cutout:
    """Cut the figure out of a frame.

    ``estimate`` = (bg colour, tolerance, noise) when it was measured before the frame was
    cleaned of its neighbours; otherwise it is measured on the corners of ``rgb``.
    """
    bg, tol, noise = estimate if estimate is not None else estimate_background(rgb)
    outside, info = find_outside(rgb, bg, tol)
    outside, islands = drop_islands(outside)
    info.update({"bg": [int(round(c)) for c in bg], "tolerance": tol, "noise": round(noise, 2),
                 "islands": islands})
    return Cutout(unmix_edge(rgb, outside, bg), info)


def load_extra(path: Path) -> Cutout:
    """An extra PNG: transparent background as is, otherwise flood-fill the corner colour
    (flat #00FF00 is the contract; any flat colour works the same way)."""
    img = Image.open(path)
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        rgba = np.array(img.convert("RGBA"))
        if int(rgba[..., 3].min()) < 255:
            rgba[rgba[..., 3] == 0, :3] = 0
            return Cutout(rgba, {"background": "transparent"})
    rgb = np.array(img.convert("RGB"))
    margin = 16
    bg, _, _ = estimate_background(rgb)
    canvas = np.empty((rgb.shape[0] + 2 * margin, rgb.shape[1] + 2 * margin, 3), dtype=np.uint8)
    canvas[:] = np.round(bg).astype(np.uint8)     # flat padding: the figure may touch the image edge
    canvas[margin:-margin, margin:-margin] = rgb
    cut = remove_background(canvas)
    cut.rgba = cut.rgba[margin:-margin, margin:-margin]
    cut.info["background"] = "flat colour"
    return cut


# --------------------------------------------------------------------------------------
# anchors and normalization
# --------------------------------------------------------------------------------------

@dataclass
class Pose:
    name: str
    rgba: np.ndarray                      # source-scale, rows below the cut line cleared
    anchor: tuple[float, float]           # (x, y): midpoint of the cut row, y = its bottom edge
    bbox: tuple[int, int, int, int]       # left, top, right(excl), bottom(excl) where alpha > 0
    cut_row: int
    cut_span: tuple[int, int]             # leftmost / rightmost opaque pixel on the cut row
    cut_fill: float                       # share of the span that is opaque on the cut row
    robe_width: int
    source: str
    k: float = 1.0                        # scale relative to the sheet's source scale
    info: dict = field(default_factory=dict)


def build_pose(name: str, cut: Cutout, source: str) -> Pose:
    rgba = cut.rgba.copy()
    opaque = rgba[..., 3] >= 128
    counts = opaque.sum(axis=1)
    if counts.max() == 0:
        raise SystemExit(f"{name}: nothing opaque after background removal")
    rows = np.flatnonzero(counts >= max(8, 0.2 * counts.max()))
    cut_row = int(rows.max())
    xs = np.flatnonzero(opaque[cut_row])
    xl, xr = int(xs.min()), int(xs.max())
    fill = float(opaque[cut_row, xl:xr + 1].mean())
    rgba[cut_row + 1:] = 0                       # the straight cut: nothing below it
    ys_a, xs_a = np.nonzero(rgba[..., 3] > 0)
    bbox = (int(xs_a.min()), int(ys_a.min()), int(xs_a.max()) + 1, int(ys_a.max()) + 1)
    anchor = ((xl + xr + 1) / 2.0, float(cut_row + 1))
    return Pose(name=name, rgba=rgba, anchor=anchor, bbox=bbox, cut_row=cut_row, cut_span=(xl, xr),
                cut_fill=fill, robe_width=xr - xl + 1, source=source, info=cut.info)


def render_pose(pose: Pose, scale: float, canvas: tuple[int, int], anchor_out: tuple[int, int]) -> Image.Image:
    """Resample one pose onto the common canvas (anchor on anchor_out, exact LANCZOS)."""
    width, height = canvas
    ax_out, ay_out = anchor_out
    eff = scale * pose.k
    # source window (in this pose's pixels) that maps exactly onto the output canvas
    x0 = pose.anchor[0] - ax_out / eff
    x1 = x0 + width / eff
    y1 = pose.anchor[1] + (height - ay_out) / eff
    y0 = y1 - height / eff

    ext = BOTTOM_EXTENSION
    h, w = pose.rgba.shape[:2]
    margin = int(math.ceil(max(-x0, x1 - w, -y0, 0))) + 4
    padded = np.zeros((h + ext + 2 * margin, w + 2 * margin, 4), dtype=np.uint8)
    padded[margin:margin + h, margin:margin + w] = pose.rgba
    cut = pose.cut_row
    padded[margin + cut + 1:margin + cut + 1 + ext, margin:margin + w] = pose.rgba[cut]  # cut row keeps going down
    img = Image.fromarray(padded)
    out = img.resize((width, height), Image.LANCZOS, box=(x0 + margin, y0 + margin, x1 + margin, y1 + margin))
    arr = np.array(out)
    arr[ay_out:] = 0                                # crisp base: nothing below the anchor row
    arr[arr[..., 3] == 0, :3] = 0
    return Image.fromarray(arr)


def tight_bbox(img: Image.Image) -> dict:
    """Bounding box of the visible art (alpha >= 16: faint resampling ringing does not count)."""
    a = np.array(img)[..., 3]
    ys, xs = np.nonzero(a >= 16)
    return {"x": int(xs.min()), "y": int(ys.min()),
            "width": int(xs.max() - xs.min() + 1), "height": int(ys.max() - ys.min() + 1)}


# --------------------------------------------------------------------------------------
# contact sheet
# --------------------------------------------------------------------------------------

def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def checker(width: int, height: int, cell: int = 16) -> Image.Image:
    yy, xx = np.mgrid[0:height, 0:width]
    on = ((yy // cell) + (xx // cell)) % 2 == 0
    arr = np.where(on[..., None], np.array([204, 204, 204]), np.array([255, 255, 255])).astype(np.uint8)
    return Image.fromarray(arr)


def contact_sheet(poses: list[tuple[str, Image.Image]], anchor_y: int, path: Path) -> None:
    """The 12 poses side by side, each over a checkerboard, #0e1116 and #f2f2f2 (one row each).

    A 1 px cyan guide on the anchor row shows the bases line up.
    """
    cw, ch = poses[0][1].size
    gap, label_h = 12, 34
    backgrounds = [None, (14, 17, 22), (242, 242, 242)]
    width = gap + len(poses) * (cw + gap)
    height = gap + len(backgrounds) * (ch + gap) + label_h
    sheet = Image.new("RGB", (width, height), (40, 44, 52))
    font = load_font(22)
    draw = ImageDraw.Draw(sheet)
    for row, colour in enumerate(backgrounds):
        y = gap + row * (ch + gap)
        for col, (name, img) in enumerate(poses):
            x = gap + col * (cw + gap)
            cell = (checker(cw, ch) if colour is None else Image.new("RGB", (cw, ch), colour)).convert("RGBA")
            cell.alpha_composite(img)
            sheet.paste(cell.convert("RGB"), (x, y))
            draw.line([(x, y + anchor_y), (x + cw - 1, y + anchor_y)], fill=(0, 200, 255), width=1)
            if row == len(backgrounds) - 1:
                draw.text((x + 4, y + ch + 6), name, fill=(235, 235, 235), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, optimize=True)


# --------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", type=Path, default=ROOT / "design/referencia/donel-buddy-sprites-v2.png")
    ap.add_argument("--out-dir", type=Path, default=ROOT / "src/renderer/src/pet/assets/poses")
    ap.add_argument("--contact-sheet", type=Path, default=ROOT / "design/jobu-pet/poses-contact-sheet.png")
    ap.add_argument("--no-contact-sheet", action="store_true")
    ap.add_argument("--extra", type=Path, help="folder with impatient.png, calling.png, ...")
    ap.add_argument("--debug-dir", type=Path, help="also dump the source-scale cutouts (RGBA) here")
    args = ap.parse_args()
    for attr in ("sheet", "out_dir", "contact_sheet", "extra", "debug_dir"):
        value = getattr(args, attr)
        if value is not None:
            setattr(args, attr, value.resolve())

    sheet = np.array(Image.open(args.sheet).convert("RGB"))
    pad = 24
    bg0 = median_background(sheet)
    padded = np.empty((sheet.shape[0] + 2 * pad, sheet.shape[1] + 2 * pad, 3), dtype=np.uint8)
    padded[:] = np.round(bg0).astype(np.uint8)        # the art may sit 4 px from the sheet edge
    padded[pad:-pad, pad:-pad] = sheet

    frames = detect_frames(sheet)
    print(f"sheet {sheet.shape[1]}x{sheet.shape[0]}: {len(frames)} frames")
    poses: list[Pose] = []
    for name, (x0, y0, x1, y1) in zip(SHEET_POSES, frames):
        m = FRAME_MARGIN
        crop = padded[y0 - m + pad:y1 + m + pad + 1, x0 - m + pad:x1 + m + pad + 1].copy()
        estimate = estimate_background(crop)          # measured on the real corners of the sheet
        # the margin may reach into a neighbouring frame (the gaps are as small as 14 px):
        # everything outside this frame's own box is background
        own = np.zeros(crop.shape[:2], dtype=bool)
        own[m:crop.shape[0] - m, m:crop.shape[1] - m] = True
        crop[~own] = np.round(estimate[0]).astype(np.uint8)
        pose = build_pose(name, remove_background(crop, estimate), "sheet")
        poses.append(pose)
        i = pose.info
        print(f"  {name:<10} frame x{x0}-{x1} y{y0}-{y1} tol={i['tolerance']} "
              f"pockets={[p['area'] for p in i['pockets_removed']]} notches={len(i['notch_specks'])} "
              f"crumbs={i['crumbs']} islands={len(i['islands'])} | cut row {pose.cut_row} "
              f"span {pose.cut_span} fill {pose.cut_fill:.2f} robe {pose.robe_width}px bbox {pose.bbox}")
        if args.debug_dir:
            args.debug_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(pose.rgba).save(args.debug_dir / f"{name}.png")

    median_robe = float(statistics.median(p.robe_width for p in poses))
    print(f"median robe width at the cut line: {median_robe:.1f} px")

    if args.extra:
        for path in sorted(args.extra.glob("*.png")):
            if path.stem not in EXTRA_POSES:
                print(f"  extra {path.name}: not one of {EXTRA_POSES}, skipped")
                continue
            pose = build_pose(path.stem, load_extra(path), "extra")
            pose.k = median_robe / pose.robe_width
            poses.append(pose)
            print(f"  extra {pose.name:<14} {path.name}: robe {pose.robe_width}px -> k={pose.k:.4f}, bbox {pose.bbox}")

    # ---- common geometry. The output scale comes from the SHEET poses only.
    sheet_poses = [p for p in poses if p.source == "sheet"]
    up_sheet = max((p.anchor[1] - p.bbox[1]) for p in sheet_poses)
    left_sheet = max((p.anchor[0] - p.bbox[0]) for p in sheet_poses)
    right_sheet = max((p.bbox[2] - p.anchor[0]) for p in sheet_poses)
    scale = (OUT_HEIGHT - 2 * PADDING) / up_sheet
    left = max((p.anchor[0] - p.bbox[0]) * p.k for p in poses)
    right = max((p.bbox[2] - p.anchor[0]) * p.k for p in poses)
    up = max((p.anchor[1] - p.bbox[1]) * p.k for p in poses)
    ax_out = int(math.ceil(PADDING + left * scale))
    width = int(math.ceil(ax_out + right * scale + PADDING))
    height = OUT_HEIGHT
    if up > up_sheet + 1e-6:
        height = int(math.ceil(up * scale + 2 * PADDING))
        print(f"WARNING: an extra is taller than every sheet pose; the canvas grows to {height}px tall, "
              "so every pose is re-exported with the new size")
    if left > left_sheet + 1e-6 or right > right_sheet + 1e-6:
        print("WARNING: an extra is wider than every sheet pose; the canvas grows horizontally, "
              "so every pose is re-exported with the new size")
    ay_out = height - PADDING

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_poses: dict[str, dict] = {}
    rendered: list[tuple[str, Image.Image]] = []
    for pose in poses:
        img = render_pose(pose, scale, (width, height), (ax_out, ay_out))
        img.save(args.out_dir / f"{pose.name}.png", optimize=True)
        manifest_poses[pose.name] = {"file": f"{pose.name}.png", "source": pose.source, "bbox": tight_bbox(img)}
        if pose.source == "sheet":
            rendered.append((pose.name, img))

    manifest = {
        "generator": "scripts/pet/slice-sprites.py",
        "source": args.sheet.relative_to(ROOT).as_posix() if args.sheet.is_relative_to(ROOT) else str(args.sheet),
        "canvas": {"width": width, "height": height},
        "anchor": {"x": ax_out, "y": ay_out},
        "scale": round(scale, 6),
        "padding": PADDING,
        "medianRobeWidthPx": round(median_robe, 1),
        "fallbacks": FALLBACKS,
        "poses": {name: manifest_poses[name] for name in SHEET_POSES + EXTRA_POSES if name in manifest_poses},
    }
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"canvas {width}x{height}, anchor ({ax_out}, {ay_out}), scale {scale:.5f} "
          f"-> {len(poses)} poses in {args.out_dir}")

    if not args.no_contact_sheet:
        contact_sheet(rendered, ay_out, args.contact_sheet)
        print(f"contact sheet: {args.contact_sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
