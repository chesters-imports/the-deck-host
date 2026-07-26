"""
The Deck Host — window runtime for ROMs.

  cd the-deck-host/shell
  pip install -r requirements.txt
  python deck_host.py
  python deck_host.py --url http://127.0.0.1:42929/

Env:
  DECK_HOST_URL          entry URL (overrides default launcher)
  DECK_HOST_BASE         base for relative go() paths (optional)
  DECK_HOST_FRAMELESS=0  OS title bar + optional menu
  DECK_HOST_DEBUG=0      DevTools off

Exact myPI pocket-browser sources: shell/from-mypi/ (untouched copies).
Builds originals remain at my-pocket-internet/pocket-browser.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    import webview
except ImportError:
    print("pip install pywebview")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
LAUNCHER = (HERE / "launcher.html").as_uri()
CAPTION_JS = HERE / "caption.js"
_CAPTION_H = 36

TITLE_ROOT = os.environ.get("DECK_HOST_TITLE", "deck host").strip() or "deck host"

_DEBUG = os.environ.get("DECK_HOST_DEBUG", "1").strip().lower() not in (
    "0",
    "false",
    "off",
    "no",
)
_FRAMELESS = os.environ.get("DECK_HOST_FRAMELESS", "1").strip().lower() not in (
    "0",
    "false",
    "off",
    "no",
)

_CAPTION_SRC = CAPTION_JS.read_text(encoding="utf-8") if CAPTION_JS.is_file() else ""

# Window geometry — mutated by --profile / --width / etc. in main()
_MAG_SMALL = (1024, 768)
_MAG_LARGE = (1600, 1200)
_MIN_SIZE = (640, 480)
_ON_TOP = False
_PROFILE = "desk"  # desk | companion

# Set in main() from CLI / env
HOME = LAUNCHER
BASE = ""  # optional prefix for relative go() paths


def apply_profile(name: str) -> None:
    """
    Window geometry by ROM kind — do NOT collapse everyone into one size.

    desk     — classic ROM (import-station, general) 1024×768
    datbox   — short DATBOX bags (lore/shot) — only those ROMs opt in
    office   — Big Box / document tools — wider desk for kanban etc.
    companion/rail — tall strip (Time Machina)
    """
    global _MAG_SMALL, _MAG_LARGE, _MIN_SIZE, _ON_TOP, _PROFILE
    p = (name or "desk").strip().lower()
    if p in ("companion", "rail", "companion-rail", "strip"):
        _PROFILE = "companion"
        # Time Machina etc. — tall strip (needs message body height)
        _MAG_SMALL = (368, 740)
        _MAG_LARGE = (400, 920)
        _MIN_SIZE = (300, 420)
        _ON_TOP = True
    elif p in ("datbox", "dat-box", "short"):
        _PROFILE = "datbox"
        # DATBOX only — short so two stack on ~1080p (must not be default desk)
        _MAG_SMALL = (960, 520)
        _MAG_LARGE = (1280, 800)
        _MIN_SIZE = (640, 400)
        _ON_TOP = False
    elif p in ("office", "bigbox", "bbc", "document"):
        _PROFILE = "office"
        # sopr Documenter etc. — room for section rail + bucket / kanban
        _MAG_SMALL = (1280, 800)
        _MAG_LARGE = (1600, 1000)
        _MIN_SIZE = (900, 560)
        _ON_TOP = False
    else:
        _PROFILE = "desk"
        # Classic default — charlie toys, import station, etc.
        _MAG_SMALL = (1024, 768)
        _MAG_LARGE = (1600, 1200)
        _MIN_SIZE = (640, 480)
        _ON_TOP = False


class DeckHostApi:
    """JS bridge: window.pywebview.api.*"""

    def __init__(self) -> None:
        self._window: webview.Window | None = None
        self._maximized = False
        self._normal_size = _MAG_SMALL
        self._mag_large = False
        self._mag_small = _MAG_SMALL
        self._mag_large_size = _MAG_LARGE
        self._allow_maximize = _PROFILE != "companion"

    def bind(self, window: webview.Window) -> None:
        self._window = window

    def minimize(self) -> None:
        if self._window:
            self._window.minimize()

    def toggle_maximize(self) -> None:
        if not self._window:
            return
        # Companion rails: maximize is wrong shape — step height instead
        if not self._allow_maximize:
            self.step_window_size()
            return
        if self._maximized:
            w, h = self._normal_size
            self._window.restore()
            try:
                self._window.resize(w, h)
            except Exception:
                pass
            self._maximized = False
        else:
            try:
                self._normal_size = (self._window.width, self._window.height)
            except Exception:
                pass
            self._window.maximize()
            self._maximized = True

    def step_window_size(self) -> str:
        if not self._window:
            return ""
        try:
            if self._maximized:
                self._window.restore()
                self._maximized = False
        except Exception:
            pass

        if self._mag_large:
            target = self._mag_small
            self._mag_large = False
        else:
            target = self._mag_large_size
            self._mag_large = True

        try:
            self._window.resize(target[0], target[1])
            self._normal_size = target
        except Exception:
            self._mag_large = not self._mag_large
            return f"{target[0]}x{target[1]}"
        return f"{target[0]}x{target[1]}"

    def close(self) -> None:
        if self._window:
            self._window.destroy()

    def home(self) -> None:
        if self._window:
            self._window.load_url(HOME)

    def go(self, path: str) -> None:
        """Navigate to absolute URL, or BASE+path if BASE is set."""
        if not self._window:
            return
        path = (path or "").strip()
        if path.startswith("http://") or path.startswith("https://") or path.startswith("file:"):
            self._window.load_url(path)
            return
        path = path.lstrip("/")
        if BASE:
            self._window.load_url(BASE.rstrip("/") + "/" + path)
        else:
            self._window.load_url(path if "://" in path else HOME)

    def hard_refresh(self) -> None:
        if not self._window:
            return
        try:
            url = self._window.get_current_url() or ""
            if not url or url.startswith("file:"):
                self.reload()
                return
            self._window.load_url(with_cache_bust(url))
        except Exception:
            self.reload()

    def reload(self) -> None:
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                "(function(){if(window.WWWRefresh)WWWRefresh();else location.reload();})();"
            )
        except Exception:
            try:
                url = self._window.get_current_url() or HOME
                self._window.load_url(url)
            except Exception:
                pass

    def new_window(self) -> str:
        try:
            spawn_deck_window()
            return "ok"
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] new_window failed: {e}")
            return f"err:{e}"


_KEY_BRIDGE_JS = r"""
(function () {
  if (window.__deckHostKeys) return;
  window.__deckHostKeys = true;
  window.addEventListener("keydown", function (e) {
    var key = e.key || "";
    if (key === "F5" && (e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      if (typeof window.WWWHardRefresh === "function") window.WWWHardRefresh();
      else {
        try {
          var dest = new URL(location.href);
          dest.searchParams.set("_cb", String(Date.now()));
          location.replace(dest.toString());
        } catch (err) { location.reload(); }
      }
      return;
    }
    if (key === "F5") {
      e.preventDefault();
      if (typeof window.WWWRefresh === "function") window.WWWRefresh();
      else location.reload();
      return;
    }
    if ((key === "r" || key === "R") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        if (typeof window.WWWHardRefresh === "function") window.WWWHardRefresh();
        else {
          try {
            var d2 = new URL(location.href);
            d2.searchParams.set("_cb", String(Date.now()));
            location.replace(d2.toString());
          } catch (err2) { location.reload(); }
        }
      } else {
        if (typeof window.WWWRefresh === "function") window.WWWRefresh();
        else location.reload();
      }
    }
  }, true);
})();
"""


def path_title(url: str, short: bool = False) -> str:
    if not url:
        return TITLE_ROOT
    if url.startswith("file:") or "launcher.html" in url:
        return "gate" if short else f"{TITLE_ROOT} · gate"
    try:
        p = urlparse(url)
        path = (p.path or "/").rstrip("/") or "/"
        display = path.lstrip("/") or "/"
        host = (p.hostname or "").lower()
        q = p.query or ""
        if q:
            parts = [kv for kv in q.split("&") if not kv.startswith("_cb=")]
            if parts:
                display = f"{display}?{'&'.join(parts)}"
        if short:
            if host and host not in ("127.0.0.1", "localhost"):
                return host.split(".")[0]
            segs = [s for s in display.split("/") if s]
            if not segs:
                return TITLE_ROOT
            if len(segs) == 1:
                return segs[0]
            return segs[0] + " · " + "/".join(segs[1:3])
        return f"{TITLE_ROOT} · {display}"
    except Exception:
        return TITLE_ROOT


def with_cache_bust(url: str) -> str:
    if not url or url.startswith("file:"):
        return url
    try:
        p = urlparse(url)
        q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != "_cb"]
        q.append(("_cb", str(int(time.time() * 1000))))
        return urlunparse(p._replace(query=urlencode(q)))
    except Exception:
        return url


def build_caption_js(title: str) -> str:
    if not _CAPTION_SRC:
        t = json.dumps(title)
        return f"""
