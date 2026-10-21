#!/usr/bin/env python3
"""Build design/jobu-pet/resultado.html: the result page of feature 015 (Jobu Donel).

The page is ONE self-contained file (no CDN, no external asset). Everything it shows comes from
sources that are re-read on every run, so the page never drifts from the spec folder:

  specs/015-jobu-pet/quickstart.md      the preparation and the batteries B1..B6 (steps + expected)
  specs/015-jobu-pet/duvidas.md         the accumulated doubts Q1..Qn (new rows show up by themselves)
  specs/015-jobu-pet/spec.md            user stories US1..US6 and FR ids (used to check the cards)
  design/jobu-pet/resultado.data.json   the hand-written parts: title, cards, gallery, step -> print
                                        map, thumbnail crops, art request, next steps
  design/jobu-pet/prints/*.png          embedded as data: URIs

Markdown never reaches the page as HTML. Table cells and list items go through md(), which escapes
every character and only ever emits <code> and <strong>. The payload is injected as one JSON blob
into <script type="application/json" id="data"> of design/jobu-pet/resultado.template.html.

The run is idempotent: no timestamp, no randomness, so running it twice gives the same file.

resultado.data.json (every text field is inline markdown: `code` and **bold** only)
  title, lede, howTo, notice   header texts; hero = image path from the repo root (optional)
  cards        [{us, title, text, refs?}]            one per user story; `us` and `refs` are checked
                                                      against spec.md (US1..., FR-033...)
  gallery      [{file, caption}]                      in display order; `file` is a name inside prints/
  prototype    {href, title, text, label}             link to the prototype (relative, not embedded)
  stepPrints   {"1.3": "file.png" | {file, caption}}  print that shows the expected result of a step
  doubtPrints  {"Q8": [{file, caption}, ...]}         prints shown inside a doubt card
  crops        {"file.png": [x, y, w, h]}             thumbnails show this region (source pixels);
                                                      the lightbox always shows the whole print
  art          {title, intro, poses[], rulesTitle, rules[], reference}
  next         ["...", ...]                           next steps
A print that exists in prints/ but is missing from `gallery` is appended with its file name as caption
and a warning, so a new print is never lost silently.

Usage
  python scripts/pet/build-result.py
  python scripts/pet/build-result.py --strict    # any warning becomes an error (nothing is written)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import string
import struct
import sys
import unicodedata
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
DATA_SLOT = '"__RESULTADO_DATA__"'
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
ASCII_PUNCT = set(string.punctuation)

WARNINGS: list[str] = []


def warn(message: str) -> None:
    WARNINGS.append(message)
    print(f"warning: {message}", file=sys.stderr)


def fail(message: str) -> "SystemExit":
    print(f"error: {message}", file=sys.stderr)
    return SystemExit(1)


# --------------------------------------------------------------------------------------
# inline markdown -> safe HTML
# --------------------------------------------------------------------------------------

PLACEHOLDER = re.compile(r"\x00([CE])(\d+)\x00")
BOLD = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")


def find_closing_run(text: str, start: int, run: int) -> int:
    """Index of the next backtick run of exactly `run` backticks at or after `start`, or -1."""
    k, n = start, len(text)
    while k < n:
        if text[k] == "`":
            m = k
            while m < n and text[m] == "`":
                m += 1
            if m - k == run:
                return k
            k = m
        else:
            k += 1
    return -1


def mask_inline(src: str) -> tuple[str, list[str], list[str]]:
    """Swap code spans and backslash escapes for placeholders so nothing else can touch them.

    Returns (masked text, code span contents, escaped characters).
    """
    out: list[str] = []
    codes: list[str] = []
    escapes: list[str] = []
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == "\\" and i + 1 < n and src[i + 1] in ASCII_PUNCT:
            escapes.append(src[i + 1])
            out.append(f"\x00E{len(escapes) - 1}\x00")
            i += 2
        elif ch == "`":
            j = i
            while j < n and src[j] == "`":
                j += 1
            run = j - i
            close = find_closing_run(src, j, run)
            if close < 0:  # an unbalanced run is just backticks
                out.append(src[i:j])
                i = j
                continue
            content = src[j:close]
            if len(content) >= 2 and content[0] == " " and content[-1] == " " and content.strip():
                content = content[1:-1]  # CommonMark: one padding space on each side is dropped
            codes.append(content)
            out.append(f"\x00C{len(codes) - 1}\x00")
            i = close + run
        else:
            out.append(ch)
            i += 1
    return re.sub(r"[ \t]+", " ", "".join(out)), codes, escapes


def md(src: str) -> str:
    """Inline markdown to HTML. Escapes everything; emits only <code> and <strong>."""
    masked, codes, escapes = mask_inline(src.replace("\x00", ""))
    escaped = BOLD.sub(r"<strong>\1</strong>", html.escape(masked, quote=True))

    def put(match: re.Match[str]) -> str:
        index = int(match.group(2))
        if match.group(1) == "C":
            return "<code>" + html.escape(codes[index], quote=True) + "</code>"
        return html.escape(escapes[index], quote=True)

    return PLACEHOLDER.sub(put, escaped).strip()


def plain(src: str) -> str:
    """The same text with the markdown markers removed (for aria labels and the exported .json)."""
    masked, codes, escapes = mask_inline(src.replace("\x00", ""))
    unbolded = BOLD.sub(r"\1", masked)
    return PLACEHOLDER.sub(
        lambda m: (codes if m.group(1) == "C" else escapes)[int(m.group(2))], unbolded
    ).strip()


def norm(text: str) -> str:
    """Lowercase, accent-free, single-spaced: for matching headings and column names."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_text.lower()).strip()


