# Receiver · cuteness & craft (Hands law)

**For every agent after compact.** Do not “professionalize” this into a sterile desktop.

## What Receiver is

- **Host island:** `ALICE_BOX/the-deck-host/receiver/` · **CO.RECV-001** — not a My Pocket Things bay.  
- **Pocket Desktop** (one note, paper+form): `my-pocket-things/pocket-desktop/` · **CO.MYPT-004-DESK** — separate product, not “Receiver v2.”
- **Felt stage** that **receives** spawned objects. Multi-surface in **one** window (not icons that spawn other Deck Hosts).
- **Slice now:** **loose leaves** + real notebooks on the felt.
- Next craft beat: **slip a leaf into a journal** (merge).

## Cuteness bar (non-negotiable vibe)

- Green **felt**, taped **labels**, lined leaf writing, brass/hand type — **adorable on purpose**.
- Closed **leaf** = **only the label** (taped paper plate). Never a cloth journal for a single leaf.
- Open leaf = **styled paper** (real hierarchy). **Edit** opens a tiny black **markdown terminal**; paper peeks live. No caret-on-pretty overlay.
- **Terminal owns save:** Ctrl+S saves file (term stays open). Ctrl+Q / × quits — prompt if dirty (quit without saving allowed). No Save on the paper.
- Edit ▌ goes **green** while terminal is open.
- Quit editor clears line highlight on paper.
- Leaf print fonts match Pocket Notebook: **body = IBM Plex Mono**, **headings = Special Elite** (cracked dual typewriter). Caveat hand is for labels/chrome, not `#` headers.
- Felt positions: **disk** `safe_box/felt_layout.json` is law (+ localStorage mirror). Boot disk-first. Do not prune mid-restore.
- Persist: drag end / fold / seal / every 4s / pagehide+beacon — never rely on debounced-only unload.
- **openW/openH** = last open paper size (not closed card 132×88). Fold must not wipe open size.
- Terminal size remembered **per object** (`termW` / `termH` on that layout key).
- Focus ring: **removed for now** (Hands disliked). Do not re-add without direction.
- Leaf open = **biggered notecard** (same cream + tape language as closed), not a different “editor window.”
- **Ctrl+S on open leaf (not in terminal)** = **seal**: save + fold. Terminal ^S still save-only.
- **Scrollbars themed** on leaf paper preview (brass/ink on cream) + md terminal (phosphor on black). Tokens: `--scroll-paper-*`, `--scroll-term-*`. Don’t leave OS default chrome on those two.
- **Author byline** on leaves (frontmatter `author`) and notebooks (under TOC). Last-used `receiver-last-author`. Company narrative: **D2E Data Mine** when Hands sets it.
- **Folders** put leaves off felt; **shelves** put books off felt; take-out returns them. Prefer these over pin-corks for cleanup.
- **Cork mat** = decorative board only (thick frame, always behind, resizable). Not the official pin container anymore.
- **Notebook:** pop-out peeks; TOC **pointer drag** reorder (`position` in frontmatter must dump); two-row band.
- **Terminal:** Ctrl+; spell toggle; green thin squiggles when engine marks.
- **Deck Host deep:** rail uses `data-deck-deep-stay` — logo + Spawn stay; Esc/F11 surface. Do not re-hide whole chrome in deep without Hands.
- Hands focus: **write docs on the felt** (Data Forestry 101, architecture leaves). Small UX asks = small diffs.
- Leave-off (2026-08-03 compact seal): `!q-and-alice-only/histories/where-left-off-2026-08-03-compaction-receiver.md`  
- **USER papers / chip·bin·config (same day, later):** `!q-and-alice-only/histories/where-left-off-2026-08-03-compaction-receiver-user-papers.md`  
- Wrap: `!q-and-alice-only/histories/workblock-wrap-2026-08-03-receiver-compaction.md`  
- Live materials: `the-deck-host/receiver/prod/safe_box/USER/{chips,bins,configs}` — path fences in Hands papers are **literal**

## Skin / CSS bootstrap (future)

Receiver is **not** fully skin-tokenized yet. Tokens live in `:root` on `app.css` (`--felt`, `--paper`, `--display`, `--mono`, `--hand`, brass…).  

**Dream:** one skin pack (CSS variables + optional class on `body.rx`) reskins felt, leaves, books, terminal motif. Do **not** hardcode a second motif in random components — keep colors on variables so a user skin can swap the whole desk.

Not bootstrapped end-to-end today; note for agents after compact.
- Closed **notebook** = real cloth book face. Open = TOC + scrub + styled leaf; same **edit terminal** for pages.
- Can **import** copies from Pocket Journal / Notebook onto the felt. Source ROMs still exist.
- Toast / copy can be warm and specific (`saved · N chars · file`). Not corporate empty success.

## Craft rules (same house as Alice)

- **Papers, please:** leaves `safe_box/leaves/*.leaf.md` (legacy `scraps/*.scrap.md` still read); notebooks `safe_box/books/*.bok`.
- **Front ends may differ** across ROMs; **papers should still sort**. Puritan “every shell identical” is not required.
- **Play / invitation** over docu furniture. If it stops feeling like a game with yourself, the shape failed — even if the data model is “correct.”
- Don’t call Hands’ wrongs **wrong** as a verdict. Own wrongs are quarry. Prefer: *didn’t hold / not this job / useful-wrong*.
- **No window.prompt / confirm** for DATBOX-adjacent desks when core dialogs exist; Receiver may use in-stage modals that match the felt.

## Launch

- `the-deck-host/receiver/prod/run-receiver.bat` · port **43200**
- Maximized at origin; optional `RECEIVER_FULLSCREEN=1`
- Launcher id: `receiver` · recipe path `the-deck-host/receiver/prod/run-in-deck-host.py`

## Compact truth

Agents forget. **Disk does not.** This file + `README.md` + the scraps on the felt are the continuity. Re-read before “improving” the cute away.

Hands: smooch the felt, not the JSON.