(function(){{
  var H={_CAPTION_H};
  document.documentElement.style.setProperty('--deck-caption-h',H+'px');
  document.documentElement.style.setProperty('--pocket-caption-h',H+'px');
  if(document.body){{
    document.body.style.setProperty('--deck-caption-h',H+'px');
    document.body.style.setProperty('--pocket-caption-h',H+'px');
  }}
  if(!document.body) return 'no-body';
  var b=document.createElement('div');
  b.id='deck-host-caption';
  b.className='pywebview-drag-region';
  b.style.cssText='position:fixed;top:0;left:0;right:0;height:'+H+'px;z-index:2147483000;background:#0a0c12;color:#eee;display:flex;align-items:center;padding:0 12px;font:12px system-ui';
  b.textContent={t};
  document.body.insertBefore(b, document.body.firstChild);
  return 'fallback-caption';
}})();
"""
    preamble = (
        f"window.__DECK_CAPTION_TITLE = {json.dumps(title)};\n"
        f"window.__DECK_CAPTION_H = {_CAPTION_H};\n"
    )
    return preamble + _CAPTION_SRC


def _attach_window_events(window: webview.Window, api: DeckHostApi) -> None:
    def inject_caption(short_title: str) -> None:
        if not _FRAMELESS:
            return
        script = build_caption_js(short_title)

        def attempt(n: int = 0) -> None:
            try:
                result = window.evaluate_js(script)
                if _DEBUG:
                    print(f"[deck-host] caption inject try={n} result={result!r}")
            except Exception as e:
                if _DEBUG:
                    print(f"[deck-host] caption inject try={n} error={e}")
                if n < 5:
                    threading.Timer(0.25 * (n + 1), lambda: attempt(n + 1)).start()

        attempt(0)
        threading.Timer(0.35, lambda: attempt(1)).start()
        threading.Timer(0.9, lambda: attempt(2)).start()

    def on_loaded() -> None:
        short = TITLE_ROOT
        try:
            url = window.get_current_url() or ""
            full = path_title(url, short=False)
            short = path_title(url, short=True)
            window.set_title(full if not _FRAMELESS else short)
        except Exception:
            pass
        try:
            window.evaluate_js(_KEY_BRIDGE_JS)
        except Exception:
            pass
        inject_caption(short)

    window.events.loaded += on_loaded


def spawn_deck_window(
    url: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> webview.Window:
    api = DeckHostApi()
    kw: dict = {
        "title": TITLE_ROOT,
        "url": url or HOME,
        "width": width or _MAG_SMALL[0],
        "height": height or _MAG_SMALL[1],
        "min_size": _MIN_SIZE,
        "background_color": "#0a0c12",
        "text_select": True,
        "frameless": _FRAMELESS,
        "easy_drag": False,
        "resizable": True,
        "shadow": True,
        "js_api": api,
    }
    if _ON_TOP:
        kw["on_top"] = True
    w = webview.create_window(**kw)
    api.bind(w)
    _attach_window_events(w, api)
    return w


_child: subprocess.Popen | None = None


def _kill_child() -> None:
    """Stop only this host's ROM server PID tree — not other Deck Host ROMs."""
    global _child
    if _child is None:
        return
    proc = _child
    _child = None
    if proc.poll() is not None:
        return
    pid = proc.pid
    try:
        if sys.platform == "win32":
            # /T = children of this PID only (the server we spawned)
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
        else:
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except Exception:
                proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _parse_spawn_command(command: str | list[str]) -> list[str]:
    """Turn --spawn into argv. Avoid shell=True so PID is the real ROM server."""
    if isinstance(command, list):
        return [str(x) for x in command]
    command = (command or "").strip()
    if not command:
        return []
    # Windows: prefer list when pattern is "python" server.py or quoted exe + script
    try:
        import shlex

        return shlex.split(command, posix=(sys.platform != "win32"))
    except Exception:
        return command.split()


