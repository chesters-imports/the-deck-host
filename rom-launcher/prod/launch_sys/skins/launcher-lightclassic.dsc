/**
 * launcher-lightclassic.dsc
 * Shell skin only — does not paint cartridge plastic (rom-cart-face.css).
 * Loaded on top of Base (app.css) when Shell → Light classic.
 */
html[data-launcher-shell="lightclassic"] {
  --void: #efe6d4;
  --ink: #2a2218;
  --dim: #6e6458;
  --line: #c4b49a;
  --glow: #6a4228;
}

html[data-launcher-shell="lightclassic"],
html[data-launcher-shell="lightclassic"] body.rl {
  color: var(--ink);
  background: var(--void);
  background-image:
    linear-gradient(180deg, #f7f0e4 0%, var(--void) 42%);
}

html[data-launcher-shell="lightclassic"] * {
  scrollbar-color: #b89a72 #e8dcc8;
}

html[data-launcher-shell="lightclassic"] *::-webkit-scrollbar-track {
  background: #e8dcc8;
  border-left: 1px solid var(--line);
}

html[data-launcher-shell="lightclassic"] *::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #d4c4a8 0%, #b89a72 100%);
  border: 1px solid #9a8060;
}

html[data-launcher-shell="lightclassic"] *::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #c4a070 0%, #8a6038 100%);
}

html[data-launcher-shell="lightclassic"] *::-webkit-scrollbar-corner {
  background: #e8dcc8;
}

html[data-launcher-shell="lightclassic"] .rl-chrome {
  background: #e6dcc8;
  border-bottom: 1px solid var(--line);
}

html[data-launcher-shell="lightclassic"] .rl-chip {
  color: var(--glow);
}

html[data-launcher-shell="lightclassic"] .rl-title {
  font-family: "Special Elite", var(--mono);
  letter-spacing: 0.08em;
  color: var(--glow);
}

html[data-launcher-shell="lightclassic"].deck-host-deep .rl-title,
html[data-launcher-shell="lightclassic"] body.deck-host-deep .rl-title {
  text-shadow: 0 0 8px rgba(106, 66, 40, 0.28);
}

html[data-launcher-shell="lightclassic"] .rl-refresh,
html[data-launcher-shell="lightclassic"] .rl-unstick {
  background: #f4ead8;
  border-color: var(--line);
  color: var(--dim);
}

html[data-launcher-shell="lightclassic"] .rl-refresh:hover {
  border-color: var(--glow);
  color: var(--ink);
}

html[data-launcher-shell="lightclassic"] .rl-unstick:hover {
  border-color: #8a5030;
  color: #5a3018;
}

html[data-launcher-shell="lightclassic"] .rl-maker-h {
  background: linear-gradient(
    180deg,
    var(--void) 0%,
    var(--void) 78%,
    rgba(239, 230, 212, 0)
  );
}

html[data-launcher-shell="lightclassic"] .rl-foot {
  background: #e6dcc8;
  border-top-color: var(--line);
}

html[data-launcher-shell="lightclassic"] .rl-toast {
  background: #f4ead8;
  border-color: var(--glow);
  color: var(--ink);
  box-shadow: 0 8px 24px rgba(80, 50, 20, 0.18);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu {
  background: #f4ead8;
  border-color: var(--line);
  color: var(--ink);
  box-shadow: 0 10px 22px rgba(80, 50, 20, 0.12);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu button:hover,
html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu button:focus {
  background: color-mix(in srgb, var(--glow) 16%, #f7f0e4);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu .dh-menu-hint {
  color: var(--glow);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu .dh-submenu,
html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl #deck-host-menu .dh-submenu.is-down {
  background: #efe6d4;
  border-color: var(--line);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl [data-deck-window-controls] .dh-cap-btn {
  color: var(--ink);
}

html[data-launcher-shell="lightclassic"].deck-host-integrated body.rl [data-deck-window-controls] .dh-cap-btn:hover {
  background: color-mix(in srgb, var(--glow) 14%, #f4ead8);
}
