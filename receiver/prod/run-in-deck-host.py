#!/usr/bin/env python3
"""Receiver → Deck Host (host island · screen take-over)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROD = Path(__file__).resolve().parent
SYS = PROD / "recv_sys"
# prod → parents[0]=receiver · parents[1]=the-deck-host · parents[2]=ALICE_BOX
DECK = PROD.parents[1] / "shell" / "deck_host.py"
PORT = os.environ.get("RECEIVER_PORT", "43200")
URL = f"http://127.0.0.1:{PORT}/"
HEALTH = f"http://127.0.0.1:{PORT}/api/health"


def main() -> int:
    if not (SYS / "server.py").is_file():
        print("server missing", file=sys.stderr)
        return 1
    if not DECK.is_file():
        print(f"Deck Host missing: {DECK}", file=sys.stderr)
        return 1
    # Land at origin + maximize (or true fullscreen if RECEIVER_FULLSCREEN=1)
    os.environ.setdefault("DECK_HOST_WINDOW_MODE", "maximized")
    if os.environ.get("RECEIVER_FULLSCREEN", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        os.environ["DECK_HOST_FULLSCREEN"] = "1"
    cmd = [
        sys.executable,
        str(DECK),
        "--title",
        "Receiver",
        "--profile",
        "desk",
        "--window-mode",
        os.environ.get("DECK_HOST_WINDOW_MODE", "maximized"),
        "--url",
        URL,
        "--health",
        HEALTH,
        "--spawn",
        f"{sys.executable} server.py",
        "--spawn-cwd",
        str(SYS),
    ]
    print("Receiver · the-deck-host/receiver · CO.RECV-001")
    print(f"  url: {URL}")
    print(f"  mode: {os.environ.get('DECK_HOST_WINDOW_MODE', 'maximized')}")
    if os.environ.get("DECK_HOST_FULLSCREEN"):
        print("  fullscreen: on")
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
