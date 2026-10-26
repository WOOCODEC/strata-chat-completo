<#
  Arranque y cierre comodos del servidor de Strata Local Chat.

  Uso (desde la raiz del proyecto):
    npm run start:open      -> levanta el servidor y abre la pestana
    npm run serve           -> dice si esta sonando y que version de API tiene
    npm run stop            -> lo para (aunque no tenga el fichero .pid)
    powershell -File tools\server.ps1 -Start -Open
    powershell -File tools\server.ps1 -Start -Hidden   (sin ventana, para el automatico)
    powershell -File tools\server.ps1 -Stop
    powershell -File tools\server.ps1 -Status

  El proceso se guarda en database\server.pid. -Stop ademas busca por linea de
  comando cualquier node que este sonando con src\server.js, asi que tambien
  limpia los servidores huerfanos de tandas anteriores (el tipico caso: el puerto
  3000 lo tiene un proceso viejo y la interfaz no se entera de los cambios).

  Con -Start, si el puerto lo ocupa un servidor de ESTE proyecto mas viejo que el
  codigo que hay en el disco, se para y se relanza solo. Asi la pestana que se
  abre muestra siempre la version nueva: ver la interfaz encajonada a la
  izquierda con una franja negra a la derecha era justamente estar mirando el
  proceso de una tanda anterior. Con -Open la pestana se abre cuando el puerto ya
  responde, nunca antes. start-strata-chat.cmd se limita a llamar a este script.
#>

param(
  [switch]$Start,
  [switch]$Stop,
  [switch]$Status,
  [switch]$Open,
  # -Medida abre la pestana con la barra de diagnostico abajo (?medida=1). Es
  # opcional: por defecto la interfaz se abre LIMPIA, sin barra de medidas.
  [switch]$Medida,
  # -Consola es la unica forma de ver una ventana del servidor, y solo sirve para
  # depurar. Sin ella el proceso va oculto y su salida va a database\server.log.
  [switch]$Consola,
  [switch]$Hidden,
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path (Join-Path $root 'database') 'server.pid'
$entry = Join-Path $root 'src\server.js'

function Read-EnvPort {
  if ($Port -gt 0) { return $Port }
  $envFile = Join-Path $root '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*PORT\s*=\s*(\d+)') { return [int]$matches[1] }
    }
  }
  return 3000
}

function Node-Path {
  # En el paquete portable manda el runtime embebido (runtime\ junto a src\ y
  # tools\): asi el PC de destino no necesita tener Node instalado. En el
  # proyecto de desarrollo esta carpeta no existe y se sigue usando el Node del
  # sistema, como siempre.
  $bundled = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\node.exe'
  if (Test-Path $bundled) { return $bundled }
  $found = Get-Command node -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $user = Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
  if (Test-Path $user) { return $user }
  foreach ($guess in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if (Test-Path $guess) { return $guess }
  }
  throw 'Node no esta en el PATH. Arranca con: & "$env:LOCALAPPDATA\Programs\nodejs\node.exe" src\server.js'
}

# PID de los server.js vivos, incluidos los lanzados a mano sin fichero .pid.
function Running-Pids {
  $pids = @()
  if (Test-Path $pidFile) {
    $saved = 0
    $raw = (Get-Content $pidFile -First 1 -ErrorAction SilentlyContinue)
    if ($raw -and [int]::TryParse(([string]$raw).Trim(), [ref]$saved)) {
      if (Get-Process -Id $saved -ErrorAction SilentlyContinue) { $pids += $saved }
    }
  }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = [string]$_.CommandLine
    # Solo los de ESTE proyecto: nada de tocar otros procesos de node del equipo.
    if ($cmd -match 'server\.js' -and $cmd -like ('*' + $root + '*') -and $cmd -notmatch 'smoke|vision-probe|status-check|verify-files') {
      if (-not ($pids -contains $_.ProcessId)) { $pids += $_.ProcessId }
    }
  }
  return $pids
}

function Port-Socket($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) { return ($conn | Select-Object -First 1 -ExpandProperty OwningProcess) }
  return $null
}

# Que programa esta ocupando el puerto, con su linea de mando a la vista. Si no
# es el servidor de este proyecto, la pantalla que se abre ahi NO es la de este
# proyecto: es la causa clasica de ver una interfaz estrecha o de otra tanda.
function Owner-Report($port) {
  $owner = Port-Socket $port
  if (-not $owner) { return $null }
  $command = 'process ' + $owner
  try {
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine) { $command = [string]$process.CommandLine }
  } catch {
    $command = 'process ' + $owner
  }
  $ours = ((Running-Pids) -contains $owner) -or ($command -like '*server.js*')
  return [pscustomobject]@{ ownerPid = $owner; command = $command; ours = $ours }
}

function Server-Info($port) {
  try {
    return Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 5
  } catch {
    return $null
  }
}

