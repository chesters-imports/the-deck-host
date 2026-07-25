# The Deck Host — shell

Window runtime for ROMs (pywebview + caption).

## Run

```bat
cd the-deck-host\shell
pip install -r requirements.txt
python deck_host.py
```

Open a specific ROM URL:

```bat
python deck_host.py --url http://datbox.lorebox.localhost:42929/
```

| Env / flag | Meaning |
|------------|---------|
| `--url` / `DECK_HOST_URL` | Entry page |
| `--base` / `DECK_HOST_BASE` | Prefix for relative `go()` paths |
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
