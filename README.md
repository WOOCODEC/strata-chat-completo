# Strata Local Chat

Chat con IA **solo para tu ordenador**: interfaz web + servidor local + historial
en SQLite, hablando exclusivamente con la API local de Strata
(`http://127.0.0.1:8080/v1`, compatible con OpenAI).

Nada de nubes, nada de cuentas, nada de CDN: el navegador solo habla con
`127.0.0.1` y el servidor solo habla con `127.0.0.1`.

## Estructura

```
StrataLocalChat/
  database/          <- aqui se crea chat.db (tu historial, incluidos los blobs de imagen)
  src/
    server.js        <- Express: API + sirve la interfaz
    strataService.js <- cliente de Strata (valida que la URL sea local)
    dbService.js     <- SQLite (better-sqlite3): chats, mensajes y attachments
    public/          <- index.html, style.css, script.js, markdown.js, favicon.*
  tools/smoke.js         <- arnes de prueba (usa BD temporal, no toca tu historial)
  tools/status-check.js  <- consulta el servidor que tengas arrancado
  tools/vision-probe.js  <- sonda para ver como acepta imagenes tu Strata
  tools/verify-files.js  <- comprueba que todos los ficheros sean UTF-8 limpio
  tools/server.ps1       <- arranque y parada limpia (npm run start:open / serve / stop)
  tools/package.ps1      <- arma el paquete portable e instalable (mete Node dentro)
  tools/install.ps1      <- instala en %LOCALAPPDATA%: accesos + "Quitar programas"
  tools/uninstall.ps1    <- quita la instalacion y guarda el historial
  tools/package-check.ps1 / tools/install-check.ps1  <- arneses del paquete y del instalador
  packaging/             <- los .cmd de doble clic que se meten dentro del paquete
  dist/                  <- aqui sale la carpeta y el zip (esta en .gitignore)
  .env               <- configuracion (URL, modelo, DB, limites)
```

## Arranque

```powershell
cd C:\Users\aleja\Desktop\StrataLocalChat
npm start
```

Abre en el navegador: **http://127.0.0.1:3000**

Con `npm run dev` se reinicia solo al tocar los ficheros.

Si prefieres no manejar ventanas de consola, usa el script de arranque
(`tools/server.ps1`), que recuerda el proceso en `database/server.pid`:

```powershell
npm run start:open   # levanta el servidor y abre la pestana
npm run serve        # dice quien escucha, con que revision de API y que limites
npm run stop         # parada limpia, incluidos los servidores huerfanos del proyecto
```

`start:open` deja abierta una ventana de consola con los avisos del servidor: si
la cierras, se para el chat. Para tenerlo sin ventana (y que no se cierre por
accidente): `powershell -File tools\server.ps1 -Start -Hidden`.

Con doble clic vale `start-strata-chat.cmd`, en la raíz del proyecto: comprueba
Node y llama a `tools\server.ps1 -Start -Open`. Ese arranque **no abre la pestaña
hasta que el puerto responde**, y si lo que estaba sonando era un servidor de una
tanda anterior (más viejo que el código en disco) lo para y lanza el nuevo. Así la
pestaña que se abre enseña siempre la versión recién cambiada: antes el `.cmd`
abría la pestaña *antes* de arrancar Node y, si el puerto 3000 lo ocupaba un
proceso viejo, el navegador se quedaba mirando la interfaz anterior (que era la
que se veía estrecha y con una franja negra a la derecha).

Si el puerto lo tiene **otro programa** (no este proyecto), el arranque no lo
toca: lo dice en la consola con la línea de mando de ese proceso y arranca este
chat en el siguiente puerto libre, avisando del nuevo `http://127.0.0.1:XXXX`.
Para verlo de una vez: `npm run serve`, que imprime quién escucha en el puerto y
marca la línea con `<-- NO es este proyecto` cuando el dueño no es este
`server.js`. La pestaña se abre **limpia**, sin barras raras: solo
`?ancho=completo` y un `&arranque=<marca de tiempo>` para que el navegador no
pueda responder desde su memoria. El diagnóstico de medidas es opcional y hay que
pedirlo (ver más abajo). El proceso del servidor **no abre ninguna ventana** y su
salida queda en `database\server.log` (y `database\server-error.log`); la ventana
del lanzador se cierra sola a los 8 segundos y cerrarla **no** para el servicio.

Si Node no esta en el PATH de la ventana que abras, usa la ruta completa
(se instaló en la instalación de usuario):

