"""
Receiver USER materials — urgent memo + architecture topology (literal paths).

  safe_box/USER/chips/<class>_<id>.chip     ← matter (content atoms)
  safe_box/USER/bins/<kind>/….bin           ← membership only
  safe_box/USER/configs/<host>/….cfg        ← pose + dressup for THIS surface

Chip class is on the id prefix (leaf_, later snap_, …). Bins list chip ids.
Config is how this host wears a chip/bin (x/y/open/scale/page + dressup).
myPI rhyme: sky/skin vs room/placement — here two *sections* in one .cfg (focus).
"""

from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

from papers import parse_frontmatter, slugify

# ── paths (relative to safe_box) ─────────────────────────────────

USER_DIRNAME = "USER"
CHIPS_DIR = "chips"
BINS_DIR = "bins"
CONFIGS_DIR = "configs"
DEFAULT_HOST = "receiver"
BIN_KINDS = ("book", "folder", "board")
MIGRATE_FLAG = ".migrated_urgent_memo_v1"
CONFIGS_FLAG = ".migrated_configs_v1"
MAUSOLEUM = "_mausoleum_pre_user"


def now() -> int:
    return int(time.time())


def user_root(safe: Path) -> Path:
    return safe / USER_DIRNAME


def chips_root(safe: Path) -> Path:
    return user_root(safe) / CHIPS_DIR


def bins_root(safe: Path, kind: str) -> Path:
    k = kind if kind in BIN_KINDS else "folder"
    return user_root(safe) / BINS_DIR / k


def configs_root(safe: Path, host: str = DEFAULT_HOST) -> Path:
    return user_root(safe) / CONFIGS_DIR / (host or DEFAULT_HOST)


def ensure_user_tree(safe: Path) -> None:
    chips_root(safe).mkdir(parents=True, exist_ok=True)
    for k in BIN_KINDS:
        bins_root(safe, k).mkdir(parents=True, exist_ok=True)
    configs_root(safe, DEFAULT_HOST).mkdir(parents=True, exist_ok=True)


# ── surface configs (pose + dressup) — architecture page 5 ───────

_KEY_ORDER_PLACE = ("host", "ref", "kind")
_KEY_ORDER_POSE = (
    "x",
    "y",
    "open",
    "openW",
    "openH",
    "w",
    "h",
    "pageIdx",
    "termW",
    "termH",
)


def parse_layout_key(layout_key: str) -> tuple[str, str]:
    """book:nb-1 → ('book', 'nb-1')."""
    s = str(layout_key or "")
    if ":" in s:
        a, b = s.split(":", 1)
        return a.strip(), b.strip()
    return "", s.strip()


def make_layout_key(kind: str, obj_id: str) -> str:
    return f"{kind}:{obj_id}"


def layout_key_to_filename(layout_key: str) -> str:
    """book:nb-1 → book_nb-1.cfg (no colon, no quotes in the name)."""
    kind, oid = parse_layout_key(layout_key)
    if kind and oid:
        base = f"{kind}_{oid}"
    else:
        base = re.sub(r"[^\w.-]+", "_", layout_key)
    base = re.sub(r"[^\w.-]+", "_", base)
    return base + ".cfg"


def config_path(safe: Path, layout_key: str, host: str = DEFAULT_HOST) -> Path:
    return configs_root(safe, host) / layout_key_to_filename(layout_key)


def sku_for_layout_key(safe: Path, layout_key: str) -> str:
    """
    Pack fetch id (Hands redline: no USER segment in sku):
      book  → bin_book-<id>
      leaf  → chip id
      folder/board → bin_<kind>-<id>
    """
    kind, oid = parse_layout_key(layout_key)
    if kind == "book":
        b = read_bin(safe, "book", oid)
        if b and b.get("sku"):
            return str(b["sku"]).replace("-USER-", "-")
        return f"bin_book-{oid}"
    if kind == "folder":
        b = read_bin(safe, "folder", oid)
        if b and b.get("sku"):
            return str(b["sku"]).replace("-USER-", "-")
        return f"bin_folder-{oid}"
    if kind in ("cork", "board"):
        b = read_bin(safe, "board", oid)
        if b and b.get("sku"):
            return str(b["sku"]).replace("-USER-", "-")
        return f"bin_board-{oid}"
    if kind == "leaf":
        return oid if oid.startswith("leaf_") else to_leaf_chip_id(oid)
    if kind == "shelf":
        return f"shelf-{oid}"
    return oid or layout_key


def write_place_config(
    safe: Path,
    layout_key: str,
    pose: dict[str, Any],
    dressup: dict[str, Any] | None = None,
    host: str = DEFAULT_HOST,
    kind: str = "",
    pages: dict[str, Any] | None = None,
) -> Path:
    """
    Surface config paper (Hands redline):
      surface: host, type, subtype, sku, config_id
      pose: x/y/open/scale/page
      dressup: how THIS host wears the sku
      pages: optional { chip_id: { style, shell } } — page dress inside a book bin
    """
    ensure_user_tree(safe)
    host = host or DEFAULT_HOST
    lk_kind, lk_id = parse_layout_key(layout_key)
    place_kind = lk_kind or kind or ""
    if place_kind in ("notebook",):
        place_kind = "book"
    obj_id = lk_id or ""
    pose_block = _clean_pose_for_paper(pose if isinstance(pose, dict) else {})
    sku = sku_for_layout_key(safe, layout_key)
    # surface type: bin vs chip
    if place_kind == "leaf":
        surf_type, surf_sub = "chip", "leaf"
    elif place_kind in ("book", "folder", "board", "cork"):
        surf_type = "bin"
        surf_sub = "board" if place_kind == "cork" else place_kind
    else:
        surf_type, surf_sub = "bin", place_kind or "unknown"
    path = config_path(safe, layout_key, host)
    # config_id = actual filename stem (no fake ideal hash while file is book_nb-x.cfg)
    config_id = path.stem
    surface_block: dict[str, Any] = {
        "host": host,
        "type": surf_type,
        "subtype": surf_sub,
        "sku": sku,
        "config_id": config_id,
    }
    sections: dict[str, Any] = {
        "surface": surface_block,
        "pose": pose_block,
    }
    if isinstance(dressup, dict) and dressup:
        du: dict[str, Any] = {}
        for k in ("style", "shell", "class"):
            if dressup.get(k) is not None and dressup.get(k) != "":
                du[k] = dressup[k]
        for k, v in dressup.items():
            if k not in du and v is not None and v != "":
                du[k] = v
        if du:
            sections["dressup"] = du
    # page dress map: one nested layer as JSON object (parser is 2-level)
    if isinstance(pages, dict) and pages:
        sections["pages"] = pages
    elif isinstance(pose.get("pages"), dict) and pose.get("pages"):
        sections["pages"] = pose["pages"]
    for legacy_name in (
        layout_key.replace(":", "__") + ".cfg",
        f"{place_kind}__{obj_id}.cfg",
    ):
        legacy = configs_root(safe, host) / legacy_name
        if legacy.is_file() and legacy.resolve() != path.resolve():
            try:
                legacy.unlink()
            except OSError:
                pass
    path.write_text(dump_nested_fm(sections, ""), encoding="utf-8")
    return path


