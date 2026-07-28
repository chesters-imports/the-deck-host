#!/usr/bin/env python3
"""ROM Launcher — primary Deck Host face"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROD = Path(__file__).resolve().parent
SYS = PROD / "launch_sys"
# rom-launcher/prod → the-deck-host → ALICE_BOX; deck_host is sibling of rom-launcher
DECK = PROD.parents[1] / "shell" / "deck_host.py"
PORT = os.environ.get("LAUNCHER_PORT", "43170")
URL = f"http://127.0.0.1:{PORT}/"
HEALTH = f"http://127.0.0.1:{PORT}/api/health"


def main() -> int:
    if not (SYS / "server.py").is_file():
        print("server missing", file=sys.stderr)
        return 1
    if not DECK.is_file():
        print(f"Deck Host missing: {DECK}", file=sys.stderr)
        return 1
    # Rail/companion strip — tiny carts want a vertical start bar, not a full desk
    profile = os.environ.get("LAUNCHER_PROFILE", "rail").strip() or "rail"
    # Rail: wide enough that 2 teeny carts tile (not one lonely column)
    # cart ~5.5rem + gaps + padding ≈ 220–260px minimum; 300 sits two-up clean
    w = os.environ.get(
        "LAUNCHER_WIDTH",
        "300" if profile in ("rail", "companion") else "960",
    )
    h = os.environ.get(
        "LAUNCHER_HEIGHT",
        "800" if profile in ("rail", "companion") else "700",
    )
    cmd = [
        sys.executable,
        str(DECK),
        "--title",
        "LAUNCH",
        "--profile",
        profile,
        "--width",
        str(w),
        "--height",
        str(h),
        "--url",
        URL,
        "--health",
        HEALTH,
        "--health-timeout",
        "20",
        "--spawn",
        f"{sys.executable} server.py",
        "--spawn-cwd",
        str(SYS),
    ]
    print("ROM Launcher · CO.HOST-001-LAUNCH · Deck Host")
    # When launched from a .bat, still try to hide this parent console's children via host
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
