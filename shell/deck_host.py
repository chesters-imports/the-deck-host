"""
The Deck Host — window runtime for ROMs.

  cd the-deck-host/shell
  pip install -r requirements.txt
  python deck_host.py
  python deck_host.py --url http://127.0.0.1:42929/

No args opens ROM Launcher (the default product). --url / --spawn / --rom-dir
run a single cart instead.

Env:
  DECK_HOST_URL          entry URL (overrides default launcher)
  DECK_HOST_BASE         base for relative go() paths (optional)
  DECK_HOST_FRAMELESS=0  OS title bar + optional menu
  DECK_HOST_DEBUG=0      DevTools off
  DECK_HOST_ROMS         seated-cart shelf (else %LOCALAPPDATA%/DeckHost/roms)

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
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    import webview
except ImportError:
    print("pip install pywebview")
    sys.exit(1)

def _frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def runtime_dir() -> Path:
    """Folder next to the running exe (or this script). Ship files live here."""
    if _frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def bundle_dir() -> Path:
    """PyInstaller extract dir, or this script's folder."""
    if _frozen():
        return Path(getattr(sys, "_MEIPASS", runtime_dir()))
    return Path(__file__).resolve().parent


HERE = runtime_dir()
_BUNDLE = bundle_dir()
LAUNCHER = (_BUNDLE / "launcher.html").as_uri()
CAPTION_JS = _BUNDLE / "caption.js"
LAUNCHER_PORT = 43170
LAUNCHER_HTTP = f"http://127.0.0.1:{LAUNCHER_PORT}/"
LAUNCHER_HEALTH = f"http://127.0.0.1:{LAUNCHER_PORT}/api/health"


def _attach_stdio() -> None:
    """Windowed PyInstaller: stdout is None, or a charmap handle that dies on arrows."""
    log_path = runtime_dir() / "deck-host.log"
    try:
        fh = open(log_path, "a", encoding="utf-8", errors="replace")
    except OSError:
        fh = None
    if fh is not None:
        fh.write("\n--- deck-host start ---\n")
        fh.flush()
    if _frozen() or sys.stdout is None or sys.stderr is None:
        if fh is not None:
            sys.stdout = fh
            sys.stderr = fh
        return
    for stream in (sys.stdout, sys.stderr):
        reconf = getattr(stream, "reconfigure", None)
        if callable(reconf):
            try:
                reconf(encoding="utf-8", errors="replace")
            except Exception:
                pass
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
        self._rail = False
        self._lock_size = False
        self._restore_geom: dict | None = None
        self._layout_key = "desk"

    def bind(self, window: webview.Window) -> None:
        self._window = window
        _API_BY_WINDOW[id(window)] = self

    def apply_startup_mode(self) -> str:
        """Call once window is shown — maximizes if prefs asked for it."""
        if self._startup_applied:
            return self._mode_payload()
        self._startup_applied = True
        geom = self._restore_geom
        if geom and self._window:
            try:
                x, y, w, h = _clamp_geom(
                    int(geom["x"]), int(geom["y"]), int(geom["w"]), int(geom["h"])
                )
                self._window.resize(w, h)
                self._window.move(x, y)
                self._normal_size = (w, h)
            except Exception:
                pass
            if geom.get("maximized") and self._allow_maximize:
                return (
                    self.set_window_mode("maximized").get("payload")
                    or self._mode_payload()
                )
            return self._mode_payload()
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
        if getattr(self, "_rail", False):
            if self._window:
                self._window.destroy()
            return
        others = [w for w in _DESKS if w is not self._window]
        if others:
            if self._window:
                self._window.destroy()
            return
        _quit_host()

    def home(self) -> None:
        """Deck: open or focus ROM Launcher. Does not replace this ROM's page."""
        self.open_deck()

    def open_deck(self) -> str:
        """Open / focus ROM Launcher (the default Deck Host product)."""
        if is_launcher_surface():
            if self._window:
                try:
                    self._window.restore()
                    self._window.show()
                except Exception:
                    pass
            return "here"
        if focus_window_title("LAUNCH"):
            return "focus"
        if spawn_rom_launcher():
            return "spawn"
        return "err"

    def pick_folder(self) -> str:
        """Native folder picker (launcher Install)."""
        return self._file_dialog("FOLDER")

    def pick_archive(self) -> str:
        """Native .rom picker (zip payload). .zip still accepted."""
        return self._file_dialog(
            "OPEN",
            file_types=("ROM cart (*.rom)", "Zip (*.zip)"),
        )

    def _file_dialog(
        self, kind: str, file_types: tuple[str, ...] | None = None
    ) -> str:
        if not self._window:
            return ""
        dialog = None
        fd = getattr(webview, "FileDialog", None)
        if fd is not None:
            dialog = getattr(fd, kind, None)
        if dialog is None:
            legacy = {"FOLDER": "FOLDER_DIALOG", "OPEN": "OPEN_DIALOG"}
            dialog = getattr(webview, legacy.get(kind, ""), None)
        if dialog is None:
            return ""
        try:
            kw: dict = {}
            if file_types:
                kw["file_types"] = list(file_types)
            result = self._window.create_file_dialog(dialog, **kw)
            if result:
                return str(result[0])
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] file dialog failed: {e}")
        return ""

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

    def open_external(self, url: str = "") -> str:
        """Open http(s) in the OS browser. Does not navigate this window."""
        dest = (url or "").strip()
        if not dest.startswith(("http://", "https://")):
            return "err:url"
        if any(c in dest for c in "\n\r\t"):
            return "err:url"
        try:
            webbrowser.open(dest, new=2)
        except Exception as e:
            return f"err:{e}"
        return "ok"

    def hard_refresh(self) -> None:
        """Chip menu: stop the ROM server, start it again, reload this window."""
        if not self._window:
            return
        if _spawn_command:
            restart_rom_server()
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

    def new_window(
        self,
        url: str = "",
        width: int = 0,
        height: int = 0,
        min_width: int = 0,
        min_height: int = 0,
        title: str = "",
        house: str = "",
    ) -> str:
        """Another Deck Host window. Ctrl+N = same ROM. ROMs may pass a child URL + rail size."""
        try:
            dest = _safe_child_url(str(url or ""))
            key = str(house or "").strip().lower()
            if key and key in _SIDECARS:
                existing = _SIDECARS[key]
                try:
                    existing.restore()
                    existing.show()
                    return "ok"
                except Exception:
                    _SIDECARS.pop(key, None)
            wdt = _as_pos_int(width)
            hgt = _as_pos_int(height)
            rail = bool(key) or bool(wdt and hgt)
            lock_size = False
            saved = (_load_layout().get("houses") or {}).get(key) if key else {}
            if not isinstance(saved, dict):
                saved = {}
            if rail and not wdt:
                wdt = _as_pos_int(saved.get("w")) or 420
                hgt = _as_pos_int(saved.get("h")) or 760
            elif saved:
                if not wdt:
                    wdt = _as_pos_int(saved.get("w"))
                if not hgt:
                    hgt = _as_pos_int(saved.get("h"))
            mw, mh = _as_pos_int(min_width), _as_pos_int(min_height)
            min_size = (mw, mh) if mw and mh else ((300, 420) if rail else None)
            gx, gy = None, None
            if "x" in saved and "y" in saved:
                gx, gy = saved.get("x"), saved.get("y")
            w = spawn_deck_window(
                url=dest,
                width=wdt or None,
                height=hgt or None,
                min_size=min_size,
                title=str(title or "").strip() or None,
                rail=rail,
                lock_size=lock_size,
                x=gx,
                y=gy,
                layout_key=key or ("desk" if not rail else ""),
                restore_geom=saved or None,
            )
            if key:
                _track_sidecar(key, w)
            return "ok"
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] new_window failed: {e}")
            return f"err:{e}"


    def resize(self, spec: str = "") -> str:
        """JS: pywebview.api.resize('440x760') or '440x760@120,80' (keep a screen edge)."""
        if getattr(self, "_lock_size", False) and self._startup_applied:
            w0, h0 = self._normal_size
            return f"{w0}x{h0}"
        spec = str(spec or "").strip().lower().replace(" ", "")
        pos = None
        if "@" in spec:
            spec, _, xy = spec.partition("@")
            xs, _, ys = xy.partition(",")
            try:
                pos = (int(xs), int(ys))
            except ValueError:
                pos = None
        if "x" not in spec or self._window is None:
            return "err:size"
        left, _, right = spec.partition("x")
        try:
            w, h = int(left), int(right)
        except ValueError:
            return "err:size"
        w = max(320, min(w, 2400))
        h = max(240, min(h, 1800))
        try:
            self._window.restore()
        except Exception:
            pass
        try:
            self._window.resize(w, h)
            if pos is not None:
                try:
                    self._window.move(pos[0], pos[1])
                except Exception:
                    pass
            self._normal_size = (w, h)
            self._maximized = False
            _schedule_save()
        except Exception as e:
            return f"err:{e}"
        return f"{w}x{h}"


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


