# PROGRESS - Strata Local Chat

Proyecto: chat privado en local (Node + Express + SQLite) conectado solo a la
API de Strata en `http://127.0.0.1:8080/v1`. Carpeta nueva en el Escritorio:
`C:\Users\aleja\Desktop\StrataLocalChat`.

## Fase 1 - Base funcional (CERRADA, 23/23 en el arnes)

| Paso | Estado | Notas |
| --- | --- | --- |
| 1. Estructura de carpetas | Hecho | `database/`, `src/`, `src/public/`, `tools/` |
| 2. Express + estaticos | Hecho | escucha solo en `127.0.0.1:3000`; `src/public` servido en la raiz |
| 3. `src/strataService.js` | Hecho | SDK `openai`; streaming con 3 intentos (usage / stream / sin stream); valida que la URL sea loopback |
| 4. `src/dbService.js` | Hecho | `better-sqlite3` (prebuild `win32-x64`, SQLite 3.53.4); WAL, FK en cascada, busqueda, titulo auto |
| 5. `src/server.js` | Hecho | API REST + SSE + CORS propio origen + CSP + manejo de errores |
| 6. Interfaz (`index.html`, `style.css`, `script.js`) | Hecho | barra lateral con historial + buscador, burbujas, streaming, estado de conexion |
| 7. Arranque y verificacion | Hecho | `npm start`; `node tools/smoke.js` -> 23 comprobaciones, 0 fallos |

### Pruebas que pasan ahora mismo (con Strata levantado)
- Modelo detectado por el servidor: `qwen3.8-flash-next-iq3_s` (`n_ctx 131072`).
- Ronda real de chat: eventos SSE `start,usage,done`, respuesta `vale`.
- Historial: 2 mensajes en la primera ronda, 4 en la segunda, titulo automatico.
- Busqueda por contenido, renombrar, borrar (cascada sin mensajes hueso).
- Errores controlados: mensaje vacio 400, ruta rara 404 JSON, chat inexistente 404.
- Interfaz sin recursos externos y con `default-src 'none'` / `connect-src 'self'`.

### Entorno que se instalo (hace falta una sola vez)
- Node.js **v22.23.4** + npm 10.9.9 desde el ZIP oficial de nodejs.org
  (hash verificado contra `SHASUMS256.txt`), en
  `%LOCALAPPDATA%\Programs\nodejs` y anadido al **PATH de usuario** (sin
  administrador). Si un terminal nuevo no lo ve, reinicia el terminal.
- Dependencias: `express` 5, `openai` 7, `better-sqlite3` 13, `cors`, `dotenv`.
- La instalacion de dependencias necesita internet **una sola vez**; la
  ejecucion no.

## Como verificar esta fase
```powershell
cd C:\Users\aleja\Desktop\StrataLocalChat
npm run check      # sintaxis
npm run smoke      # servidor de pruebas + chat real (BD temporal)
node tools\status-check.js    # contra el servidor real del .env
node tools\verify-files.js    # UTF-8 limpio, sin mojibake
```

## Pendiente / ideas para la siguiente fase
- Leer PDF y documentos (extraer el texto en local y usarlo como contexto).
- Borrado total del historial con confirmacion.
- Selector de modelo en la cabecera cuando Strata declare varios modelos.
- Palabra clave o PIN de arranque si algun dia se expone fuera del `127.0.0.1`.
- Arranque automatico con Windows (task programada) si quieres que este siempre listo.

## Fase 2 - Imagenes, Markdown, panel de detalles, vision y exportar (CERRADA, 58/58 en el arnes)

| Paso | Estado | Notas |
| --- | --- | --- |
| 8. Guardar ficheros en SQLite | Hecho | tabla `attachments` (BLOB, FK en cascada) + indice; `addAttachment` / `attachmentsOfMessage` / `attachmentMeta` / `attachmentBlob` / `countAttachments`; migracion en `migrate()` con PRAGMA table_info |
| 9. Adjuntar en la interfaz | Hecho | boton, `Ctrl+V` y arrastrar ficheros; tira de miniaturas con quitar/solo-archivo; limite y tipos leidos del servidor |
| 10. Validar y enviar a Strata | Hecho | `readIncomingImages` (tamano, tipo declarado, firma real del binario y extensiones bloqueadas); `decoratePrompt` manda la imagen como `image_url` con data URL y deja nota textual en el historial |
| 11. Devolver las imagenes | Hecho | `GET /api/attachments/:id` con `Content-Disposition` y nombre limpio; galeria bajo cada mensaje que abre la imagen en otra pestana |
| 12. Markdown en las burbujas | Hecho | `src/public/markdown.js` (listas, tablas, codigo con boton copiar); escapa todo el texto antes de insertar HTML; el arnes comprueba escapado, tablas, listas de tareas y bloqueo de `javascript:` |
| 13. Panel de detalles | Hecho | columna derecha con el contexto del modelo, fichas y mensajes del chat, tamano de la BD, limites, ultima respuesta; se oculta con la X, el boton `i` de la cabecera o `Ctrl+I` |
| 14. Icono de la pestana | Hecho | `favicon.svg` + `favicon.png` (16/32/48 generados con `tools/make-favicon.js`, sin librerias) |
| 15. Exportar chat | Hecho | boton `Exportar a Markdown` en la cabecera: genera un `.md` en el navegador con la conversacion y el nombre de cada imagen adjunta (las imagenes siguen dentro de `chat.db`) |
| 16. Vision sin declaracion de capacidad | Hecho | `supportsVision` no exige `image` en `input_modalities`; la unica senal de "no vision" es un rechazo explicito y repetido del modelo |
| 17. Motivo del fallo de vision a la vista | Hecho | `askStrata` devuelve `droppedImages` + `imageError`; el aviso de la burbuja y el panel de detalles dicen por que se cayo la imagen y que se reintenta solo con texto |
| 18. Arranque y cierre comodos | Hecho | `npm run start:open` (servidor + pestaia), `start` y `stop` con `tools/server.ps1` (PID en `database/server.pid`, parada limpia) |
| 19. Comprobar la cache de imagenes de Strata | Hecho | `node tools\vision-probe.js`: manda tres imagenes conocidas y repite una; informa del modelo, la capacidad declarada y si Strata dice que no puede leer una imagen concreta |

### Comprobado contra Strata (25/10/2026)
- Arnés: **58 comprobaciones, 0 fallos** (con Strata levantado; sin Strata siguen
  **36** en modo offline y se listan las 22 que dependen del modelo).
- Imagen PNG 2x2 guardada (`pixel.png`, 77 bytes), devuelta por `/api/attachments`
  y enlazada en la galeria; `notas.png` que era un .docx -> 400 con aviso claro.
- Nombres raros (`"C:\ruta\imagen rara".png`) se guardan limpios: `imagen rara.png`.
- Vision: el modelo actual NO declara vision (`input_modalities: ["text"]`)
  pero acepta imagenes. Si Strata falla al leer una imagen, la app reintenta solo con
  texto, avisa en la burbuja y en el panel de detalles, y NO marca el modelo como
  no-vision (eso solo ocurre cuando Strata lo dice explicitamente).
- Modo oscuro de la interfaz forzado desde la app (meta `color-scheme=dark` +
  `prefers-color-scheme: light`): el navegador ya no pinta de blanco los huecos.
- La cache de imagenes de Strata se indexa por hash de los **pixeles** (no del
  fichero): la misma foto repetida se reutiliza bien, pero si la cache temporal se
  borro mientras Strata sigue levantado, ese hash queda inservible hasta reiniciar
  Strata. `node tools\vision-probe.js` lo comprueba mandando tres imagenes
  distintas y repitiendo una.

### Comprobado sin Strata levantado (modo offline del arnes)
- El arnes se lanzo con una URL de Strata falsa y salio con **36 comprobaciones,
  0 fallos**: API, cabeceras de seguridad, estaticos, BLOBs, cascada al borrar,
  ficheros disfrazados, nombres raros, imagenes sin datos y Markdown.
- Las 22 comprobaciones que necesitan modelo se marcan `sin IA` en lugar de
  fallar, y el resumen final lo dice: "36 comprobaciones, 0 fallos (22 sin modelo
  por no haber IA)".
- El panel de detalles no se queda vacio: en la ficha del modelo aparece el error
  de Strata y el boton de volver a comprobar sigue funcionando.

## Detras de camara (nombres nuevos que has visto)
- `tools/verify-files.js`: revisa que todos los ficheros del proyecto sean UTF-8
  limpios. Detecta el mojibake tipico (U+00C2 o U+00C3 seguidos de otro caracter) y letras exoticas fuera del
  rango latino (cirilico, CJK, emojis) que se cuelan al copiar ficheros de otras
  fuentes. Con `--fix` reescribe lo que tenga pinta de estar mal guardado y avisa
  de lo demas. Los `.svg` se saltean en el filtro exotico porque sus iconos si
  usan glifos raros.
- `tools/status-check.js`: habla con tu Strata real y cuenta el contexto, si
  admite imagenes y que ficheros te deja adjuntar.
- `tools/vision-probe.js`: manda tres imagenes PNG pequenas y conocidas, y repite
  una. Sirve para ver como Strata cachea las imagenes por hash de pixeles y si un
  hash concreto ha quedado inservible (pasa si se borro la cache temporal de
  Strata sin reiniciarlo).
- `tools/server.ps1` + `npm run start` / `start:open` / `stop`: levanta o levanta
  + abre la pestaia, y para el proceso localizando el PID guardado en
  `database/server.pid` (con respaldo buscando por linea de comando).
- tabla `attachments`: cada fichero adjunto se guarda dentro de `chat.db` como
  BLOB, unido al mensaje con clave foranea que se borra en cascada.
- `decoratePrompt`: convierte los adjuntos al formato que Strata entiende
  (`image_url` con data URL) y deja una nota de texto para que el historial
  recuerde que esas palabras van con imagen.
- `readIncomingImages`: antes de guardar nada mira el tamano, el tipo declarado y
  la **firma real** del binario (PNG/JPEG/GIF/WebP/BMP). Si un .docx se llama
  .png, se rechaza con un mensaje claro en lugar de guardarlo y que Strata se
  queje despues.
- `supportsVision` / `imageError`: la capacidad de vision no es un interruptor.
  Strata declara `input_modalities: ["text"]` para el modelo actual y aun asi
  acepta imagenes, asi que la app solo descarta imagenes por adelantado si Strata
  lo dice explicitamente. Si un fallo puntual al leer una imagen se repite tres
  veces si que se marca el modelo como no-vision durante un rato, y el motivo
  concreto del ultimo rechazo llega a la interfaz.
