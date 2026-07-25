# Ship model — Pocket Windows

## Target for now: **B — per-toy standalone app**

User gets something like:

```
loreBOX/
  loreBOX.exe          (or platform launcher name)
  app/                 toy surface (desk)
  safe_box/            operator data
  box_sets/            settings
```

**Double-click → app runs.**  
No separate “start the server in a terminal while Grok watches” ritual for the operator.

Internally, the app may still use a local web surface + embedded runtime. That is an implementation detail. The **product** is one click.

## Dev vs ship

| Mode | Who | How |
|------|-----|-----|
| **Dev** | Hands / wire | May run server + shell separately while building |
| **Ship** | Operator | One icon; runtime owns lifecycle (start glass, start local services if needed, shut down clean) |

Never call dev mode the product.

## Later dream: **A — ROM deck**

One Pocket Windows install; toys load as packs/ROMs on a shelf.  
Not the first ship target. Compatible later if packs are the same shape as a toy’s `app/` + manifest.

## Island law

- **chesters-imports/pocket-windows** — engine  
- Toy repos (e.g. datbox-studio) — product source  
- **No** messy myPI / pocket-browser migration leftovers in this tree  
- Full product language: **Pocket Windows**, pocket window, glass — not farm hosts `b` / mypi captions as product names  

## First success (when runtime lands)

Double-click **loreBOX** (packaged with Pocket Windows) → window opens on the desk → safe_box works on disk → quit leaves nothing orphaned in a terminal.
