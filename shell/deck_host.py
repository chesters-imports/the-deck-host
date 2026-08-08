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
# Three tiers: compact < standard < expanded (+ maximized = OS max)
_MAG_COMPACT = (880, 560)
_MAG_SMALL = (1024, 768)  # standard
_MAG_LARGE = (1600, 1200)  # expanded
_MIN_SIZE = (640, 480)
_ON_TOP = False
_PROFILE = "desk"  # desk | companion
# Startup mode from --window-mode / env (applied at create + shown)
_START_WINDOW_MODE = "standard"

# Set in main() from CLI / env
HOME = LAUNCHER
BASE = ""  # optional prefix for relative go() paths


def apply_profile(name: str) -> None:
    """
    Window geometry by ROM kind — do NOT collapse everyone into one size.

    desk     — classic ROM 1024×768 (standard); compact + expanded rungs
    datbox   — legacy short bags (optional)
    office   — Big Box / document tools
    companion/rail — tall strip (Time Machina)
    """
    global _MAG_COMPACT, _MAG_SMALL, _MAG_LARGE, _MIN_SIZE, _ON_TOP, _PROFILE
    p = (name or "desk").strip().lower()
    if p in ("companion", "rail", "companion-rail", "strip"):
        _PROFILE = "companion"
        _MAG_COMPACT = (320, 620)
        _MAG_SMALL = (368, 740)
        _MAG_LARGE = (400, 920)
        _MIN_SIZE = (300, 420)
        _ON_TOP = True
    elif p in ("datbox", "dat-box", "short"):
        _PROFILE = "datbox"
        # short bags — kept for shotBOX etc.; lore prefers desk now
        _MAG_COMPACT = (800, 440)
        _MAG_SMALL = (960, 520)
        _MAG_LARGE = (1280, 800)
        _MIN_SIZE = (640, 400)
        _ON_TOP = False
    elif p in ("office", "bigbox", "bbc", "document"):
        _PROFILE = "office"
        _MAG_COMPACT = (1024, 680)
        _MAG_SMALL = (1280, 800)
        _MAG_LARGE = (1600, 1000)
        _MIN_SIZE = (900, 560)
        _ON_TOP = False
    else:
        _PROFILE = "desk"
        # Classic ROM desk — real window proportions
        _MAG_COMPACT = (880, 560)
        _MAG_SMALL = (1024, 768)
        _MAG_LARGE = (1600, 1200)
        _MIN_SIZE = (640, 480)
        _ON_TOP = False


def normalize_window_mode(mode: str | None) -> str:
    m = str(mode or "standard").strip().lower()
    if m in ("maximized", "maximize", "max"):
        return "maximized"
    if m in ("expanded", "large", "wide", "big"):
        return "expanded"
    if m in ("compact", "small", "mini", "short"):
        return "compact"
    return "standard"


def size_for_mode(mode: str) -> tuple[int, int]:
    m = normalize_window_mode(mode)
    if m == "expanded":
        return _MAG_LARGE
    if m == "compact":
        return _MAG_COMPACT
    if m == "maximized":
        # open at expanded then maximize on shown
        return _MAG_LARGE
    return _MAG_SMALL