- `el navegador no pinta los huecos de blanco`: la app fuerza el modo oscuro
  (meta `color-scheme=dark` y `prefers-color-scheme: light`) para que el
  navegador no inyecte blanco en los margenes.
- `modo compacto / normal`: boton y atajo `Ctrl+B` para ganar ancho de lectura;
  se recuerda entre sesiones.
- `la imagen viaja dos veces`: una copia se guarda para ti y otra se manda al
  modelo. Por eso el limite de tamano se aplica por igual a los dos caminos.
- `el arnes no toca tu chat.db`: `npm run smoke` levanta su propio servidor en el
  puerto 4399 con una base de datos temporal, asi que las pruebas no ensucian tu
  historial real.

## Pendiente del backlog (lo que queda por hacer)

| # | Tarea | Estado | Notas |
| --- | --- | --- | --- |
| 1 | Leer PDF y documentos | HECHO (tanda de adjuntos PDF) | lector propio sin librerias en `src/pdfService.js` (solo `zlib`); el texto se guarda en la columna `text` de `attachments` y se inyecta en el aviso al modelo con presupuesto; los PDF cifrados o escaneados se avisan en vez de inventar |
| 2 | Hablar con voz (microno) | Pendiente | la voz **de salida** ya esta (boton `Leer en voz alta`, voz elegible por naturalidad y velocidad del 100% al 200% en `Detalles -> Voz de lectura`). Lo que falta es la voz de entrada: `MediaRecorder` en el navegador + un modelo local de transcripcion (Whisper) |
| 3 | Borrado total del historial con confirmacion | Pendiente | boton "Vaciar todo" en Ajustes; ahora hay que borrar chat a chat |
| 4 | Selector de modelo en la cabecera | Pendiente | solo tiene sentido cuando Strata declare mas de un modelo |
| 5 | Agente multi-paso | Descartado | aqui no hay herramientas que el modelo pueda llamar, no hay bucle que montar |
| 6 | Exportar también a JSON o HTML | Pendiente | la exportacion actual es Markdown desde el navegador |
| 7 | Exportar las imagenes junto al texto | Pendiente | haria falta un endpoint nuevo que baje un ZIP con el `.md` y las imagenes |
| 8 | Copiar un mensaje concreto | HECHO (tanda de maquetacion y copiado) | «Copiar respuesta» y «Copiar sin formato» bajo cada respuesta del modelo, «Copiar» bajo los mensajes tuyos y «Copiar bloque» en la cabecera de cada bloque de codigo |
| 9 | Hablar con un segundo servidor local | Descartado | la app funciona con un unico `STRATA_BASE_URL` |
| 10 | Cargar mas ficheros de golpe | Mejorado | siguen siendo `MAX_IMAGES_PER_MESSAGE = 4` de `MAX_IMAGE_BYTES = 4` MB, pero el limite del cuerpo de la peticion ya se calcula solo a partir de esos dos (24 MB), las fotos grandes se reducen solas en el navegador y la interfaz avisa antes de enviar si el paquete no cabe. Para 20 o 30 hace falta subir esas dos variables en el `.env` y reiniciar |
| 11 | Lista de todos los ficheros adjuntados | Pendiente | ver y filtrar todas las imagenes guardadas, no solo las de un chat |
| 12 | Sonido de notificacion al terminar la respuesta | Pendiente | opcional y silenciable, sin recursos externos |
| 13 | Ventana flotante / siempre encima | Descartado | desde el navegador no se puede; haria falta un envoltorio de escritorio |
| 14 | Palabra clave o PIN si se expone fuera del `127.0.0.1` | Guardado en el cajon | ver la decision sobre la Fase 1.5 mas abajo |
| 15 | Arranque automatico con Windows | VUELVE A PENDIENTE (limpieza del 26/10/2026) | el acceso de Inicio lo creaba el instalador retirado, y en este PC no habia ninguno: la carpeta `Startup` esta vacia (comprobado tras el borrado). `tools\server.ps1 -Start -Hidden` sigue valiendo como orden; falta solo donde engancharla (un .lnk en `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` o una tarea del Programador) |
| 16 | Guardar el aviso de "imagen no aceptada" en el historial | Pendiente | hoy el aviso solo aparece en la respuesta recien recibida; al recargar la pagina desaparece. Hace falta una columna nueva en `messages` (`note` o `meta` JSON) y ensenarla otra vez en la burbuja y en el panel |
| 17 | Llevarselo a otro PC (paquete e instalador) | RETIRADO (limpieza del 26/10/2026) | se quitaron `packaging\` y los scripts `tools\package.ps1` / `install.ps1` / `uninstall.ps1` con sus dos arneses: con el codigo en GitHub, en otro PC se clona el repo, `npm install` y `start-strata-chat.cmd` (hace falta Node en el destino). Vuelve del historial de Git con `git checkout 78a713c -- packaging tools/package.ps1 tools/install.ps1 tools/uninstall.ps1` |

## Registro de tandas

### Tanda del 26/10/2026 (regla nueva: nada de empaquetar, se entrega por Git) - `npm run verify` completo sin fallos

**La regla que se fija:** quedan **prohibidos** los `.zip`, los instaladores y las
carpetas `packaging\` / `dist\`. El respaldo y el traslado a otro PC se hacen con
Git y GitHub, y cada cambio se comprueba contra el servidor local en marcha y con
`npm run verify`, sin binarios intermedios. Queda escrita en «Decisiones de
seguridad y de producto» y al principio de «Verificacion» del `README.md`, para que
nadie (nadie, incluida la IA de la tanda siguiente) lo intente otra vez.

**Restos que quedaban, ya no:** el arbol se queda solo con `src\`, `tools\`,
`database\`, el lanzador y la documentacion, y Git pasa a rastrear **29 ficheros**
(28 tras la limpieza anterior mas `tools\clean.js`). Lo unico
que todavia ensuciaba eran los logs de la arrancada anterior
(`database\server.log.old` y `database\server-error.log.old`), borrados. El barrido
de patrones de basura (`*.tmp`, `*.bak`, `*.orig`, `*.zip`, `*.exe`, `*.lnk`, `*~`,
`.DS_Store`, sobras del arnes) no encontro ninguno mas.

**Para no volver a acumular:** `tools\clean.js`, con `npm run clean` (y `--dry` para
mirar antes). Borra solo lo que vuelve a crearse solo: `.log.old`, sobras del arnes
(`smoke-test.db*`, sondas) y `*.tmp` / `*.bak` / `*.orig`. Lleva lista de intocables
(`chat.db` con sus `-shm`/`-wal`, `server.pid` y los logs del servidor en marcha),
asi que no puede llevarte el historial por delante, y si un fichero lo tiene abierto
el servidor avisa en vez de fallar. Esta anotado en `verify-files.js` y en la
estructura del `README.md`.

**Verificacion con el metodo nuevo (cero paquetes):** `npm run verify` de cabo a
rabo - codificacion **sin problemas**, markdown **21/0**, copiado **42/0**, voz
**132/0**, arnes completo **128/0**. `node tools\browser-check.js` **13 de 13**
contra el servidor en marcha (pid 29400, sin ventana): modelo
`qwen3.8-flash-next-iq3_s`, chat de borde a borde con **hueco 0 px**, enlaces limpios
sin `?v=` y cero errores de JavaScript. `npm run clean` en un workspace ya limpio
cierra con **0 ficheros, 0 KB**, que es la prueba de que no queda basura.

### Tanda del 26/10/2026 (limpieza: fuera el empaquetado portable) - 128/128 en el arnes, 13/13 en Chrome real

**Lo pedido:** el codigo ya esta versionado y subido a
`https://github.com/WOOCODEC/strata-chat-completo.git` (`main`, commit `78a713c`),
asi que la carpeta de empaquetado y sus scripts asociados ya no hacen falta en el
dia a dia y el arbol de trabajo se deja limpio.

**Que se ha quitado (11 ficheros rastreados + lo generado):**