# Ultima modificacion del codigo (servidor + interfaz).
function Newest-SourceWrite {
  $newest = $null
  Get-ChildItem -Path (Join-Path $root 'src') -Recurse -File -Include '*.js', '*.css', '*.html' -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $newest -or $_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc }
  }
  return $newest
}

# Cierto solo si quien escucha en el puerto es un servidor de ESTE proyecto mas
# viejo que el codigo en disco. Otro programa con el puerto no se toca jamas.
function Stale-Owner($port) {
  $owner = Port-Socket $port
  if (-not $owner) { return $false }
  if (-not ((Running-Pids) -contains $owner)) { return $false }
  $info = Server-Info $port
  if (-not $info) { return $true }
  $raw = [string]$info.server.startedAt
  if (-not $raw) { return $true }
  try {
    $started = [DateTime]::Parse($raw, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch {
    return $true
  }
  $newest = Newest-SourceWrite
  if ($newest -and $started -lt $newest) { return $true }
  return $false
}

# La pestana se abre solo cuando el puerto ya responde. Abrirla antes hacia que
# el navegador mostrara el error de conexion, o peor: la interfaz de un proceso
# viejo que seguia ocupando el puerto.
function Open-Page($port) {
  for ($i = 0; $i -lt 12; $i++) {
    if (Server-Info $port) { break }
    Start-Sleep -Milliseconds 300
  }
  $info = Server-Info $port
  $stamp = ''
  if ($info -and $info.server -and $info.server.build) { $stamp = [string]$info.server.build }
  # La direccion lleva un parametro que cambia en cada lanzamiento (&arranque=...).
  # Era el ultimo hueco que quedaba: Chrome se acuerda de las URLs exactas, y al
  # restaurar la pestana del dia anterior (o al reiniciar el PC) contestaba desde
  # su propio disco sin preguntar: se veia la portada y la hoja de estilo de otra
  # tanda, con el chat montado encima de la barra lateral y la franja negra a la
  # derecha. Con una URL jamas vista la respuesta tiene que salir del servidor, y
  # desde la tanda 2026-10-26 el servidor manda ademas «Cache-Control: no-store».
  # Interfaz limpia por defecto: SIN barra de medida abajo. El diagnostico sigue
  # disponible para quien lo pida, anadiendo ?medida=1 a la direccion o lanzando
  # este script con -Medida. Con ?medida=0 se quita aunque viniera puesta.
  $url = 'http://127.0.0.1:' + $port + '/?ancho=completo'
  if ($Medida) { $url += '&medida=1' }
  $url += '&arranque=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($stamp) { $url += '&sello=' + ($stamp -replace '[^A-Za-z0-9._\-]', '') }
  Start-Process $url
  Write-Output ('Pestana abierta en http://127.0.0.1:' + $port + ' a ANCHO COMPLETO, sin barra de medidas.')
  Write-Output ('  direccion exacta      : ' + $url)
  Write-Output ('  esa direccion es nueva: el navegador no puede responder de su memoria')
  Write-Output 'Los dos huecos de la barra (al borde de la ventana y detras de la columna de texto) tienen que ser 0 px.'
  Write-Output 'Si alguno pasa de 4 px es que el navegador memorizo el modo «Ancho comodo»: pulsa el boton «Ancho comodo (ACTIVO)» de la cabecera, o recarga con Ctrl+Mayus+R si ademas no coincide el sello de la hoja de estilo.'
  Write-Output 'Si el navegador traia una hoja de estilo de hace dias, la app la detecta (por la centinela o porque el sello de la hoja no es el de esta arrancada) y la recarga sola con una URL sin cache; la barra de medida ensena «hoja <sello> / servidor <sello>» para comprobarlo. El panel de la derecha tambien se fija desde la direccion con ?panel=oculto o ?panel=abierto.'
}

function Show-Status($port) {
  $pids = Running-Pids
  $owner = Port-Socket $port
  Write-Output ('puerto ' + $port + ' : ' + $(if ($owner) { 'escuchando (pid ' + $owner + ')' } else { 'libre, nadie escuchando' }))
  $report = Owner-Report $port
  if ($report) {
    Write-Output ('  programa que lo escucha : ' + $report.command + $(if ($report.ours) { '' } else { '   <-- NO es este proyecto' }))
  }
  if ($pids.Count) { Write-Output ('procesos server.js   : ' + ($pids -join ', ')) } else { Write-Output 'procesos server.js   : ninguno' }

  if ($owner) {
    try {
      $info = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/status') -TimeoutSec 8
      $rev = '<sin revision: es un servidor de una tanda anterior, paralo y arranca el nuevo>'
      if ($info.server -and $info.server.revision) { $rev = $info.server.revision }
      Write-Output ('revision de la API   : ' + $rev)
      Write-Output ('arrancado            : ' + $info.server.startedAt)
      if ($info.limits) {
        Write-Output ('imagenes             : ' + $info.limits.maxImagesPerMessage + ' por mensaje x ' + [math]::Round($info.limits.maxImageBytes / 1MB) + ' MB (paquete hasta ' + [math]::Round($info.limits.bodyLimitBytes / 1MB) + ' MB)')
      }
      Write-Output ('Strata               : ' + $info.strata.baseUrl + ' (alcanzable: ' + $info.strata.reachable + ', modelo: ' + $info.strata.model + ')')
    } catch {
      Write-Output ('aviso: /api/status no responde (' + $_.Exception.Message + ')')
    }
  }
}

function Stop-Server($port) {
  $pids = Running-Pids
  $owner = Port-Socket $port
  if ($owner -and -not ($pids -contains $owner)) { $pids += $owner }
  if (-not $pids.Count) {
    Write-Output 'No habia ningun servidor sonando.'
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
    return
  }
  foreach ($procId in $pids) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Output ('Parado el proceso ' + $procId + '.')
    } catch {
      Write-Output ('No se ha podido parar el proceso ' + $procId + ': ' + $_.Exception.Message)
    }
  }
  if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
}

