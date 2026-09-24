# The Deck Host — shell

Window runtime for ROMs (pywebview + caption). **Default product: ROM Launcher.**

```bat
cd C:\ALICE_BOX\the-deck-host\shell
pip install -r requirements.txt
python deck_host.py
```

No args opens the cart rail (port **43170**, rail profile). SKU **CO.HOST-001-LAUNCH**.

Or:

```bat
cd C:\ALICE_BOX\the-deck-host\rom-launcher\prod
run-launcher.bat
```

Reads ROM Cat `launcher_show` + `launches.json`, plus seated carts on the shelf.

### Host a single ROM (dev / itch)

```bat
python deck_host.py --title loreBOX --url http://127.0.0.1:42929/ ^
  --spawn "python server.py" --spawn-cwd C:\path\to\lore-box\prod\box_sys ^
  --health http://127.0.0.1:42929/api/health
```

| Env / flag | Meaning |
|------------|---------|
| *(none)* | ROM Launcher |
| `--url` / `DECK_HOST_URL` | Entry page (skips launcher) |
| `--rom-dir` | Serve this folder in-process |
| `--manifest` | `rom.manifest` (title, size, rom_dir). Frozen exe looks next to itself. |
| `--spawn` / `DECK_HOST_SPAWN` | Start ROM process before window |
| `--spawn-cwd` | Cwd for that process |
| `--health` | Wait until this URL answers |
| `DECK_HOST_ROMS` | Seated-cart shelf (else `%LOCALAPPDATA%/DeckHost/roms`) |
| `DECK_HOST_FRAMELESS=0` | OS frame + menu |
| `DECK_HOST_DEBUG=0` | DevTools off |

## Chrome

Thin by default: min / max / close. Deep, snap, Back/Forward are ROM opt-in (`data-deck-controls`). See [docs/ship-model.md](../docs/ship-model.md).

## Layout

| Path | Role |
|------|------|
| `deck_host.py` | Entry |
| `caption.js` | Frameless caption |
| `launcher.html` | Fallback if ROM Launcher files are missing |
| `from-mypi/` | Untouched copies of the old pocket-browser (reference only) |
