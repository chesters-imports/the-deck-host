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
          : "click a case · warm = already running";
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
        const hue = esc(t.hue || "steel");
        const broken = !!t.broken || t.status === "broken";
        const soonFlag = !broken && (t.coming_soon || !t.launchable);
        const warm = t.warm;
        const disabled = broken || soonFlag || !t.launchable;
        const cls = [
          "rl-case",
          `hue-${hue}`,
          soonFlag ? "is-soon" : "",
          broken ? "is-broken" : "",
          warm ? "is-warm" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const st = broken
          ? "broken"
          : soonFlag
            ? "coming soon"
            : warm
              ? "warm"
              : "ready";
        return (
          `<button type="button" class="${cls}" data-id="${esc(t.id)}" ` +
          `${disabled ? "disabled" : ""} title="${esc(t.description || t.name)}">` +
          `<span class="rl-case-shell" aria-hidden="true"></span>` +
          `<span class="rl-case-notch" aria-hidden="true"></span>` +
          `<span class="rl-case-ridge" aria-hidden="true"></span>` +
          `<span class="rl-case-badge">${esc(t.label || "ROM")}</span>` +
          `<span class="rl-case-label">` +
          `<span class="rl-case-label-main">${esc(t.label || t.name)}</span>` +
          `<span class="rl-case-label-sub">${esc(t.sub || "")}</span>` +
          `</span>` +
          `<span class="rl-case-pins" aria-hidden="true"></span>` +
          `<span class="rl-case-status">${esc(st)}</span>` +
          `</button>`
        );
      })
      .join("");

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

  $("tabLive").addEventListener("click", () => setTab("live"));
  $("tabSoon").addEventListener("click", () => setTab("soon"));
  $("btnRefresh").addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 8000);
})();
