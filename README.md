```
=================================================
  POCKET WINDOWS
  a glass for pocket apps
=================================================
```

**Pocket Windows** is the window shell for pocket-world software.

Makers build toys (desks, DATBOX apps, little surfaces).  
**Pocket Windows** is how those toys become **double-click apps** — one icon, one process story, no babysitting a terminal.

### What it is

| | |
|--|--|
| **User metaphor** | Pocket Windows — the glass your pocket apps run in |
| **Ship model (now)** | **Per-toy app (B):** e.g. `loreBOX` ships as its own double-click product, with this runtime **bundled inside** |
| **Later dream (A)** | ROM deck — one Pocket Windows install that loads many packs |

### What it is not

- Not Chrome with a skin  
- Not a requirement that end users run `python server.py` in another window  
- Not the toy’s data or lore logic (that stays in the toy / DatBox / etc.)  
- Not a kitten-lab / Builds graveyard carry-over — this island is clean

### Repos stay islands

| Island | Role |
|--------|------|
| **pocket-windows** | Engine + packaging story (this repo) |
| **datbox-studio** / toys | Product source (e.g. loreBOX desk) |
| **Ship folder / exe** | One branded app: runtime + that toy’s files |

Source does not have to merge. **Ship units** are whole.

### Status

Formal island established. Runtime and loreBOX packaging land in following work.

See `docs/ship-model.md`.