```powershell
& "$env:LOCALAPPDATA\Programs\nodejs\node.exe" src\server.js
```

## Verificacion

```powershell
npm run check      # sintaxis de los modulos del servidor y de la interfaz
npm run markdown   # renderizador de markdown: escapado, tablas y bloque con su boton de copiar
npm run copycheck  # lo que suelta «Copiar sin formato» en el portapapeles
npm run voicecheck # voz de lectura: velocidad 100%-200%, prosodia, troceado y eleccion de voces
npm run pdfcheck   # lector de PDF: 35 PDF de prueba (varios folios, Identity-H, ObjStm, cifrados y escaneados)
npm run smoke      # servidor de pruebas + API + chat real contra Strata
npm run status     # que modelo y que soporte de vision tiene el servidor en marcha
npm run vision     # manda imagenes de prueba y cuenta si las acepta
npm run verify     # codificacion + markdown + copiado + lector de PDF + voz + arnes completo, de golpe

powershell -NoProfile -ExecutionPolicy Bypass -File tools\package-check.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-check.ps1
```

`package-check.ps1` se carga el paquete generado y lo arranca con el `PATH` de
Windows pelado (sin Node en el sistema) para comprobar que el `node.exe` embebido
basta; `install-check.ps1` instala y desinstala de verdad en este PC y comprueba
accesos, registro y que el historial sobrevive. Son arneses de desarrollo: tocan
el equipo, no los uses en el PC de un tercero.

`npm run smoke` levanta el servidor en el puerto 3999 con una base de datos
temporal (`database/smoke-test.db`, se borra al terminar). Comprueba interfaz,
cabeceras de seguridad, que la maquetacion use la medida fluida compartida (y no
topes fijos que dejen hueco a la derecha), que cada respuesta y cada bloque de
codigo lleven su boton de copiar, historial, busqueda, renombrado, borrado en
cascada, adjuntar imagenes (guardado, devolucion, nombres limpios, ficheros
disfrazados), adjuntar PDF (que se lea su texto, cuanto se leyo, los tipos y
pesos rechazados y que el modelo sea capaz de copiar lo que pone dentro), el
renderizador de Markdown (escapado seguro, tablas, enlaces bloqueados) y una
conversacion de dos rondas contra tu modelo y los ajustes de voz de la interfaz.
Son **114 comprobaciones**; si Strata
no esta levantado, el arnes sigue ejecutando **86 comprobaciones** en modo
offline y avisa de las **28** que han quedado fuera.

`npm run voicecheck` es el arnes especifico de la voz (**132 comprobaciones**):
extrae del codigo de navegador las funciones de velocidad, prosodia, troceado y
puntuacion de voces y las ejecuta en Node, sin abrir el navegador. Ahi se comprueba
por ejemplo que la velocidad queda encerrada entre el 100% y el 200%, que una voz
instalada en el PC no se confunde con una de internet y que los trozos no pasan de
320 caracteres ni pierden texto. La ultima parte ademas **simula el `speechSynthesis`
del navegador** (con sus trozos que terminan cuando tocan) y comprueba de verdad que
gana la voz natural local, que la lectura se encadena trozo a trozo, que cambiar voz
o velocidad a media lectura se nota en lo que queda por leer y que al pulsar **Parar**
deja de sonar todo.

## Llevarselo a otro PC (paquete e instalador, sin internet)