def _mute_native_status_bar(window: webview.Window) -> bool:
    """Hide Edge/WebView2's hover-URL pill. Must run on the WinForms UI thread."""
    native = getattr(window, "native", None)
    if native is None:
        return False
    wv = getattr(native, "webview", None)
    if wv is None:
        browser = getattr(native, "browser", None)
        wv = getattr(browser, "webview", None) if browser is not None else None
    if wv is None:
        return False

    def apply() -> bool:
        try:
            core = getattr(wv, "CoreWebView2", None)
            settings = getattr(core, "Settings", None) if core is not None else None
            if settings is None:
                return False
            settings.IsStatusBarEnabled = False
            return True
        except Exception as e:
            print(f"[deck-host] mute status apply failed: {e}", flush=True)
            return False

    try:
        invoke = getattr(wv, "Invoke", None)
        if callable(invoke):
            box = [False]

            def wrapped() -> None:
                box[0] = apply()

            try:
                from System import Action

                invoke(Action(wrapped))
            except Exception:
                invoke(wrapped)
            return bool(box[0])
        return apply()
    except Exception as e:
        print(f"[deck-host] mute status invoke failed: {e}", flush=True)
        return False


def _hook_status_bar_off(window: webview.Window) -> None:
    """Subscribe so we win even if pywebview turns the pill back on at init."""
    native = getattr(window, "native", None)
    wv = getattr(native, "webview", None) if native is not None else None
    if wv is None:
        return
    if getattr(wv, "_deck_status_hooked", False):
        return

    def on_ready(sender, args) -> None:
        try:
            sender.CoreWebView2.Settings.IsStatusBarEnabled = False
        except Exception:
            pass

    try:
        wv.CoreWebView2InitializationCompleted += on_ready
        wv._deck_status_hooked = True
    except Exception:
        pass


def _native_hwnd(window: webview.Window) -> tuple[object | None, int]:
    """WinForms handle for DWM / style tweaks. (native, hwnd) or (None, 0)."""
    native = getattr(window, "native", None)
    if native is None:
        return None, 0
    try:
        handle = getattr(native, "Handle", None)
        if handle is None:
            return native, 0
        to_int = getattr(handle, "ToInt64", None) or getattr(handle, "ToInt32", None)
        hwnd = int(to_int()) if callable(to_int) else int(handle)
    except Exception:
        return native, 0
    return native, hwnd


def _invoke_native(native: object, fn) -> bool:
    invoke = getattr(native, "Invoke", None)
    if not callable(invoke):
        return bool(fn())
    box = [False]

    def wrapped() -> None:
        box[0] = bool(fn())

    try:
        from System import Action

        invoke(Action(wrapped))
    except Exception:
        try:
            invoke(wrapped)
        except Exception:
            return bool(fn())
    return bool(box[0])


# Keep WNDPROC callbacks alive (ctypes will crash if GC collects them).
_NCCALC_HOOKS: dict[int, tuple] = {}
_GWL_WNDPROC = -4
_WM_NCCALCSIZE = 0x0083


