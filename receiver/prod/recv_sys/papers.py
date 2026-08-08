"""
Receiver loose leaves — one paper, one file.
A leaf can later slip into a notebook. Not a full .bok by itself.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

# New writes use .leaf.md; still read legacy .scrap.md
LEAF_GLOB = ("*.leaf.md", "*.scrap.md")


def now() -> int:
    return int(time.time())


def slugify(title: str, fallback: str = "leaf") -> str:
    s = re.sub(r"[^\w\s-]", "", (title or "").strip(), flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-").lower()
    return (s[:48] if s else fallback) or fallback


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    raw = text.replace("\r\n", "\n")
    if not raw.startswith("---\n"):
        return {}, raw
    end = raw.find("\n---\n", 4)
    if end < 0:
        return {}, raw
    block = raw[4:end]
    body = raw[end + 5 :]
    # drop single leading newline from body convention
    if body.startswith("\n"):
        body = body[1:]
    meta: dict[str, Any] = {}
    for line in block.split("\n"):
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if v.startswith('"') and v.endswith('"'):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                v = v[1:-1]
        if k in ("created", "updated") and str(v).isdigit():
            meta[k] = int(v)
        else:
            meta[k] = v
    return meta, body


def dump_frontmatter(meta: dict[str, Any], body: str) -> str:
    lines = ["---"]
    for k in (
        "id",
        "title",
        "author",
        "cloth",
        "kind",
        "paper",
        "folder",
        "sheets",
        "books",
        "shelf",
        "boards",
        "pins",
        "position",
        "stamps",
        "created",
        "updated",
    ):
        if k not in meta or meta[k] is None or meta[k] == "":
            continue
        val = meta[k]
        if isinstance(val, (list, dict)):
            val = json.dumps(val, ensure_ascii=False)
        elif isinstance(val, str) and (":" in val or "\n" in val or val.startswith(" ")):
            val = json.dumps(val, ensure_ascii=False)
        lines.append(f"{k}: {val}")
    lines.append("---")
    body = "" if body is None else str(body)
    # Always put a newline after fence so body is never glued to ---
    return "\n".join(lines) + "\n" + body


def _parse_id_list(raw: Any) -> list[str]:
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


def _iter_leaf_files(leaves_root: Path):
    seen: set[Path] = set()
    for pattern in LEAF_GLOB:
        for p in leaves_root.glob(pattern):
            rp = p.resolve()
            if rp not in seen:
                seen.add(rp)
                yield p


def leaf_path(leaves_root: Path, leaf_id: str) -> Path | None:
    """Alias: scrap_path."""
    leaves_root.mkdir(parents=True, exist_ok=True)
    for p in _iter_leaf_files(leaves_root):
        meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        if meta.get("id") == leaf_id:
            return p
    for name in (f"{leaf_id}.leaf.md", f"{leaf_id}.scrap.md"):
        direct = leaves_root / name
        if direct.is_file():
            return direct
    return None


scrap_path = leaf_path  # legacy name


def read_leaf(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    stem = path.name
    for suf in (".leaf.md", ".scrap.md", ".md"):
        if stem.endswith(suf):
            stem = stem[: -len(suf)]
            break
    kind = meta.get("kind") or "leaf"
    if kind == "scrap":
        kind = "leaf"
    author = (meta.get("author") or "").strip() or "unknown"
    return {
        "id": meta.get("id") or stem,
        "title": meta.get("title") or "untitled leaf",
        "author": author,
        "cloth": meta.get("cloth") or "oxblood",
        "kind": kind,
        "paper": meta.get("paper") or "plain",  # plain | lined | dotted | letter
        "folder": (meta.get("folder") or "").strip(),  # put away in folder id
        "boards": _parse_id_list(meta.get("boards")),  # corkboard ids
        # rubber-stamp marks on the paper face (presentation, not body text)
        "stamps": _parse_id_list(meta.get("stamps")),
        "created": int(meta.get("created") or 0),
        "updated": int(meta.get("updated") or 0),
        "body": body if body is not None else "",
        "_file": path.name,
        # absolute path — for “copy location” clipboard (Hands → agent find)
        "_path": str(path.resolve()),
    }


read_scrap = read_leaf


def list_leaves(leaves_root: Path) -> list[dict[str, Any]]:
    leaves_root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for p in sorted(_iter_leaf_files(leaves_root), key=lambda x: x.stat().st_mtime):
        s = read_leaf(p)
        if s:
            out.append(
                {
                    "id": s["id"],
                    "title": s["title"],
                    "author": s.get("author") or "unknown",
                    "cloth": s["cloth"],
                    "paper": s.get("paper") or "lined",
                    "folder": s.get("folder") or "",
                    "updated": s["updated"],
                    "chars": len(s.get("body") or ""),
                }
            )
    return out


list_scraps = list_leaves


def _unique_leaf_path(leaves_root: Path, title: str, sid: str) -> Path:
    """Filename from current title; avoid clobbering other leaves."""
    base = slugify(title or sid, sid)
    candidate = leaves_root / f"{base}.leaf.md"
    n = 2
    while candidate.exists():
        other = read_leaf(candidate)
        if other and other.get("id") == sid:
            break
        candidate = leaves_root / f"{base}-{n}.leaf.md"
        n += 1
    return candidate


def write_leaf(leaves_root: Path, leaf: dict[str, Any]) -> Path:
    leaves_root.mkdir(parents=True, exist_ok=True)
    sid = leaf.get("id") or f"lf-{now()}"
    leaf["id"] = sid
    t = now()
    leaf["updated"] = t
    if not leaf.get("created"):
        leaf["created"] = t
    existing = leaf_path(leaves_root, sid)
    title = leaf.get("title") or "untitled leaf"
    desired = _unique_leaf_path(leaves_root, title, sid)

    if existing is None:
        existing = desired
    else:
        # legacy .scrap.md → .leaf.md
        if existing.name.endswith(".scrap.md"):
            migrated = existing.with_name(existing.name.replace(".scrap.md", ".leaf.md"))
            if not migrated.exists() or migrated.resolve() == existing.resolve():
                try:
                    if migrated.resolve() != existing.resolve():
                        existing.rename(migrated)
                    existing = migrated
                except OSError:
                    pass
        # rename when title slug no longer matches file stem (fixes untitled-leaf comedy)
        if existing.resolve() != desired.resolve():
            try:
                if desired.exists():
                    other = read_leaf(desired)
                    if other and other.get("id") != sid:
                        desired = _unique_leaf_path(leaves_root, title + "-" + sid[-6:], sid)
                if existing.resolve() != desired.resolve():
                    existing.rename(desired)
                    existing = desired
            except OSError:
                # keep writing to existing path if OS blocks rename
                pass

    boards = leaf.get("boards") or []
    if not isinstance(boards, list):
        boards = _parse_id_list(boards)
    stamps = leaf.get("stamps") or []
    if not isinstance(stamps, list):
        stamps = _parse_id_list(stamps)
    author = (leaf.get("author") or "").strip() or "unknown"
    folder = (leaf.get("folder") or "").strip()
    meta = {
        "id": sid,
        "title": title,
        "author": author,
        "cloth": leaf.get("cloth") or "oxblood",
        "kind": "leaf",
        "paper": leaf.get("paper") or "plain",
        "folder": folder,
        "boards": json.dumps([str(b) for b in boards], ensure_ascii=False),
        "stamps": json.dumps([str(s) for s in stamps], ensure_ascii=False),
        "created": leaf.get("created") or t,
        "updated": t,
    }
    body = leaf.get("body")
    if body is None:
        body = ""
    existing.write_text(dump_frontmatter(meta, str(body)), encoding="utf-8")
    return existing


write_scrap = write_leaf


def new_leaf(
    title: str = "untitled leaf",
    cloth: str = "oxblood",
    author: str = "unknown",
) -> dict[str, Any]:
    t = now()
    # chip-class id (urgent memo): leaf_<id> in USER/chips/
    return {
        "id": f"leaf_{t}",
        "title": title or "untitled leaf",
        "author": (author or "").strip() or "unknown",
        "cloth": cloth or "oxblood",
        "kind": "leaf",
        "paper": "plain",
        "stamps": [],
        "folder": "",
        "boards": [],
        "created": t,
        "updated": t,
        "body": "",
    }


new_scrap = new_leaf


def delete_leaf(leaves_root: Path, leaf_id: str) -> bool:
    """Remove leaf file from disk. Caller should unhook folders."""
    p = leaf_path(leaves_root, leaf_id)
    if not p:
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False