No hace falta instalar Node en el otro equipo: el paquete se lleva su propio
`node.exe` dentro. Se arma desde este PC, que si tiene Node:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1
```

Salen dos cosas:

- `dist\portable\StrataLocalChat\` : la carpeta, para copiarla tal cual (119,7 MB).
- `dist\StrataLocalChat-1.0.0-win-x64-portable.zip` : el zip para llevar (42,0 MB).

Que lleva dentro: `src\`, `node_modules\` (de `better-sqlite3` solo el binario
`win32-x64.node`; los de Linux y macOS se quitan, son 11 MB de nada), `tools\`
sin los arneses de desarrollo, `runtime\node.exe` (el mismo Node con el que se
probo esta tanda: v22.23.4 x64, ABI 127, que es para el que esta compilado el
binario de SQLite) y los arranques de doble clic con su `LEEME-INSTALACION.txt`.

**Por defecto no se lleva tu historial ni tu `.env`** (son tus conversaciones y
tus ajustes). Para llevarlos: `-WithData` y `-WithEnv`. Otros switches:
`-SkipZip` (solo la carpeta) y `-OutDir "D:\paquetes"`.

En el PC de destino, descomprimir y doble clic:

- `Instalar.cmd` : copia la app a `%LOCALAPPDATA%\Programs\StrataLocalChat`, crea
  `.env` a partir de `.env.example` (si no habia), quita el acceso viejo del Menu
  Inicio si apuntaba a la carpeta en vez de a la app, y añade los accesos
  **Abrir / Parar / Estado del servidor** en Menu Inicio > *Strata Local Chat*,
  mas la entrada en "Agregar o quitar programas". Con `-AutoStart` ademas se
  arranca solo al iniciar sesion.
- `StrataChat.cmd` : sin instalar nada: arranca el servidor local y abre la
  pestaña. `StrataChat-parar.cmd` lo para, `StrataChat-estado.cmd` enseña quien
  escucha y si Strata es alcanzable.
- `Desinstalar.cmd` : quita programa, accesos y registro, **guardando antes**
  `database\` y `.env` en `%LOCALAPPDATA%\StrataLocalChat-historial\<fecha>`.
  Para borrarlo todo del tiron: `tools\uninstall.ps1 -Purge`.

Requisitos del destino: Windows 10 u 11 de 64 bits y nada mas. El chat responde
si en ese PC esta Strata (la app arranca igual sin el y lo avisa en pantalla).
El servidor sigue escuchando solo en `127.0.0.1`: llevarselo a otro PC no abre
ninguna puerta a la red.

Para pasar el historial de un PC a otro: copiar `database\chat.db` en la carpeta
`database\` del destino con el servidor parado.

Cosas que hay que saber: no es un MSI ni lleva firma digital, asi que Windows
puede avisar con SmartScreen ("la aplicacion no esta reconocida"): es el paquete
de esta casa, se puede ejecutar de todas formas. Y el `install.ps1` copia desde
el paquete ya generado: si cambias codigo, vuelve a pasar `tools\package.ps1`
antes de instalar (el arnes `package-check.ps1` compara los hashes para que no
se cuele un paquete viejo).

## Configuracion (.env)

| Clave | Para que sirve |
| --- | --- |
| `HOST` / `PORT` | Donde escucha el servidor. `127.0.0.1` = solo este PC. |
| `STRATA_BASE_URL` | URL de tu IA local. Por defecto `http://127.0.0.1:8080/v1`. |
| `STRATA_MODEL` | Que modelo usar. Si se vacia, se usa el primero de `/v1/models`. |
| `DB_PATH` | Ruta del SQLite. |
| `MAX_HISTORY_MESSAGES` | Cuantos mensajes se reenvian como contexto. |
| `TEMPERATURE` / `MAX_TOKENS` | Muestreo y limite de salida. |
| `REQUEST_TIMEOUT_MS` | Tiempo maximo de espera al modelo. |
| `MAX_IMAGES_PER_MESSAGE` | Imagenes por mensaje (por defecto 4, tope 8). |
| `MAX_IMAGE_BYTES` | Tamano maximo de cada imagen (por defecto 4 MB). |
| `IMAGE_TYPES` | Tipos aceptados: `image/png,image/jpeg,image/webp,image/gif`. |
| `MAX_PDF_PER_MESSAGE` | PDF por mensaje (por defecto 4, tope 8). |
| `MAX_PDF_BYTES` | Tamano maximo de cada PDF (por defecto 8 MB). |
| `MAX_PDF_TEXT_CHARS` | Caracteres de texto que se aprovechan de cada PDF (por defecto 12000). |
| `MAX_PDF_TOTAL_CHARS` | Presupuesto de texto de PDF que se mete en un mismo aviso al modelo (por defecto 40000). |
| `ALLOW_REMOTE_STRATA` | Si es `false` (por defecto) el servidor **se niega a arrancar** si la URL no es loopback. |

El tamano maximo del cuerpo de cada peticion (`express.json`) no es una clave
suelta: se calcula con `MAX_IMAGE_BYTES x MAX_IMAGES_PER_MESSAGE` y
`MAX_PDF_BYTES x MAX_PDF_PER_MESSAGE`, convertidos a base64 (x4/3) mas un margen
de 2 MB (con los valores por defecto, 66 MB). Se ve al arrancar, en
`Detalles -> Ajustes locales` y en `GET /api/status` como `limits.bodyLimitBytes`,
para que el navegador pueda avisar **antes** de enviar.

## Como se garantiza que no sale nada a internet

1. El servidor escucha solo en `127.0.0.1` (no en `0.0.0.0`), asi que no es
   accesible desde otros equipos de tu red.
