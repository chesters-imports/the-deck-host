# ROM Launcher · CO.HOST-001-LAUNCH

**Primary Deck Host product.** Start menu for ROMs — cartridge cases on a rail.

Reads **ROM Cat** (`launcher_show`) + **recipes** (`prod/launch_sys/data/launches.json`), plus **seated** carts on the shelf (`%LOCALAPPDATA%/DeckHost/roms` or `DECK_HOST_ROMS`).

**Install** seats a **`.rom` cart** (a zip of the software) onto `%LOCALAPPDATA%/DeckHost/roms` (or `DECK_HOST_ROMS`). `.zip` and loose folders still work. Stable port 43200–43399.

Spawns each ROM’s `run-in-deck-host.py` (or seated `rom.manifest`) **quietly**.

## Run

```bat
cd C:\ALICE_BOX\the-deck-host\shell
python deck_host.py
```

Same as:

```bat
cd C:\ALICE_BOX\the-deck-host\rom-launcher\prod
run-launcher.bat
```

Port **43170**. Default window: **rail** (~300×800 — three teeny carts). Override:

```bat
set LAUNCHER_PROFILE=desk
set LAUNCHER_WIDTH=960
set LAUNCHER_HEIGHT=700
run-launcher.bat
```

Chrome is thin (`min,max,close`). Gem **Shell** switches Base (current look) and **Light classic** (`skins/launcher-lightclassic.dsc`). Cart plastic is not part of the shell.

## ROM Cat toggle

Edit a ROM card → **Show on ROM Launcher** checkbox. Only launchable carts appear. Ideas / coming-soon stay in Cat, not on this rail.

## Paths

| | |
|--|--|
| Launcher | `the-deck-host/rom-launcher/` |
| Catalog | `dewey-catalog-co/rom-cat/.../catalog.json` |
| Recipes | `rom-launcher/prod/launch_sys/data/launches.json` |
| Seated shelf | `%LOCALAPPDATA%/DeckHost/roms` |
