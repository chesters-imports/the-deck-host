@echo off
cd /d "%~dp0"
start "" /B pythonw run-in-deck-host.py 2>nul
if errorlevel 1 (
  python run-in-deck-host.py
  if errorlevel 1 pause
)
