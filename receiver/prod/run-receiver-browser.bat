@echo off
cd /d "%~dp0\recv_sys"
start "" http://127.0.0.1:43200/
python server.py
if errorlevel 1 pause
