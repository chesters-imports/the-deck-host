"""
mypi pocket browser — one host (b), many SYS paths.

  python pocket_browser.py

Frameless (default ON): no OS title bar, no white native menu strip.
  Doors: left gem on caption · Alt+M / Ctrl+K
  Ctrl+N → another pocket window
  MYPI_POCKET_FRAMELESS=0 → normal frame + native menu
  MYPI_POCKET_DEBUG=0     → DevTools off
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    import webview
except ImportError:
    print("pip install pywebview")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
LAUNCHER = (HERE / "launcher.html").as_uri()
B = "http://b"
# New windows + home land on Terminal BASE login (multi-station launch pad)
HOME = B.rstrip("/") + "/terminal/base/login"
TITLE_ROOT = "mypi"
CAPTION_JS = HERE / "caption.js"
_CAPTION_H = 36

_DEBUG = os.environ.get("MYPI_POCKET_DEBUG", "1").strip().lower() not in (
    "0",
    "false",
    "off",
    "no",
)
_FRAMELESS = os.environ.get("MYPI_POCKET_FRAMELESS", "1").strip().lower() not in (
    "0",
    "false",
    "off",
    "no",
)

_CAPTION_SRC = CAPTION_JS.read_text(encoding="utf-8") if CAPTION_JS.is_file() else ""


# Mag ▣ classic toggle — the sizes you actually want (not a climb ladder).
_MAG_SMALL = (1024, 768)
_MAG_LARGE = (1600, 1200)


class PocketApi:
    """JS bridge: window.pywebview.api.*"""

    def __init__(self) -> None:
        self._window: webview.Window | None = None
        self._maximized = False
        self._normal_size = _MAG_SMALL
        # True → currently showing LARGE; next press → SMALL
        self._mag_large = False

    def bind(self, window: webview.Window) -> None:
        self._window = window

    def minimize(self) -> None:
        if self._window:
            self._window.minimize()

    def toggle_maximize(self) -> None:
        """Window maximize (caption stays). For full immersion use JS Go deep / F11."""
        if not self._window:
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
        """
        Toggle 1024×768 ↔ 1600×1200 (not fullscreen, not a size ladder).
        """
        if not self._window:
            return ""
        try:
            if self._maximized:
                self._window.restore()
                self._maximized = False
        except Exception:
            pass

        if self._mag_large:
            target = _MAG_SMALL
            self._mag_large = False
        else:
            target = _MAG_LARGE
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
        if not self._window:
            return
        path = (path or "").lstrip("/")
        self._window.load_url(B.rstrip("/") + "/" + path)

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
        """Spawn another pocket window (Ctrl+N). Gate URL, same frameless chrome."""
        try:
            spawn_pocket_window()
            return "ok"
        except Exception as e:
            if _DEBUG:
                print(f"[pocket] new_window failed: {e}")
            return f"err:{e}"


_SOFT_RELOAD_JS = r"""
(function () {
  if (typeof window.WWWRefresh === "function") { window.WWWRefresh(); return; }
  window.location.reload();
})();
"""

_KEY_BRIDGE_JS = r"""
(function () {
  if (window.__mypiPocketKeys) return;
  window.__mypiPocketKeys = true;
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
    if "/terminal/base/login" in url:
        return "login" if short else f"{TITLE_ROOT} · terminal login"
    try:
        p = urlparse(url)
        path = (p.path or "/").rstrip("/") or "/"
        display = path.lstrip("/") or "/"
        q = p.query or ""
        if q:
            parts = [kv for kv in q.split("&") if not kv.startswith("_cb=")]
            if parts:
                display = f"{display}?{'&'.join(parts)}"
        if short:
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
  document.documentElement.style.setProperty('--pocket-caption-h',H+'px');
  if(document.body) document.body.style.setProperty('--pocket-caption-h',H+'px');
  if(!document.body) return 'no-body';
  var b=document.createElement('div');
  b.id='mypi-pocket-caption';
  b.className='pywebview-drag-region';
  b.style.cssText='position:fixed;top:0;left:0;right:0;height:'+H+'px;z-index:2147483000;background:#0a0c12;color:#eee;display:flex;align-items:center;padding:0 12px;font:12px system-ui';
  b.textContent={t};
  document.body.insertBefore(b, document.body.firstChild);
  return 'fallback-caption';
}})();
"""
    preamble = (
        f"window.__MYPI_CAPTION_TITLE = {json.dumps(title)};\n"
        f"window.__MYPI_CAPTION_H = {_CAPTION_H};\n"
    )
    return preamble + _CAPTION_SRC


def _attach_window_events(window: webview.Window, api: PocketApi) -> None:
    """Caption inject + title sync for one window (first or Ctrl+N spawn)."""

    def inject_caption(short_title: str) -> None:
        if not _FRAMELESS:
            return
        script = build_caption_js(short_title)

        def attempt(n: int = 0) -> None:
            try:
                result = window.evaluate_js(script)
                if _DEBUG:
                    print(f"[pocket] caption inject try={n} result={result!r}")
            except Exception as e:
                if _DEBUG:
                    print(f"[pocket] caption inject try={n} error={e}")
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


def spawn_pocket_window(
    url: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> webview.Window:
    """Create a pocket window + API + caption hooks (call after webview.start OK)."""
    api = PocketApi()
    w = webview.create_window(
        title=f"{TITLE_ROOT} · login",
        url=url or HOME,
        width=width or _MAG_SMALL[0],
        height=height or _MAG_SMALL[1],
        min_size=(640, 480),
        background_color="#0a0c12",
        text_select=True,
        frameless=_FRAMELESS,
        easy_drag=False,
        resizable=True,
        shadow=True,
        js_api=api,
    )
    api.bind(w)
    _attach_window_events(w, api)
    return w


def main() -> None:
    try:
        webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    except Exception:
        pass

    api = PocketApi()
    window = webview.create_window(
        title=f"{TITLE_ROOT} · login",
        url=HOME,
        width=_MAG_SMALL[0],
        height=_MAG_SMALL[1],
        min_size=(640, 480),
        background_color="#0a0c12",
        text_select=True,
        frameless=_FRAMELESS,
        easy_drag=False,
        resizable=True,
        shadow=True,
        js_api=api,
    )
    api.bind(window)
    _attach_window_events(window, api)

    # Native WinForms menu only when framed — white strip is gone in portal mode
    # Framed mode only — keep surface titles aligned with caption doors
    menu_items = [
        webview.menu.MenuAction("Terminal", lambda: window.load_url(HOME)),
        webview.menu.MenuAction("WWW", lambda: api.go("www/danyi/index")),
        webview.menu.MenuAction("Starline", lambda: api.go("starline/news/headlines")),
        webview.menu.MenuAction("Book", lambda: api.go("book/terminal_girls/oriel")),
        webview.menu.MenuAction("Mythleak", lambda: api.go("mythleak/news/headlines")),
        webview.menu.MenuAction("Mailroom", lambda: api.go("mailroom/floor/sort")),
        webview.menu.MenuAction("New window", lambda: spawn_pocket_window()),
        webview.menu.MenuAction("Reload", lambda: api.reload()),
        webview.menu.MenuAction("Hard refresh", lambda: api.hard_refresh()),
        webview.menu.MenuAction("Back", lambda: window.evaluate_js("history.back()")),
        webview.menu.MenuAction("Forward", lambda: window.evaluate_js("history.forward()")),
        webview.menu.MenuAction("Minimize", lambda: api.minimize()),
        webview.menu.MenuAction("Maximize", lambda: api.toggle_maximize()),
        webview.menu.MenuAction("Close", lambda: api.close()),
    ]

    if _FRAMELESS:
        # Doors via caption gem / Alt+M · Ctrl+N new window
        webview.start(debug=_DEBUG)
    else:
        try:
            menu = webview.menu.Menu("mypi", menu_items)
            webview.start(menu=[menu], debug=_DEBUG)
        except Exception:
            webview.start(debug=_DEBUG)


if __name__ == "__main__":
    print(
        f"pocket-browser: frameless={'ON' if _FRAMELESS else 'OFF'}  "
        f"devtools={'ON' if _DEBUG else 'OFF'}"
    )
    if _FRAMELESS:
        print(
            "  portal: gem doors · Alt+M · Ctrl+N new · drag · ⤢ size · "
            "Ctrl± zoom · F11 deep · Esc surface"
        )
    if not CAPTION_JS.is_file():
        print(f"  WARNING: missing {CAPTION_JS}")
    main()
