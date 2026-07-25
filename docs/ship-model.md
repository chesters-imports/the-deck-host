# Shipping with Pocket Windows

## Goal

The person who uses your app should:

1. Install or unpack **one** folder (or installer)
2. Double-click **one** icon
3. Use your app

They should not need a second window running a server “for” the app, or a development environment.

---

## Recommended shape: one app, one package

Each product ships as its own desktop app. Pocket Windows is the **runtime inside that package**, not a separate program the user must install first.

Example layout (names are yours to choose):

```
YourApp/
  YourApp.exe          # Pocket Windows runtime, configured for this app
  app/                 # your web UI / local site
  data/                # optional — saves, settings, user files
```

On launch, the runtime starts whatever local services your app needs (if any), opens the window on your app’s entry page, and tears those services down when the window closes.

---

## While you are building

You may run your app’s server and the window separately. That is a **development** setup only. It is not how a finished app should be explained or delivered.

---

## Later option: one Pocket Windows, many packs

A single Pocket Windows install could load many app packs from a shelf (a “ROM deck” style library). Same runtime, different distribution story. Optional; not required for the first shipping path.

---

## Separate source, whole product

| Piece | Where it lives |
|--------|----------------|
| Pocket Windows (this project) | Runtime and packaging |
| Your app’s source | Your own project / repo |
| What the user installs | Runtime + your app files, branded as **your** product |

Source projects can stay separate. The **installed** thing is one product.

---

## Success check

Double-click the app → window opens on your UI → user work saves where your app says → quit closes cleanly, with nothing left running that the user did not ask for.
