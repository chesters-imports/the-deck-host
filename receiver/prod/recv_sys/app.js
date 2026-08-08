/* Receiver · loose leaves (labels) + real notebooks (cloth + TOC) on the felt */
(() => {
  "use strict";

  // Deck Host doors — Receiver actions + host hard refresh (don't replace away reload)
  window.DECK_ROM_MENU = [
    {
      label: "Spawn…",
      run: function () {
        var b = document.getElementById("btnSpawn");
        if (b) b.click();
      },
    },
    { sep: true },
    { label: "Hard refresh", action: "hard_refresh" },
    { label: "Reload", action: "reload" },
    { sep: true },
    {
      label: "Surface · exit deep (Esc)",
      run: function () {
        if (typeof window.deckHostDeep === "function") window.deckHostDeep(false);
      },
    },
  ];

  // Immersion: when Deck Host integrates, go deep (logo + spawn rail stays)
  (function preferDeepWhenReady() {
    var n = 0;
    var t = setInterval(function () {
      n += 1;
      if (typeof window.deckHostDeep === "function") {
        clearInterval(t);
        try {
          window.deckHostDeep(true);
        } catch (e) {}
        return;
      }
      if (n > 50) clearInterval(t);
    }, 80);
  })();

  const $ = (id) => document.getElementById(id);
  const felt = $("felt");
  let zTop = 20;
  let spawnN = 0;
  /** @type {Map<string, object>} */
  const wins = new Map();
  const CLOTHS = ["oxblood", "forest", "navy", "sand"];
  /** @type {'leaf'|'notebook'|'import'|'cork'} */
  let spawnKind = "leaf";
  let externalList = [];
  const LAYOUT_KEY = "receiver-felt-v1";
  const LAST_AUTHOR_KEY = "receiver-last-author";
  const TERM_SPELL_KEY = "receiver-term-spellcheck";
  /** In-memory layout — source of truth after boot load from disk */
  let layoutCache = {};
  let layoutReady = false;
  let layoutDiskTimer = null;
  /** true while restore() is mounting — never prune / never clobber disk mid-restore */
  let restoring = false;

  function getLastAuthor() {
    try {
      const a = (localStorage.getItem(LAST_AUTHOR_KEY) || "").trim();
      return a || "unknown";
    } catch (_) {
      return "unknown";
    }
  }

  function rememberAuthor(name) {
    const a = (name || "").trim() || "unknown";
    try {
      localStorage.setItem(LAST_AUTHOR_KEY, a);
    } catch (_) {}
    return a;
  }

  function normalizeAuthor(name) {
    return (name || "").trim() || "unknown";
  }

  function getTermSpellcheck() {
    try {
      return localStorage.getItem(TERM_SPELL_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setTermSpellcheck(on) {
    try {
      localStorage.setItem(TERM_SPELL_KEY, on ? "1" : "0");
    } catch (_) {}
    return !!on;
  }

  function loadLayout() {
    return layoutCache && typeof layoutCache === "object" ? layoutCache : {};
  }

  function loadLayoutFromLocal() {
    try {
      const j = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch (_) {
      return {};
    }
  }

  function mirrorLayoutLocal() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutCache));
    } catch (_) {}
  }

  /** Read x/y from element; never invent 0,0 when style is empty. */
  function readWinXY(win, prev) {
    prev = prev || {};
    let left = parseFloat(win.el.style.left);
    let top = parseFloat(win.el.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      try {
        const er = win.el.getBoundingClientRect();
        const fr = felt.getBoundingClientRect();
        if (!Number.isFinite(left)) left = er.left - fr.left + felt.scrollLeft;
        if (!Number.isFinite(top)) top = er.top - fr.top + felt.scrollTop;
      } catch (_) {}
    }
    const x = Number.isFinite(left)
      ? left
      : typeof prev.x === "number" && Number.isFinite(prev.x)
        ? prev.x
        : null;
    const y = Number.isFinite(top)
      ? top
      : typeof prev.y === "number" && Number.isFinite(prev.y)
        ? prev.y
        : null;
    return { x, y };
  }

  async function bootLayout() {
    // Prefer disk (survives server restart + WebView storage weirdness)
    let disk = null;
    try {
      const j = await api("/api/layout");
      if (j.ok && j.layout && typeof j.layout === "object") {
        disk = j.layout;
      }
    } catch (_) {
      /* fall through */
    }
    const local = loadLayoutFromLocal();
    // Merge: disk wins on conflict, but keep any local-only keys (e.g. disk lag)
    if (disk && Object.keys(disk).length) {
      layoutCache = { ...local, ...disk };
      // if local had fresher coords for a key (higher x+y variance), still prefer disk —
      // disk is the restart-safe source. local only fills missing keys.
      for (const k of Object.keys(local)) {
        if (!layoutCache[k]) layoutCache[k] = local[k];
        else {
          // fill missing openW/openH/term from local if disk lacks them
          const D = layoutCache[k];
          const L = local[k];
          if (L && typeof L === "object") {
            if (D.openW == null && L.openW != null) D.openW = L.openW;
            if (D.openH == null && L.openH != null) D.openH = L.openH;
            if (D.termW == null && L.termW != null) D.termW = L.termW;
            if (D.termH == null && L.termH != null) D.termH = L.termH;
          }
        }
      }
    } else {
      layoutCache = local;
    }
    mirrorLayoutLocal();
    layoutReady = true;
    // always push merged → disk so restart has full picture
    if (Object.keys(layoutCache).length) {
      await pushLayoutDisk({ keepalive: false });
    }
    return layoutCache;
  }

  function saveLayoutSoon() {
    clearTimeout(saveLayoutSoon._t);
    saveLayoutSoon._t = setTimeout(() => flushLayout(), 60);
  }

  /** POST layoutCache to disk. keepalive for unload paths. */
  function pushLayoutDisk(opts) {
    opts = opts || {};
    const body = JSON.stringify({ layout: layoutCache });
    clearTimeout(layoutDiskTimer);
    layoutDiskTimer = null;
    if (opts.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/layout", blob)) return Promise.resolve();
      } catch (_) {}
    }
    return fetch("/api/layout", {
      method: "POST",
      cache: "no-store",
      keepalive: !!opts.keepalive,
      headers: { "Content-Type": "application/json" },
      body,
    })
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({}));
  }

  function scheduleDiskWrite() {
    clearTimeout(layoutDiskTimer);
    // short debounce so drag storms don't hammer disk; still near-immediate
    layoutDiskTimer = setTimeout(() => {
      pushLayoutDisk({ keepalive: false });
    }, 80);
  }

  /** Merge current win positions into cache + localStorage + disk. */
  function flushLayout(opts) {
    opts = opts || {};
    const layout = loadLayout();
    wins.forEach((win, key) => {
      const prev = layout[key] || {};
      const { x, y } = readWinXY(win, prev);
      // refuse to clobber a known good position with null/missing
      const outX =
        x != null && Number.isFinite(x)
          ? x
          : typeof prev.x === "number"
            ? prev.x
            : 0;
      const outY =
        y != null && Number.isFinite(y)
          ? y
          : typeof prev.y === "number"
            ? prev.y
            : 0;
      const open = !!win.open;
      const w = win.el.offsetWidth || 0;
      const h = win.el.offsetHeight || 0;
      let openW = prev.openW;
      let openH = prev.openH;
      if (open && w > 200 && h > 160) {
        openW = w;
        openH = h;
        win._lastOpenW = w;
        win._lastOpenH = h;
      } else if (win._lastOpenW && win._lastOpenH) {
        openW = win._lastOpenW;
        openH = win._lastOpenH;
      }
      // never store closed-card size as openW/H
      if (openW != null && openW < 200) openW = prev.openW;
      if (openH != null && openH < 160) openH = prev.openH;
      layout[key] = {
        x: outX,
        y: outY,
        w: w || prev.w,
        h: h || prev.h,
        openW: openW,
        openH: openH,
        open: open,
        pageIdx: win.pageIdx || 0,
        kind: win.kind,
        termW: win.termEl
          ? win.termEl.offsetWidth
          : prev.termW || undefined,
        termH: win.termEl
          ? win.termEl.offsetHeight
          : prev.termH || undefined,
      };
    });
    // never prune while restore is still mounting objects
    if (opts.prune && !restoring) {
      const alive = new Set(wins.keys());
      Object.keys(layout).forEach((k) => {
        if (!alive.has(k)) delete layout[k];
      });
    }
    layoutCache = layout;
    mirrorLayoutLocal();
    if (opts.immediate || opts.beacon) {
      pushLayoutDisk({ keepalive: true, beacon: !!opts.beacon });
    } else if (!restoring) {
      scheduleDiskWrite();
    }
  }

  function applyLayout(win, key) {
    const L = loadLayout()[key];
    if (!L) return null;
    if (typeof L.x === "number" && Number.isFinite(L.x)) {
      win.el.style.left = Math.round(L.x) + "px";
    }
    if (typeof L.y === "number" && Number.isFinite(L.y)) {
      win.el.style.top = Math.round(L.y) + "px";
    }
    if (typeof L.pageIdx === "number") win.pageIdx = L.pageIdx;
    if (L.openW) win._lastOpenW = L.openW;
    if (L.openH) win._lastOpenH = L.openH;
    return L;
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2800);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts) {
    const r = await fetch(path, {
      cache: "no-store",
      headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
      ...opts,
    });
    const j = await r.json();
    if (!r.ok && j && j.error) throw new Error(j.error);
    return j;
  }

  const Z_CORK_BACK = 2; // cork mats live under everything else

  function bringFront(el) {
    // decorative cork stays behind papers / books / folders
    if (el && el.classList && el.classList.contains("kind-cork")) {
      el.style.zIndex = String(Z_CORK_BACK);
      return;
    }
    zTop += 1;
    if (zTop < 20) zTop = 20;
    el.style.zIndex = String(zTop);
    // focus ring removed for now (Hands: didn't work / not the right cue yet)
  }

  function stickCorkBack(win) {
    if (win && win.el) win.el.style.zIndex = String(Z_CORK_BACK);
  }

  function layoutKeyForWin(win) {
    if (!win || !win.data) return null;
    if (win.kind === "leaf") return "leaf:" + win.data.id;
    if (win.kind === "notebook") return "book:" + win.data.id;
    if (win.kind === "cork") return "cork:" + win.data.id;
    if (win.kind === "folder") return "folder:" + win.data.id;
    if (win.kind === "shelf") return "shelf:" + win.data.id;
    return null;
  }

  function unmountWin(key) {
    const win = wins.get(key);
    if (!win) return;
    closeMdTerminal(win, { force: true });
    if (win.el && win.el.parentNode) win.el.remove();
    wins.delete(key);
    const layout = loadLayout();
    if (layout[key]) {
      delete layout[key];
      layoutCache = layout;
      mirrorLayoutLocal();
    }
  }

  async function listFolderOptions() {
    try {
      const j = await api("/api/folders");
      return j.folders || [];
    } catch (_) {
      return [];
    }
  }

  /** Ctrl+S on paper (not in terminal): save + fold — “seal the notecard” */
  async function sealLeaf(win) {
    if (!win || win.kind !== "leaf" || !win.open) return;
    if (win.termEl && win.termDirty) {
      // still allow seal — save current term body first
      const ta = win.termEl.querySelector(".md-term-ta");
      if (ta) win.data.body = ta.value;
    }
    if (win.open) {
      win._lastOpenW = win.el.offsetWidth;
      win._lastOpenH = win.el.offsetHeight;
    }
    closeMdTerminal(win, { force: true });
    await saveScrap(win, { quiet: false });
    const key = layoutKeyForWin(win);
    if (key) {
      const layout = loadLayout();
      const cur = layout[key] || {};
      const xy = readWinXY(win, cur);
      cur.openW = win._lastOpenW || cur.openW;
      cur.openH = win._lastOpenH || cur.openH;
      cur.open = false;
      if (xy.x != null) cur.x = xy.x;
      if (xy.y != null) cur.y = xy.y;
      layout[key] = cur;
      layoutCache = layout;
      mirrorLayoutLocal();
    }
    renderScrapClosed(win);
    flushLayout({ immediate: true });
    toast("sealed · folded");
  }

  function rememberTermSize(win) {
    if (!win || !win.termEl) return;
    const key = layoutKeyForWin(win);
    if (!key) return;
    const layout = loadLayout();
    const cur = layout[key] || {};
    cur.termW = win.termEl.offsetWidth || cur.termW;
    cur.termH = win.termEl.offsetHeight || cur.termH;
    layout[key] = cur;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch (_) {
      /* ignore */
    }
  }

  function placeOffset() {
    spawnN += 1;
    return {
      x: 36 + ((spawnN * 40) % 300),
      y: 32 + ((spawnN * 30) % 220),
    };
  }

  function paintPaper(el, md, followLine) {
    const body = el.querySelector("[data-paper-preview]");
    if (!body) return;
    const fn =
      (window.ReceiverLiveMd && ReceiverLiveMd.renderMarkdown) ||
      ((s) =>
        "<pre style='white-space:pre-wrap;margin:0;font:inherit'>" +
        esc(s) +
        "</pre>");
    const prevScroll = body.scrollTop;
    body.innerHTML = fn(md || "");
    if (
      typeof followLine === "number" &&
      window.ReceiverLiveMd &&
      ReceiverLiveMd.scrollPreviewToLine
    ) {
      ReceiverLiveMd.scrollPreviewToLine(body, followLine);
    } else {
      body.scrollTop = prevScroll;
    }
  }

  function syncPaperToTerm(win) {
    if (!win.termEl || !win.el) return;
    const ta = win.termEl.querySelector(".md-term-ta");
    const preview = win.el.querySelector("[data-paper-preview]");
    if (!ta || !preview || !window.ReceiverLiveMd) return;
    const line = ReceiverLiveMd.caretLine(ta);
    ReceiverLiveMd.scrollPreviewToLine(preview, line);
  }

  function setLeafEditUi(win, on) {
    const btn = win.el && win.el.querySelector("[data-act=edit]");
    if (btn) btn.classList.toggle("is-editing", !!on);
    win.el && win.el.classList.toggle("is-term-open", !!on);
  }

  /** Tiny black markdown terminal — felt pen session for leaves */
  function openMdTerminal(win, opts) {
    opts = opts || {};
    closeMdTerminal(win, { force: true });
    const term = document.createElement("div");
    term.className = "md-term";
    term.innerHTML =
      '<div class="md-term-bar" data-term-drag>' +
      '<span class="md-term-dot" aria-hidden="true"></span>' +
      '<span class="md-term-title">' +
      esc(opts.title || "markdown") +
      "</span>" +
      '<span class="md-term-hint">^S save · ^⇧D time · ^⇧M mark · ^; spell · ^Q quit</span>' +
      '<button type="button" class="md-term-x" data-term-close title="quit terminal (^Q)">×</button>' +
      "</div>" +
      '<textarea class="md-term-ta" spellcheck="false" autocomplete="off"></textarea>' +
      '<div class="md-term-status" data-term-status></div>' +
      '<div class="md-term-resize" data-term-resize></div>';
    felt.appendChild(term);
    win.termEl = term;
    win.termDirty = false;
    win.termBaseline = opts.value != null ? String(opts.value) : "";

    const paperRect = win.el.getBoundingClientRect();
    const feltRect = felt.getBoundingClientRect();
    const lk = layoutKeyForWin(win);
    const saved = lk ? loadLayout()[lk] || {} : {};
    const tw = saved.termW > 160 ? saved.termW : 220;
    const th = saved.termH > 100 ? saved.termH : 140;
    let tx = paperRect.right - feltRect.left - 40;
    let ty = paperRect.bottom - feltRect.top - 20;
    if (tx + tw > feltRect.width - 8) tx = feltRect.width - tw - 12;
    if (ty + th > feltRect.height - 8) ty = feltRect.height - th - 12;
    if (tx < 8) tx = 8;
    if (ty < 8) ty = 8;
    term.style.left = tx + "px";
    term.style.top = ty + "px";
    term.style.width = tw + "px";
    term.style.height = th + "px";
    bringFront(term);
    setLeafEditUi(win, true);

    const ta = term.querySelector(".md-term-ta");
    const status = term.querySelector("[data-term-status]");
    ta.value = win.termBaseline;
    ta.placeholder = "# header\n**bold**  ++underline++\n- list\n@name";
    // restore last spellcheck preference (default off — markdown-friendly)
    ta.spellcheck = getTermSpellcheck();

    /** Nudge the engine to re-run spell marks without needing a space (WebView-ish). */
    function forceSpellRefresh() {
      if (!ta.spellcheck) return;
      const v = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      try {
        ta.spellcheck = false;
        ta.spellcheck = true;
        // zero-width nudge then restore (triggers recheck in Chromium)
        ta.value = v + "\u200b";
        ta.value = v;
        if (typeof s === "number") ta.setSelectionRange(s, e);
      } catch (_) {}
    }

    function flashStatus(msg, ms) {
      if (!status) return;
      status.dataset.flash = "1";
      status.textContent = msg;
      status.classList.add("is-saved");
      setTimeout(() => {
        delete status.dataset.flash;
        status.classList.remove("is-saved");
        if (!win.termDirty) status.textContent = "";
        else status.textContent = "· unsaved";
      }, ms || 1200);
    }

    function toggleSpell() {
      const on = setTermSpellcheck(!ta.spellcheck);
      ta.spellcheck = on;
      ta.blur();
      ta.focus();
      if (on) {
        requestAnimationFrame(() => {
          forceSpellRefresh();
          setTimeout(forceSpellRefresh, 50);
        });
      }
      flashStatus(on ? "· spell on" : "· spell off", 1400);
    }
    // if spell was already on from last session, mark right away
    if (ta.spellcheck) {
      requestAnimationFrame(() => setTimeout(forceSpellRefresh, 30));
    }

    function markDirty() {
      win.termDirty = ta.value !== win.termBaseline;
      term.classList.toggle("is-dirty", win.termDirty);
      if (status && !status.dataset.flash) {
        status.textContent = win.termDirty ? "· unsaved" : "";
      }
    }

    function push() {
      markDirty();
      if (opts.onChange) opts.onChange(ta.value);
      // re-paint already done in onChange; follow caret line on paper
      syncPaperToTerm(win);
    }
    ta.addEventListener("input", push);
    ta.addEventListener("click", () => syncPaperToTerm(win));
    ta.addEventListener("keyup", () => syncPaperToTerm(win));
    ta.addEventListener("select", () => syncPaperToTerm(win));

    async function doSave() {
      if (opts.onSave) await opts.onSave();
      win.termBaseline = ta.value;
      win.termDirty = false;
      term.classList.remove("is-dirty");
      flashStatus("· saved", 1200);
    }

    async function requestQuit() {
      if (win.termDirty) {
        const leave = window.confirm(
          "Terminal has unsaved markdown.\n\nOK = quit without saving\nCancel = keep editing"
        );
        if (!leave) {
          ta.focus();
          return;
        }
      }
      closeMdTerminal(win, { force: true });
      if (opts.onClose) opts.onClose();
    }

    function stampNow() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      // local wall clock — letter / log friendly
      const stamp =
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes());
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const v = ta.value;
      // exact caret insert — you place the stamp; no forced newlines
      ta.value = v.slice(0, start) + stamp + v.slice(end);
      const caret = start + stamp.length;
      ta.setSelectionRange(caret, caret);
      ta.focus();
      push();
      flashStatus("· stamped " + stamp, 1000);
    }

    ta.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
        ev.preventDefault();
        doSave();
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "q" || ev.key === "Q")) {
        ev.preventDefault();
        requestQuit();
      }
      // Ctrl+Shift+D — date/time stamp at caret (letter / log)
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.shiftKey &&
        (ev.key === "d" || ev.key === "D")
      ) {
        ev.preventDefault();
        stampNow();
      }
      // Ctrl+Shift+M — paper rubber-stamp picker (mark the object, not the body)
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.shiftKey &&
        (ev.key === "m" || ev.key === "M")
      ) {
        ev.preventDefault();
        if (win.kind === "leaf") showStampPicker(win, term);
      }
      // Ctrl+; toggle browser spellcheck (stays for next term session)
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === ";" || ev.code === "Semicolon")) {
        ev.preventDefault();
        toggleSpell();
      }
    });

    term.querySelector("[data-term-close]").onclick = (ev) => {
      ev.stopPropagation();
      requestQuit();
    };

    const bar = term.querySelector("[data-term-drag]");
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest("button")) return;
      bringFront(term);
      const r = term.getBoundingClientRect();
      const fr = felt.getBoundingClientRect();
      const ox = ev.clientX - r.left;
      const oy = ev.clientY - r.top;
      function move(e) {
        let x = e.clientX - fr.left - ox;
        let y = e.clientY - fr.top - oy;
        x = Math.max(0, Math.min(x, fr.width - 60));
        y = Math.max(0, Math.min(y, fr.height - 40));
        term.style.left = x + "px";
        term.style.top = y + "px";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ev.preventDefault();
    });

    term.querySelector("[data-term-resize]").addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      bringFront(term);
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startW = term.offsetWidth;
      const startH = term.offsetHeight;
      function move(e) {
        term.style.width = Math.max(160, startW + (e.clientX - startX)) + "px";
        term.style.height = Math.max(100, startH + (e.clientY - startY)) + "px";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        rememberTermSize(win);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ev.preventDefault();
      ev.stopPropagation();
    });

    term.addEventListener("mousedown", () => bringFront(term));
    setTimeout(() => ta.focus(), 30);
    return term;
  }

  function clearSrcLineHighlight(win) {
    const preview =
      (win && win.el && win.el.querySelector("[data-paper-preview]")) || null;
    if (!preview) return;
    preview.querySelectorAll(".is-src-line").forEach((n) => {
      n.classList.remove("is-src-line");
    });
  }

  /**
   * Close markdown terminal.
   * @returns {boolean} false if dirty and user cancelled (or silent block)
   */
  function closeMdTerminal(win, opts) {
    opts = opts || {};
    if (!win.termEl) {
      setLeafEditUi(win, false);
      clearSrcLineHighlight(win);
      return true;
    }
    if (win.termDirty && !opts.force) {
      if (opts.silent) return false;
      const leave = window.confirm(
        "Terminal has unsaved markdown.\n\nOK = close without saving\nCancel = keep editing"
      );
      if (!leave) return false;
    }
    rememberTermSize(win);
    win.termEl.remove();
    win.termEl = null;
    win.termDirty = false;
    win.termBaseline = null;
    win.termPageIdx = null;
    setLeafEditUi(win, false);
    clearSrcLineHighlight(win);
    return true;
  }

  // ── shared drag / resize ─────────────────────────────
  function startDrag(win, ev, onMoveFlag) {
    const el = win.el;
    bringFront(el);
    const rect = el.getBoundingClientRect();
    const feltRect = felt.getBoundingClientRect();
    const ox = ev.clientX - rect.left;
    const oy = ev.clientY - rect.top;
    function move(e) {
      if (onMoveFlag) onMoveFlag();
      let x = e.clientX - feltRect.left - ox;
      let y = e.clientY - feltRect.top - oy;
      x = Math.max(0, Math.min(x, feltRect.width - 40));
      y = Math.max(0, Math.min(y, feltRect.height - 40));
      el.style.left = x + "px";
      el.style.top = y + "px";
      saveLayoutSoon();
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      flushLayout({ immediate: true });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    ev.preventDefault();
  }

  function startResize(win, ev, minW, minH) {
    const el = win.el;
    bringFront(el);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const rememberOpen =
      win.open && (win.kind === "leaf" || win.kind === "notebook");
    function move(e) {
      const nw = Math.max(minW, startW + (e.clientX - startX));
      const nh = Math.max(minH, startH + (e.clientY - startY));
      el.style.width = nw + "px";
      el.style.height = nh + "px";
      if (rememberOpen) {
        win._lastOpenW = nw;
        win._lastOpenH = nh;
      }
      saveLayoutSoon();
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (rememberOpen) {
        win._lastOpenW = el.offsetWidth;
        win._lastOpenH = el.offsetHeight;
      }
      flushLayout({ immediate: true });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    ev.preventDefault();
    ev.stopPropagation();
  }

  // ═══════════════════════════════════════════════════════
  // LOOSE LEAVES
  // ═══════════════════════════════════════════════════════
  /** Stable-ish random tilt for closed notecards (−6°…+6°) from id. */
  function leafTiltDeg(id) {
    const s = String(id || "x");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 13) - 6); // -6 .. +6
  }

  function renderScrapClosed(win) {
    closeMdTerminal(win, { force: true });
    win.open = false;
    const el = win.el;
    el.className = "nb-win is-closed kind-leaf";
    const tilt = leafTiltDeg(win.data.id);
    const author = normalizeAuthor(win.data.author);
    const sub =
      author && author !== "unknown" ? "by " + author : "loose leaf";
    el.innerHTML =
      '<button type="button" class="scrap-label" data-drag-face style="--tilt:' +
      tilt +
      'deg">' +
      '<span class="scrap-label-tape" aria-hidden="true"></span>' +
      '<span class="scrap-label-text"></span>' +
      '<span class="scrap-label-sub' +
      (author !== "unknown" ? " is-author" : "") +
      '"></span>' +
      closedStampBadgeHtml(win.data.stamps) +
      "</button>" +
      '<div class="nb-resize" data-resize hidden></div>';
    el.querySelector(".scrap-label-text").textContent =
      win.data.title || "untitled leaf";
    el.querySelector(".scrap-label-sub").textContent = sub;
    // fixed label size — position comes from layout x/y only
    el.style.width = "132px";
    el.style.height = "88px";
    wireScrap(win);
  }

  function paperSelectHtml(current) {
    const papers = (window.ReceiverLiveMd && ReceiverLiveMd.PAPERS) || [
      "lined",
      "dotted",
      "plain",
      "letter",
    ];
    return (
      '<select data-field="paper" class="rx-paper-paper" title="paper style">' +
      papers
        .map(
          (p) =>
            '<option value="' +
            p +
            '"' +
            (p === current ? " selected" : "") +
            ">" +
            p +
            "</option>"
        )
        .join("") +
      "</select>"
    );
  }

  /** Rubber-stamp marks on the paper face (frontmatter stamps[], not body text). */
  const PAPER_STAMPS = [
    { id: "outdated", label: "OUTDATED", ink: "rose" },
    { id: "needs-update", label: "NEEDS UPDATE", ink: "warn" },
    { id: "draft", label: "DRAFT", ink: "brass" },
    { id: "urgent", label: "URGENT", ink: "rose" },
    { id: "superseded", label: "SUPERSEDED", ink: "dim" },
    { id: "current", label: "CURRENT", ink: "ok" },
  ];

  function normalizeStamps(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw === "string") {
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) return j.map(String);
      } catch (_) {}
      return raw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  function stampMeta(id) {
    return (
      PAPER_STAMPS.find((s) => s.id === id) || {
        id: id,
        label: String(id).toUpperCase().replace(/-/g, " "),
        ink: "rose",
      }
    );
  }

  function paperStampsHtml(stamps) {
    const list = normalizeStamps(stamps);
    if (!list.length) return "";
    return (
      '<div class="rx-paper-stamps" aria-hidden="true">' +
      list
        .map((id, i) => {
          const m = stampMeta(id);
          const rot = -14 + (i % 3) * 7 + (i > 2 ? 4 : 0);
          return (
            '<span class="rx-ink-stamp ink-' +
            esc(m.ink) +
            '" style="--stamp-rot:' +
            rot +
            'deg" data-stamp="' +
            esc(m.id) +
            '">' +
            esc(m.label) +
            "</span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function closedStampBadgeHtml(stamps) {
    const list = normalizeStamps(stamps);
    if (!list.length) return "";
    const m = stampMeta(list[0]);
    const more = list.length > 1 ? " +" + (list.length - 1) : "";
    return (
      '<span class="scrap-stamp-badge ink-' +
      esc(m.ink) +
      '" title="' +
      esc(list.map((id) => stampMeta(id).label).join(" · ")) +
      '">' +
      esc(m.label.slice(0, 8)) +
      more +
      "</span>"
    );
  }

  function pageStampsForWin(win) {
    if (!win || !win.data) return [];
    if (win.kind === "notebook") {
      const pg = ensurePages(win.data)[win.pageIdx || 0];
      return normalizeStamps(pg && pg.stamps);
    }
    return normalizeStamps(win.data.stamps);
  }

  function applyPaperStamp(win, stampId) {
    if (!win || !win.data) return;
    let list = pageStampsForWin(win);
    if (stampId === "__clear__") {
      list = [];
    } else if (list.includes(stampId)) {
      list = list.filter((s) => s !== stampId); // toggle off
    } else {
      list = list.concat([stampId]);
    }
    if (win.kind === "notebook") {
      const pg = ensurePages(win.data)[win.pageIdx || 0];
      if (pg) pg.stamps = list;
    } else {
      win.data.stamps = list;
    }
    // refresh open face without killing terminal if open
    if (win.open) {
      const article = win.el.querySelector(".rx-paper");
      if (article) {
        let layer = article.querySelector(".rx-paper-stamps");
        if (layer) layer.remove();
        if (list.length) {
          article.insertAdjacentHTML("beforeend", paperStampsHtml(list));
        }
      }
    }
    const after = () => {
      const names = list.map((id) => stampMeta(id).label).join(" · ");
      toast(list.length ? "stamped · " + names : "stamps cleared");
    };
    if (win.kind === "notebook") {
      saveBook(win).then(after);
    } else {
      saveScrap(win, { quiet: true }).then(after);
    }
  }

  function showStampPicker(win, anchorEl) {
    hideStampPicker();
    const pop = document.createElement("div");
    pop.className = "rx-stamp-picker";
    pop.id = "rxStampPicker";
    const cur = pageStampsForWin(win);
    pop.innerHTML =
      '<div class="rx-stamp-picker-h">paper stamp</div>' +
      PAPER_STAMPS.map((s) => {
        const on = cur.includes(s.id);
        return (
          '<button type="button" class="rx-stamp-pick ink-' +
          esc(s.ink) +
          (on ? " is-on" : "") +
          '" data-stamp="' +
          esc(s.id) +
          '">' +
          esc(s.label) +
          (on ? " ✓" : "") +
          "</button>"
        );
      }).join("") +
      '<button type="button" class="rx-stamp-pick is-clear" data-stamp="__clear__">clear all</button>';
    felt.appendChild(pop);
    const ar =
      (anchorEl && anchorEl.getBoundingClientRect && anchorEl.getBoundingClientRect()) ||
      win.el.getBoundingClientRect();
    const fr = felt.getBoundingClientRect();
    let x = ar.left - fr.left;
    let y = ar.bottom - fr.top + 4;
    if (x + 160 > fr.width) x = fr.width - 168;
    if (y + 220 > fr.height) y = Math.max(8, ar.top - fr.top - 220);
    pop.style.left = Math.max(8, x) + "px";
    pop.style.top = Math.max(8, y) + "px";
    bringFront(pop);
    pop.querySelectorAll("[data-stamp]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        applyPaperStamp(win, btn.getAttribute("data-stamp"));
        hideStampPicker();
        // re-open picker state after save if still open paper
        if (win.open) {
          /* single toggle per click is enough */
        }
      };
    });
    setTimeout(() => {
      const closer = (ev) => {
        if (pop.contains(ev.target)) return;
        hideStampPicker();
        document.removeEventListener("pointerdown", closer, true);
      };
      document.addEventListener("pointerdown", closer, true);
    }, 0);
  }

  function hideStampPicker() {
    const p = document.getElementById("rxStampPicker");
    if (p) p.remove();
  }

  function renderScrapOpen(win, layoutSize) {
    closeMdTerminal(win, { force: true });
    win.open = true;
    const el = win.el;
    const leaf = win.data;
    const paper = leaf.paper || "plain";
    el.className = "nb-win is-open kind-leaf paper-sheet";
    el.innerHTML =
      '<article class="rx-paper rx-notecard-open" data-drag-chrome data-paper="' +
      esc(paper) +
      '">' +
      '<span class="rx-paper-tape" aria-hidden="true"></span>' +
      '<div class="rx-paper-inner rx-notecard-inner">' +
      '<div class="rx-paper-rail">' +
      '<input type="text" class="rx-paper-title rx-notecard-title" data-field="title" autocomplete="off" placeholder="untitled leaf" />' +
      '<span class="rx-paper-kind">loose leaf</span>' +
      "</div>" +
      '<div class="rx-paper-byline">' +
      '<span class="rx-paper-by">by</span>' +
      '<input type="text" class="rx-paper-author" data-field="author" autocomplete="off" placeholder="unknown" spellcheck="false" />' +
      "</div>" +
      '<div class="rx-paper-preview pn-page-body-md" data-paper-preview></div>' +
      '<div class="rx-paper-tools">' +
      paperSelectHtml(paper) +
      '<span data-meta class="rx-paper-meta"></span>' +
      '<button type="button" class="rx-paper-btn" data-act="edit">edit <span class="edit-caret">▌</span></button>' +
      '<button type="button" class="rx-paper-btn" data-act="check" title="check paper · full file on disk (^⇧I)">check</button>' +
      '<button type="button" class="rx-paper-btn" data-act="checkcfg" title="check config · pose + dressup for this host">cfg</button>' +
      '<button type="button" class="rx-paper-btn" data-act="red" title="red mark · edit a copy · send diff (^⇧R)">red</button>' +
      '<button type="button" class="rx-paper-btn" data-act="stamp" title="rubber-stamp the paper (outdated, draft…)">stamp</button>' +
      '<button type="button" class="rx-paper-btn" data-act="file" title="put away in a folder (off the felt)">file…</button>' +
      '<button type="button" class="rx-paper-btn" data-act="copypath" title="copy file path to clipboard">path</button>' +
      '<button type="button" class="rx-paper-btn danger" data-act="trash" title="delete this leaf forever">trash</button>' +
      '<button type="button" class="rx-paper-btn" data-act="close">fold</button>' +
      "</div></div>" +
      paperStampsHtml(leaf.stamps) +
      '<div class="nb-resize" data-resize></div></article>';
    const titleIn = el.querySelector("[data-field=title]");
    titleIn.value = leaf.title || "";
    const authorIn = el.querySelector("[data-field=author]");
    authorIn.value = normalizeAuthor(leaf.author);
    el.querySelector("[data-meta]").textContent =
      String(leaf.body || "").length + "c";
    titleIn.addEventListener("input", () => {
      win.data.title = titleIn.value;
    });
    authorIn.addEventListener("input", () => {
      win.data.author = normalizeAuthor(authorIn.value);
    });
    authorIn.addEventListener("change", () => {
      win.data.author = rememberAuthor(authorIn.value);
      authorIn.value = win.data.author;
    });
    const paperSel = el.querySelector("[data-field=paper]");
    paperSel.addEventListener("change", () => {
      win.data.paper = paperSel.value;
      el.querySelector(".rx-paper").dataset.paper = paperSel.value;
    });
    paintPaper(el, leaf.body);
    const ow =
      (layoutSize && layoutSize.openW) ||
      (layoutSize && layoutSize.w > 200 ? layoutSize.w : null) ||
      win._lastOpenW;
    const oh =
      (layoutSize && layoutSize.openH) ||
      (layoutSize && layoutSize.h > 160 ? layoutSize.h : null) ||
      win._lastOpenH;
    if (ow && oh) {
      el.style.width = ow + "px";
      el.style.height = oh + "px";
      win._lastOpenW = ow;
      win._lastOpenH = oh;
    } else {
      el.style.width = "360px";
      el.style.height = "460px";
      win._lastOpenW = 360;
      win._lastOpenH = 460;
    }
    wireScrap(win);
    if (!restoring) flushLayout();
  }

  function syncScrap(win) {
    if (!win.open) return win.data;
    const t = win.el.querySelector("[data-field=title]");
    const a = win.el.querySelector("[data-field=author]");
    const p = win.el.querySelector("[data-field=paper]");
    if (t) win.data.title = t.value;
    if (a) win.data.author = normalizeAuthor(a.value);
    if (p) win.data.paper = p.value;
    // body comes from terminal while open, else kept on win.data
    return win.data;
  }

  function openLeafTerminal(win) {
    if (win.termEl) {
      const ta = win.termEl.querySelector(".md-term-ta");
      if (ta) ta.focus();
      return;
    }
    openMdTerminal(win, {
      title: "md · " + (win.data.title || "leaf"),
      value: win.data.body || "",
      onChange: (v) => {
        win.data.body = v;
        const line =
          win.termEl && window.ReceiverLiveMd
            ? ReceiverLiveMd.caretLine(win.termEl.querySelector(".md-term-ta"))
            : undefined;
        paintPaper(win.el, v, line);
        const meta = win.el.querySelector("[data-meta]");
        if (meta) meta.textContent = v.length + "c";
      },
      onSave: () => saveScrap(win, { quiet: true }),
      onClose: () => setLeafEditUi(win, false),
    });
    syncPaperToTerm(win);
  }

  function leafLocationText(win) {
    if (!win || !win.data) return "";
    const d = win.data;
    if (d._path) return String(d._path);
    if (d._file) {
      // fallback if older server — best-effort under Receiver safe_box
      return "receiver/prod/safe_box/leaves/" + d._file;
    }
    if (d.id) return "leaf id: " + d.id;
    return "";
  }

  async function copyLeafPath(win) {
    // book page → path of that page's chip
    if (win && win.kind === "notebook") {
      const cid = chipIdForCheck(win);
      if (!cid) {
        toast("no page chip");
        return;
      }
      try {
        const j = await api("/api/leaf/" + encodeURIComponent(cid));
        if (j.ok && j.leaf && j.leaf._path) {
          const ok = await copyTextToClipboard(j.leaf._path);
          toast(ok ? "path copied" : "could not copy");
          return;
        }
      } catch (_) {}
      toast("no path · save book once");
      return;
    }
    // refresh path from server if missing (old session / pre-_path)
    if (win.data && win.data.id && !win.data._path) {
      try {
        const j = await api("/api/leaf/" + encodeURIComponent(win.data.id));
        if (j.ok && (j.leaf || j.scrap)) {
          const full = j.leaf || j.scrap;
          if (full._path) win.data._path = full._path;
          if (full._file) win.data._file = full._file;
        }
      } catch (_) {}
    }
    const text = leafLocationText(win);
    if (!text) {
      toast("no path on this leaf yet · save once");
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("path copied · " + (text.length > 48 ? "…" + text.slice(-48) : text));
    } catch (e) {
      toast("could not copy · " + (e.message || String(e)));
    }
  }

  /** Resolve chip id for raw check (loose leaf or current book page). */
  function chipIdForCheck(win) {
    if (!win) return null;
    if (win.kind === "leaf" && win.data && win.data.id) return win.data.id;
    if (win.kind === "notebook" && win.data) {
      const pages = ensurePages(win.data);
      const i =
        win.termPageIdx != null && win.termEl && win.termDirty
          ? win.termPageIdx
          : win.pageIdx || 0;
      const pg = pages[i];
      return pg && pg.id ? pg.id : null;
    }
    return null;
  }

  /**
   * Check target: chip · bin · config (pose+dressup for this host).
   * Config is how THIS surface wears the object — not chip matter, not bin membership.
   */
  function checkTargetFor(win, opts) {
    opts = opts || {};
    if (opts.config || opts.what === "config") {
      if (win.kind === "notebook" && win.data && win.data.id) {
        return { kind: "config", id: "book:" + win.data.id };
      }
      if (win.kind === "leaf" && win.data && win.data.id) {
        return { kind: "config", id: "leaf:" + win.data.id };
      }
      if (win.kind === "folder" && win.data && win.data.id) {
        return { kind: "config", id: "folder:" + win.data.id };
      }
      if (win.kind === "corkboard" && win.data && win.data.id) {
        return { kind: "config", id: "cork:" + win.data.id };
      }
      return null;
    }
    if (opts.bin || opts.what === "bin") {
      if (win.kind === "notebook" && win.data && win.data.id) {
        return { kind: "bin", binKind: "book", id: win.data.id };
      }
      if (win.kind === "folder" && win.data && win.data.id) {
        return { kind: "bin", binKind: "folder", id: win.data.id };
      }
      if (win.kind === "corkboard" && win.data && win.data.id) {
        return { kind: "bin", binKind: "board", id: win.data.id };
      }
      return null;
    }
    const cid = chipIdForCheck(win);
    if (cid) return { kind: "chip", id: cid };
    return null;
  }

  /** Line LCS → unified diff (small files; paper-sized). */
  function unifiedDiff(pathLabel, oldText, newText) {
    const a = String(oldText || "").split("\n");
    const b = String(newText || "").split("\n");
    const n = a.length;
    const m = b.length;
    // dp LCS lengths
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = []; // {t:'='|'+'|'-', line}
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ t: "=", line: a[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ t: "-", line: a[i] });
        i++;
      } else {
        ops.push({ t: "+", line: b[j] });
        j++;
      }
    }
    while (i < n) {
      ops.push({ t: "-", line: a[i++] });
    }
    while (j < m) {
      ops.push({ t: "+", line: b[j++] });
    }
    const name = pathLabel || "paper";
    const out = [
      "--- a/" + name,
      "+++ b/" + name,
      "@@ red mark @@",
    ];
    let any = false;
    for (const op of ops) {
      if (op.t === "=") {
        out.push(" " + op.line);
      } else if (op.t === "-") {
        out.push("-" + op.line);
        any = true;
      } else {
        out.push("+" + op.line);
        any = true;
      }
    }
    if (!any) {
      return (
        "--- a/" +
        name +
        "\n+++ b/" +
        name +
        "\n@@ no changes @@\n· red mark matches disk\n"
      );
    }
    return out.join("\n") + (out[out.length - 1].endsWith("\n") ? "" : "\n");
  }

  async function copyTextToClipboard(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Check paper — plain-text notepad of the full on-disk chip.
   * Red mark mode: edit a copy in red, then diff / send without touching the chip.
   */
  async function openPaperCheck(win, opts) {
    opts = opts || {};
    const startRed = !!opts.red;
    const wantBin = !!opts.bin;
    const wantCfg = !!opts.config;
    const target = checkTargetFor(win, {
      bin: wantBin,
      config: wantCfg,
    });
    if (!target) {
      toast(
        wantCfg
          ? "nothing to check · open a placed object"
          : wantBin
            ? "nothing to check · open a book / folder / board"
            : "nothing to check · open a leaf or book page"
      );
      return;
    }
    // save body first if dirty terminal so disk matches what you wrote
    if (!wantBin && win.termEl && win.termDirty && win.kind === "leaf") {
      const ta = win.termEl.querySelector(".md-term-ta");
      if (ta) win.data.body = ta.value;
      await saveScrap(win, { quiet: true });
    }
    if (!wantBin && win.termEl && win.termDirty && win.kind === "notebook") {
      await saveBook(win);
    }
    if (wantBin && win.kind === "notebook") {
      await saveBook(win);
    }
    let j;
    if (target.kind === "bin") {
      j = await api(
        "/api/bin/" +
          encodeURIComponent(target.binKind) +
          "/" +
          encodeURIComponent(target.id) +
          "/raw"
      );
    } else if (target.kind === "config") {
      j = await api(
        "/api/config/" + encodeURIComponent(target.id) + "/raw"
      );
    } else {
      j = await api("/api/leaf/" + encodeURIComponent(target.id) + "/raw");
    }
    if (!j.ok) {
      toast(j.error || "could not read file");
      return;
    }
    const cid = target.id;
    const isBin = target.kind === "bin";
    const isCfg = target.kind === "config";
    // one pad per target — chip + bin + config can all stay open
    const padKey =
      "rxCheck-" +
      (isCfg
        ? "cfg-"
        : isBin
          ? "bin-" + (target.binKind || "bin") + "-"
          : "chip-") +
      String(cid).replace(/[^\w.-]+/g, "_");
    const existingPad = document.getElementById(padKey);
    if (existingPad) existingPad.remove();

    const baseline = j.text != null ? String(j.text) : "";
    const pathLabel =
      j.file ||
      (isCfg
        ? cid.replace(":", "__") + ".cfg"
        : isBin
          ? cid + ".bin"
          : cid + ".chip");
    const absPath = j.path || pathLabel;

    const pad = document.createElement("div");
    pad.className =
      "rx-paper-check" +
      (startRed ? " is-red" : "") +
      (isBin ? " is-bin" : "") +
      (isCfg ? " is-cfg" : "");
    pad.id = padKey;
    pad.dataset.checkKey = padKey;
    const checkLabel = isCfg
      ? "check config"
      : isBin
        ? "check bin"
        : "check paper";
    const checkHint = isCfg
      ? "config · pose + dressup for this host · not chip/bin matter"
      : isBin
        ? "bin paper · membership only · not dressup"
        : "read only · full chip · not the edit hatch";
    pad.innerHTML =
      '<div class="rx-paper-check-bar" data-check-drag>' +
      '<span class="rx-paper-check-mark" aria-hidden="true">' +
      (isCfg ? "◈" : isBin ? "▤" : "▣") +
      "</span>" +
      '<span class="rx-paper-check-title" data-check-title>' +
      checkLabel +
      "</span>" +
      '<button type="button" class="rx-paper-check-btn" data-check-red title="red mark — edit a copy, then diff">red</button>' +
      '<button type="button" class="rx-paper-check-btn" data-check-diff title="unified diff vs disk" hidden>diff</button>' +
      '<button type="button" class="rx-paper-check-btn" data-check-send title="copy diff + spawn redline chip" hidden>send</button>' +
      '<button type="button" class="rx-paper-check-btn" data-check-copy title="copy path">path</button>' +
      '<button type="button" class="rx-paper-check-x" data-check-close title="close">×</button>' +
      "</div>" +
      '<div class="rx-paper-check-path" data-check-path title="absolute path on disk"></div>' +
      '<pre class="rx-paper-check-body" data-check-body spellcheck="false"></pre>' +
      '<textarea class="rx-paper-check-edit" data-check-edit spellcheck="false" hidden></textarea>' +
      '<pre class="rx-paper-check-diffview" data-check-diffview hidden></pre>' +
      '<div class="rx-paper-check-foot">' +
      '<span data-check-meta></span>' +
      '<span class="rx-paper-check-hint" data-check-hint>' +
      checkHint +
      "</span>" +
      "</div>" +
      '<div class="rx-paper-check-resize" data-check-resize></div>';
    felt.appendChild(pad);

    const pathEl = pad.querySelector("[data-check-path]");
    const bodyEl = pad.querySelector("[data-check-body]");
    const editEl = pad.querySelector("[data-check-edit]");
    const diffEl = pad.querySelector("[data-check-diffview]");
    const metaEl = pad.querySelector("[data-check-meta]");
    const titleEl = pad.querySelector("[data-check-title]");
    const hintEl = pad.querySelector("[data-check-hint]");
    const btnRed = pad.querySelector("[data-check-red]");
    const btnDiff = pad.querySelector("[data-check-diff]");
    const btnSend = pad.querySelector("[data-check-send]");

    pathEl.textContent = absPath;
    bodyEl.textContent = baseline;
    editEl.value = baseline;
    metaEl.textContent =
      (j.file || "") +
      " · " +
      (j.chars != null ? j.chars : baseline.length) +
      "c · " +
      cid;

    let mode = "check"; // check | red | diff

    function setMode(next) {
      mode = next;
      pad.classList.toggle("is-red", mode === "red");
      pad.classList.toggle("is-diff", mode === "diff");
      bodyEl.hidden = mode !== "check";
      editEl.hidden = mode !== "red";
      diffEl.hidden = mode !== "diff";
      btnDiff.hidden = mode === "check";
      btnSend.hidden = mode === "check";
      if (mode === "check") {
        titleEl.textContent = checkLabel;
        hintEl.textContent = checkHint;
        btnRed.textContent = "red";
      } else if (mode === "red") {
        titleEl.textContent = "red mark";
        hintEl.textContent =
          "red pen · edits are a copy · disk untouched until you apply elsewhere";
        btnRed.textContent = "check";
        editEl.focus();
      } else {
        titleEl.textContent = "diff";
        hintEl.textContent =
          "unified diff · − disk · + red mark · send = chip + clipboard";
        btnRed.textContent = "red";
      }
    }

    function currentDiff() {
      const marked = mode === "red" || mode === "diff" ? editEl.value : baseline;
      return unifiedDiff(pathLabel, baseline, marked);
    }

    function showDiff() {
      const d = currentDiff();
      diffEl.textContent = d;
      setMode("diff");
      metaEl.textContent =
        pathLabel +
        " · diff " +
        d.length +
        "c · " +
        (d.indexOf("no changes") >= 0 ? "clean" : "dirty");
    }

    // place near the object; nudge if other check pads already open
    const fr = felt.getBoundingClientRect();
    const wr = win.el ? win.el.getBoundingClientRect() : null;
    const w = 360;
    const h = 440;
    const nOpen = felt.querySelectorAll(".rx-paper-check").length;
    let x = wr ? wr.right - fr.left + 10 : 48;
    let y = wr ? wr.top - fr.top : 48;
    x += nOpen * 22;
    y += nOpen * 18;
    if (x + w > fr.width - 8) x = Math.max(8, (wr ? wr.left - fr.left : 48) - w - 10);
    if (y + h > fr.height - 8) y = Math.max(8, fr.height - h - 12);
    pad.style.left = x + "px";
    pad.style.top = y + "px";
    pad.style.width = w + "px";
    pad.style.height = h + "px";
    bringFront(pad);

    pad.querySelector("[data-check-close]").onclick = (ev) => {
      ev.stopPropagation();
      pad.remove();
    };
    pad.querySelector("[data-check-copy]").onclick = async (ev) => {
      ev.stopPropagation();
      const ok = await copyTextToClipboard(absPath);
      toast(ok ? "path copied" : "could not copy");
    };
    btnRed.onclick = (ev) => {
      ev.stopPropagation();
      if (mode === "red") {
        // back to read-only view of baseline (keep edit buffer)
        bodyEl.textContent = baseline;
        setMode("check");
      } else {
        if (mode === "diff") {
          /* keep editEl */
        } else {
          editEl.value = baseline;
        }
        setMode("red");
      }
    };
    btnDiff.onclick = (ev) => {
      ev.stopPropagation();
      showDiff();
      toast("diff vs disk");
    };
    btnSend.onclick = async (ev) => {
      ev.stopPropagation();
      const d = currentDiff();
      if (d.indexOf("no changes") >= 0) {
        toast("no changes · nothing to send");
        return;
      }
      const ok = await copyTextToClipboard(d);
      const jr = await api("/api/leaf/redline", {
        method: "POST",
        body: JSON.stringify({
          target_id: isBin ? "bin:" + (target.binKind || "bin") + ":" + cid : cid,
          diff: d,
          title:
            "redline · " +
            (isBin ? "bin " : "") +
            (pathLabel || cid),
          author: getLastAuthor() || "red-pen",
        }),
      });
      if (!jr.ok) {
        toast(jr.error || "could not spawn redline chip");
        return;
      }
      if (jr.leaf) {
        mountLeaf(jr.leaf); // closed notecard · urgent stamp on chip
        flushLayout({ immediate: true });
      }
      showDiff();
      toast(
        ok
          ? "diff copied · redline chip on felt · ping the agent"
          : "redline chip on felt · copy failed"
      );
    };

    editEl.addEventListener("input", () => {
      metaEl.textContent =
        pathLabel + " · red " + editEl.value.length + "c · " + cid;
    });

    // drag
    const bar = pad.querySelector("[data-check-drag]");
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest("button")) return;
      bringFront(pad);
      const r = pad.getBoundingClientRect();
      const fr2 = felt.getBoundingClientRect();
      const ox = ev.clientX - r.left;
      const oy = ev.clientY - r.top;
      function move(e) {
        let nx = e.clientX - fr2.left - ox;
        let ny = e.clientY - fr2.top - oy;
        nx = Math.max(0, Math.min(nx, fr2.width - 80));
        ny = Math.max(0, Math.min(ny, fr2.height - 40));
        pad.style.left = nx + "px";
        pad.style.top = ny + "px";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ev.preventDefault();
    });
    const rz = pad.querySelector("[data-check-resize]");
    rz.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      bringFront(pad);
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startW = pad.offsetWidth;
      const startH = pad.offsetHeight;
      function move(e) {
        pad.style.width = Math.max(220, startW + (e.clientX - startX)) + "px";
        pad.style.height = Math.max(180, startH + (e.clientY - startY)) + "px";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ev.preventDefault();
      ev.stopPropagation();
    });
    pad.addEventListener("mousedown", () => bringFront(pad));

    if (startRed) setMode("red");
    else setMode("check");
    toast(
      startRed
        ? "red mark · pen on a copy"
        : isCfg
          ? "check config · pose + dressup"
          : isBin
            ? "check bin · membership"
            : "check paper · full chip"
    );
  }

  function hidePaperCheck() {
    // close all check pads (escape / rare full reset)
    felt.querySelectorAll(".rx-paper-check").forEach((p) => p.remove());
  }

  async function openRedMark(win) {
    return openPaperCheck(win, { red: true });
  }

  async function openBinCheck(win) {
    return openPaperCheck(win, { bin: true });
  }

  async function openBinRedMark(win) {
    return openPaperCheck(win, { bin: true, red: true });
  }

  async function openConfigCheck(win) {
    return openPaperCheck(win, { config: true });
  }

  /** Bottom rail on a sheet inside a book — same verbs as loose leaf + pop/out. */
  function bookPageToolsHtml(pagePaper) {
    return (
      '<div class="rx-paper-tools rx-paper-tools-inbook">' +
      paperSelectHtml(pagePaper) +
      '<span data-meta class="rx-paper-meta"></span>' +
      '<button type="button" class="rx-paper-btn" data-act="edit" title="edit markdown">edit <span class="edit-caret">▌</span></button>' +
      '<button type="button" class="rx-paper-btn" data-act="check" title="check paper · full chip on disk">check</button>' +
      '<button type="button" class="rx-paper-btn" data-act="red" title="red mark this chip">red</button>' +
      '<button type="button" class="rx-paper-btn" data-act="stamp" title="stamp this chip">stamp</button>' +
      '<button type="button" class="rx-paper-btn" data-act="copypath" title="copy chip path">path</button>' +
      '<button type="button" class="rx-paper-btn" data-act="popout" title="pop page out beside the book">pop</button>' +
      '<button type="button" class="rx-paper-btn" data-act="takeout" title="take page out of book onto felt">out</button>' +
      "</div>"
    );
  }

  async function saveScrap(win, opts) {
    opts = opts || {};
    syncScrap(win);
    const author = rememberAuthor(win.data.author);
    win.data.author = author;
    const payload = {
      id: win.data.id,
      title: win.data.title || "untitled leaf",
      author: author,
      cloth: win.data.cloth || "oxblood",
      paper: win.data.paper || "plain",
      folder: win.data.folder || "",
      boards: win.data.boards || [],
      stamps: normalizeStamps(win.data.stamps),
      body: win.data.body != null ? String(win.data.body) : "",
      created: win.data.created,
    };
    const j = await api("/api/leaf/save", {
      method: "POST",
      body: JSON.stringify({ leaf: payload }),
    });
    if (!j.ok) {
      toast(j.error || "save fail");
      return false;
    }
    win.data = j.leaf || j.scrap;
    if (win.open) {
      const meta = win.el.querySelector("[data-meta]");
      if (meta) meta.textContent = (j.chars || 0) + "c on disk";
      const aIn = win.el.querySelector("[data-field=author]");
      if (aIn) aIn.value = normalizeAuthor(win.data.author);
      paintPaper(win.el, win.data.body);
    } else {
      const t = win.el.querySelector(".scrap-label-text");
      if (t) t.textContent = win.data.title || "leaf";
      const sub = win.el.querySelector(".scrap-label-sub");
      if (sub) {
        const au = normalizeAuthor(win.data.author);
        sub.textContent = au !== "unknown" ? "by " + au : "loose leaf";
        sub.classList.toggle("is-author", au !== "unknown");
      }
    }
    if (!opts.quiet) toast("leaf saved · " + (j.chars || 0) + " chars");
    flushLayout();
    return true;
  }

  function wireScrap(win) {
    const el = win.el;
    el.onmousedown = () => bringFront(el);
    const face = el.querySelector("[data-drag-face]");
    if (face) {
      let moved = false;
      face.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        moved = false;
        startDrag(win, ev, () => {
          moved = true;
        });
      });
      face.addEventListener("click", (ev) => {
        if (moved) return;
        ev.preventDefault();
        const key = layoutKeyForWin(win);
        const L = key ? loadLayout()[key] : null;
        renderScrapOpen(win, {
          openW: win._lastOpenW || (L && L.openW),
          openH: win._lastOpenH || (L && L.openH),
        });
      });
    }
    const chrome = el.querySelector("[data-drag-chrome]");
    if (chrome) {
      chrome.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button, input, textarea, select, .live-source"))
          return;
        startDrag(win, ev);
      });
    }
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const a = btn.getAttribute("data-act");
        if (a === "edit") openLeafTerminal(win);
        if (a === "check") {
          await openPaperCheck(win);
          return;
        }
        if (a === "checkcfg") {
          await openConfigCheck(win);
          return;
        }
        if (a === "red") {
          await openRedMark(win);
          return;
        }
        if (a === "stamp") {
          showStampPicker(win, btn);
          return;
        }
        if (a === "copypath") {
          await copyLeafPath(win);
          return;
        }
        if (a === "file") {
          await fileLeafAway(win);
          return;
        }
        if (a === "trash") {
          await trashLeaf(win);
          return;
        }
        if (a === "close") {
          // fold paper — prompt if terminal dirty
          if (win.termEl && win.termDirty) {
            const leave = window.confirm(
              "Terminal has unsaved markdown.\n\nOK = fold without saving\nCancel = keep editing"
            );
            if (!leave) return;
            // discard: revert body to last saved baseline
            if (win.termBaseline != null) win.data.body = win.termBaseline;
          }
          // capture open paper size BEFORE folding to notecard
          if (win.open) {
            win._lastOpenW = win.el.offsetWidth;
            win._lastOpenH = win.el.offsetHeight;
          }
          closeMdTerminal(win, { force: true });
          await saveScrap(win, { quiet: true }); // title / paper / body as settled
          flushLayout({ immediate: true }); // openW/H while still open=true
          win.open = false;
          // write open size explicitly (open flag false but keep openW/H)
          {
            const key = layoutKeyForWin(win);
            if (key) {
              const layout = loadLayout();
              const cur = layout[key] || {};
              const xy = readWinXY(win, cur);
              cur.openW = win._lastOpenW || cur.openW;
              cur.openH = win._lastOpenH || cur.openH;
              cur.open = false;
              if (xy.x != null) cur.x = xy.x;
              if (xy.y != null) cur.y = xy.y;
              layout[key] = cur;
              layoutCache = layout;
              mirrorLayoutLocal();
            }
          }
          renderScrapClosed(win);
          flushLayout({ immediate: true });
        }
      };
    });
    const rz = el.querySelector("[data-resize]");
    if (rz && win.open) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) startResize(win, ev, 280, 300);
      });
    }
    // Ctrl+E edit · Ctrl+S seal (save + fold) when not in terminal
    if (!win._leafKeys) {
      win._leafKeys = true;
      el.addEventListener("keydown", (ev) => {
        if (!win.open || win.kind !== "leaf") return;
        if (ev.target && ev.target.classList && ev.target.classList.contains("md-term-ta"))
          return;
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "e" || ev.key === "E")) {
          ev.preventDefault();
          openLeafTerminal(win);
        }
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
          ev.preventDefault();
          sealLeaf(win);
        }
      });
    }
  }

  let filePendingWin = null;

  function hideFileModal() {
    filePendingWin = null;
    if ($("fileModal")) $("fileModal").hidden = true;
  }

  async function commitFileToFolder(win, fid) {
    if (!win || !win.data || !fid) return;
    const j = await api("/api/folder/file", {
      method: "POST",
      body: JSON.stringify({ folder_id: fid, leaf_id: win.data.id }),
    });
    if (!j.ok) {
      toast(j.error || "file fail");
      return;
    }
    const key = layoutKeyForWin(win);
    if (key) unmountWin(key);
    const fk = "folder:" + fid;
    let fw = wins.get(fk);
    if (!fw && j.folder) fw = mountFolder(j.folder);
    if (fw) {
      fw.data = j.folder || fw.data;
      if (fw.open) await renderFolderOpen(fw);
      else renderFolderClosed(fw);
    }
    flushLayout({ prune: true, immediate: true });
    hideFileModal();
    toast("filed away · off the felt");
  }

  async function showFileModal(win) {
    filePendingWin = win;
    const modal = $("fileModal");
    if (!modal) {
      toast("file modal missing · refresh");
      return;
    }
    $("fileModalLeaf").textContent =
      "“" + (win.data.title || "untitled") + "”";
    const list = $("fileModalList");
    list.innerHTML = "";
    const folders = await listFolderOptions();
    if (!folders.length) {
      list.innerHTML =
        '<p class="file-modal-empty">no folders yet · name one below</p>';
    } else {
      folders.forEach((f) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "file-folder-pick";
        b.innerHTML =
          '<span class="file-folder-pick-ico" aria-hidden="true">📁</span>' +
          '<span class="file-folder-pick-t">' +
          esc(f.title || f.id) +
          "</span>" +
          '<span class="file-folder-pick-n">' +
          (f.sheets || 0) +
          " sheets</span>";
        b.onclick = () => commitFileToFolder(win, f.id);
        list.appendChild(b);
      });
    }
    if ($("fileModalNew")) $("fileModalNew").value = "";
    modal.hidden = false;
    if ($("fileModalNew")) $("fileModalNew").focus();
  }

  async function fileLeafAway(win) {
    if (!win || win.kind !== "leaf" || !win.data || !win.data.id) return;
    await saveScrap(win, { quiet: true });
    // open folder wins; else open book → into book bin; else folder modal
    let openFolder = null;
    let openBook = null;
    wins.forEach((w) => {
      if (w.kind === "folder" && w.open) openFolder = w;
      if (w.kind === "notebook" && w.open) openBook = w;
    });
    if (openFolder && openFolder.data && openFolder.data.id) {
      await commitFileToFolder(win, openFolder.data.id);
      return;
    }
    if (openBook && openBook.data && openBook.data.id) {
      const j = await api("/api/book/file", {
        method: "POST",
        body: JSON.stringify({
          book_id: openBook.data.id,
          leaf_id: win.data.id,
        }),
      });
      if (!j.ok) {
        toast(j.error || "could not file into book");
        return;
      }
      if (j.book) openBook.data = j.book;
      const key = layoutKeyForWin(win);
      if (key) unmountWin(key);
      flushLayout({ prune: true, immediate: true });
      renderBookOpen(openBook);
      toast("filed into book · chip in bin");
      return;
    }
    await showFileModal(win);
  }

  async function trashLeaf(win) {
    if (!win || !win.data || !win.data.id) return;
    const ok = window.confirm(
      "Delete this leaf forever?\n\n" +
        (win.data.title || "untitled") +
        "\n\nThis cannot be undone."
    );
    if (!ok) return;
    const j = await api("/api/leaf/delete", {
      method: "POST",
      body: JSON.stringify({ id: win.data.id }),
    });
    if (!j.ok) {
      toast(j.error || "delete fail");
      return;
    }
    const key = layoutKeyForWin(win);
    if (key) unmountWin(key);
    flushLayout({ prune: true, immediate: true });
    toast("leaf deleted");
  }

  function mountLeaf(leaf, pos) {
    if (leaf && leaf.folder) {
      // shelved — not on felt
      return null;
    }
    const key = "leaf:" + leaf.id;
    if (wins.has(key)) return wins.get(key);
    const el = document.createElement("div");
    const fallback = pos || placeOffset();
    el.style.left = fallback.x + "px";
    el.style.top = fallback.y + "px";
    felt.appendChild(el);
    const win = {
      kind: "leaf",
      el,
      data: { ...leaf, body: leaf.body != null ? leaf.body : "" },
      open: false,
    };
    wins.set(key, win);
    bringFront(el);
    const L = applyLayout(win, key);
    if (L && (L.openW || L.openH)) {
      win._lastOpenW = L.openW;
      win._lastOpenH = L.openH;
    }
    if (L && L.open) {
      renderScrapOpen(win, {
        w: L.w,
        h: L.h,
        openW: L.openW || L.w,
        openH: L.openH || L.h,
      });
    } else {
      renderScrapClosed(win);
      if (L) applyLayout(win, key);
    }
    return win;
  }
  const mountScrap = mountLeaf;

  // ═══════════════════════════════════════════════════════
  // NOTEBOOKS (real multi-page)
  // ═══════════════════════════════════════════════════════
  function ensurePages(book) {
    if (!book.pages || !book.pages.length) {
      book.pages = [
        {
          id: "pg-" + Date.now(),
          position: 1,
          title: "page one",
          body: "",
          mark: "",
        },
      ];
    }
    return book.pages;
  }

  function syncNotebookPage(win) {
    if (!win.open) return;
    const pages = ensurePages(win.data);
    const i = win.pageIdx || 0;
    if (!pages[i]) return;
    const titleEl = win.el.querySelector("[data-field=pageTitle]");
    const bookTitle = win.el.querySelector("[data-field=bookTitle]");
    const paperEl = win.el.querySelector("[data-field=paper]");
    if (bookTitle) win.data.title = bookTitle.value;
    if (titleEl) pages[i].title = titleEl.value;
    if (paperEl) pages[i].paper = paperEl.value;
    // body from terminal while editing; otherwise pages[i].body already set
  }

  function openBookTerminal(win) {
    const pages = ensurePages(win.data);
    const i = win.pageIdx || 0;
    // Already editing this page — just focus; don't force-reopen (that wiped dirty).
    if (win.termEl && win.termDirty) {
      const editI =
        win.termPageIdx != null ? win.termPageIdx : win.pageIdx || 0;
      if (editI === i) {
        bringFront(win.termEl);
        const ta = win.termEl.querySelector(".md-term-ta");
        if (ta) ta.focus();
        return;
      }
      const keep = !window.confirm(
        "Terminal has unsaved markdown on page " +
          (editI + 1) +
          ".\n\nOK = discard that and edit this page\nCancel = keep the open editor"
      );
      if (keep) {
        bringFront(win.termEl);
        const ta = win.termEl.querySelector(".md-term-ta");
        if (ta) ta.focus();
        toast("still editing p" + (editI + 1));
        return;
      }
    } else if (win.termEl && !win.termDirty && (win.termPageIdx || 0) === i) {
      bringFront(win.termEl);
      const ta = win.termEl.querySelector(".md-term-ta");
      if (ta) ta.focus();
      return;
    }
    const pg = pages[i] || { body: "", title: "" };
    // Lock body writes to the page we opened — TOC can move the *view* without stealing text
    win.termPageIdx = i;
    openMdTerminal(win, {
      title: "md · p" + (i + 1) + " · " + (pg.title || win.data.title || "page"),
      value: pg.body || "",
      onChange: (v) => {
        const editI =
          win.termPageIdx != null ? win.termPageIdx : win.pageIdx || 0;
        const pgs = ensurePages(win.data);
        if (pgs[editI]) pgs[editI].body = v;
        // live paper peek only when viewing the page you're editing
        if ((win.pageIdx || 0) === editI) paintPaper(win.el, v);
        refreshBookPopouts(win);
      },
      onSave: () => saveBook(win).then(() => refreshBookPopouts(win)),
    });
  }

  /**
   * Change notebook page. Never silently kills a dirty terminal.
   * Dirty + navigate → keep editor on the edit page, only switch paper/TOC view.
   */
  function goBookPage(win, newIdx) {
    if (!win || win.kind !== "notebook") return;
    syncNotebookPage(win);
    const pages = ensurePages(win.data);
    if (!pages.length) return;
    let i = parseInt(newIdx, 10);
    if (!Number.isFinite(i)) i = 0;
    if (i < 0) i = 0;
    if (i >= pages.length) i = pages.length - 1;

    if (win.termEl && win.termDirty) {
      const editI =
        win.termPageIdx != null ? win.termPageIdx : win.pageIdx || 0;
      // flush textarea → page body (don't trust last input event alone)
      const ta = win.termEl.querySelector(".md-term-ta");
      if (ta && pages[editI]) pages[editI].body = ta.value;
      if (i === (win.pageIdx || 0)) {
        toast("still editing p" + (editI + 1) + " · unsaved · ^S save");
        return;
      }
      win.pageIdx = i;
      renderBookOpen(win, { keepTerm: true });
      setLeafEditUi(win, true);
      toast(
        "viewing p" +
          (i + 1) +
          " · editor still on p" +
          (editI + 1) +
          " (unsaved) · ^S or TOC back"
      );
      return;
    }

    if (win.termEl) {
      closeMdTerminal(win, { force: true });
    }
    win.pageIdx = i;
    renderBookOpen(win);
  }

  function closeBookPopouts(win) {
    if (!win || !win.popouts || !win.popouts.length) {
      if (win) win.popouts = [];
      return;
    }
    win.popouts.forEach((p) => {
      if (p.el && p.el.parentNode) p.el.remove();
    });
    win.popouts = [];
  }

  /** Peek a page beside the book so you can write another page while reading this one. */
  function popOutPage(win, pageIdx) {
    if (!win || win.kind !== "notebook") return;
    syncNotebookPage(win);
    const pages = ensurePages(win.data);
    let i = pageIdx != null ? pageIdx : win.pageIdx || 0;
    if (i < 0) i = 0;
    if (i >= pages.length) i = pages.length - 1;
    const pg = pages[i];
    if (!pg) return;
    if (!win.popouts) win.popouts = [];
    const existing = win.popouts.find((p) => p.pageIdx === i);
    if (existing && existing.el) {
      bringFront(existing.el);
      toast("page " + (i + 1) + " already popped · brought forward");
      return;
    }
    const bookRect = win.el.getBoundingClientRect();
    const feltRect = felt.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "nb-win is-open kind-page-pop";
    const ox = Math.min(
      feltRect.width - 300,
      Math.max(8, bookRect.right - feltRect.left + 12 + win.popouts.length * 18)
    );
    const oy = Math.max(8, bookRect.top - feltRect.top + 24 + win.popouts.length * 14);
    el.style.left = ox + "px";
    el.style.top = oy + "px";
    el.style.width = "300px";
    el.style.height = "380px";
    el.style.zIndex = String((zTop += 1));
    const paper = pg.paper || "plain";
    const title =
      (pg.title || "").trim() ||
      "page " + (i + 1);
    el.innerHTML =
      '<article class="rx-paper rx-page-pop-paper" data-drag-chrome data-paper="' +
      esc(paper) +
      '">' +
      '<div class="rx-paper-inner">' +
      '<div class="rx-paper-rail page-pop-rail">' +
      '<span class="page-pop-label">peek · p' +
      (i + 1) +
      "</span>" +
      '<span class="page-pop-title"></span>' +
      '<button type="button" class="rx-paper-btn" data-pop-close title="close peek">×</button>' +
      "</div>" +
      '<div class="rx-paper-preview pn-page-body-md" data-paper-preview></div>' +
      '<div class="rx-paper-tools">' +
      '<span class="rx-paper-meta page-pop-meta"></span>' +
      '<span class="page-pop-hint">read only · fold book to dismiss all peeks</span>' +
      "</div></div>" +
      '<div class="nb-resize" data-resize></div></article>';
    el.querySelector(".page-pop-title").textContent = title;
    el.querySelector(".page-pop-meta").textContent =
      (win.data.title || "notebook") + " · " + String(pg.body || "").length + "c";
    paintPaper(el, pg.body || "");
    felt.appendChild(el);

    const pop = { el, pageIdx: i };
    win.popouts.push(pop);

    // drag + resize (reuse helpers via fake win)
    const fake = { el, open: true, kind: "page-pop", data: { id: "pop" } };
    el.onmousedown = () => bringFront(el);
    const chrome = el.querySelector("[data-drag-chrome]");
    if (chrome) {
      chrome.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button")) return;
        startDrag(fake, ev);
      });
    }
    const rz = el.querySelector("[data-resize]");
    if (rz) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) startResize(fake, ev, 220, 200);
      });
    }
    el.querySelector("[data-pop-close]").onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (pop.el && pop.el.parentNode) pop.el.remove();
      win.popouts = (win.popouts || []).filter((p) => p !== pop);
    };
    toast("page " + (i + 1) + " popped · write in the book beside it");
  }

  /** Refresh all peeks from current book page bodies (after save / edit). */
  function refreshBookPopouts(win) {
    if (!win || !win.popouts) return;
    const pages = ensurePages(win.data);
    win.popouts.forEach((p) => {
      if (!p.el) return;
      const pg = pages[p.pageIdx];
      if (!pg) return;
      const title =
        (pg.title || "").trim() || "page " + (p.pageIdx + 1);
      const tEl = p.el.querySelector(".page-pop-title");
      if (tEl) tEl.textContent = title;
      const lab = p.el.querySelector(".page-pop-label");
      if (lab) lab.textContent = "peek · p" + (p.pageIdx + 1);
      const mEl = p.el.querySelector(".page-pop-meta");
      if (mEl)
        mEl.textContent =
          (win.data.title || "notebook") +
          " · " +
          String(pg.body || "").length +
          "c";
      paintPaper(p.el, pg.body || "");
    });
  }

  function renderBookClosed(win) {
    closeBookPopouts(win);
    closeMdTerminal(win, { force: true });
    win.open = false;
    const el = win.el;
    const book = win.data;
    const cloth = book.cloth || "oxblood";
    const n = ensurePages(book).length;
    el.className = "nb-win is-closed kind-book";
    el.innerHTML =
      '<button type="button" class="book-face cloth-' +
      cloth +
      '" data-drag-face>' +
      '<div class="book-face-spine"></div>' +
      '<div class="book-face-pages"></div>' +
      '<div class="book-face-plate"><span class="book-face-title"></span>' +
      '<span class="book-face-by"></span>' +
      '<span class="book-face-count"></span></div></button>' +
      '<div class="nb-resize" data-resize hidden></div>';
    el.querySelector(".book-face-title").textContent = book.title || "untitled";
    const au = normalizeAuthor(book.author);
    const byEl = el.querySelector(".book-face-by");
    if (au && au !== "unknown") {
      byEl.textContent = "by " + au;
      byEl.hidden = false;
    } else {
      byEl.textContent = "";
      byEl.hidden = true;
    }
    el.querySelector(".book-face-count").textContent =
      n + " leaf" + (n === 1 ? "" : "s");
    el.style.width = "120px";
    el.style.height = "162px";
    wireBook(win);
  }

  function renderBookOpen(win, opts) {
    opts = opts || {};
    win.open = true;
    const el = win.el;
    const book = win.data;
    const pages = ensurePages(book);
    if (win.pageIdx == null) win.pageIdx = 0;
    if (win.pageIdx < 0) win.pageIdx = 0;
    if (win.pageIdx >= pages.length) win.pageIdx = pages.length - 1;
    const i = win.pageIdx;
    const pg = pages[i];
    const cloth = book.cloth || "oxblood";
    const n = pages.length;

    const toc = pages
      .map((p, idx) => {
        const t = (p.title || "").trim() || "untitled";
        const editHere =
          win.termEl &&
          win.termDirty &&
          (win.termPageIdx != null ? win.termPageIdx : -1) === idx;
        return (
          '<div class="j-toc-item' +
          (idx === i ? " is-on" : "") +
          (editHere ? " is-term-edit" : "") +
          '" data-page="' +
          idx +
          '" role="button" tabindex="0" title="click open · drag to reorder · double-click pop out' +
          (editHere ? " · terminal editing this page" : "") +
          '">' +
          '<span class="j-toc-n">' +
          (idx + 1) +
          "</span>" +
          '<span class="j-toc-t">' +
          esc(t) +
          "</span></div>"
        );
      })
      .join("");

    el.className = "nb-win is-open kind-book";
    const pagePaper = pg.paper || "plain";
    // Page switches used to always kill the terminal here (silent data loss).
    // keepTerm = dirty navigate: preserve editor; otherwise safe force-close only if open.
    if (!opts.keepTerm) {
      closeMdTerminal(win, { force: true });
    }
    el.className = "nb-win is-open kind-book";
    el.innerHTML =
      '<div class="j-cover cloth-' +
      cloth +
      '">' +
      '<div class="j-cover-band" data-drag-chrome>' +
      '<div class="j-band-row j-band-row-title">' +
      '<input type="text" class="j-cover-title" data-field="bookTitle" />' +
      '<button type="button" class="j-band-btn j-band-fold" data-act="close" title="fold book">fold</button>' +
      "</div>" +
      '<div class="j-band-row j-band-row-tools">' +
      '<div class="j-band-group" title="pages">' +
      '<button type="button" class="j-band-btn" data-act="prev" title="previous page">‹</button>' +
      '<span class="j-page-ind">' +
      (i + 1) +
      "/" +
      n +
      "</span>" +
      '<button type="button" class="j-band-btn" data-act="next" title="next page">›</button>' +
      '<button type="button" class="j-band-btn" data-act="newpage" title="new page">+pg</button>' +
      "</div>" +
      '<div class="j-band-group j-band-group-book" title="book container">' +
      '<button type="button" class="j-band-btn" data-act="checkbin" title="check bin · membership paper">check</button>' +
      '<button type="button" class="j-band-btn" data-act="checkcfg" title="check config · pose + dressup for this host">cfg</button>' +
      '<button type="button" class="j-band-btn" data-act="save" title="save book">save</button>' +
      '<select class="j-band-select" data-field="cloth" title="cloth color (legacy shell)">' +
      CLOTHS.map(
        (c) =>
          '<option value="' +
          c +
          '"' +
          (c === cloth ? " selected" : "") +
          ">" +
          c +
          "</option>"
      ).join("") +
      "</select>" +
      '<button type="button" class="j-band-btn" data-act="shelve" title="put on a shelf">shelve</button>' +
      '<button type="button" class="j-band-btn danger" data-act="trashbook" title="delete notebook forever">trash</button>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="j-cover-well">' +
      '<aside class="j-toc" aria-label="Contents">' +
      '<div class="j-toc-h">Contents</div>' +
      '<div class="j-toc-list">' +
      toc +
      "</div>" +
      '<div class="j-toc-byline">' +
      '<span class="j-toc-by-lab">by</span>' +
      '<input type="text" class="j-toc-author" data-field="bookAuthor" placeholder="unknown" spellcheck="false" title="double-click to edit author" />' +
      "</div></aside>" +
      '<article class="rx-paper j-leaf" data-paper="' +
      esc(pagePaper) +
      '">' +
      '<span class="rx-paper-gutter" aria-hidden="true"></span>' +
      '<div class="rx-paper-inner">' +
      '<div class="rx-paper-rail">' +
      '<input type="text" class="rx-paper-title" data-field="pageTitle" placeholder="page title" />' +
      '<span class="rx-paper-kind">PAGE ' +
      (i + 1) +
      " / " +
      n +
      "</span></div>" +
      '<div class="rx-paper-preview pn-page-body-md" data-paper-preview></div>' +
      bookPageToolsHtml(pagePaper) +
      paperStampsHtml(pg.stamps) +
      "</div></article></div>" +
      '<div class="nb-resize" data-resize></div></div>';

    const bookTitleIn = el.querySelector("[data-field=bookTitle]");
    bookTitleIn.value = book.title || "";
    // single-click/drag on title = move book; double-click = rename
    bookTitleIn.readOnly = true;
    bookTitleIn.setAttribute("title", "drag to move · double-click to rename");
    bookTitleIn.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bookTitleIn.readOnly = false;
      bookTitleIn.focus();
      bookTitleIn.select();
    });
    bookTitleIn.addEventListener("blur", () => {
      bookTitleIn.readOnly = true;
      win.data.title = bookTitleIn.value;
    });
    bookTitleIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        bookTitleIn.blur();
      }
      if (e.key === "Escape") {
        bookTitleIn.value = win.data.title || "";
        bookTitleIn.blur();
      }
    });
    bookTitleIn.addEventListener("input", (e) => {
      win.data.title = e.target.value;
    });
    const bookAuthIn = el.querySelector("[data-field=bookAuthor]");
    if (bookAuthIn) {
      bookAuthIn.value = normalizeAuthor(book.author);
      bookAuthIn.readOnly = true;
      bookAuthIn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        bookAuthIn.readOnly = false;
        bookAuthIn.focus();
        bookAuthIn.select();
      });
      bookAuthIn.addEventListener("blur", () => {
        bookAuthIn.readOnly = true;
        win.data.author = rememberAuthor(bookAuthIn.value);
        bookAuthIn.value = win.data.author;
      });
      bookAuthIn.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          bookAuthIn.blur();
        }
        if (e.key === "Escape") {
          bookAuthIn.value = normalizeAuthor(win.data.author);
          bookAuthIn.blur();
        }
      });
      bookAuthIn.addEventListener("input", (e) => {
        win.data.author = normalizeAuthor(e.target.value);
      });
    }
    el.querySelector("[data-field=pageTitle]").value = pg.title || "";
    {
      const meta = el.querySelector("[data-meta]");
      if (meta) {
        meta.textContent =
          String(pg.body || "").length + "c · p" + (i + 1) + "/" + n;
      }
    }

    el.querySelector("[data-field=pageTitle]").addEventListener("input", (e) => {
      ensurePages(win.data)[win.pageIdx].title = e.target.value;
    });
    const clothSel = el.querySelector("[data-field=cloth]");
    if (clothSel) {
      clothSel.addEventListener("change", () => {
        win.data.cloth = clothSel.value;
        const cover = el.querySelector(".j-cover");
        if (cover) {
          cover.className = "j-cover cloth-" + clothSel.value;
        }
        // closed face uses cloth too when re-rendered
      });
    }
    const paperSel = el.querySelector("[data-field=paper]");
    paperSel.addEventListener("change", () => {
      ensurePages(win.data)[win.pageIdx].paper = paperSel.value;
      const art = el.querySelector(".rx-paper");
      if (art) art.dataset.paper = paperSel.value;
    });
    paintPaper(el, pg.body);

    // restore last open scale (not closed face 120×162, not accidental tiny w/h)
    {
      let ow = win._lastOpenW;
      let oh = win._lastOpenH;
      if (!(ow >= 280 && oh >= 220)) {
        const key = layoutKeyForWin(win);
        const L = key ? loadLayout()[key] : null;
        if (L) {
          if (L.openW >= 280) ow = L.openW;
          if (L.openH >= 220) oh = L.openH;
        }
      }
      if (!(ow >= 280 && oh >= 220)) {
        ow = 620;
        oh = 520;
      }
      el.style.width = ow + "px";
      el.style.height = oh + "px";
      win._lastOpenW = ow;
      win._lastOpenH = oh;
      win._sizedOpen = true;
    }
    wireBook(win);
    if (!restoring) flushLayout();
  }

  async function trashBook(win) {
    if (!win || !win.data || !win.data.id) return;
    const ok = window.confirm(
      "Delete this notebook forever?\n\n" +
        (win.data.title || "untitled") +
        "\n\nAll pages go with it. Cannot be undone."
    );
    if (!ok) return;
    const j = await api("/api/book/delete", {
      method: "POST",
      body: JSON.stringify({ id: win.data.id }),
    });
    if (!j.ok) {
      toast(j.error || "delete fail");
      return;
    }
    const key = layoutKeyForWin(win);
    if (key) unmountWin(key);
    flushLayout({ prune: true, immediate: true });
    toast("notebook deleted");
  }

  async function listShelfOptions() {
    try {
      const j = await api("/api/shelves");
      return j.shelves || [];
    } catch (_) {
      return [];
    }
  }

  async function commitShelveBook(win, sid) {
    if (!win || !win.data || !sid) return;
    await saveBook(win);
    const j = await api("/api/shelf/shelve", {
      method: "POST",
      body: JSON.stringify({ shelf_id: sid, book_id: win.data.id }),
    });
    if (!j.ok) {
      toast(j.error || "shelve fail");
      return;
    }
    const key = layoutKeyForWin(win);
    if (key) unmountWin(key);
    const sk = "shelf:" + sid;
    let sw = wins.get(sk);
    if (!sw && j.shelf) sw = mountShelf(j.shelf);
    if (sw) {
      sw.data = j.shelf || sw.data;
      if (sw.open) await renderShelfOpen(sw);
      else {
        await refreshShelfData(sw);
        renderShelfClosed(sw);
      }
    }
    flushLayout({ prune: true, immediate: true });
    hideShelveModal();
    toast("on the shelf · off the felt");
  }

  let shelvePendingWin = null;

  function hideShelveModal() {
    shelvePendingWin = null;
    if ($("shelveModal")) $("shelveModal").hidden = true;
  }

  async function showShelveModal(win) {
    shelvePendingWin = win;
    const modal = $("shelveModal");
    if (!modal) {
      toast("shelve modal missing · refresh");
      return;
    }
    $("shelveModalBook").textContent =
      "“" + (win.data.title || "untitled") + "”";
    const list = $("shelveModalList");
    list.innerHTML = "";
    const shelves = await listShelfOptions();
    if (!shelves.length) {
      list.innerHTML =
        '<p class="file-modal-empty">no shelves yet · name one below</p>';
    } else {
      shelves.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "file-folder-pick shelf-pick";
        b.innerHTML =
          '<span class="file-folder-pick-ico" aria-hidden="true">📚</span>' +
          '<span class="file-folder-pick-t">' +
          esc(s.title || s.id) +
          "</span>" +
          '<span class="file-folder-pick-n">' +
          (s.books || 0) +
          " books</span>";
        b.onclick = () => commitShelveBook(win, s.id);
        list.appendChild(b);
      });
    }
    if ($("shelveModalNew")) $("shelveModalNew").value = "";
    modal.hidden = false;
  }

  async function shelveBookAway(win) {
    if (!win || win.kind !== "notebook" || !win.data || !win.data.id) return;
    let openShelf = null;
    wins.forEach((w) => {
      if (w.kind === "shelf" && w.open) openShelf = w;
    });
    if (openShelf && openShelf.data && openShelf.data.id) {
      await commitShelveBook(win, openShelf.data.id);
      return;
    }
    await showShelveModal(win);
  }

  /** Move page fromIdx → toIdx; updates pageIdx + popout indices; saves. */
  async function reorderBookPage(win, fromIdx, toIdx) {
    if (!win || win.kind !== "notebook") return;
    syncNotebookPage(win);
    const pages = ensurePages(win.data);
    const n = pages.length;
    if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n) return;
    if (fromIdx === toIdx) return;
    const [item] = pages.splice(fromIdx, 1);
    pages.splice(toIdx, 0, item);
    pages.forEach((p, i) => {
      p.position = i + 1;
    });
    // remap current page index
    let cur = win.pageIdx || 0;
    if (cur === fromIdx) cur = toIdx;
    else if (fromIdx < cur && toIdx >= cur) cur -= 1;
    else if (fromIdx > cur && toIdx <= cur) cur += 1;
    win.pageIdx = cur;
    // remap popouts
    if (win.popouts) {
      win.popouts.forEach((p) => {
        let pi = p.pageIdx;
        if (pi === fromIdx) pi = toIdx;
        else if (fromIdx < pi && toIdx >= pi) pi -= 1;
        else if (fromIdx > pi && toIdx <= pi) pi += 1;
        p.pageIdx = pi;
      });
    }
    await saveBook(win, { quiet: true });
    refreshBookPopouts(win);
    renderBookOpen(win);
    toast("pages reordered");
  }

  async function saveBook(win, opts) {
    opts = opts || {};
    syncNotebookPage(win);
    const clothEl = win.el.querySelector("[data-field=cloth]");
    if (clothEl) win.data.cloth = clothEl.value;
    const authEl = win.el.querySelector("[data-field=bookAuthor]");
    if (authEl) win.data.author = rememberAuthor(authEl.value);
    const pages = ensurePages(win.data).map((p, idx) => ({
      ...p,
      position: idx + 1,
      body: p.body != null ? String(p.body) : "",
      title: p.title || "",
    }));
    const payload = {
      id: win.data.id,
      title: win.data.title || "untitled",
      author: normalizeAuthor(win.data.author),
      cloth: win.data.cloth || "oxblood",
      shelf: win.data.shelf || "",
      whisper: win.data.whisper || "",
      created: win.data.created,
      pages,
    };
    const j = await api("/api/book/save", {
      method: "POST",
      body: JSON.stringify({ book: payload }),
    });
    if (!j.ok) {
      toast(j.error || "save fail");
      return false;
    }
    win.data = j.book;
    if (win.open) {
      const meta = win.el.querySelector("[data-meta]");
      if (meta)
        meta.textContent =
          (j.book.id || "") + " · " + (j.pages || 0) + " pages on disk";
    }
    if (!opts.quiet) toast("notebook saved · " + (j.pages || 0) + " pages");
    flushLayout();
    return true;
  }

  function wireBook(win) {
    const el = win.el;
    el.onmousedown = () => bringFront(el);

    const face = el.querySelector("[data-drag-face]");
    if (face) {
      let moved = false;
      face.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        moved = false;
        startDrag(win, ev, () => {
          moved = true;
        });
      });
      face.addEventListener("click", (ev) => {
        if (moved) return;
        ev.preventDefault();
        renderBookOpen(win);
      });
    }

    const chrome = el.querySelector("[data-drag-chrome]");
    if (chrome) {
      chrome.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button, textarea, select, .live-source")) return;
        // readonly book title is part of the drag handle; editing = leave alone
        const inp = ev.target.closest("input");
        if (inp && !inp.readOnly) return;
        startDrag(win, ev);
      });
    }

    // Pointer drag-reorder (HTML5 DnD on <button> is flaky in WebView)
    const tocList = el.querySelector(".j-toc-list");
    let tocDrag = null; // { from, el, moved }
    function clearTocDropMarks() {
      if (!tocList) return;
      tocList.querySelectorAll(".j-toc-item").forEach((b) => {
        b.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
      });
    }
    function tocItemAtPoint(x, y) {
      const hit = document.elementFromPoint(x, y);
      return hit && hit.closest ? hit.closest(".j-toc-item") : null;
    }
    el.querySelectorAll(".j-toc-item").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        if (tocDrag && tocDrag.moved) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        goBookPage(win, parseInt(btn.getAttribute("data-page"), 10) || 0);
      });
      btn.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-page"), 10) || 0;
        popOutPage(win, idx);
      });
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          btn.click();
        }
      });
      btn.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        // don't fight window drag chrome
        ev.stopPropagation();
        const from = parseInt(btn.getAttribute("data-page"), 10);
        if (!Number.isFinite(from)) return;
        tocDrag = {
          from,
          el: btn,
          moved: false,
          x0: ev.clientX,
          y0: ev.clientY,
        };
        btn.setPointerCapture(ev.pointerId);
      });
      btn.addEventListener("pointermove", (ev) => {
        if (!tocDrag || tocDrag.el !== btn) return;
        const dx = ev.clientX - tocDrag.x0;
        const dy = ev.clientY - tocDrag.y0;
        if (!tocDrag.moved && dx * dx + dy * dy > 36) {
          tocDrag.moved = true;
          btn.classList.add("is-dragging");
        }
        if (!tocDrag.moved) return;
        clearTocDropMarks();
        btn.classList.add("is-dragging");
        const over = tocItemAtPoint(ev.clientX, ev.clientY);
        if (over && tocList && tocList.contains(over) && over !== btn) {
          const rect = over.getBoundingClientRect();
          const before = ev.clientY < rect.top + rect.height / 2;
          over.classList.add(before ? "is-drop-before" : "is-drop-after");
        }
      });
      btn.addEventListener("pointerup", async (ev) => {
        if (!tocDrag || tocDrag.el !== btn) return;
        try {
          btn.releasePointerCapture(ev.pointerId);
        } catch (_) {}
        const wasDrag = tocDrag.moved;
        const from = tocDrag.from;
        tocDrag = null;
        if (!wasDrag) {
          clearTocDropMarks();
          return;
        }
        const over = tocItemAtPoint(ev.clientX, ev.clientY);
        clearTocDropMarks();
        if (!over || !tocList || !tocList.contains(over)) return;
        const toHover = parseInt(over.getAttribute("data-page"), 10);
        if (!Number.isFinite(toHover)) return;
        const rect = over.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height / 2;
        let to = before ? toHover : toHover + 1;
        if (from < to) to -= 1;
        if (from === to) return;
        await reorderBookPage(win, from, to);
      });
      btn.addEventListener("pointercancel", () => {
        tocDrag = null;
        clearTocDropMarks();
      });
    });

    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const a = btn.getAttribute("data-act");
        const pages = ensurePages(win.data);
        if (a === "edit") openBookTerminal(win);
        if (a === "check") {
          await openPaperCheck(win);
          return;
        }
        if (a === "red") {
          await openRedMark(win);
          return;
        }
        if (a === "stamp") {
          showStampPicker(win, btn);
          return;
        }
        if (a === "copypath") {
          await copyLeafPath(win);
          return;
        }
        if (a === "checkbin") {
          await openBinCheck(win);
          return;
        }
        if (a === "checkcfg") {
          await openConfigCheck(win);
          return;
        }
        if (a === "popout") {
          popOutPage(win, win.pageIdx || 0);
          return;
        }
        if (a === "save" || a === "save2") {
          await saveBook(win);
          refreshBookPopouts(win);
        }
        if (a === "trashbook") {
          closeBookPopouts(win);
          await trashBook(win);
          return;
        }
        if (a === "shelve") {
          closeBookPopouts(win);
          await shelveBookAway(win);
          return;
        }
        if (a === "close") {
          if (win.termEl && win.termDirty) {
            const leave = window.confirm(
              "Terminal has unsaved markdown.\n\nOK = fold without saving\nCancel = keep editing"
            );
            if (!leave) return;
          }
          // keep open scale for next unfold
          if (win.open) {
            win._lastOpenW = win.el.offsetWidth;
            win._lastOpenH = win.el.offsetHeight;
          }
          closeMdTerminal(win, { force: true });
          await saveBook(win);
          flushLayout({ immediate: true }); // persist openW/H while still open
          win._sizedOpen = false;
          renderBookClosed(win); // closes peeks
          flushLayout({ immediate: true });
        }
        if (a === "prev") {
          goBookPage(win, Math.max(0, (win.pageIdx || 0) - 1));
        }
        if (a === "next") {
          goBookPage(win, Math.min(pages.length - 1, (win.pageIdx || 0) + 1));
        }
        if (a === "newpage") {
          syncNotebookPage(win);
          if (win.termEl && win.termDirty) {
            // keep editor on current page; still allow adding a page in the TOC
          } else {
            closeMdTerminal(win, { force: true });
          }
          const t = Date.now();
          pages.push({
            id: "leaf_" + t,
            position: pages.length + 1,
            title: "page " + (pages.length + 1),
            body: "",
            mark: "",
          });
          const keep = !!(win.termEl && win.termDirty);
          win.pageIdx = pages.length - 1;
          renderBookOpen(win, { keepTerm: keep });
          if (keep) {
            setLeafEditUi(win, true);
            const ei =
              (win.termPageIdx != null ? win.termPageIdx : 0) + 1;
            toast("new page · editor still on p" + ei + " (unsaved)");
          }
        }
        if (a === "takeout") {
          // chip leaves book bin → loose leaf on felt (urgent memo movement)
          syncNotebookPage(win);
          await saveBook(win);
          const pg = ensurePages(win.data)[win.pageIdx || 0];
          if (!pg || !pg.id) {
            toast("no page");
            return;
          }
          if ((ensurePages(win.data) || []).length <= 1) {
            toast("book needs at least one page · add +pg first");
            return;
          }
          const j = await api("/api/book/unfile", {
            method: "POST",
            body: JSON.stringify({
              book_id: win.data.id,
              leaf_id: pg.id,
            }),
          });
          if (!j.ok) {
            toast(j.error || "take out failed");
            return;
          }
          const idx = win.pageIdx || 0;
          win.data.pages = (win.data.pages || []).filter((_, i) => i !== idx);
          win.pageIdx = Math.min(idx, Math.max(0, win.data.pages.length - 1));
          // reload book from server
          const jb = await api("/api/book/" + encodeURIComponent(win.data.id));
          if (jb.ok && jb.book) win.data = jb.book;
          renderBookOpen(win);
          if (j.leaf) {
            const lw = mountLeaf(j.leaf);
            if (lw) {
              renderScrapOpen(lw, {
                openW: lw._lastOpenW,
                openH: lw._lastOpenH,
              });
            }
          }
          toast("page out on the felt · chip left the book bin");
        }
      };
    });

    const rz = el.querySelector("[data-resize]");
    if (rz && win.open) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) startResize(win, ev, 480, 380);
      });
    }
    el.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "e" || ev.key === "E")) {
        if (ev.target && ev.target.closest && ev.target.closest(".md-term-ta")) return;
        // don't steal when typing in title fields
        if (
          ev.target &&
          ev.target.matches &&
          ev.target.matches("input:not([readonly]), textarea:not(.md-term-ta)")
        ) {
          return;
        }
        ev.preventDefault();
        openBookTerminal(win);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
        ev.preventDefault();
        saveBook(win).then(() => refreshBookPopouts(win));
      }
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.shiftKey &&
        (ev.key === "P" || ev.key === "p")
      ) {
        ev.preventDefault();
        popOutPage(win, win.pageIdx || 0);
      }
      if (!ev.target.closest("textarea, input") && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        // optional scrub when not in field — skip to avoid fight with caret
      }
    });
  }

  function mountBook(book, pos) {
    if (book && book.shelf) return null;
    const key = "book:" + book.id;
    if (wins.has(key)) return wins.get(key);
    const el = document.createElement("div");
    const { x, y } = pos || placeOffset();
    el.style.left = x + "px";
    el.style.top = y + "px";
    felt.appendChild(el);
    const win = {
      kind: "notebook",
      el,
      data: book,
      open: false,
      pageIdx: 0,
    };
    wins.set(key, win);
    bringFront(el);
    const L = applyLayout(win, key);
    // remember open scale from layout (never use closed face w/h as open size)
    if (L) {
      if (L.openW >= 280) win._lastOpenW = L.openW;
      if (L.openH >= 220) win._lastOpenH = L.openH;
    }
    renderBookClosed(win);
    if (L && L.open) {
      renderBookOpen(win);
    }
    return win;
  }

  // ═══════════════════════════════════════════════════════
  // SHELF — put notebooks away (same idea as folders)
  // ═══════════════════════════════════════════════════════
  function renderShelfClosed(win) {
    win.open = false;
    const el = win.el;
    const books = win.data.books || [];
    const n = books.length;
    el.className = "nb-win is-closed kind-shelf";
    // mini spine previews from book_details if present
    const details = win.data.book_details || [];
    const spines =
      details.length || n
        ? (details.length ? details : books.map((id) => ({ id, cloth: "oxblood" })))
            .slice(0, 12)
            .map(
              (b) =>
                '<span class="shelf-spine cloth-' +
                esc(b.cloth || "oxblood") +
                '" title="' +
                esc(b.title || b.id) +
                '"></span>'
            )
            .join("")
        : '<span class="shelf-empty-spines">empty</span>';
    el.innerHTML =
      '<button type="button" class="shelf-face" data-drag-face>' +
      '<span class="shelf-ledge">' +
      '<span class="shelf-plank">' +
      spines +
      "</span>" +
      '<span class="shelf-wood" aria-hidden="true"></span>' +
      "</span>" +
      '<span class="shelf-caption">' +
      '<span class="shelf-face-title"></span>' +
      '<span class="shelf-face-meta"></span>' +
      "</span></button>";
    el.querySelector(".shelf-face-title").textContent =
      win.data.title || "shelf";
    el.querySelector(".shelf-face-meta").textContent =
      n + " book" + (n === 1 ? "" : "s");
    // match closed-book scale on the felt (~book height for spines)
    el.style.width = "300px";
    el.style.height = "148px";
    wireShelf(win);
  }

  async function refreshShelfData(win) {
    const j = await api("/api/shelf/" + encodeURIComponent(win.data.id));
    if (j.ok && j.shelf) win.data = j.shelf;
    return win.data;
  }

  async function renderShelfOpen(win) {
    win.open = true;
    await refreshShelfData(win);
    const el = win.el;
    const s = win.data;
    const books = s.book_details || [];
    el.className = "nb-win is-open kind-shelf";
    const listHtml = books.length
      ? books
          .map(
            (b) =>
              '<div class="shelf-book-row' +
              (b.missing ? " is-missing" : "") +
              '">' +
              '<span class="shelf-book-spine cloth-' +
              esc(b.cloth || "oxblood") +
              '" aria-hidden="true"></span>' +
              '<div class="shelf-book-body">' +
              '<span class="shelf-book-t">' +
              esc(b.title || b.id) +
              "</span></div>" +
              '<button type="button" class="folder-sheet-out" data-unshelve="' +
              esc(b.id) +
              '">take out</button></div>'
          )
          .join("")
      : '<p class="folder-empty">empty · open a notebook and hit <strong>shelve…</strong></p>';

    el.innerHTML =
      '<div class="shelf-open" data-drag-chrome>' +
      '<div class="shelf-head">' +
      '<input type="text" class="shelf-title-in" data-field="shelfTitle" />' +
      '<button type="button" class="rx-paper-btn danger" data-act="shelf-trash">trash shelf</button>' +
      '<button type="button" class="rx-paper-btn" data-act="shelf-fold">fold</button></div>' +
      '<p class="folder-hint"><strong>take out</strong> puts a book back on the felt · open shelf + shelve… to put books here</p>' +
      '<div class="shelf-plank-open">' +
      listHtml +
      "</div>" +
      '<div class="nb-resize" data-resize></div></div>';

    el.querySelector("[data-field=shelfTitle]").value = s.title || "shelf";
    el.querySelector("[data-field=shelfTitle]").addEventListener(
      "change",
      async (e) => {
        win.data.title = e.target.value;
        await api("/api/shelf/save", {
          method: "POST",
          body: JSON.stringify({ shelf: win.data }),
        });
        toast("shelf renamed");
      }
    );
    if (!win._sizedOpen) {
      el.style.width = "320px";
      el.style.height = "300px";
      win._sizedOpen = true;
    }
    wireShelf(win);
    if (!restoring) flushLayout();
  }

  function wireShelf(win) {
    const el = win.el;
    el.onmousedown = () => bringFront(el);
    const face = el.querySelector("[data-drag-face]");
    if (face) {
      let moved = false;
      face.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        moved = false;
        startDrag(win, ev, () => {
          moved = true;
        });
      });
      face.addEventListener("click", (ev) => {
        if (moved) return;
        ev.preventDefault();
        renderShelfOpen(win);
      });
    }
    const chrome = el.querySelector("[data-drag-chrome]");
    if (chrome) {
      chrome.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button, input, textarea, select")) return;
        startDrag(win, ev);
      });
    }
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const a = btn.getAttribute("data-act");
        if (a === "shelf-fold") {
          win._sizedOpen = false;
          await refreshShelfData(win);
          renderShelfClosed(win);
          flushLayout({ immediate: true });
        }
        if (a === "shelf-trash") {
          const ok = window.confirm(
            "Delete this shelf?\n\nBooks will come back onto the felt (not deleted)."
          );
          if (!ok) return;
          const j = await api("/api/shelf/delete", {
            method: "POST",
            body: JSON.stringify({ shelf_id: win.data.id }),
          });
          if (!j.ok) {
            toast(j.error || "fail");
            return;
          }
          for (const bid of j.released || []) {
            try {
              const full = await api("/api/book/" + encodeURIComponent(bid));
              if (full.ok) mountBook(full.book);
            } catch (_) {}
          }
          unmountWin("shelf:" + win.data.id);
          flushLayout({ prune: true, immediate: true });
          toast("shelf gone · books back on felt");
        }
      };
    });
    el.querySelectorAll("[data-unshelve]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        const bid = btn.getAttribute("data-unshelve");
        if (!bid) return;
        const j = await api("/api/shelf/unshelve", {
          method: "POST",
          body: JSON.stringify({
            shelf_id: win.data.id,
            book_id: bid,
          }),
        });
        if (!j.ok) {
          toast(j.error || "unshelve fail");
          return;
        }
        if (j.book) mountBook(j.book);
        await renderShelfOpen(win);
        toast("book back on the felt");
      };
    });
    const rz = el.querySelector("[data-resize]");
    if (rz && win.open) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) startResize(win, ev, 260, 200);
      });
    }
  }

  function mountShelf(shelf, pos) {
    const key = "shelf:" + shelf.id;
    if (wins.has(key)) {
      const existing = wins.get(key);
      existing.data = shelf;
      return existing;
    }
    const el = document.createElement("div");
    const fallback = pos || placeOffset();
    el.style.left = fallback.x + "px";
    el.style.top = fallback.y + "px";
    felt.appendChild(el);
    const win = { kind: "shelf", el, data: shelf, open: false };
    wins.set(key, win);
    bringFront(el);
    const L = applyLayout(win, key);
    if (L && L.open) {
      if (L.w > 80) el.style.width = L.w + "px";
      if (L.h > 60) el.style.height = L.h + "px";
      win._sizedOpen = true;
      renderShelfOpen(win);
    } else {
      renderShelfClosed(win);
      if (L) applyLayout(win, key);
    }
    return win;
  }

  // ═══════════════════════════════════════════════════════
  // CORK MAT — decorative board under papers (not a pin container)
  // ═══════════════════════════════════════════════════════
  function renderCorkMat(win) {
    // always a flat resizable mat; "open" only so layout stores w/h
    win.open = true;
    const el = win.el;
    el.className = "nb-win is-open kind-cork cork-is-mat";
    el.innerHTML =
      '<div class="cork-mat" data-drag-face title="cork mat · drag · resize · double-click name">' +
      '<input type="text" class="cork-mat-label" data-field="corkTitle" readonly spellcheck="false" />' +
      '<div class="nb-resize" data-resize></div></div>';
    const lab = el.querySelector("[data-field=corkTitle]");
    lab.value = win.data.title || "cork";
    lab.readOnly = true;
    lab.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      lab.readOnly = false;
      lab.focus();
      lab.select();
    });
    lab.addEventListener("blur", async () => {
      lab.readOnly = true;
      win.data.title = (lab.value || "cork").trim() || "cork";
      lab.value = win.data.title;
      try {
        await api("/api/cork/save", {
          method: "POST",
          body: JSON.stringify({ cork: win.data }),
        });
      } catch (_) {}
    });
    lab.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        lab.blur();
      }
      if (e.key === "Escape") {
        lab.value = win.data.title || "cork";
        lab.blur();
      }
    });
    lab.addEventListener("pointerdown", (e) => {
      // don't start drag when renaming
      if (!lab.readOnly) e.stopPropagation();
    });
    if (!win._corkSized) {
      const L = layoutKeyForWin(win) ? loadLayout()[layoutKeyForWin(win)] : null;
      if (L && L.w > 80 && L.h > 60) {
        el.style.width = L.w + "px";
        el.style.height = L.h + "px";
      } else {
        el.style.width = "280px";
        el.style.height = "220px";
      }
      win._corkSized = true;
    }
    wireCork(win);
    stickCorkBack(win);
    if (!restoring) flushLayout();
  }

  function wireCork(win) {
    const el = win.el;
    el.onmousedown = () => stickCorkBack(win);
    const face = el.querySelector("[data-drag-face]");
    if (face) {
      face.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("input") && !ev.target.readOnly) return;
        if (ev.target.closest("[data-resize]")) return;
        stickCorkBack(win);
        startDrag(win, ev);
      });
    }
    const rz = el.querySelector("[data-resize]");
    if (rz) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) {
          stickCorkBack(win);
          startResize(win, ev, 120, 100);
        }
      });
    }
  }

  function mountCork(cork, pos) {
    const key = "cork:" + cork.id;
    if (wins.has(key)) return wins.get(key);
    const el = document.createElement("div");
    const fallback = pos || placeOffset();
    el.style.left = fallback.x + "px";
    el.style.top = fallback.y + "px";
    felt.appendChild(el);
    const win = { kind: "cork", el, data: cork, open: true };
    wins.set(key, win);
    const L = applyLayout(win, key);
    if (L && L.w > 80) el.style.width = L.w + "px";
    if (L && L.h > 60) el.style.height = L.h + "px";
    if (L && L.w > 80) win._corkSized = true;
    renderCorkMat(win);
    if (L) applyLayout(win, key);
    stickCorkBack(win);
    return win;
  }

  // ═══════════════════════════════════════════════════════
  // FOLDERS (folios) — put leaves away off the felt
  // ═══════════════════════════════════════════════════════
  function renderFolderClosed(win) {
    win.open = false;
    const el = win.el;
    const n = (win.data.sheets || []).length;
    el.className = "nb-win is-closed kind-folder";
    el.innerHTML =
      '<button type="button" class="folder-face" data-drag-face>' +
      '<span class="folder-tab" aria-hidden="true"></span>' +
      '<span class="folder-face-title"></span>' +
      '<span class="folder-face-meta"></span></button>';
    el.querySelector(".folder-face-title").textContent =
      win.data.title || "folder";
    el.querySelector(".folder-face-meta").textContent =
      n + " sheet" + (n === 1 ? "" : "s");
    el.style.width = "132px";
    el.style.height = "100px";
    wireFolder(win);
  }

  async function refreshFolderData(win) {
    const j = await api("/api/folder/" + encodeURIComponent(win.data.id));
    if (j.ok && j.folder) win.data = j.folder;
    return win.data;
  }

  async function renderFolderOpen(win) {
    win.open = true;
    await refreshFolderData(win);
    const el = win.el;
    const f = win.data;
    const sheets = f.sheet_details || [];
    el.className = "nb-win is-open kind-folder";
    const listHtml = sheets.length
      ? sheets
          .map(
            (s) =>
              '<div class="folder-sheet' +
              (s.missing ? " is-missing" : "") +
              '" data-sheet-row="' +
              esc(s.id) +
              '">' +
              '<div class="folder-sheet-body">' +
              '<span class="folder-sheet-t">' +
              esc(s.title || s.id) +
              "</span>" +
              '<span class="folder-sheet-by">' +
              esc(s.author || "") +
              "</span></div>" +
              '<button type="button" class="folder-sheet-out" data-sheet="' +
              esc(s.id) +
              '" title="take out onto the felt">take out</button></div>'
          )
          .join("")
      : '<p class="folder-empty">empty · open a leaf and hit <strong>file…</strong></p>';

    el.innerHTML =
      '<div class="folder-open" data-drag-chrome>' +
      '<div class="folder-open-tab" aria-hidden="true"></div>' +
      '<div class="folder-head">' +
      '<input type="text" class="folder-title-in" data-field="folderTitle" />' +
      '<button type="button" class="rx-paper-btn danger" data-act="folder-trash">trash folder</button>' +
      '<button type="button" class="rx-paper-btn" data-act="folder-fold">fold</button></div>' +
      '<p class="folder-hint"><strong>take out</strong> puts a sheet back on the felt · file… on an open leaf fills this folder</p>' +
      '<div class="folder-pocket">' +
      '<div class="folder-sheets">' +
      listHtml +
      "</div></div>" +
      '<div class="nb-resize" data-resize></div></div>';

    el.querySelector("[data-field=folderTitle]").value = f.title || "folder";
    el.querySelector("[data-field=folderTitle]").addEventListener(
      "change",
      async (e) => {
        win.data.title = e.target.value;
        await api("/api/folder/save", {
          method: "POST",
          body: JSON.stringify({ folder: win.data }),
        });
        toast("folder renamed");
      }
    );

    if (!win._sizedOpen) {
      el.style.width = "300px";
      el.style.height = "340px";
      win._sizedOpen = true;
    }
    wireFolder(win);
    if (!restoring) flushLayout();
  }

  function wireFolder(win) {
    const el = win.el;
    el.onmousedown = () => bringFront(el);
    const face = el.querySelector("[data-drag-face]");
    if (face) {
      let moved = false;
      face.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        moved = false;
        startDrag(win, ev, () => {
          moved = true;
        });
      });
      face.addEventListener("click", (ev) => {
        if (moved) return;
        ev.preventDefault();
        renderFolderOpen(win);
      });
    }
    const chrome = el.querySelector("[data-drag-chrome]");
    if (chrome) {
      chrome.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button, input, textarea, select")) return;
        startDrag(win, ev);
      });
    }
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const a = btn.getAttribute("data-act");
        if (a === "folder-fold") {
          win._sizedOpen = false;
          renderFolderClosed(win);
          flushLayout({ immediate: true });
        }
        if (a === "folder-trash") {
          const ok = window.confirm(
            "Delete this folder?\n\nSheets inside will come back onto the felt (not deleted)."
          );
          if (!ok) return;
          const j = await api("/api/folder/delete", {
            method: "POST",
            body: JSON.stringify({ folder_id: win.data.id }),
          });
          if (!j.ok) {
            toast(j.error || "fail");
            return;
          }
          // remount released leaves
          for (const lid of j.released || []) {
            try {
              const full = await api("/api/leaf/" + encodeURIComponent(lid));
              if (full.ok) mountLeaf(full.leaf || full.scrap);
            } catch (_) {}
          }
          unmountWin("folder:" + win.data.id);
          flushLayout({ prune: true, immediate: true });
          toast("folder gone · sheets back on felt");
        }
      };
    });
    el.querySelectorAll("[data-sheet]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        const lid = btn.getAttribute("data-sheet");
        if (!lid) return;
        const j = await api("/api/folder/unfile", {
          method: "POST",
          body: JSON.stringify({
            folder_id: win.data.id,
            leaf_id: lid,
          }),
        });
        if (!j.ok) {
          toast(j.error || "unfile fail");
          return;
        }
        if (j.leaf) {
          const lw = mountLeaf(j.leaf);
          if (lw) {
            renderScrapOpen(lw, {
              openW: lw._lastOpenW,
              openH: lw._lastOpenH,
            });
          }
        }
        await renderFolderOpen(win);
        toast("sheet back on the felt");
      };
    });
    const rz = el.querySelector("[data-resize]");
    if (rz && win.open) {
      rz.addEventListener("pointerdown", (ev) => {
        if (ev.button === 0) startResize(win, ev, 240, 220);
      });
    }
  }

  function mountFolder(folder, pos) {
    const key = "folder:" + folder.id;
    if (wins.has(key)) {
      const existing = wins.get(key);
      existing.data = folder;
      return existing;
    }
    const el = document.createElement("div");
    const fallback = pos || placeOffset();
    el.style.left = fallback.x + "px";
    el.style.top = fallback.y + "px";
    felt.appendChild(el);
    const win = { kind: "folder", el, data: folder, open: false };
    wins.set(key, win);
    bringFront(el);
    const L = applyLayout(win, key);
    if (L && L.open) {
      if (L.w > 80) el.style.width = L.w + "px";
      if (L.h > 60) el.style.height = L.h + "px";
      win._sizedOpen = true;
      renderFolderOpen(win);
    } else {
      renderFolderClosed(win);
      if (L) applyLayout(win, key);
    }
    return win;
  }

  // ═══════════════════════════════════════════════════════
  // SPAWN MODAL
  // ═══════════════════════════════════════════════════════
  function setSpawnKind(k) {
    spawnKind = k;
    $("choiceScrap").classList.toggle("is-on", k === "leaf");
    $("choiceNotebook").classList.toggle("is-on", k === "notebook");
    $("choiceImport").classList.toggle("is-on", k === "import");
    if ($("choiceCork")) $("choiceCork").classList.toggle("is-on", k === "cork");
    if ($("choiceFolder"))
      $("choiceFolder").classList.toggle("is-on", k === "folder");
    if ($("choiceShelf"))
      $("choiceShelf").classList.toggle("is-on", k === "shelf");
    $("spawnTitleField").hidden = k === "import";
    $("spawnImportField").hidden = k !== "import";
    if ($("spawnClothField")) {
      $("spawnClothField").hidden = k !== "notebook";
    }
    $("spawnGo").textContent =
      k === "leaf"
        ? "Spawn leaf"
        : k === "notebook"
          ? "Spawn notebook"
          : k === "cork"
            ? "Spawn cork mat"
            : k === "folder"
              ? "Spawn folder"
              : k === "shelf"
                ? "Spawn shelf"
                : "Import onto felt";
    if (k === "leaf") {
      $("spawnTitleIn").value = "untitled leaf";
      if ($("spawnAuthorIn")) $("spawnAuthorIn").value = getLastAuthor();
    }
    if (k === "notebook") {
      $("spawnTitleIn").value = "untitled";
      if ($("spawnAuthorIn")) $("spawnAuthorIn").value = getLastAuthor();
    }
    if (k === "cork") $("spawnTitleIn").value = "corkboard";
    if (k === "folder") $("spawnTitleIn").value = "working papers";
    if (k === "shelf") $("spawnTitleIn").value = "book shelf";
    if ($("spawnAuthorField")) {
      $("spawnAuthorField").hidden = k !== "leaf" && k !== "notebook";
    }
  }

  async function loadExternal() {
    try {
      const j = await api("/api/books/external");
      externalList = j.external || [];
      const sel = $("spawnImportSel");
      sel.innerHTML = "";
      if (!externalList.length) {
        sel.innerHTML = '<option value="">(no journal/notebook books found)</option>';
        return;
      }
      externalList.forEach((ex, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent =
          "[" +
          ex.source +
          "] " +
          (ex.title || ex.id) +
          " · " +
          (ex.page_count || 0) +
          "p";
        sel.appendChild(o);
      });
    } catch (e) {
      toast("could not list journals · " + e.message);
    }
  }

  async function doSpawn() {
    try {
      if (spawnKind === "leaf") {
        const title = ($("spawnTitleIn").value || "untitled leaf").trim();
        const author = rememberAuthor(
          ($("spawnAuthorIn") && $("spawnAuthorIn").value) || getLastAuthor()
        );
        const cloth = CLOTHS[spawnN % CLOTHS.length];
        const j = await api("/api/leaf/spawn", {
          method: "POST",
          body: JSON.stringify({ title, cloth, author }),
        });
        if (!j.ok) throw new Error(j.error || "fail");
        mountLeaf(j.leaf || j.scrap);
        toast("loose leaf · by " + author + " · ^S seals");
      } else if (spawnKind === "cork") {
        const title = ($("spawnTitleIn").value || "corkboard").trim();
        const j = await api("/api/cork/spawn", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (!j.ok) throw new Error(j.error || "fail");
        mountCork(j.cork);
        toast("cork mat · stays behind · stack notes on it");
      } else if (spawnKind === "folder") {
        const title = ($("spawnTitleIn").value || "folder").trim();
        const j = await api("/api/folder/spawn", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (!j.ok) throw new Error(j.error || "fail");
        mountFolder(j.folder);
        toast("folder on the felt · file leaves into it");
      } else if (spawnKind === "shelf") {
        const title = ($("spawnTitleIn").value || "shelf").trim();
        const j = await api("/api/shelf/spawn", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (!j.ok) throw new Error(j.error || "fail");
        mountShelf(j.shelf);
        toast("shelf on the felt · shelve notebooks onto it");
      } else if (spawnKind === "notebook") {
        const title = ($("spawnTitleIn").value || "untitled").trim();
        const author = rememberAuthor(
          ($("spawnAuthorIn") && $("spawnAuthorIn").value) || getLastAuthor()
        );
        const clothEl = $("spawnClothIn");
        const cloth =
          (clothEl && clothEl.value) || CLOTHS[spawnN % CLOTHS.length];
        const j = await api("/api/book/spawn", {
          method: "POST",
          body: JSON.stringify({ title, cloth, author }),
        });
        if (!j.ok) throw new Error(j.error || "fail");
        mountBook(j.book);
        toast("notebook · by " + author + " · " + cloth);
      } else {
        const idx = parseInt($("spawnImportSel").value, 10);
        const ex = externalList[idx];
        if (!ex || !ex.path) throw new Error("pick a journal");
        const j = await api("/api/book/import", {
          method: "POST",
          body: JSON.stringify({ path: ex.path }),
        });
        if (!j.ok) throw new Error(j.error || "import fail");
        const win = mountBook(j.book);
        renderBookOpen(win);
        toast("imported · " + (j.book.title || "book") + " · open");
      }
      hideSpawn();
    } catch (e) {
      toast(e.message || String(e));
    }
  }

  function showSpawn() {
    $("spawnModal").hidden = false;
    setSpawnKind(spawnKind);
    if ($("spawnAuthorIn") && spawnKind === "leaf") {
      $("spawnAuthorIn").value = getLastAuthor();
    }
    loadExternal();
    $("spawnTitleIn").focus();
  }
  function hideSpawn() {
    $("spawnModal").hidden = true;
  }

  async function restore() {
    restoring = true;
    try {
      await bootLayout();
      const sj = await api("/api/leaves");
      for (const row of sj.leaves || sj.scraps || []) {
        // shelved leaves stay in folders only
        if (row.folder) continue;
        let full;
        try {
          full = await api("/api/leaf/" + encodeURIComponent(row.id));
        } catch (_) {
          full = await api("/api/scrap/" + encodeURIComponent(row.id));
        }
        if (full.ok) {
          const leaf = full.leaf || full.scrap;
          if (leaf && leaf.folder) continue;
          mountLeaf(leaf);
        }
      }
      const bj = await api("/api/books");
      for (const row of bj.books || []) {
        if (row.shelf) continue;
        const full = await api("/api/book/" + encodeURIComponent(row.id));
        if (full.ok) {
          const book = full.book;
          if (book && book.shelf) continue;
          mountBook(book);
        }
      }
      try {
        const fj = await api("/api/folders");
        for (const row of fj.folders || []) {
          const full = await api(
            "/api/folder/" + encodeURIComponent(row.id)
          );
          if (full.ok) mountFolder(full.folder);
        }
      } catch (_) {
        /* older server */
      }
      try {
        const sj2 = await api("/api/shelves");
        for (const row of sj2.shelves || []) {
          const full = await api(
            "/api/shelf/" + encodeURIComponent(row.id)
          );
          if (full.ok) mountShelf(full.shelf);
        }
      } catch (_) {
        /* older server */
      }
      try {
        const cj = await api("/api/corks");
        for (const row of cj.corks || []) {
          const full = await api("/api/cork/" + encodeURIComponent(row.id));
          if (full.ok) mountCork(full.cork);
        }
      } catch (_) {
        /* older server */
      }
      // re-apply positions after all mounts (closed render / flush mid-open can race)
      function reapplyAll() {
        wins.forEach((win, key) => {
          applyLayout(win, key);
        });
      }
      reapplyAll();
      // second pass after layout paint — closed CSS can reset timing on first frame
      requestAnimationFrame(() => {
        reapplyAll();
        requestAnimationFrame(reapplyAll);
      });
      restoring = false;
      // only prune after every object is mounted; write disk immediately
      flushLayout({ prune: true, immediate: true });
      const nPos = Object.keys(layoutCache).filter((k) => {
        const L = layoutCache[k];
        return L && typeof L.x === "number" && typeof L.y === "number";
      }).length;
      if (wins.size)
        toast(
          "restored " + wins.size + " · " + nPos + " positions on disk"
        );
      else toast("Receiver · spawn a leaf or a notebook");
    } catch (_) {
      restoring = false;
      toast("Receiver · spawn onto the felt");
    }
  }

  function persistLayoutForUnload() {
    flushLayout({ prune: false, immediate: true, beacon: true });
  }
  window.addEventListener("beforeunload", persistLayoutForUnload);
  window.addEventListener("pagehide", persistLayoutForUnload);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushLayout({ immediate: true, beacon: true });
    }
  });
  // periodic safety net while working — always hits disk
  setInterval(() => {
    if (wins.size && !restoring) flushLayout({ immediate: true });
  }, 4000);

  function topOpenLeaf() {
    let best = null;
    let bestZ = -1;
    wins.forEach((win) => {
      if (win.kind !== "leaf" || !win.open) return;
      const z = parseInt(win.el.style.zIndex, 10) || 0;
      if (z >= bestZ) {
        bestZ = z;
        best = win;
      }
    });
    return best;
  }

  /** Topmost open leaf or notebook (for global ^E / paper seal). */
  function topOpenWritable() {
    let best = null;
    let bestZ = -1;
    wins.forEach((win) => {
      if (!win.open) return;
      if (win.kind !== "leaf" && win.kind !== "notebook") return;
      const z = parseInt(win.el && win.el.style.zIndex, 10) || 0;
      if (z >= bestZ) {
        bestZ = z;
        best = win;
      }
    });
    return best;
  }

  // Ctrl+E edit · Ctrl+Shift+I check paper · Ctrl+S seal (leaf)
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    if (ev.target && ev.target.classList && ev.target.classList.contains("md-term-ta")) {
      // still allow check-paper from terminal
      if (
        ev.shiftKey &&
        (ev.key === "i" || ev.key === "I")
      ) {
        const best = topOpenWritable();
        if (best) {
          ev.preventDefault();
          openPaperCheck(best);
        }
      }
      return; // terminal owns its own ^S / ^Q
    }
    // typing in book/leaf title inputs — leave alone except we still allow ^E on paper focus
    if (
      ev.target &&
      ev.target.matches &&
      ev.target.matches("input:not([readonly]), textarea:not(.md-term-ta)")
    ) {
      return;
    }
    const best = topOpenWritable();
    if (!best) return;
    // Ctrl+Shift+I — check paper (full file notepad)
    if (ev.shiftKey && (ev.key === "i" || ev.key === "I")) {
      ev.preventDefault();
      openPaperCheck(best);
      return;
    }
    // Ctrl+Shift+R — red mark (edit copy → diff → send)
    if (ev.shiftKey && (ev.key === "r" || ev.key === "R")) {
      ev.preventDefault();
      openRedMark(best);
      return;
    }
    if (ev.key === "e" || ev.key === "E") {
      if (ev.shiftKey) return;
      ev.preventDefault();
      if (best.kind === "notebook") openBookTerminal(best);
      else openLeafTerminal(best);
      return;
    }
    if (ev.key === "s" || ev.key === "S") {
      if (best.kind === "leaf") {
        ev.preventDefault();
        sealLeaf(best);
      }
      // notebook ^S handled on book el / terminal
    }
  });

  $("btnSpawn").onclick = showSpawn;
  $("spawnCancel").onclick = hideSpawn;
  $("spawnGo").onclick = doSpawn;
  if ($("fileModalCancel")) $("fileModalCancel").onclick = hideFileModal;
  if ($("fileModal")) {
    $("fileModal").addEventListener("click", (ev) => {
      if (ev.target === $("fileModal")) hideFileModal();
    });
  }
  if ($("fileModalNewGo")) {
    $("fileModalNewGo").onclick = async () => {
      const win = filePendingWin;
      if (!win) return;
      const name = (($("fileModalNew") && $("fileModalNew").value) || "").trim();
      if (!name) {
        toast("name the folder first");
        return;
      }
      const j = await api("/api/folder/spawn", {
        method: "POST",
        body: JSON.stringify({ title: name }),
      });
      if (!j.ok) {
        toast(j.error || "could not make folder");
        return;
      }
      mountFolder(j.folder);
      await commitFileToFolder(win, j.folder.id);
    };
  }
  if ($("fileModalNew")) {
    $("fileModalNew").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if ($("fileModalNewGo")) $("fileModalNewGo").click();
      }
      if (ev.key === "Escape") hideFileModal();
    });
  }
  $("choiceScrap").onclick = () => setSpawnKind("leaf");
  $("choiceNotebook").onclick = () => setSpawnKind("notebook");
  if ($("choiceFolder"))
    $("choiceFolder").onclick = () => setSpawnKind("folder");
  if ($("choiceShelf"))
    $("choiceShelf").onclick = () => setSpawnKind("shelf");
  if ($("choiceCork")) $("choiceCork").onclick = () => setSpawnKind("cork");
  if ($("shelveModalCancel")) $("shelveModalCancel").onclick = hideShelveModal;
  if ($("shelveModal")) {
    $("shelveModal").addEventListener("click", (ev) => {
      if (ev.target === $("shelveModal")) hideShelveModal();
    });
  }
  if ($("shelveModalNewGo")) {
    $("shelveModalNewGo").onclick = async () => {
      const win = shelvePendingWin;
      if (!win) return;
      const name = (
        ($("shelveModalNew") && $("shelveModalNew").value) ||
        ""
      ).trim();
      if (!name) {
        toast("name the shelf first");
        return;
      }
      const j = await api("/api/shelf/spawn", {
        method: "POST",
        body: JSON.stringify({ title: name }),
      });
      if (!j.ok) {
        toast(j.error || "could not make shelf");
        return;
      }
      mountShelf(j.shelf);
      await commitShelveBook(win, j.shelf.id);
    };
  }
  $("choiceImport").onclick = () => {
    setSpawnKind("import");
    loadExternal();
  };
  $("spawnTitleIn").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      doSpawn();
    }
    if (ev.key === "Escape") hideSpawn();
  });
  $("spawnModal").addEventListener("click", (ev) => {
    if (ev.target === $("spawnModal")) hideSpawn();
  });

  restore();
})();
