/**
 * Frameless pocket caption — injected after each page load.
 * Under document.body so pywebview drag sees .pywebview-drag-region.
 *
 * Zoom: Ctrl+= / Ctrl+- / Ctrl+0  (page zoom, persisted)
 * Deep: F11 or doors “Go deep” — hide caption, full surface; Esc / F11 exit
 * Doors: left gem mark · Alt+M / Ctrl+K
 * New window: Ctrl+N
 */
(function (title, heightPx) {
  var TITLE = title || "mypi";
  var H = heightPx || 36;
  var ZOOM_MIN = 0.75;
  var ZOOM_MAX = 1.75;
  var ZOOM_STEP = 0.1;
  var LS_ZOOM = "mypi-pocket-zoom";
  var LS_DEEP = "mypi-pocket-deep";

  // Surfaces only (title → logical home). Terminal is core start; rest leave the station.
  // Zoom / deep / size live on the caption chrome — not repeated here.
  var DOORS = [
    { label: "Terminal", path: null, action: "home" },
    { sep: true },
    { label: "WWW", path: "www/danyi/index" },
    { label: "Starline", path: "starline/news/headlines" },
    { label: "Book", path: "book/terminal_girls/oriel" },
    { label: "Mythleak", path: "mythleak/news/headlines" },
    { label: "Mailroom", path: "mailroom/floor/sort" },
    { sep: true },
    { label: "Hard refresh", action: "hard_refresh" },
    { label: "Reload", action: "reload" },
    { label: "Back", action: "back" },
    { label: "Forward", action: "forward" },
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
    document.documentElement.style.setProperty("--mypi-page-zoom", String(z));
    document.documentElement.style.zoom = String(z);
    writeZoom(z);
    var lab = document.querySelector("#mypi-pocket-caption .mypi-cap-zoom");
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
    var btn = document.querySelector("#mypi-pocket-caption [data-act=step_size]");
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
    var lab = document.querySelector("#mypi-pocket-caption .mypi-cap-zoom");
    if (!lab) return;
    lab.textContent = String(s).replace("x", "×");
    lab.classList.add("is-flash");
    setTimeout(function () {
      lab.classList.remove("is-flash");
      lab.textContent = Math.round(readZoom() * 100) + "%";
    }, 900);
  }

  function isDeep() {
    return document.documentElement.classList.contains("mypi-pocket-deep");
  }

  function setCaptionHeightVar(px) {
    var v = px + "px";
    document.documentElement.style.setProperty("--pocket-caption-h", v);
    if (document.body) document.body.style.setProperty("--pocket-caption-h", v);
  }

  function armSurfaceDrags(on) {
    // Surfaces may mark [data-pocket-drag] (e.g. terminal .tm-rail-brand).
    // Ensure pywebview-drag-region class is present for frameless move.
    try {
      var nodes = document.querySelectorAll("[data-pocket-drag]");
      for (var i = 0; i < nodes.length; i++) {
        if (on) nodes[i].classList.add("pywebview-drag-region");
        // leave class on when exiting deep — still fine while caption exists
        else nodes[i].classList.add("pywebview-drag-region");
      }
    } catch (e) {}
  }

  function setDeep(on) {
    var root = document.documentElement;
    var bar = document.getElementById("mypi-pocket-caption");
    var menu = document.getElementById("mypi-pocket-menu");
    if (on) {
      root.classList.add("mypi-pocket-deep");
      if (document.body) document.body.classList.add("mypi-pocket-deep");
      if (bar) bar.hidden = true;
      if (menu) menu.hidden = true;
      setCaptionHeightVar(0);
      armSurfaceDrags(true);
      try {
        localStorage.setItem(LS_DEEP, "1");
      } catch (e) {}
      ensureDeepHint(true);
    } else {
      root.classList.remove("mypi-pocket-deep");
      if (document.body) document.body.classList.remove("mypi-pocket-deep");
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
    var el = document.getElementById("mypi-pocket-deep-hint");
    var drag = document.getElementById("mypi-pocket-deep-drag");
    if (!show) {
      if (el) el.remove();
      if (drag) drag.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "mypi-pocket-deep-hint";
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
    var hasSurface = document.querySelector("[data-pocket-drag]");
    if (!hasSurface && !drag) {
      drag = document.createElement("div");
      drag.id = "mypi-pocket-deep-drag";
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
    document.documentElement.classList.add("mypi-pocket-frameless");
    if (document.body) document.body.classList.add("mypi-pocket-frameless");
  }

  function runDoor(item) {
    var a = api();
    if (item.action === "home") {
      if (a && a.home) a.home();
      else if (a && a.go) a.go("terminal/base/login");
      else location.assign("http://b/terminal/base/login");
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
      else location.assign("http://b/" + item.path.replace(/^\//, ""));
    }
  }

  function syncMenuMark() {
    var m = document.getElementById("mypi-pocket-menu");
    var mark = document.getElementById("mypi-pocket-mark");
    if (!mark) return;
    var open = m && !m.hidden;
    mark.classList.toggle("is-open", !!open);
    mark.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeMenu() {
    var m = document.getElementById("mypi-pocket-menu");
    if (m) m.hidden = true;
    syncMenuMark();
  }

  function toggleMenu() {
    var m = document.getElementById("mypi-pocket-menu");
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
    if (document.getElementById("mypi-pocket-caption-css")) return;
    var style = document.createElement("style");
    style.id = "mypi-pocket-caption-css";
    style.textContent =
      "html.mypi-pocket-frameless,html.mypi-pocket-frameless body{" +
      "--pocket-caption-h:" +
      H +
      "px !important;" +
      "--mypi-page-zoom:1}" +
      "html.mypi-pocket-frameless.mypi-pocket-deep," +
      "html.mypi-pocket-frameless.mypi-pocket-deep body{" +
      "--pocket-caption-h:0px !important;" +
      "margin:0!important;padding:0!important}" +
      "html.mypi-pocket-frameless.mypi-pocket-deep #mypi-pocket-caption{" +
      "display:none!important;height:0!important;min-height:0!important;" +
      "overflow:hidden!important;border:0!important;padding:0!important;" +
      "pointer-events:none!important}" +
      "#mypi-pocket-caption{" +
      "position:fixed;top:0;left:0;right:0;height:" +
      H +
      "px;z-index:2147483000;" +
      "display:flex;align-items:stretch;" +
      "font-family:system-ui,Segoe UI,sans-serif;font-size:12px;" +
      "color:#d8dee8;background:#0a0c12;" +
      "border-bottom:1px solid rgba(120,140,200,.35);" +
      "box-shadow:0 2px 12px rgba(0,0,0,.45);" +
      "user-select:none;-webkit-user-select:none}" +
      "#mypi-pocket-caption[hidden]{display:none!important;height:0!important;min-height:0!important;border:0!important}" +
      "#mypi-pocket-caption .mypi-cap-drag{" +
      "flex:1;display:flex;align-items:center;gap:8px;" +
      "padding:0 10px;min-width:0;cursor:grab}" +
      "#mypi-pocket-caption .mypi-cap-drag:active{cursor:grabbing}" +
      "#mypi-pocket-caption .mypi-cap-mark{" +
      "flex-shrink:0;width:" +
      H +
      "px;height:" +
      H +
      "px;margin:0;padding:0;border:0;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "background:transparent}" +
      "#mypi-pocket-caption .mypi-cap-mark:hover{background:rgba(255,255,255,.08)}" +
      "#mypi-pocket-caption .mypi-cap-mark.is-open{background:rgba(106,140,255,.18)}" +
      "#mypi-pocket-caption .mypi-cap-mark-gem{" +
      "display:block;width:9px;height:9px;pointer-events:none;" +
      "background:linear-gradient(135deg,#6a8cff,#a070ff);" +
      "box-shadow:0 0 10px rgba(100,130,255,.5)}" +
      "#mypi-pocket-caption .mypi-cap-title{" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "letter-spacing:.04em;opacity:.95;flex:1;min-width:0}" +
      "#mypi-pocket-caption .mypi-cap-zoom{" +
      "flex-shrink:0;font:inherit;font-size:11px;font-weight:500;" +
      "letter-spacing:.04em;color:inherit;opacity:.72;" +
      "min-width:2.4em;text-align:right;cursor:pointer;" +
      "padding:0 8px 0 4px;margin:0;border:0;background:transparent;" +
      "border-radius:0;line-height:" +
      H +
      "px}" +
      "#mypi-pocket-caption .mypi-cap-zoom:hover{opacity:1;background:transparent}" +
      "#mypi-pocket-caption .mypi-cap-zoom.is-flash{opacity:1}" +
      "#mypi-pocket-caption .mypi-cap-btns{display:flex;flex-shrink:0;align-items:stretch}" +
      "#mypi-pocket-caption .mypi-cap-btn{" +
      "width:36px;border:0;background:transparent;color:inherit;" +
      "font-size:13px;cursor:pointer;line-height:" +
      H +
      "px;padding:0}" +
      "#mypi-pocket-caption .mypi-cap-btn:hover{background:rgba(255,255,255,.1)}" +
      "#mypi-pocket-caption .mypi-cap-btn.close:hover{background:#c42b1c;color:#fff}" +
      "#mypi-pocket-caption .mypi-cap-btn.mag-btn{width:36px;font-size:15px;letter-spacing:0}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn{width:36px;line-height:1}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn .mypi-eye{display:block;width:18px;height:18px;margin:0 auto}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn .mypi-eye-shut{display:none}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn:hover .mypi-eye-open{display:none}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn:hover .mypi-eye-shut{display:block}" +
      "#mypi-pocket-caption .mypi-cap-btn.deep-btn svg," +
      "#mypi-pocket-caption .mypi-cap-btn.max-btn svg{" +
      "display:block;width:18px;height:18px;margin:0 auto;fill:none;" +
      "stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}" +
      "#mypi-pocket-caption .mypi-cap-btn.max-btn{width:36px;line-height:1}" +

      "#mypi-pocket-menu{" +
      "position:fixed;top:" +
      H +
      "px;left:0;min-width:220px;max-width:min(320px,90vw);" +
      "z-index:2147483001;margin:0;padding:6px 0;" +
      "background:#12151e;border:1px solid rgba(120,140,200,.3);" +
      "border-top:none;box-shadow:0 12px 32px rgba(0,0,0,.55);" +
      "font-family:system-ui,Segoe UI,sans-serif;font-size:13px;color:#e4e8f0}" +
      "#mypi-pocket-menu[hidden]{display:none!important}" +
      "#mypi-pocket-menu button{" +
      "display:block;width:100%;text-align:left;border:0;background:transparent;" +
      "color:inherit;padding:8px 14px;cursor:pointer;font:inherit}" +
      "#mypi-pocket-menu button:hover,#mypi-pocket-menu button:focus{" +
      "background:rgba(106,140,255,.18);outline:none}" +
      "#mypi-pocket-menu .mypi-menu-sep{" +
      "height:1px;margin:6px 10px;background:rgba(120,140,200,.2)}" +
      "#mypi-pocket-menu .mypi-menu-hint{" +
      "padding:6px 14px 4px;font-size:10px;letter-spacing:.08em;" +
      "text-transform:uppercase;opacity:.45}" +
      "#mypi-pocket-deep-hint{" +
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);" +
      "z-index:2147483002;padding:6px 14px;font:11px system-ui,sans-serif;" +
      "letter-spacing:.06em;text-transform:uppercase;cursor:pointer;" +
      "color:rgba(220,230,240,.75);background:rgba(10,12,18,.82);" +
      "border:1px solid rgba(120,140,200,.25);border-radius:999px;" +
      "transition:opacity .4s ease}" +
      "#mypi-pocket-deep-hint.is-dim{opacity:.22}" +
      "#mypi-pocket-deep-hint:hover{opacity:1!important}" +
      /* fallback corner grabber if surface has no data-pocket-drag */
      "#mypi-pocket-deep-drag{" +
      "position:fixed;top:0;left:0;z-index:2147483001;" +
      "width:2.5rem;height:2.5rem;cursor:grab;" +
      "background:transparent}" +
      "#mypi-pocket-deep-drag:active{cursor:grabbing}";
    document.head.appendChild(style);
  }

  function run() {
    if (!document.body) {
      setTimeout(run, 30);
      return;
    }

    injectCss();
    setCaptionVar();
    applyZoom(readZoom());

    var existing = document.getElementById("mypi-pocket-caption");
    if (existing) {
      var lab0 = existing.querySelector(".mypi-cap-title");
      if (lab0) lab0.textContent = TITLE;
      setCaptionVar();
      applyZoom(readZoom());
      try {
        if (localStorage.getItem(LS_DEEP) === "1") setDeep(true);
      } catch (e) {}
      return;
    }

    var bar = document.createElement("div");
    bar.id = "mypi-pocket-caption";

    // Left gem = doors menu (replaces hamburger)
    var mark = document.createElement("button");
    mark.type = "button";
    mark.id = "mypi-pocket-mark";
    mark.className = "mypi-cap-mark";
    mark.setAttribute("data-act", "menu");
    mark.setAttribute("aria-label", "Doors menu");
    mark.setAttribute("aria-haspopup", "true");
    mark.setAttribute("aria-expanded", "false");
    mark.title = "Menu";
    var gem = document.createElement("span");
    gem.className = "mypi-cap-mark-gem";
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
    drag.className = "mypi-cap-drag pywebview-drag-region";
    drag.title = "Drag to move · double-click maximize";

    var lab = document.createElement("span");
    lab.className = "mypi-cap-title";
    lab.textContent = TITLE;

    var zoomLab = document.createElement("button");
    zoomLab.type = "button";
    zoomLab.className = "mypi-cap-zoom";
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
      if (e.target && e.target.closest && e.target.closest(".mypi-cap-zoom")) {
        return;
      }
      e.preventDefault();
      var a = api();
      if (a && a.toggle_maximize) a.toggle_maximize();
    });

    var btns = document.createElement("div");
    btns.className = "mypi-cap-btns";

    function mkBtn(act, label, title, extraClass) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mypi-cap-btn" + (extraClass ? " " + extraClass : "");
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
      '<span class="mypi-eye mypi-eye-open" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24">' +
      '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/>' +
      '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>' +
      "</svg></span>" +
      '<span class="mypi-eye mypi-eye-shut" aria-hidden="true">' +
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
    menu.id = "mypi-pocket-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    var hint = document.createElement("div");
    hint.className = "mypi-menu-hint";
    hint.textContent = "POCKET BROWSER";
    menu.appendChild(hint);

    DOORS.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement("div");
        sep.className = "mypi-menu-sep";
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
          (t.closest("#mypi-pocket-menu") ||
            t.closest("[data-act=menu]") ||
            t.closest("#mypi-pocket-mark"))
        ) {
          return;
        }
        closeMenu();
      },
      true
    );

    if (!window.__mypiMenuKeys) {
      window.__mypiMenuKeys = true;
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
  window.mypiPocketZoom = function (z) {
    return applyZoom(typeof z === "number" ? z : readZoom());
  };
  window.mypiPocketDeep = function (on) {
    if (typeof on === "boolean") setDeep(on);
    else toggleDeep();
  };

  run();
})(
  typeof window.__MYPI_CAPTION_TITLE === "string"
    ? window.__MYPI_CAPTION_TITLE
    : "mypi",
  typeof window.__MYPI_CAPTION_H === "number" ? window.__MYPI_CAPTION_H : 36
);