def _install_nccalcsize_hook(hwnd: int) -> bool:
    """Client area = full window. WS_THICKFRAME otherwise paints a Win11 caption band."""
    if not hwnd or hwnd in _NCCALC_HOOKS:
        return hwnd in _NCCALC_HOOKS
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        is64 = ctypes.sizeof(ctypes.c_void_p) == 8
        LRESULT = ctypes.c_int64 if is64 else ctypes.c_long
        WNDPROC = ctypes.WINFUNCTYPE(
            LRESULT,
            wintypes.HWND,
            ctypes.c_uint,
            wintypes.WPARAM,
            wintypes.LPARAM,
        )
        if is64:
            get_long = user32.GetWindowLongPtrW
            set_long = user32.SetWindowLongPtrW
            call_proc = user32.CallWindowProcW
        else:
            get_long = user32.GetWindowLongW
            set_long = user32.SetWindowLongW
            call_proc = user32.CallWindowProcW
        get_long.argtypes = [wintypes.HWND, ctypes.c_int]
        get_long.restype = ctypes.c_void_p
        set_long.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
        set_long.restype = ctypes.c_void_p
        call_proc.argtypes = [
            ctypes.c_void_p,
            wintypes.HWND,
            ctypes.c_uint,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        call_proc.restype = LRESULT

        orig = get_long(hwnd, _GWL_WNDPROC)
        if not orig:
            return False

        def _wndproc(h, msg, wparam, lparam):
            # wParam TRUE: returning 0 makes the client rect the window rect
            # (no OS caption strip). Edge resize stays via JS grips + THICKFRAME.
            if msg == _WM_NCCALCSIZE and wparam:
                return 0
            return call_proc(orig, h, msg, wparam, lparam)

        cb = WNDPROC(_wndproc)
        set_long(hwnd, _GWL_WNDPROC, ctypes.cast(cb, ctypes.c_void_p).value)
        _NCCALC_HOOKS[hwnd] = (cb, orig)
        return True
    except Exception as e:
        if _DEBUG:
            print(f"[deck-host] nccalcsize hook: {e}", flush=True)
        return False


def _mute_dwm_caption_band(window: webview.Window) -> bool:
    """Stop DWM from painting a Mica/caption band into the client area.

    pywebview turns on shadow via DwmExtendFrameIntoClientArea and, on a
    dark Windows theme, DWMWA_SYSTEMBACKDROP_TYPE=MAINWINDOW. WS_THICKFRAME
    (OS-edge resize) makes Win11 draw a black caption strip on top of ROM
    chrome. Keep side/bottom glass for the drop shadow; hide the top caption.
    """
    if sys.platform != "win32" or not _FRAMELESS:
        return True
    native, hwnd = _native_hwnd(window)
    if native is None or not hwnd:
        return False

    def apply() -> bool:
        try:
            import ctypes

            class _MARGINS(ctypes.Structure):
                _fields_ = [
                    ("cxLeftWidth", ctypes.c_int),
                    ("cxRightWidth", ctypes.c_int),
                    ("cyTopHeight", ctypes.c_int),
                    ("cyBottomHeight", ctypes.c_int),
                ]

            dwmapi = ctypes.windll.dwmapi
            m = _MARGINS()
            m.cxLeftWidth = 1
            m.cxRightWidth = 1
            m.cyTopHeight = 0
            m.cyBottomHeight = 1
            dwmapi.DwmExtendFrameIntoClientArea(hwnd, ctypes.byref(m))
            # DWMWA_SYSTEMBACKDROP_TYPE = 38, DWMSBT_NONE = 1
            none = ctypes.c_int(1)
            dwmapi.DwmSetWindowAttribute(
                hwnd, 38, ctypes.byref(none), ctypes.sizeof(none)
            )
            # Win11 22000+: hide DWM caption fill (0xFFFFFFFE = DWMWA_COLOR_NONE)
            color_none = ctypes.c_uint32(0xFFFFFFFE)
            dwmapi.DwmSetWindowAttribute(
                hwnd, 35, ctypes.byref(color_none), ctypes.sizeof(color_none)
            )
            _install_nccalcsize_hook(hwnd)
            return True
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] dwm caption mute: {e}", flush=True)
            return False

    return _invoke_native(native, apply)


