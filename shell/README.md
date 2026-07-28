# The Deck Host — shell

Window runtime for ROMs (pywebview + caption).

## Primary product: ROM Launcher

Start menu for ROMs (cartridge cases). Quiet spawn.

```bat
cd C:\ALICE_BOX\the-deck-host\rom-launcher\prod
run-launcher.bat
```

SKU **CO.HOST-001-LAUNCH** · port **43170** · reads ROM Cat `launcher_show` + `launches.json`.

## Run host only

```bat
cd the-deck-host\shell
pip install -r requirements.txt
python deck_host.py
```

### Host a ROM that lives elsewhere

ROMs are **not** stored in this repo. The ROM project starts the host:

```bat
python deck_host.py --title loreBOX --url http://127.0.0.1:42929/ ^
  --spawn "python server.py" --spawn-cwd C:\path\to\lore-box\prod\box_sys ^
  --health http://127.0.0.1:42929/api/health
```

loreBOX ships that as `datbox-studio/lore-box/prod/run-loreBOX.bat`.

| Env / flag | Meaning |
|------------|---------|
| `--url` / `DECK_HOST_URL` | Entry page |
| `--spawn` / `DECK_HOST_SPAWN` | Start ROM process before window |
| `--spawn-cwd` | Cwd for that process |
| `--health` | Wait until this URL answers |
| `DECK_HOST_FRAMELESS=0` | OS frame + menu |
| `DECK_HOST_DEBUG=0` | DevTools off |
## Layout

| Path | Role |
|------|------|
| `deck_host.py` | Entry (reworked host) |
| `caption.js` | Frameless caption (reworked) |
| `launcher.html` | Dev gate |
| `from-mypi/` | **Exact copies** of the old pocket-browser sources (reference only) |

Originals also remain under the my-pocket-internet tree (not deleted).

## Caption

Surfaces may set drag regions with `data-deck-drag` (and still honor `--deck-caption-h` / `--pocket-caption-h` for padding under the caption).
