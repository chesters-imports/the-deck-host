```
=================================================
  THE DECK HOST
  ROMs, in a real window
=================================================
```

**The Deck Host** runs pocket **ROMs** as desktop programs.

Point it at a ROM. Package it. Double-click.  
The host is the chrome; **your ROM** is the product.

### Who it’s for

Anyone building **ROMs** — compact tools and surfaces meant to feel like their own program, not a tab lost in a browser.

### What you get

- A dedicated **window** for your ROM  
- A path to **ship one ROM as one install** — your files + this runtime, one icon  
- Room later for a **ROM deck** (many ROMs on one host) if you want that shape  

### What it does not do

- It does not replace your ROM’s own data, settings, or logic  
- It does not require the operator to keep a separate server console open for normal use  
- It is not tied to a single studio or title — any ROM can wear it  

### Layout

| Path | Role |
|------|------|
| `shell/` | Window runtime |
| `docs/` | Maker notes |

### Status

Island open. **Shell stage 1** is in `shell/` (reworked from the old pocket-browser; originals kept in `shell/from-mypi/` and on the myPI tree).

```bat
cd shell
pip install -r requirements.txt
python deck_host.py --url http://127.0.0.1:42929/
python deck_host.py --profile companion --url http://127.0.0.1:43111/
```

**Profiles:** `desk` (DATBOX ROMs ~960×520, two stack on 1080p) · `companion` / `rail` (tall Time Machina strip ~368×740).
