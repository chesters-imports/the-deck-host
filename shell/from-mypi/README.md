# Pocket browser

Feel **inside** the pocket internet — a dedicated window on your XAMPP world, not Chrome’s shell.

## Run

```bat
cd C:\Builds\my-pocket-internet\pocket-browser
pip install pywebview
python pocket_browser.py
```

Optional shortcut later: desktop `.bat` that runs the same.

## Needs

- Apache/XAMPP running  
- **One host only for daily use:** `b` → DocumentRoot `…/b` (see `docs/B-FRONT.md`)  
- Junction: `htdocs\my-pocket-internet` → `Builds\my-pocket-internet`  
- Do **not** add a hosts line per new surface — open `http://b/{sys}/…` (pocket chrome hides the host leadline; title is path-only)

Optional: `go.edn` stays a separate stack if you still open Terminal IO that way.

## Frameless portal

Default **ON** — no Windows title bar, **no white native menu**.

| | |
|--|--|
| **Dark caption** | Drag · **☰** · **▣** size step · **◎** deep · ─ □ ✕ |
| **Doors menu** | ☰ or **Alt+M** / **Ctrl+K** |
| **Zoom** | **Ctrl+=** / **Ctrl+−** / **Ctrl+0**. Click **%** → reset 100%. Persists in localStorage. |
| **Window size** | **▣** — toggle **1024×768 ↔ 1600×1200** (not fullscreen). |
| **Go deep** | **F11** or **◎** — hides caption, surface fills the window. **Esc** / **F11** to surface. Terminal: drag the **>| IOX** rail slug to move. Other surfaces get a tiny corner grabber if needed. |
| **Maximize** | **□** or double-click drag strip — OS maximize, caption stays. |
| **Esc** | Exit deep · else close doors menu |

Caption: `pocket-browser/caption.js`.  
Surfaces must honor `--pocket-caption-h` on **html** (not re-zero it on `body`).  
Surfaces may theme `#mypi-pocket-caption` (e.g. terminal skins); default is product chrome.

Frameless is intentionally a fixed *portal* feel; **zoom** and **go deep** are how you “get larger” without Chrome’s chrome.

```bat
python pocket_browser.py
set MYPI_POCKET_FRAMELESS=0
python pocket_browser.py
```

Framed mode still gets the classic white mypi menu.

## DevTools (view source / inspect)

There is no built-in “View Source” menu in pywebview. With **debug mode** (default **on**):

- **Right-click → Inspect** (Edge WebView2)  
- **F12** often works once DevTools are enabled  
- Console, Elements, Network — same as Chromium  

Disable: `set MYPI_POCKET_DEBUG=0` before launch (or env permanently).  
DevTools window does **not** auto-open on start.

## Shell chrome direction

Surfaces should feel like **dense apps** (Obsidian-ish), not a naked document in a Windows box:

- `a/_/cssSlugs/pocketChrome.css` — shared thin scrollbars + pane tokens  
- SYS overrides `--pocket-scroll-*`  
- Body `overflow: hidden`; **sidebar / main** are the scroll regions  

## Reload vs hard refresh

Chrome CSS lives on host **`a`** (`http://a/…/style.css`) while pages are **`b`**. WebView2 caches `a` aggressively; busting only the `b` page URL used to re-emit the **same** CSS URL → still stale.

| Action | How |
|--------|-----|
| Soft reload | Menu **Reload** · **F5** · webBAR ↻ |
| **Hard refresh** | Menu **Hard refresh** · **Ctrl+F5** / **Ctrl+Shift+R** · **Shift+click** ↻ |

Hard refresh re-navigates with `?_cb=…`. PHP `getA_Style` then emits  
`style.css?v={filemtime}.{_cb}` so the stylesheet URL actually changes.  
After a CSS **file** edit, even soft reload often works (mtime changes).  
Restart the Python process only if **`pocket_browser.py`** itself changed.

## Git note

- **This stripped mypi:** `github.com/kitten-lab/mypi` (work here)  
- **Older fuller archive:** `silo-my-pocket-internet` (or similar) — leave alone; keep this one running  

## Next

Wire postBASIC → ledger; Skyline DOM **News** as headlines. Browser is the door; store is trust.
