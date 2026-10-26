@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Desinstala la aplicacion. Por defecto CONSERVA el historial: copia
rem database\ y .env a %LOCALAPPDATA%\StrataLocalChat-historial\<fecha>.
rem Para borrarlo todo:  Desinstalar.cmd -Purge
powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall.ps1 %*
pause
