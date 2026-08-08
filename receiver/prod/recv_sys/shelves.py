"""
Receiver shelves — put notebooks away off the felt.
Same idea as folders, but for books.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from papers import dump_frontmatter, parse_frontmatter, slugify


def now() -> int:
    return int(time.time())


def shelf_path(shelves_root: Path, shelf_id: str) -> Path | None:
    shelves_root.mkdir(parents=True, exist_ok=True)
    for p in shelves_root.glob("*.shelf.md"):
        meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        if meta.get("id") == shelf_id:
            return p
    direct = shelves_root / f"{shelf_id}.shelf.md"
    if direct.is_file():
        return direct
    return None


def _parse_ids(raw: Any) -> list[str]:
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


def read_shelf(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    return {
        "id": meta.get("id") or path.stem.replace(".shelf", ""),
        "title": meta.get("title") or "shelf",
        "kind": "shelf",
        "books": _parse_ids(meta.get("books")),
        "created": int(meta.get("created") or 0),
        "updated": int(meta.get("updated") or 0),
        "body": body or "",
        "_file": path.name,
        "_path": str(path.resolve()),
    }


def list_shelves(shelves_root: Path) -> list[dict[str, Any]]:
    shelves_root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for p in sorted(shelves_root.glob("*.shelf.md"), key=lambda x: x.stat().st_mtime):
        s = read_shelf(p)
        if s:
            out.append(
                {
                    "id": s["id"],
                    "title": s["title"],
                    "books": len(s.get("books") or []),
                    "updated": s["updated"],
                }
            )
    return out


def write_shelf(shelves_root: Path, shelf: dict[str, Any]) -> Path:
    shelves_root.mkdir(parents=True, exist_ok=True)
    sid = shelf.get("id") or f"sh-{now()}"
    shelf["id"] = sid
    t = now()
    shelf["updated"] = t
    if not shelf.get("created"):
        shelf["created"] = t
    existing = shelf_path(shelves_root, sid)
    if existing is None:
        base = slugify(shelf.get("title") or sid, sid)
        candidate = shelves_root / f"{base}.shelf.md"
        n = 2
        while candidate.exists():
            other = read_shelf(candidate)
            if other and other.get("id") == sid:
                break
            candidate = shelves_root / f"{base}-{n}.shelf.md"
            n += 1
        existing = candidate
    books = shelf.get("books") or []
    if not isinstance(books, list):
        books = _parse_ids(books)
    seen: set[str] = set()
    clean: list[str] = []
    for b in books:
        bid = str(b)
        if bid and bid not in seen:
            seen.add(bid)
            clean.append(bid)
    meta = {
        "id": sid,
        "title": shelf.get("title") or "shelf",
        "kind": "shelf",
        "books": json.dumps(clean, ensure_ascii=False),
        "created": shelf.get("created") or t,
        "updated": t,
    }
    existing.write_text(
        dump_frontmatter(meta, shelf.get("body") or ""), encoding="utf-8"
    )
    return existing


def new_shelf(title: str = "shelf") -> dict[str, Any]:
    t = now()
    return {
        "id": f"sh-{t}",
        "title": title or "shelf",
        "kind": "shelf",
        "books": [],
        "created": t,
        "updated": t,
        "body": "",
    }


def delete_shelf(shelves_root: Path, shelf_id: str) -> bool:
    p = shelf_path(shelves_root, shelf_id)
    if not p:
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False
