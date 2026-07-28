#!/usr/bin/env python3
"""
ROM Launcher · CO.HOST-001-LAUNCH
Primary Deck Host face — start menu for ROMs.
Reads ROM Cat + local recipes. Quiet spawn via run-in-deck-host.py.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
# launch_sys → prod → rom-launcher → the-deck-host → ALICE_BOX
ALICE = ROOT.parents[3]
CATALOG = ALICE / "dewey-catalog-co" / "rom-cat" / "prod" / "romcat_sys" / "data" / "catalog.json"
LAUNCHES = ROOT / "data" / "launches.json"
HOST = "127.0.0.1"
PORT = 43170


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_catalog(doc: dict[str, Any]) -> None:
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(
        json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def merge_tiles() -> list[dict[str, Any]]:
    cat = load_json(CATALOG)
    launch = load_json(LAUNCHES)
    recipes = launch.get("recipes") or {}
    producers = {p.get("id"): p for p in (cat.get("producers") or [])}
    tiles: list[dict[str, Any]] = []
    for rom in cat.get("roms") or []:
        rid = rom.get("id") or ""
        # default: show desk/shipped with address
        show = rom.get("launcher_show")
        if show is None:
            show = rom.get("status") in ("desk", "shipped") and bool(
                rom.get("address")
            )
        if not show:
            continue
        rec = recipes.get(rid) or {}
        broken = bool(rec.get("broken")) or rom.get("status") == "broken"
        coming = (
            bool(rec.get("coming_soon"))
            or broken
            or not rec.get("run_script")
        )
        if coming and rid not in recipes and rom.get("status") in (
            "idea",
            "mausoleum",
        ):
            if rid not in recipes:
                continue
        prod = producers.get(rom.get("producer_id") or "", {})
        sub = rec.get("sub")
        if broken:
            sub = "broken"
        elif not sub:
            sub = rom.get("status") if coming else "launch"
        tiles.append(
            {
                "id": rid,
                "name": rec.get("title") or rom.get("name") or rid,
                "chip_code": rom.get("chip_code") or "",
                "description": rom.get("description") or "",
                "status": "broken" if broken else (rom.get("status") or "idea"),
                "producer": prod.get("name") or "",
                "producer_chip": prod.get("chip_code") or "",
                "label": rec.get("label") or (rom.get("chip_code") or rid)[:8],
                "sub": sub,
                "hue": rec.get("hue") or "steel",
                "coming_soon": coming and not broken,
                "broken": broken,
                "launchable": bool(rec.get("run_script"))
                and not coming
                and not broken,
                "port": rec.get("port"),
            }
        )
    # also show recipe-only coming soon if launcher_show on matching rom
    tiles.sort(key=lambda t: (not t["launchable"], t["name"].lower()))
    return tiles


def health_up(port: int | None) -> bool:
    if not port:
        return False
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.4)
        return True
    except Exception:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.4)
            return True
        except Exception:
            return False


def launch_rom(rid: str) -> dict[str, Any]:
    launch = load_json(LAUNCHES)
    rec = (launch.get("recipes") or {}).get(rid)
    if not rec or not rec.get("run_script"):
        return {"ok": False, "error": "no launch recipe (coming soon?)"}
    if rec.get("coming_soon"):
        return {"ok": False, "error": "coming soon"}
    script = ALICE / rec["run_script"]
    if not script.is_file():
        return {"ok": False, "error": f"run script missing: {script}"}
    port = rec.get("port")
    if port and health_up(int(port)):
        return {
            "ok": True,
            "already": True,
            "message": f"already warm on :{port}",
            "port": port,
        }
    # Quiet: no console window; log next to launch_sys
    log_path = ROOT / "data" / "launch.log"
    log_f = open(log_path, "a", encoding="utf-8", errors="replace")
    log_f.write(f"\n--- launch {rid} ---\n{script}\n")
    log_f.flush()
    kwargs: dict[str, Any] = {
        "cwd": str(script.parent),
        "stdout": log_f,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32":
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cf |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        kwargs["creationflags"] = cf
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen([sys.executable, str(script)], **kwargs)
    return {
        "ok": True,
        "already": False,
        "pid": proc.pid,
        "port": port,
        "message": f"launched pid={proc.pid}",
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, obj: Any) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json(
                200,
                {
                    "ok": True,
                    "sku": "CO.HOST-001-LAUNCH",
                    "service": "rom-launcher",
                },
            )
            return
        if path == "/api/tiles":
            tiles = merge_tiles()
            for t in tiles:
                if t.get("port"):
                    t["warm"] = health_up(int(t["port"]))
                else:
                    t["warm"] = False
            self._json(200, {"ok": True, "tiles": tiles})
            return
        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/launch":
            payload = self._read_json()
            rid = (payload.get("id") or "").strip()
            if not rid:
                self._json(400, {"ok": False, "error": "id required"})
                return
            result = launch_rom(rid)
            self._json(200 if result.get("ok") else 400, result)
            return
        if path == "/api/toggle":
            # optional: toggle launcher_show in catalog
            payload = self._read_json()
            rid = (payload.get("id") or "").strip()
            show = bool(payload.get("launcher_show"))
            if not rid:
                self._json(400, {"ok": False, "error": "id required"})
                return
            cat = load_json(CATALOG)
            roms = cat.get("roms") or []
            found = False
            for i, r in enumerate(roms):
                if r.get("id") == rid:
                    roms[i] = {**r, "launcher_show": show}
                    found = True
                    break
            if not found:
                self._json(404, {"ok": False, "error": "rom not in catalog"})
                return
            cat["roms"] = roms
            save_catalog(cat)
            self._json(200, {"ok": True, "tiles": merge_tiles()})
            return
        self._json(404, {"ok": False, "error": "not found"})


def main() -> int:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"ROM Launcher · CO.HOST-001-LAUNCH · http://{HOST}:{PORT}/",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstop", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
