<#
  install.ps1 - instala el paquete portable en este PC como un programa normal.

  Uso (doble clic en Instalar.cmd, o a mano desde la raiz del paquete):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\install.ps1
    ... -Target "D:\Apps\StrataLocalChat"   otra carpeta de destino
    ... -Source "D:\bajar\StrataLocalChat"  de donde copiar (el paquete ya generado)
    ... -AutoStart                          arranque automatico al encender el PC
    ... -NoShortcuts                        no tocar el Menu Inicio

  Que hace, por orden:
    1. Para el servidor que estuviera sonando desde el destino anterior.
    2. Copia el paquete a %LOCALAPPDATA%\Programs\StrataLocalChat (por defecto)
       dejando INTACTOS database\ y .env: al reinstalar no se pierde historial.
    3. Crea .env a partir de .env.example si no existia.
    4. Genera app.ico desde src\public\favicon.png para los accesos.
    5. Accesos reales en el Menu Inicio y, si habia uno viejo que solo abria la
       carpeta, lo quita.
    6. Entrada en "Agregar o quitar programas" con su desinstalador.
#>
param(
  [string]$Source = '',
  [string]$Target = '',
  [switch]$AutoStart,
  [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'

$appName = 'Strata Local Chat'
$pkgName = 'StrataLocalChat'
$repoRoot = Split-Path -Parent $PSScriptRoot

# De donde se copia: el zip descomprimido ya trae el runtime en su propia carpeta;
# si se llama desde el repositorio de desarrollo se usa el paquete que genero
# tools\package.ps1 en dist\portable\StrataLocalChat.
$candidatos = @()
if ($Source) { $candidatos += [IO.Path]::GetFullPath($Source) }
$candidatos += (Join-Path $repoRoot ('dist\portable\' + $pkgName))
$candidatos += $repoRoot
$pkgRoot = $null
foreach ($candidato in $candidatos) {
  if (Test-Path (Join-Path $candidato 'runtime\node.exe')) { $pkgRoot = $candidato; break }
}

$version = '0.0.0'
try { $version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version } catch { }
$target = if ($Target) { [IO.Path]::GetFullPath($Target) } else { Join-Path $env:LOCALAPPDATA ('Programs\' + $pkgName) }

function Write-Step($text) { Write-Output ('  - ' + $text) }

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# El puerto que va a usar la instalacion: el que diga el .env de destino, si lo dice.
function Read-Port($dir) {
  $envFile = Join-Path $dir '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*PORT\s*=\s*([0-9]+)') { return [int]$matches[1] }
    }
  }
  return 3000
}

if (-not $pkgRoot) {
  throw 'No hay paquete con runtime de Node. Genera antes el paquete con tools\package.ps1, o indica su carpeta con -Source "carpeta-del-paquete".'
}
if ($pkgRoot.TrimEnd('\') -ieq $target.TrimEnd('\')) {
  throw 'No te instales encima del propio paquete: usa -Target otra carpeta.'
}

Write-Output ('== Instalando ' + $appName + ' ' + $version + ' ==')
Write-Output ('  destino: ' + $target)

# 1) Parar lo que estuviera sonando desde el destino previo (si ya estaba instalado).
if (Test-Path (Join-Path $target 'tools\server.ps1')) {
  $null = & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'tools\server.ps1') -Stop
  Write-Step 'servidor anterior parado antes de copiar'
}

# 2) Copia espejo protegiendo historial, configuracion y los lanzadores del paquete.
New-Item -ItemType Directory -Force -Path $target | Out-Null
$null = & robocopy $pkgRoot $target /E /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 `
  /XD (Join-Path $pkgRoot 'database') (Join-Path $target 'database') (Join-Path $pkgRoot 'packaging') (Join-Path $target 'packaging') `
  /XF '.env'
if ($LASTEXITCODE -ge 8) { throw 'La copia ha fallado (robocopy ' + $LASTEXITCODE + ').' }
if (-not (Test-Path (Join-Path $target 'runtime\node.exe'))) { throw 'No ha quedado el runtime de Node en el destino.' }
if (-not (Test-Path (Join-Path $target 'node_modules\better-sqlite3\prebuilds\win32-x64.node'))) {
  throw 'Falta el binario de SQLite para Windows x64 en el destino.'
}
Write-Step 'programa copiado (historial y .env conservados)'

# 3) Configuracion de primera arrancada.
if (-not (Test-Path (Join-Path $target '.env'))) {
  Copy-Item (Join-Path $target '.env.example') (Join-Path $target '.env')
  Write-Step '.env creada copiando .env.example (revisa STRATA_MODEL y PORT si hace falta)'
} else {
  Write-Step '.env existente conservada'
}
if (-not (Test-Path (Join-Path $target 'database'))) {
  New-Item -ItemType Directory -Force -Path (Join-Path $target 'database') | Out-Null
  Write-Step 'carpeta database\ creada (ahi se guarda chat.db)'
}

$puerto = Read-Port $target

# 4) Icono propio a partir del favicon de la interfaz (64x64).
$icon = ''
try {
  Add-Type -AssemblyName System.Drawing
  $png = Join-Path $target 'src\public\favicon.png'
  $icoPath = Join-Path $target 'app.ico'
  if (Test-Path $png) {
    $bmp = New-Object System.Drawing.Bitmap($png)
    $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $stream = [IO.File]::Create($icoPath)
    $ico.Save($stream)
    $stream.Close()
    $bmp.Dispose()
    $icon = $icoPath
  }
} catch {
  $icon = ''
  Write-Step 'aviso: no se ha podido generar app.ico; los accesos salen con icono generico'
}

$shell = New-Object -ComObject WScript.Shell

function New-Link {
  param($folder, $title, $targetExe, $arguments, $style, $description)
  $link = $shell.CreateShortcut((Join-Path $folder ($title + '.lnk')))
  $link.TargetPath = $targetExe
  $link.Arguments = $arguments
  $link.WorkingDirectory = $target
  if ($icon) { $link.IconLocation = $icon + ',0' } else { $link.IconLocation = 'shell32.dll,13' }
  $link.WindowStyle = $style
  $link.Description = $description
  $link.Save()
}

if (-not $NoShortcuts) {
  # 5) Accesos del Menu Inicio.
  $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $appMenu = Join-Path $menu $appName
  New-Item -ItemType Directory -Force -Path $appMenu | Out-Null

  # El acceso que habia en su dia apuntaba a la carpeta del proyecto: abria el
  # explorador, no la aplicacion. Se quita solo si apuntaba a una carpeta.
  $stale = Join-Path $menu ($pkgName + '.lnk')
  if (Test-Path $stale) {
    $probe = $shell.CreateShortcut($stale)
    if (Test-Path $probe.TargetPath -PathType Container) {
      Remove-Item $stale -Force
      Write-Step 'quitado el acceso viejo del Menu Inicio (abria la carpeta, no el chat)'
    }
  }

  $cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
  New-Link $appMenu ('Abrir ' + $appName) $cmd ('/c ""' + (Join-Path $target 'StrataChat.cmd') + '"') 7 ('Abre el chat en http://127.0.0.1:' + $puerto)
  New-Link $appMenu ('Parar ' + $appName) $cmd ('/c ""' + (Join-Path $target 'StrataChat-parar.cmd') + '"') 7 'Para el servidor local'
  New-Link $appMenu 'Estado del servidor' $cmd ('/c ""' + (Join-Path $target 'StrataChat-estado.cmd') + '"') 1 'Quien escucha y si Strata es alcanzable'
  Write-Step ('accesos creados en: ' + $appMenu)

  # 6) Arranque automatico, solo si se pide. Sigue escuchando solo en 127.0.0.1.
  if ($AutoStart) {
    $startup = [Environment]::GetFolderPath('Startup')
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    New-Link $startup $appName $ps ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $target 'tools\server.ps1') + '" -Start -Hidden') 7 'Arranca el chat local al iniciar sesion'
    Write-Step ('arranque automatico anadido en: ' + $startup)
  }
}

# 7) Registro para "Agregar o quitar programas".
$reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $pkgName
$null = New-Item -Force -Path $reg
Set-ItemProperty -Path $reg -Name 'DisplayName' -Value $appName
Set-ItemProperty -Path $reg -Name 'DisplayVersion' -Value $version
Set-ItemProperty -Path $reg -Name 'Publisher' -Value 'chat 100 por 100 local, sin nubes'
Set-ItemProperty -Path $reg -Name 'InstallLocation' -Value $target
Set-ItemProperty -Path $reg -Name 'InstallDate' -Value (Get-Date -Format 'yyyyMMdd')
Set-ItemProperty -Path $reg -Name 'UninstallString' -Value ('"' + (Join-Path $target 'Desinstalar.cmd') + '"')
if ($icon) { Set-ItemProperty -Path $reg -Name 'DisplayIcon' -Value ($icon + ',0') } else { Set-ItemProperty -Path $reg -Name 'DisplayIcon' -Value (Join-Path $target 'StrataChat.cmd') }
Set-ItemProperty -Path $reg -Name 'NoModify' -Type DWord -Value 1
Set-ItemProperty -Path $reg -Name 'NoRepair' -Type DWord -Value 1
Write-Step 'registrado en "Agregar o quitar programas"'

Write-Output ''
Write-Output ('Instalado. Para abrirlo: Menu Inicio > ' + $appName + ' > Abrir ' + $appName)
Write-Output ('o doble clic en ' + (Join-Path $target 'StrataChat.cmd'))
Write-Output ('El chat estara en http://127.0.0.1:' + $puerto + ' (solo accesible desde este PC).')

