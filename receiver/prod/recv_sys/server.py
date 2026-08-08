#!/usr/bin/env python3
"""
Receiver · scraps + real notebooks on the felt.
"""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from books import (
    bok_for_id,
    delete_book,
    import_bok,
    list_books,
    list_external_journals,
    new_book,
    read_book,
    write_book,
)
from cork import cork_path, list_corks, new_cork, read_cork, write_cork
from folders import (
    delete_folder,
    folder_path,
    list_folders,
    new_folder,
    read_folder,
    rebuild_sheets_from_leaves,
    write_folder,
)
from shelves import (
    delete_shelf,
    list_shelves,
    new_shelf,
    read_shelf,
    shelf_path,
    write_shelf,
)
from papers import (
    delete_leaf,
    list_leaves,
    new_leaf,
    read_leaf,
    leaf_path,
    write_leaf,
)
from user_store import (
    book_from_bin,
    chip_path,
    config_path,
    configs_root,
    delete_bin,
    delete_leaf_chip,
    ensure_user_tree,
    layout_from_configs,
    leaf_api_from_chip_file,
    list_bins,
    list_leaf_chips,
    migrate_layout_and_dress_to_configs,
    migrate_legacy_to_user,
    migrate_needed,
    read_bin,
    read_place_config,
    save_book_as_bin,
    save_layout_as_configs,
    to_leaf_chip_id,
    write_bin,
    write_leaf_chip,
    DEFAULT_HOST,
)

SYS = Path(__file__).resolve().parent
PROD = SYS.parent
SAFE = PROD / "safe_box"
# LEGACY (pre-urgent-memo) — mausoleum after migrate
LEAVES = SAFE / "leaves"
SCRAPS_LEGACY = SAFE / "scraps"
BOOKS = SAFE / "books"
CORKS = SAFE / "corkboards"
FOLDERS = SAFE / "folders"
SHELVES = SAFE / "shelves"
LAYOUT_FILE = SAFE / "felt_layout.json"
HOST = "127.0.0.1"
PORT = int(__import__("os").environ.get("RECEIVER_PORT", "43200"))
SKU = "CO.RECV-001"
# Law (urgent memo): safe_box/USER/chips + safe_box/USER/bins/*
USER_CHIPS = SAFE / "USER" / "chips"
USER_BINS = SAFE / "USER" / "bins"


def leaves_root() -> Path:
    """Legacy path only; live matter is USER/chips after migrate."""
    LEAVES.mkdir(parents=True, exist_ok=True)
    return LEAVES


def all_leaf_dirs() -> list[Path]:
    roots = [leaves_root()]
    if SCRAPS_LEGACY.is_dir():
        roots.append(SCRAPS_LEGACY)
    return roots


def ensure() -> None:
    SAFE.mkdir(parents=True, exist_ok=True)
    LEAVES.mkdir(parents=True, exist_ok=True)
    BOOKS.mkdir(parents=True, exist_ok=True)
    CORKS.mkdir(parents=True, exist_ok=True)
    FOLDERS.mkdir(parents=True, exist_ok=True)
    SHELVES.mkdir(parents=True, exist_ok=True)
    ensure_user_tree(SAFE)
    # HOST order: not leaves/ — USER/chips + USER/bins
    if migrate_needed(SAFE):
        try:
            report = migrate_legacy_to_user(SAFE)
            sys.stderr.write(
                "[receiver] migrated to USER/chips + USER/bins: %s\n" % (report,)
            )
        except Exception as e:
            sys.stderr.write("[receiver] migrate failed: %s\n" % (e,))
    # configs: pose + dressup papers for this host (architecture page 5)
    cfg_flag = configs_root(SAFE, DEFAULT_HOST) / ".migrated_configs_v1"
    if not cfg_flag.is_file():
        try:
            crep = migrate_layout_and_dress_to_configs(SAFE, LAYOUT_FILE, DEFAULT_HOST)
            sys.stderr.write("[receiver] migrated configs: %s\n" % (crep,))
        except Exception as e:
            sys.stderr.write("[receiver] config migrate failed: %s\n" % (e,))