# --------------------------------------------------------------------------------------
# markdown blocks: sections, list items, pipe tables
# --------------------------------------------------------------------------------------

SEPARATOR_CELL = re.compile(r"^\s*:?-+:?\s*$")
LIST_ITEM = re.compile(r"^(\s*)(?:\d+[.)]|[-*+])\s+(.*)$")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise fail(f"cannot read {path}: {error}") from error


def split_sections(text: str) -> list[tuple[str, list[str]]]:
    """Level-2 sections as (heading, body lines). Fenced code is never read as headings."""
    sections: list[tuple[str, list[str]]] = []
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        if not in_fence and line.startswith("## "):
            sections.append((line[3:].strip(), []))
        elif sections:
            sections[-1][1].append(line)
    return sections


def split_row(line: str) -> list[str]:
    """Cells of one table row.

    A pipe separates cells unless it is escaped (\\|) or sits inside a code span that has its
    closing backticks on the same row. Escaped pipes become plain pipes. Other backslash
    escapes are left for md().
    """
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    cells: list[str] = []
    buf: list[str] = []
    ended_on_pipe = False
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        ended_on_pipe = False
        if ch == "\\" and i + 1 < n:
            buf.append("|" if s[i + 1] == "|" else ch + s[i + 1])
            i += 2
        elif ch == "`":
            j = i
            while j < n and s[j] == "`":
                j += 1
            close = find_closing_run(s, j, j - i)
            if close < 0:
                buf.append(s[i:j])
                i = j
            else:
                end = close + (j - i)
                buf.append(s[i:end].replace("\\|", "|"))
                i = end
        elif ch == "|":
            cells.append("".join(buf).strip())
            buf = []
            ended_on_pipe = True
            i += 1
        else:
            buf.append(ch)
            i += 1
    if buf or not ended_on_pipe:
        cells.append("".join(buf).strip())
    return cells


def is_separator_row(line: str) -> bool:
    if not line.lstrip().startswith("|"):
        return False
    cells = split_row(line)
    return bool(cells) and all(SEPARATOR_CELL.match(cell) for cell in cells)


def parse_tables(lines: list[str]) -> list[dict[str, list]]:
    """Every pipe table in `lines` as {"header": [...], "rows": [[...], ...]}.

    Rows are padded to the header width; cells beyond it are dropped (GFM behaviour).
    """
    tables: list[dict[str, list]] = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and is_separator_row(lines[i + 1]):
            header = split_row(lines[i])
            rows: list[list[str]] = []
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                cells = split_row(lines[j])[: len(header)]
                cells += [""] * (len(header) - len(cells))
                if any(cells):
                    rows.append(cells)
                j += 1
            tables.append({"header": header, "rows": rows})
            i = j
        else:
            i += 1
    return tables


def find_column(header: list[str], prefixes: tuple[str, ...], default: int | None) -> int | None:
    for index, cell in enumerate(header):
        name = norm(plain(cell))
        if any(name.startswith(prefix) for prefix in prefixes):
            return index
    return default