2. `strataService.assertPrivateBaseUrl()` rechaza URLs que no sean
   `127.x.x.x` / `localhost` salvo que actives `ALLOW_REMOTE_STRATA=true`.
3. El `frontend` usa **rutas relativas** (`/api/...`): no puede llamar a otro
   origen.
4. Cabecera `Content-Security-Policy` (`connect-src 'self'`, `script-src 'self'`,
   `img-src 'self' data:`) en el servidor y en el HTML: el navegador bloquearia
   cualquier recurso externo, incluido un CDN. Las unicas imagenes que se cargan
   son las tuyas, servidas por este propio servidor desde `/api/attachments/...`.
5. CORS limitado a su propio origen.
6. Las imagenes se guardan como blob dentro de `chat.db` (no se escriben ficheros
   sueltos en el disco) y se **firman**: se comprueba la cabecera real del binario
   (PNG/JPEG/WEBP/GIF), no solo el nombre ni el `Content-Type`. Un `notas.png`
   que en realidad es un .docx se rechaza con un aviso claro.
7. La **lectura en voz alta** usa por defecto voces **locales** del sistema, y ya
   no descarta las voces `Natural`/`Neural` instaladas en tu propio disco: se mira
   lo que declara la propia voz (`localService`) en vez de guiarse solo por el
   nombre. Las voces `Online`/`Google`, que el navegador resuelve fuera de aqui,
   no se usan nunca salvo que marques `Detalles -> Voz de lectura -> Usar voces
   del navegador`, que ademas te lo advierte. Si no hay voz local y no hay permiso,
   el boton lo dice y no se envia nada. La velocidad de lectura (100%-200%) se
   guarda en el propio navegador (`localStorage`), no en el servidor.

## Como se usan las caracteristicas

- **+ Nuevo Chat** abre un chat en blanco; se guarda en SQLite en el momento
  del primer mensaje (asi no se llenan chats vacios).
- El **titulo** se crea solo con las primeras palabras del primer mensaje; se
  puede cambiar con **Renombrar** o con doble clic sobre el titulo.
- El **historial** de la izquierda esta ordenado por actividad; el buscador
  encuentra texto dentro de los mensajes, no solo en el titulo.
- El **punto verde/rojo** de la parte baja indica si Strata responde; el boton
  **Reintentar conexion** vuelve a sondear sin recargar la pagina.
- La respuesta del modelo **aparece en directo** (streaming). **Detener** corta
  la generacion y guarda lo que ya se habia escrito.
- Cada mensaje del modelo muestra tiempo y tokens; los datos viven en
  `database/chat.db` (puedes copiar ese archivo de backup).
- **Imagenes**: boton **Adjuntar imagen**, pegado con `Ctrl+V` o arrastrando
  ficheros a la ventana. Se ven como miniatura antes de enviar; al enviarlas
  quedan guardadas en SQLite y debajo del mensaje sale una **galeria** con las
  miniaturas que se abren al pincharlas. Si tu modelo no acepta la imagen, el
  aviso lo dice y la pregunta se reenvia solo con texto (la imagen se conserva).
  Una foto de movil que pase del limite **se reduce sola** en el navegador
  (1568 px de lado largo) en vez de descartarse, y el aviso dice de cuanto a
  cuanto ha quedado. Si el paquete entero no cabria en el servidor, se avisa
  **antes** de enviar y no se pierde lo que llevas escrito.
- **Leer en voz alta, mas natural y a tu velocidad**: cada respuesta lleva un boton
  que la lee con la sintesis del propio navegador (no se descarga ni se pide nada
  fuera). En `Detalles -> Voz de lectura` eliges **la voz** -por defecto gana la que
  suena mas natural y este instalada en tu PC, y si prefieres una concreta la sacas
  del desplegable- y la **velocidad, del 100% al 200%** (slider en pasos del 5%, con
  la etiqueta en vivo: `145% (1.45x)`; se recuerda entre sesiones). Para que no
  suene a robot: la respuesta se lee en trozos de hasta 320 caracteres cortados en
  punto y seguido, con pausa entre trozo y trozo; el tono sube un poco en preguntas
  y exclamaciones y baja al cerrar; fuera emojis, flechas y rayas raras (las rayas se
  convierten en pausa) y hay un reloj que evita el corte que Chrome hace a los ~15 s.
  Si cambias voz o velocidad mientras esta leyendo, el cambio se nota en los trozos
  que faltan. Salta el codigo de los bloques y se corta con `Esc` o con **Parar la
  lectura**.