class DeckHostApi:
    """JS bridge: window.pywebview.api.*"""

    def __init__(self, start_mode: str = "standard") -> None:
        self._window: webview.Window | None = None
        self._maximized = False
        self._mag_compact = _MAG_COMPACT
        self._mag_small = _MAG_SMALL
        self._mag_large_size = _MAG_LARGE
        # tier under the chrome: compact | standard | expanded
        self._tier = "standard"
        start = normalize_window_mode(start_mode)
        if start == "maximized":
            self._tier = "expanded"
            self._start_maximized = True
        elif start == "compact":
            self._tier = "compact"
            self._start_maximized = False
        elif start == "expanded":
            self._tier = "expanded"
            self._start_maximized = False
        else:
            self._tier = "standard"
            self._start_maximized = False
        self._normal_size = size_for_mode(
            "expanded" if self._start_maximized else self._tier
        )
        # legacy flag used by older step logic
        self._mag_large = self._tier == "expanded"
        self._allow_maximize = _PROFILE != "companion"
        self._startup_applied = False

    def bind(self, window: webview.Window) -> None:
        self._window = window

    def apply_startup_mode(self) -> str:
        """Call once window is shown — maximizes if prefs asked for it."""
        if self._startup_applied:
            return self._mode_payload()
        self._startup_applied = True
        if self._start_maximized and self._allow_maximize:
            return self.set_window_mode("maximized").get("payload") or self._mode_payload()
        # re-assert tier size (Windows sometimes ignores create size)
        return self.set_window_mode(self._tier).get("payload") or self._mode_payload()

    def minimize(self) -> None:
        if self._window:
            self._window.minimize()

    def toggle_maximize(self) -> str:
        """Toggle OS maximize. Returns mode payload for caption/ROM prefs."""
        if not self._window:
            return self._mode_payload()
        if not self._allow_maximize:
            return self.step_window_size()
        if self._maximized:
            w, h = self._normal_size
            try:
                self._window.restore()
                self._window.resize(w, h)
            except Exception:
                pass
            self._maximized = False
        else:
            try:
                self._normal_size = (int(self._window.width), int(self._window.height))
            except Exception:
                pass
            try:
                self._window.maximize()
                self._maximized = True
            except Exception:
                pass
        return self._mode_payload()

    def step_window_size(self) -> str:
        """Toggle standard ↔ expanded (compact only via set_window_mode / Settings)."""
        if not self._window:
            return ""
        try:
            if self._maximized:
                self._window.restore()
                self._maximized = False
        except Exception:
            pass

        if self._tier == "expanded":
            self._tier = "standard"
        else:
            # compact or standard → expanded
            self._tier = "expanded"
        self._mag_large = self._tier == "expanded"
        target = self._size_for_tier(self._tier)
        try:
            self._window.resize(target[0], target[1])
            self._normal_size = target
        except Exception:
            pass
        return self._mode_payload(target)

    def _size_for_tier(self, tier: str) -> tuple[int, int]:
        if tier == "expanded":
            return self._mag_large_size
        if tier == "compact":
            return self._mag_compact
        return self._mag_small

    def _mode_name(self) -> str:
        if self._maximized:
            return "maximized"
        return self._tier if self._tier in ("compact", "standard", "expanded") else "standard"

    def _mode_payload(self, size: tuple[int, int] | None = None) -> str:
        """'compact|standard|expanded|maximized:WxH' for caption/ROM."""
        if size is None:
            try:
                if self._window:
                    size = (int(self._window.width), int(self._window.height))
                else:
                    size = self._normal_size
            except Exception:
                size = self._normal_size
        return f"{self._mode_name()}:{size[0]}x{size[1]}"

    def get_window_mode(self) -> dict:
        """ROM prefs: compact | standard | expanded | maximized."""
        try:
            w = int(self._window.width) if self._window else self._normal_size[0]
            h = int(self._window.height) if self._window else self._normal_size[1]
        except Exception:
            w, h = self._normal_size
        return {
            "mode": self._mode_name(),
            "size": f"{w}x{h}",
            "compact": f"{self._mag_compact[0]}x{self._mag_compact[1]}",
            "standard": f"{self._mag_small[0]}x{self._mag_small[1]}",
            "expanded": f"{self._mag_large_size[0]}x{self._mag_large_size[1]}",
            "payload": self._mode_payload((w, h)),
            "allow_maximize": self._allow_maximize,
        }

    def _force_tier(self, tier: str) -> None:
        """Leave maximize; set compact | standard | expanded frame size."""
        tier = tier if tier in ("compact", "standard", "expanded") else "standard"
        self._tier = tier
        self._mag_large = tier == "expanded"
        target = self._size_for_tier(tier)
        self._normal_size = target
        if not self._window:
            return
        try:
            if self._maximized:
                self._window.restore()
                self._maximized = False
            self._window.resize(target[0], target[1])
        except Exception:
            pass

    def set_window_mode(self, mode: str = "standard") -> dict:
        """
        Apply compact | standard | expanded | maximized.
        Not exclusive F11 fullscreen (use Deep for immersion).
        """
        want_name = normalize_window_mode(mode)

        if not self._window:
            if want_name == "maximized":
                self._start_maximized = True
                self._tier = "expanded"
                self._mag_large = True
                self._normal_size = self._mag_large_size
            else:
                self._start_maximized = False
                self._tier = want_name if want_name != "maximized" else "standard"
                if self._tier not in ("compact", "standard", "expanded"):
                    self._tier = "standard"
                self._mag_large = self._tier == "expanded"
                self._normal_size = self._size_for_tier(self._tier)
            return self.get_window_mode()

        if want_name == "maximized":
            if not self._allow_maximize:
                self._force_tier("expanded")
                return self.get_window_mode()
            if not self._maximized:
                try:
                    self._normal_size = (
                        int(self._window.width),
                        int(self._window.height),
                    )
                except Exception:
                    pass
                try:
                    self._window.maximize()
                    self._maximized = True
                except Exception:
                    pass
            return self.get_window_mode()

        self._force_tier(want_name)
        return self.get_window_mode()

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
        # Re-apply size/maximize after surface is up (create size is often ignored
        # or reset; JS prefs also call set_window_mode as a second belt).
        def _startup() -> None:
            try:
                payload = api.apply_startup_mode()
                if _DEBUG:
                    print(f"[deck-host] startup window mode → {payload}", flush=True)
            except Exception as e:
                if _DEBUG:
                    print(f"[deck-host] startup window mode failed: {e}", flush=True)

        threading.Timer(0.15, _startup).start()
        threading.Timer(0.6, _startup).start()

    window.events.loaded += on_loaded