def parse_list_items(body: list[str]) -> list[str]:
    """Items of the first list in `body`; indented continuation lines are joined to their item."""
    items: list[str] = []
    for line in body:
        match = LIST_ITEM.match(line)
        if match and len(match.group(1)) < 4:
            items.append(match.group(2).strip())
        elif items and line.strip() and line[:1] in (" ", "\t"):
            items[-1] += " " + line.strip()
    return items


# --------------------------------------------------------------------------------------
# the three spec sources
# --------------------------------------------------------------------------------------

GROUP_HEADING = re.compile(
    r"^(?P<id>B\d+)\s*[—–-]+\s*(?P<title>.*?)(?:\s*\((?P<refs>[^()]*)\))?\s*$"
)
STORY_HEADING = re.compile(
    r"^###\s+User Story\s+(\d+)\s*[—–-]+\s*(.*?)\s*\(Priority:\s*(P\d)\)\s*$"
)
REQUIREMENT = re.compile(r"^-\s+\*\*(FR-\d+)\*\*")


def parse_quickstart(path: Path) -> dict[str, Any]:
    prep: list[str] = []
    groups: list[dict[str, Any]] = []
    seen: set[str] = set()
    for heading, body in split_sections(read_text(path)):
        if norm(heading).startswith("prepara"):
            prep = [md(item) for item in parse_list_items(body)]
            continue
        match = GROUP_HEADING.match(heading)
        if not match:
            continue
        tables = parse_tables(body)
        table = next((t for t in tables if find_column(t["header"], ("passo",), None) is not None), None)
        if table is None:
            warn(f"quickstart: group {match.group('id')} has no `| # | Passo | Esperado |` table")
            continue
        id_col = find_column(table["header"], ("#", "id"), 0)
        step_col = find_column(table["header"], ("passo",), 1)
        expected_col = find_column(table["header"], ("esperado",), 2)
        steps: list[dict[str, Any]] = []
        for number, cells in enumerate(table["rows"], start=1):
            step_id = plain(cells[id_col]) or f"{match.group('id')}.{number}"
            if step_id in seen:
                warn(f"quickstart: duplicated step id {step_id}; renamed")
                suffix = 2
                while f"{step_id}#{suffix}" in seen:
                    suffix += 1
                step_id = f"{step_id}#{suffix}"
            seen.add(step_id)
            steps.append(
                {
                    "id": step_id,
                    "html": md(cells[step_col]),
                    "text": plain(cells[step_col]),
                    "expected": md(cells[expected_col]),
                }
            )
        groups.append(
            {
                "id": match.group("id"),
                "title": plain(match.group("title")),
                "refs": plain(match.group("refs") or ""),
                "steps": steps,
            }
        )
    if not groups:
        warn("quickstart: no `## B<n> ...` group found")
    if not prep:
        warn("quickstart: no `## Preparação` list found")
    return {"prep": prep, "groups": groups}


def parse_doubts(path: Path) -> list[dict[str, Any]]:
    tables = parse_tables(read_text(path).splitlines())
    table = next((t for t in tables if find_column(t["header"], ("duvida",), None) is not None), None)
    if table is None:
        warn("duvidas: no table with a `Dúvida` column found")
        return []
    header = table["header"]
    id_col = find_column(header, ("#", "id"), 0)
    question_col = find_column(header, ("duvida",), 1)
    decision_col = find_column(header, ("decisao",), 2)
    alternative_col = find_column(header, ("se a resposta", "alternativa"), 3)
    doubts: list[dict[str, Any]] = []
    for cells in table["rows"]:
        doubt_id = plain(cells[id_col])
        if not re.fullmatch(r"Q\d+", doubt_id):
            warn(f"duvidas: row skipped, its first cell is {doubt_id!r} (expected Q<n>)")
            continue
        alternative = cells[alternative_col] if alternative_col is not None and alternative_col < len(cells) else ""
        doubts.append(
            {
                "id": doubt_id,
                "q": md(cells[question_col]),
                "decision": md(cells[decision_col]),
                "alt": md(alternative) if plain(alternative).strip("-—– ") else None,
            }
        )
    return doubts


