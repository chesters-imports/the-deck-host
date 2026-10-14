/* ROM Launcher · CO.HOST-001-LAUNCH */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const sub = $("sub");
  const status = $("status");

  /** @type {any[]} */
  let allTiles = [];

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isLive(t) {
    return !!t.launchable && !t.broken && t.status !== "broken" && !t.coming_soon;
  }

  function makerName(t) {
    return String(t.producer || "").trim() || "unfiled";
  }

  function groupByMaker(tiles) {
    const map = new Map();
    for (const t of tiles) {
      const k = makerName(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    const names = [...map.keys()].sort((a, b) => {
      if (a === "unfiled") return 1;
      if (b === "unfiled") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    return names.map((name) => {
      const items = map.get(name).slice().sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        })
      );
      const chip =
        items.find((t) => t.producer_chip)?.producer_chip || "";
      return { name, chip, items };
    });
  }

  async function loadTiles() {
    const r = await fetch("/api/tiles", { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "tiles failed");
    return j.tiles || [];
  }

  function render() {
    const tiles = allTiles.filter(isLive);

    sub.textContent =
      tiles.length === 0
        ? "no cases · Install a cart, or toggle launcher_show in ROM Cat"
        : "by maker · click a case · green pins = already warm";
    status.textContent = "by maker";

    if (!tiles.length) {
      grid.innerHTML = '<div class="rl-empty">no ROMs on the shelf</div>';
      return;
    }

    const shelves = groupByMaker(tiles);
    grid.innerHTML = shelves
      .map((shelf) => {
        const chip = shelf.chip
          ? `<span class="rl-maker-chip">${esc(shelf.chip)}</span>`
          : "";
        const cases = shelf.items.map((t) => {
        // Identity from ROM Cat. Shell: classicboi | julie (+ julie_tint).
        const hue = esc(t.hue || "classic");
        const shell =
          t.case_shell === "julie" ? "julie" : "classicboi";
        const rawTint = String(t.julie_tint || "red").trim();
        const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
          rawTint
        );
        const tintClass = isHex
          ? "tint-custom"
          : "tint-" + rawTint.replace(/[^a-z0-9_-]/gi, "") || "red";
        const broken = !!t.broken || t.status === "broken";
        const soonFlag = !broken && (t.coming_soon || !t.launchable);
        const warm = t.warm;
        const disabled = broken || soonFlag || !t.launchable;
        const cls = [
          "rl-case",
          `shell-${shell}`,
          shell === "julie" ? tintClass : "",
          `hue-${hue}`,
          soonFlag ? "is-soon" : "",
          broken ? "is-broken" : "",
          warm ? "is-warm" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // Face text only for exceptional states — never stamp "ready" on every cart.
        // Warm = glowing edge contacts (pins), not a word under the reader.
        const st = broken ? "broken" : soonFlag ? "soon" : "";
        // Short plate fragment from chip (dress-up identity), not generic "ROM"
        const plate = t.label || "ROM";
        const chip = t.chip_code || "";
        const skuShort = chip
          ? chip.length > 18
            ? chip.slice(0, 16) + "…"
            : chip
          : "";
        const titleBits = [
          t.name,
          chip,
          t.producer,
          shell,
          warm ? "warm" : "",
          t.description,
        ]
          .filter(Boolean)
          .join(" · ");
        // Shared face: shell · grip lip · well · badge · plate · sku · shutter · pins
        return (
          `<button type="button" class="${cls}" data-id="${esc(t.id)}" ` +
          `${disabled ? "disabled" : ""} title="${esc(titleBits)}" ` +
          `${isHex ? `data-julie-hex="${esc(rawTint)}"` : ""}>` +
          `<span class="rl-case-shell" aria-hidden="true"></span>` +
          `<span class="rl-case-notch" aria-hidden="true"></span>` +
          `<span class="rl-case-well" aria-hidden="true"></span>` +
          `<span class="rl-case-badge" title="short plate">${esc(plate)}</span>` +
          `<span class="rl-case-label" data-plate>` +
          `<span class="rl-case-label-main">${esc(t.name || plate)}</span>` +
          `</span>` +
          `<span class="rl-case-sku">${esc(skuShort)}</span>` +
          `<span class="rl-case-shutter" aria-hidden="true"></span>` +
          `<span class="rl-case-pins" aria-hidden="true" title="edge contacts"></span>` +
          (st
            ? `<span class="rl-case-status">${esc(st)}</span>`
            : "") +
          `</button>`
        );
        }).join("");
        return (
          `<section class="rl-maker">` +
          `<h2 class="rl-maker-h">` +
          `<span class="rl-maker-name">${esc(shelf.name)}</span>` +
          chip +
          `</h2>` +
          `<div class="rl-maker-cases">${cases}</div>` +
          `</section>`
        );
      })
      .join("");

    // Apply Cat plate_css + custom julie hex onto cases
    grid.querySelectorAll(".rl-case").forEach((btn) => {
      const id = btn.getAttribute("data-id");
      const t = tiles.find((x) => x.id === id);
      const plateEl = btn.querySelector("[data-plate]");
      if (plateEl && t && t.plate_css) {
        plateEl.style.cssText = t.plate_css;
        plateEl.classList.add("has-custom-plate");
      }
      const hex = btn.getAttribute("data-julie-hex");
      if (hex) {
        btn.style.setProperty("--julie", hex);
      }
    });

    grid.querySelectorAll(".rl-case:not(:disabled)").forEach((btn) => {
      btn.addEventListener("click", () => launch(btn.getAttribute("data-id")));
    });
  }

  async function launch(id) {
    status.textContent = `go ${id}`;
    try {
      const r = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast(j.error || "launch failed");
        status.textContent = "fail";
        return;
      }
      toast(j.message || "launched");
      status.textContent = j.already
        ? `warm${j.port ? " :" + j.port : ""}`
        : `pid ${j.pid || "—"}`;
      setTimeout(refresh, 1200);
    } catch (e) {
      console.error(e);
      toast("launch error");
    }
  }

  async function refresh() {
    try {
      allTiles = await loadTiles();
      render();
    } catch (e) {
      console.error(e);
      sub.textContent = "catalog fail";
      grid.innerHTML =
        '<div class="rl-empty">Could not read ROM Cat / recipes.</div>';
    }
  }

  async function unstick() {
    status.textContent = "unstick…";
    try {
      const r = await fetch("/api/unstick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await r.json();
      if (!j.ok) {
        toast(j.error || "unstick failed");
        status.textContent = "unstick fail";
        return;
      }
      toast(j.message || "unstuck");
      status.textContent =
        j.count > 0
          ? `killed ${j.count}`
          : "all quiet";
      setTimeout(refresh, 600);
    } catch (e) {
      console.error(e);
      toast("unstick error");
      status.textContent = "unstick fail";
    }
  }

  function hostApi() {
    return window.pywebview && window.pywebview.api;
  }

  async function pickThenInstall(kind) {
    const a = hostApi();
    if (!a) {
      toast("open in Deck Host to install");
      return;
    }
    status.textContent = "install…";
    try {
      const path =
        kind === "folder"
          ? await a.pick_folder()
          : await a.pick_archive();
      if (!path) {
        status.textContent = "—";
        return;
      }
      const r = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast(j.error || "install failed");
        status.textContent = "install fail";
        return;
      }
      toast(j.message || "seated");
      status.textContent = j.id ? `seated ${j.id}` : "seated";
      setTimeout(refresh, 400);
    } catch (e) {
      console.error(e);
      toast("install error");
      status.textContent = "install fail";
    }
  }

  const LS_SHELL = "deck-launcher-shell";
  const SHELLS = [
    { id: "base", label: "Base" },
    { id: "lightclassic", label: "Light classic" },
  ];

  function currentShell() {
    try {
      const id = localStorage.getItem(LS_SHELL) || "base";
      return SHELLS.some((s) => s.id === id) ? id : "base";
    } catch (e) {
      return "base";
    }
  }

  function applyShell(id) {
    const skin = SHELLS.find((s) => s.id === id) || SHELLS[0];
    try {
      localStorage.setItem(LS_SHELL, skin.id);
    } catch (e) {}
    document.documentElement.setAttribute("data-launcher-shell", skin.id);
    let link = document.getElementById("launcher-shell-dsc");
    if (skin.id === "base") {
      if (link) link.remove();
      return;
    }
    const href = "/skins/launcher-" + skin.id + ".dsc";
    if (!link) {
      link = document.createElement("link");
      link.id = "launcher-shell-dsc";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  }

  function pickShell(id) {
    applyShell(id);
    const skin = SHELLS.find((s) => s.id === id);
    toast((skin && skin.label) || id);
  }

  window.DECK_ROM_MENU = [
    { label: "Refresh cases", run: refresh },
    { label: "Install ROM…", run: function () { pickThenInstall("rom"); } },
    { label: "Install folder…", run: function () { pickThenInstall("folder"); } },
    {
      label: "Shell",
      items: SHELLS.map((s) => ({
        labelFn: function () {
          return (currentShell() === s.id ? "● " : "○ ") + s.label;
        },
        run: function () {
          pickShell(s.id);
        },
      })),
    },
    { sep: true },
    { label: "Unstick", run: unstick },
  ];

  applyShell(currentShell());

  $("btnRefresh").addEventListener("click", refresh);
  if ($("btnUnstick")) $("btnUnstick").addEventListener("click", unstick);
  if ($("btnInstall")) {
    $("btnInstall").addEventListener("click", () => pickThenInstall("rom"));
  }
  refresh();
  setInterval(refresh, 8000);
})();