def load_felt_layout() -> dict[str, Any]:
    """Prefer USER/configs/<host> papers; fall back to felt_layout.json aggregate."""
    from_cfg = layout_from_configs(SAFE, DEFAULT_HOST)
    if from_cfg:
        return from_cfg
    if not LAYOUT_FILE.is_file():
        return {}
    try:
        data = json.loads(LAYOUT_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "objects" in data:
            return data["objects"] if isinstance(data["objects"], dict) else {}
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def save_felt_layout(objects: dict[str, Any]) -> None:
    """Write pose+dressup config papers + keep felt_layout.json as aggregate mirror."""
    SAFE.mkdir(parents=True, exist_ok=True)
    objs = objects if isinstance(objects, dict) else {}
    try:
        save_layout_as_configs(SAFE, objs, DEFAULT_HOST)
    except Exception as e:
        sys.stderr.write("[receiver] config write failed: %s\n" % (e,))
    payload = {
        "schema": "receiver-felt-layout.v1",
        "updated": int(__import__("time").time()),
        "objects": objs,
        "note": "aggregate mirror — source of truth is USER/configs/receiver/*.cfg",
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    tmp = LAYOUT_FILE.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(LAYOUT_FILE)


def find_leaf(lid: str):
    """Resolve leaf chip by id (leaf_… or legacy lf-/pg- mapped)."""
    cid = to_leaf_chip_id(lid)
    for try_id in (cid, lid, to_leaf_chip_id(lid)):
        p = chip_path(SAFE, try_id)
        if p:
            leaf = leaf_api_from_chip_file(p)
            if leaf:
                return SAFE, p, leaf
    # legacy pre-migrate
    for root in all_leaf_dirs():
        p = leaf_path(root, lid)
        if p:
            return root, p, read_leaf(p)
    return None, None, None


def folder_as_api(b: dict[str, Any] | None) -> dict[str, Any] | None:
    """Bin subtype folder → old folder shape (sheets = chips)."""
    if not b:
        return None
    return {
        "id": b["id"],
        "title": b.get("title") or "folder",
        "kind": "folder",
        "sheets": list(b.get("chips") or []),
        "created": b.get("created") or 0,
        "updated": b.get("updated") or 0,
        "body": b.get("body") or "",
        "_path": b.get("_path"),
        "_file": b.get("_file"),
    }


def jsend(handler: SimpleHTTPRequestHandler, code: int, payload: Any) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


def read_json(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0:
        return {}
    try:
        return json.loads(handler.rfile.read(n).decode("utf-8"))
    except json.JSONDecodeError:
        return {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SYS), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        ensure()
        path = urlparse(self.path).path

        if path == "/api/health":
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "app": "Receiver",
                    "sku": SKU,
                    "slice": "2.0-user-chips-bins",
                    "port": PORT,
                    "user_chips": str(USER_CHIPS),
                    "user_bins": str(USER_BINS),
                    "user_configs": str(configs_root(SAFE, DEFAULT_HOST)),
                    "leaves_legacy": str(LEAVES),
                    "books_legacy": str(BOOKS),
                    "shelves": str(SHELVES),
                },
            )

        if path in ("/api/leaves", "/api/scraps"):
            rows = list_leaf_chips(SAFE)
            # chips inside book bins are not loose felt matter (bin membership)
            in_book: set[str] = set()
            for b in list_bins(SAFE, "book"):
                for c in b.get("chips") or []:
                    in_book.add(str(c))
            loose = [r for r in rows if r["id"] not in in_book]
            return jsend(self, 200, {"ok": True, "leaves": loose, "scraps": loose})

        if path.startswith("/api/leaf/") or path.startswith("/api/scrap/"):
            prefix = "/api/leaf/" if path.startswith("/api/leaf/") else "/api/scrap/"
            rest = unquote(path[len(prefix) :].strip("/"))
            # /api/leaf/<id>/raw — full on-disk file text + path (check paper)
            if rest.endswith("/raw"):
                sid = rest[: -len("/raw")].strip("/")
                _, p, leaf = find_leaf(sid)
                if not leaf or not p:
                    return jsend(self, 404, {"ok": False, "error": "not found"})
                try:
                    text = Path(p).read_text(encoding="utf-8")
                except OSError as e:
                    return jsend(self, 500, {"ok": False, "error": str(e)})
                return jsend(
                    self,
                    200,
                    {
                        "ok": True,
                        "id": leaf.get("id"),
                        "path": str(Path(p).resolve()),
                        "file": Path(p).name,
                        "text": text,
                        "chars": len(text),
                    },
                )
            sid = rest
            _, p, leaf = find_leaf(sid)
            if not leaf:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            return jsend(self, 200, {"ok": True, "leaf": leaf, "scrap": leaf})

        if path == "/api/books":
            books = []
            for b in list_bins(SAFE, "book"):
                books.append(
                    {
                        "id": b["id"],
                        "title": b.get("title"),
                        "author": b.get("author") or "unknown",
                        "cloth": b.get("cloth") or "oxblood",
                        "shelf": b.get("shelf") or "",
                        "updated": b.get("updated") or 0,
                        "page_count": len(b.get("chips") or []),
                    }
                )
            if not books:
                # pre-migrate fallback
                books = list_books(BOOKS)
            return jsend(self, 200, {"ok": True, "books": books})

        if path == "/api/books/external":
            return jsend(
                self, 200, {"ok": True, "external": list_external_journals()}
            )

        # /api/config/<layout_key>/raw — place+pose+dressup paper for this host
        # Accept: book:nb-x · book_nb-x · sku bin_book-USER-nb-x
        if path.startswith("/api/config/") and path.endswith("/raw"):
            rest = unquote(path[len("/api/config/") :]).strip("/")
            if rest.endswith("/raw"):
                rest = rest[: -len("/raw")].strip("/")
            layout_key = rest
            if "__" in rest and ":" not in rest:
                layout_key = rest.replace("__", ":", 1)
            elif rest.startswith("bin_book-USER-"):
                layout_key = "book:" + rest[len("bin_book-USER-") :]
            elif rest.startswith("bin_folder-USER-"):
                layout_key = "folder:" + rest[len("bin_folder-USER-") :]
            elif rest.startswith("bin_board-USER-"):
                layout_key = "cork:" + rest[len("bin_board-USER-") :]
            elif "_" in rest and ":" not in rest and not rest.startswith("leaf_"):
                # book_nb-x.cfg stem style
                a, b = rest.split("_", 1)
                if a in ("book", "leaf", "folder", "cork", "board", "shelf"):
                    layout_key = f"{a}:{b}"
            cfg = read_place_config(SAFE, layout_key, DEFAULT_HOST)
            if not cfg:
                cp = config_path(SAFE, layout_key, DEFAULT_HOST)
                if not cp.is_file():
                    return jsend(self, 404, {"ok": False, "error": "config not found"})
                try:
                    text = cp.read_text(encoding="utf-8")
                except OSError as e:
                    return jsend(self, 500, {"ok": False, "error": str(e)})
                return jsend(
                    self,
                    200,
                    {
                        "ok": True,
                        "kind": "config",
                        "id": layout_key,
                        "path": str(cp.resolve()),
                        "file": cp.name,
                        "text": text,
                        "chars": len(text),
                    },
                )
            cp = Path(cfg["_path"])
            try:
                text = cp.read_text(encoding="utf-8")
            except OSError as e:
                return jsend(self, 500, {"ok": False, "error": str(e)})
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "kind": "config",
                    "id": cfg.get("ref") or layout_key,
                    "sku": cfg.get("sku") or "",
                    "path": str(cp.resolve()),
                    "file": cfg.get("_file"),
                    "text": text,
                    "chars": len(text),
                },
            )

        # /api/bin/<kind>/<id>/raw — full on-disk bin paper (store/bin/pin)
        if path.startswith("/api/bin/") and path.endswith("/raw"):
            parts = [p for p in path.split("/") if p]
            # api, bin, kind, id, raw
            if len(parts) >= 5:
                kind = unquote(parts[2])
                bid = unquote(parts[3])
                from user_store import bin_path as _bin_path

                bp = _bin_path(SAFE, kind, bid)
                if not bp or not bp.is_file():
                    return jsend(self, 404, {"ok": False, "error": "bin not found"})
                try:
                    text = bp.read_text(encoding="utf-8")
                except OSError as e:
                    return jsend(self, 500, {"ok": False, "error": str(e)})
                return jsend(
                    self,
                    200,
                    {
                        "ok": True,
                        "kind": kind,
                        "id": bid,
                        "path": str(bp.resolve()),
                        "file": bp.name,
                        "text": text,
                        "chars": len(text),
                    },
                )

        if path.startswith("/api/book/") and path.count("/") == 3:
            bid = unquote(path.split("/")[-1])
            # /api/book/<id>/raw → book bin paper
            if bid.endswith("/raw") or path.endswith("/raw"):
                bid = bid.replace("/raw", "").strip("/") or unquote(
                    path.rstrip("/").split("/")[-2]
                )
                from user_store import bin_path as _bin_path

                bp = _bin_path(SAFE, "book", bid)
                if bp and bp.is_file():
                    try:
                        text = bp.read_text(encoding="utf-8")
                    except OSError as e:
                        return jsend(self, 500, {"ok": False, "error": str(e)})
                    return jsend(
                        self,
                        200,
                        {
                            "ok": True,
                            "kind": "book",
                            "id": bid,
                            "path": str(bp.resolve()),
                            "file": bp.name,
                            "text": text,
                            "chars": len(text),
                        },
                    )
            b = read_bin(SAFE, "book", bid)
            if b:
                return jsend(self, 200, {"ok": True, "book": book_from_bin(SAFE, b)})
            p = bok_for_id(BOOKS, bid)
            if not p:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            return jsend(self, 200, {"ok": True, "book": read_book(p)})

        if path == "/api/layout":
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "layout": load_felt_layout(),
                    "path": str(LAYOUT_FILE),
                },
            )

        if path == "/api/corks":
            return jsend(self, 200, {"ok": True, "corks": list_corks(CORKS)})

        if path.startswith("/api/cork/") and path.count("/") == 3:
            cid = unquote(path.split("/")[-1])
            p = cork_path(CORKS, cid)
            if not p:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            c = read_cork(p)
            # enrich pins with leaf titles
            pins_out = []
            for lid in c.get("pins") or []:
                _, _, leaf = find_leaf(lid)
                pins_out.append(
                    {
                        "id": lid,
                        "title": (leaf or {}).get("title") or lid,
                        "missing": leaf is None,
                    }
                )
            c["pin_details"] = pins_out
            return jsend(self, 200, {"ok": True, "cork": c})

        if path == "/api/folders":
            folders = []
            for b in list_bins(SAFE, "folder"):
                folders.append(
                    {
                        "id": b["id"],
                        "title": b.get("title"),
                        "sheets": len(b.get("chips") or []),
                        "updated": b.get("updated") or 0,
                    }
                )
            if not folders:
                folders = list_folders(FOLDERS)
            return jsend(self, 200, {"ok": True, "folders": folders})

        if path.startswith("/api/folder/") and path.count("/") == 3:
            fid = unquote(path.split("/")[-1])
            b = read_bin(SAFE, "folder", fid)
            if b:
                f = folder_as_api(b)
            else:
                p = folder_path(FOLDERS, fid)
                if not p:
                    return jsend(self, 404, {"ok": False, "error": "not found"})
                f = read_folder(p)
            sheets_out = []
            for lid in (f or {}).get("sheets") or []:
                _, _, leaf = find_leaf(lid)
                sheets_out.append(
                    {
                        "id": lid,
                        "title": (leaf or {}).get("title") or lid,
                        "author": (leaf or {}).get("author") or "unknown",
                        "missing": leaf is None,
                    }
                )
            f["sheet_details"] = sheets_out
            return jsend(self, 200, {"ok": True, "folder": f})

        if path == "/api/shelves":
            return jsend(self, 200, {"ok": True, "shelves": list_shelves(SHELVES)})

        if path.startswith("/api/shelf/") and path.count("/") == 3:
            sid = unquote(path.split("/")[-1])
            p = shelf_path(SHELVES, sid)
            if not p:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            s = read_shelf(p)
            books_out = []
            for bid in s.get("books") or []:
                bb = read_bin(SAFE, "book", bid)
                book = book_from_bin(SAFE, bb) if bb else None
                if not book:
                    bp = bok_for_id(BOOKS, bid)
                    book = read_book(bp) if bp else None
                books_out.append(
                    {
                        "id": bid,
                        "title": (book or {}).get("title") or bid,
                        "cloth": (book or {}).get("cloth") or "oxblood",
                        "missing": book is None,
                    }
                )
            s["book_details"] = books_out
            return jsend(self, 200, {"ok": True, "shelf": s})

        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        ensure()
        path = urlparse(self.path).path
        body = read_json(self)

        if path in ("/api/leaf/spawn", "/api/scrap/spawn"):
            title = (body.get("title") or "untitled leaf").strip() or "untitled leaf"
            cloth = (body.get("cloth") or "oxblood").strip() or "oxblood"
            paper = (body.get("paper") or "lined").strip() or "lined"
            author = (body.get("author") or "unknown").strip() or "unknown"
            sc = new_leaf(title=title, cloth=cloth, author=author)
            sc["paper"] = paper
            sc["id"] = to_leaf_chip_id(sc["id"])
            write_leaf_chip(SAFE, sc)
            p = chip_path(SAFE, sc["id"])
            full = leaf_api_from_chip_file(p) if p else sc
            return jsend(self, 200, {"ok": True, "leaf": full, "scrap": full})

        if path == "/api/leaf/redline":
            # save a red-mark / unified-diff as its own chip (for agent handoff)
            target = to_leaf_chip_id((body.get("target_id") or body.get("leaf_id") or "").strip())
            diff_text = body.get("diff") or body.get("text") or ""
            note = (body.get("note") or "").strip()
            if not target:
                return jsend(self, 400, {"ok": False, "error": "target_id required"})
            if not str(diff_text).strip():
                return jsend(self, 400, {"ok": False, "error": "empty diff"})
            t = int(__import__("time").time())
            rid = f"leaf_red_{t}"
            title = (body.get("title") or f"redline · {target}").strip()
            body_md = (
                f"# redline\n\n"
                f"target: `{target}`\n\n"
                f"{note + chr(10) + chr(10) if note else ''}"
                f"```diff\n{diff_text.rstrip()}\n```\n"
            )
            leaf = {
                "id": rid,
                "title": title,
                "author": (body.get("author") or "red-pen").strip() or "red-pen",
                "cloth": "oxblood",
                "paper": "plain",
                "stamps": ["urgent"],
                "body": body_md,
                "folder": "",
                "boards": [],
                "created": t,
            }
            write_leaf_chip(SAFE, leaf)
            p = chip_path(SAFE, rid)
            full = leaf_api_from_chip_file(p) if p else leaf
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "leaf": full,
                    "path": full.get("_path") if full else None,
                },
            )

        if path in ("/api/leaf/save", "/api/scrap/save"):
            sc = body.get("leaf") or body.get("scrap") or body
            if not sc.get("id"):
                return jsend(self, 400, {"ok": False, "error": "id required"})
            sc["id"] = to_leaf_chip_id(str(sc["id"]))
            write_leaf_chip(SAFE, sc)
            p = chip_path(SAFE, sc["id"])
            full = leaf_api_from_chip_file(p) if p else sc
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "leaf": full,
                    "scrap": full,
                    "chars": len(full.get("body") or ""),
                    "file": full.get("_file"),
                },
            )

        if path == "/api/book/spawn":
            title = (body.get("title") or "untitled").strip() or "untitled"
            cloth = (body.get("cloth") or "oxblood").strip() or "oxblood"
            author = (body.get("author") or "unknown").strip() or "unknown"
            nb = new_book(title=title, cloth=cloth, author=author)
            full = save_book_as_bin(SAFE, nb)
            return jsend(self, 200, {"ok": True, "book": full})

        if path == "/api/book/save":
            nb = body.get("book") or body
            if not nb.get("id"):
                return jsend(self, 400, {"ok": False, "error": "id required"})
            full = save_book_as_bin(SAFE, nb)
            n = len(full.get("pages") or [])
            return jsend(self, 200, {"ok": True, "book": full, "pages": n})

        if path == "/api/book/import":
            # import from pocket journal/notebook by filesystem path or id+source
            src_path = (body.get("path") or "").strip()
            if not src_path:
                return jsend(self, 400, {"ok": False, "error": "path required"})
            src = Path(src_path)
            # safety: only under ALICE_BOX my-pocket-things
            try:
                # recv_sys → prod → receiver → the-deck-host → ALICE_BOX
                alice = Path(__file__).resolve().parents[4]
                src.resolve().relative_to((alice / "my-pocket-things").resolve())
            except Exception:
                return jsend(
                    self, 403, {"ok": False, "error": "import only from my-pocket-things"}
                )
            b = import_bok(src, BOOKS)
            if not b:
                return jsend(self, 400, {"ok": False, "error": "could not import"})
            return jsend(self, 200, {"ok": True, "book": b})

        if path == "/api/layout":
            objects = body.get("layout") or body.get("objects") or body
            if not isinstance(objects, dict):
                return jsend(self, 400, {"ok": False, "error": "layout object required"})
            # strip accidental non-object keys
            clean = {
                k: v
                for k, v in objects.items()
                if isinstance(k, str) and isinstance(v, dict)
            }
            save_felt_layout(clean)
            return jsend(self, 200, {"ok": True, "n": len(clean), "path": str(LAYOUT_FILE)})

        if path == "/api/cork/spawn":
            title = (body.get("title") or "corkboard").strip() or "corkboard"
            c = new_cork(title=title)
            write_cork(CORKS, c)
            p = cork_path(CORKS, c["id"])
            return jsend(self, 200, {"ok": True, "cork": read_cork(p) if p else c})

        if path == "/api/cork/save":
            c = body.get("cork") or body
            if not c.get("id"):
                return jsend(self, 400, {"ok": False, "error": "id required"})
            write_cork(CORKS, c)
            p = cork_path(CORKS, c["id"])
            return jsend(self, 200, {"ok": True, "cork": read_cork(p) if p else c})

        if path == "/api/cork/pin":
            # pin leaf to cork — update both sides
            cid = (body.get("cork_id") or "").strip()
            lid = (body.get("leaf_id") or "").strip()
            if not cid or not lid:
                return jsend(self, 400, {"ok": False, "error": "cork_id and leaf_id"})
            cp = cork_path(CORKS, cid)
            if not cp:
                return jsend(self, 404, {"ok": False, "error": "cork not found"})
            root, lp, leaf = find_leaf(lid)
            if not leaf:
                return jsend(self, 404, {"ok": False, "error": "leaf not found"})
            cork = read_cork(cp)
            pins = list(cork.get("pins") or [])
            if lid not in pins:
                pins.append(lid)
            cork["pins"] = pins
            write_cork(CORKS, cork)
            boards = list(leaf.get("boards") or [])
            if cid not in boards:
                boards.append(cid)
            leaf["boards"] = boards
            write_leaf(root, leaf)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "cork": read_cork(cp),
                    "leaf": read_leaf(lp),
                },
            )

        if path == "/api/cork/unpin":
            cid = (body.get("cork_id") or "").strip()
            lid = (body.get("leaf_id") or "").strip()
            if not cid or not lid:
                return jsend(self, 400, {"ok": False, "error": "cork_id and leaf_id"})
            cp = cork_path(CORKS, cid)
            if not cp:
                return jsend(self, 404, {"ok": False, "error": "cork not found"})
            cork = read_cork(cp)
            cork["pins"] = [p for p in (cork.get("pins") or []) if p != lid]
            write_cork(CORKS, cork)
            root, lp, leaf = find_leaf(lid)
            if leaf and root:
                leaf["boards"] = [b for b in (leaf.get("boards") or []) if b != cid]
                write_leaf(root, leaf)
            return jsend(self, 200, {"ok": True, "cork": read_cork(cp)})

        if path == "/api/folder/spawn":
            title = (body.get("title") or "folder").strip() or "folder"
            f = new_folder(title=title)
            write_bin(
                SAFE,
                "folder",
                {
                    "id": f["id"],
                    "title": f["title"],
                    "chips": [],
                    "created": f.get("created"),
                    "bud": f["title"],
                },
            )
            b = read_bin(SAFE, "folder", f["id"])
            return jsend(self, 200, {"ok": True, "folder": folder_as_api(b)})

        if path == "/api/folder/save":
            f = body.get("folder") or body
            if not f.get("id"):
                return jsend(self, 400, {"ok": False, "error": "id required"})
            chips = f.get("sheets") or f.get("chips") or []
            write_bin(
                SAFE,
                "folder",
                {
                    "id": f["id"],
                    "title": f.get("title") or "folder",
                    "chips": chips,
                    "created": f.get("created"),
                    "body": f.get("body") or "",
                    "bud": f.get("title") or "folder",
                },
            )
            b = read_bin(SAFE, "folder", f["id"])
            return jsend(self, 200, {"ok": True, "folder": folder_as_api(b)})

        if path == "/api/folder/file":
            # put leaf chip into folder bin — off the felt
            fid = (body.get("folder_id") or "").strip()
            lid = to_leaf_chip_id((body.get("leaf_id") or "").strip())
            if not fid or not lid:
                return jsend(
                    self, 400, {"ok": False, "error": "folder_id and leaf_id"}
                )
            folder_b = read_bin(SAFE, "folder", fid)
            if not folder_b:
                return jsend(self, 404, {"ok": False, "error": "folder not found"})
            _, _, leaf = find_leaf(lid)
            if not leaf:
                return jsend(self, 404, {"ok": False, "error": "leaf not found"})
            old_fid = (leaf.get("folder") or "").strip()
            if old_fid and old_fid != fid:
                ob = read_bin(SAFE, "folder", old_fid)
                if ob:
                    ob["chips"] = [s for s in (ob.get("chips") or []) if s != lid]
                    write_bin(SAFE, "folder", {**ob, "sheets": ob["chips"]})
            chips = list(folder_b.get("chips") or [])
            if lid not in chips:
                chips.append(lid)
            write_bin(
                SAFE,
                "folder",
                {
                    **folder_b,
                    "chips": chips,
                    "title": folder_b.get("title"),
                },
            )
            leaf["folder"] = fid
            write_leaf_chip(SAFE, leaf)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "folder": folder_as_api(read_bin(SAFE, "folder", fid)),
                    "leaf": leaf_api_from_chip_file(chip_path(SAFE, lid)),
                },
            )

        if path == "/api/folder/unfile":
            fid = (body.get("folder_id") or "").strip()
            lid = to_leaf_chip_id((body.get("leaf_id") or "").strip())
            if not lid:
                return jsend(self, 400, {"ok": False, "error": "leaf_id required"})
            _, _, leaf = find_leaf(lid)
            if not leaf:
                return jsend(self, 404, {"ok": False, "error": "leaf not found"})
            use_fid = fid or (leaf.get("folder") or "").strip()
            if use_fid:
                fb = read_bin(SAFE, "folder", use_fid)
                if fb:
                    fb["chips"] = [s for s in (fb.get("chips") or []) if s != lid]
                    write_bin(SAFE, "folder", {**fb, "sheets": fb["chips"]})
            leaf["folder"] = ""
            write_leaf_chip(SAFE, leaf)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "leaf": leaf_api_from_chip_file(chip_path(SAFE, lid)),
                    "folder_id": use_fid or None,
                },
            )

        if path == "/api/folder/delete":
            fid = (body.get("folder_id") or body.get("id") or "").strip()
            if not fid:
                return jsend(self, 400, {"ok": False, "error": "folder_id required"})
            fb = read_bin(SAFE, "folder", fid)
            if not fb:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            released = list(fb.get("chips") or [])
            for lid in released:
                _, _, leaf = find_leaf(lid)
                if leaf:
                    leaf["folder"] = ""
                    write_leaf_chip(SAFE, leaf)
            delete_bin(SAFE, "folder", fid)
            return jsend(self, 200, {"ok": True, "released": released})

        if path in ("/api/leaf/delete", "/api/scrap/delete"):
            lid = to_leaf_chip_id((body.get("leaf_id") or body.get("id") or "").strip())
            if not lid:
                return jsend(self, 400, {"ok": False, "error": "id required"})
            for b in list_bins(SAFE, "folder"):
                if lid in (b.get("chips") or []):
                    b["chips"] = [s for s in b["chips"] if s != lid]
                    write_bin(SAFE, "folder", {**b, "sheets": b["chips"]})
            for b in list_bins(SAFE, "book"):
                if lid in (b.get("chips") or []):
                    b["chips"] = [s for s in b["chips"] if s != lid]
                    write_bin(SAFE, "book", b)
            if not delete_leaf_chip(SAFE, lid):
                # legacy
                ok = False
                for root in all_leaf_dirs():
                    if delete_leaf(root, lid):
                        ok = True
                        break
                if not ok:
                    return jsend(self, 404, {"ok": False, "error": "not found"})
            return jsend(self, 200, {"ok": True})

        if path == "/api/book/file":
            # put loose leaf chip into book bin (ordered list)
            bid = (body.get("book_id") or "").strip()
            lid = to_leaf_chip_id((body.get("leaf_id") or "").strip())
            if not bid or not lid:
                return jsend(
                    self, 400, {"ok": False, "error": "book_id and leaf_id"}
                )
            bb = read_bin(SAFE, "book", bid)
            if not bb:
                return jsend(self, 404, {"ok": False, "error": "book not found"})
            _, _, leaf = find_leaf(lid)
            if not leaf:
                return jsend(self, 404, {"ok": False, "error": "leaf not found"})
            # leave folder if any
            old_fid = (leaf.get("folder") or "").strip()
            if old_fid:
                fb = read_bin(SAFE, "folder", old_fid)
                if fb:
                    fb["chips"] = [s for s in (fb.get("chips") or []) if s != lid]
                    write_bin(SAFE, "folder", {**fb, "sheets": fb["chips"]})
                leaf["folder"] = ""
                write_leaf_chip(SAFE, leaf)
            # remove from other books
            for other in list_bins(SAFE, "book"):
                if other["id"] == bid:
                    continue
                if lid in (other.get("chips") or []):
                    other["chips"] = [s for s in other["chips"] if s != lid]
                    write_bin(SAFE, "book", other)
            chips = list(bb.get("chips") or [])
            if lid not in chips:
                chips.append(lid)
            write_bin(SAFE, "book", {**bb, "chips": chips})
            full = book_from_bin(SAFE, read_bin(SAFE, "book", bid))
            return jsend(self, 200, {"ok": True, "book": full, "leaf_id": lid})

        if path == "/api/book/unfile":
            # take chip out of book → loose (felt)
            bid = (body.get("book_id") or "").strip()
            lid = to_leaf_chip_id((body.get("leaf_id") or "").strip())
            if not lid:
                return jsend(self, 400, {"ok": False, "error": "leaf_id required"})
            if bid:
                bb = read_bin(SAFE, "book", bid)
                if bb:
                    bb["chips"] = [s for s in (bb.get("chips") or []) if s != lid]
                    write_bin(SAFE, "book", bb)
            else:
                for bb in list_bins(SAFE, "book"):
                    if lid in (bb.get("chips") or []):
                        bb["chips"] = [s for s in bb["chips"] if s != lid]
                        write_bin(SAFE, "book", bb)
            _, _, leaf = find_leaf(lid)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "leaf": leaf,
                    "book_id": bid or None,
                },
            )

        if path == "/api/book/delete":
            bid = (body.get("book_id") or body.get("id") or "").strip()
            if not bid:
                return jsend(self, 400, {"ok": False, "error": "id required"})
            for row in list_shelves(SHELVES):
                sp = shelf_path(SHELVES, row["id"])
                if not sp:
                    continue
                sh = read_shelf(sp)
                if sh and bid in (sh.get("books") or []):
                    sh["books"] = [b for b in sh["books"] if b != bid]
                    write_shelf(SHELVES, sh)
            if not delete_bin(SAFE, "book", bid):
                if not delete_book(BOOKS, bid):
                    return jsend(self, 404, {"ok": False, "error": "not found"})
            return jsend(self, 200, {"ok": True})

        if path == "/api/shelf/spawn":
            title = (body.get("title") or "shelf").strip() or "shelf"
            s = new_shelf(title=title)
            write_shelf(SHELVES, s)
            p = shelf_path(SHELVES, s["id"])
            return jsend(
                self, 200, {"ok": True, "shelf": read_shelf(p) if p else s}
            )

        if path == "/api/shelf/save":
            s = body.get("shelf") or body
            if not s.get("id"):
                return jsend(self, 400, {"ok": False, "error": "id required"})
            write_shelf(SHELVES, s)
            p = shelf_path(SHELVES, s["id"])
            return jsend(
                self, 200, {"ok": True, "shelf": read_shelf(p) if p else s}
            )

        if path == "/api/shelf/shelve":
            sid = (body.get("shelf_id") or "").strip()
            bid = (body.get("book_id") or "").strip()
            if not sid or not bid:
                return jsend(
                    self, 400, {"ok": False, "error": "shelf_id and book_id"}
                )
            sp = shelf_path(SHELVES, sid)
            if not sp:
                return jsend(self, 404, {"ok": False, "error": "shelf not found"})
            bp = bok_for_id(BOOKS, bid)
            if not bp:
                return jsend(self, 404, {"ok": False, "error": "book not found"})
            book = read_book(bp)
            if not book:
                return jsend(self, 404, {"ok": False, "error": "book not found"})
            old = (book.get("shelf") or "").strip()
            if old and old != sid:
                op = shelf_path(SHELVES, old)
                if op:
                    osh = read_shelf(op)
                    if osh:
                        osh["books"] = [
                            b for b in (osh.get("books") or []) if b != bid
                        ]
                        write_shelf(SHELVES, osh)
            shelf = read_shelf(sp)
            books = list(shelf.get("books") or [])
            if bid not in books:
                books.append(bid)
            shelf["books"] = books
            write_shelf(SHELVES, shelf)
            book["shelf"] = sid
            write_book(BOOKS, book)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "shelf": read_shelf(sp),
                    "book": read_book(bp),
                },
            )

        if path == "/api/shelf/unshelve":
            sid = (body.get("shelf_id") or "").strip()
            bid = (body.get("book_id") or "").strip()
            if not bid:
                return jsend(self, 400, {"ok": False, "error": "book_id required"})
            bp = bok_for_id(BOOKS, bid)
            if not bp:
                return jsend(self, 404, {"ok": False, "error": "book not found"})
            book = read_book(bp)
            if not book:
                return jsend(self, 404, {"ok": False, "error": "book not found"})
            use_sid = sid or (book.get("shelf") or "").strip()
            if use_sid:
                sp = shelf_path(SHELVES, use_sid)
                if sp:
                    shelf = read_shelf(sp)
                    if shelf:
                        shelf["books"] = [
                            b for b in (shelf.get("books") or []) if b != bid
                        ]
                        write_shelf(SHELVES, shelf)
            book["shelf"] = ""
            write_book(BOOKS, book)
            return jsend(
                self,
                200,
                {
                    "ok": True,
                    "book": read_book(bp),
                    "shelf_id": use_sid or None,
                },
            )

        if path == "/api/shelf/delete":
            sid = (body.get("shelf_id") or body.get("id") or "").strip()
            if not sid:
                return jsend(self, 400, {"ok": False, "error": "shelf_id required"})
            sp = shelf_path(SHELVES, sid)
            if not sp:
                return jsend(self, 404, {"ok": False, "error": "not found"})
            shelf = read_shelf(sp)
            released = list(shelf.get("books") or [])
            for bid in released:
                bp = bok_for_id(BOOKS, bid)
                if bp:
                    book = read_book(bp)
                    if book:
                        book["shelf"] = ""
                        write_book(BOOKS, book)
            delete_shelf(SHELVES, sid)
            return jsend(self, 200, {"ok": True, "released": released})

        return jsend(self, 404, {"ok": False, "error": "not found"})


def main() -> None:
    ensure()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Receiver · http://{HOST}:{PORT}/  sku={SKU}")
    print(f"  leaves={LEAVES}")
    print(f"  books={BOOKS}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