def spawn_deck_window(
    url: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> webview.Window:
    api = DeckHostApi(start_mode=_START_WINDOW_MODE)
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
    p.add_argument(
        "--window-mode",
        default=os.environ.get("DECK_HOST_WINDOW_MODE", "standard").strip()
        or "standard",
        help="Startup size: compact | standard | expanded | maximized",
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
    global HOME, BASE, TITLE_ROOT, _MAG_COMPACT, _MAG_SMALL, _MAG_LARGE, _MIN_SIZE, _ON_TOP
    global _START_WINDOW_MODE

    args = parse_args(argv)
    apply_profile(args.profile)
    if args.width and args.height:
        _MAG_SMALL = (args.width, args.height)
    elif args.width:
        _MAG_SMALL = (args.width, _MAG_SMALL[1])
    elif args.height:
        _MAG_SMALL = (_MAG_SMALL[0], args.height)
    # Custom standard size: height-first expand (not a jump to 1600×1200 landscape).
    # Optional explicit expanded via DECK_HOST_EXPANDED_WIDTH / _HEIGHT.
    ew = _env_int("DECK_HOST_EXPANDED_WIDTH")
    eh = _env_int("DECK_HOST_EXPANDED_HEIGHT")
    if ew and eh:
        _MAG_LARGE = (ew, eh)
    elif args.width and args.height:
        w, h = _MAG_SMALL
        _MAG_LARGE = (min(w + 48, max(w, 780)), min(h + 240, max(h + 160, 980)))
        _MAG_COMPACT = (max(_MIN_SIZE[0], w - 40), max(_MIN_SIZE[1], h - 60))
    if args.min_width or args.min_height:
        _MIN_SIZE = (
            args.min_width or _MIN_SIZE[0],
            args.min_height or _MIN_SIZE[1],
        )
    if args.on_top is not None:
        _ON_TOP = bool(args.on_top)
    _START_WINDOW_MODE = normalize_window_mode(args.window_mode)

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

    api = DeckHostApi(start_mode=_START_WINDOW_MODE)
    start_w, start_h = size_for_mode(_START_WINDOW_MODE)
    want_max = _START_WINDOW_MODE == "maximized" and _PROFILE != "companion"
    # Full-screen take-over (Receiver-style). Opt-in so normal ROMs stay windowed.
    want_fs = os.environ.get("DECK_HOST_FULLSCREEN", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    win_kw: dict = {
        "title": TITLE_ROOT,
        "url": HOME,
        "width": start_w,
        "height": start_h,
        "min_size": _MIN_SIZE,
        "background_color": "#0a0c12",
        "text_select": True,
        "frameless": _FRAMELESS,
        "easy_drag": False,
        "resizable": True,
        "shadow": True,
        "js_api": api,
        "maximized": want_max and not want_fs,
    }
    if want_max or want_fs:
        # Avoid random multi-monitor / off-origin spawn before maximize sticks
        win_kw["x"] = 0
        win_kw["y"] = 0
    if want_fs:
        win_kw["fullscreen"] = True
    if _ON_TOP:
        win_kw["on_top"] = True
    # older pywebview may not accept maximized= / fullscreen=
    try:
        window = webview.create_window(**win_kw)
    except TypeError:
        win_kw.pop("maximized", None)
        win_kw.pop("fullscreen", None)
        try:
            window = webview.create_window(**win_kw)
        except TypeError:
            win_kw.pop("x", None)
            win_kw.pop("y", None)
            window = webview.create_window(**win_kw)
    api.bind(window)
    if _START_WINDOW_MODE == "maximized":
        api._maximized = True
        api._start_maximized = True
    _attach_window_events(window, api)
    print(
        f"[deck-host] profile={_PROFILE}  "
        f"mode={_START_WINDOW_MODE}  "
        f"size={start_w}x{start_h}  "
        f"tiers compact={_MAG_COMPACT[0]}x{_MAG_COMPACT[1]} "
        f"standard={_MAG_SMALL[0]}x{_MAG_SMALL[1]} "
        f"expanded={_MAG_LARGE[0]}x{_MAG_LARGE[1]}  "
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
