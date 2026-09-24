```
=================================================
  THE DECK HOST
  ROMs, in a real window
=================================================
```

**The Deck Host** is the window runtime. **ROM Launcher** is the default product — install once, seat carts, click a case.

### Who it’s for

Anyone building **ROMs** — compact tools and surfaces meant to feel like their own program, not a tab lost in a browser.

### What you get

- A dedicated **window** for each ROM
- **ROM Launcher** as the start menu / server manager
- A shelf to **seat** carts (`%LOCALAPPDATA%/DeckHost/roms`)
- A fallback path to ship **one ROM as one itch package**

### Chrome

The host is a thin window (min / max / close). Deep, snap-size, and browser doors are **opt-in** per ROM. See [docs/ship-model.md](docs/ship-model.md).

### Layout

| Path | Role |
|------|------|
| `shell/` | Window runtime |
| `rom-launcher/` | Default product (cases) |
| `docs/` | Maker notes |

### Run

```bat
cd shell
pip install -r requirements.txt
python deck_host.py
```

**Profiles:** `desk` (~1024×768) · `datbox` (short bags ~960×520) · `office` (wide docs) · `companion` / `rail` (Launcher + Machina strip).