def _enable_frameless_os_resize(window: webview.Window) -> bool:
    """Frameless Win32: restore a thick frame so OS edges resize like a browser."""
    if sys.platform != "win32" or not _FRAMELESS:
        return True
    native, hwnd = _native_hwnd(window)
    if native is None or not hwnd:
        return False

    def apply() -> bool:
        try:
            import ctypes

            user32 = ctypes.windll.user32
            GWL_STYLE = -16
            WS_CAPTION = 0x00C00000
            WS_THICKFRAME = 0x00040000
            WS_MINIMIZEBOX = 0x00020000
            WS_MAXIMIZEBOX = 0x00010000
            SWP_NOSIZE = 0x0001
            SWP_NOMOVE = 0x0002
            SWP_NOZORDER = 0x0004
            SWP_FRAMECHANGED = 0x0020
            if ctypes.sizeof(ctypes.c_void_p) == 8:
                get_style = user32.GetWindowLongPtrW
                set_style = user32.SetWindowLongPtrW
                get_style.restype = ctypes.c_longlong
                set_style.restype = ctypes.c_longlong
            else:
                get_style = user32.GetWindowLongW
                set_style = user32.SetWindowLongW
            style = int(get_style(hwnd, GWL_STYLE))
            style |= WS_THICKFRAME | WS_MAXIMIZEBOX | WS_MINIMIZEBOX
            # THICKFRAME implies a Win11 title band unless CAPTION is cleared.
            style &= ~WS_CAPTION
            set_style(hwnd, GWL_STYLE, style)
            _install_nccalcsize_hook(hwnd)
            user32.SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            )
            return True
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] os resize: {e}", flush=True)
            return False

    return _invoke_native(native, apply)


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
            page = ""
            try:
                raw = window.evaluate_js(
                    "(function(){try{return String(document.title||'');}catch(e){return '';}})()"
                )
                page = str(raw or "").strip().strip('"').strip("'")
            except Exception:
                page = ""
            if page:
                window.set_title(page)
                short = page
            else:
                window.set_title(full if not _FRAMELESS else short)
        except Exception:
            pass
        try:
            window.evaluate_js(_KEY_BRIDGE_JS)
        except Exception:
            pass
        inject_caption(short)

        def _mute(n: int = 0) -> None:
            _hook_status_bar_off(window)
            if _mute_native_status_bar(window):
                if _DEBUG and n == 0:
                    print("[deck-host] Edge status bar muted", flush=True)
                return
            if n < 12:
                threading.Timer(0.25, lambda: _mute(n + 1)).start()

        def _os_resize(n: int = 0) -> None:
            _enable_frameless_os_resize(window)
            _mute_dwm_caption_band(window)
            if n < 6:
                threading.Timer(0.35, lambda: _os_resize(n + 1)).start()

        _mute(0)
        _os_resize(0)

        # Re-apply size/maximize after surface is up (create size is often ignored
        # or reset; JS prefs also call set_window_mode as a second belt).
        # Companion rails keep the size they were spawned with — never fight JS,
        # never snap to 640×480 on each loaded URL.
        def _startup() -> None:
            try:
                if getattr(api, "_rail", False):
                    _apply_restore_geom(window, api)
                    return
                url = ""
                try:
                    url = window.get_current_url() or ""
                except Exception:
                    url = ""
                if "sidecar=" in url:
                    api._rail = True
                    api._startup_applied = True
                    api._allow_maximize = False
                    api._start_maximized = False
                    api._maximized = False
                    if _apply_restore_geom(window, api):
                        api._tier = "compact"
                        return
                    w, h = api._normal_size or (440, 760)
                    if w >= 600 or h <= 520:
                        w, h = 440, 760
                    try:
                        window.resize(w, h)
                    except Exception:
                        pass
                    api._normal_size = (w, h)
                    api._tier = "compact"
                    return
                payload = api.apply_startup_mode()
                if _DEBUG:
                    print(f"[deck-host] startup window mode -> {payload}", flush=True)
                threading.Timer(0.9, _restore_open_houses).start()
            except Exception as e:
                if _DEBUG:
                    print(f"[deck-host] startup window mode failed: {e}", flush=True)

        threading.Timer(0.15, _startup).start()
        threading.Timer(0.6, _startup).start()

    def on_geom(*_a: object, **_k: object) -> None:
        _schedule_save()

    def on_frame(*_a: object, **_k: object) -> None:
        _schedule_save()
        # Win11 re-paints the caption band after snap / maximize / restore.
        _mute_dwm_caption_band(window)

    def on_shown(*_a: object, **_k: object) -> None:
        _apply_restore_geom(window, api)
        if not getattr(api, "_rail", False):
            threading.Timer(0.85, _restore_open_houses).start()

    def on_closing(*_a: object, **_k: object) -> None:
        key = str(getattr(api, "_layout_key", "") or "")
        if getattr(api, "_rail", False) or (key and key != "desk"):
            if key:
                _remember_house(key, window, open_=False)
        else:
            _remember_desk(window)
        if not _QUITTING:
            _save_layout()

    window.events.loaded += on_loaded
    for ev_name, handler in (
        ("moved", on_geom),
        ("resized", on_frame),
        ("maximized", on_frame),
        ("restored", on_frame),
        ("shown", on_shown),
        ("closing", on_closing),
    ):
        try:
            ev = getattr(window.events, ev_name)
            ev += handler
        except Exception:
            pass
    if not getattr(api, "_rail", False):
        _register_desk(window)


_SIDECARS: dict[str, webview.Window] = {}
_DESKS: list[webview.Window] = []
_QUITTING = False


def _quit_host() -> None:
    """Close every cabinet and desk, then stop the ROM server. Exit the application."""
    global _QUITTING, _SAVE_TIMER
    if _QUITTING:
        return
    try:
        _save_layout(force=True)
    except Exception:
        pass
    with _LAYOUT_LOCK:
        if _SAVE_TIMER is not None:
            try:
                _SAVE_TIMER.cancel()
            except Exception:
                pass
            _SAVE_TIMER = None
    _QUITTING = True
    rails = list(_SIDECARS.values())
    _SIDECARS.clear()
    for w in rails:
        try:
            w.destroy()
        except Exception:
            pass
    desks = list(_DESKS)
    _DESKS.clear()
    for w in desks:
        try:
            w.destroy()
        except Exception:
            pass
    _kill_child()


def _register_desk(window: webview.Window) -> None:
    if window not in _DESKS:
        _DESKS.append(window)

    def _gone() -> None:
        if _QUITTING:
            return
        try:
            _DESKS.remove(window)
        except ValueError:
            pass
        if not _DESKS:
            _quit_host()

    try:
        window.events.closed += _gone
    except Exception:
        pass


def _as_pos_int(v: object) -> int:
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


def _safe_child_url(url: str) -> str:
    """Same-origin child pages only. Empty → this ROM's home."""
    url = (url or "").strip()
    home = (HOME or "").strip()
    if not url:
        return home
    if url.startswith("/") and not url.startswith("//"):
        origin = home.split("/", 3)
        base = "/".join(origin[:3]) if home.startswith("http") else home.rstrip("/")
        return base.rstrip("/") + url
    try:
        child = urlparse(url)
        parent = urlparse(home)
    except Exception:
        return home
    if child.scheme not in ("http", "https"):
        return home
    host_ok = (child.hostname or "") in ("127.0.0.1", "localhost")
    parent_host = (parent.hostname or "") in ("127.0.0.1", "localhost")
    if not (host_ok and parent_host):
        return home
    if child.port and parent.port and child.port != parent.port:
        return home
    return url


