# Shipping ROMs with Pocket Windows

## Goal

The person who uses your ROM should:

1. Install or unpack **one** folder (or installer)
2. Double-click **one** icon
3. Use your ROM

They should not need a second window running a server “for” the ROM, or a development environment.

---

## Recommended shape: one ROM, one package

Each product ships as its own desktop program. Pocket Windows is the **runtime inside that package**, not a separate program the user must install first.

Example layout (names are yours to choose):

```
YourROM/
  YourROM.exe          # Pocket Windows runtime, configured for this ROM
  rom/                 # your web UI / local surface
  data/                # optional — saves, settings, user files
```

On launch, the runtime starts whatever local services your ROM needs (if any), opens the window on your ROM’s entry page, and tears those services down when the window closes.

---

## While you are building

You may run your ROM’s server and the window separately. That is a **development** setup only. It is not how a finished ROM should be explained or delivered.

---

## Later option: one Pocket Windows, many ROMs

A single Pocket Windows install could load many ROMs from a shelf (a **ROM deck**). Same runtime, different distribution story. Optional; not required for the first shipping path.

---

## Separate source, whole product

| Piece | Where it lives |
|--------|----------------|
| Pocket Windows (this project) | Runtime and packaging |
| Your ROM’s source | Your own project / repo |
| What the user installs | Runtime + your ROM files, branded as **your** product |

Source projects can stay separate. The **installed** thing is one product.

---

## Success check

Double-click the ROM → window opens on your UI → user work saves where your ROM says → quit closes cleanly, with nothing left running that the user did not ask for.
