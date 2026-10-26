@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js en el PATH.
  echo Instalalo o revisa que exista "%NODE_DIR%\node.exe"
  pause
  exit /b 1
)

echo Iniciando el chat local...

rem Se delega en tools\server.ps1, que pasa a ser el unico modo de arrancar.
rem Antes este fichero abria la pestana ANTES de que el servidor escuchase y
rem ademas lanzaba node a ciegas: si el puerto 3000 lo ocupaba un servidor de una
rem tanda anterior, node moria con EADDRINUSE y el navegador se quedaba mostrando
rem la interfaz vieja (encajonada a la izquierda, con una franja negra enorme a la
rem derecha). server.ps1 espera a que el puerto responda, para y relanza el
rem servidor si el codigo en disco es mas nuevo que el proceso que suena, y solo
rem entonces abre la pestana.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\server.ps1 -Start -Open
if errorlevel 1 (
  echo El servidor no ha arrancado. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo El servidor sigue sonando en segundo plano (su pid queda en database\server.pid).
echo Para pararlo:  npm run stop   (o tools\server.ps1 -Stop)
echo La pestana se abre a ANCHO COMPLETO (ancho=completo en la direccion) y SIN la
echo barra de medidas abajo: la interfaz va limpia. El diagnostico sigue ahi para
echo cuando haga falta: abre la direccion con ?medida=1 al final, o lanza
echo   tools\server.ps1 -Start -Open -Medida
echo Si vieras franja libre a la derecha, se quita con:
echo   boton "Ancho comodo"   - de la cabecera; vuelve a usar el 100%%
echo   boton "Detalles"       - el panel derecho es lo que ocupa ese hueco
echo   ?panel=oculto          - en la direccion, cierra el panel al abrir
echo.
echo Esta ventana se cierra sola en 8 segundos. Cerrarla NO para el servidor: el
echo proceso va desvinculado de aqui, sin ventana, y su salida queda en
echo   database\server.log        (lo que dice el servidor)
echo   database\server-error.log  (si algo falla; la arrancada anterior: .old)
echo Para pararlo:  npm run stop   (o tools\server.ps1 -Stop)
timeout /t 8 /nobreak >nul
exit /b 0
