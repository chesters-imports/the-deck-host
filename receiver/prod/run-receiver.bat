@echo off
cd /d "%~dp0"
python run-in-deck-host.py
if errorlevel 1 pause
