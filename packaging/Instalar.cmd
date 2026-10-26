@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Instala el chat como un programa de este usuario:
rem   destino por defecto  %LOCALAPPDATA%\Programs\StrataLocalChat
rem   accesos del Menu Inicio + entrada en "Quitar programas"
rem Opciones:  Instalar.cmd -Target "D:\Apps\StrataLocalChat"
rem            Instalar.cmd -AutoStart
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install.ps1 %*
pause
