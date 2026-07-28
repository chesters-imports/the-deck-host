# ROM Launcher · CO.HOST-001-LAUNCH

**Primary Deck Host product.** Start menu for ROMs — cartridge cases on a desk.

Reads **ROM Cat** (`launcher_show`) + **recipes** (`prod/launch_sys/data/launches.json`).  
Spawns each ROM’s `run-in-deck-host.py` **quietly** (no console flood).

## Run

```bat
cd C:\ALICE_BOX\the-deck-host\rom-launcher\prod
run-launcher.bat
```

Port **43170**.

Default window: **rail** profile (tall strip — fits teeny carts). Override:

```bat
set LAUNCHER_PROFILE=desk
set LAUNCHER_WIDTH=960
set LAUNCHER_HEIGHT=700
run-launcher.bat
```

## ROM Cat toggle

Edit a ROM card → **Show on ROM Launcher** checkbox.  
Coming-soon cases can stay visible with `coming_soon` in `launches.json` and no `run_script`.

## Paths

| | |
|--|--|
| Launcher | `the-deck-host/rom-launcher/` |
| Catalog | `dewey-catalog-co/rom-cat/.../catalog.json` |
| Recipes | `rom-launcher/prod/launch_sys/data/launches.json` |
