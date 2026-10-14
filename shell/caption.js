/**
 * Frameless The Deck Host caption — injected after each page load.
 * Under document.body so pywebview drag sees .pywebview-drag-region.
 *
 * Host always: min / max / close · Deck (Launcher) · Reload · Hard refresh · Exit
 * Opt-in via data-deck-controls: deep (F11) · step / step_size
 * Zoom: Ctrl+= / Ctrl+- / Ctrl+0  (keyboard, persisted — not a chrome product)
 * Doors: left gem mark · Alt+M / Ctrl+K
 */
(function (title, heightPx) {
  var TITLE = title || "deck host";
  var H = heightPx || 36;
  var ZOOM_MIN = 0.75;
  var ZOOM_MAX = 1.75;
  var ZOOM_STEP = 0.1;
  var LS_ZOOM = "deck-host-zoom";
  var LS_DEEP = "deck-host-deep";

  // Thin host menu. Back / Forward / New window / deep / snap are ROM opt-in.
  var DOORS = [
    { label: "Deck", action: "deck" },
    { sep: true },
    { label: "Reload", action: "reload" },
    { label: "Restart server", action: "hard_refresh" },
  ];
  var DEFAULT_CONTROLS = ["min", "max", "close"];

  /**
   * ROMs may fully replace doors with window.DECK_ROM_MENU = [
   *   { label|labelFn, action?, run?, sep?, items? }, …
   * ]
   * When set, DECK_ROM_MENU_EXTRAS is ignored (put everything in DECK_ROM_MENU).
   * Folders: { label, items: [ … ] } — click opens a cascade. run/action close the menu.
   */
  function doorsList() {
    var rom = window.DECK_ROM_MENU;
    if (rom && rom.length) return rom;
    return DOORS;
  }

  function romOwnsMenu() {
    return !!(window.DECK_ROM_MENU && window.DECK_ROM_MENU.length);
  }

  function chromeAllowList() {
    var chrome = document.querySelector("[data-deck-chrome]");
    var slot = document.querySelector("[data-deck-window-controls]");
    var raw = (
      (slot && slot.getAttribute("data-deck-controls")) ||
      (chrome && chrome.getAttribute("data-deck-controls")) ||
      ""
    )
      .trim()
      .toLowerCase();
    if (raw) return raw.split(/[\s,]+/).filter(Boolean);
    return DEFAULT_CONTROLS.slice();
  }

  function chromeHas(name) {
    var allow = chromeAllowList();
    if (name === "step") {
      return allow.indexOf("step") >= 0 || allow.indexOf("step_size") >= 0;
    }
    return allow.indexOf(name) >= 0;
  }

  function deepAllowed() {
    return chromeHas("deep");
  }

  function api() {
    return window.pywebview && window.pywebview.api;
  }

  function bindFramelessResize() {
    var a = api();
    if (!a || typeof a.resize !== "function") return;
    if (document.getElementById("deck-host-resize")) return;

    var minW = 320;
    var minH = 240;
    var dirs = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
    var box = document.createElement("div");
    box.id = "deck-host-resize";
    box.setAttribute("aria-hidden", "true");
    for (var i = 0; i < dirs.length; i++) {
      var el = document.createElement("div");
      el.className = "dh-resize dh-resize-" + dirs[i];
      el.dataset.dir = dirs[i];
      box.appendChild(el);
    }
    (document.body || document.documentElement).appendChild(box);

    var romGrip = document.querySelector(".sheet-resize");
    if (romGrip) romGrip.setAttribute("hidden", "");

    if (!document.getElementById("deck-host-resize-css")) {
      var style = document.createElement("style");
      style.id = "deck-host-resize-css";
      style.textContent =
        "#deck-host-resize{position:fixed;inset:0;z-index:2147483003;pointer-events:none}" +
        "#deck-host-resize .dh-resize{" +
        "position:absolute;pointer-events:auto;-webkit-app-region:no-drag;background:transparent}" +
        "#deck-host-resize .dh-resize-n,#deck-host-resize .dh-resize-s{" +
        "left:10px;right:10px;height:6px}" +
        "#deck-host-resize .dh-resize-n{top:0;cursor:ns-resize}" +
        "#deck-host-resize .dh-resize-s{bottom:0;cursor:ns-resize}" +
        "#deck-host-resize .dh-resize-e,#deck-host-resize .dh-resize-w{" +
        "top:10px;bottom:10px;width:6px}" +
        "#deck-host-resize .dh-resize-e{right:0;cursor:ew-resize}" +
        "#deck-host-resize .dh-resize-w{left:0;cursor:ew-resize}" +
        "#deck-host-resize .dh-resize-ne,#deck-host-resize .dh-resize-nw," +
        "#deck-host-resize .dh-resize-se,#deck-host-resize .dh-resize-sw{" +
        "width:14px;height:14px}" +
        "#deck-host-resize .dh-resize-ne{top:0;right:0;cursor:nesw-resize}" +
        "#deck-host-resize .dh-resize-nw{top:0;left:0;cursor:nwse-resize}" +
        "#deck-host-resize .dh-resize-sw{bottom:0;left:0;cursor:nesw-resize}" +
        "#deck-host-resize .dh-resize-se{" +
        "right:0;bottom:0;cursor:nwse-resize;" +
        "background:linear-gradient(135deg,transparent 46%,currentColor 46%);" +
        "opacity:.4;color:currentColor}" +
        "#deck-host-resize .dh-resize-se:hover{opacity:.85}" +
        "html.deck-host-www-menu #deck-host-resize .dh-resize-se{color:#5a4838}";
      document.head.appendChild(style);
    }

    var drag = null;
    var pending = null;
    var tick = 0;

    function sizeNow() {
      return {
        w: window.outerWidth || document.documentElement.clientWidth || 640,
        h: window.outerHeight || document.documentElement.clientHeight || 480,
        x: window.screenX,
        y: window.screenY,
      };
    }

    function flush(e) {
      if (!drag || !e) return;
      var dx = e.screenX - drag.px;
      var dy = e.screenY - drag.py;
      var w = drag.w;
      var h = drag.h;
      var x = drag.wx;
      var y = drag.wy;
      var dir = drag.dir;
      if (dir.indexOf("e") >= 0) w = drag.w + dx;
      if (dir.indexOf("s") >= 0) h = drag.h + dy;
      if (dir.indexOf("w") >= 0) {
        w = Math.max(minW, drag.w - dx);
        x = drag.wx + (drag.w - w);
      }
      if (dir.indexOf("n") >= 0) {
        h = Math.max(minH, drag.h - dy);
        y = drag.wy + (drag.h - h);
      }
      w = Math.max(minW, Math.round(w));
      h = Math.max(minH, Math.round(h));
      var spec = w + "x" + h;
      if (dir.indexOf("w") >= 0 || dir.indexOf("n") >= 0) {
        spec += "@" + Math.round(x) + "," + Math.round(y);
      }
      try {
        a.resize(spec);
      } catch (err) {}
    }

    box.addEventListener("pointerdown", function (e) {
      var dir = e.target && e.target.dataset && e.target.dataset.dir;
      if (!dir || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var now = sizeNow();
      drag = {
        dir: dir,
        px: e.screenX,
        py: e.screenY,
        w: now.w,
        h: now.h,
        wx: now.x,
        wy: now.y,
      };
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    box.addEventListener("pointermove", function (e) {
      if (!drag) return;
      pending = e;
      if (tick) return;
      tick = requestAnimationFrame(function () {
        tick = 0;
        flush(pending);
      });
    });
    function stopDrag() {
      drag = null;
      pending = null;
    }
    box.addEventListener("pointerup", stopDrag);
    box.addEventListener("pointercancel", stopDrag);
  }

  function readZoom() {
    try {
      var z = parseFloat(localStorage.getItem(LS_ZOOM) || "1");
      if (isNaN(z) || z < ZOOM_MIN || z > ZOOM_MAX) return 1;
      return Math.round(z * 100) / 100;
    } catch (e) {
      return 1;
    }
  }

  function writeZoom(z) {
    try {
      localStorage.setItem(LS_ZOOM, String(z));
    } catch (e) {}
  }

  function applyZoom(z) {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    z = Math.round(z * 100) / 100;
    document.documentElement.style.setProperty("--deck-page-zoom", String(z));
    // WebView2 paints a black band if html { zoom } is set, even to 1.
    if (z === 1) {
      document.documentElement.style.removeProperty("zoom");
    } else {
      document.documentElement.style.zoom = String(z);
    }
    writeZoom(z);
    var lab = document.querySelector("#deck-host-caption .dh-cap-zoom");
    if (lab) lab.textContent = Math.round(z * 100) + "%";
    return z;
  }

  function zoomBy(delta) {
    return applyZoom(readZoom() + delta);
  }

  function stepWindowSize() {
    var a = api();
    if (a && a.step_window_size) {
      try {
        var r = a.step_window_size();
        // pywebview may return a Promise
        if (r && typeof r.then === "function") {
          r.then(function (s) {
            flashSizeHint(s);
          }).catch(function () {});
        } else {
          flashSizeHint(r);
        }
      } catch (e) {}
    }
  }

  function parseWindowPayload(s) {
    // "maximized|expanded|standard|compact:WxH" | legacy size string
    var str = String(s || "");
    var mode = null;
    var size = str;
    var m = str.match(/^(standard|expanded|maximized|compact):(.+)$/i);
    if (m) {
      mode = m[1].toLowerCase();
      size = m[2];
    } else if (/1600|1280x800|400x920/i.test(str)) {
      mode = "expanded";
    } else if (str) {
      mode = "standard";
    }
    return { mode: mode, size: size, raw: str };
  }

  function notifyWindowMode(payload) {
    try {
      var parsed = parseWindowPayload(payload);
      if (typeof window.DECK_ON_WINDOW_MODE === "function" && parsed.mode) {
        window.DECK_ON_WINDOW_MODE(parsed.mode, parsed.size || payload);
      }
    } catch (e) {}
  }

  function runMaximize() {
    var a = api();
    if (!a || !a.toggle_maximize) return;
    try {
      var r = a.toggle_maximize();
      if (r && typeof r.then === "function") {
        r.then(function (s) {
          notifyWindowMode(s);
          setMagIcon(s);
        }).catch(function () {});
      } else if (r) {
        notifyWindowMode(r);
        setMagIcon(r);
      }
    } catch (e) {}
  }

  function setMagIcon(sizeStr) {
    var btn =
      document.querySelector("[data-deck-window-controls] [data-act=step_size]") ||
      document.querySelector("#deck-host-caption [data-act=step_size]");
    if (!btn) return;
    var parsed = parseWindowPayload(sizeStr);
    var large = parsed.mode === "expanded";
    btn.textContent = large ? "⤡" : "⤢";
    btn.title = large
      ? "Window · snap to standard size"
      : "Window · snap to expanded size";
  }

  function flashSizeHint(s) {
    if (!s) return;
    var parsed = parseWindowPayload(s);
    setMagIcon(s);
    notifyWindowMode(s);
    var lab = document.querySelector("#deck-host-caption .dh-cap-zoom");
    if (!lab) return;
    lab.textContent = String(parsed.size || s).replace("x", "×");
    lab.classList.add("is-flash");
    setTimeout(function () {
      lab.classList.remove("is-flash");
      lab.textContent = Math.round(readZoom() * 100) + "%";
    }, 900);
  }

  function isDeep() {
    return document.documentElement.classList.contains("deck-host-deep");
  }

  function captionBarEl() {
    return (
      document.querySelector("[data-deck-chrome][data-deck-integrated]") ||
      document.getElementById("deck-host-caption")
    );
  }

  function setCaptionHeightVar(px) {
    var v = px + "px";
    document.documentElement.style.setProperty("--deck-caption-h", v); document.documentElement.style.setProperty("--pocket-caption-h", v);
    if (document.body) document.body.style.setProperty("--deck-caption-h", v); document.body.style.setProperty("--pocket-caption-h", v);
  }

  function armSurfaceDrags(on) {
    // Surfaces may mark [data-deck-drag] (e.g. terminal .tm-rail-brand).
    // Ensure pywebview-drag-region class is present for frameless move.
    try {
      var nodes = document.querySelectorAll("[data-deck-drag]");
      for (var i = 0; i < nodes.length; i++) {
        if (on) nodes[i].classList.add("pywebview-drag-region");
        // leave class on when exiting deep — still fine while caption exists
        else nodes[i].classList.add("pywebview-drag-region");
      }
    } catch (e) {}
  }

  function setDeep(on) {
    var root = document.documentElement;
    var bar = captionBarEl();
    var menu = document.getElementById("deck-host-menu");
    var integrated = root.classList.contains("deck-host-integrated");
    // ROMs may keep their own chrome in deep (logo + spawn rail) via data-deck-deep-stay
    var stay =
      !!(bar && bar.hasAttribute("data-deck-deep-stay")) ||
      !!document.querySelector("[data-deck-chrome][data-deck-deep-stay]");
    if (on) {
      root.classList.add("deck-host-deep");
      if (document.body) document.body.classList.add("deck-host-deep");
      if (bar) {
        if (stay) {
          bar.hidden = false;
          bar.classList.add("is-deep-rail");
        } else {
          bar.hidden = true;
        }
      }
      if (menu) menu.hidden = true;
      setCaptionHeightVar(0);
      armSurfaceDrags(true);
      try {
        localStorage.setItem(LS_DEEP, "1");
      } catch (e) {}
      ensureDeepHint(true);
    } else {
      root.classList.remove("deck-host-deep");
      if (document.body) document.body.classList.remove("deck-host-deep");
      if (bar) {
        bar.hidden = false;
        bar.classList.remove("is-deep-rail");
      }
      setCaptionHeightVar(integrated ? 0 : H);
      armSurfaceDrags(false);
      try {
        localStorage.removeItem(LS_DEEP);
      } catch (e) {}
      ensureDeepHint(false);
    }
  }

  function toggleDeep() {
    if (!isDeep() && !deepAllowed()) return;
    setDeep(!isDeep());
  }

  function ensureDeepHint(show) {
    var el = document.getElementById("deck-host-deep-hint");
    var drag = document.getElementById("deck-host-deep-drag");
    if (!show) {
      if (el) el.remove();
      if (drag) drag.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "deck-host-deep-hint";
      el.setAttribute("role", "status");
      el.textContent = "deep · Esc/F11 surface · drag corner slug";
      el.addEventListener("click", function () {
        setDeep(false);
      });
      document.body.appendChild(el);
      // Brief toast, then fully gone (not a sticky dim overlay on desk ROMs)
      setTimeout(function () {
        if (el && el.parentNode) el.classList.add("is-fade");
      }, 1600);
      setTimeout(function () {
        if (el && el.parentNode) {
          el.classList.add("is-gone");
          el.setAttribute("aria-hidden", "true");
        }
      }, 2800);
    }
    // Fallback grabber only if surface didn't mark a drag slug
    var hasSurface = document.querySelector("[data-deck-drag]");
    if (!hasSurface && !drag) {
      drag = document.createElement("div");
      drag.id = "deck-host-deep-drag";
      drag.className = "pywebview-drag-region";
      drag.title = "Drag window";
      document.body.appendChild(drag);
    }
  }

  function setCaptionVar() {
    if (isDeep()) {
      setCaptionHeightVar(0);
    } else {
      setCaptionHeightVar(H);
    }
    document.documentElement.classList.add("deck-host-frameless");
    if (document.body) document.body.classList.add("deck-host-frameless");
  }

  function runDoor(item) {
    var a = api();
    if (!item) return;
    if (typeof item.run === "function") {
      try {
        item.run();
      } catch (err) {}
      return;
    }
    if (item.action === "deck" || item.action === "home") {
      if (a && a.open_deck) a.open_deck();
      else if (a && a.home) a.home();
      return;
    }
    if (item.action === "zoom_reset") {
      applyZoom(1);
      return;
    }
    if (item.action === "step_size") {
      stepWindowSize();
      return;
    }
    if (item.action === "deep") {
      setDeep(true);
      return;
    }
    if (item.action === "hard_refresh") {
      if (a && a.hard_refresh) a.hard_refresh();
      else if (typeof window.WWWHardRefresh === "function") window.WWWHardRefresh();
      else location.reload();
      return;
    }
    if (item.action === "new_window") {
      if (a && a.new_window) a.new_window();
      return;
    }
    if (item.action === "reload") {
      if (a && a.reload) a.reload();
      else if (typeof window.WWWRefresh === "function") window.WWWRefresh();
      else location.reload();
      return;
    }
    if (item.action === "back") {
      history.back();
      return;
    }
    if (item.action === "forward") {
      history.forward();
      return;
    }
    if (item.action === "exit" || item.action === "close") {
      if (a && a.close) a.close();
      return;
    }
    if (item.path) {
      if (a && a.go) a.go(item.path);
      else location.assign(item.path);
    }
  }

  function syncMenuMark() {
    var m = document.getElementById("deck-host-menu");
    var mark = document.getElementById("deck-host-mark");
    if (!mark) return;
    var open = m && !m.hidden;
    mark.classList.toggle("is-open", !!open);
    mark.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeMenu() {
    var m = document.getElementById("deck-host-menu");
    if (m) {
      closeChildFolders(m);
      m.hidden = true;
    }
    syncMenuMark();
  }

  function itemLabel(item) {
    if (!item) return "…";
    if (typeof item.labelFn === "function") {
      try {
        return item.labelFn() || "…";
      } catch (e) {
        return item.label || "…";
      }
    }
    return item.label || "…";
  }

  function closeChildFolders(parentBox) {
    if (!parentBox || !parentBox.children) return;
    var kids = Array.prototype.slice.call(parentBox.children);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.classList && el.classList.contains("dh-submenu")) {
        closeChildFolders(el);
        if (el.parentNode) el.parentNode.removeChild(el);
      } else if (el.tagName === "BUTTON" && el.classList.contains("dh-menu-folder")) {
        el.setAttribute("aria-expanded", "false");
      }
    }
  }

  function toggleFolder(btn, item, parentBox) {
    var open = btn.getAttribute("aria-expanded") === "true";
    closeChildFolders(parentBox);
    if (open) return;
    var sub = document.createElement("div");
    sub.className = "dh-submenu";
    sub.setAttribute("role", "menu");
    sub.setAttribute("data-deck-submenu", "1");
    (item.items || []).forEach(function (child) {
      appendMenuEntry(sub, child, false);
    });
    var pos = "relative";
    try {
      pos = window.getComputedStyle(parentBox).position;
    } catch (e) {}
    if (!pos || pos === "static") parentBox.style.position = "relative";
    var vw = window.innerWidth || 640;
    var rail = vw < 480;
    if (rail) {
      sub.classList.add("is-down");
      if (btn.nextSibling) parentBox.insertBefore(sub, btn.nextSibling);
      else parentBox.appendChild(sub);
    } else {
      sub.style.position = "absolute";
      sub.style.left = "100%";
      sub.style.right = "auto";
      sub.style.marginLeft = "-1px";
      sub.style.zIndex = "3";
      parentBox.appendChild(sub);
      var top = btn.offsetTop || 0;
      try {
        var br = btn.getBoundingClientRect();
        var pr = parentBox.getBoundingClientRect();
        top = Math.round(br.top - pr.top);
      } catch (e2) {}
      sub.style.top = top + "px";
      try {
        var box = sub.getBoundingClientRect();
        if (box.right > vw - 8) {
          sub.style.left = "auto";
          sub.style.right = "100%";
          sub.style.marginLeft = "0";
          sub.style.marginRight = "-1px";
        }
      } catch (e3) {}
    }
    btn.setAttribute("aria-expanded", "true");
  }

  function appendMenuEntry(box, item, extraMark) {
    if (!box || !item) return;
    if (item.sep) {
      var sep = document.createElement("div");
      sep.className = "dh-menu-sep";
      if (extraMark) sep.setAttribute("data-deck-rom-extra", "1");
      box.appendChild(sep);
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (extraMark) b.setAttribute("data-deck-rom-extra", "1");
    var folder = !!(item.items && item.items.length);
    if (folder) {
      b.className = "dh-menu-folder";
      b.setAttribute("aria-haspopup", "true");
      b.setAttribute("aria-expanded", "false");
      var lab = document.createElement("span");
      lab.textContent = itemLabel(item);
      var caret = document.createElement("span");
      caret.className = "dh-menu-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "▸";
      b.appendChild(lab);
      b.appendChild(caret);
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFolder(b, item, box);
      });
    } else {
      b.textContent = itemLabel(item);
      b.addEventListener("click", function (e) {
        e.preventDefault();
        closeMenu();
        try {
          if (typeof item.run === "function") item.run();
          else runDoor(item);
        } catch (err) {}
      });
    }
    box.appendChild(b);
  }

  /** ROMs may set window.DECK_ROM_MENU_EXTRAS = [{ label|labelFn, run, items? }] */
  function appendRomMenuExtras(menu) {
    if (!menu || romOwnsMenu()) return;
    // clear previous extras (rebuild-safe)
    var old = menu.querySelectorAll("[data-deck-rom-extra]");
    for (var i = 0; i < old.length; i++) old[i].remove();
    var extras = window.DECK_ROM_MENU_EXTRAS;
    if (!extras || !extras.length) return;
    var sep = document.createElement("div");
    sep.className = "dh-menu-sep";
    sep.setAttribute("data-deck-rom-extra", "1");
    menu.appendChild(sep);
    extras.forEach(function (item) {
      appendMenuEntry(menu, item, true);
    });
  }

  function listHasExit(items) {
    if (!items || !items.length) return false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      if (it.action === "exit" || it.action === "close") return true;
      if (/^exit$/i.test(String(it.label || ""))) return true;
      if (it.items && listHasExit(it.items)) return true;
    }
    return false;
  }

  function menuHasExit() {
    var extras = window.DECK_ROM_MENU_EXTRAS;
    return listHasExit(doorsList()) || listHasExit(extras);
  }

  function appendExit(menu) {
    if (!menu || menuHasExit()) return;
    var sep = document.createElement("div");
    sep.className = "dh-menu-sep";
    menu.appendChild(sep);
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = "Exit";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      closeMenu();
      runDoor({ action: "exit" });
    });
    menu.appendChild(b);
  }

  function clearMenuItems(menu) {
    if (!menu) return;
    var kids = Array.prototype.slice.call(menu.children);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains("dh-menu-hint")) continue;
      menu.removeChild(kids[i]);
    }
  }

  function fillMenuItems(menu) {
    if (!menu) return;
    clearMenuItems(menu);
    doorsList().forEach(function (item) {
      appendMenuEntry(menu, item, false);
    });
    appendRomMenuExtras(menu);
    appendExit(menu);
  }

  function refreshRomMenuExtras() {
    var m = document.getElementById("deck-host-menu");
    if (m) fillMenuItems(m);
  }

  function toggleMenu() {
    var m = document.getElementById("deck-host-menu");
    if (!m) return;
    // if deep, surface first so menu has a home
    if (isDeep()) setDeep(false);
    // ROM may register menu late — rebuild each open
    fillMenuItems(m);
    m.hidden = !m.hidden;
    syncMenuMark();
    if (!m.hidden) {
      try {
        var btn = m.querySelector("button");
        if (btn) btn.focus();
      } catch (e) {}
    }
  }

  function injectCss() {
    if (document.getElementById("deck-host-caption-css")) return;
    var style = document.createElement("style");
    style.id = "deck-host-caption-css";
    style.textContent =
      "html.deck-host-frameless,html.deck-host-frameless body{" +
      "--deck-caption-h:" +
      H +
      "px !important;" +
      "--deck-page-zoom:1}" +
      "html.deck-host-frameless.deck-host-deep," +
      "html.deck-host-frameless.deck-host-deep body{" +
      "--deck-caption-h:0px !important;" +
      "margin:0!important;padding:0!important}" +
      "html.deck-host-frameless.deck-host-deep #deck-host-caption{" +
      "display:none!important;height:0!important;min-height:0!important;" +
      "overflow:hidden!important;border:0!important;padding:0!important;" +
      "pointer-events:none!important}" +
      "#deck-host-caption{" +
      "position:fixed;top:0;left:0;right:0;height:" +
      H +
      "px;z-index:2147483000;" +
      "display:flex;align-items:stretch;" +
      "font-family:system-ui,Segoe UI,sans-serif;font-size:12px;" +
      "color:#d8dee8;background:#0a0c12;" +
      "border-bottom:1px solid rgba(120,140,200,.35);" +
      "box-shadow:0 2px 12px rgba(0,0,0,.45);" +
      "user-select:none!important;-webkit-user-select:none!important}" +
      "#deck-host-caption[hidden]{display:none!important;height:0!important;min-height:0!important;border:0!important}" +
      "#deck-host-caption .dh-cap-drag{" +
      "flex:1;display:flex;align-items:center;gap:8px;" +
      "padding:0 10px;min-width:0;cursor:grab}" +
      "#deck-host-caption .dh-cap-drag:active{cursor:grabbing}" +
      "#deck-host-caption .dh-cap-mark{" +
      "flex-shrink:0;width:" +
      H +
      "px;height:" +
      H +
      "px;margin:0;padding:0;border:0;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "background:transparent}" +
      "#deck-host-caption .dh-cap-mark:hover{background:rgba(255,255,255,.08)}" +
      "#deck-host-caption .dh-cap-mark.is-open{background:rgba(106,140,255,.18)}" +
      "#deck-host-caption .dh-cap-mark-gem{" +
      "display:block;width:9px;height:9px;pointer-events:none;" +
      "background:linear-gradient(135deg,#6a8cff,#a070ff);" +
      "box-shadow:0 0 10px rgba(100,130,255,.5)}" +
      "#deck-host-caption .dh-cap-title{" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "letter-spacing:.04em;opacity:.95;flex:1;min-width:0}" +
      "#deck-host-caption .dh-cap-zoom{" +
      "flex-shrink:0;font:inherit;font-size:11px;font-weight:500;" +
      "letter-spacing:.04em;color:inherit;opacity:.72;" +
      "min-width:2.4em;text-align:right;cursor:pointer;" +
      "padding:0 8px 0 4px;margin:0;border:0;background:transparent;" +
      "border-radius:0;line-height:" +
      H +
      "px}" +
      "#deck-host-caption .dh-cap-zoom:hover{opacity:1;background:transparent}" +
      "#deck-host-caption .dh-cap-zoom.is-flash{opacity:1}" +
      "#deck-host-caption .dh-cap-btns{display:flex;flex-shrink:0;align-items:stretch}" +
      "#deck-host-caption .dh-cap-btn{" +
      "width:36px;border:0;background:transparent;color:inherit;" +
      "font-size:13px;cursor:pointer;line-height:" +
      H +
      "px;padding:0}" +
      "#deck-host-caption .dh-cap-btn:hover{background:rgba(255,255,255,.1)}" +
      "#deck-host-caption .dh-cap-btn.close:hover{background:#c42b1c;color:#fff}" +
      "#deck-host-caption .dh-cap-btn.mag-btn{width:36px;font-size:15px;letter-spacing:0}" +
      "#deck-host-caption .dh-cap-btn.deep-btn{width:36px;line-height:1}" +
      "#deck-host-caption .dh-cap-btn.deep-btn .dh-eye{display:block;width:18px;height:18px;margin:0 auto}" +
      "#deck-host-caption .dh-cap-btn.deep-btn .dh-eye-shut{display:none}" +
      "#deck-host-caption .dh-cap-btn.deep-btn:hover .dh-eye-open{display:none}" +
      "#deck-host-caption .dh-cap-btn.deep-btn:hover .dh-eye-shut{display:block}" +
      "#deck-host-caption .dh-cap-btn.deep-btn svg," +
      "#deck-host-caption .dh-cap-btn.max-btn svg{" +
      "display:block;width:18px;height:18px;margin:0 auto;fill:none;" +
      "stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}" +
      "#deck-host-caption .dh-cap-btn.max-btn{width:36px;line-height:1}" +

      "#deck-host-menu{" +
      "position:fixed;top:" +
      H +
      "px;left:0;min-width:220px;max-width:min(320px,90vw);" +
      "z-index:2147483001;margin:0;padding:6px 0;overflow:visible;" +
      "background:#12151e;border:1px solid rgba(120,140,200,.3);" +
      "border-top:none;box-shadow:0 12px 32px rgba(0,0,0,.55);" +
      "font-family:system-ui,Segoe UI,sans-serif;font-size:13px;color:#e4e8f0}" +
      "#deck-host-menu[hidden]{display:none!important}" +
      "#deck-host-menu button{" +
      "display:block;width:100%;text-align:left;border:0;background:transparent;" +
      "color:inherit;padding:8px 14px;cursor:pointer;font:inherit}" +
      "#deck-host-menu button:hover,#deck-host-menu button:focus{" +
      "background:rgba(106,140,255,.18);outline:none}" +
      "#deck-host-menu .dh-menu-sep{" +
      "height:1px;margin:6px 10px;background:rgba(120,140,200,.2)}" +
      "#deck-host-menu .dh-menu-hint{" +
      "padding:6px 14px 4px;font-size:10px;letter-spacing:.08em;" +
      "text-transform:uppercase;opacity:.45}" +
      "#deck-host-menu .dh-menu-folder{" +
      "display:flex;align-items:center;justify-content:space-between;gap:12px}" +
      "#deck-host-menu .dh-menu-caret{" +
      "opacity:.55;font-size:11px;padding-left:8px}" +
      "#deck-host-menu .dh-submenu{" +
      "position:absolute;left:100%;top:0;margin-left:-1px;min-width:10.5rem;" +
      "z-index:2;padding:6px 0;" +
      "background:#12151e;border:1px solid rgba(120,140,200,.3);" +
      "box-shadow:0 12px 32px rgba(0,0,0,.55);" +
      "font:inherit;color:inherit}" +
      "#deck-host-menu .dh-submenu.is-down," +
      "html.deck-host-integrated #deck-host-menu .dh-submenu.is-down{" +
      "position:relative;left:auto;right:auto;top:auto;margin:2px 8px 6px;" +
      "min-width:0;width:auto;box-shadow:none}" +
      "#deck-host-menu .dh-submenu button{" +
      "display:block;width:100%;text-align:left;border:0;background:transparent;" +
      "color:inherit;padding:8px 14px;cursor:pointer;font:inherit}" +
      "#deck-host-menu .dh-submenu button:hover," +
      "#deck-host-menu .dh-submenu button:focus{" +
      "background:rgba(106,140,255,.18);outline:none}" +
      "#deck-host-menu .dh-submenu .dh-menu-sep{" +
      "height:1px;margin:6px 10px;background:rgba(120,140,200,.2)}" +
      "#deck-host-deep-hint{" +
      "position:fixed!important;top:8px!important;bottom:auto!important;" +
      "left:50%!important;right:auto!important;" +
      "transform:translateX(-50%)!important;" +
      "z-index:2147483002;padding:6px 14px;font:11px system-ui,sans-serif;" +
      "letter-spacing:.06em;text-transform:uppercase;cursor:pointer;" +
      "color:rgba(220,230,240,.75);background:rgba(10,12,18,.82);" +
      "border:1px solid rgba(120,140,200,.25);border-radius:999px;" +
      "transition:opacity .4s ease;" +
      "max-width:min(90vw,420px);white-space:nowrap;overflow:hidden;" +
      "text-overflow:ellipsis}" +
      "#deck-host-deep-hint.is-fade{opacity:0!important;pointer-events:none!important}" +
      "#deck-host-deep-hint.is-gone{" +
      "opacity:0!important;pointer-events:none!important;" +
      "visibility:hidden!important;width:0!important;height:0!important;" +
      "padding:0!important;border:0!important;overflow:hidden!important}" +
      /* fallback corner grabber if surface has no data-deck-drag */
      "#deck-host-deep-drag{" +
      "position:fixed!important;top:0!important;left:0!important;" +
      "z-index:2147483001;" +
      "width:2.5rem;height:2.5rem;cursor:grab;" +
      "background:transparent}" +
      "#deck-host-deep-drag:active{cursor:grabbing}" +
      "html.deck-host-frameless.deck-host-deep," +
      "html.deck-host-frameless.deck-host-deep body{" +
      "overflow:hidden!important}";
    document.head.appendChild(style);
  }

  function mkWinBtn(act, label, title, extraClass) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "dh-cap-btn" + (extraClass ? " " + extraClass : "");
    b.setAttribute("data-act", act);
    b.title = title;
    if (label) b.textContent = label;
    b.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (act === "step_size") {
        stepWindowSize();
        return;
      }
      if (act === "deep") {
        setDeep(true);
        return;
      }
      var a = api();
      if (!a) return;
      if (act === "min" && a.minimize) a.minimize();
      if (act === "max") runMaximize();
      if (act === "close" && a.close) a.close();
    });
    return b;
  }

  function fillWindowControls(slot) {
    if (!slot || slot.getAttribute("data-deck-filled") === "1") return;
    slot.setAttribute("data-deck-filled", "1");
    slot.classList.add("dh-cap-btns");

    // ROM may add controls: data-deck-controls="deep,min,max,close" on the slot
    // or parent [data-deck-chrome]. Default = thin window (min, max, close).
    function has(name) {
      var raw = (slot.getAttribute("data-deck-controls") || "").trim().toLowerCase();
      if (raw) {
        var allow = raw.split(/[\s,]+/).filter(Boolean);
        if (name === "step") {
          return allow.indexOf("step") >= 0 || allow.indexOf("step_size") >= 0;
        }
        return allow.indexOf(name) >= 0;
      }
      return chromeHas(name);
    }

    if (has("deep")) {
      var deepBtn = mkWinBtn("deep", "", "Go deep · hide chrome · F11", "deep-btn");
      deepBtn.innerHTML =
        '<span class="dh-eye dh-eye-open" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24">' +
        '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/>' +
        '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>' +
        "</svg></span>" +
        '<span class="dh-eye dh-eye-shut" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24">' +
        '<path d="M3 12h18"/>' +
        '<path d="M5.5 12c1.2-2.4 3.6-4 6.5-4s5.3 1.6 6.5 4"/>' +
        "</svg></span>";
      slot.appendChild(deepBtn);
    }
    if (has("step")) {
      slot.appendChild(
        mkWinBtn("step_size", "⤢", "Window · snap standard / expanded", "mag-btn")
      );
    }
    if (has("min")) {
      slot.appendChild(mkWinBtn("min", "─", "Minimize"));
    }
    if (has("max")) {
      var maxBtn = mkWinBtn("max", "", "Maximize window", "max-btn");
      maxBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="5" y="5" width="14" height="14" rx="1.2"/>' +
        "</svg>";
      slot.appendChild(maxBtn);
    }
    if (has("close")) {
      slot.appendChild(mkWinBtn("close", "✕", "Close", "close"));
    }
  }

  function dragEventElement(e) {
    var t = e.target;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t || null;
  }

  function inDragBar(t) {
    if (!t || !t.closest) return false;
    if (
      t.closest(
        "button, a, input, textarea, select, option, label, [contenteditable='true'], [data-deck-menu], [data-deck-window-controls]"
      )
    )
      return false;
    return !!t.closest(
      "[data-deck-drag], .pywebview-drag-region, .wwwExplorer_windowTitleBar, .dh-cap-drag, #deck-host-caption"
    );
  }

  function armDragSelectGuard() {
    if (document.documentElement.getAttribute("data-deck-drag-guard") === "1") return;
    document.documentElement.setAttribute("data-deck-drag-guard", "1");
    document.addEventListener(
      "selectstart",
      function (e) {
        if (inDragBar(dragEventElement(e))) e.preventDefault();
      },
      true
    );
    document.addEventListener(
      "mousedown",
      function (e) {
        if (e.button !== 0) return;
        if (inDragBar(dragEventElement(e))) e.preventDefault();
      },
      true
    );
  }

  /**
   * ROM owns the top bar entirely. Host only:
   *  - fills [data-deck-window-controls] with min/max/close/…
   *  - wires [data-deck-menu] (e.g. chip logo) as the doors menu
   *  - drag on [data-deck-drag]
   * Does NOT invent a second caption, gem, or dark bar.
   */
  function tryIntegrateRomChrome() {
    var chrome = document.querySelector("[data-deck-chrome]");
    if (!chrome) return false;

    document.documentElement.classList.add(
      "deck-host-frameless",
      "deck-host-integrated"
    );
    if (chrome.classList.contains("wwwExplorer_chrome")) {
      document.documentElement.classList.add("deck-host-www-menu");
    }
    if (document.body) {
      document.body.classList.add("deck-host-frameless", "deck-host-integrated");
      if (chrome.classList.contains("wwwExplorer_chrome")) {
        document.body.classList.add("deck-host-www-menu");
      }
    }

    // Never inject #deck-host-caption — ROM chrome stays as-designed.
    // Drop a leftover host bar from an earlier inject (about:blank / race).
    chrome.setAttribute("data-deck-integrated", "1");
    var leftover = document.getElementById("deck-host-caption");
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);

    // Prefer whole chrome as drag root (companion rails need a big grab zone).
    // Interactive bits use -webkit-app-region:no-drag via injectIntegratedCss.
    var dragRoot =
      chrome.getAttribute("data-deck-drag-root") != null
        ? chrome
        : null;
    var drag =
      dragRoot ||
      chrome.querySelector("[data-deck-drag]") ||
      chrome.querySelector(".chrome-grip") ||
      chrome.querySelector(".chrome-meta");
    if (drag) {
      drag.classList.add("pywebview-drag-region");
      if (dragRoot) {
        // Also mark grip children so pywebview finds a region even if CSS fails
        var grips = chrome.querySelectorAll("[data-deck-drag], .chrome-grip, .chrome-meta");
        for (var gi = 0; gi < grips.length; gi++) {
          grips[gi].classList.add("pywebview-drag-region");
        }
      }
      if (!/drag/i.test(drag.title || "")) {
        drag.title = ((drag.title || "").trim() + " · drag to move").trim();
      }
      drag.addEventListener("dblclick", function (e) {
        if (
          e.target &&
          e.target.closest &&
          e.target.closest("button, a, input, select, [data-deck-menu], [data-deck-window-controls]")
        )
          return;
        e.preventDefault();
        runMaximize();
      });
    }

    var slot = chrome.querySelector("[data-deck-window-controls]");
    if (!slot) {
      slot = document.createElement("div");
      slot.setAttribute("data-deck-window-controls", "");
      chrome.appendChild(slot);
    }
    fillWindowControls(slot);

    // ROM's own chip/logo is the menu — do not inject a gem
    var menuBtn =
      chrome.querySelector("[data-deck-menu]") ||
      chrome.querySelector(".chip[data-deck-menu]") ||
      chrome.querySelector(".chip");
    if (menuBtn) {
      menuBtn.setAttribute("data-act", "menu");
      menuBtn.setAttribute("role", "button");
      menuBtn.setAttribute("aria-haspopup", "true");
      menuBtn.setAttribute("aria-expanded", "false");
      if (!menuBtn.id) menuBtn.id = "deck-host-mark";
      if (!menuBtn.title) menuBtn.title = "Menu";
      menuBtn.style.cursor = "pointer";
      menuBtn.addEventListener("mousedown", function (e) {
        e.stopPropagation();
      });
      menuBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      });
    }

    // In-flow ROM header — no body offset for a fixed host bar
    setCaptionHeightVar(0);
    injectIntegratedCss();
    armSurfaceDrags(true);
    armDragSelectGuard();
    applyZoom(readZoom());
    ensureHostMenu();
    wireGlobalKeys();
    return true;
  }

  function injectIntegratedCss() {
    if (document.getElementById("deck-host-integrated-css")) return;
    var style = document.createElement("style");
    style.id = "deck-host-integrated-css";
    // Minimal host CSS: only window-control strip + menu panel.
    // Does not restyle the ROM header / chip.
    style.textContent =
      "html.deck-host-integrated,html.deck-host-integrated body{" +
      "--deck-caption-h:0px!important;--pocket-caption-h:0px!important}" +
      /* WebView2 composites -webkit-app-region:drag as a black rectangle,
         often offset below the title bar. pywebview JS drag still works
         via .pywebview-drag-region mousedown. */
      "html.deck-host-frameless .pywebview-drag-region," +
      "html.deck-host-frameless [data-deck-drag]," +
      "html.deck-host-frameless .wwwExplorer_windowTitleBar," +
      "html.deck-host-frameless .dh-cap-drag{" +
      "-webkit-app-region:no-drag!important}" +
      "html.deck-host-integrated #deck-host-caption{" +
      "display:none!important;height:0!important;min-height:0!important;" +
      "padding:0!important;border:0!important;overflow:hidden!important}" +
      /* Whole ROM chrome draggable when marked data-deck-drag-root */
      "html.deck-host-integrated [data-deck-chrome][data-deck-drag-root]," +
      "html.deck-host-integrated [data-deck-chrome][data-deck-drag-root] *{" +
      "user-select:none!important;-webkit-user-select:none!important}" +
      "html.deck-host-integrated [data-deck-drag]," +
      "html.deck-host-integrated [data-deck-drag] *," +
      "html.deck-host-integrated [data-deck-chrome] [data-deck-drag]," +
      "html.deck-host-integrated [data-deck-chrome] .chrome-grip," +
      "html.deck-host-integrated [data-deck-chrome] .chrome-meta," +
      "html.deck-host-integrated [data-deck-chrome] .wwwExplorer_windowTitleBar," +
      "html.deck-host-integrated .pywebview-drag-region," +
      "html.deck-host-integrated .pywebview-drag-region *{" +
      "user-select:none!important;-webkit-user-select:none!important}" +
      "html.deck-host-integrated [data-deck-chrome] input," +
      "html.deck-host-integrated [data-deck-chrome] textarea{" +
      "user-select:text!important;-webkit-user-select:text!important}" +
      "html.deck-host-integrated [data-deck-drag] button," +
      "html.deck-host-integrated [data-deck-drag] a," +
      "html.deck-host-integrated [data-deck-drag] input," +
      "html.deck-host-integrated [data-deck-window-controls]," +
      "html.deck-host-integrated [data-deck-window-controls] *{" +
      "-webkit-app-region:no-drag}" +
      "html.deck-host-integrated [data-deck-menu]," +
      "html.deck-host-integrated [data-act=menu]," +
      "html.deck-host-integrated [data-deck-chrome] button," +
      "html.deck-host-integrated [data-deck-chrome] .pocket," +
      "html.deck-host-integrated .sheet-resize," +
      "html.deck-host-integrated #deck-host-resize," +
      "html.deck-host-integrated #deck-host-resize *{" +
      "-webkit-app-region:no-drag}" +
      "html.deck-host-integrated [data-deck-window-controls]{" +
      "display:flex;flex-shrink:0;align-items:stretch}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-cap-btn{" +
      "width:36px;border:0;background:transparent;color:inherit;" +
      "font-size:13px;cursor:pointer;line-height:32px;padding:0;opacity:0.72}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-cap-btn:hover{" +
      "opacity:1;background:rgba(0,0,0,.06)}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-cap-btn.close:hover{" +
      "background:#c42b1c;color:#fff;opacity:1}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-cap-btn svg{" +
      "display:block;width:16px;height:16px;margin:8px auto;fill:none;" +
      "stroke:currentColor;stroke-width:1.6}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-eye{" +
      "display:block;width:16px;height:16px;margin:8px auto}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-eye-shut{display:none}" +
      "html.deck-host-integrated [data-deck-window-controls] .deep-btn:hover .dh-eye-open{display:none}" +
      "html.deck-host-integrated [data-deck-window-controls] .deep-btn:hover .dh-eye-shut{display:block}" +
      /* Default: hide ROM chrome in deep. Stay-rail ROMs (Receiver) keep a slim logo+spawn bar. */
      "html.deck-host-integrated.deck-host-deep [data-deck-chrome]:not([data-deck-deep-stay]){" +
      "display:none!important}" +
      /* deep-stay: do NOT force display:flex — ROMs may use grid (Sophia rail).
         Hide rule only matches chrome without data-deck-deep-stay. */
      /* Deep mode: lock viewport so hint never expands body scroll under status */
      "html.deck-host-integrated.deck-host-deep," +
      "html.deck-host-integrated.deck-host-deep body{" +
      "overflow:hidden!important;height:100%!important;max-height:100%!important;" +
      "margin:0!important}" +
      /* Same fixed pill as injectCss — integrated path used to omit this (bug) */
      "#deck-host-deep-hint{" +
      "position:fixed!important;top:8px!important;bottom:auto!important;" +
      "left:50%!important;right:auto!important;" +
      "transform:translateX(-50%)!important;" +
      "z-index:2147483002!important;padding:6px 14px;" +
      "font:11px system-ui,sans-serif;letter-spacing:.06em;" +
      "text-transform:uppercase;cursor:pointer;" +
      "color:rgba(220,230,240,.85);background:rgba(10,12,18,.88);" +
      "border:1px solid rgba(120,140,200,.3);border-radius:999px;" +
      "transition:opacity .4s ease;pointer-events:auto;" +
      "max-width:min(90vw,420px);white-space:nowrap;overflow:hidden;" +
      "text-overflow:ellipsis}" +
      "#deck-host-deep-hint.is-fade{opacity:0!important;pointer-events:none!important}" +
      "#deck-host-deep-hint.is-gone{" +
      "opacity:0!important;pointer-events:none!important;" +
      "visibility:hidden!important;width:0!important;height:0!important;" +
      "padding:0!important;border:0!important;overflow:hidden!important}" +
      "#deck-host-deep-drag{" +
      "position:fixed!important;top:0!important;left:0!important;" +
      "z-index:2147483001;width:2.5rem;height:2.5rem;cursor:grab;" +
      "background:transparent}" +
      "#deck-host-deep-drag:active{cursor:grabbing}" +
      "html.deck-host-integrated #deck-host-menu{" +
      "top:36px;left:8px;min-width:min(200px,calc(100vw - 16px));" +
      "max-width:calc(100vw - 16px);z-index:2147483001;" +
      "position:fixed;margin:0;padding:6px 0;overflow:visible;" +
      "background:#e8edf2;border:1px solid #c5d0dc;color:#2a3540;" +
      "font:12px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      "html.deck-host-integrated #deck-host-menu button{" +
      "display:block;width:100%;text-align:left;border:0;background:transparent;" +
      "color:inherit;padding:8px 14px;cursor:pointer;font:inherit}" +
      "html.deck-host-integrated #deck-host-menu button:hover{background:rgba(90,138,176,.15)}" +
      "html.deck-host-integrated #deck-host-menu .dh-menu-sep{" +
      "height:1px;margin:6px 10px;background:#c5d0dc}" +
      "html.deck-host-integrated #deck-host-menu .dh-menu-hint{" +
      "padding:6px 14px 4px;font-size:10px;letter-spacing:.08em;" +
      "text-transform:uppercase;opacity:.5}" +
      "html.deck-host-integrated #deck-host-menu .dh-submenu{" +
      "position:absolute;left:100%;top:0;margin-left:-1px;min-width:10.5rem;" +
      "z-index:3;padding:6px 0;overflow:visible;" +
      "background:#e8edf2;border:1px solid #c5d0dc;color:#2a3540;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      "html.deck-host-integrated #deck-host-menu .dh-submenu.is-down{" +
      "position:relative;left:auto;right:auto;top:auto;margin:2px 8px 6px;" +
      "min-width:0;width:auto;box-shadow:none}" +
      "html.deck-host-integrated #deck-host-menu .dh-menu-folder," +
      "html.deck-host-www-menu #deck-host-menu .dh-menu-folder{" +
      "display:flex;align-items:center;justify-content:space-between;gap:12px}" +
      "html.deck-host-www-menu #deck-host-menu{" +
      "top:36px;left:5px;min-width:11.5rem;padding:3px;overflow:visible;" +
      "background:gray;color:#111;" +
      "font:11px 'JetBrains Mono','Courier New',Consolas,monospace;" +
      "border:1px solid rgba(0,0,0,.634);" +
      "box-shadow:inset -2px -2px 0 #00000033,inset 2px 2px 0 #ffffff66," +
      "1px 1px 0 #ffffff66,-1px -1px 0 #00000066}" +
      "html.deck-host-www-menu #deck-host-menu button{" +
      "padding:5px 14px;font:inherit;color:#111}" +
      "html.deck-host-www-menu #deck-host-menu button:hover," +
      "html.deck-host-www-menu #deck-host-menu button:focus{" +
      "background:#0000cd;color:#fff;outline:none}" +
      "html.deck-host-www-menu #deck-host-menu .dh-menu-sep{" +
      "height:2px;margin:3px 4px;background:transparent;" +
      "border-top:1px solid #808080;border-bottom:1px solid #fff}" +
      "html.deck-host-www-menu #deck-host-menu .dh-menu-hint{" +
      "padding:4px 14px 3px;font-size:10px;letter-spacing:.08em;" +
      "text-transform:uppercase;color:#404040;opacity:1}" +
      "html.deck-host-www-menu #deck-host-menu .dh-submenu{" +
      "position:absolute;left:100%;top:0;margin-left:-1px;min-width:10.5rem;" +
      "z-index:3;padding:3px;overflow:visible;background:gray;color:#111;" +
      "border:1px solid rgba(0,0,0,.634);" +
      "box-shadow:inset -2px -2px 0 #00000033,inset 2px 2px 0 #ffffff66," +
      "1px 1px 0 #ffffff66,-1px -1px 0 #00000066}" +
      "html.deck-host-www-menu #deck-host-menu .dh-submenu button{" +
      "padding:5px 14px;font:inherit;color:#111}" +
      "html.deck-host-www-menu #deck-host-menu .dh-submenu button:hover," +
      "html.deck-host-www-menu #deck-host-menu .dh-submenu button:focus{" +
      "background:#0000cd;color:#fff;outline:none}" +
      "html.deck-host-www-menu [data-deck-window-controls]{" +
      "gap:3px;align-items:center}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-cap-btn{" +
      "width:22px;height:20px;min-width:22px;padding:0;margin:0;line-height:18px;" +
      "opacity:1;color:#111;background:gray;" +
      "border:1px solid rgba(0,0,0,.634);" +
      "font:11px 'JetBrains Mono','Courier New',Consolas,monospace;" +
      "box-shadow:inset -1px -1px 0 #00000033,inset 1px 1px 0 #ffffff66," +
      "1px 1px 0 #ffffff66,-1px -1px 0 #00000066}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-cap-btn:hover{" +
      "opacity:1;background:#c0c0c0;color:#111}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-cap-btn:active{" +
      "box-shadow:inset 1px 1px 0 #00000033,inset -1px -1px 0 #ffffff66}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-cap-btn.close:hover{" +
      "background:gray;color:#111}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-cap-btn svg{" +
      "width:11px;height:11px;margin:3px auto;stroke:#111}" +
      "html.deck-host-www-menu [data-deck-window-controls] .dh-eye{" +
      "width:11px;height:11px;margin:3px auto;color:#111}";
    document.head.appendChild(style);
  }

  function ensureHostMenu() {
    if (document.getElementById("deck-host-menu")) return;
    var menu = document.createElement("div");
    menu.id = "deck-host-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    var hint = document.createElement("div");
    hint.className = "dh-menu-hint";
    hint.textContent = "DECK HOST";
    menu.appendChild(hint);
    fillMenuItems(menu);
    document.body.appendChild(menu);
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        if (!t) return;
        if (
          t.closest &&
          (t.closest("#deck-host-menu") ||
            t.closest("[data-act=menu]") ||
            t.closest("#deck-host-mark"))
        ) {
          return;
        }
        closeMenu();
      },
      true
    );
  }

  function wireGlobalKeys() {
    if (window.__deckHostMenuKeys) return;
    window.__deckHostMenuKeys = true;
    document.addEventListener(
      "keydown",
      function (e) {
        var key = e.key || "";
        var ctrl = e.ctrlKey || e.metaKey;
        if (
          (e.altKey && (key === "m" || key === "M")) ||
          (ctrl && (key === "k" || key === "K") && !e.shiftKey)
        ) {
          e.preventDefault();
          toggleMenu();
          return;
        }
        if (ctrl && (key === "n" || key === "N") && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          var aNew = api();
          if (aNew && aNew.new_window) {
            try {
              aNew.new_window();
            } catch (errN) {}
          }
          return;
        }
        if (key === "F11") {
          e.preventDefault();
          if (deepAllowed() || isDeep()) toggleDeep();
          return;
        }
        if (key === "Escape") {
          if (isDeep()) {
            e.preventDefault();
            setDeep(false);
            return;
          }
          closeMenu();
          return;
        }
        if (ctrl && (key === "=" || key === "+" || key === "Add")) {
          e.preventDefault();
          zoomBy(ZOOM_STEP);
          return;
        }
        if (ctrl && (key === "-" || key === "_" || key === "Subtract")) {
          e.preventDefault();
          zoomBy(-ZOOM_STEP);
          return;
        }
        if (ctrl && (key === "0" || key === "Digit0" || key === "Numpad0")) {
          e.preventDefault();
          applyZoom(1);
          return;
        }
      },
      true
    );
  }

  function run() {
    if (!document.body) {
      setTimeout(run, 30);
      return;
    }
    bindFramelessResize();

    // ROM header takeover (e.g. loreBOX .app-chrome)
    if (tryIntegrateRomChrome()) {
      return;
    }

    injectCss();
    setCaptionVar();
    applyZoom(readZoom());
    armDragSelectGuard();

    var existing = document.getElementById("deck-host-caption");
    if (existing) {
      var lab0 = existing.querySelector(".dh-cap-title");
      if (lab0) lab0.textContent = TITLE;
      setCaptionVar();
      applyZoom(readZoom());
      return;
    }

    var bar = document.createElement("div");
    bar.id = "deck-host-caption";

    // Left gem = doors menu (replaces hamburger)
    var mark = document.createElement("button");
    mark.type = "button";
    mark.id = "deck-host-mark";
    mark.className = "dh-cap-mark";
    mark.setAttribute("data-act", "menu");
    mark.setAttribute("aria-label", "Doors menu");
    mark.setAttribute("aria-haspopup", "true");
    mark.setAttribute("aria-expanded", "false");
    mark.title = "Menu";
    var gem = document.createElement("span");
    gem.className = "dh-cap-mark-gem";
    gem.setAttribute("aria-hidden", "true");
    mark.appendChild(gem);
    mark.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    mark.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    var drag = document.createElement("div");
    drag.className = "dh-cap-drag pywebview-drag-region";
    drag.title = "Drag to move · double-click maximize";

    var lab = document.createElement("span");
    lab.className = "dh-cap-title";
    lab.textContent = TITLE;

    var zoomLab = document.createElement("button");
    zoomLab.type = "button";
    zoomLab.className = "dh-cap-zoom";
    zoomLab.title = "Click → 100% · Ctrl± zoom · Ctrl+0 reset";
    zoomLab.textContent = Math.round(readZoom() * 100) + "%";
    zoomLab.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    zoomLab.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      applyZoom(1);
    });

    drag.appendChild(lab);
    drag.appendChild(zoomLab);

    // double-click drag strip → maximize (window), not deep
    drag.addEventListener("dblclick", function (e) {
      if (e.target && e.target.closest && e.target.closest(".dh-cap-zoom")) {
        return;
      }
      e.preventDefault();
      runMaximize();
    });

    var btns = document.createElement("div");
    fillWindowControls(btns);

    var menu = document.createElement("div");
    menu.id = "deck-host-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    var hint = document.createElement("div");
    hint.className = "dh-menu-hint";
    hint.textContent = "DECK HOST";
    menu.appendChild(hint);
    fillMenuItems(menu);

    bar.appendChild(mark);
    bar.appendChild(drag);
    bar.appendChild(btns);
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.appendChild(menu);

    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        if (!t) return;
        if (
          t.closest &&
          (t.closest("#deck-host-menu") ||
            t.closest("[data-act=menu]") ||
            t.closest("#deck-host-mark"))
        ) {
          return;
        }
        closeMenu();
      },
      true
    );

    if (!window.__deckHostMenuKeys) {
      window.__deckHostMenuKeys = true;
      document.addEventListener(
        "keydown",
        function (e) {
          var key = e.key || "";
          var ctrl = e.ctrlKey || e.metaKey;

          if (
            (e.altKey && (key === "m" || key === "M")) ||
            (ctrl && (key === "k" || key === "K") && !e.shiftKey)
          ) {
            e.preventDefault();
            toggleMenu();
            return;
          }

          // Ctrl+N — another pocket window
          if (ctrl && (key === "n" || key === "N") && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            var aNew = api();
            if (aNew && aNew.new_window) {
              try {
                aNew.new_window();
              } catch (errN) {}
            }
            return;
          }

          // F11 — go deep only when the ROM opted in (data-deck-controls includes deep)
          if (key === "F11") {
            e.preventDefault();
            if (deepAllowed() || isDeep()) toggleDeep();
            return;
          }

          if (key === "Escape") {
            if (isDeep()) {
              e.preventDefault();
              setDeep(false);
              return;
            }
            closeMenu();
            return;
          }

          // Zoom: Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0
          if (ctrl && (key === "=" || key === "+" || key === "Add")) {
            e.preventDefault();
            zoomBy(ZOOM_STEP);
            return;
          }
          if (ctrl && (key === "-" || key === "_" || key === "Subtract")) {
            e.preventDefault();
            zoomBy(-ZOOM_STEP);
            return;
          }
          if (ctrl && (key === "0" || key === "Digit0" || key === "Numpad0")) {
            e.preventDefault();
            applyZoom(1);
            return;
          }
        },
        true
      );
    }

    applyZoom(readZoom());
  }

  // expose for surfaces / debug
  window.deckHostZoom = function (z) {
    return applyZoom(typeof z === "number" ? z : readZoom());
  };
  window.deckHostDeep = function (on) {
    if (typeof on === "boolean") setDeep(on);
    else toggleDeep();
  };

  run();
})(
  typeof window.__DECK_CAPTION_TITLE === "string"
    ? window.__DECK_CAPTION_TITLE
    : "deck host",
  typeof window.__DECK_CAPTION_H === "number" ? window.__DECK_CAPTION_H : 36
);