def read_place_config(
    safe: Path, layout_key: str, host: str = DEFAULT_HOST
) -> dict[str, Any] | None:
    path = config_path(safe, layout_key, host)
    if not path.is_file():
        for legacy_name in (
            layout_key.replace(":", "__") + ".cfg",
            layout_key_to_filename(layout_key),
        ):
            legacy = configs_root(safe, host) / legacy_name
            if legacy.is_file():
                path = legacy
                break
        else:
            return None
    meta, body = parse_nested_fm(path.read_text(encoding="utf-8"))
    surface = meta.get("surface") if isinstance(meta.get("surface"), dict) else {}
    place = meta.get("place") if isinstance(meta.get("place"), dict) else {}
    pose = meta.get("pose") if isinstance(meta.get("pose"), dict) else {}
    dress = meta.get("dressup") if isinstance(meta.get("dressup"), dict) else {}
    pages = meta.get("pages")
    if isinstance(pages, str):
        try:
            pages = json.loads(pages)
        except json.JSONDecodeError:
            pages = {}
    # rebuild layout key
    if surface:
        sub = str(surface.get("subtype") or "")
        sku_val = str(surface.get("sku") or "")
        if sub == "book" and sku_val.startswith("bin_book-"):
            ref = "book:" + sku_val[len("bin_book-") :].replace("USER-", "")
        elif sub == "folder" and "folder-" in sku_val:
            ref = "folder:" + sku_val.split("folder-")[-1].replace("USER-", "")
        elif place.get("id"):
            ref = make_layout_key(str(place.get("kind") or sub), str(place["id"]))
        else:
            ref = layout_key
        sku = sku_val
    else:
        pk = str(place.get("kind") or "")
        pid = str(place.get("id") or "")
        if pk == "notebook":
            pk = "book"
        ref = make_layout_key(pk, pid) if pk and pid else layout_key
        sku = place.get("sku") or ""
    return {
        "surface": surface or None,
        "place": place or None,
        "pose": pose,
        "dressup": dress or None,
        "pages": pages if isinstance(pages, dict) else {},
        "body": body or "",
        "_path": str(path.resolve()),
        "_file": path.name,
        "ref": ref,
        "sku": sku,
    }


def layout_from_configs(safe: Path, host: str = DEFAULT_HOST) -> dict[str, Any]:
    """Build felt_layout-style objects map from config papers."""
    root = configs_root(safe, host)
    out: dict[str, Any] = {}
    if not root.is_dir():
        return out
    for p in root.glob("*.cfg"):
        meta, _ = parse_nested_fm(p.read_text(encoding="utf-8"))
        surface = meta.get("surface") if isinstance(meta.get("surface"), dict) else {}
        place = meta.get("place") if isinstance(meta.get("place"), dict) else {}
        pose = meta.get("pose") if isinstance(meta.get("pose"), dict) else {}
        dress = meta.get("dressup") if isinstance(meta.get("dressup"), dict) else {}
        pages = meta.get("pages")
        if isinstance(pages, str):
            try:
                pages = json.loads(pages)
            except json.JSONDecodeError:
                pages = None
        ref = None
        if surface:
            sub = str(surface.get("subtype") or "")
            sku_val = str(surface.get("sku") or "").replace("-USER-", "-")
            if sub == "book" and sku_val.startswith("bin_book-"):
                ref = "book:" + sku_val[len("bin_book-") :]
            elif sub == "folder" and sku_val.startswith("bin_folder-"):
                ref = "folder:" + sku_val[len("bin_folder-") :]
            elif sub in ("board", "cork") and sku_val.startswith("bin_board-"):
                ref = "cork:" + sku_val[len("bin_board-") :]
            elif sub == "leaf" and sku_val:
                ref = "leaf:" + sku_val
        if not ref and place:
            pk = str(place.get("kind") or "")
            pid = str(place.get("id") or "")
            if pk == "notebook":
                pk = "book"
            if pk and pid:
                ref = make_layout_key(pk, pid)
        if not ref:
            stem = p.stem
            if "_" in stem:
                a, b = stem.split("_", 1)
                ref = make_layout_key(a, b)
            else:
                continue
        entry = dict(pose)
        entry.pop("kind", None)
        if dress:
            entry["dressup"] = dress
        if isinstance(pages, dict) and pages:
            entry["pages"] = pages
        pk = parse_layout_key(ref)[0]
        if pk == "book":
            entry["kind"] = "notebook"
        elif pk:
            entry["kind"] = "corkboard" if pk == "cork" else pk
        sku_out = (surface or {}).get("sku") or (place or {}).get("sku")
        if sku_out:
            entry["sku"] = str(sku_out).replace("-USER-", "-")
        out[str(ref)] = entry
    return out


