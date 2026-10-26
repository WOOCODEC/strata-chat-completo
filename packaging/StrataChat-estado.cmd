@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Dice quien escucha, con que revision de API y si Strata esta alcanzable.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\server.ps1 -Status
pause
