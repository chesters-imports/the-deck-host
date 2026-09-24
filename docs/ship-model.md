# Shipping ROMs with The Deck Host

## Goal

The person who uses your ROMs should:

1. Install **The Deck Host** once (window + ROM Launcher)
2. Seat carts onto the launcher shelf
3. Click a case

They should not need a second console running a server “for” each ROM, or a development environment.

---

## Primary story: one host, many carts

**The Deck Host** is the runtime. **ROM Launcher** (`CO.HOST-001-LAUNCH`) is the default product — the start menu / server manager.

```
Deck Host.exe            # this runtime
  → opens ROM Launcher   # rail of cases
       → seated carts    # %LOCALAPPDATA%/DeckHost/roms  (or DECK_HOST_ROMS)
       → island recipes  # launches.json + ROM Cat (development)
```

Bare `python deck_host.py` (no `--url` / `--spawn` / `--rom-dir` / `--manifest`) **is** the launcher.

`--url` / `--spawn` / `--rom-dir` still run a **single cart** (dev, and the itch one-ROM fallback).

### Seat / install

The downloadable cart is a **`.rom` file** — a zip of the software with that extension. Launcher **Install** picks a `.rom` and unpacks it onto the shelf (`%LOCALAPPDATA%/DeckHost/roms`). `.zip` still works. Makers can also install a loose folder.

Inside the archive (same as the seated folder):

- `rom.manifest` — title, id, profile, **stable port**
- static `rom/` (or `index.html` at the root) — host serves it in-process
- or `spawn` + `port` / `run_script` for a live server

Pack: zip the cart folder, rename `Something.zip` → `Something.rom`. Island `launches.json` recipes stay for development.

The launcher also scans `the-deck-host/roms/` if that folder exists.

### Shell skins (`.dsc`)

A `.dsc` paints an app’s chrome, not the carts. ROM Launcher is the first: gem **Shell → Base / Light classic**. Base is `app.css`. Light classic is `skins/launcher-lightclassic.dsc` loaded on top. Choice lives in `localStorage`. Cartridge plastic stays `rom-cart-face.css`.

---

## Chrome contract

The host is a **window**. Silence means a thin frame. Pocket-browser leftovers (deep, snap, Back/Forward) are **opt-in**.

| Always host | ROM opts in |
|-------------|-------------|
| min / max / close | `deep` (button + F11) |
| drag, corner resize | `step` / `step_size` (snap tiers) |
| Deck (open/focus Launcher) | Back / Forward / New window |
| Reload, Hard refresh, Exit | `DECK_ROM_MENU` replace, or `DECK_ROM_MENU_EXTRAS` |
| Ctrl± zoom (keyboard) | `data-deck-deep-stay` (keep a slim rail in deep) |

How a ROM opts in (HTML/JS — not a second manifest path yet):

```html
<header data-deck-chrome data-deck-controls="deep,min,max,close" data-deck-deep-stay>
  <div data-deck-window-controls></div>
</header>
```

`data-deck-controls` missing or empty → `min,max,close` only.

Desks and Receiver already declare deep. TPS Machina declares `min,step,close`. Pocket Go declares deep on the explorer chrome (its own back/forward live in the librarian bar). Everyone else gets the thin window.

---

## Window profiles

Each ROM **opts into** its size. Do not bake DATBOX geometry into the default desk.

| Profile | Feel | Flags |
|---------|------|--------|
| **desk** (default for carts) | Classic ROM ~1024×768 | `--profile desk` |
| **datbox** | Short DATBOX bags ~960×520 | `--profile datbox` |
| **office** | Wide docs / kanban ~1280×800 | `--profile office` |
| **companion** / **rail** | Tall narrow strip (Launcher, Machina) | `--profile rail` |

Also: `--width` / `--height` / `--min-width` / `--min-height` / `--on-top`.

Launcher default is **rail** (~300×800) so three teeny carts fit.

---

## Fallback: one ROM, one package (itch)

If you must ship a single toy without the deck:

```
YourROM/
  YourROM.exe          # frozen deck_host
  rom.manifest         # title, size, rom_dir, port
  rom/                 # index.html + assets
```

Frozen exe looks next to itself for `rom.manifest`. Double-click is enough. This is the itch path — not the platform pitch.

```json
{
  "title": "KDE Notes & Chords",
  "sku": "CO.KDE-001-INSTR",
  "profile": "desk",
  "width": 800,
  "height": 600,
  "debug": false,
  "rom_dir": "rom",
  "port": 43210
}
```

```bat
python deck_host.py --rom-dir path\to\rom
python deck_host.py --manifest path\to\rom.manifest
```

Specimen: `charlies-toys/kde-notes-chords/` · `tools/pack-itch.py`.

---

## While you are building

You may run your ROM’s server and the window separately. That is a **development** setup only.

## Success check

Double-click Deck Host → ROM Launcher rail → click a case → that ROM’s window opens on its UI → quit closes cleanly.
