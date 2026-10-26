<#
  package.ps1 - arma el paquete portable e instalable de Strata Local Chat.

  Uso (desde la raiz del proyecto):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1 -WithData
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1 -WithEnv
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1 -SkipZip
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1 -OutDir "D:\paquetes"

  Que produce:
    dist\portable\StrataLocalChat\                            la carpeta para copiar
    dist\StrataLocalChat-<version>-win-x64-portable.zip        el zip para llevar

  El paquete trae dentro el runtime de Node (runtime\node.exe) y node_modules,
  asi que el PC de destino no necesita Node ni npm. Por defecto NO se llevan ni
  tu historial (database\) ni tu .env: eso es decision explicita con -WithData
  y -WithEnv.
#>
param(
  [switch]$WithData,
  [switch]$WithEnv,
  [switch]$SkipZip,
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Compress-Archive no debe inundar la consola con su barra

$root = Split-Path -Parent $PSScriptRoot
$name = 'StrataLocalChat'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$outRoot = if ($OutDir) { $OutDir } else { Join-Path $root 'dist' }
$stage = Join-Path $outRoot 'portable'
$pkg = Join-Path $stage $name
$zip = Join-Path $outRoot ($name + '-' + $version + '-win-x64-portable.zip')

function Invoke-RoboCopy {
  param($From, $To, [string[]]$Extra = @())
  if (-not (Test-Path $From)) { throw 'Falta el origen: ' + $From }
  $null = & robocopy $From $To /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 @Extra
  if ($LASTEXITCODE -ge 8) { throw 'robocopy (' + $LASTEXITCODE + ') copiando ' + $From }
}

function Get-FolderSizeMb($path) {
  $sum = (Get-ChildItem $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  return [math]::Round($sum / 1MB, 1)
}

# 1) Que Node se embebe: el mismo con el que se ha probado esta tanda.
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }
if (-not (Test-Path $nodeExe)) { throw 'No se ha encontrado node.exe que meter dentro del paquete.' }
$nodeInfo = & $nodeExe -p "process.version + ' ' + process.arch + ' abi' + process.versions.modules"

Write-Output ('== Empaquetando ' + $name + ' ' + $version + ' para Windows x64 ==')
Write-Output ('  Node embebido : ' + $nodeInfo)

# 2) Escenario limpio: un paquete viejo a medias es peor que ninguno.
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pkg | Out-Null

# 3) Codigo, utilidades y dependencias resueltas.
Invoke-RoboCopy -From (Join-Path $root 'src') -To (Join-Path $pkg 'src')
# Los arneses de esta casa no se llevan al PC de destino: son de desarrollo.
Invoke-RoboCopy -From (Join-Path $root 'tools') -To (Join-Path $pkg 'tools') -Extra @('/XF', 'install-check.ps1', 'package-check.ps1')
Invoke-RoboCopy -From (Join-Path $root 'node_modules') -To (Join-Path $pkg 'node_modules')
foreach ($file in @('package.json', 'package-lock.json', '.env.example', 'README.md')) {
  $src = Join-Path $root $file
  if (Test-Path $src) { Copy-Item $src (Join-Path $pkg $file) -Force }
}

# 4) El runtime dentro del paquete: tools\server.ps1 lo busca ahi antes que nada.
New-Item -ItemType Directory -Force -Path (Join-Path $pkg 'runtime') | Out-Null
Copy-Item $nodeExe (Join-Path $pkg 'runtime\node.exe') -Force

# 5) De SQLite solo hace falta el binario de win/x64: los demas son 11 MB de nada.
$prebuilds = Join-Path $pkg 'node_modules\better-sqlite3\prebuilds'
if (Test-Path $prebuilds) {
  Get-ChildItem $prebuilds -File | Where-Object { $_.Name -ne 'win32-x64.node' } | Remove-Item -Force
}

# 6) Arranques de doble clic e instrucciones, en la raiz del paquete.
Invoke-RoboCopy -From (Join-Path $root 'packaging') -To $pkg

# 7) Historial y configuracion de esta maquina: solo si se pide explicitamente.
if ($WithData) {
  New-Item -ItemType Directory -Force -Path (Join-Path $pkg 'database') | Out-Null
  foreach ($file in @('chat.db', 'chat.db-wal', 'chat.db-shm')) {
    $src = Join-Path $root ('database\' + $file)
    if (Test-Path $src) { Copy-Item $src (Join-Path $pkg ('database\' + $file)) -Force }
  }
  Write-Output '  historial    : INCLUIDO (ojo, son tus conversaciones)'
}
if ($WithEnv) {
  if (Test-Path (Join-Path $root '.env')) { Copy-Item (Join-Path $root '.env') (Join-Path $pkg '.env') -Force }
  Write-Output '  .env         : INCLUIDA'
}

# 8) El zip para llevar. Compress-Archive se rinde con rutas muy largas: si falla,
#    se usa tar.exe (viene con Windows 10+), que maneja rutas largas sin problema.
if (-not $SkipZip) {
  if (Test-Path $zip) { Remove-Item $zip -Force }
  $zipped = $false
  try {
    Compress-Archive -Path $pkg -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
    $zipped = $true
  } catch {
    Write-Output ('  aviso: Compress-Archive ha fallado (' + $_.Exception.Message + '), se prueba con tar.exe')
  }
  if (-not $zipped) {
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tar)) { throw 'Ni Compress-Archive ni tar.exe disponibles para crear el zip.' }
    $null = & $tar -a -cf $zip -C $stage $name
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip)) { throw 'tar.exe no ha podido crear el zip (' + $LASTEXITCODE + ').' }
  }
}

Write-Output ''
Write-Output ('  carpeta  : ' + $pkg + '   (' + (Get-FolderSizeMb $pkg) + ' MB)')
if (-not $SkipZip) {
  Write-Output ('  zip      : ' + $zip + '   (' + [math]::Round((Get-Item $zip).Length / 1MB, 1) + ' MB)')
}
Write-Output ''
Write-Output 'En el otro PC: descomprime y doble clic en Instalar.cmd.'
Write-Output '(o StrataChat.cmd para probarlo sin instalar nada)'