def _clean_pose_for_paper(pose: dict[str, Any]) -> dict[str, Any]:
    """
    Pose law (no redundant openW/H vs w/h when they mean the same thing):
      always: x, y, open
      if open: openW, openH  (last open scale — restore target)
      if closed: w, h for closed face; keep openW/openH if known for next open
    Never invent 'legacy' keys. Never duplicate equal pairs as four numbers.
    """
    out: dict[str, Any] = {}
    for k in ("x", "y"):
        if k in pose and pose[k] is not None and pose[k] != "":
            out[k] = pose[k]
    is_open = bool(pose.get("open"))
    out["open"] = is_open
    ow = pose.get("openW")
    oh = pose.get("openH")
    w = pose.get("w")
    h = pose.get("h")
    # prefer open* for the "last open scale"; fill from w/h if missing
    if ow is None and w is not None and (is_open or (isinstance(w, (int, float)) and w >= 280)):
        ow = w
    if oh is None and h is not None and (is_open or (isinstance(h, (int, float)) and h >= 220)):
        oh = h
    if ow is not None:
        out["openW"] = ow
    if oh is not None:
        out["openH"] = oh
    if not is_open:
        # closed face size only when actually closed / small
        if w is not None:
            out["w"] = w
        if h is not None:
            out["h"] = h
    # else open: do not also write w/h when they match openW/H
    else:
        if w is not None and ow is not None and w != ow:
            out["w"] = w
        if h is not None and oh is not None and h != oh:
            out["h"] = h
    if pose.get("pageIdx") is not None and pose.get("pageIdx") != "":
        out["pageIdx"] = pose["pageIdx"]
    if pose.get("termW") is not None:
        out["termW"] = pose["termW"]
    if pose.get("termH") is not None:
        out["termH"] = pose["termH"]
    return out


def save_layout_as_configs(
    safe: Path,
    objects: dict[str, Any],
    host: str = DEFAULT_HOST,
) -> int:
    """Write each layout object to its config paper. Returns count."""
    n = 0
    _pose_skip = frozenset({"dressup", "kind", "sku", "pages"})
    for key, pose in (objects or {}).items():
        if not isinstance(key, str) or not isinstance(pose, dict):
            continue
        dress = pose.get("dressup") if isinstance(pose.get("dressup"), dict) else None
        pages = pose.get("pages") if isinstance(pose.get("pages"), dict) else None
        raw_pose = {k: v for k, v in pose.items() if k not in _pose_skip}
        pose_only = _clean_pose_for_paper(raw_pose)
        kind = str(pose.get("kind") or key.split(":", 1)[0])
        # books: ensure dressup on config (wear lives here — never "legacy skip")
        if key.startswith("book:") and not dress:
            oid = key.split(":", 1)[-1]
            b = read_bin(safe, "book", oid)
            if b and b.get("dressup"):
                dress = b["dressup"]
            elif b and b.get("cloth"):
                dress = {"style": "bookbox", "shell": b.get("cloth") or "oxblood"}
            else:
                dress = {"style": "bookbox", "shell": "oxblood"}
        write_place_config(
            safe,
            key,
            pose_only,
            dressup=dress,
            host=host,
            kind=kind,
            pages=pages,
        )
        n += 1
    return n