def parse_spec(path: Path) -> dict[str, Any]:
    stories: list[dict[str, str]] = []
    requirements: set[str] = set()
    for line in read_text(path).splitlines():
        story = STORY_HEADING.match(line.strip())
        if story:
            stories.append({"id": f"US{story.group(1)}", "title": plain(story.group(2)), "priority": story.group(3)})
        requirement = REQUIREMENT.match(line)
        if requirement:
            requirements.add(requirement.group(1))
    if not stories:
        warn("spec: no `### User Story <n> — ...` heading found")
    return {"stories": stories, "requirements": requirements}


# --------------------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------------------

PNG_SIGNATURE = bytes([137, 80, 78, 71, 13, 10, 26, 10])


def png_size(data: bytes) -> tuple[int, int] | None:
    """(width, height) from the IHDR chunk of a PNG, or None for anything else."""
    if data[:8] == PNG_SIGNATURE and data[12:16] == b"IHDR":
        width, height = struct.unpack(">II", data[16:24])
        return width, height
    return None


def make_embedder(
    prints_dir: Path, images: dict[str, str], sizes: dict[str, tuple[int, int]]
) -> Callable[[str], str | None]:
    """embed(ref) puts the file in `images` as a data: URI and returns the key, or None.

    A bare name is looked up in the prints folder; a name with a slash is a path from the repo
    root. Nothing outside those two places is ever read. PNG sizes land in `sizes`.
    """
    prints_root = prints_dir.resolve()

    def embed(ref: str) -> str | None:
        key = ref.replace("\\", "/")
        if key in images:
            return key
        base = ROOT if "/" in key else prints_root
        path = (base / key).resolve()
        try:
            path.relative_to(base.resolve())
        except ValueError:
            warn(f"image {ref!r} points outside the allowed folder; skipped")
            return None
        if not path.is_file():
            warn(f"image not found: {ref}")
            return None
        mime = IMAGE_MIME.get(path.suffix.lower())
        if mime is None:
            warn(f"image {ref!r} has an unsupported type; skipped")
            return None
        raw = path.read_bytes()
        images[key] = f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
        size = png_size(raw)
        if size is not None:
            sizes[key] = size
        return key

    return embed


def kind_of(name: str) -> str:
    """`app-*.png` are real prints of the app; everything else comes from the prototype."""
    return "app" if Path(name).name.startswith("app-") else "prototype"


# --------------------------------------------------------------------------------------
# the payload
# --------------------------------------------------------------------------------------

def text_field(data: dict[str, Any], key: str, default: str = "") -> str:
    value = data.get(key, default)
    if not isinstance(value, str):
        raise fail(f"resultado.data.json: {key!r} must be a string")
    return value


def list_field(data: dict[str, Any], key: str) -> list[Any]:
    value = data.get(key, [])
    if not isinstance(value, list):
        raise fail(f"resultado.data.json: {key!r} must be a list")
    return value


def dict_field(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key, {})
    if not isinstance(value, dict):
        raise fail(f"resultado.data.json: {key!r} must be an object")
    return value


def safe_href(href: str, where: str) -> str:
    """Links are relative paths or http(s) URLs; any other scheme (javascript:, data:...) is dropped."""
    match = re.match(r"^([a-z][a-z0-9+.-]*):", href.strip(), re.IGNORECASE)
    if match and match.group(1).lower() not in ("http", "https"):
        warn(f"{where}: link scheme {match.group(1)!r} is not allowed; replaced by '#'")
        return "#"
    return href.strip()


def print_ref(value: Any, where: str) -> tuple[str, str]:
    """A print reference is a file name or {"file": ..., "caption": ...}; returns (file, caption)."""
    if isinstance(value, str):
        return value, ""
    if isinstance(value, dict) and isinstance(value.get("file"), str):
        return value["file"], str(value.get("caption") or "")
    raise fail(f"resultado.data.json: {where} must be a file name or {{file, caption}}")


