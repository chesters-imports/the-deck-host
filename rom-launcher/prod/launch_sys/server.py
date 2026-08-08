#!/usr/bin/env python3
"""
ROM Launcher · CO.HOST-001-LAUNCH
Primary Deck Host face — start menu for ROMs.

ROM Cat (catalog.json) is identity source of truth: names, chip codes,
descriptions, producers, launcher_show. launches.json recipes are launch
mechanics only: run_script, port, broken / coming_soon flags.

Quiet spawn via run-in-deck-host.py.
"""

from __future__ import annotations

import json
import os
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
# Single source of truth for cart plastic — same file ROM Cat serves
CART_FACE_CSS = (
    ALICE / "dewey-catalog-co" / "rom-cat" / "prod" / "romcat_sys" / "rom-cart-face.css"
)
LAUNCHES = ROOT / "data" / "launches.json"
HOST = "127.0.0.1"
PORT = 43170

# Known ROM ports not yet in launches.json (still get unstuck)
EXTRA_UNSTICK_PORTS = (
    42960,  # Great Road Mapper
    42962,  # ReqRep
    43111,  # meta-time-machine (sometimes)
    43145,  # Eddy's Encoder
)


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_catalog(doc: dict[str, Any]) -> None:
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(
        json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def sanitize_plate_css(raw: Any) -> str:
    """Declarations for the cart logo plate only (background, font, color, …)."""
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    lower = s.lower()
    # desk tool — still block dumb breakouts; normal url(...) for bg images ok
    for bad in ("</", "<script", "expression(", "javascript:", "@import"):
        if bad in lower:
            return ""
    if "data:text" in lower or "data:application" in lower:
        return ""
    return s[:4000]


def plate_from_chip(chip: str, rid: str = "") -> str:
    """Short logo-plate text from Cat chip_code (SKU tail). Not recipe callsigns."""
    chip = (chip or "").strip()
    if not chip:
        return ((rid or "ROM")[:8]).upper()
    # CO.DCC-001-ROMCAT → ROMCAT; CO.DAT-LORE → LORE; SPR-403 → SPR-403
    parts = [p for p in chip.replace(".", "-").split("-") if p]
    if not parts:
        return chip[:10].upper()
    tail = parts[-1]
    if len(tail) <= 2 and len(parts) >= 2:
        tail = "-".join(parts[-2:])
    # bare numeric tail (SPR-403) → keep house token
    elif tail.isdigit() and len(parts) >= 2:
        tail = "-".join(parts[-2:])
    # keep numeric SKU prefix when useful (001-CHAPS style)
    elif len(parts) >= 2 and parts[-2].isdigit():
        tail = f"{parts[-2]}-{parts[-1]}"
    return tail[:14].upper()


def merge_tiles() -> list[dict[str, Any]]:
    """
    ROM Cat is identity source of truth (name, chip, description, producer, show).
    launches.json recipes are launch mechanics only: run_script, port, broken/coming flags.
    """
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
        # recipes may still mark broken / coming_soon; Cat status also counts
        broken = bool(rec.get("broken")) or rom.get("status") == "broken"
        has_script = bool(rec.get("run_script"))
        coming = bool(rec.get("coming_soon")) or broken or not has_script
        if coming and rid not in recipes and rom.get("status") in (
            "idea",
            "mausoleum",
        ):
            if rid not in recipes:
                continue
        prod = producers.get(rom.get("producer_id") or "", {})
        name = rom.get("name") or rid
        chip = rom.get("chip_code") or ""
        status = "broken" if broken else (rom.get("status") or "idea")
        if broken:
            sub = "broken"
        elif coming:
            sub = status if status not in ("desk", "shipped") else "soon"
        else:
            sub = prod.get("chip_code") or "ready"
        # classicboi / julie shells from ROM Cat (fallback classicboi)
        case_shell = str(rom.get("case_shell") or "classicboi").strip().lower()
        if case_shell not in ("classicboi", "julie"):
            case_shell = "classicboi"
        julie_tint = str(rom.get("julie_tint") or "red").strip()
        # preset id or #hex (intense custom plastic, e.g. Detective K crimson)
        _presets = {
            "red",
            "crimson",
            "pink",
            "purple",
            "mint",
            "clear",
            "blue",
            "amber",
            "smoke",
        }
        low = julie_tint.lower()
        if low in _presets:
            julie_tint = low
        elif not (
            low.startswith("#")
            and len(low) in (4, 7, 9)
            and all(c in "0123456789abcdef#" for c in low)
        ):
            julie_tint = "red"
        else:
            julie_tint = low
        hue = "classic"
        if broken:
            hue = "broken"
        elif coming:
            hue = "soon"
        plate_css = sanitize_plate_css(rom.get("plate_css"))
        tiles.append(
            {
                "id": rid,
                "name": name,
                "chip_code": chip,
                "description": rom.get("description") or "",
                "status": status,
                "producer": prod.get("name") or "",
                "producer_chip": prod.get("chip_code") or "",
                "label": plate_from_chip(chip, rid),
                "sub": sub,
                "hue": hue,
                "case_shell": case_shell,
                "julie_tint": julie_tint,
                "plate_css": plate_css,
                "coming_soon": coming and not broken,
                "broken": broken,
                "launchable": has_script and not coming and not broken,
                "port": rec.get("port"),
            }
        )
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


def _win_no_window() -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return kwargs


def _pids_listening_on_port(port: int) -> set[int]:
    """Windows-friendly: who is LISTENing on localhost:port."""
    if sys.platform != "win32":
        try:
            out = subprocess.check_output(
                ["lsof", "-ti", f":{port}"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            return {int(x) for x in out.split() if x.isdigit()}
        except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
            return set()
    try:
        cmd = (
            f"(Get-NetTCPConnection -LocalPort {int(port)} -State Listen "
            f"-ErrorAction SilentlyContinue).OwningProcess"
        )
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", cmd],
            text=True,
            stderr=subprocess.DEVNULL,
            **_win_no_window(),
        )
        return {int(x) for x in out.split() if x.isdigit() and int(x) > 0}
    except (subprocess.CalledProcessError, ValueError, OSError):
        return set()


def _python_server_pids_under_alice() -> list[dict[str, Any]]:
    """Orphan python server.py processes under ALICE_BOX (not this launcher)."""
    me = os.getpid()
    alice_s = str(ALICE).lower().replace("/", "\\")
    launch_marker = str(ROOT).lower().replace("/", "\\")
    found: list[dict[str, Any]] = []
    if sys.platform != "win32":
        return found
    try:
        cmd = (
            "Get-CimInstance Win32_Process -Filter \"name='python.exe' OR name='pythonw.exe'\" "
            "| Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
        )
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", cmd],
            text=True,
            stderr=subprocess.DEVNULL,
            **_win_no_window(),
        )
        if not out.strip():
            return found
        data = json.loads(out)
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            pid = int(row.get("ProcessId") or 0)
            cl = str(row.get("CommandLine") or "")
            cl_l = cl.lower().replace("/", "\\")
            if not pid or pid == me:
                continue
            # ROM servers: python server.py / serve_rom.py / php -S under ALICE_BOX
            is_rom = (
                "server.py" in cl_l
                or "serve_rom.py" in cl_l
                or ("php" in cl_l and "-s" in cl_l)
            )
            if not is_rom:
                continue
            # never kill the launcher itself
            if "rom-launcher" in cl_l or "launch_sys" in cl_l or launch_marker in cl_l:
                continue
            # only when CommandLine points at ALICE_BOX (port kill covers cwd-only spawns)
            if alice_s not in cl_l and "alice_box" not in cl_l:
                continue
            found.append({"pid": pid, "cmd": cl[:200]})
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError, ValueError):
        return found
    return found


