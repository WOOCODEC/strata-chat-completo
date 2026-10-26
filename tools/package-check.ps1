$ErrorActionPreference = 'Stop'
# Invoke-WebRequest suelta su barra de progreso por la consola y ensucia la lectura
# del arnes: aqui solo interesan las lineas OK / FALLO.
$ProgressPreference = 'SilentlyContinue'
$pkg = 'C:\Users\aleja\Desktop\StrataLocalChat\dist\portable\StrataLocalChat'
$port = 3123
$fail = 0

function Check($label, $ok, $extra) {
  $script:fail += $(if ($ok) { 0 } else { 1 })
  Write-Output $(($(if ($ok) { 'OK   ' } else { 'FALLO' })) + '  ' + $label + $(if ($extra) { '  -> ' + $extra } else { '' }))
}

# El paquete tiene que llevar el codigo y los scripts de la tanda actual, no los de
# una tanda anterior (el error clasico es empaquetar antes de corregir).
$repo = 'C:\Users\aleja\Desktop\StrataLocalChat'
foreach ($gemelo in @('tools\server.ps1', 'tools\install.ps1', 'tools\uninstall.ps1', 'tools\package.ps1', 'src\server.js', 'src\dbService.js', 'src\public\script.js')) {
  $a = Join-Path $repo $gemelo
  $b = Join-Path $pkg $gemelo
  $igual = (Test-Path $a) -and (Test-Path $b) -and ((Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash)
  Check ('el paquete lleva ' + $gemelo + ' sin cambios respecto al repo') $igual
}
Check 'el paquete no se lleva los arneses de desarrollo' (-not (Test-Path (Join-Path $pkg 'tools\install-check.ps1')))
Check 'el paquete no trae historial ni .env de esta maquina' (-not (Test-Path (Join-Path $pkg '.env')))

# PC simulado sin Node: solo el PATH de Windows.
$env:PATH = 'C:\Windows\System32;C:\Windows'
Check 'el PC de prueba no tiene node en el PATH' ($(Get-Command node -ErrorAction SilentlyContinue) -eq $null)

# Lo que hubiera dentro de database/ antes de la prueba se respeta; lo que aparezca
# por culpa de la prueba se borra, para que el paquete quede tal y como se empaqueto.
$dbInside = Join-Path $pkg 'database'
$previas = @()
if (Test-Path $dbInside) {
  $previas = @(Get-ChildItem $dbInside -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
}
$dbDir = Join-Path $env:TEMP 'strata-pkgtest'
if (Test-Path $dbDir) { Remove-Item $dbDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
$env:DB_PATH = Join-Path $dbDir 'chat.db'
$env:PORT = [string]$port

# Arranque tal y como lo haria el acceso del Menu Inicio.
$Ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$null = & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'tools\server.ps1') -Start -Hidden -Port $port

$info = $null
for ($i = 0; $i -lt 30; $i++) {
  try { $info = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 4; break } catch { Start-Sleep -Milliseconds 400 }
}
Check 'el puerto ' + $port + ' responde por el runtime embebido' ($null -ne $info) $(if ($info) { 'revision ' + $info.server.revision } else { 'no contesto' })

if ($info) {
  $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
  $exe = (Get-Process -Id $owner -ErrorAction SilentlyContinue).Path
  Check 'el proceso que suena es el node.exe del paquete' ($exe -and $exe.Replace('\', '/') -like '*dist/portable/StrataLocalChat/runtime/node.exe') $exe
  Check 'el host del servidor es 127.0.0.1 (no se expone a la red)' ([string]$info.server.host -eq '127.0.0.1') ([string]$info.server.host)
  Check 'SQLite esta en la ruta pedida' ($info.db -and $info.db.path -like '*strata-pkgtest*') $(if ($info.db) { [string]$info.db.path } else { 'sin datos de bd' })
}

$page = (Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/') -UseBasicParsing -TimeoutSec 8)
Check 'la portada se sirve' ($page.StatusCode -eq 200) ($page.RawContentLength.ToString() + ' bytes')
Check 'la portada es la interfaz del chat' ($page.Content -match 'Strata') 'buscador Strata en el HTML'

$chats = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/chats') -TimeoutSec 8
Check 'la API de SQLite arranca (historial limpio de prueba)' ($chats.ok -eq $true) $(if ($chats.chats) { 'chats: ' + $chats.chats.Count } else { 'sin chats' })

$null = & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'tools\server.ps1') -Stop -Port $port
Start-Sleep -Milliseconds 600
$up = $false
try { $null = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 3; $up = $true } catch { }
Check 'la parada limpia funciona' (-not $up)

# El paquete tiene que quedar limpio de restos de la prueba.
if (Test-Path $dbInside) {
  foreach ($item in Get-ChildItem $dbInside -Force) {
    if ($previas -notcontains $item.Name) { Remove-Item $item.FullName -Recurse -Force }
  }
  if (-not (Get-ChildItem $dbInside -Force)) { Remove-Item $dbInside -Force }
}
Check 'el paquete no ha quedado con base de datos de prueba' (-not (Test-Path (Join-Path $dbInside 'chat.db')))

Write-Output ''
Write-Output $(if ($fail -eq 0) { 'ARNES DEL PAQUETE: 0 fallos' } else { 'ARNES DEL PAQUETE: ' + $fail + ' fallos' })
if ($fail) { exit 1 }
