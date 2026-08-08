"""
Corkboards — pin boards for loose leaves.
Board lists pins; leaf may list boards (both updated on pin/unpin).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from papers import dump_frontmatter, parse_frontmatter, slugify


def now() -> int:
    return int(time.time())


def cork_path(corks_root: Path, cork_id: str) -> Path | None:
    corks_root.mkdir(parents=True, exist_ok=True)
    for p in corks_root.glob("*.cork.md"):
        meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        if meta.get("id") == cork_id:
            return p
    direct = corks_root / f"{cork_id}.cork.md"
    if direct.is_file():
        return direct
    return None


def _parse_pins(meta: dict[str, Any]) -> list[str]:
    raw = meta.get("pins") or meta.get("pins_json") or "[]"
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith("["):
            try:
                v = json.loads(s)
                if isinstance(v, list):
                    return [str(x) for x in v]
            except json.JSONDecodeError:
                pass
        if s:
            return [p.strip() for p in s.split(",") if p.strip()]
    return []


def read_cork(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    return {
        "id": meta.get("id") or path.stem.replace(".cork", ""),
        "title": meta.get("title") or "corkboard",
        "kind": "corkboard",
        "pins": _parse_pins(meta),
        "created": int(meta.get("created") or 0),
        "updated": int(meta.get("updated") or 0),
        "body": body or "",
        "_file": path.name,
    }


def list_corks(corks_root: Path) -> list[dict[str, Any]]:
    corks_root.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(corks_root.glob("*.cork.md"), key=lambda x: x.stat().st_mtime):
        c = read_cork(p)
        if c:
            out.append(
                {
                    "id": c["id"],
                    "title": c["title"],
                    "pin_count": len(c.get("pins") or []),
                    "updated": c["updated"],
                }
            )
    return out


def write_cork(corks_root: Path, cork: dict[str, Any]) -> Path:
    corks_root.mkdir(parents=True, exist_ok=True)
    cid = cork.get("id") or f"cb-{now()}"
    cork["id"] = cid
    t = now()
    cork["updated"] = t
    if not cork.get("created"):
        cork["created"] = t
    existing = cork_path(corks_root, cid)
    if existing is None:
        base = slugify(cork.get("title") or cid, cid)
        candidate = corks_root / f"{base}.cork.md"
        n = 2
        while candidate.exists():
            other = read_cork(candidate)
            if other and other.get("id") == cid:
                break
            candidate = corks_root / f"{base}-{n}.cork.md"
            n += 1
        existing = candidate
    pins = cork.get("pins") or []
    if not isinstance(pins, list):
        pins = []
    pins = [str(p) for p in pins]
    # dedupe preserve order
    seen = set()
    clean = []
    for p in pins:
        if p not in seen:
            seen.add(p)
            clean.append(p)
    meta = {
        "id": cid,
        "title": cork.get("title") or "corkboard",
        "kind": "corkboard",
        "pins": json.dumps(clean, ensure_ascii=False),
        "created": cork.get("created") or t,
        "updated": t,
    }
    existing.write_text(
        dump_frontmatter(meta, cork.get("body") or ""), encoding="utf-8"
    )
    return existing


def new_cork(title: str = "corkboard") -> dict[str, Any]:
    t = now()
    return {
        "id": f"cb-{t}",
        "title": title or "corkboard",
        "kind": "corkboard",
        "pins": [],
        "created": t,
        "updated": t,
        "body": "",
    }
