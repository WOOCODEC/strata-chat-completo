@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Arranca el chat con el Node que trae el propio paquete (runtime\node.exe),
rem asi que en este ordenador no hace falta instalar Node ni npm.
rem tools\server.ps1 espera a que el puerto responda y solo entonces abre la pestana.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\server.ps1 -Start -Open
if errorlevel 1 (
  echo El servidor no ha arrancado. Revisa el mensaje de arriba.
  pause
)