def build_payload(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, int]]:
    try:
        data = json.loads(read_text(args.data))
    except json.JSONDecodeError as error:
        raise fail(f"{args.data} is not valid JSON: {error}") from error
    if not isinstance(data, dict):
        raise fail(f"{args.data} must hold a JSON object")

    spec = parse_spec(args.specs / "spec.md")
    battery = parse_quickstart(args.specs / "quickstart.md")
    doubts = parse_doubts(args.specs / "duvidas.md")

    images: dict[str, str] = {}
    sizes: dict[str, tuple[int, int]] = {}
    embed = make_embedder(args.prints, images, sizes)

    # --- header
    hero = text_field(data, "hero")
    meta = {
        "title": text_field(data, "title", "Jobu Donel — resultado"),
        "lede": md(text_field(data, "lede")),
        "howTo": md(text_field(data, "howTo")),
        "notice": md(text_field(data, "notice")),
        "hero": embed(hero) if hero else None,
    }

    # --- the six cards, checked against the spec so a new story is never silently left out
    story_by_id = {story["id"]: story for story in spec["stories"]}
    cards: list[dict[str, Any]] = []
    covered: set[str] = set()
    for card in list_field(data, "cards"):
        us = str(card.get("us", ""))
        if us not in story_by_id:
            warn(f"cards: {us!r} is not a user story of spec.md")
        covered.add(us)
        refs = [str(ref) for ref in card.get("refs", [])]
        for ref in refs:
            if ref not in spec["requirements"]:
                warn(f"cards: {ref} is not a requirement of spec.md")
        title = str(card.get("title") or story_by_id.get(us, {}).get("title") or us)
        cards.append({"us": us, "title": plain(title), "text": md(str(card.get("text", ""))), "refs": refs})
    for story in spec["stories"]:
        if story["id"] not in covered:
            warn(f"cards: spec.md has {story['id']} ({story['title']}) but the data file has no card for it")

    # --- gallery: the listed order first, then any print nobody listed (so none is lost)
    gallery: list[dict[str, str]] = []
    listed: set[str] = set()
    for item in list_field(data, "gallery"):
        file, caption = print_ref(item, "a gallery item")
        listed.add(file)
        key = embed(file)
        if key is None:
            continue
        kind = item.get("kind") if isinstance(item, dict) and item.get("kind") else kind_of(file)
        gallery.append({"file": key, "caption": md(caption), "alt": plain(caption), "kind": kind})
    if args.prints.is_dir():
        for path in sorted(args.prints.glob("*.png")):
            if path.name in listed:
                continue
            warn(f"print {path.name} is not in the gallery of the data file; appended with its file name as caption")
            key = embed(path.name)
            if key is not None:
                gallery.append({"file": key, "caption": md(path.stem), "alt": path.stem, "kind": kind_of(path.name)})
    else:
        warn(f"prints folder not found: {args.prints}")

    # --- steps and their expected print
    all_steps = {step["id"]: step for group in battery["groups"] for step in group["steps"]}
    for step in all_steps.values():
        step["print"] = None
    for step_id, ref in dict_field(data, "stepPrints").items():
        if step_id not in all_steps:
            warn(f"stepPrints: {step_id} is not a step of quickstart.md")
            continue
        file, caption = print_ref(ref, f"stepPrints[{step_id}]")
        key = embed(file)
        if key is not None:
            all_steps[step_id]["print"] = {"file": key, "caption": md(caption), "alt": plain(caption)}

    # --- doubts and their optional prints
    doubt_by_id = {doubt["id"]: doubt for doubt in doubts}
    for doubt in doubts:
        doubt["prints"] = []
    for doubt_id, refs in dict_field(data, "doubtPrints").items():
        if doubt_id not in doubt_by_id:
            warn(f"doubtPrints: {doubt_id} is not a doubt of duvidas.md")
            continue
        if not isinstance(refs, list):
            raise fail(f"resultado.data.json: doubtPrints[{doubt_id}] must be a list")
        for ref in refs:
            file, caption = print_ref(ref, f"doubtPrints[{doubt_id}]")
            key = embed(file)
            if key is not None:
                doubt_by_id[doubt_id]["prints"].append({"file": key, "caption": md(caption), "alt": plain(caption)})

    # --- art request
    art_data = dict_field(data, "art")
    poses: list[dict[str, Any]] = []
    for pose in art_data.get("poses", []):
        ref = str(pose.get("ref") or "")
        poses.append(
            {
                "name": plain(str(pose.get("name", ""))),
                "file": plain(str(pose.get("file", ""))),
                "when": md(str(pose.get("when", ""))),
                "ref": embed(ref) if ref else None,
                "refLabel": md(str(pose.get("refLabel", ""))),
            }
        )
    reference = art_data.get("reference")
    art = {
        "title": plain(str(art_data.get("title", "Pedido de arte"))),
        "intro": md(str(art_data.get("intro", ""))),
        "poses": poses,
        "rulesTitle": plain(str(art_data.get("rulesTitle", "Como entregar"))),
        "rules": [md(str(rule)) for rule in art_data.get("rules", [])],
        "reference": (
            {
                "href": safe_href(str(reference.get("href", "")), "art.reference"),
                "text": plain(str(reference.get("text", ""))),
            }
            if isinstance(reference, dict) and reference.get("href")
            else None
        ),
    }

    proto = dict_field(data, "prototype")
    prototype = {
        "href": safe_href(str(proto.get("href", "prototipo.html")), "prototype"),
        "title": plain(str(proto.get("title", "Protótipo"))),
        "text": md(str(proto.get("text", ""))),
        "label": plain(str(proto.get("label", "Abrir o protótipo"))),
    }

    # relative links must resolve next to the generated page (the page does not embed them)
    for href in (prototype["href"], (art["reference"] or {}).get("href", "")):
        if href and not re.match(r"^[a-z][a-z0-9+.-]*:", href, re.IGNORECASE) and not (args.out.parent / href).is_file():
            warn(f"link target not found next to the page: {href}")

    # --- crops: thumbnails may show only a region of a print; the lightbox always shows it whole
    crops: dict[str, list[int]] = {}
    for file, box in dict_field(data, "crops").items():
        key = file.replace("\\", "/")
        size = sizes.get(key)
        if key not in images or size is None:
            warn(f"crops: {file} is not a PNG used by the page; ignored")
            continue
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)):
            warn(f"crops: {file} must be [x, y, width, height]; ignored")
            continue
        x, y, w, h = (int(v) for v in box)
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > size[0] or y + h > size[1]:
            warn(f"crops: {file} {box} falls outside the {size[0]}x{size[1]} image; ignored")
            continue
        crops[key] = [x, y, w, h]

    payload = {
        "meta": meta,
        "cards": cards,
        "gallery": gallery,
        "prototype": prototype,
        "battery": battery,
        "doubts": doubts,
        "art": art,
        "next": [md(str(item)) for item in list_field(data, "next")],
        "crops": crops,
        "sizes": {key: list(sizes[key]) for key in crops},
        "images": images,
    }
    stats = {
        "steps": len(all_steps),
        "groups": len(battery["groups"]),
        "doubts": len(doubts),
        "images": len(images),
    }
    return payload, stats


