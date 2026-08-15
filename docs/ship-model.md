# Shipping ROMs with The Deck Host

## Goal

The person who uses your ROM should:

1. Install or unpack **one** folder (or installer)
2. Double-click **one** icon
3. Use your ROM

They should not need a second window running a server “for” the ROM, or a development environment.

---

## Recommended shape: one ROM, one package

Each product ships as its own desktop program. **The Deck Host** is the **runtime inside that package**, not a separate program the user must install first.

Example layout (names are yours to choose):

```
YourROM/
  YourROM.exe          # The Deck Host runtime, configured for this ROM
  rom/                 # your web UI / local surface
  data/                # optional — saves, settings, user files
```

On launch, the runtime starts whatever local services your ROM needs (if any), opens the window on your ROM’s entry page, and tears those services down when the window closes.

### First ship path (static ROM)

If the ROM is a folder of HTML/CSS/JS (no extra language runtime), **The Deck Host serves it in-process**. No second Python. No `--spawn`.

```
YourROM/
  YourROM.exe          # frozen deck_host
  rom.manifest         # title, size, rom_dir
  rom/                 # index.html + assets (offline — no CDN)
```

```json
{
  "title": "KDE Notes & Chords",
  "sku": "CO.KDE-001-INSTR",
  "profile": "desk",
  "width": 800,
  "height": 600,
  "debug": false,
  "rom_dir": "rom"
}
```

```bat
python deck_host.py --rom-dir path\to\rom
python deck_host.py --manifest path\to\rom.manifest
```

Frozen exe looks next to itself for `rom.manifest`. Double-click is enough.

Specimen: `charlies-toys/kde-notes-chords/` · `tools/pack-itch.py`.

---

## While you are building

You may run your ROM’s server and the window separately. That is a **development** setup only. It is not how a finished ROM should be explained or delivered.

---

## Window profiles

Each ROM **opts into** its size. Do not bake DATBOX geometry into the default desk — that clobbered import-station and other classic ROMs.

| Profile | Feel | Flags |
|---------|------|--------|
| **desk** (default) | Classic ROM ~1024×768 · size-step to 1600×1200 | `--profile desk` |
| **datbox** | Short DATBOX bags ~960×520 (two stack on ~1080p) | `--profile datbox` (loreBOX / shotBOX only) |
| **office** | Wide docs / kanban ~1280×800 (Big Box sopr) | `--profile office` |
| **companion** / **rail** | Tall narrow strip (~368×740), always-on-top (Time Machina) | `--profile companion` |

Also: `--width` / `--height` / `--min-width` / `--min-height` / `--on-top` / `--no-on-top`.

## Later option: one host, many ROMs

A single Deck Host install could load many ROMs from a shelf (a **ROM deck**). Same runtime, different distribution story. Optional; not required for the first shipping path.

---

## Separate source, whole product

| Piece | Where it lives |
|--------|----------------|
| The Deck Host (this project) | Runtime and packaging |
| Your ROM’s source | Your own project / repo |
| What the user installs | Runtime + your ROM files, branded as **your** product |

Source projects can stay separate. The **installed** thing is one product.

---

## Success check

Double-click the ROM → window opens on your UI → user work saves where your ROM says → quit closes cleanly, with nothing left running that the user did not ask for.