def _url_on_home(url: str, fallback_path: str = "") -> str:
    """Keep path/query, retarget onto this ROM's origin (ports change between launches)."""
    home = (HOME or "").strip()
    raw = (url or "").strip() or (fallback_path or "")
    if not raw:
        return home
    if raw.startswith("/") and not raw.startswith("//"):
        return _safe_child_url(raw)
    try:
        child = urlparse(raw)
        parent = urlparse(home)
        if child.scheme in ("http", "https") and (child.hostname or "") in (
            "127.0.0.1",
            "localhost",
        ):
            path = child.path or "/"
            return urlunparse(
                (parent.scheme or child.scheme, parent.netloc, path, "", child.query, "")
            )
    except Exception:
        pass
    return _safe_child_url(raw)


_API_BY_WINDOW: dict[int, DeckHostApi] = {}
_LAYOUT_LOCK = threading.Lock()
_SAVE_TIMER: threading.Timer | None = None
_HOUSES_RESTORED = False
_LAST_DESK: dict | None = None
_LAST_HOUSES: dict[str, dict] = {}


def _layout_path() -> Path:
    folder = HERE / ".webview_profiles" / re_slug(TITLE_ROOT)
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "layout.json"


def _virtual_screen() -> tuple[int, int, int, int]:
    """Virtual desktop origin + size (multi-monitor). x/y may be negative."""
    if sys.platform == "win32":
        try:
            import ctypes

            user32 = ctypes.windll.user32
            return (
                int(user32.GetSystemMetrics(76)),
                int(user32.GetSystemMetrics(77)),
                int(user32.GetSystemMetrics(78)),
                int(user32.GetSystemMetrics(79)),
            )
        except Exception:
            pass
    return (0, 0, 3840, 2160)