def script_json(value: Any) -> str:
    """JSON that cannot close or confuse the inline <script> it is pasted into."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    for raw, escaped in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"), (chr(0x2028), "\\u2028"), (chr(0x2029), "\\u2029")):
        text = text.replace(raw, escaped)
    return text


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template", type=Path, default=ROOT / "design/jobu-pet/resultado.template.html")
    parser.add_argument("--data", type=Path, default=ROOT / "design/jobu-pet/resultado.data.json")
    parser.add_argument("--specs", type=Path, default=ROOT / "specs/015-jobu-pet")
    parser.add_argument("--prints", type=Path, default=ROOT / "design/jobu-pet/prints")
    parser.add_argument("--out", type=Path, default=ROOT / "design/jobu-pet/resultado.html")
    parser.add_argument("--strict", action="store_true", help="treat every warning as an error")
    args = parser.parse_args()

    template = read_text(args.template)
    if template.count(DATA_SLOT) != 1:
        raise fail(f"the template must contain {DATA_SLOT} exactly once")

    payload, stats = build_payload(args)
    payload["meta"]["build"] = hashlib.sha1((template + script_json(payload)).encode("utf-8")).hexdigest()[:8]

    if args.strict and WARNINGS:
        raise fail(f"{len(WARNINGS)} warning(s) in --strict mode; {args.out} was not written")

    page = template.replace(DATA_SLOT, script_json(payload))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page, encoding="utf-8", newline="\n")
    print(
        f"{args.out} ({len(page.encode('utf-8')) / 1024 / 1024:.2f} MB, "
        f"{stats['steps']} steps in {stats['groups']} groups, {stats['doubts']} doubts, "
        f"{stats['images']} images embedded, {len(WARNINGS)} warning(s))"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