def _kill_pid(pid: int) -> bool:
    me = os.getpid()
    if pid <= 0 or pid == me:
        return False
    try:
        if sys.platform == "win32":
            subprocess.check_call(
                ["taskkill", "/PID", str(pid), "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **_win_no_window(),
            )
        else:
            os.kill(pid, 15)
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


def unstick_rom_servers() -> dict[str, Any]:
    """
    Kill stuck ROM server.py listeners (zombie ports after Deck Host windows close).
    Keeps this launcher (port 43170 / our PID) alive.
    """
    me = os.getpid()
    launch = load_json(LAUNCHES)
    ports: set[int] = set()
    for rec in (launch.get("recipes") or {}).values():
        p = rec.get("port")
        if p:
            try:
                ports.add(int(p))
            except (TypeError, ValueError):
                pass
    for p in EXTRA_UNSTICK_PORTS:
        ports.add(int(p))
    # never unstick ourselves
    ports.discard(PORT)

    killed: list[dict[str, Any]] = []
    seen_pids: set[int] = set()

    for port in sorted(ports):
        for pid in _pids_listening_on_port(port):
            if pid == me or pid in seen_pids:
                continue
            if _kill_pid(pid):
                seen_pids.add(pid)
                killed.append({"pid": pid, "port": port, "how": "listen"})

    for row in _python_server_pids_under_alice():
        pid = int(row["pid"])
        if pid == me or pid in seen_pids:
            continue
        if _kill_pid(pid):
            seen_pids.add(pid)
            killed.append(
                {
                    "pid": pid,
                    "port": None,
                    "how": "orphan-server.py",
                    "cmd": row.get("cmd"),
                }
            )

    log_path = ROOT / "data" / "launch.log"
    try:
        with open(log_path, "a", encoding="utf-8", errors="replace") as log_f:
            log_f.write(f"\n--- unstick killed={len(killed)} ---\n")
            for k in killed:
                log_f.write(f"  {k}\n")
    except OSError:
        pass

    return {
        "ok": True,
        "killed": killed,
        "count": len(killed),
        "kept_launcher_port": PORT,
        "kept_pid": me,
        "ports_scanned": sorted(ports),
        "message": (
            f"unstuck {len(killed)} process(es)"
            if killed
            else "nothing stuck · all quiet"
        ),
    }


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
    # Server already listening ≠ glass is open. Old path returned early with
    # "already warm" and never opened Deck Host — felt like a silent launch.
    # Always run the product runner; run-in-deck-host / deck_host skip re-spawn
    # when health is up and still open the window.
    already = bool(port and health_up(int(port)))
    # Quiet: no console window; log next to launch_sys
    log_path = ROOT / "data" / "launch.log"
    log_f = open(log_path, "a", encoding="utf-8", errors="replace")
    log_f.write(f"\n--- launch {rid} ---\n{script}\n")
    if already:
        log_f.write(f"(server already warm on :{port} — still opening glass)\n")
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
    msg = (
        f"glass pid={proc.pid} · server already warm on :{port}"
        if already
        else f"launched pid={proc.pid}"
    )
    return {
        "ok": True,
        "already": already,
        "pid": proc.pid,
        "port": port,
        "message": msg,
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
        # Shared cart face CSS (ROM Cat is editor of truth; Launcher only hosts a copy path)
        if path == "/rom-cart-face.css":
            if not CART_FACE_CSS.is_file():
                self.send_error(404, "rom-cart-face.css missing under rom-cat")
                return
            raw = CART_FACE_CSS.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/css; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
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
        if path == "/api/unstick":
            # Kill zombie ROM server.py / stuck ports (not this launcher)
            result = unstick_rom_servers()
            self._json(200, result)
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
