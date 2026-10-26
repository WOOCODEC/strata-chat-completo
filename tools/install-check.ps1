$ErrorActionPreference = 'Stop'
# Invoke-WebRequest suelta su barra de progreso por la consola y ensucia la lectura
# del arnes: aqui solo interesan las lineas OK / FALLO.
$ProgressPreference = 'SilentlyContinue'
$repo = 'C:\Users\aleja\Desktop\StrataLocalChat'
$Ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$pkgName = 'StrataLocalChat'
$appName = 'Strata Local Chat'
$app = Join-Path $env:LOCALAPPDATA ('Programs\' + $pkgName)
$appMenu = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') $appName
$regKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $pkgName
$historial = Join-Path $env:LOCALAPPDATA ($pkgName + '-historial')
$port = 3125
$fail = 0

function Check($label, $ok, $extra) {
  $script:fail += $(if ($ok) { 0 } else { 1 })
  Write-Output $(($(if ($ok) { 'OK   ' } else { 'FALLO' })) + '  ' + $label + $(if ($extra) { '  -> ' + $extra } else { '' }))
}

function Lnk-Of($path) {
  if (-not (Test-Path $path)) { return $null }
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($path)
  return [pscustomobject]@{ target = $s.TargetPath; args = $s.Arguments; work = $s.WorkingDirectory }
}

function Llama-Install() {
  $salida = & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\install.ps1') 2>&1
  Write-Output '     --- salida de install.ps1 ---'
  $salida | ForEach-Object { Write-Output ('     ' + $_) }
}

function Llama-Uninstall($extra) {
  if ($extra) { return & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\uninstall.ps1') $extra 2>&1 }
  return & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\uninstall.ps1') 2>&1
}

Write-Output ('antes: instalado=' + (Test-Path $app) + '  accesos=' + (Test-Path $appMenu) + '  registro=' + (Test-Path $regKey) + '  historial=' + (Test-Path $historial))
if (Test-Path $app) { throw 'Ya habia una instalacion previa: hazle uninstall antes de pasar este arnes.' }

# --- 1) Instalar --------------------------------------------------------------
Llama-Install
Check 'carpeta de la aplicacion con su runtime' (Test-Path (Join-Path $app 'runtime\node.exe')) $app
Check 'trae el binario de SQLite de Windows' (Test-Path (Join-Path $app 'node_modules\better-sqlite3\prebuilds\win32-x64.node'))
Check 'los lanzadores quedan en la raiz de la aplicacion' ((Test-Path (Join-Path $app 'StrataChat.cmd')) -and (Test-Path (Join-Path $app 'Desinstalar.cmd')))
Check '.env creada desde .env.example' (Test-Path (Join-Path $app '.env'))
Check 'carpeta database\ lista' (Test-Path (Join-Path $app 'database'))

$abrir = Lnk-Of (Join-Path $appMenu ('Abrir ' + $appName + '.lnk'))
Check 'acceso "Abrir" en el Menu Inicio' ($abrir -and $abrir.args -match 'StrataChat\.cmd' -and $abrir.work -eq $app) ($(if ($abrir) { $abrir.target + ' ' + $abrir.args } else { 'no existe' }))
$parar = Lnk-Of (Join-Path $appMenu ('Parar ' + $appName + '.lnk'))
Check 'acceso "Parar" en el Menu Inicio' ($parar -and $parar.args -match 'StrataChat-parar\.cmd')
Check 'acceso "Estado del servidor"' (Test-Path (Join-Path $appMenu 'Estado del servidor.lnk'))
Check 'la carpeta de accesos se llama igual que el programa' (Test-Path $appMenu) $appMenu

$reg = Get-ItemProperty $regKey -ErrorAction SilentlyContinue
Check 'sale en "Quitar programas" con version y desinstalador' ($reg -and $reg.DisplayName -eq $appName -and $reg.UninstallString -match 'Desinstalar\.cmd' -and $reg.InstallLocation -eq $app) $(if ($reg) { $reg.DisplayName + ' ' + $reg.DisplayVersion } else { 'sin registro' })

# --- 2) Arrancar la copia instalada sin Node en el sistema --------------------
$env:PATH = 'C:\Windows\System32;C:\Windows'
$dbDir = Join-Path $env:TEMP 'strata-insttest'
if (Test-Path $dbDir) { Remove-Item $dbDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
$env:DB_PATH = Join-Path $dbDir 'chat.db'
$env:PORT = [string]$port
$null = & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'tools\server.ps1') -Start -Hidden -Port $port
$info = $null
for ($i = 0; $i -lt 30; $i++) {
  try { $info = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 4; break } catch { Start-Sleep -Milliseconds 400 }
}
Check 'arranca sin Node en el PATH' ($null -ne $info) $(if ($info) { 'revision ' + $info.server.revision } else { 'no contesto' })
if ($info) {
  $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
  $exe = [string](Get-Process -Id $owner -ErrorAction SilentlyContinue).Path
  Check 'suena el node.exe instalado en el perfil' ($exe.Replace('\', '/') -like ('*' + $app.Replace('\', '/') + '/runtime/node.exe')) $exe
  Check 'sigue escuchando solo en 127.0.0.1' ([string]$info.server.host -eq '127.0.0.1') ([string]$info.server.host)
  $pagina = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/') -UseBasicParsing -TimeoutSec 8
  Check 'la interfaz se sirve desde la instalacion' ($pagina.StatusCode -eq 200 -and $pagina.Content -match 'Strata') ($pagina.RawContentLength.ToString() + ' bytes')
}
$null = & $Ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'tools\server.ps1') -Stop -Port $port
Start-Sleep -Milliseconds 500
$sigue = $false
try { $null = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 3; $sigue = $true } catch { }
Check 'se para limpio' (-not $sigue)

# --- 3) Desinstalar con -Purge ------------------------------------------------
$salida = Llama-Uninstall '-Purge'
$salida | ForEach-Object { Write-Output ('     ' + $_) }
Check 'se ha quitado la carpeta de la aplicacion' (-not (Test-Path $app))
Check 'se han quitado los accesos del Menu Inicio' (-not (Test-Path $appMenu))
Check 'se ha quitado la entrada de "Quitar programas"' (-not (Test-Path $regKey))
Check 'no queda nada de la instalacion' (-not (Test-Path (Join-Path $app 'runtime\node.exe')))

# --- 4) Desinstalar SIN purge: el historial tiene que sobrevivir --------------
Llama-Install
$dbInstalled = Join-Path $app 'database'
if (-not (Test-Path $dbInstalled)) { New-Item -ItemType Directory -Force -Path $dbInstalled | Out-Null }
Set-Content -Path (Join-Path $dbInstalled 'chat.db') -Value 'HISTORIAL-DE-PRUEBA' -Encoding UTF8
$salida = Llama-Uninstall
$salida | ForEach-Object { Write-Output ('     ' + $_) }
Check 'la aplicacion se ha quitado otra vez' (-not (Test-Path $app))
$backupDb = Join-Path (Join-Path $historial (Get-Date -Format 'yyyy-MM-dd')) 'database\chat.db'
Check 'el historial se ha respaldado al quitar' (Test-Path $backupDb) $backupDb
$esNuestroRespaldo = (Test-Path $backupDb) -and ((Get-Content $backupDb -Raw) -match 'HISTORIAL-DE-PRUEBA')
Check 'el respaldo conserva el contenido tal cual' $esNuestroRespaldo
if ($esNuestroRespaldo) {
  Remove-Item (Join-Path $historial (Get-Date -Format 'yyyy-MM-dd')) -Recurse -Force
}
if ((Test-Path $historial) -and -not (Get-ChildItem $historial -Force)) { Remove-Item $historial -Force }
Check 'el arnes no deja rastros de prueba' (-not (Test-Path (Join-Path $historial (Get-Date -Format 'yyyy-MM-dd'))))

Write-Output ''
Write-Output ('despues: instalado=' + (Test-Path $app) + '  accesos=' + (Test-Path $appMenu) + '  registro=' + (Test-Path $regKey) + '  historial=' + (Test-Path $historial))
Write-Output ''
Write-Output $(if ($fail -eq 0) { 'ARNES DE INSTALACION: 0 fallos' } else { 'ARNES DE INSTALACION: ' + $fail + ' fallos' })
if ($fail) { exit 1 }