- Los **PDF se adjuntan y se leen aqui mismo**: boton **Adjuntar imagen o PDF**,
  pegado con `Ctrl+V` o arrastrando el fichero. El servidor le saca el texto con su
  propio lector (`src/pdfService.js`, sin librerias ni internet) y **solo ese texto**
  se manda al modelo; el binario del PDF se guarda en SQLite para que puedas
  abrirlo, pero nunca sale hacia Strata. Por defecto caben 4 PDF por mensaje, de 8
  MB cada uno, y se aprovechan hasta 12000 caracteres de texto de cada uno (el aviso
  dice si se ha cortado). En la tira de adjuntos y debajo del mensaje salen como
  **tarjeta con la marca PDF** (nombre, tamano y caracteres leidos) en vez de
  miniatura; pinchando se abre el PDF en otra pestana con el visor del navegador.
  El panel de detalles muestra cuantos caracteres se han leido de cada uno.
- Las respuestas salen con **Markdown** (listas, tablas, negrita, titulos y
  bloques de codigo). El texto se escapa antes de pintarlo: el modelo no puede
  inyectar HTML.
- **Copiar**: cada bloque de codigo lleva su propia cabecera con el lenguaje y el
  boton **Copiar bloque**. Debajo de cada respuesta del modelo salen **Copiar
  respuesta** (tal cual, con su markdown), **Copiar sin formato** (texto
  corriente, sin `**`, sin tablas con bordes y sin los triple backtick) y **Leer
  en voz alta**; debajo de tus mensajes sale **Copiar**. El boton se confirma
  poniendose **Copiado** un momento. Si el navegador no deja usar el portapapeles
  moderno, se tira del plan B (`execCommand`) sin pedir permisos; todo sigue
  dentro del PC.
- La interfaz es **fluida y ocupa el 100% del ancho de la ventana**: la barra lateral
  y el panel de detalles se reparten la pantalla con el área de conversación, y la
  columna de texto llega de borde a borde (`--thread-max: 100%`). La única franja es
  `--frame: clamp(10px, 1.1vw, 20px)`, simétrica a los dos lados en cabecera, mensajes,
  cuadro de escritura y aviso; `html, body` llevan `width: 100%; max-width: none` y
  ningún contenedor de la cadena tiene ya un `max-width` fijo en píxeles. Medido en
  Chrome con la hoja real del servidor (pestaña limpia y barra `?medida=1`), el hueco
  contra el borde derecho es **0 px**:

  | ventana | barra lateral | chat | columna de texto | detalles | hueco a la derecha |
  | --- | --- | --- | --- | --- | --- |
  | 1366 px | 260 px | 806 px | 776 px | 301 px | **0 px** |
  | 1920 px | 420 px | 1128 px | 1088 px | 372 px | **0 px** |

- El botón **Ancho completo / Ancho cómodo** de la cabecera **ya no recorta el
  ancho**: desde la tanda del 26/10/2026 `--thread-max` vale `100%` siempre y el
  modo cómodo solo sube el cuerpo de letra y el interlineado
  (`body.width-cozy { font-size: 16px; line-height: 1.7 }`). Cualquier tope fijo
  en píxeles es lo que producía la franja muerta de la derecha (con 1180 px en una
  ventana de 1702 px, 384 px perdidos). Se sigue recordando en el navegador
  (`strata.width.cozy`).
- **Diagnóstico de pantalla** en el panel de detalles (bloque **Pantalla y versión**):
  tamaño de la ventana, medidas de cada zona con el hueco que sobra a la derecha y el
  sello de la versión del servidor. La **barra fija de medidas de abajo no sale
  nunca por defecto**: es una herramienta de diagnóstico y se pide añadiendo
  `?medida=1` a la dirección (o lanzando `tools\server.ps1 -Start -Open -Medida`);
  con `?medida=0` se quita aunque viniera puesta.
- Panel de **detalles** a la derecha (boton **Detalles** de la cabecera, o
  `Ctrl+I`): contexto del modelo, si admite imagenes, voz de lectura, revision de
  esta API local (si sale `API antigua`, el servidor que esta sonando es viejo y
  hay que reiniciarlo), medida del ultimo envio, fichas y numero de mensajes del
  chat, tamano de la base de datos, etc. Se oculta con la X del panel o con el
  boton de la cabecera; en ventanas estrechas pasa a capa flotante en lugar de
  desaparecer.
- **Exportar a Markdown** (boton en la cabecera): baja un fichero `.md` con la
  conversacion completa y la lista de imagenes adjuntas de cada mensaje. Se genera
  en el propio navegador, sin servidores ni servicios externos.