def start_rom_process(command: str | list[str], cwd: Path) -> subprocess.Popen:
    """Start a ROM side-process as its own PID (not cmd.exe)."""
    global _child
    argv = _parse_spawn_command(command)
    if not argv:
        raise ValueError("empty spawn command")
    # Always log server output next to the ROM — CREATE_NO_WINDOW hides consoles
    log_path = cwd / "desk-server.log"
    log_f = open(log_path, "w", encoding="utf-8", errors="replace")
    log_f.write(f"argv={argv!r}\ncwd={cwd}\n\n")
    log_f.flush()
    kwargs: dict = {
        "cwd": str(cwd),
        "stdout": log_f,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32":
        # New process group: kill tree is this server only, not sibling ROMs
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cf |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        kwargs["creationflags"] = cf
    else:
        kwargs["start_new_session"] = True
    _child = subprocess.Popen(argv, **kwargs)
    # keep log handle alive on the Popen object
    _child._deck_log = log_f  # type: ignore[attr-defined]
    atexit.register(_kill_child)
    print(f"[deck-host] ROM pid={_child.pid} argv={argv} cwd={cwd}")
    print(f"[deck-host] ROM log  {log_path}")
    return _child


def wait_for_url(url: str, timeout: float = 20.0) -> bool:
    """Poll until HTTP responds (any code short of connection failure)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.8)
            return True
        except urllib.error.HTTPError:
            return True  # server up, just not 200
        except Exception:
            time.sleep(0.2)
    return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="The Deck Host — run a ROM in a desktop window")
    p.add_argument(
        "--url",
        default=os.environ.get("DECK_HOST_URL", "").strip() or None,
        help="Entry URL (default: local launcher gate, or DECK_HOST_URL)",
    )
    p.add_argument(
        "--base",
        default=os.environ.get("DECK_HOST_BASE", "").strip() or None,
        help="Base URL for relative go() paths (optional)",
    )
    p.add_argument("--title", default=None, help="Window title root")
    p.add_argument(
        "--spawn",
        default=os.environ.get("DECK_HOST_SPAWN", "").strip() or None,
        help='Shell command to start before the window (e.g. "python server.py")',
    )
    p.add_argument(
        "--spawn-cwd",
        default=os.environ.get("DECK_HOST_SPAWN_CWD", "").strip() or None,
        help="Working directory for --spawn",
    )
    p.add_argument(
        "--health",
        default=os.environ.get("DECK_HOST_HEALTH", "").strip() or None,
        help="URL to wait for before opening the window (default: --url)",
    )
    p.add_argument(
        "--health-timeout",
        type=float,
        default=float(os.environ.get("DECK_HOST_HEALTH_TIMEOUT", "25")),
        help="Seconds to wait for --health",
    )
    p.add_argument(
        "--profile",
        default=os.environ.get("DECK_HOST_PROFILE", "desk").strip() or "desk",
        choices=("desk", "datbox", "office", "companion", "rail"),
        help="desk=1024×768 · datbox=short · office=wide docs · companion/rail=strip",
    )
    p.add_argument(
        "--width",
        type=int,
        default=_env_int("DECK_HOST_WIDTH"),
        help="Window width (overrides profile default)",
    )
    p.add_argument(
        "--height",
        type=int,
        default=_env_int("DECK_HOST_HEIGHT"),
        help="Window height (overrides profile default)",
    )
    p.add_argument(
        "--min-width",
        type=int,
        default=_env_int("DECK_HOST_MIN_WIDTH"),
        help="Minimum window width",
    )
    p.add_argument(
        "--min-height",
        type=int,
        default=_env_int("DECK_HOST_MIN_HEIGHT"),
        help="Minimum window height",
    )
    p.add_argument(
        "--on-top",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Keep window above others (default: on for companion profile)",
    )
    return p.parse_args(argv)


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def main(argv: list[str] | None = None) -> None:
    global HOME, BASE, TITLE_ROOT, _MAG_SMALL, _MAG_LARGE, _MIN_SIZE, _ON_TOP

    args = parse_args(argv)
    apply_profile(args.profile)
    if args.width and args.height:
        _MAG_SMALL = (args.width, args.height)
    elif args.width:
        _MAG_SMALL = (args.width, _MAG_SMALL[1])
    elif args.height:
        _MAG_SMALL = (_MAG_SMALL[0], args.height)
    if args.min_width or args.min_height:
        _MIN_SIZE = (
            args.min_width or _MIN_SIZE[0],
            args.min_height or _MIN_SIZE[1],
        )
    if args.on_top is not None:
        _ON_TOP = bool(args.on_top)

    if args.title:
        TITLE_ROOT = args.title.strip() or TITLE_ROOT
    if args.base:
        BASE = args.base.rstrip("/")
    if args.url:
        HOME = args.url
    else:
        HOME = LAUNCHER

    # Optional: start ROM backend (lives outside this repo), wait, open window; kill on exit
    health = args.health or (
        args.url if args.url and str(args.url).startswith("http") else None
    )
    if args.spawn:
        cwd = Path(args.spawn_cwd).resolve() if args.spawn_cwd else HERE
        if not cwd.is_dir():
            print(f"[deck-host] spawn cwd missing: {cwd}", file=sys.stderr)
            sys.exit(1)
        # If this ROM is already healthy (e.g. re-open), do not spawn a second
        # server and do not claim ownership to kill on exit.
        already = health and wait_for_url(health, timeout=0.6)
        if already:
            print(f"[deck-host] ROM already up at {health} — not re-spawning")
        else:
            print(f"[deck-host] starting ROM process in {cwd}")
            print(f"[deck-host]   {args.spawn}")
            try:
                start_rom_process(args.spawn, cwd)
            except Exception as e:
                print(f"[deck-host] spawn failed: {e}", file=sys.stderr)
                sys.exit(1)
            if health:
                print(f"[deck-host] waiting for {health} …")
                if not wait_for_url(health, timeout=args.health_timeout):
                    print(
                        f"[deck-host] timeout waiting for ROM at {health}",
                        file=sys.stderr,
                    )
                    _kill_child()
                    sys.exit(1)
                print("[deck-host] ROM is up")

    try:
        webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    except Exception:
        pass

    api = DeckHostApi()
    win_kw: dict = {
        "title": TITLE_ROOT,
        "url": HOME,
        "width": _MAG_SMALL[0],
        "height": _MAG_SMALL[1],
        "min_size": _MIN_SIZE,
        "background_color": "#0a0c12",
        "text_select": True,
        "frameless": _FRAMELESS,
        "easy_drag": False,
        "resizable": True,
        "shadow": True,
        "js_api": api,
    }
    if _ON_TOP:
        win_kw["on_top"] = True
    window = webview.create_window(**win_kw)
    api.bind(window)
    _attach_window_events(window, api)
    print(
        f"[deck-host] profile={_PROFILE}  "
        f"size={_MAG_SMALL[0]}x{_MAG_SMALL[1]}  "
        f"min={_MIN_SIZE[0]}x{_MIN_SIZE[1]}  "
        f"on_top={_ON_TOP}",
        flush=True,
    )

    menu_items = [
        webview.menu.MenuAction("Home", lambda: api.home()),
        webview.menu.MenuAction("New window", lambda: spawn_deck_window()),
        webview.menu.MenuAction("Reload", lambda: api.reload()),
        webview.menu.MenuAction("Hard refresh", lambda: api.hard_refresh()),
        webview.menu.MenuAction("Back", lambda: window.evaluate_js("history.back()")),
        webview.menu.MenuAction("Forward", lambda: window.evaluate_js("history.forward()")),
        webview.menu.MenuAction("Minimize", lambda: api.minimize()),
        webview.menu.MenuAction("Maximize", lambda: api.toggle_maximize()),
        webview.menu.MenuAction("Close", lambda: api.close()),
    ]

    # Isolate WebView2 profile per ROM so two hosts don't share/clobber one profile
    storage = HERE / ".webview_profiles" / re_slug(TITLE_ROOT)
    storage.mkdir(parents=True, exist_ok=True)

    try:
        start_kwargs: dict = {"debug": _DEBUG, "storage_path": str(storage)}
        if _FRAMELESS:
            webview.start(**start_kwargs)
        else:
            try:
                menu = webview.menu.Menu("Deck Host", menu_items)
                webview.start(menu=[menu], **start_kwargs)
            except TypeError:
                # older pywebview without storage_path
                webview.start(menu=[menu], debug=_DEBUG)
            except Exception:
                try:
                    webview.start(**start_kwargs)
                except TypeError:
                    webview.start(debug=_DEBUG)
    finally:
        _kill_child()


def re_slug(s: str) -> str:
    import re as _re

    s = (s or "host").strip().lower()
    s = _re.sub(r"[^\w\-]+", "-", s)
    return s.strip("-") or "host"

if __name__ == "__main__":
    print(
        f"the-deck-host: frameless={'ON' if _FRAMELESS else 'OFF'}  "
        f"devtools={'ON' if _DEBUG else 'OFF'}"
    )
    if _FRAMELESS:
        print(
            "  caption: gem menu · Alt+M · Ctrl+N new · drag · size · "
            "Ctrl± zoom · F11 deep · Esc surface"
        )
    print("  profiles: desk · datbox · office · companion/rail")
    if not CAPTION_JS.is_file():
        print(f"  WARNING: missing {CAPTION_JS}")
    main()
