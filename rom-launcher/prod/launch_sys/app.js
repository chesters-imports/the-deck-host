/* ROM Launcher · CO.HOST-001-LAUNCH */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const sub = $("sub");
  const status = $("status");

  /** @type {any[]} */
  let allTiles = [];
  let tab = "live"; // live | soon

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

  function isSoonOrBroken(t) {
    return !isLive(t);
  }

  async function loadTiles() {
    const r = await fetch("/api/tiles", { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "tiles failed");
    return j.tiles || [];
  }

  function setTab(name) {
    tab = name;
    $("tabLive").classList.toggle("is-on", name === "live");
    $("tabSoon").classList.toggle("is-on", name === "soon");
    $("tabLive").setAttribute("aria-selected", name === "live" ? "true" : "false");
    $("tabSoon").setAttribute("aria-selected", name === "soon" ? "true" : "false");
    render();
  }

  function render() {
    const live = allTiles.filter(isLive);
    const soon = allTiles.filter(isSoonOrBroken);
    $("nLive").textContent = String(live.length);
    $("nSoon").textContent = String(soon.length);

    const tiles = tab === "live" ? live : soon;

    if (tab === "live") {
      sub.textContent =
        live.length === 0
          ? "no live cases · toggle launcher_show in ROM Cat"
          : "click a case · green pins = already warm (running)";
      status.textContent = "live shelf";
    } else {
      sub.textContent =
        soon.length === 0
          ? "nothing waiting"
          : "broken + coming soon · not launchable";
      status.textContent = "soon shelf";
    }

    if (!tiles.length) {
      grid.innerHTML =
        tab === "live"
          ? '<div class="rl-empty">no live ROMs</div>'
          : '<div class="rl-empty">shelf empty</div>';
      return;
    }

    grid.innerHTML = tiles
      .map((t) => {
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
        // Shared face: shell · black lip · badge fragment · plate · sku · pins
        return (
          `<button type="button" class="${cls}" data-id="${esc(t.id)}" ` +
          `${disabled ? "disabled" : ""} title="${esc(titleBits)}" ` +
          `${isHex ? `data-julie-hex="${esc(rawTint)}"` : ""}>` +
          `<span class="rl-case-shell" aria-hidden="true"></span>` +
          `<span class="rl-case-notch" aria-hidden="true"></span>` +
          `<span class="rl-case-badge" title="short plate">${esc(plate)}</span>` +
          `<span class="rl-case-label" data-plate>` +
          `<span class="rl-case-label-main">${esc(t.name || plate)}</span>` +
          `</span>` +
          `<span class="rl-case-sku">${esc(skuShort)}</span>` +
          `<span class="rl-case-pins" aria-hidden="true" title="edge contacts"></span>` +
          (st
            ? `<span class="rl-case-status">${esc(st)}</span>`
            : "") +
          `</button>`
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

  $("tabLive").addEventListener("click", () => setTab("live"));
  $("tabSoon").addEventListener("click", () => setTab("soon"));
  $("btnRefresh").addEventListener("click", refresh);
  if ($("btnUnstick")) $("btnUnstick").addEventListener("click", unstick);
  refresh();
  setInterval(refresh, 8000);
})();
