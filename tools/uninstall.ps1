<#
  uninstall.ps1 - quita la instalacion hecha por tools\install.ps1.

  Uso (doble clic en Desinstalar.cmd, o a mano):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall.ps1
    ... -Purge                 borra tambien el historial (chat.db)
    ... -Target "D:\Otro"      desinstala una carpeta concreta

  Por defecto CONSERVA los datos: copia database\ y .env a
    %LOCALAPPDATA%\StrataLocalChat-historial\<fecha>\
  y despues borra la carpeta del programa. asi un despiste no te deja sin chats.
#>
param(
  [switch]$Purge,
  [string]$Target = ''
)

$ErrorActionPreference = 'Stop'

$pkgName = 'StrataLocalChat'
$appName = 'Strata Local Chat'
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($text) { Write-Output ('  - ' + $text) }

# Donde esta instalado: lo que se pase, lo que diga el registro, o el sitio por defecto.
$target = $Target
if (-not $target) {
  $reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $pkgName
  if (Test-Path $reg) { $target = [string](Get-ItemProperty -Path $reg -Name 'InstallLocation' -ErrorAction SilentlyContinue).InstallLocation }
}
if (-not $target) { $target = Join-Path $env:LOCALAPPDATA ('Programs\' + $pkgName) }
$target = $target.TrimEnd('\')

Write-Output ('== Desinstalando ' + $appName + ' ==')
Write-Output ('  carpeta: ' + $target)
if (-not (Test-Path $target)) {
  Write-Output '  no existe esa carpeta: no hay nada que desinstalar.'
  return
}

# 1) Parar el servidor antes de borrar nada.
if (Test-Path (Join-Path $target 'tools\server.ps1')) {
  $null = & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'tools\server.ps1') -Stop
  Write-Step 'servidor parado'
}

# 2) Accesos del Menu Inicio y de arranque automatico.
$shell = New-Object -ComObject WScript.Shell
$appMenu = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') $appName
if (Test-Path $appMenu) { Remove-Item $appMenu -Recurse -Force; Write-Step 'accesos del Menu Inicio quitados' }
foreach ($name in @($appName, ($pkgName + '.lnk'))) {
  $path = Join-Path ([Environment]::GetFolderPath('Startup')) $name
  if ($path.EndsWith('.lnk') -and (Test-Path $path)) { Remove-Item $path -Force; Write-Step 'arranque automatico quitado' }
  elseif (-not $path.EndsWith('.lnk') -and (Test-Path ($path + '.lnk'))) { Remove-Item ($path + '.lnk') -Force; Write-Step 'arranque automatico quitado' }
}

# 3) Registro de "Agregar o quitar programas".
$reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $pkgName
if (Test-Path $reg) { Remove-Item $reg -Force; Write-Step 'entrada de "Quitar programas" borrada' }

# 4) Datos: respaldo y despues borrado, o purge total si se pide.
if ($Purge) {
  Remove-Item $target -Recurse -Force
  Write-Step 'carpeta borrada ENTERA, incluido el historial (has pedido -Purge)'
  Write-Output ''
  Write-Output 'Desinstalado y sin dejar rastro.'
  return
}

$stamp = Get-Date -Format 'yyyy-MM-dd'
$backup = Join-Path (Join-Path $env:LOCALAPPDATA ($pkgName + '-historial')) $stamp
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($item in @('database', '.env')) {
  $src = Join-Path $target $item
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $backup $item) -Recurse -Force
    Write-Step ($item + ' guardado en el respaldo')
  }
}
Remove-Item $target -Recurse -Force
Write-Step 'programa borrado'
Write-Output ''
Write-Output 'Desinstalado. Tu historial esta en: ' + $backup
Write-Output ('Para volver: instala de nuevo y copia chat.db en ' + '<carpeta>\database\')