## Limitaciones conocidas

- **Los cambios en `src/server.js` no se notan hasta reiniciar el servidor.** Para
  parar y arrancar limpio sin buscar procesos a mano: `npm run stop` y despues
  `npm run start:open` (levanta el servidor y abre la pestana). `npm run serve`
  dice quien esta escuchando, con que revision y con que limites. `npm run stop`
  limpia tambien los servidores huerfanos de este proyecto que hayan quedado de
  tandas anteriores (es la causa tipica de "no veo los cambios nuevos"). Desde la
  tanda del 26/10/2026 el propio arranque ya se basta solo: si el codigo en disco
  es mas nuevo que el proceso que ocupa el puerto, `npm run start:open` (o doble
  clic en `start-strata-chat.cmd`) **para el servidor viejo y lanza el nuevo**, y la
  pestana se abre cuando el puerto responde. Un proceso de otro programa nunca se
  toca: si el puerto lo ocupa algo que no es este proyecto, lo dice y no lo mata.
- La portada se manda con `Cache-Control: no-cache` y enlaza `style.css`,
  `script.js`, `markdown.js` y el favicon con el sello de esta arrancada
  (`?v=v4-adjuntos-pdf-<pid>-<fecha>`, el mismo `server.build` que devuelve
  `/api/status`). Asi una pestana antigua no puede quedarse con la hoja de estilo de
  antes, que era lo que hacia que la interfaz se viera estrecha y encajonada a la
  izquierda. Si aun asi la ves vieja, recarga con `Ctrl+F5` y mira la fila **API
  local** del panel de detalles: si dice `API antigua (...)` es que el proceso del
  puerto sigue siendo el viejo. `npm run serve` o `node tools\status-check.js` lo
  confirman desde la consola (mira `revision` y `limits.bodyLimitBytes`).
- Algunas versiones de Strata (llama.cpp) guardan las imagenes en una cache
  temporal por hash. Si una imagen ya se envio antes y esa cache se borro, el
  modelo responde `the image could not be read: cannot read the image <hash>.img`.
  Esta aplicacion lo detecta, avisa y reenvia la pregunta solo con texto; reiniciar
  Strata limpia esa cache. `npm run vision` te dice como de bien va ese punto.
- El modelo actual no declara `vision` en `/v1/models`
  (`input_modalities: ["text"]`) pero si acepta imagenes, asi que el soporte de
  vision se comprueba enviando la primera imagen en vez de fiarse de lo declarado.
- El aviso de "la imagen no se acepto, se reenvio solo el texto" vive en la
  respuesta recien recibida y en el panel de detalles, pero **no se guarda** en el
  historial: si recargas la pagina, la imagen vuelve a verse normal sin aviso.
  Para guardarlo hace falta una columna nueva en la tabla `messages`.
- De un PDF se aprovecha su **texto**, no su dibujo. Si el PDF es un escaneado
  (cada pagina es una foto) o esta protegido con contrasena, no hay texto que
  sacar: el aviso lo dice y puedes escribir o pegar tu el contenido. Al modelo le
  llega como mucho `MAX_PDF_TEXT_CHARS` caracteres por PDF y `MAX_PDF_TOTAL_CHARS`
  sumando todos los del mismo aviso, para no reventar la ventana de contexto.
- El contexto (`n_ctx`) no se puede cambiar desde esta aplicacion: es el modelo
  cargado por Strata el que lo define. En la pantalla **Ajustes -> Modelos**
  del lanzador de Strata se quitan modelos para dejar mas RAM libre y poder
  subirlo.

## Roadmap pendiente

- Detectar el chip neuronal (NPU, Copilot+ PC) de Windows 11 con
  `windows_ai_deploy`: pidiere modelos `.onnx` y una ruta de ejecucion propia en
  vez de Strata, asi que habria que anadir un segundo backend de inferencia.

## Notas del entorno

- Node se instalo **por usuario** en `%LOCALAPPDATA%\Programs\nodejs` (sin
  administrador) y se anadio al PATH de usuario. Si tu terminal no lo encuentra:
  `& "$env:LOCALAPPDATA\Programs\nodejs\node.exe" src\server.js`.
- `better-sqlite3` bajo Windows necesito compilar el addon nativo; hizo falta
  Visual Studio Build Tools 2022 (edicion Community, carga "VC++ 2015-2022").
  La instalacion de `node_modules` requiere internet; el uso despues, no.

