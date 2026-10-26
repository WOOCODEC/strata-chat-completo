@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Parada limpia: cierra el servidor de este paquete, incluidos los procesos
rem huerfanos de tandas anteriores que tengan ocupado el puerto.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\server.ps1 -Stop
pause