def _clamp_geom(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    vx, vy, vw, vh = _virtual_screen()
    w = max(320, min(int(w), 2400))
    h = max(240, min(int(h), 1800))
    x = int(x)
    y = int(y)
    if vw > 0:
        if x + 80 < vx:
            x = vx
        if x > vx + vw - 80:
            x = vx + max(0, vw - min(w, vw))
    if vh > 0:
        if y + 40 < vy:
            y = vy
        if y > vy + vh - 40:
            y = vy
    return x, y, w, h


def _geom_of(window: webview.Window | None) -> dict | None:
    if window is None:
        return None
    try:
        x, y = int(window.x), int(window.y)
        w, h = int(window.width), int(window.height)
    except Exception:
        return None
    x, y, w, h = _clamp_geom(x, y, w, h)
    return {"x": x, "y": y, "w": w, "h": h}


def _apply_restore_geom(window: webview.Window | None, api: DeckHostApi) -> bool:
    geom = getattr(api, "_restore_geom", None)
    if not geom or not window:
        return False
    if getattr(api, "_maximized", False):
        return True
    try:
        x, y, w, h = _clamp_geom(
            int(geom["x"]), int(geom["y"]), int(geom["w"]), int(geom["h"])
        )
        window.resize(w, h)
        window.move(x, y)
        api._normal_size = (w, h)
        return True
    except Exception:
        return False


def _remember_desk(window: webview.Window | None) -> None:
    global _LAST_DESK
    g = _geom_of(window)
    if not g:
        return
    api = _API_BY_WINDOW.get(id(window)) if window is not None else None
    if api is not None:
        g["maximized"] = bool(getattr(api, "_maximized", False))
        if g["maximized"]:
            ns = getattr(api, "_normal_size", None)
            if ns and int(ns[0]) > 0 and int(ns[1]) > 0:
                g["w"], g["h"] = int(ns[0]), int(ns[1])
    _LAST_DESK = g


def _remember_house(key: str, window: webview.Window | None, *, open_: bool) -> None:
    key = str(key or "").strip().lower()
    if not key:
        return
    prev = dict(_LAST_HOUSES.get(key) or {})
    g = _geom_of(window)
    if g:
        url = ""
        try:
            url = (window.get_current_url() if window is not None else "") or ""
        except Exception:
            url = str(prev.get("url") or "")
        _LAST_HOUSES[key] = {**g, "url": url, "open": bool(open_)}
        return
    if prev:
        prev["open"] = bool(open_)
        _LAST_HOUSES[key] = prev


def _load_layout() -> dict:
    try:
        raw = json.loads(_layout_path().read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
    except Exception:
        pass
    return {}


def _save_layout(*, force: bool = False) -> None:
    global _LAST_DESK
    if _QUITTING and not force:
        return
    prev = _load_layout()
    desk_rec = None
    if _DESKS:
        _remember_desk(_DESKS[0])
        desk_rec = _LAST_DESK
    if desk_rec is None:
        desk_rec = _LAST_DESK
    if desk_rec is None:
        prev_desk = prev.get("desk")
        if isinstance(prev_desk, dict):
            desk_rec = dict(prev_desk)
    houses: dict = {}
    prev_houses = prev.get("houses") or {}
    if isinstance(prev_houses, dict):
        for k, rec in prev_houses.items():
            if isinstance(rec, dict):
                houses[str(k)] = dict(rec)
                houses[str(k)]["open"] = False
    for k, rec in _LAST_HOUSES.items():
        if isinstance(rec, dict):
            houses[str(k)] = dict(rec)
            houses[str(k)]["open"] = False
    for key, w in list(_SIDECARS.items()):
        _remember_house(str(key), w, open_=True)
        rec = _LAST_HOUSES.get(str(key))
        if rec:
            houses[str(key)] = {**rec, "open": True}
    data = {"desk": desk_rec, "houses": houses}
    try:
        path = _layout_path()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
    except Exception as e:
        if _DEBUG:
            print(f"[deck-host] layout save failed: {e}", flush=True)


def _schedule_save() -> None:
    global _SAVE_TIMER
    if _QUITTING:
        return

    def _go() -> None:
        _save_layout()

    with _LAYOUT_LOCK:
        if _SAVE_TIMER is not None:
            try:
                _SAVE_TIMER.cancel()
            except Exception:
                pass
        _SAVE_TIMER = threading.Timer(0.5, _go)
        _SAVE_TIMER.daemon = True
        _SAVE_TIMER.start()


def _track_sidecar(key: str, window: webview.Window) -> None:
    _SIDECARS[key] = window
    _remember_house(key, window, open_=True)

    def _drop() -> None:
        _remember_house(key, window, open_=False)
        if _SIDECARS.get(key) is window:
            _SIDECARS.pop(key, None)
        _API_BY_WINDOW.pop(id(window), None)
        if not _QUITTING:
            _save_layout()

    try:
        window.events.closed += _drop
    except Exception:
        pass
    _schedule_save()


def _restore_open_houses() -> None:
    global _HOUSES_RESTORED
    if _HOUSES_RESTORED:
        return
    _HOUSES_RESTORED = True
    if _QUITTING:
        return
    houses = _load_layout().get("houses") or {}
    if not isinstance(houses, dict):
        return
    restored = 0
    for key, rec in houses.items():
        key = str(key or "").strip().lower()
        if not key or key == "desk" or not isinstance(rec, dict) or not rec.get("open"):
            continue
        if key in _SIDECARS:
            continue
        url = str(rec.get("url") or "").strip()
        dest = _url_on_home(url, "/?sidecar=" + key)
        wdt = _as_pos_int(rec.get("w")) or 440
        hgt = _as_pos_int(rec.get("h")) or 760
        try:
            w = spawn_deck_window(
                url=dest,
                width=wdt,
                height=hgt,
                min_size=(300, 420),
                rail=True,
                lock_size=False,
                x=rec.get("x"),
                y=rec.get("y"),
                layout_key=key,
                restore_geom=rec,
            )
            _track_sidecar(key, w)
            restored += 1
        except Exception as e:
            if _DEBUG:
                print(f"[deck-host] restore {key} failed: {e}", flush=True)
    if restored:
        print(f"[deck-host] restore {restored} house(s)", flush=True)
    if _DESKS:
        try:
            _DESKS[0].show()
        except Exception:
            pass


def spawn_deck_window(
    url: str | None = None,
    width: int | None = None,
    height: int | None = None,
    min_size: tuple[int, int] | None = None,
    title: str | None = None,
    on_top: bool | None = None,
    rail: bool = False,
    lock_size: bool | None = None,
    x: object = None,
    y: object = None,
    layout_key: str = "",
    restore_geom: dict | None = None,
) -> webview.Window:
    api = DeckHostApi(start_mode=_START_WINDOW_MODE)
    wdt = width or _MAG_SMALL[0]
    hgt = height or _MAG_SMALL[1]
    if rail:
        api._rail = True
        api._startup_applied = True
        api._lock_size = True if lock_size is None else bool(lock_size)
        api._mag_compact = (max(300, wdt - 60), max(560, hgt - 120))
        api._mag_small = (wdt, hgt)
        api._mag_large_size = (wdt + 60, hgt + 160)
        api._allow_maximize = False
        api._tier = "standard"
        api._start_maximized = False
        api._normal_size = (wdt, hgt)
    if restore_geom:
        api._restore_geom = dict(restore_geom)
    if layout_key:
        api._layout_key = str(layout_key)
    kw: dict = {
        "title": title or TITLE_ROOT,
        "url": url or HOME,
        "width": wdt,
        "height": hgt,
        "min_size": min_size or _MIN_SIZE,
        "background_color": "#0a0c12",
        "text_select": True,
        "frameless": _FRAMELESS,
        "easy_drag": False,
        "resizable": True,
        "shadow": True,
        "js_api": api,
    }
    try:
        if x is not None and y is not None:
            cx, cy, cw, ch = _clamp_geom(int(x), int(y), wdt, hgt)
            kw["x"] = cx
            kw["y"] = cy
            kw["width"] = cw
            kw["height"] = ch
            api._normal_size = (cw, ch)
    except (TypeError, ValueError):
        pass
    top = _ON_TOP if on_top is None else bool(on_top)
    if top:
        kw["on_top"] = True
    try:
        w = webview.create_window(**kw)
    except TypeError:
        kw.pop("x", None)
        kw.pop("y", None)
        w = webview.create_window(**kw)
    api.bind(w)
    _attach_window_events(w, api)
    return w


_child: subprocess.Popen | None = None
_spawn_command: str | list[str] | None = None
_spawn_cwd: Path | None = None
_health_url: str | None = None
_health_timeout: float = 20.0


def _kill_listeners(url: str) -> None:
    """Free the ROM port after a server we may not have spawned."""
    if sys.platform != "win32":
        return
    port = urlparse(url).port
    if not port:
        return
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return
    needle = f":{port}"
    pids: set[int] = set()
    for line in out.stdout.splitlines():
        if "LISTENING" not in line or needle not in line:
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pid = int(parts[-1])
            if pid > 0:
                pids.add(pid)
    for pid in pids:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )


def restart_rom_server() -> bool:
    """Stop this ROM's server and start it again. Page reload is the caller's job."""
    if not _spawn_command or _spawn_cwd is None:
        return False
    _kill_child()
    if _health_url:
        _kill_listeners(_health_url)
        time.sleep(0.4)
    try:
        start_rom_process(_spawn_command, _spawn_cwd)
    except Exception as e:
        print(f"[deck-host] restart failed: {e}", file=sys.stderr)
        return False
    if _health_url and not wait_for_url(_health_url, timeout=_health_timeout):
        print(f"[deck-host] restart timed out waiting for {_health_url}", file=sys.stderr)
        return False
    print("[deck-host] ROM restarted")
    return True


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


_rom_httpd: ThreadingHTTPServer | None = None


def _shutdown_rom_httpd() -> None:
    global _rom_httpd
    httpd = _rom_httpd
    _rom_httpd = None
    if httpd is None:
        return
    try:
        httpd.shutdown()
    except Exception:
        pass
    try:
        httpd.server_close()
    except Exception:
        pass


def serve_rom_dir(rom_dir: Path, host: str = "127.0.0.1", port: int = 0) -> str:
    """Serve a ROM folder in-process. Returns the entry URL (trailing slash)."""
    global _rom_httpd
    rom_dir = rom_dir.resolve()
    if not rom_dir.is_dir():
        raise FileNotFoundError(f"rom dir missing: {rom_dir}")

    class RomHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(rom_dir), **kwargs)

        def log_message(self, fmt: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/api/health":
                body = json.dumps(
                    {"ok": True, "service": "deck-host-rom", "rom": rom_dir.name}
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if path in ("/", ""):
                self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)

    httpd = ThreadingHTTPServer((host, int(port)), RomHandler)
    _rom_httpd = httpd
    bound = int(httpd.server_address[1])
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    atexit.register(_shutdown_rom_httpd)
    url = f"http://{host}:{bound}/"
    print(f"[deck-host] in-process ROM  {rom_dir}  ->  {url}")
    return url


def load_rom_manifest(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[deck-host] bad rom.manifest: {path} ({e})", file=sys.stderr)
        return {}
    return data if isinstance(data, dict) else {}


def find_rom_manifest(explicit: str | None = None) -> Path | None:
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_file() else None
    here = runtime_dir() / "rom.manifest"
    if here.is_file():
        return here
    return None


def launcher_sys_dir() -> Path:
    """rom-launcher/prod/launch_sys next to this shell."""
    return Path(__file__).resolve().parent.parent / "rom-launcher" / "prod" / "launch_sys"


def launcher_runner() -> Path:
    return launcher_sys_dir().parent / "run-in-deck-host.py"


def is_launcher_surface() -> bool:
    home = (HOME or "").lower()
    title = (TITLE_ROOT or "").strip().upper()
    return f":{LAUNCHER_PORT}" in home or title in (
        "LAUNCH",
        "ROM LAUNCHER",
        "ROM CASES",
    )


def launcher_health_up() -> bool:
    try:
        urllib.request.urlopen(LAUNCHER_HEALTH, timeout=0.45)
        return True
    except Exception:
        return False


def focus_window_title(needle: str) -> bool:
    """Bring an existing visible window whose title contains needle to the front."""
    if sys.platform != "win32" or not needle:
        return False
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found: list[int] = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(
            ctypes.c_bool, wintypes.HWND, wintypes.LPARAM
        )
        want = needle.lower()

        def _cb(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            if want in (buf.value or "").lower():
                found.append(int(hwnd))
                return False
            return True

        user32.EnumWindows(WNDENUMPROC(_cb), 0)
        if not found:
            return False
        hwnd = found[0]
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def spawn_rom_launcher() -> bool:
    runner = launcher_runner()
    if not runner.is_file():
        return False
    kwargs: dict = {"cwd": str(runner.parent)}
    if sys.platform == "win32":
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cf |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        kwargs["creationflags"] = cf
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, str(runner)], **kwargs)
        return True
    except OSError:
        return False


def wants_default_launcher(args: argparse.Namespace, manifest: dict) -> bool:
    """Bare host: no URL/spawn/rom-dir/manifest → ROM Launcher is the product."""
    if args.url or args.spawn or args.rom_dir:
        return False
    if manifest:
        return False
    return True


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
        help="Entry URL (default: ROM Launcher, or DECK_HOST_URL)",
    )
    p.add_argument(
        "--base",
        default=os.environ.get("DECK_HOST_BASE", "").strip() or None,
        help="Base URL for relative go() paths (optional)",
    )
    p.add_argument("--title", default=None, help="Window title root")
    p.add_argument(
        "--rom-dir",
        default=os.environ.get("DECK_HOST_ROM_DIR", "").strip() or None,
        help="Serve this folder in-process (itch / ship path). No extra Python.",
    )
    p.add_argument(
        "--manifest",
        default=os.environ.get("DECK_HOST_MANIFEST", "").strip() or None,
        help="rom.manifest JSON (title, size, rom_dir). Default: next to the exe.",
    )
    p.add_argument(
        "--rom-port",
        type=int,
        default=_env_int("DECK_HOST_ROM_PORT") or 0,
        help="Port for --rom-dir (0 = pick a free local port)",
    )
    p.add_argument(
        "--debug",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="DevTools (default: on in source, off when frozen / shipped)",
    )
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
    global _START_WINDOW_MODE, _DEBUG

    _attach_stdio()
    args = parse_args(argv)

    manifest_path = find_rom_manifest(args.manifest)
    manifest = load_rom_manifest(manifest_path) if manifest_path else {}
    if manifest_path:
        print(f"[deck-host] manifest  {manifest_path}")

    if args.debug is not None:
        _DEBUG = bool(args.debug)
    elif "debug" in manifest:
        _DEBUG = bool(manifest.get("debug"))
    elif _frozen():
        _DEBUG = False

    profile = args.profile
    argv_now = list(argv if argv is not None else sys.argv[1:])
    cli_profile = any(
        a == "--profile" or str(a).startswith("--profile=") for a in argv_now
    )
    default_launcher = wants_default_launcher(args, manifest)
    if (
        default_launcher
        and (not cli_profile)
        and (not os.environ.get("DECK_HOST_PROFILE", "").strip())
    ):
        profile = "rail"
    elif (
        (not cli_profile)
        and (not os.environ.get("DECK_HOST_PROFILE", "").strip())
        and manifest.get("profile")
    ):
        profile = str(manifest.get("profile") or profile)
    apply_profile(profile)
    want_w = args.width
    want_h = args.height
    if default_launcher and want_w is None and want_h is None:
        want_w, want_h = 300, 800
    if want_w is None and manifest.get("width") is not None:
        try:
            want_w = int(manifest["width"])
        except (TypeError, ValueError):
            want_w = None
    if want_h is None and manifest.get("height") is not None:
        try:
            want_h = int(manifest["height"])
        except (TypeError, ValueError):
            want_h = None
    if want_w and want_h:
        _MAG_SMALL = (want_w, want_h)
    elif want_w:
        _MAG_SMALL = (want_w, _MAG_SMALL[1])
    elif want_h:
        _MAG_SMALL = (_MAG_SMALL[0], want_h)
    # Custom standard size: height-first expand (not a jump to 1600×1200 landscape).
    # Optional explicit expanded via DECK_HOST_EXPANDED_WIDTH / _HEIGHT.
    ew = _env_int("DECK_HOST_EXPANDED_WIDTH")
    eh = _env_int("DECK_HOST_EXPANDED_HEIGHT")
    if ew and eh:
        _MAG_LARGE = (ew, eh)
    elif want_w and want_h:
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
    elif manifest.get("title"):
        TITLE_ROOT = str(manifest.get("title") or "").strip() or TITLE_ROOT
    elif default_launcher:
        TITLE_ROOT = "LAUNCH"
    if args.base:
        BASE = args.base.rstrip("/")

    rom_dir_raw = args.rom_dir or (str(manifest.get("rom_dir") or "").strip() or None)
    if rom_dir_raw:
        base = manifest_path.parent if manifest_path else runtime_dir()
        rom_path = Path(rom_dir_raw)
        if not rom_path.is_absolute():
            rom_path = (base / rom_path).resolve()
        try:
            HOME = serve_rom_dir(rom_path, port=int(args.rom_port or 0))
        except Exception as e:
            print(f"[deck-host] rom-dir failed: {e}", file=sys.stderr)
            sys.exit(1)
    elif args.url:
        HOME = args.url
    elif default_launcher:
        launch_sys = launcher_sys_dir()
        if (launch_sys / "server.py").is_file():
            HOME = LAUNCHER_HTTP
            if not args.spawn:
                args.spawn = f"{sys.executable} server.py"
                args.spawn_cwd = str(launch_sys)
            if not args.health:
                args.health = LAUNCHER_HEALTH
            print(f"[deck-host] default product  ROM Launcher  {HOME}")
        else:
            print(
                "[deck-host] ROM Launcher missing — falling back to gate page",
                file=sys.stderr,
            )
            HOME = LAUNCHER
    else:
        HOME = LAUNCHER

    # Optional: start ROM backend (lives outside this repo), wait, open window; kill on exit
    health = args.health or (
        args.url if args.url and str(args.url).startswith("http") else None
    )
    if args.spawn:
        global _spawn_command, _spawn_cwd, _health_url, _health_timeout
        cwd = Path(args.spawn_cwd).resolve() if args.spawn_cwd else HERE
        _spawn_command = args.spawn
        _spawn_cwd = cwd
        _health_url = health
        _health_timeout = float(args.health_timeout or 20)
        if not cwd.is_dir():
            print(f"[deck-host] spawn cwd missing: {cwd}", file=sys.stderr)
            sys.exit(1)
        # If this ROM is already healthy (e.g. re-open), do not spawn a second
        # server and do not claim ownership to kill on exit.
        already = health and wait_for_url(health, timeout=0.6)
        if already:
            print(f"[deck-host] ROM already up at {health} - not re-spawning")
        else:
            print(f"[deck-host] starting ROM process in {cwd}")
            print(f"[deck-host]   {args.spawn}")
            try:
                start_rom_process(args.spawn, cwd)
            except Exception as e:
                print(f"[deck-host] spawn failed: {e}", file=sys.stderr)
                sys.exit(1)
            if health:
                print(f"[deck-host] waiting for {health} ...")
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
    saved_desk = _load_layout().get("desk")
    restore_desk: dict | None = None
    if isinstance(saved_desk, dict) and not want_fs:
        try:
            rx, ry, rw, rh = _clamp_geom(
                int(saved_desk.get("x", 0)),
                int(saved_desk.get("y", 0)),
                _as_pos_int(saved_desk.get("w")) or start_w,
                _as_pos_int(saved_desk.get("h")) or start_h,
            )
            restore_desk = {
                "x": rx,
                "y": ry,
                "w": rw,
                "h": rh,
                "maximized": bool(saved_desk.get("maximized")),
            }
            start_w, start_h = rw, rh
            if restore_desk["maximized"] and _PROFILE != "companion":
                want_max = True
        except (TypeError, ValueError):
            restore_desk = None
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
        "maximized": False if restore_desk else (want_max and not want_fs),
    }
    if restore_desk:
        win_kw["x"] = restore_desk["x"]
        win_kw["y"] = restore_desk["y"]
        api._restore_geom = restore_desk
        api._normal_size = (restore_desk["w"], restore_desk["h"])
        if restore_desk.get("maximized"):
            api._start_maximized = True
    elif want_max or want_fs:
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
    if _START_WINDOW_MODE == "maximized" or (restore_desk and restore_desk.get("maximized")):
        api._maximized = bool(want_max)
        api._start_maximized = bool(want_max)
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
    if restore_desk:
        print(
            f"[deck-host] restore desk {restore_desk['x']},{restore_desk['y']} "
            f"{restore_desk['w']}x{restore_desk['h']}"
            f"{' maximized' if restore_desk.get('maximized') else ''}",
            flush=True,
        )

    menu_items = [
        webview.menu.MenuAction("Deck", lambda: api.open_deck()),
        webview.menu.MenuAction("Reload", lambda: api.reload()),
        webview.menu.MenuAction("Restart server", lambda: api.hard_refresh()),
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
        _shutdown_rom_httpd()


def re_slug(s: str) -> str:
    import re as _re

    s = (s or "host").strip().lower()
    s = _re.sub(r"[^\w\-]+", "-", s)
    return s.strip("-") or "host"

if __name__ == "__main__":
    _attach_stdio()
    print(
        f"the-deck-host: frameless={'ON' if _FRAMELESS else 'OFF'}  "
        f"devtools={'ON' if _DEBUG else 'OFF'}"
    )
    if _FRAMELESS:
        print(
            "  caption: gem Deck/Reload/Exit · Alt+M · min/max/close · "
            "Ctrl+/- zoom · deep/F11 opt-in per ROM"
        )
    print("  profiles: desk / datbox / office / companion/rail")
    if not CAPTION_JS.is_file():
        print(f"  WARNING: missing {CAPTION_JS}")
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
