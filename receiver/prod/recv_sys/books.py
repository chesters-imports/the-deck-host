"""
Receiver notebooks — full .bok packages (multi-page).
Same paper shape as My Pocket Notebook / Journal.
"""

from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

from papers import dump_frontmatter, parse_frontmatter, slugify


def now() -> int:
    return int(time.time())


def list_books(books_root: Path) -> list[dict[str, Any]]:
    books_root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for p in sorted(books_root.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_dir() or not p.name.endswith(".bok"):
            continue
        b = read_book(p)
        if b:
            out.append(
                {
                    "id": b["id"],
                    "title": b["title"],
                    "author": b.get("author") or "unknown",
                    "cloth": b["cloth"],
                    "shelf": b.get("shelf") or "",
                    "updated": b["updated"],
                    "page_count": len(b.get("pages") or []),
                }
            )
    return out


def bok_for_id(books_root: Path, book_id: str) -> Path | None:
    if not books_root.is_dir():
        return None
    for p in books_root.iterdir():
        if not p.is_dir() or not p.name.endswith(".bok"):
            continue
        book_md = p / "book.md"
        if not book_md.is_file():
            continue
        meta, _ = parse_frontmatter(book_md.read_text(encoding="utf-8"))
        if meta.get("id") == book_id:
            return p
    return None


def read_book(bok: Path) -> dict[str, Any] | None:
    book_md = bok / "book.md"
    if not book_md.is_file():
        return None
    meta, _ = parse_frontmatter(book_md.read_text(encoding="utf-8"))
    pages_dir = bok / "pages"
    pages: list[dict[str, Any]] = []
    if pages_dir.is_dir():
        # glob sort = 001-…, 002-… filename order as fallback when position missing
        for file_i, pf in enumerate(sorted(pages_dir.glob("*.md"))):
            pm, body = parse_frontmatter(pf.read_text(encoding="utf-8"))
            if body.startswith("\n"):
                body = body[1:]
            raw_pos = pm.get("position")
            try:
                pos = int(raw_pos) if raw_pos not in (None, "") else 0
            except (TypeError, ValueError):
                pos = 0
            # filename 001-foo.md → 1
            if not pos:
                m = re.match(r"^(\d+)", pf.stem)
                pos = int(m.group(1)) if m else (file_i + 1)
            pages.append(
                {
                    "id": pm.get("id") or pf.stem,
                    "position": pos,
                    "title": pm.get("title") or "",
                    "body": body if body is not None else "",
                    "mark": pm.get("mark") or "",
                    "updated": int(pm.get("updated") or 0),
                }
            )
    pages.sort(key=lambda p: (p.get("position") or 0, p.get("id") or ""))
    for i, p in enumerate(pages):
        p["position"] = i + 1
    if not pages:
        t = now()
        pages = [
            {
                "id": f"pg-{t}",
                "position": 1,
                "title": "page one",
                "body": "",
                "mark": "",
                "updated": t,
            }
        ]
    return {
        "id": meta.get("id") or bok.stem.replace(".bok", ""),
        "title": meta.get("title") or bok.stem.replace(".bok", ""),
        "author": (meta.get("author") or "").strip() or "unknown",
        "whisper": meta.get("whisper") or "",
        "cloth": meta.get("cloth") or "oxblood",
        "shelf": (meta.get("shelf") or "").strip(),  # put away on a shelf
        "created": int(meta.get("created") or 0),
        "updated": int(meta.get("updated") or 0),
        "pages": pages,
        "kind": "notebook",
    }


def delete_book(books_root: Path, book_id: str) -> bool:
    p = bok_for_id(books_root, book_id)
    if not p or not p.is_dir():
        return False
    try:
        shutil.rmtree(p)
        return True
    except OSError:
        return False


def write_book(books_root: Path, nb: dict[str, Any]) -> Path:
    books_root.mkdir(parents=True, exist_ok=True)
    book_id = nb.get("id") or f"nb-{now()}"
    nb["id"] = book_id
    existing = bok_for_id(books_root, book_id)
    if existing is None:
        base = slugify(nb.get("title") or book_id, book_id)
        candidate = books_root / f"{base}.bok"
        n = 2
        while candidate.exists():
            other = read_book(candidate)
            if other and other.get("id") == book_id:
                break
            candidate = books_root / f"{base}-{n}.bok"
            n += 1
        existing = candidate
    existing.mkdir(parents=True, exist_ok=True)
    pages_dir = existing / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    for old in pages_dir.glob("*.md"):
        old.unlink()
    t = now()
    nb["updated"] = t
    if not nb.get("created"):
        nb["created"] = t
    book_meta = {
        "id": book_id,
        "title": nb.get("title") or "notebook",
        "author": (nb.get("author") or "").strip() or "unknown",
        "whisper": nb.get("whisper") or "on the felt",
        "cloth": nb.get("cloth") or "oxblood",
        "shelf": (nb.get("shelf") or "").strip(),
        "created": nb.get("created") or t,
        "updated": t,
    }
    (existing / "book.md").write_text(dump_frontmatter(book_meta, ""), encoding="utf-8")
    pages = list(nb.get("pages") or [])
    if not pages:
        pages = [
            {
                "id": f"pg-{t}",
                "position": 1,
                "title": "page one",
                "body": "",
                "mark": "",
            }
        ]
    # force position = array order (source of truth for TOC reorder)
    for i, pg in enumerate(pages):
        pg["position"] = i + 1
    for i, pg in enumerate(pages):
        pos = i + 1
        pid = pg.get("id") or f"pg-{t}-{i}"
        title = pg.get("title") or f"page {pos}"
        fn = f"{pos:03d}-{slugify(title, pid[-8:] if len(str(pid)) >= 8 else pid)}.md"
        pm = {
            "id": pid,
            "title": title,
            "position": pos,
            "updated": t,
        }
        if pg.get("mark"):
            pm["mark"] = pg["mark"]
        body = pg.get("body")
        if body is None:
            body = ""
        (pages_dir / fn).write_text(
            dump_frontmatter(pm, str(body)), encoding="utf-8"
        )
    return existing


def new_book(
    title: str = "untitled",
    cloth: str = "oxblood",
    author: str = "unknown",
) -> dict[str, Any]:
    t = now()
    return {
        "id": f"nb-{t}",
        "title": title or "untitled",
        "author": (author or "").strip() or "unknown",
        "whisper": "spawned on the felt",
        "cloth": cloth or "oxblood",
        "created": t,
        "updated": t,
        "kind": "notebook",
        "pages": [
            {
                "id": f"pg-{t}",
                "position": 1,
                "title": "page one",
                "body": "",
                "mark": "",
                "updated": t,
            }
        ],
    }


def import_bok(src: Path, books_root: Path) -> dict[str, Any] | None:
    """Copy a .bok folder into Receiver books (new id so we don't collide)."""
    if not src.is_dir() or not (src / "book.md").is_file():
        return None
    b = read_book(src)
    if not b:
        return None
    t = now()
    b["id"] = f"nb-{t}-imp"
    b["whisper"] = (b.get("whisper") or "") + " · imported to Receiver"
    # fresh page ids optional — keep for continuity
    write_book(books_root, b)
    p = bok_for_id(books_root, b["id"])
    return read_book(p) if p else b


def list_external_journals() -> list[dict[str, Any]]:
    """Pocket Journal + Notebook safe_box books (read catalog only)."""
    # recv_sys → prod → receiver → the-deck-host → ALICE_BOX
    alice = Path(__file__).resolve().parents[4]
    candidates = [
        alice / "my-pocket-things" / "pocket-journal" / "prod" / "safe_box" / "books",
        alice / "my-pocket-things" / "pocket-notebook" / "prod" / "safe_box" / "books",
    ]
    out: list[dict[str, Any]] = []
    for books in candidates:
        if not books.is_dir():
            continue
        src = "journal" if "journal" in str(books) else "notebook"
        for p in sorted(books.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_dir() or not p.name.endswith(".bok"):
                continue
            b = read_book(p)
            if not b:
                continue
            out.append(
                {
                    "id": b["id"],
                    "title": b["title"],
                    "cloth": b["cloth"],
                    "page_count": len(b.get("pages") or []),
                    "source": src,
                    "path": str(p),
                }
            )
    return out
