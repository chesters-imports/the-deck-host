"""
Receiver folders (folios) — put leaves away off the felt.
Bin-lite: folder lists sheet ids; leaf.folder points back.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from papers import dump_frontmatter, parse_frontmatter, slugify


def now() -> int:
    return int(time.time())


def folder_path(folders_root: Path, folder_id: str) -> Path | None:
    folders_root.mkdir(parents=True, exist_ok=True)
    for p in folders_root.glob("*.folder.md"):
        meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        if meta.get("id") == folder_id:
            return p
    direct = folders_root / f"{folder_id}.folder.md"
    if direct.is_file():
        return direct
    return None


def _parse_sheets(raw: Any) -> list[str]:
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


def read_folder(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    return {
        "id": meta.get("id") or path.stem.replace(".folder", ""),
        "title": meta.get("title") or "folder",
        "kind": "folder",
        "sheets": _parse_sheets(meta.get("sheets")),
        "created": int(meta.get("created") or 0),
        "updated": int(meta.get("updated") or 0),
        "body": body or "",
        "_file": path.name,
        "_path": str(path.resolve()),
    }


def list_folders(folders_root: Path) -> list[dict[str, Any]]:
    folders_root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for p in sorted(folders_root.glob("*.folder.md"), key=lambda x: x.stat().st_mtime):
        f = read_folder(p)
        if f:
            out.append(
                {
                    "id": f["id"],
                    "title": f["title"],
                    "sheets": len(f.get("sheets") or []),
                    "updated": f["updated"],
                }
            )
    return out


def write_folder(folders_root: Path, folder: dict[str, Any]) -> Path:
    folders_root.mkdir(parents=True, exist_ok=True)
    fid = folder.get("id") or f"fd-{now()}"
    folder["id"] = fid
    t = now()
    folder["updated"] = t
    if not folder.get("created"):
        folder["created"] = t
    existing = folder_path(folders_root, fid)
    if existing is None:
        base = slugify(folder.get("title") or fid, fid)
        candidate = folders_root / f"{base}.folder.md"
        n = 2
        while candidate.exists():
            other = read_folder(candidate)
            if other and other.get("id") == fid:
                break
            candidate = folders_root / f"{base}-{n}.folder.md"
            n += 1
        existing = candidate
    sheets = folder.get("sheets") or []
    if not isinstance(sheets, list):
        sheets = _parse_sheets(sheets)
    # de-dupe preserve order
    seen: set[str] = set()
    clean: list[str] = []
    for s in sheets:
        sid = str(s)
        if sid and sid not in seen:
            seen.add(sid)
            clean.append(sid)
    meta = {
        "id": fid,
        "title": folder.get("title") or "folder",
        "kind": "folder",
        "sheets": json.dumps(clean, ensure_ascii=False),
        "created": folder.get("created") or t,
        "updated": t,
    }
    existing.write_text(
        dump_frontmatter(meta, folder.get("body") or ""), encoding="utf-8"
    )
    return existing


def new_folder(title: str = "folder") -> dict[str, Any]:
    t = now()
    return {
        "id": f"fd-{t}",
        "title": title or "folder",
        "kind": "folder",
        "sheets": [],
        "created": t,
        "updated": t,
        "body": "",
    }


def delete_folder(folders_root: Path, folder_id: str) -> bool:
    p = folder_path(folders_root, folder_id)
    if not p:
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False


def rebuild_sheets_from_leaves(
    folders_root: Path, leaf_rows: list[dict[str, Any]]
) -> None:
    """
    Repair folder.sheets from leaf.folder fields (e.g. after sheets were
    dropped by dump_frontmatter missing the key).
    """
    by_f: dict[str, list[str]] = {}
    for row in leaf_rows:
        fid = (row.get("folder") or "").strip()
        lid = (row.get("id") or "").strip()
        if fid and lid:
            by_f.setdefault(fid, []).append(lid)
    for fid, lids in by_f.items():
        p = folder_path(folders_root, fid)
        if not p:
            continue
        f = read_folder(p)
        if not f:
            continue
        # union: keep existing order, append missing
        sheets = list(f.get("sheets") or [])
        seen = set(sheets)
        for lid in lids:
            if lid not in seen:
                sheets.append(lid)
                seen.add(lid)
        f["sheets"] = sheets
        write_folder(folders_root, f)