- `packaging\` entero: `Instalar.cmd`, `Desinstalar.cmd`, `StrataChat.cmd`,
  `StrataChat-parar.cmd`, `StrataChat-estado.cmd` y `LEEME-INSTALACION.txt`.
- `tools\package.ps1`, `tools\install.ps1`, `tools\uninstall.ps1` y los dos
  arneses `tools\package-check.ps1` / `tools\install-check.ps1`: sin la carpeta a
  la que apuntaban se quedaban sin entry point.
- `dist\` (161,8 MB entre la carpeta portable y el zip).

**Con que red se borro:** los once ficheros estaban **rastreados y ya subidos**, o
sea que vuelven con
`git checkout 78a713c -- packaging tools/package.ps1 tools/install.ps1 tools/uninstall.ps1`.
`dist\` en cambio esta en `.gitignore` y Git no lo guarda, asi que se mando a la
**papelera de reciclaje** en vez de borrarlo a fuego: los 161,8 MB siguen siendo
sacables de ahi sin tener que regenerar nada. La regla `dist/` del `.gitignore` se
queda: si algun dia se recupera el empaquetado, su salida no debe volver al repo.

**Antes de tocar nada, barrido de referencias:** ningun lanzador
(`start-strata-chat.cmd`), ningun `package.json` y ningun arnes vivo (`smoke.js`,
`status-check.js`, `browser-check.js`, `copy-check.js`, `server.ps1`) mencionaban
esos scripts. Solo los mencionaban `README.md`, `PROGRESS.md` y la lista de
ficheros de `tools\verify-files.js`.

**Documentacion ajustada:** `verify-files.js` deja de pedir los 11 ficheros (si no,
el arnes de codificacion fallaba con `FALTA ...`) y pasa a comprobar
`tools\browser-check.js`, que si existe y estaba fuera de la lista; `README.md`
pierde esas lineas de la estructura, cambia los dos arneses de «Verificacion» por
`node tools\browser-check.js` (el arnes de navegador que si sigue en el repo) y
reescribe «Llevarselo a otro PC» a clonar de GitHub, con la orden de Git para
recuperar el paquete. En el backlog, la fila 17 pasa a RETIRADO y la **15 vuelve a
pendiente**: el acceso de Inicio lo creaba el instalador retirado, y al mirar
`%APPDATA%\...\Programs\Startup` ha salido que en este PC no habia ninguno, o sea
que no se ha perdido nada pero ya no queda mecanismo.

**Verificacion despues del borrado:** `npm run check` limpio;
`node tools\verify-files.js` **30 ficheros, sin problemas de codificacion**;
`node tools\smoke.js` **128 comprobaciones, 0 fallos**; `node tools\browser-check.js`
**13 de 13 en verde** contra el servidor arrancado con `tools\server.ps1 -Start`
(sin ventana, pid 29400): portada servida como HTML, cero errores de JavaScript,
modelo `qwen3.8-flash-next-iq3_s` visible, chat de borde a borde con **hueco 0 px**
y los enlaces a `style.css` / `script.js` / `markdown.js` limpios, sin `?v=`.

**Complemento de limpieza:** `database\server.log.old` y
`database\server-error.log.old` estaban rastreados y cambiaban en cada arranque, o
sea que metian ruido en `git status`. Se han dejado de rastrear (siguen en el
disco) y `.gitignore` gana la regla `database/*.log.old`, que era el hueco por el
que habian entrado.

**Consecuencia que hay que saber:** llevar el chat a otro PC vuelve a requerir Node
en el destino e internet para clonar; a cambio se acabo el binario de 42 MB que
habia que regenerar cada vez que cambiaba el codigo.

### Tanda del 26/10/2026 (el «no arranca» era un ReferenceError en la portada, no la maquetacion) - 128/128 en el arnes, 12/12 en Chrome real

**Lo que reportaba el usuario:** la pantalla no cargaba el modelo («Se queda
comprobando la conexion con strata»), `Uncaught SyntaxError: Unexpected end of
input` en `script.js`, y una barra de texto fea abajo con medidas
(`ventana 1702 px · hoja v4-adjuntos-pdf... · servidor v4-...`).

**La causa real, con la captura del usuario confirmandola:** en `src/server.js`
la funcion `stampedShell()` usaba `shellCache` **sin estar declarada** (la
declaracion se borro al quitar el sellado `?v=` de los enlaces de la portada).
Cada peticion de `/` reventaba con
`[ERRO] ReferenceError: shellCache is not defined  at stampedShell (server.js:178)`
y el navegador recibia `{"ok":false,"error":"Error interno del servidor local."}`
(500) **donde iba el HTML**. De ahi todo lo demas: sin portada no hay interfaz, el
historial no se lee, la pestana se queda en «Comprobando conexion» y el navegador
declara «Unexpected end of input» porque donde esperaba JS tiene JSON roto. No era
la maquetacion, ni la cache, ni el ancho: quedaba probado de sobra de que
`style.css` y el contrato de medidas estaban bien (hueco 0 px en Chrome real).

**Arreglado:**
- `src/server.js`: devuelta la declaracion `const shellCache = { key: '', html: '' };`
  justo antes de `stampedShell()`. `GET /` vuelve a dar 200 con 9.405 bytes de HTML,
  y `script.js`/`style.css`/`markdown.js` se sirven **byte a byte identicos al disco**
  (84.699 / 24.651 / 8.522), o sea imposible el corte del que se quejaba el navegador.
- `src/public/script.js`: la **barra de medidas de abajo es ahora opcional**. Solo
  aparece pidiendo `?medida=1` (o `tools\server.ps1 -Start -Open -Medida`); sin ese
  parametro, o con `?medida=0`, se quita aunque la pestana viniera con ella puesta.
  Nuevo `measureBarWanted()`. El lanzador abre `/?ancho=completo` limpio.
- `tools/server.ps1`: el servidor se lanza **siempre sin ventana** y con la salida en
  `database\server.log` + `database\server-error.log` (la arrancada anterior pasa a
  `.old`). La consola negra que salia antes **ERA el servidor**: al cerrarla (o al
  apagar el PC) la pestana se quedaba para siempre en «Comprobando conexion». Nuevo
  `-Consola` solo para depurar; si el puerto no abre, el script vuelca aqui mismo las
  ultimas 12 lineas del log de error (antes decia «mira su consola» y no habia).
- `start-strata-chat.cmd`: fuera el `pause` final (pulsar una tecla cerraba la ventana
  y se llevaba el servicio por delante) por `timeout /t 8 /nobreak` + `exit /b 0`.
- Quitados de la interfaz los textos que hablaban del recorte de 1180 px, que ya no
  existe (`--thread-max` vale 100% siempre; el modo comodo solo sube letra e
  interlineado).

**Nota de proceso (importante para no volver a perder cambios):** buena parte de los
parches de las dos ultimas tandas **no llegaron al disco** porque se intentaron con
una herramienta de edicion inexistente en este entorno (`edit_file` en lugar de
`editor`). Eso es lo que dejo `installLayoutContract`, `hardenLayout`, `chainText`,
`layoutFixes`, `armStatusTimer`, etc. a medias: llamadas colgando y ficheros
cortados. Comprobado con `node --check` (0 en los seis modulos) y barrido de
definiciones vs. usos: **0 referencias colgando** en `script.js`.

**Verificado:** `npm run smoke` **128 comprobaciones, 0 fallos** (5 nuevas: portada
como HTML + `shellCache` declarada, barra de medida solo bajo demanda, lanzador sin
`medida=1`, servidor sin ventana con log en disco, lanzador sin `pause`; corregidas 3
expectativas desactualizadas del propio arnes: `min(1180px, 100%)` -> `--thread-max:
100%` y «ningun tope fijo en pixeles», `serverWasDown ? 4000 : 60000` y la URL del
lanzador). `node tools/browser-check.js` **12/12**: sin errores de JS,
`Conectado a Strata (2 ms)`, modelo `qwen3.8-flash-next-iq3_s` visible,
`hueco 0 px`, enlaces limpios sin `?v=`. `node tools/copy-check.js` 21/0,
`node tools/verify-files.js` sin problemas de codificacion, `npm run check` limpio.
Servidor real arriba (pid 1300) con `Strata alcanzable: True`.

**Actualizado el arnés de navegador (`tools/browser-check.js`):** ahora abre por
defecto la direccion real del lanzador (`/?ancho=completo&arranque=...`, **sin**
`?medida=1`) y comprueba ademas que la barra de medidas de abajo **solo existe si
la direccion la pide** (`probe.measureBar === /[?&]medida=1/`). Dos pasadas: sin
`?medida` -> `sin barra`, 13/13 en verde; con `--url ...?medida=1` -> `barra
presente`, tambien en verde. Y el paquete portable regenerado con todo el arreglo
dentro: `dist\portable\StrataLocalChat` 119,8 MB y
`dist\StrataLocalChat-1.0.0-win-x64-portable.zip` 42 MB, con `src\server.js`,
`src\public\script.js`, `src\public\style.css`, `tools\server.ps1` y `README.md`
**byte a byte identicos al repositorio** (`shellCache` en la linea 180 del
`server.js` empaquetado y `measureBarWanted` presente).


### Tanda del 26/10/2026 (la franja de la derecha era el panel de Detalles, no la cache) - 128/128 en el arnes

- **El usuario tenia razon y lo retire**: no era la cache. Dos pruebas lo dejaron
  claro. (1) Barrido de `Desktop`, `Documents` y `AppData\Local\Strata`: solo existe
  **una** copia de `style.css` en todo el disco (repo, `dist/portable` y la hoja
  servida comparten MD5 `883CB398`). (2) Capturas reales de Chrome headless a
  1872x1000 con perfil limpio, escaneando pixeles: con el panel cerrado queda
  `barra lateral x0-418`, `chat x420-1871` y **hueco 0**; con el panel abierto,
  `chat x420-1499 (1080 px)` y **panel x1501-1871 (371 px)**. O sea: la maquetacion
  de disco ya llega de borde a borde, y la «parte derecha libre» que se veia era el
  **panel de Detalles abierto**, con un fondo casi igual al del chat.
- **Fallo real #1, avisos de cache falsos para siempre** (`src/public/script.js`):
  los procesos antiguos fabricaban el sello en cada peticion, asi la hoja salia con
  `-12296-mvph3j4g` y el API con `-12296-mvph3j58`; no cuadraban JAMAS y
  `healStaleCss()` montaba el cinturon rojo con «Abrir sin cache» teniendo la
  pantalla perfecta y `hueco 0 px`. Nuevo `stampParts()` (base / PID del servidor /
  cola) y `cssStampsMatch()` acepta sellos del **mismo proceso**. Con el proceso de
  ahora (`src/server.js:167` calcula `BUILD_STAMP` una sola vez al arrancar) hoja y
  API salen idénticos: comprobado con el PID 25428.
- **Contrato de maquetacion, que es lo que se pedia** (`src/public/script.js`):
  `LAYOUT_CONTRACT` + `installLayoutContract()`, lo primero de `init()`. Es un
  `<style>` insertado AL FINAL del `<head>`, o sea gana a cualquier hoja previa
  aunque sea de otra epoca: `body>main.chat{flex:1 1 0!important;width:auto!important;
  max-width:none!important;min-width:0;}`, `main.chat #thread{width:100%;
  max-width:var(--thread-max,100%);margin:0 auto;}`,
  `body.inspector-off>aside.inspector{display:none!important;}`. Respeta los cortes
  de 980 y 1600 px de la hoja en vez de pisarlos, y no toca el modo «Ancho comodo»,
  que es el unico recorte pedido por el usuario.
- **Fallo real #2, el panel parecia espacio vacio** (`src/public/style.css`,
  `src/public/script.js`): `.inspector` baja de `clamp(256px,22vw,372px)` a
  `clamp(238px,18vw,336px)`, y gana contraste con `background:#171e28`,
  `border-left:1px solid #33424f` y `box-shadow:-16px 0 34px`. `paintInspectorButton()`
  pone en el boton de la cabecera `Ocultar detalles (-336 px)` mientras el panel esta
  abierto. La barra de medida y la fila del panel de detalles lo dicen en claro:
  `panel Detalles 336 px ABIERTO (no es hueco: es el panel)` y
  `HUECO REAL al borde de la ventana 0 px`. Centinela `--css-sentinel` sube a
  `2026-10-26b`.
- **Verificado, no prometido**: cuatro capturas headless (1872 px con panel abierto y
  cerrado, modo comodo, y 900 px para comprobar que el contrato no rompe el corte
  estrecho: alli el chat mide 676 px, hueco 0 y el panel sigue flotando a 340 px).
  `npm run smoke` **128 comprobaciones, 0 fallos** (tres nuevas: contrato inyectado,
  boton con los px del panel, diagnostico que distingue panel de hueco real);
  `node tools/copy-check.js` 21/0; `node tools/verify-files.js` sin problemas de
  codificacion; `npm run check` limpio. Chrome ya no deja volcar el DOM en esta
  version («Multiple targets are not supported in headless mode»), asi que la
  verificacion visual se hace con `--screenshot` y leyendo la barra de la imagen.
- **Como comprobarlo cada uno**: abrir con `?medida=1&ancho=completo&panel=oculto` y
  con `?panel=abierto`. En el primer caso tiene que salir `HUECO REAL al borde 0 px`;
  en el segundo, `panel Detalles N px ABIERTO (no es hueco: es el panel)` y el boton
  de la cabecera dice `Ocultar detalles (-N px)`, que es lo que devuelve ese ancho al
  chat.

### Tanda del 26/10/2026 (la hoja de estilo vieja se recarga sola y el panel se fija desde la direccion) - 120/120 en el arnes

- **Medido en Chrome real, no a ojo** (`?medida=1&ancho=completo&panel=oculto|abierto`
  con perfil limpio y ventana de 1920 px, ventana util 1894 px): con el panel cerrado
  sale `barra lateral 420 px · chat 1474 px · detalles 0 px · hueco al borde 0 px ·
  hueco detras del texto 0 px`; con el panel abierto, `chat 1102 px · detalles 372 px ·
  hueco 0 px`. O sea que la maquetacion que hay en disco ya llega de borde a borde.
  El `chat 1128 px` con `detalles 0 px` de la captura del usuario es un estado
  imposible con esta hoja: el chat mide 1128 porque sigue descontando los 372 px del
  panel, o sea que el navegador estaba aplicando una **copia antigua de `style.css`**.
- **La interfaz se repara sola** (`src/public/style.css`, `src/public/script.js`):
  la hoja declara `--css-sentinel: 2026-10-26a`. `cssLooksCurrent()` lee esa centinela
  y `--thread-max` del navegador; si no coinciden, `healStaleCss()` inserta
  `style.css?sin-cache=SELO-MILES` (URL jamas vista: no puede salir del almacen del
  navegador), quita la hoja vieja y solo deja aviso si aun asi queda torcida. Se
  lanza despues de `/api/status` porque el sello del servidor es el que se pone en la
  URL nueva. `loadedCssStamp()` entiende esa URL para que el panel de detalles no
  mienta despues de reparar (`version ... la misma que contesta en este puerto`).
- **Comprobado de punta a punta, no de palabra**: se sirvio una copia temporal de la
  portada enlazando una hoja inexistente (404, ni una regla aplicada) y la app acabo
  con `hoja-nueva-insertada: SI`, `chat 1474 px` y `hueco 0 px`, sin aviso. La copia
  de prueba se borro despues.
- **El aviso ahora esta a la vista y dice la causa** (`explainGap` + `showTopNote`):
  si la medida pasa de 4 px libres, sale una franja roja **abajo** (no tapa los
  botones de la cabecera, que son los que arreglan) con el motivo concreto: modo
  comodo activo, panel de detalles que ocupa N px, u hoja ajena al servidor; trae X
  para callarlo en la pestana (`strata.note.gap.off`). Hasta ahora el unico aviso
  vivia dentro del panel de detalles, que es justo lo que nadie abre.
- **El panel derecho tambien se fija desde la direccion** (`?panel=abierto` /
  `?panel=oculto`, `panelModeFromUrl()`): manda sobre lo memorizado y lo guarda, igual
  que `?ancho=`. Sirve para reproducir el estado exacto que ve cada usuario sin tocar
  botones, y es como se midio el caso del panel cerrado arriba.
- **Ojo con la pestana abierta antes de esta tanda**: la autorreparacion vive en el
  `script.js` nuevo, asi que una pestana cargada con el codigo viejo todavia necesita
  un `Ctrl+Mayus+R` (o cerrar y volver a abrir con `start-strata-chat.cmd`) para
  cargar el codigo que repara. A partir de ahi, ya no se vuelve a quedar vieja.
- **Arnés y textos**: 3 comprobaciones nuevas (120/120, 0 fallos), 21/21 de redaccion,
  ficheros sin problemas de codificacion. `start-strata-chat.cmd` y `tools/server.ps1`
  explican la autorreparacion y el `?panel=`.

### Tanda del 26/10/2026 (llevarselo a otro PC: paquete portable con Node dentro e instalador) - arnes del paquete 0 fallos, arnes de instalacion 0 fallos

- **No existia nada que instalar**: el proyecto se arrancaba con `npm start` o
  con `tools\server.ps1`, y en el escritorio habia un acceso del Menu Inicio que
  abria la carpeta del proyecto (apuntaba a un `python -m http.server` que ya no
  estaba). No habia zip, ni instalador, ni runtime embebido por ningun lado: se
  reviso el equipo (`%LOCALAPPDATA%\Programs`, `Program Files`, accesos del Menu
  Inicio y el registro de "Quitar programas") y no habia restos de versiones
  anteriores. Se construye el paquete desde cero.
- **`tools\package.ps1`**: monta `dist\portable\StrataLocalChat\` y su zip
  `dist\StrataLocalChat-1.0.0-win-x64-portable.zip` (119,7 MB la carpeta, 42,0 MB
  el zip, 4.742 entradas). Mete dentro el Node con el que se ha probado la tanda
  (`runtime\node.exe`, v22.23.4 x64, ABI 127, el mismo para el que esta compilado
  el `win32-x64.node` de `better-sqlite3`) y quita de `node_modules` los prebuilds
  de Linux y macOS (11 MB de peso inutil en un PC de Windows). Copia `src\`,
  `tools\` **sin los arneses de desarrollo**, `package.json`,
  `package-lock.json`, `.env.example`, `README.md` y los lanzadores de
  `packaging\`. `-WithData` y `-WithEnv` son los unicos modos de llevar el
  historial o el `.env` de esta maquina; `-SkipZip` y `-OutDir` para el resto.
  `Compress-Archive` se quedo atascado con rutas largas en alguna carpeta de
  `node_modules`, asi que si falla se usa `tar.exe` (viene con Windows 10+).
- **Instalador y desinstalador** (`tools\install.ps1`, `tools\uninstall.ps1`, con
  `Instalar.cmd` y `Desinstalar.cmd` dentro del paquete): copia a
  `%LOCALAPPDATA%\Programs\StrataLocalChat`, respeta `database\` y `.env` al
  reinstalar (robocopy `/MIR` excluyendo esas dos rutas), crea `.env` desde
  `.env.example`, genera `app.ico` desde el favicon y deja tres accesos reales en
  Menu Inicio > *Strata Local Chat* (**Abrir**, **Parar**, **Estado del
  servidor**) mas la entrada en "Agregar o quitar programas" con su desinstalador.
  `uninstall.ps1` para el servidor, quita accesos y registro y **antes** guarda
  `database\` y `.env` en `%LOCALAPPDATA%\StrataLocalChat-historial\<fecha>`; con
  `-Purge` borra tambien el historial.
- **`tools\server.ps1`** ahora busca primero `runtime\node.exe` del propio paquete
  y solo si no lo hay usa el `node` del PATH: por eso el paquete funciona en un PC
  sin Node instalado, y por eso el desarrollo sigue usando el Node de siempre.
- **Dos arneses nuevos** (no se empaquetan, son de esta casa):
  `tools\package-check.ps1` compara los hashes del paquete con el repo (para que
  no se cuele un `install.ps1` de una tanda anterior), verifica que no lleva
  `.env` ni historial ni arneses, limpia el `PATH` de Windows y arranca el paquete
  con un `DB_PATH` temporal: comprueba que contesta `/api/status`, que el proceso
  que escucha es el `node.exe` del paquete, que sigue en `127.0.0.1`, que la
  portada se sirve y que la parada limpia funciona. **19 comprobaciones, 0
  fallos**. `tools\install-check.ps1` instala de verdad, comprueba instalacion,
  accesos y registro, arranca la copia instalada sin Node en el `PATH`, para,
  desinstala con `-Purge` (no queda nada), vuelve a instalar y desinstala sin
  purge para comprobar que el `chat.db` de prueba acaba en el respaldo con su
  contenido, y deja el equipo como estaba. **23 comprobaciones, 0 fallos**.
- **Cuatro fallos que salieron al ensayar, ya corregidos**: `install.ps1` buscaba
  el runtime en la raiz del repo y alla no existe (el runtime lo genera
  `package.ps1` en `dist\portable\`), asi que se anadio `-Source` y busqueda por
  candidatos con un mensaje que dice que hay que empaquetar antes; los instaladores
  llamaban a `& powershell` dependiendo del PATH (se romperia en un equipo con el
  PATH roto), ahora usan la ruta absoluta de `System32`; el aviso final y la
  descripcion del acceso hardcodeaban el puerto 3000, ahora leen `PORT` del `.env`
  del destino; y `Compress-Archive` inundaba la consola con su barra de progreso
  (`$ProgressPreference = 'SilentlyContinue'`).
- **Limites sabidos de esta entrega**: no es un MSI ni va firmado, asi que
  SmartScreen puede avisar la primera vez; el Node embebido es el de esta maquina
  (x64, ABI 127), asi que en un Windows de 32 bits no vale y si algun dia se cambia
  de Node hay que reempaquetar para que el binario de SQLite siga siendo
  compatible; `-WithData` puede llevar conversaciones sin querer, es un switch
  explicito y hay que acordarse de el al pasar el paquete a otra persona.


### Tanda del 26/10/2026 (el hueco de la derecha, medido en el navegador, y quien ocupa el puerto) - 114/114 en el arnés

- **Del `clamp()` al 100%** (`src/public/style.css`): la tanda anterior dejó
  `--thread-max: clamp(1180px, 92vw, 2400px)`, que seguia dejando franja a la derecha en
  cuanto la ventana pasaba de ese 92%. Ahora `--thread-max: 100%` y la unica franja es
  `--frame: clamp(10px, 1.1vw, 20px)`, simetrica a los dos lados en cabecera, mensajes,
  cuadro y aviso. `html, body` con `width: 100%; max-width: none`; `.thread`, `.msg` y la
  burbuja del asistente con `max-width: 100%`. No queda ningun tope fijo en la cadena de
  contenedores. Se quitan ademas reglas muertas que no afectaban a nada (un
  `@media (min-width: 1180px)` que convertia el panel en capa flotante con una clase que
  no existe, topes a `.user-row`/`.assistant-row`/`.md` de una maquetacion que nunca
  hubo y un `width: 100%` repetido en el cuadro).
- **Medido en Chrome real** (pestaña limpia, hoja servida por este servidor y barra de
  medida activada con `?medida=1`). Hueco contra el borde derecho **0 px** en los dos
  tamaños:

  | ventana | barra lateral | chat | columna de texto | detalles | hueco a la derecha |
  | --- | --- | --- | --- | --- | --- |
  | 1366 px | 260 px | 806 px | 776 px | 301 px | **0 px** |
  | 1920 px | 420 px | 1128 px | 1088 px | 372 px | **0 px** |

- **Recortar la lectura pasa a ser opcional**: boton **Ancho completo / Ancho comodo**
  (`#btn-width` en la cabecera, `applyWidthMode`/`toggleWidthMode`/`restoreWidthMode` en
  `script.js`). Por defecto 100%; al pulsar se pone `width-cozy` en `<body>`, que deja
  `--thread-max: min(1180px, 100%)` y centra la columna. Se recuerda con
  `strata.width.cozy` en el almacenamiento local del navegador.
- **La app enseña por que se ve lo que se ve** (`index.html`, `script.js`, `style.css`):
  bloque **Pantalla y version** en el panel de detalles (`measureLayout`,
  `paintLayoutRows`) con la ventana, las medidas de cada zona y el hueco sobrante, y el
  sello `?v=` de la hoja que cargo el navegador (`loadedCssStamp`) comparado con
  `server.build` de `/api/status`; si no coinciden o el hueco pasa de 4 px, la linea sale
  en rojo y manda `Ctrl+Mayus+R`. Con `?medida=1` en la direccion se añade una barra fija
  abajo con esas mismas medidas (`paintMeasureBar`), para verificarlo con una captura. Se
  recalculan en `resize` y `orientationchange`.
- **El navegador ya no reutiliza una hoja vieja** (`src/server.js`): `express.static`
  sale con `cacheControl: true, maxAge: 0` y conserva el ETag, asi que cada recarga
  pregunta al servidor (contesta `304` en milisegundos) y no vuelve a pintar el CSS de
  otra tanda. Medido: `cache-control: public, max-age=0` y `etag W/"588ce-..."`.
- **El lanzador dice quien tiene el puerto** (`tools/server.ps1`): `Owner-Report` lee el
  proceso que escucha y su linea de mando. Si no es el `server.js` de este proyecto lo
  avisa (`el puerto 3000 lo tiene OTRO programa: <linea de mando>`), **no lo toca** y
  arranca este chat en el siguiente puerto libre, escribiendo `PORT` en el entorno antes
  de lanzar (de ahi lo lee `src/server.js`). `npm run serve` imprime esa linea marcada con
  `<-- NO es este proyecto`. La pestaña se abre con `/?medida=1`.
- **Arnés** (`tools/smoke.js`): 4 comprobaciones nuevas (hoja con `max-age=0` y ETag, el
  lanzador detecta el puerto ajeno y salta de puerto, la cadena de contenedores llega al
  borde sin topes fijos, boton de ancho opcional y bloque de medidas) y 2 rehechas porque
  la hoja ya no usa `clamp()` en el hilo. Total **114 comprobaciones, 0 fallos** con
  Strata levantado (sin modelo se saltan las 28 que dependen de el). Sigue en 132/132 el
  arnes de voz, 42/42 el lector de PDF, 21/21 los textos y `markdown OK`.
- **Apunte fuera de este proyecto**: en el escritorio hay otra ventana de chat,
  `Desktop\strata\strata.html` (Tailwind, API en `127.0.0.1:8080`), con topes suyos:
  `max-w-2xl` en las burbujas (672 px) y `max-w-4xl mx-auto` en la barra de envio
  (896 px) sobre un fondo casi negro. Esa yes la que se ve encajonada a la izquierda con
  una franja negra enorme a la derecha. No es este proyecto y no se ha tocado.


### Tanda del 26/10/2026 (ancho completo de la interfaz y arranque que nunca muestra la versión vieja) - 110/110 en el arnés

- **El hueco negro a la derecha ya no existe** (`src/public/style.css`): el ancho del
  hilo de conversacion era una cifra fija de pixeles (`--thread-max: 1180px`, y
  `1320px` a partir de 1600 px por el `@media (min-width: 1600px)`). En cuanto la
  ventana pasaba de ese numero, la interfaz parecia encajonada a la izquierda con una
  franja vacia enorme al lado. El tope pasa a `clamp(1180px, 92vw, 2400px)`: crece con
  la ventana y solo se frena en monitores descomunales, para que la linea de lectura no
  se haga incomoda de seguir. Medido con Chrome sin interfaz cargando la hoja real:

  | ancho de ventana | antes | ahora |
  | --- | --- | --- |
  | 1366 px | hilo 767 px | hilo 767 px |
  | 1920 px | hilo 1178 px | hilo 1178 px |
  | 2560 px | hilo **1320 px** (522 px muertos) | hilo **1818 px**, ocupando la columna |
  | 3440 px | hilo 1320 px | hilo 2400 px (techo deliberado) |

- **El cuadro de escritura, en su canto** (`src/public/style.css`): `.composer` llevaba
  `var(--frame)` a la izquierda pero `6px` a la derecha, asi que en cuanto el margen se
  ampliaba el cuadro se salia del canto del hilo. Cabecera, mensajes, cuadro y aviso
  usan ahora margen simetrico por los dos lados.
- **Por que «abriendo `index.html` a mano se ve bien, y con el lanzador no»**: eran dos
  fallos del arranque, no de la hoja de estilo.
  - `start-strata-chat.cmd` abria la pestana **antes** de que `node` escuchase y
    lanzaba el servidor a ciegas: si el puerto 3000 lo ocupaba un proceso de una tanda
    anterior, `node` moria con `EADDRINUSE` y el navegador se quedaba mirando al
    servidor viejo, con su CSS antiguo. Ahora el `.cmd` solo llama a
    `tools\server.ps1 -Start -Open`.
  - `tools/server.ps1`, con el puerto ya ocupado, avisaba y **salía sin abrir ninguna
    pestaña**: seguías mirando la pestaña de siempre. Ahora `Open-Page` abre solo cuando
    `/api/status` responde, y `Stale-Owner` compara la hora de arranque del proceso con
    la ultima modificacion de `src/`: si el codigo en disco es mas nuevo, para ese
    servidor y relanza el nuevo. Un proceso de otro proyecto jamas se toca.
- **Nada de hojas de estilo fantasma** (`src/server.js`): la portada sale ahora de una
  ruta propia con `Cache-Control: no-cache, no-transform` y enlaza
  `style.css`/`script.js`/`markdown.js`/favicon con `?v=SELO`, siendo `SELO` la
  `BUILD_STAMP` (`revision-pid-arranque`, publicada como `server.build` en
  `/api/status`). Una pestana abierta de antes no puede reutilizar la hoja anterior.
- **Puerto ocupado explicado** (`src/server.js`): `EADDRINUSE` reventaba con una traza
  de Node; ahora dice en espanol que el puerto lo tiene otro proceso (casi siempre un
  servidor de una tanda anterior) y manda a `npm run stop` y luego `npm run start:open`.
- **Arnes** (`tools/smoke.js`): 9 comprobaciones nuevas (sello en los enlaces, `no-cache`
  en la portada, sello == `server.build`, ruta sellada servida, el lanzador delega en
  `server.ps1`, abre despues de escuchar y recicla el proceso viejo, el hilo no se topa
  a pixeles fijos y cabecera/hilo/cuadro comparten canto derecho). Total:
  **110 comprobaciones, 0 fallos** con Strata levantado, mas 132/132 del arnes de voz,
  42/42 del lector de PDF, 21/21 de los textos y `markdown OK`.
- Probado de punta a punta: tocar `src/public/style.css` y volver a arrancar ->
  `El servidor que suena (pid 30964) es mas viejo que el codigo: se para y se relanza` y
  el sello pasa a `v4-adjuntos-pdf-26072-...`; volver a arrancar sin tocar nada ->
  `Ya suena un servidor al dia en el puerto 3000` y el sello no cambia.

### Tanda del 26/10/2026 (voz de lectura mas natural y velocidad del 100% al 200%) - 101/101 en el arnes, 132/132 en el arnes de voz

- **Elegir la voz que suena natural** (`src/public/script.js`): las voces se
  ordenan por naturalidad con `speechVoiceScore` (ganan las
  `Natural`/`Neural`/`Enhanced` en el idioma de la pagina y restan las que se
  autodenominan `robot` o `compact`). `isCloudVoice` pasa a mirar lo que declara la
  propia voz (`localService`) en vez de fiarse solo del nombre: las voces naturales
  **instaladas en el disco** se estaban descartando como si fueran de internet, y
  eso es lo que dejaba sonando la voz robotica de siempre.
- **Selector de voz y control de velocidad** (`src/public/index.html`, `style.css`,
  `script.js`): bloque nuevo `Detalles -> Voz de lectura` con desplegable (voz
  automatica, grupo de locales y grupo de las del navegador, marcado con aviso),
  slider de velocidad con `min=100 max=200 step=5` y etiqueta en vivo
  (`145% (1.45x)`) y casilla para permitir las voces que sacan el texto de este PC.
  Todo se guarda en el propio navegador (`strata.voice.name`, `strata.voice.rate`,
  `strata.voice.online`) y se recupera al abrir la interfaz. El desplegable lleva un
  sello de la lista de voces (`voiceSignatureOf`): si la lista no cambia no se
  reconstruye, así que no se cierra mientras lo tienes abierto ni pierde el scroll
  cada vez que se refresca el estado.
- **El tope del 200% esta en el codigo, no solo en el slider**: `RATE_MIN = 100`,
  `RATE_MAX = 200`, `RATE_DEFAULT = 100` y `clampVoiceRate`, que encierra lo que
  venga (texto suelto, vacio, negativo o pasadisimo). `voiceRateFactor` lo convierte
  a factor (`200 -> 2`) y `applyVoiceTo` se lo aplica a cada trozo en el ultimo
  momento: si se cambia la velocidad a media lectura, lo que queda por leer ya sale
  con la nueva.
- **Menos robotico sin tocar la red**: los trozos bajan de 600 a 320 caracteres y se
  cortan **despues** del punto (antes el punto se iba al principio del trozo
  siguiente), la lectura se encadena trozo a trozo (`speakQueued`, arrancando cada
  uno en el `onend` del anterior) con su pausa natural y sin colas eternas, hay reloj
  anti-corte de Chrome (`resume()` cada 9 s), prosodia por trozo (`prosodyFor`:
  +0.06 en preguntas y exclamaciones, -0.03 al cerrar el ultimo, un poco mas arriba
  al empezar, mas bajo en mayusculas, encerrado entre 0.8 y 1.2) y `plainForSpeech`
  quita emojis, flechas y pictogramas y convierte rayas y puntos suspensivos en
  pausa.
- **La regla de privacidad sigue intacta**: sin marcar la casilla solo se usan voces
  locales, la eleccion manual de una voz del navegador se ignora hasta activarla y el
  boton lo advierte (`Sin voz local: eligela en Detalles`).
- **Arnés nuevo de la voz** (`tools/voice-check.js`, `npm run voicecheck`, dentro de
  `npm run verify`): **132 comprobaciones** ejecutando en Node las funciones de voz
  extraidas de `script.js` con el mismo truco de `copy-check.js`. Cubre los limites
  100/200 y sus redondeos, el factor 1x-2x, la etiqueta, las claves guardadas, que
  los controles esten en el HTML y en el CSS, la puntuacion de voces, el sello que
  evita reconstruir el desplegable en cada refresco, la prosodia, el troceado (menos
  de 320, corte en punto y seguido, sin perder ni duplicar texto) y la limpieza de lo
  que se lee. La ultima tanda **simula el `speechSynthesis` del navegador** con un
  motor falso: verifica que se elige la voz natural local (y nunca la que saca el
  texto de casa), que la cola se encadena trozo a trozo hasta acabar, que cambiar voz
  y velocidad a media lectura se aplica a lo que queda, que el boton pasa a
  `Parar la lectura` y vuelve a su sitio, que al parar se cancela la sintesis y no
  salen mas trozos y que el segundo click en el mismo boton para la lectura.
- **Smoke al dia** (`tools/smoke.js`): sube de 96 a **101 comprobaciones** (73 sin
  necesidad de modelo) - selector y slider en la interfaz, el tope 100%-200% en HTML
  y en el codigo, prosodia y cola de trozos, el CSS de los controles y que
  `voicecheck` este registrado en `npm run verify`. La comprobacion de privacidad de
  la voz se reescribe: ahora exige el permiso explicito en vez del viejo filtro por
  nombre. `tools/verify-files.js` revisa tambien el arnes nuevo.

### Tanda del 25/10/2026 (adjuntos PDF: lector propio y su texto como contexto) - 96/96 en el arnes, 35/35 del lector

- **Lector de PDF escrito a mano** (`src/pdfService.js`, se comprueba con
  `npm run pdfcheck`): sin librerias ni internet, solo `zlib` de Node. Entiende los
  objetos clasicos `n g obj` y los metidos dentro de un flujo de objetos (`ObjStm`,
  lo normal en los PDF 1.5 de Word o de Chrome), los filtros `FlateDecode` (con
  predictores PNG), `ASCIIHexDecode`, `ASCII85Decode` y `RunLengthDecode`, las
  fuentes simples (`WinAnsi`/`PDFDoc` con `/Differences`) y las tipo 0 (`Identity-H`)
  con su tabla `ToUnicode`, los `XObject` de tipo `Form`, los recursos heredados de la
  pagina y los operadores de texto `Tf`, `Td`, `TD`, `TL`, `T*`, `Tj`, `TJ` (con su
  kerning) y `Do`. Devuelve `{ ok, pages, chars, text, truncated, note, error, encrypted }`.
- **No inventa lo que no entiende**: si el PDF lleva `/Encrypt` (contrasena) o si las
  paginas son solo la foto de un escaneado, lo dice con una nota en vez de sacar
  caracteres sueltos. Cortes de seguridad para que un PDF raro no tumbe el servidor:
  200000 caracteres retenidos, 64 MB por flujo descomprimido y 8 MB por pagina.
  `tools/pdf-check.js` trae 42 comprobaciones: texto simple, varias paginas,
  `Identity-H`, `ObjStm`, predictores, nombres de glifo, formularios, imagenes en
  linea, hexadecimal, recursos heredados, comillas, saltos de linea, kerning,
  anchuras de fuente (`/Widths` y `/W` + `/DW`), cifrado, escaneado, truncado y corrupto.
- **Anchuras de fuente y lapiz del texto** (`src/pdfService.js`): cuando la fuente trae
  anchuras (`/Widths` en las simples, `/W` + `/DW` en las Type0/CID) se sabe cuanto
  ocupa cada glifo y el lector sigue el lapiz: solo mete un espacio si el hueco supera
  el ancho de un espacio de esa fuente. Hace falta porque Chrome al imprimir saca un `Td`
  por letra con su avance real, y sin anchuras eso se leia como `I n f o r m e`. Sin
  anchuras se conserva el criterio de antes. Probado con un PDF impreso desde Chrome
  (acentos, `ñ`, euro, negrita, justificado, tabla y dos paginas): salen literales
  `Informe de EXTRACCION: MANZANA-VERDE-42`, `Tabla de resultados`,
  `Concepto Valor Observacion` y `Pagina dos: PERA-MORADA-7`, sin letras sueltas.
- **La base de datos guarda cuanto texto se leyo** (`src/dbService.js`): columna
  `text` en `attachments` con migracion por `PRAGMA table_info` (una base ya creada se
  actualiza sola al arrancar), `insertAttachment` la rellena y `listAttachments`
  devuelve `text_chars` sin tocar el BLOB.
- **El servidor valida y lee** (`src/server.js`): `readIncomingDocuments` comprueba
  tamano, tipo declarado y la firma real `%PDF` del binario; `splitMedia` separa
  imagenes de documentos y `withDocumentText` mete el texto en el aviso con
  presupuesto (`MAX_PDF_TEXT_CHARS` por PDF, `MAX_PDF_TOTAL_CHARS` por aviso). El
  binario del PDF se guarda en `chat.db` pero **nunca se manda a Strata**: solo viaja
  su texto. Nuevas claves en el `.env`: `MAX_PDF_PER_MESSAGE`, `MAX_PDF_BYTES`,
  `MAX_PDF_TEXT_CHARS`, `MAX_PDF_TOTAL_CHARS`; el limite del paquete
  (`JSON_BODY_LIMIT_BYTES`) ahora cuenta tambien los PDF (con los valores por defecto,
  66 MB) y la revision de la API pasa a `v4-adjuntos-pdf`.
- **La interfaz lo pinta como documento** (`src/public/index.html`, `style.css`,
  `script.js`): boton `Adjuntar imagen o PDF`, tarjetas con marca `PDF` (nombre,
  tamano y caracteres leidos) en la tira del cuadro y debajo del mensaje, y las ya
  guardadas se abren en otra pestana con el visor del navegador. El evento `start` del
  streaming trae los adjuntos ya guardados con su `id` y su `text_chars`, asi que la
  burbuja optimista queda conectada con lo que hay en la base de datos (sirve para
  reintentar o borrar). `Detalles` saca una fila de PDFs y limites y el arranque
  imprime la linea `PDF por mensaje`.
- **Arnés al dia**: `tools/smoke.js` llega a **96 comprobaciones** (68 sin necesidad
  de modelo) - el `accept` del
  input, el aviso de caracteres leidos dentro del SSE, el `text_chars` guardado,
  `documents` raros -> 400, demasiados PDF, PDF pasado de peso con el maximo en MB y
  el estado publicando `application/pdf x 4`). La prueba de extremo a extremo con
  Strata encendido manda un PDF real con la frase `hola pdf MANZANA-VERDE-42` y
  comprueba que **el modelo la devuelve literal**: eso prueba que el texto leido en
  local entra en el aviso y llega al modelo. `tools/verify-files.js` revisa ahora
  tambien `src/pdfService.js` y `tools/pdf-check.js` (habia que quitarle un BOM al
  arnes nuevo). Quedan integrados `npm run pdfcheck` y `npm run verify`.
- **Comprobado tambien el camino del mundo real** (26/10/2026):
  - **Migracion sobre una base ya creada**: sobre una copia de la base real en
    `%TEMP%` con el esquema anterior (sin la columna `text`, con un chat y un
    adjunto dentro) se arranco `src/dbService.js` encima. La columna aparecio
    (`id,chat_id,message_id,name,mime,bytes,blob,created_at,text`), lo viejo
    siguio listandose con `text_chars: 0`, un PDF nuevo se guardo con su texto
    (17 caracteres contados), el binario siguio recuperandose con
    `getAttachment` y reabrir la base una segunda vez no rompio nada. El script
    temporal se borro despues.
  - **Extraccion sobre PDFs generados de verdad**: ademas de los 35 casos
    escritos a mano, un PDF impreso por Chrome desde una pagina con fuente
    `Helvetica-Bold` (dos paginas, texto justificado) salio completo y en el
    orden correcto, sin ruido de espaciado extra; otro con el abecedario
    `ABCDEFGHIJKLM` / `NOPQRSTUVWXYZ` en `Identity-H` devolvio las dos lineas
    separadas por salto de linea.
  - **El aviso previo del navegador**: `bodyLimitBytes()` en
    `src/public/script.js` ya no se queda en un tope fijo de 8 MB mientras no
    haya llegado el `/api/status`; ahora se calcula con los mismos valores por
    defecto del servidor (imagenes y PDF en base64, x4/3, mas 2 MB de margen)
    para que no salga un "no cabe" falso con un PDF de 8 MB. Y el aviso dice
    "archivos mas pequenos" en vez de "fotos mas pequenas". `tools/smoke.js`
    trae una comprobacion nueva que lo vigila (de ahi pasar a 96).

### Tanda del 25/10/2026 (maquetacion fluida y botones de copiar) - 76/76 en el arnes

- **La interfaz deja de quedar pegada a la izquierda** (`src/public/style.css`):
  el hilo estaba topado a `max-width: 900px` y cada mensaje a `min(820px, 100%)`,
  con la respuesta del asistente alineada `flex-start`. En una ventana de 1600 px
  o mas eso dejaba un hueco vacio enorme a la derecha. Ahora hay una **medida
  fluida compartida** en `:root` (`--thread-max: 1180px` y
  `--frame: max(12px, calc((100% - var(--thread-max)) / 2))`) que usan por igual
  la cabecera, la zona de mensajes, el cuadro de escritura y su aviso: los cuatro
  comparten canto izquierdo y el ancho crece con la ventana. A 1600 px o mas el
  tope sube a 1320 px.
- **La respuesta del modelo ocupa todo el ancho del hilo**: `.msg` pasa a
  `width: 100%`, el asistente a `align-self: stretch` con su burbuja a
  `width: 100%`, y lo tuyo sigue siendo burbuja (`fit-content`, tope
  `min(880px, 96%)`) pegada a la derecha. Las acciones de cada mensaje se alinean
  con su lado.
- **Barra lateral y panel derecho fluidos**: los `296px`/`320px` fijos pasan a
  `clamp(224px, 19vw, 320px)` y `clamp(256px, 22vw, 372px)`. El punto de corte de
  1180 px desaparece (lo cubre el `clamp`) y se anade uno de 520 px para telefono:
  barra a `clamp(128px, 34vw, 190px)`, botones de la cabecera mas compactos,
  burbuja propia a todo el ancho y cuadro de texto algo mas bajo. Por debajo de
  980 px el panel de detalles sigue siendo capa flotante (lo comprueba el arnes).
- **Copiar en cada bloque de codigo** (`src/public/markdown.js`): el bloque fenced
  se envuelve en `.md-codebox` con su cabecera `.md-codebar` (etiqueta del
  lenguaje, que antes se descartaba, y boton `Copiar bloque`). El boton lleva
  `data-copy-block` y **ningun `onclick`**, porque la CSP de la app prohíbe los
  scripts embebidos: los atiende un unico escucha delegado (`wireBlockCopy()`)
  sobre la conversacion, asi que tampoco hay que volver a engancharlos cuando el
  streaming re-pinta el mensaje. Un bloque suelto se sigue tratando como bloque
  propio (no acaba dentro de un `<p>`, que romperia el `<div>`), y los bloques sin
  lenguaje o sin cerrar conservan su cabecera.
- **Copiar la respuesta entera** (`src/public/script.js`): `copyButton()` crea las
  pastillas y `answerActions()` monta la fila de cada respuesta (`Copiar respuesta`
  tal cual, `Copiar sin formato` y `Leer en voz alta` si hay voz local), reutilizada
  tanto en el historial cargado como en la respuesta que va llegando en streaming.
  Tus mensajes llevan `Copiar`; si la respuesta falla, el aviso sale con
  `Copiar aviso` para poder pegarlo donde haga falta.
- **`plainForCopy()`** deja el texto para pegar fuera sin ruido: quita titulos,
  citas, vinetas, numeracion, reglas, `**`, `*`, `_`, `~~`, codigo en linea y los
  triple backtick (conservando el codigo), y convierte las tablas en filas con
  barras. El arnes pilló dos fallos: faltaba la cursiva de un asterisco y de
  guion bajo, y las anclas con `^\s*` en modo multilinea se comían el salto de
  linea previo y pegaban los parrafos; ahora anclan con `[ \t]*`.
- **Portapapeles sin depender de nada externo** (`src/public/script.js`):
  `copyToClipboard()` intenta `navigator.clipboard.writeText` (funciona en
  `http://127.0.0.1`, que el navegador considera contexto seguro) y si falla cae en
  `legacyCopy()` con un `textarea` fuera de pantalla y `execCommand('copy')`. El
  boton se autoconfirma con `Copiado` o `No se pudo copiar` durante 1,8 s, con los
  temporizadores guardados en un `WeakMap` para no apilarse si se pulsa varias veces.
- **Pruebas nuevas**: `tools/copy-check.js` (21 comprobaciones) saca `plainForCopy`
  de `script.js` y la ejecuta en Node para ver lo que de verdad llega al
  portapapeles. `tools/markdown-check.js` sube de 21 a **46**: red nueva de
  `tagBalance()` para que **ninguna etiqueta quede abierta o de mas** en las 15
  muestras (incluida una respuesta mezclada con codigo, lista y tabla), mas la
  cabecera nueva (etiqueta del lenguaje, boton propio, sin `onclick`, bloque suelto
  fuera de `<p>`, dos bloques con dos botones y bloque sin cerrar).
  `tools/smoke.js` suma 6 (3 de maquetacion fluida y 3 de
  copiado) y cierra en **76 comprobaciones, 0 fallos**; sin Strata levantado sigue
  ejecutando **54** y avisa de las **22** sin modelo. `npm run verify` encadena ya
  `verify-files.js` + `markdown-check.js` + `copy-check.js` + `smoke.js`, y
  `npm run markdown` / `npm run copycheck` pueden ir sueltos.
- **Deriva de documentacion detectada y cerrada**: el README anunciaba "bloques de
  codigo con boton **Copiar**" cuando ese boton no existia, y hablaba de 58
  comprobaciones cuando el arnes ya iba por 70. Ahora describe los botones reales
  y las cifras actualizadas (76 / 54 / 22). El item 8 del backlog queda **HECHO**.
- **Lo que NO comprueba el arnes**: revisa las **reglas CSS** (medida compartida,
  burbuja del asistente a todo el ancho, `clamp()` en barra y panel), no el pintado
  real del navegador. Hace falta una pasada visual tuya a 1366 px, a 1920 px y con
  el panel de detalles oculto; si algo baila, se toca el tope `--thread-max`.

### Tanda del 25/10/2026 (voz, fotos grandes y avisos claros) - 68/68 en el arnes
- **Leer en voz alta las respuestas** (`src/public/script.js`, `style.css`,
  `index.html`): cada respuesta del modelo lleva ahora un boton `Leer en voz alta`
  que usa la sintesis de voz del propio navegador (`speechSynthesis`, sin
  recursos externos y sin tocar la CSP). Busca voz en espanol (`es-ES`, luego
  `es-MX`, luego cualquier `es`, luego la del sistema), parte el texto en trozos
  de 600 caracteres para que el motor no se corte, y quita el Markdown de enmedio
  (los bloques de codigo se anuncian, no se deletrean). El boton pasa a
  `Parar la lectura` mientras suena, `Esc` corta en cualquier sitio y cambiar de
  chat o enviar algo nuevo tambien corta la lectura. La voz elegida se ve en
  `Detalles -> Voz`.
- **Regla de privacidad de la voz**: solo se usan voces **locales** del sistema.
  `isCloudVoice` descarta las que el navegador resuelve fuera del PC (las
  `Online`, `Natural`, `Neural` de Edge y las `Google` de Chrome, que mandan el
  texto a sus servidores). Si en el equipo solo existen esas, el boton avisa
  `Sin voz local: no se lee` y no se envia nada; la fila `Detalles -> Voz` lo
  explica. Queda anotado en el README dentro del apartado de privacidad.
- **Las fotos grandes ya no se descartan**: `shrinkToLimit` reduce y re-codifica
  en el navegador (1568 -> 1100 -> 760 px, JPEG al 86% y, si el PNG no encoge,
  tambien PNG) hasta que cabe en `MAX_IMAGE_BYTES`, y cuenta el resultado:
  «Hemos reducido foto.jpg de 6,2 MB a 780 KB (4032x3024 a 1568x1176 px)». Las
  GIF animadas se siguen avisando por escrito porque reducirlas romperia la
  animacion.
- **Aviso claro cuando todavia no hay documentos**: arrastrar o pegar un PDF,
  Word o de texto ya no se traga en silencio; dice «Los documentos aun no se
  admiten (informe.pdf). Mientras tanto: pega aqui su texto o manda una captura
  de pantalla de la pagina.», y el pie del compositor lo recuerda. Sigue en la
  backlog como tarea 1.
- **El paquete demasiado grande habla en espanol** (`src/server.js`): el limite
  del cuerpo de Express (`JSON_BODY_LIMIT_BYTES`, 24 MB) se calcula a partir de
  `MAX_IMAGE_BYTES x MAX_IMAGES_PER_MESSAGE` y el error `request entity too large`
  del parser se traduce a «El paquete con las imagenes pesa demasiado para este
  servidor local (maximo 24 MB)...». La interfaz lo avisa **antes** de enviar
  (`payloadBytes` contra `bodyLimitBytes`) para no perder el mensaje escrito, y
  `Detalles` muestra el limite. El arranque imprime `Tamano max. paquete`.
- **El panel de detalles no desaparece en ventana estrecha**: antes
  `@media (max-width: 980px)` lo ponia a `display: none`, asi que el boton
  `Detalles` no hacia nada. Ahora pasa a capa flotante a la derecha y sigue
  abriendo y cerrando.
- **Historial y chat solidos si el servidor esta caido**: `refreshChats()` ya no
  lanza la excepcion al techo; si `/api/chats` falla se ve el motivo en la lista
  lateral y en el centro, con el boton `Reintentar conexion` a mano. Abrir un chat
  que no se puede leer deja la pantalla explicandolo en vez de dejar la anterior
  a medias. `Detalles -> API local` dice la revision del servidor y, si es
  antigua (sin `revision` ni `maxImageBytes`), avisa de que hay que reiniciar el
  servidor: eso era exactamente lo que pasaba con el proceso del puerto 3000, que
  seguia con el codigo viejo (respondia `413` vacio y no tenia
  `/api/attachments/:id`). Se ha parado ese proceso viejo y se ha vuelto a lanzar
  el nuevo, que reporta `revision=v3-adjuntos-vision-voz`.
- **Arnes** (`tools/smoke.js`): 14 comprobaciones nuevas (boton de voz en la
  interfaz, sintesis y aviso de documentos en el cliente, reduccion de fotos,
  voces sin salida a internet, panel accesible en ventana estrecha, revision de la
  API, limite del paquete publicado, 413 explicado y sin texto en ingles, imagen
  pasada de peso con el maximo claro, revalidacion de los ficheros propios y el
  script de arranque). Total: **70 comprobaciones, 0 fallos** con Strata levantado.
- **Deriva de documentacion detectada y cerrada**: este mismo fichero anunciaba
  `tools/server.ps1` con `npm run start` / `start:open` / `stop` desde la tanda de
  arranque, pero **ese fichero no existia** y en `package.json` no habia tales
  scripts. Esa era justo la razon de que no hubiera forma comoda de parar el
  proceso viejo que tenia el puerto 3000. Creado ahora `tools/server.ps1` con
  `-Start`, `-Stop`, `-Status` y `-Open`: guarda el PID en `database/server.pid`,
  para tambien los servidores huerfanos buscandolos por linea de comando (solo los
  de ESTE proyecto, no toca otros `node.exe` del equipo), se niega a arrancar dos
  veces en el mismo puerto y `npm run serve` cuenta puerto, revision, limites y
  estado de Strata. `package.json` suma `start:open`, `stop` y `serve`.
  Probado de punta a punta aqui: `-Status` vio el servidor viejo sin pid file
  (pid 14700), `-Stop` lo paro y `-Start` dejo uno trazable (pid 18048)
  respondiendo `revision=v3-adjuntos-vision-voz`.
- Detalle util: el servidor sirve `script.js`/`style.css` con
  `Cache-Control: public, max-age=0` y `ETag`, asi que un `F5` normal basta para
  ver los cambios de la interfaz; `Ctrl+F5` solo hace falta si algo sigue raro.

### Tanda del 25/10/2026 (cierre de la Fase 2)
- El aviso de "no he podido usar la imagen" ahora dice **por que** se ha caido:
  `askStrata` devuelve `imageError` junto con `droppedImages`, ese texto viaja en
  el evento `error` de la respuesta y en el registro del chat, y la interfaz lo
  enseña en la linea de la burbuja (tooltip incluido) y en el panel de detalles.
  Mientras Strata no confirme que el modelo no admite imagenes, el aviso habla de
  fallo puntual y de que se ha reintentado solo con texto.
- El arnes tiene **modo offline**: si Strata no esta levantado sigue ejecutando 36
  comprobaciones y marca las 22 que dependen del modelo como `sin IA`.
- Nuevas 6 comprobaciones del renderizador de Markdown (escapado seguro, tablas,
  listas de tareas, bloqueo de enlaces `javascript:`, codigo y negrita). Total:
  **58 comprobaciones, 0 fallos** con Strata levantado.
- Nuevo panel de arranque y cierre: `npm run start`, `start:open` y `stop` con
  `tools\server.ps1`; el arnes usa la misma parada para no dejar procesos sueltos.
- Nuevo `tools\vision-probe.js` para diagnosticar la cache de imagenes de Strata.
- El filtro de `tools\verify-files.js` que busca caracteres exoticos deja pasar los
  `.svg` (sus iconos usan glifos poco comunes a proposito).
- El boton de exportar del panel derecho se ha renombrado a `Exportar a Markdown`
  para no prometer formatos que la app no genera.

### Tandas anteriores (resumen)
- **Validacion de imagenes y detalles a la vista**: `readIncomingImages` con la
  firma real del binario y extensiones bloqueadas; reintento sin imagenes cuando
  Strata no puede leerlas; `GET /api/attachments/:id` con nombre saneado y
  `Content-Disposition: inline` para verla en el navegador; panel de detalles con
  la ficha del modelo; `Ctrl+I` para ocultarlo; comprobaciones de BLOBs y de
  cabeceras de seguridad en el arnes.
- **Fase 2 (imagenes, Markdown, panel y exportar)**: tabla `attachments` con BLOB
  y cascada; adjuntar con boton, `Ctrl+V` y arrastrar; `decoratePrompt` con data
  URL; galeria bajo cada mensaje; `markdown.js` propio con boton de copiar codigo;
  columna de detalles; `favicon.svg`/`favicon.png` generados con
  `tools/make-favicon.js`; exportar a Markdown en el navegador; modo compacto con
  `Ctrl+B`; modo oscuro forzado desde la app.
- **Fase 1 (base)**: Express solo en `127.0.0.1:3000`, `strataService.js` con
  reintentos y streaming (usage / stream / sin stream), `dbService.js` con SQLite
  WAL, busqueda y titulo automatico, interfaz con historial y buscador, y 23
  comprobaciones de arnes.

## Decisiones de seguridad y de producto (registro)
- **Solo loopback**: el servidor escucha en `127.0.0.1` y `assertSafeBaseUrl`
  rechaza cualquier `STRATA_BASE_URL` que no sea `127.0.0.1`/`localhost`. Ni un
  byte sale del PC.
- **Fase 1.5 (acceso desde fuera) CANCELADA por ahora**: se pidio meter claves de
  acceso para otros dispositivos, pero mientras todo sea local no hay nada que
  proteger y anadir contraseñas solo suma puntos de fallo. La idea queda guardada:
  si algun dia se expone fuera del `127.0.0.1` hace falta HTTPS real, PIN o
  contraseña y sesion en el navegador, con reintentos limitados y cierre del
  servidor si se agotan.
- **Sin claves, sin cuentas y sin telemetria**: no hay cookies de terceros, ni
  analitica, ni recursos externos. La CSP (`default-src 'none'`,
  `connect-src 'self'`, `img-src 'self' blob:`) lo refuerza y el arnes lo comprueba.
- **Los adjuntos viven dentro de `chat.db`**: copias de seguridad de un solo
  fichero y cascada al borrar el chat. El arnes comprueba que no quedan BLOBs
  hueso ni adjuntos servidos despues de borrar.
- **Nombres de fichero limpios**: se quitan rutas, caracteres de control y demas
  ruido al guardar y al servir; el nombre original no puede abrir rutas de Windows.
- **La vision no es un interruptor**: un fallo puntual al leer una imagen no marca
  el modelo como no-vision. Solo un rechazo explicito y repetido cambia esa
  decision, y el motivo concreto se ensena al usuario.
- **De un PDF solo viaja su texto**: el binario se guarda en `chat.db` (para poder
  abrirlo despues desde la propia app), pero a Strata no le llega nunca el PDF, solo
  el texto extraido aqui. Ese texto va acotado (`MAX_PDF_TEXT_CHARS` por PDF y
  `MAX_PDF_TOTAL_CHARS` por aviso) para no reventar la ventana de contexto, el lector
  no abre conexiones ni usa librerias externas, y un PDF cifrado o escaneado se
  reporta en voz alta en vez de rellenar el contexto con ruido.

- **Nada de empaquetar ni de binarios (regla fijada el 26/10/2026)**: el respaldo
  y el traslado a otros equipos se hacen con Git y GitHub
  (`https://github.com/WOOCODEC/strata-chat-completo.git`). Prohibido generar
  `.zip`, instaladores o carpetas `packaging\` / `dist\` al terminar una tanda: se
  cambia el fuente y se comprueba con el servidor local en marcha y `npm run
  verify`. El unico limpiador admitido es `npm run clean` (`tools\clean.js`), que
  solo borra lo que vuelve a crearse solo y nunca toca `database\chat.db` ni
  `.env`. Si algun dia hiciera falta el paquete con `node.exe` embebido, se
  recupera del historial (commit `78a713c`) en vez de reconstruir el mecanismo.
- **El paquete no llevaba datos personales por defecto** *(empaquetado retirado el
  26/10/2026, ver la tanda de limpieza; la regla sigue valiendo si se recupera del
  historial de Git)*: el zip portable incluia
  codigo, dependencias y el `node.exe` embebido, pero **no** el `.env` ni
  `database\chat.db`; hacerlos viajar es decision explicita con `-WithData` /
  `-WithEnv`. El runtime se copia del Node con el que se ha probado la tanda, no se
  descarga de internet en el PC de destino, y el servidor instalado sigue escuchando
  solo en `127.0.0.1`. La instalacion vive en `%LOCALAPPDATA%` (sin tocar `Program
  Files` ni necesitar administradores) y el desinstalador guarda el historial antes
  de borrar nada si no se le pide `-Purge`.

## Aviso de integridad de este fichero
En la tanda del 25/10/2026, al editar este fichero por rangos de lineas, se perdio
todo el contenido que habia despues de la seccion "Comprobado contra Strata"
(unas 350 lineas de registros libres: redaccion detallada de tandas anteriores,
parte del registro de decisiones y el registro de estado de fases). El proyecto no
tiene git y el historial local del editor no guardaba este fichero, asi que no se
puede recuperar literalmente. Las secciones "Registro de tandas", "Decisiones de
seguridad y de producto" y "Pendiente del backlog" de este fichero estan
**reconstruidas** a partir de lo que sobrevivio y de los cambios comprobables en
el codigo y en las herramientas (`tools/`). Si conservas otra copia de
`PROGRESS.md`, se puede cotejar y volver a volcar el texto original.
Recomendacion: meter el proyecto en git (`git init` + primer commit) para que un
accidente asi tenga solucion.

## Tanda del 26/10/2026 (tarde): la hoja vieja se detecta tambien por el sello

Queja repetida: «a la derecha queda una franja vacia y `Ctrl+Mayus+R` no lo
arregla». Esta vez se diagnostico sobre el PC real en vez de adivinar:

- **Mediciones de la propia app (barra con `?medida=1`)**: `chat 1128 px`,
  `detalles 0 px`, hueco `366-372 px`. Esos numeros salen de la **maquetacion
  antigua** (panel de detalles ocupando pista sin enseñarse), no de la actual.
- **Puerto 3000 verificado con `Invoke-WebRequest`**: responde la hoja de `src/public`
  tal cual, 22475 bytes, con `--thread-max: 100%` y la centinela
  `--css-sentinel: 2026-10-26a`. El proceso que escucha (pid 35760, lanzado por el
  lanzador, `database\server.pid` coincide) serve los ficheros del disco en cada
  peticion y con `Cache-Control: no-cache, no-transform`: el servidor no tiene
  copia vieja en memoria.
- **Pestañas abiertas del perfil** (`Default\Sessions`): `http://127.0.0.1:3000/`,
  `?medida=1` y `?medida=1&ancho=completo`. No hay otro puerto de por medio (el
  8080 es la terminal Strata en Python, y el 9080 no responde como HTTP).
- **Datos guardados del usuario** (`Default\Local Storage`): existen
  `strata.inspector.off` y `strata.width.cozy`; cargando la app con una copia de
  ese perfil contra su servidor en marcha, el resultado es **`chat 1474 px · hueco
  0 px`** (con y sin `?panel=oculto`). O sea: su configuracion no produce el hueco;
  lo produce la **hoja de estilo antigua aplicada en esa pestana**.

**Hueco que quedaba en la autorreparacion**: `healStaleCss()` solo saltaba si
falta la centinela o el tope del hilo. Una hoja con la centinela puesta pero de
una arrancada anterior del servidor pasaba por buena y recargar no la cambiaba.

- **`cssStampsMatch()`** (`src/public/script.js`): el servidor reescribe el enlace
  como `style.css?v=SELO` con el sello de la arrancada en curso, y `/api/status`
  declara ese mismo sello. Si el sello enlazado no es el del servidor, la pestana
  esta repitiendo una respuesta de antes y `healStaleCss()` recarga la hoja con
  `?sin-cache=SELO-FECHA`. La hoja ya recargada empieza por el sello del servidor,
  asi que no se vuelve a recargar en cada medida (sin bucle).
- **La barra de medida (`?medida=1`) ensena los dos sellos**:
  `· hoja <sello aplicado> / servidor <sello del puerto>`. El aviso del hueco, si
  no encuentra otra causa, nombra los dos sellos en vez de decir «recarga».
- **Comprobacion nueva en el arnes** (`tools/smoke.js`): **121 comprobaciones, 0
  fallos**.
- **Verificado en Chrome real (headless, ventana 1920x1080)** con una pagina trampa
  que enlaza `style.css?v=sello-de-otra-epoca`: la app inserta la hoja nueva
  (`id="stylesheet-healed"`), quita la vieja y acaba en **`hueco al borde 0 px ·
  hueco detras del texto 0 px`** con `hoja <sello actual> / servidor <sello
  actual>`. Con el perfil real del usuario, en `http://127.0.0.1:3000/` pelado,
  tambien `0 px` y sin aviso. Con `?panel=abierto&ancho=comodo` el hueco sigue en
  `0 px` y la barra explica el modo comodo.