def migrate_layout_and_dress_to_configs(
    safe: Path,
    layout_file: Path,
    host: str = DEFAULT_HOST,
) -> dict[str, Any]:
    """
    One-shot: felt_layout.json → USER/configs/receiver/*.cfg
    Pull dressup off bins into the matching book: config when present.
    """
    ensure_user_tree(safe)
    flag = configs_root(safe, host) / CONFIGS_FLAG
    report: dict[str, Any] = {"configs": 0, "dress_from_bins": 0, "errors": []}
    objects: dict[str, Any] = {}
    if layout_file.is_file():
        try:
            data = json.loads(layout_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("objects"), dict):
                objects = data["objects"]
            elif isinstance(data, dict):
                objects = {
                    k: v
                    for k, v in data.items()
                    if isinstance(v, dict) and ":" in k
                }
        except Exception as e:
            report["errors"].append(f"layout read: {e}")

    # merge dressup from bins into book: keys
    for b in list_bins(safe, "book"):
        key = "book:" + str(b["id"])
        entry = dict(objects.get(key) or {})
        if b.get("dressup") and not entry.get("dressup"):
            entry["dressup"] = b["dressup"]
            report["dress_from_bins"] += 1
        if b.get("cloth") and not (entry.get("dressup") or {}).get("shell"):
            du = dict(entry.get("dressup") or {})
            du.setdefault("style", "bookbox")
            du.setdefault("shell", b.get("cloth") or "oxblood")
            entry["dressup"] = du
        if "kind" not in entry:
            entry["kind"] = "notebook"
        objects[key] = entry

    for b in list_bins(safe, "folder"):
        key = "folder:" + str(b["id"])
        entry = dict(objects.get(key) or {})
        if "kind" not in entry:
            entry["kind"] = "folder"
        if b.get("dressup"):
            entry.setdefault("dressup", b["dressup"])
        objects[key] = entry

    for b in list_bins(safe, "board"):
        key = "cork:" + str(b["id"])  # layout uses cork: sometimes
        # also try board:
        for ktry in (key, "board:" + str(b["id"])):
            if ktry in objects or ktry.startswith("cork:"):
                entry = dict(objects.get(ktry) or objects.get(key) or {})
                if "kind" not in entry:
                    entry["kind"] = "corkboard"
                objects[ktry if ktry in objects else key] = entry
                break
        else:
            objects[key] = {"kind": "corkboard", "open": False}

    report["configs"] = save_layout_as_configs(safe, objects, host=host)
    try:
        flag.write_text(
            json.dumps({"migrated_at": now(), "report": report}, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as e:
        report["errors"].append(str(e))
    return report


# ── nested frontmatter (chip: / pin: / store: / bin:) ────────────

def parse_nested_fm(text: str) -> tuple[dict[str, Any], str]:
    """Parse flat or 2-level indented YAML-ish frontmatter."""
    raw = text.replace("\r\n", "\n")
    if not raw.startswith("---\n"):
        return {}, raw
    end = raw.find("\n---\n", 4)
    if end < 0:
        return {}, raw
    block = raw[4:end]
    body = raw[end + 5 :]
    if body.startswith("\n"):
        body = body[1:]
    meta: dict[str, Any] = {}
    section: str | None = None
    for line in block.split("\n"):
        if not line.strip():
            continue
        # section header "chip:"
        if re.match(r"^[a-zA-Z_][\w]*:\s*$", line):
            section = line.split(":", 1)[0].strip()
            meta[section] = {}
            continue
        # indented key under section
        m = re.match(r"^  ([a-zA-Z_][\w]*)\s*:\s*(.*)$", line)
        if m and section:
            k, v = m.group(1), m.group(2).strip()
            meta[section][k] = _coerce_val(v)
            continue
        # flat key
        if ":" in line and not line.startswith(" "):
            section = None
            k, v = line.split(":", 1)
            meta[k.strip()] = _coerce_val(v.strip())
    return meta, body


def _coerce_val(v: str) -> Any:
    if v.startswith('"') and v.endswith('"'):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return v[1:-1]
    if v.startswith("[") or v.startswith("{"):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            pass
    if v.isdigit() or (v.startswith("-") and v[1:].isdigit()):
        return int(v)
    if v in ("true", "false"):
        return v == "true"
    return v


# Intentional field order (Hands: related keys stay adjacent; no "JSON append at end")
_SECTION_ORDER = (
    "store",
    "chip",
    "bin",
    "pin",
    "surface",
    "place",  # legacy alias
    "pose",
    "dressup",
    "pages",  # page dress map nested under book config (JSON object)
)
_KEY_ORDER: dict[str, tuple[str, ...]] = {
    "store": ("sku", "type", "subtype", "bit_count"),
    "chip": ("id", "auth", "bud", "stamps"),
    # id/type/class · title/subtitle/auth · chips last
    "bin": (
        "id",
        "type",
        "class",
        "title",
        "subtitle",
        "auth",
        "bud",  # legacy read
        "echo",
        "chips",
    ),
    "pin": (
        "tps_created",
        "tps_updated",
        "tags",
        "folder",
        "shelf",
    ),
    # surface = this host's handle on a sku (not the chip/bin matter itself)
    "surface": ("host", "type", "subtype", "sku", "config_id"),
    "place": ("host", "kind", "id", "sku"),  # legacy
    "pose": (
        "x",
        "y",
        "open",
        "openW",
        "openH",
        "w",
        "h",
        "pageIdx",
        "termW",
        "termH",
    ),
    "dressup": ("style", "shell", "class"),
    "pages": (),  # freeform chip-id → dress map (emitted as one JSON object)
}


def _ordered_items(section: str, content: dict[str, Any]) -> list[tuple[str, Any]]:
    """Emit keys in law order; unknown keys after known, sorted for stability."""
    order = _KEY_ORDER.get(section) or ()
    seen: set[str] = set()
    out: list[tuple[str, Any]] = []
    for k in order:
        if k in content and content[k] is not None and content[k] != "":
            out.append((k, content[k]))
            seen.add(k)
    for k in sorted(content.keys()):
        if k in seen:
            continue
        v = content[k]
        if v is None or v == "":
            continue
        out.append((k, v))
    return out


def dump_nested_fm(sections: dict[str, Any], body: str) -> str:
    """Write nested sections with *sorted information order*, not append-order."""
    lines = ["---"]
    # section order: known first, then any extras
    names: list[str] = []
    for n in _SECTION_ORDER:
        if n in sections:
            names.append(n)
    for n in sections:
        if n not in names:
            names.append(n)
    for name in names:
        content = sections.get(name)
        if content is None:
            continue
        if isinstance(content, dict):
            lines.append(f"{name}:")
            for k, v in _ordered_items(name, content):
                if isinstance(v, bool):
                    lines.append(f"  {k}: {'true' if v else 'false'}")
                elif isinstance(v, (list, dict)):
                    lines.append(f"  {k}: {json.dumps(v, ensure_ascii=False)}")
                else:
                    sv = str(v)
                    if ":" in sv or sv.startswith(" "):
                        lines.append(f"  {k}: {json.dumps(sv, ensure_ascii=False)}")
                    else:
                        lines.append(f"  {k}: {sv}")
        else:
            lines.append(f"{name}: {content}")
    lines.append("---")
    body = "" if body is None else str(body)
    return "\n".join(lines) + "\n" + body


# ── chip ids ─────────────────────────────────────────────────────

def to_leaf_chip_id(old_id: str) -> str:
    s = str(old_id or "").strip()
    if not s:
        return f"leaf_{now()}"
    if s.startswith("leaf_"):
        return s
    # lf-123 → leaf_123 ; pg-x → leaf_pg-x ; else leaf_<id>
    if s.startswith("lf-"):
        return "leaf_" + s[3:]
    if s.startswith("sc-"):
        return "leaf_" + s[3:]
    return "leaf_" + s


def chip_filename(chip_id: str) -> str:
    # safe filename from id
    safe = re.sub(r"[^\w.-]+", "_", chip_id)
    if not safe.endswith(".chip"):
        safe = safe + ".chip"
    return safe


def chip_path(safe: Path, chip_id: str) -> Path | None:
    p = chips_root(safe) / chip_filename(chip_id)
    if p.is_file():
        return p
    # search by id in frontmatter if renamed
    root = chips_root(safe)
    if not root.is_dir():
        return None
    for f in root.glob("*.chip"):
        meta, _ = parse_nested_fm(f.read_text(encoding="utf-8"))
        chip = meta.get("chip") if isinstance(meta.get("chip"), dict) else {}
        cid = (chip or {}).get("id") or meta.get("id")
        if cid == chip_id:
            return f
    return None


# ── leaf chip ↔ API leaf dict ────────────────────────────────────

def leaf_api_from_chip_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_nested_fm(path.read_text(encoding="utf-8"))
    chip = meta.get("chip") if isinstance(meta.get("chip"), dict) else {}
    pin = meta.get("pin") if isinstance(meta.get("pin"), dict) else {}
    # legacy flat chip files
    if not chip and meta.get("id"):
        chip = {
            "id": meta.get("id"),
            "auth": meta.get("author") or meta.get("auth") or "unknown",
            "bud": meta.get("title") or meta.get("bud") or "untitled",
        }
        pin = {
            "tps_created": meta.get("created") or 0,
            "tps_updated": meta.get("updated") or 0,
            "tags": meta.get("tags") or [],
            "stamps": meta.get("stamps") or [],
            "cloth": meta.get("cloth") or "oxblood",
            "paper": meta.get("paper") or "plain",
        }
    cid = str(chip.get("id") or path.stem)
    stamps = pin.get("stamps") or []
    if isinstance(stamps, str):
        try:
            stamps = json.loads(stamps)
        except json.JSONDecodeError:
            stamps = []
    tags = pin.get("tags") or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    # stamps may live on chip (preferred) or legacy pin
    if not stamps:
        stamps = chip.get("stamps") or []
        if isinstance(stamps, str):
            try:
                stamps = json.loads(stamps)
            except json.JSONDecodeError:
                stamps = []
    dress = meta.get("dressup") if isinstance(meta.get("dressup"), dict) else {}
    shell = (dress or {}).get("shell") or pin.get("paper") or "plain"
    return {
        "id": cid,
        "title": chip.get("bud") or "untitled leaf",
        "author": chip.get("auth") or "unknown",
        # UI defaults: bin may override; chip dressup.shell is sheet face
        "cloth": pin.get("cloth") or "oxblood",
        "kind": "leaf",
        "paper": shell,
        "dressup": dress or None,
        "folder": pin.get("folder") or "",
        "boards": pin.get("boards") if isinstance(pin.get("boards"), list) else [],
        "stamps": stamps if isinstance(stamps, list) else [],
        "tags": tags if isinstance(tags, list) else [],
        "created": int(pin.get("tps_created") or 0),
        "updated": int(pin.get("tps_updated") or 0),
        "body": body if body is not None else "",
        "_file": path.name,
        "_path": str(path.resolve()),
        "_chip": True,
    }


def write_leaf_chip(safe: Path, leaf: dict[str, Any]) -> Path:
    """
    Proper leaf chip (Hands neat papers):
      chip: id, auth, bud, stamps?
      pin:  tps_*, tags  (+ optional folder soft-cache)
      dressup: style, shell   ← how *this sheet* may dress when rendered
    Bin membership is only on the bin. Bin dressup is separate (bookbox vs paper).
    """
    ensure_user_tree(safe)
    cid = to_leaf_chip_id(str(leaf.get("id") or f"lf-{now()}"))
    leaf["id"] = cid
    t = now()
    created = int(leaf.get("created") or t)
    stamps = leaf.get("stamps") or []
    if not isinstance(stamps, list):
        stamps = []
    tags = leaf.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    chip_block: dict[str, Any] = {
        "id": cid,
        "auth": (leaf.get("author") or "unknown").strip() or "unknown",
        "bud": leaf.get("title") or "untitled leaf",
    }
    if stamps:
        chip_block["stamps"] = stamps
    pin_block: dict[str, Any] = {
        "tps_created": created,
        "tps_updated": t,
        "tags": tags,
    }
    # optional soft cache for put-away (membership still owned by folder bin)
    folder = (leaf.get("folder") or "").strip()
    if folder:
        pin_block["folder"] = folder
    sections: dict[str, Any] = {
        "chip": chip_block,
        "pin": pin_block,
    }
    # sheet dress-up (not bin wear)
    dress = leaf.get("dressup")
    if isinstance(dress, dict) and dress:
        sections["dressup"] = {
            k: v
            for k, v in dress.items()
            if v is not None and v != ""
        }
    elif leaf.get("paper") or leaf.get("shell"):
        # soft map legacy paper → dressup.shell / style paper
        du: dict[str, Any] = {"style": "paper"}
        if leaf.get("shell"):
            du["shell"] = leaf["shell"]
        elif leaf.get("paper") and leaf.get("paper") != "plain":
            du["shell"] = leaf["paper"]
        else:
            du["shell"] = leaf.get("paper") or "simple_parchment"
        sections["dressup"] = du
    path = chips_root(safe) / chip_filename(cid)
    # if old file different name, remove
    old = chip_path(safe, cid)
    if old and old != path and old.is_file():
        try:
            old.unlink()
        except OSError:
            pass
    path.write_text(
        dump_nested_fm(sections, leaf.get("body") if leaf.get("body") is not None else ""),
        encoding="utf-8",
    )
    return path


def list_leaf_chips(safe: Path) -> list[dict[str, Any]]:
    ensure_user_tree(safe)
    out: list[dict[str, Any]] = []
    for p in sorted(chips_root(safe).glob("*.chip"), key=lambda x: x.stat().st_mtime):
        leaf = leaf_api_from_chip_file(p)
        if not leaf:
            continue
        # only leaf_ class for paper list (other classes later)
        cid = leaf["id"]
        if not str(cid).startswith("leaf_"):
            continue
        out.append(
            {
                "id": leaf["id"],
                "title": leaf["title"],
                "author": leaf.get("author") or "unknown",
                "cloth": leaf.get("cloth") or "oxblood",
                "folder": leaf.get("folder") or "",
                "updated": leaf.get("updated") or 0,
                "chars": len(leaf.get("body") or ""),
            }
        )
    return out


def delete_leaf_chip(safe: Path, chip_id: str) -> bool:
    p = chip_path(safe, to_leaf_chip_id(chip_id))
    if not p or not p.is_file():
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False


# ── bins ─────────────────────────────────────────────────────────

def bin_path(safe: Path, kind: str, bin_id: str) -> Path | None:
    root = bins_root(safe, kind)
    if not root.is_dir():
        return None
    for p in root.glob("*.bin"):
        meta, _ = parse_nested_fm(p.read_text(encoding="utf-8"))
        b = meta.get("bin") if isinstance(meta.get("bin"), dict) else {}
        if (b or {}).get("id") == bin_id or p.stem == bin_id:
            return p
    # direct filename
    direct = root / f"{slugify(bin_id, bin_id)}.bin"
    if direct.is_file():
        return direct
    return None


def read_bin(safe: Path, kind: str, bin_id: str) -> dict[str, Any] | None:
    p = bin_path(safe, kind, bin_id)
    if not p:
        return None
    return read_bin_file(p, kind)


def read_bin_file(path: Path, kind: str = "") -> dict[str, Any] | None:
    if not path.is_file():
        return None
    meta, body = parse_nested_fm(path.read_text(encoding="utf-8"))
    store = meta.get("store") if isinstance(meta.get("store"), dict) else {}
    b = meta.get("bin") if isinstance(meta.get("bin"), dict) else {}
    pin = meta.get("pin") if isinstance(meta.get("pin"), dict) else {}
    chips = b.get("chips") or []
    if isinstance(chips, str):
        try:
            chips = json.loads(chips)
        except json.JSONDecodeError:
            chips = []
    subtype = (store.get("subtype") or kind or "folder").strip()
    dress = meta.get("dressup") if isinstance(meta.get("dressup"), dict) else {}
    shell = (dress or {}).get("shell") or "oxblood"
    title = b.get("title") or b.get("bud") or store.get("title") or path.stem
    subtitle = b.get("subtitle") or b.get("echo") or pin.get("whisper") or ""
    author = _auth_first(b.get("auth") or store.get("auth"))
    sku = str(store.get("sku") or "").replace("-USER-", "-")
    return {
        "id": b.get("id") or path.stem,
        "title": title,
        "kind": "bin",
        "subtype": subtype,
        "chips": [str(c) for c in chips] if isinstance(chips, list) else [],
        "cloth": shell,
        "dressup": dress or None,  # legacy only; prefer surface config
        "author": author,
        "shelf": pin.get("shelf") or "",
        "whisper": subtitle,
        "echo": subtitle,
        "subtitle": subtitle,
        "created": int(pin.get("tps_created") or 0),
        "updated": int(pin.get("tps_updated") or 0),
        "body": body or "",
        "sku": sku,
        "_file": path.name,
        "_path": str(path.resolve()),
    }


def _auth_first(auth: Any) -> str:
    if isinstance(auth, list) and auth:
        return str(auth[0])
    if isinstance(auth, str) and auth:
        return auth
    return "unknown"


def write_bin(safe: Path, kind: str, data: dict[str, Any]) -> Path:
    ensure_user_tree(safe)
    subtype = kind if kind in BIN_KINDS else (data.get("subtype") or "folder")
    bin_id = str(data.get("id") or f"db_{now()}")
    chips = data.get("chips") or data.get("sheets") or data.get("pins") or []
    if not isinstance(chips, list):
        chips = []
    chips = [str(c) for c in chips]
    t = now()
    title = data.get("title") or bin_id
    sku = data.get("sku") or f"bin_{subtype}-{bin_id}"
    if isinstance(sku, str):
        sku = sku.replace("-USER-", "-")
    auth = data.get("author") or data.get("auth") or "unknown"
    if isinstance(auth, str):
        auth_val: Any = [auth] if auth != "unknown" else []
    else:
        auth_val = auth
    # Hands redline bin: store = pack type only; no dressup on bin (config wears it).
    # bin: id/type/class · title/subtitle/auth · chips
    title = data.get("title") or data.get("bud") or title
    subtitle = (
        data.get("subtitle") or data.get("echo") or data.get("whisper") or ""
    ).strip()
    # sku: bin_book-<id> (no USER segment)
    if "-USER-" in sku:
        sku = sku.replace("-USER-", "-")
    if sku.startswith("bin_book-USER-"):
        sku = "bin_book-" + bin_id
    bin_block: dict[str, Any] = {
        "id": bin_id,
        "type": "chip",
        "class": data.get("chip_class") or "leaf",
        "title": title,
    }
    if subtitle:
        bin_block["subtitle"] = subtitle
    if auth_val:
        bin_block["auth"] = auth_val
    bin_block["chips"] = chips
    pin_block: dict[str, Any] = {
        "tps_created": int(data.get("created") or t),
        "tps_updated": t,
        "tags": data.get("tags") or [],
    }
    shelf = (data.get("shelf") or "").strip()
    if shelf:
        pin_block["shelf"] = shelf
    sections: dict[str, Any] = {
        "store": {
            "sku": sku,
            "type": "bin",
            "subtype": subtype,
            "bit_count": len(chips),
        },
        "bin": bin_block,
        "pin": pin_block,
    }
    # dressup intentionally NOT written on bin — surface config only
    root = bins_root(safe, subtype)
    root.mkdir(parents=True, exist_ok=True)
    # stable filename from id
    fn = slugify(bin_id, bin_id) + ".bin"
    path = root / fn
    # remove other file with same bin id
    existing = bin_path(safe, subtype, bin_id)
    if existing and existing != path and existing.is_file():
        try:
            existing.unlink()
        except OSError:
            pass
    path.write_text(dump_nested_fm(sections, data.get("body") or ""), encoding="utf-8")
    return path


def list_bins(safe: Path, kind: str) -> list[dict[str, Any]]:
    ensure_user_tree(safe)
    root = bins_root(safe, kind)
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    for p in sorted(root.glob("*.bin"), key=lambda x: x.name.lower()):
        b = read_bin_file(p, kind)
        if b:
            out.append(b)
    return out


def delete_bin(safe: Path, kind: str, bin_id: str) -> bool:
    p = bin_path(safe, kind, bin_id)
    if not p or not p.is_file():
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False


# ── hydrate book API shape from bin + chips ──────────────────────

def book_from_bin(safe: Path, b: dict[str, Any]) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    for i, cid in enumerate(b.get("chips") or []):
        p = chip_path(safe, to_leaf_chip_id(cid))
        leaf = leaf_api_from_chip_file(p) if p else None
        if leaf:
            pages.append(
                {
                    "id": leaf["id"],
                    "position": i + 1,
                    "title": leaf.get("title") or "",
                    "body": leaf.get("body") or "",
                    "mark": "",
                    "updated": leaf.get("updated") or 0,
                    "stamps": leaf.get("stamps") or [],
                    "paper": leaf.get("paper") or "plain",
                    "author": leaf.get("author") or "unknown",
                }
            )
        else:
            pages.append(
                {
                    "id": cid,
                    "position": i + 1,
                    "title": "(missing chip)",
                    "body": "",
                    "mark": "",
                    "updated": 0,
                }
            )
    return {
        "id": b["id"],
        "title": b.get("title") or "notebook",
        "author": b.get("author") or "unknown",
        "whisper": b.get("whisper") or "on the felt",
        "cloth": b.get("cloth") or "oxblood",
        "shelf": b.get("shelf") or "",
        "created": b.get("created") or 0,
        "updated": b.get("updated") or 0,
        "pages": pages,
        "kind": "notebook",
        "chips": list(b.get("chips") or []),
        "_bin": True,
        "_path": b.get("_path"),
    }


def save_book_as_bin(safe: Path, nb: dict[str, Any]) -> dict[str, Any]:
    """Write each page as leaf chip; book bin lists chip ids in order."""
    ensure_user_tree(safe)
    book_id = nb.get("id") or f"nb-{now()}"
    nb["id"] = book_id
    pages = list(nb.get("pages") or [])
    chip_ids: list[str] = []
    t = now()
    for i, pg in enumerate(pages):
        pid = to_leaf_chip_id(str(pg.get("id") or f"pg-{t}-{i}"))
        leaf = {
            "id": pid,
            "title": pg.get("title") or f"page {i + 1}",
            "author": nb.get("author") or "unknown",
            "cloth": "oxblood",
            "paper": pg.get("paper") or "plain",
            "stamps": pg.get("stamps") or [],
            "body": pg.get("body") if pg.get("body") is not None else "",
            "created": pg.get("updated") or t,
            "folder": "",
            "boards": [],
        }
        write_leaf_chip(safe, leaf)
        chip_ids.append(pid)
        pg["id"] = pid
        pg["position"] = i + 1
    write_bin(
        safe,
        "book",
        {
            "id": book_id,
            "title": nb.get("title") or "notebook",
            "author": nb.get("author") or "unknown",
            "cloth": nb.get("cloth") or "oxblood",
            "shelf": nb.get("shelf") or "",
            "whisper": nb.get("whisper") or "on the felt",
            "chips": chip_ids,
            "created": nb.get("created") or t,
            "bud": nb.get("title") or "notebook",
            "chip_class": "leaf",
        },
    )
    b = read_bin(safe, "book", book_id)
    return book_from_bin(safe, b) if b else nb


# ── migration ────────────────────────────────────────────────────

def migrate_needed(safe: Path) -> bool:
    flag = user_root(safe) / MIGRATE_FLAG
    if flag.is_file():
        return False
    # need migrate if legacy has content and chips empty-ish
    legacy_leaves = list((safe / "leaves").glob("*.leaf.md")) if (safe / "leaves").is_dir() else []
    legacy_scraps = list((safe / "scraps").glob("*.scrap.md")) if (safe / "scraps").is_dir() else []
    legacy_books = (
        [p for p in (safe / "books").iterdir() if p.is_dir() and p.name.endswith(".bok")]
        if (safe / "books").is_dir()
        else []
    )
    chips = list(chips_root(safe).glob("*.chip")) if chips_root(safe).is_dir() else []
    if chips and not legacy_leaves and not legacy_books:
        return False
    return bool(legacy_leaves or legacy_scraps or legacy_books or (safe / "folders").is_dir())


def migrate_legacy_to_user(safe: Path) -> dict[str, Any]:
    """
    One-shot: leaves/scraps → USER/chips; books pages → chips + book bins;
    folders → folder bins; cork → board bins. Legacy moved to mausoleum.
    """
    ensure_user_tree(safe)
    report: dict[str, Any] = {
        "leaves": 0,
        "pages": 0,
        "books": 0,
        "folders": 0,
        "corks": 0,
        "layout_remaps": 0,
        "errors": [],
    }
    id_map: dict[str, str] = {}  # old leaf id → chip id

    def map_id(old: str) -> str:
        old = str(old)
        if old in id_map:
            return id_map[old]
        nid = to_leaf_chip_id(old)
        id_map[old] = nid
        return nid

    # 1) leaves
    for folder_name in ("leaves", "scraps"):
        root = safe / folder_name
        if not root.is_dir():
            continue
        for p in list(root.glob("*.leaf.md")) + list(root.glob("*.scrap.md")):
            try:
                meta, body = parse_frontmatter(p.read_text(encoding="utf-8"))
                old_id = str(meta.get("id") or p.stem)
                cid = map_id(old_id)
                stamps = meta.get("stamps") or []
                if isinstance(stamps, str):
                    try:
                        stamps = json.loads(stamps)
                    except json.JSONDecodeError:
                        stamps = []
                boards = meta.get("boards") or []
                if isinstance(boards, str):
                    try:
                        boards = json.loads(boards)
                    except json.JSONDecodeError:
                        boards = []
                leaf = {
                    "id": cid,
                    "title": meta.get("title") or "untitled leaf",
                    "author": meta.get("author") or "unknown",
                    "cloth": meta.get("cloth") or "oxblood",
                    "paper": meta.get("paper") or "plain",
                    "folder": meta.get("folder") or "",
                    "boards": boards if isinstance(boards, list) else [],
                    "stamps": stamps if isinstance(stamps, list) else [],
                    "body": body or "",
                    "created": int(meta.get("created") or 0),
                }
                write_leaf_chip(safe, leaf)
                report["leaves"] += 1
            except Exception as e:
                report["errors"].append(f"leaf {p.name}: {e}")

    # 2) books → page chips + book bin
    books_root = safe / "books"
    if books_root.is_dir():
        for bok in list(books_root.iterdir()):
            if not bok.is_dir() or not bok.name.endswith(".bok"):
                continue
            try:
                book_md = bok / "book.md"
                if not book_md.is_file():
                    continue
                bmeta, _ = parse_frontmatter(book_md.read_text(encoding="utf-8"))
                book_id = str(bmeta.get("id") or bok.stem.replace(".bok", ""))
                chip_ids: list[str] = []
                pages_dir = bok / "pages"
                if pages_dir.is_dir():
                    files = sorted(pages_dir.glob("*.md"))
                    # sort by position in fm if present
                    decorated = []
                    for i, pf in enumerate(files):
                        pm, body = parse_frontmatter(pf.read_text(encoding="utf-8"))
                        pos = pm.get("position")
                        try:
                            pos_i = int(pos) if pos not in (None, "") else i + 1
                        except (TypeError, ValueError):
                            pos_i = i + 1
                        decorated.append((pos_i, i, pf, pm, body))
                    decorated.sort(key=lambda x: (x[0], x[1]))
                    for pos_i, _, pf, pm, body in decorated:
                        old_pid = str(pm.get("id") or pf.stem)
                        cid = map_id(old_pid)
                        write_leaf_chip(
                            safe,
                            {
                                "id": cid,
                                "title": pm.get("title") or pf.stem,
                                "author": bmeta.get("author") or "unknown",
                                "cloth": "oxblood",
                                "paper": pm.get("paper") or "plain",
                                "stamps": [],
                                "body": body or "",
                                "created": int(pm.get("updated") or 0),
                                "folder": "",
                                "boards": [],
                            },
                        )
                        chip_ids.append(cid)
                        report["pages"] += 1
                write_bin(
                    safe,
                    "book",
                    {
                        "id": book_id,
                        "title": bmeta.get("title") or book_id,
                        "author": bmeta.get("author") or "unknown",
                        "cloth": bmeta.get("cloth") or "oxblood",
                        "shelf": bmeta.get("shelf") or "",
                        "whisper": bmeta.get("whisper") or "",
                        "chips": chip_ids,
                        "created": int(bmeta.get("created") or 0),
                        "bud": bmeta.get("title") or book_id,
                    },
                )
                report["books"] += 1
            except Exception as e:
                report["errors"].append(f"book {bok.name}: {e}")

    # 3) folders → folder bins (remap sheet ids)
    folders_root = safe / "folders"
    if folders_root.is_dir():
        for p in folders_root.glob("*.folder.md"):
            try:
                meta, body = parse_frontmatter(p.read_text(encoding="utf-8"))
                fid = str(meta.get("id") or p.stem)
                sheets = meta.get("sheets") or []
                if isinstance(sheets, str):
                    try:
                        sheets = json.loads(sheets)
                    except json.JSONDecodeError:
                        sheets = []
                chips = [map_id(str(s)) for s in (sheets or [])]
                # update folder field on chips
                for cid in chips:
                    cp = chip_path(safe, cid)
                    if not cp:
                        continue
                    leaf = leaf_api_from_chip_file(cp)
                    if leaf:
                        leaf["folder"] = fid
                        write_leaf_chip(safe, leaf)
                write_bin(
                    safe,
                    "folder",
                    {
                        "id": fid,
                        "title": meta.get("title") or fid,
                        "chips": chips,
                        "created": int(meta.get("created") or 0),
                        "body": body or "",
                        "bud": meta.get("title") or fid,
                    },
                )
                report["folders"] += 1
            except Exception as e:
                report["errors"].append(f"folder {p.name}: {e}")

    # 4) cork → board bins
    cork_root = safe / "corkboards"
    if cork_root.is_dir():
        for p in cork_root.glob("*.cork.md"):
            try:
                meta, body = parse_frontmatter(p.read_text(encoding="utf-8"))
                cid_b = str(meta.get("id") or p.stem)
                pins = meta.get("pins") or []
                if isinstance(pins, str):
                    try:
                        pins = json.loads(pins)
                    except json.JSONDecodeError:
                        pins = []
                chips = [map_id(str(s)) for s in (pins or [])]
                write_bin(
                    safe,
                    "board",
                    {
                        "id": cid_b,
                        "title": meta.get("title") or cid_b,
                        "chips": chips,
                        "created": int(meta.get("created") or 0),
                        "body": body or "",
                        "bud": meta.get("title") or cid_b,
                        "chip_class": "leaf",
                    },
                )
                report["corks"] += 1
            except Exception as e:
                report["errors"].append(f"cork {p.name}: {e}")

    # 5) felt layout remap leaf:old → leaf:new
    layout_file = safe / "felt_layout.json"
    if layout_file.is_file() and id_map:
        try:
            data = json.loads(layout_file.read_text(encoding="utf-8"))
            objects = data.get("objects") if isinstance(data, dict) else data
            if isinstance(objects, dict):
                new_obj: dict[str, Any] = {}
                for k, v in objects.items():
                    nk = k
                    if k.startswith("leaf:"):
                        old = k[5:]
                        if old in id_map:
                            nk = "leaf:" + id_map[old]
                            report["layout_remaps"] += 1
                        elif to_leaf_chip_id(old) != old:
                            nk = "leaf:" + to_leaf_chip_id(old)
                            report["layout_remaps"] += 1
                    new_obj[nk] = v
                payload = {
                    "schema": "receiver-felt-layout.v1",
                    "updated": now(),
                    "objects": new_obj,
                }
                layout_file.write_text(
                    json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
        except Exception as e:
            report["errors"].append(f"layout: {e}")

    # 6) mausoleum legacy dirs (copy then leave; don't delete user data hard)
    mau = safe / MAUSOLEUM
    try:
        mau.mkdir(parents=True, exist_ok=True)
        for name in ("leaves", "scraps", "books", "folders", "corkboards"):
            src = safe / name
            if src.exists():
                dest = mau / name
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
                shutil.copytree(src, dest)
                # remove live legacy so host only uses USER (books/leaves empty-ish)
                if name in ("leaves", "scraps", "folders", "corkboards"):
                    for f in src.glob("*"):
                        if f.is_file():
                            try:
                                f.unlink()
                            except OSError:
                                pass
                if name == "books":
                    for bok in list(src.iterdir()):
                        if bok.is_dir():
                            shutil.rmtree(bok, ignore_errors=True)
    except Exception as e:
        report["errors"].append(f"mausoleum: {e}")

    # flag + id map for debug
    (user_root(safe) / MIGRATE_FLAG).write_text(
        json.dumps({"migrated_at": now(), "report": report, "id_map": id_map}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    (user_root(safe) / "id_map.json").write_text(
        json.dumps(id_map, indent=2) + "\n", encoding="utf-8"
    )
    return report
