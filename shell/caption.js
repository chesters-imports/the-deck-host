/**
 * Frameless The Deck Host caption — injected after each page load.
 * Under document.body so pywebview drag sees .pywebview-drag-region.
 *
 * Zoom: Ctrl+= / Ctrl+- / Ctrl+0  (page zoom, persisted)
 * Deep: F11 or doors “Go deep” — hide caption, full surface; Esc / F11 exit
 * Doors: left gem mark · Alt+M / Ctrl+K
 * New window: Ctrl+N
 */
(function (title, heightPx) {
  var TITLE = title || "deck host";
  var H = heightPx || 36;
  var ZOOM_MIN = 0.75;
  var ZOOM_MAX = 1.75;
  var ZOOM_STEP = 0.1;
  var LS_ZOOM = "deck-host-zoom";
  var LS_DEEP = "deck-host-deep";

  // Host chrome only — ROM navigation is the loaded surface's job
  var DOORS = [
    { label: "Home", path: null, action: "home" },
    { sep: true },
    { label: "Hard refresh", action: "hard_refresh" },
    { label: "Reload", action: "reload" },
    { label: "Back", action: "back" },
    { label: "Forward", action: "forward" },
    { sep: true },
    { label: "New window", action: "new_window" },
  ];

  function api() {
    return window.pywebview && window.pywebview.api;
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
    document.documentElement.style.zoom = String(z);
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

  function setMagIcon(sizeStr) {
    var btn = document.querySelector("#deck-host-caption [data-act=step_size]");
    if (!btn) return;
    // 1600 = large → show “contract”; else “expand” (arrows out / in)
    var large = sizeStr && /1600/.test(String(sizeStr));
    btn.textContent = large ? "⤡" : "⤢";
    btn.title = large
      ? "Window · contract to 1024×768"
      : "Window · expand to 1600×1200";
  }

  function flashSizeHint(s) {
    if (!s) return;
    setMagIcon(s);
    var lab = document.querySelector("#deck-host-caption .dh-cap-zoom");
    if (!lab) return;
    lab.textContent = String(s).replace("x", "×");
    lab.classList.add("is-flash");
    setTimeout(function () {
      lab.classList.remove("is-flash");
      lab.textContent = Math.round(readZoom() * 100) + "%";
    }, 900);
  }

  function isDeep() {
    return document.documentElement.classList.contains("deck-host-deep");
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
    var bar = document.getElementById("deck-host-caption");
    var menu = document.getElementById("deck-host-menu");
    if (on) {
      root.classList.add("deck-host-deep");
      if (document.body) document.body.classList.add("deck-host-deep");
      if (bar) bar.hidden = true;
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
      if (bar) bar.hidden = false;
      setCaptionHeightVar(H);
      armSurfaceDrags(false);
      try {
        localStorage.removeItem(LS_DEEP);
      } catch (e) {}
      ensureDeepHint(false);
    }
  }

  function toggleDeep() {
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
      setTimeout(function () {
        if (el && el.parentNode) el.classList.add("is-dim");
      }, 2200);
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
    if (item.action === "home") {
      if (a && a.home) a.home();
      else location.reload();
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
    if (m) m.hidden = true;
    syncMenuMark();
  }

  function toggleMenu() {
    var m = document.getElementById("deck-host-menu");
    if (!m) return;
    // if deep, surface first so menu has a home
    if (isDeep()) setDeep(false);
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
      "user-select:none;-webkit-user-select:none}" +
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
      "z-index:2147483001;margin:0;padding:6px 0;" +
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
      "#deck-host-deep-hint{" +
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);" +
      "z-index:2147483002;padding:6px 14px;font:11px system-ui,sans-serif;" +
      "letter-spacing:.06em;text-transform:uppercase;cursor:pointer;" +
      "color:rgba(220,230,240,.75);background:rgba(10,12,18,.82);" +
      "border:1px solid rgba(120,140,200,.25);border-radius:999px;" +
      "transition:opacity .4s ease}" +
      "#deck-host-deep-hint.is-dim{opacity:.22}" +
      "#deck-host-deep-hint:hover{opacity:1!important}" +
      /* fallback corner grabber if surface has no data-deck-drag */
      "#deck-host-deep-drag{" +
      "position:fixed;top:0;left:0;z-index:2147483001;" +
      "width:2.5rem;height:2.5rem;cursor:grab;" +
      "background:transparent}" +
      "#deck-host-deep-drag:active{cursor:grabbing}";
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
      if (act === "max" && a.toggle_maximize) a.toggle_maximize();
      if (act === "close" && a.close) a.close();
    });
    return b;
  }

  function fillWindowControls(slot) {
    if (!slot || slot.getAttribute("data-deck-filled") === "1") return;
    slot.setAttribute("data-deck-filled", "1");
    slot.classList.add("dh-cap-btns");

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
    slot.appendChild(mkWinBtn("step_size", "⤢", "Window · expand to 1600×1200", "mag-btn"));
    slot.appendChild(mkWinBtn("min", "─", "Minimize"));
    var maxBtn = mkWinBtn("max", "", "Maximize window", "max-btn");
    maxBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="5" y="5" width="14" height="14" rx="1.2"/>' +
      "</svg>";
    slot.appendChild(maxBtn);
    slot.appendChild(mkWinBtn("close", "✕", "Close", "close"));
  }

  /**
   * ROM owns the top bar: [data-deck-chrome] is the caption.
   * Window controls land in [data-deck-window-controls] (created if missing).
   */
  function tryIntegrateRomChrome() {
    var chrome =
      document.querySelector("[data-deck-chrome]") ||
      document.querySelector("header.app-chrome");
    if (!chrome) return false;

    document.documentElement.classList.add(
      "deck-host-frameless",
      "deck-host-integrated"
    );
    if (document.body) {
      document.body.classList.add("deck-host-frameless", "deck-host-integrated");
    }

    // In-flow header = caption; no extra fixed bar, no double padding
    if (!chrome.id) chrome.id = "deck-host-caption";
    chrome.setAttribute("data-deck-integrated", "1");

    var drag =
      chrome.querySelector("[data-deck-drag]") ||
      chrome.querySelector(".chrome-meta") ||
      chrome;
    drag.classList.add("pywebview-drag-region");
    drag.title = (drag.title || "") + " · drag to move";

    drag.addEventListener("dblclick", function (e) {
      if (e.target && e.target.closest && e.target.closest("button, a, input, select"))
        return;
      e.preventDefault();
      var a = api();
      if (a && a.toggle_maximize) a.toggle_maximize();
    });

    var slot = chrome.querySelector("[data-deck-window-controls]");
    if (!slot) {
      slot = document.createElement("div");
      slot.setAttribute("data-deck-window-controls", "");
      chrome.appendChild(slot);
    }
    fillWindowControls(slot);

    // optional gem menu on ROM chrome
    if (!document.getElementById("deck-host-mark") && !chrome.querySelector("[data-act=menu]")) {
      var mark = document.createElement("button");
      mark.type = "button";
      mark.id = "deck-host-mark";
      mark.className = "dh-cap-mark";
      mark.setAttribute("data-act", "menu");
      mark.setAttribute("aria-label", "Host menu");
      mark.title = "Menu";
      var gem = document.createElement("span");
      gem.className = "dh-cap-mark-gem";
      mark.appendChild(gem);
      mark.addEventListener("mousedown", function (e) {
        e.stopPropagation();
      });
      mark.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      });
      chrome.insertBefore(mark, chrome.firstChild);
    }

    setCaptionHeightVar(0);
    injectCss();
    injectIntegratedCss();
    applyZoom(readZoom());
    ensureHostMenu();
    wireGlobalKeys();
    return true;
  }

  function injectIntegratedCss() {
    if (document.getElementById("deck-host-integrated-css")) return;
    var style = document.createElement("style");
    style.id = "deck-host-integrated-css";
    style.textContent =
      "html.deck-host-integrated,html.deck-host-integrated body{" +
      "--deck-caption-h:0px!important;--pocket-caption-h:0px!important}" +
      "html.deck-host-integrated #deck-host-caption[data-deck-integrated]," +
      "html.deck-host-integrated [data-deck-chrome]{" +
      "position:relative;z-index:100;" +
      "-webkit-app-region:drag}" +
      "html.deck-host-integrated [data-deck-chrome] button," +
      "html.deck-host-integrated [data-deck-chrome] a," +
      "html.deck-host-integrated [data-deck-chrome] input," +
      "html.deck-host-integrated [data-deck-chrome] select," +
      "html.deck-host-integrated [data-deck-window-controls]," +
      "html.deck-host-integrated [data-deck-window-controls] *{" +
      "-webkit-app-region:no-drag}" +
      "html.deck-host-integrated [data-deck-window-controls]{" +
      "display:flex;flex-shrink:0;align-items:stretch;margin-left:auto}" +
      "html.deck-host-integrated [data-deck-window-controls] .dh-cap-btn{" +
      "width:36px;border:0;background:transparent;color:inherit;" +
      "font-size:13px;cursor:pointer;line-height:32px;padding:0;opacity:0.75}" +
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
      "html.deck-host-integrated.deck-host-deep [data-deck-chrome]{display:none!important}" +
      "html.deck-host-integrated .dh-cap-mark{" +
      "flex-shrink:0;width:28px;height:28px;margin:0;padding:0;border:0;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;background:transparent;" +
      "border-radius:4px}" +
      "html.deck-host-integrated .dh-cap-mark:hover{background:rgba(0,0,0,.06)}" +
      "html.deck-host-integrated .dh-cap-mark-gem{" +
      "display:block;width:8px;height:8px;" +
      "background:linear-gradient(135deg,#5a8ab0,#7ab0d0);" +
      "box-shadow:0 0 6px rgba(90,138,176,.4)}" +
      "html.deck-host-integrated #deck-host-menu{" +
      "top:36px;left:0;min-width:200px;z-index:2147483001;" +
      "position:fixed;margin:0;padding:6px 0;" +
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
      "text-transform:uppercase;opacity:.5}";
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
    DOORS.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement("div");
        sep.className = "dh-menu-sep";
        menu.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = item.label;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        closeMenu();
        runDoor(item);
      });
      menu.appendChild(b);
    });
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
          toggleDeep();
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

    // ROM header takeover (e.g. loreBOX .app-chrome)
    if (tryIntegrateRomChrome()) {
      try {
        if (localStorage.getItem(LS_DEEP) === "1") setDeep(true);
      } catch (e0) {}
      return;
    }

    injectCss();
    setCaptionVar();
    applyZoom(readZoom());

    var existing = document.getElementById("deck-host-caption");
    if (existing) {
      var lab0 = existing.querySelector(".dh-cap-title");
      if (lab0) lab0.textContent = TITLE;
      setCaptionVar();
      applyZoom(readZoom());
      try {
        if (localStorage.getItem(LS_DEEP) === "1") setDeep(true);
      } catch (e) {}
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
      var a = api();
      if (a && a.toggle_maximize) a.toggle_maximize();
    });

    var btns = document.createElement("div");
    btns.className = "dh-cap-btns";

    function mkBtn(act, label, title, extraClass) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dh-cap-btn" + (extraClass ? " " + extraClass : "");
      b.setAttribute("data-act", act);
      b.title = title;
      b.textContent = label;
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
        if (act === "max" && a.toggle_maximize) a.toggle_maximize();
        if (act === "close" && a.close) a.close();
      });
      return b;
    }

    // deep (eye) · expand · min · max · close  — expand sits next to minimize
    var deepBtn = mkBtn("deep", "", "Go deep · hide chrome · F11", "deep-btn");
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
    btns.appendChild(deepBtn);
    btns.appendChild(
      mkBtn("step_size", "⤢", "Window · expand to 1600×1200", "mag-btn")
    );
    btns.appendChild(mkBtn("min", "─", "Minimize"));
    // maximize: full-weight square (matches eye stroke), not tiny □ glyph
    var maxBtn = mkBtn("max", "", "Maximize window", "max-btn");
    maxBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="5" y="5" width="14" height="14" rx="1.2"/>' +
      "</svg>";
    btns.appendChild(maxBtn);
    btns.appendChild(mkBtn("close", "✕", "Close", "close"));

    var menu = document.createElement("div");
    menu.id = "deck-host-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    var hint = document.createElement("div");
    hint.className = "dh-menu-hint";
    hint.textContent = "DECK HOST";
    menu.appendChild(hint);

    DOORS.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement("div");
        sep.className = "dh-menu-sep";
        menu.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = item.label;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        closeMenu();
        runDoor(item);
      });
      menu.appendChild(b);
    });

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

          // F11 — go deep / surface (page immersive, keeps our chrome control)
          if (key === "F11") {
            e.preventDefault();
            toggleDeep();
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

    // restore deep if left deep last time (optional — can surprise; only if flag set)
    try {
      if (localStorage.getItem(LS_DEEP) === "1") setDeep(true);
    } catch (e2) {}

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