function Start-Server($port) {
  $owner = Port-Socket $port
  if ($owner) {
    $report = Owner-Report $port
    if ($report -and -not $report.ours) {
      Write-Output ('El puerto ' + $port + ' lo tiene OTRO programa (pid ' + $owner + '): ' + $report.command)
      Write-Output 'No lo cierro. La pantalla que se abre ahi NO es la de este proyecto: esa es la interfaz estrecha.'
      for ($i = 1; $i -le 9; $i++) {
        $candidate = $port + $i
        if (-not (Port-Socket $candidate)) { $port = $candidate; break }
      }
      Write-Output ('Este proyecto se arrancara en http://127.0.0.1:' + $port)
      # src/server.js lee el puerto del entorno: hay que decirselo antes de lanzar.
      $env:PORT = [string]$port
      $owner = $null
    } elseif (Stale-Owner $port) {
      Write-Output ('El servidor que suena (pid ' + $owner + ') es mas viejo que el codigo: se para y se relanza.')
      Stop-Server $port
      Start-Sleep -Milliseconds 800
      $owner = $null
    } else {
      Write-Output ('Ya suena un servidor al dia en el puerto ' + $port + ' (pid ' + $owner + '), con el codigo de disco.')
      if ($Open) { Open-Page $port }
      return $owner
    }
  }
  if (-not (Test-Path $entry)) { throw 'No se encuentra ' + $entry }
  if (-not (Test-Path (Join-Path $root 'node_modules'))) { throw 'Faltan las dependencias: ejecuta una vez npm install.' }

  $node = Node-Path
  $dbDir = Join-Path $root 'database'
  if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Path $dbDir | Out-Null }

  # Sin ventana por defecto, y la salida a fichero. La consola negra que salia
  # antes ERA el servidor: en cuanto alguien la cerraba el chat se quedaba para
  # siempre en «Comprobando conexion con Strata». -Hidden se sigue aceptando (es
  # lo mismo que ahora hace por defecto); -Consola es la unica forma de ver una
  # ventana, y solo sirve para depurar.
  if ($Consola) {
    $proc = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory $root -WindowStyle Normal -PassThru
  } else {
    $outLog = Join-Path $dbDir 'server.log'
    $errLog = Join-Path $dbDir 'server-error.log'
    foreach ($previous in @($outLog, $errLog)) {
      if (Test-Path $previous) { Copy-Item -LiteralPath $previous -Destination ($previous + '.old') -Force }
    }
    $proc = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory $root `
      -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  }
  Set-Content -Path $pidFile -Value $proc.Id -NoNewline

  $up = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 400
    if (Port-Socket $port) { $up = $true; break }
  }
  if (-not $up) {
    Write-Output ('El proceso ' + $proc.Id + ' no ha abierto el puerto ' + $port + '.')
    if ($Consola) {
      Write-Output '  (modo consola: mira la ventana abierta)'
    } else {
      # Antes esto era un callejon sin salida: «mira su consola» no servia de nada
      # porque no habia consola. Ahora el arranque vuelca aqui las ultimas lineas.
      foreach ($log in @((Join-Path $dbDir 'server-error.log'), (Join-Path $dbDir 'server.log'))) {
        if (Test-Path $log) {
          Write-Output ('  ultimas lineas de ' + (Split-Path -Leaf $log) + ':')
          Get-Content -LiteralPath $log -Tail 12 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Output ('    ' + $_)
          }
        }
      }
    }
    return $proc.Id
  }
  $now = Port-Socket $port
  Write-Output ('Servidor arriba (pid ' + $now + ') en http://127.0.0.1:' + $port)
  if ($Open) { Open-Page $port }
  return $now
}

$port = Read-EnvPort

if (-not ($Start -or $Stop -or $Status)) { $Start = $true; $Open = $true }

if ($Stop) { Stop-Server $port }
if ($Start) { $null = Start-Server $port }
if ($Status -or $Start) { Show-Status $port }
