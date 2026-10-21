#!/usr/bin/env python3
"""Build design/jobu-pet/prototipo.html: the template plus the pose PNGs as data: URIs.

The prototype is ONE self-contained file (no CDN, no external asset). The art comes from
src/renderer/src/pet/assets/poses (run scripts/pet/slice-sprites.py first); the manifest there
tells the page the canvas, the anchor, and which stand-in pose covers each missing new pose.

Usage
  python scripts/pet/build-prototype.py
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_SLOT = "/*__MANIFEST__*/ null"
POSES_SLOT = "/*__POSES__*/ {}"


def js_json(value: object) -> str:
    """JSON that is safe to paste inside an inline <script>."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--template", type=Path, default=ROOT / "design/jobu-pet/prototipo.template.html")
    ap.add_argument("--poses", type=Path, default=ROOT / "src/renderer/src/pet/assets/poses")
    ap.add_argument("--out", type=Path, default=ROOT / "design/jobu-pet/prototipo.html")
    args = ap.parse_args()

    template = args.template.read_text(encoding="utf-8")
    for slot in (MANIFEST_SLOT, POSES_SLOT):
        if template.count(slot) != 1:
            print(f"error: the template must contain {slot!r} exactly once", file=sys.stderr)
            return 1

    manifest = json.loads((args.poses / "manifest.json").read_text(encoding="utf-8"))
    data: dict[str, str] = {}
    for name, meta in manifest["poses"].items():
        png = (args.poses / meta["file"]).read_bytes()
        data[name] = "data:image/png;base64," + base64.b64encode(png).decode("ascii")

    html = template.replace(MANIFEST_SLOT, js_json(manifest)).replace(POSES_SLOT, js_json(data))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8", newline="\n")
    print(f"{args.out} ({len(html) / 1024 / 1024:.2f} MB, {len(data)} poses embedded)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
