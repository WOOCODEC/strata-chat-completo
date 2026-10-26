'use strict';

/**
 * tools/smoke.js - Arnes headless del proyecto.
 *
 * Levanta el servidor en un puerto de pruebas y con una base de datos
 * temporal, ejercita todos los endpoints y habla de verdad con Strata.
 * No toca tu historial real (database/chat.db).
 *
 * Uso:  node tools/smoke.js   (o npm run smoke)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = 'http://127.0.0.1:' + PORT;
const SMOKE_DB = path.join(ROOT, 'database', 'smoke-test.db');

function readOwnText(relative) {
  try {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  } catch (_) {
    return '';
  }
}

const pkg = JSON.parse(readOwnText('package.json') || '{}');

let failures = 0;
let checks = 0;
let skipped = 0;

function check(label, ok, detail) {
  checks += 1;
  if (ok) {
    console.log('  OK    ' + label + (detail ? '  ->  ' + detail : ''));
  } else {
    failures += 1;
    console.log('  FALLO ' + label + (detail ? '  ->  ' + detail : ''));
  }
}

/** Comprobacion que solo tiene sentido con el modelo encendido. */
function needsModel(label) {
  skipped += 1;
  console.log('  sin IA  ' + label);
}

async function waitServer(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(BASE + '/api/chats');
      if (res.ok) return true;
    } catch (_) {
      /* aun arrancando */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function json(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

/** Abre el stream SSE de /api/chat y devuelve los eventos acumulados. */
async function streamChat(body, knownChatId) {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ stream: true }, body)),
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.indexOf('text/event-stream') === -1) {
    const text = await res.text();
    throw new Error('la respuesta no es SSE (HTTP ' + res.status + '): ' + text.slice(0, 200));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const events = [];
  let text = '';
  let chatId = knownChatId || null;
  let meta = null;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      raw.split('\n').forEach((line) => {
        if (line.indexOf('data:') !== 0) return;
        let event = null;
        try {
          event = JSON.parse(line.slice(5));
        } catch (_) {
          return;
        }
        events.push(event);
        if (event.type === 'delta') text += event.content || '';
        if (event.type === 'reset') text = '';
        if (event.type === 'start') chatId = event.chatId || chatId;
        if (event.type === 'done') {
          meta = event.meta;
          if (event.message) text = event.message.content;
        }
      });
      sep = buffer.indexOf('\n\n');
    }
  }

  return { events, text, chatId, meta };
}

/** Un PNG de 2x2 valido, para probar los adjuntos sin ficheros raros. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDAwMAAAA4FA1jJhRYAAAAASUVORK5CYII=';

/** Un PDF minimo pero real, con texto, para probar los documentos sin ficheros raros. */
function tinyPdfBase64() {
  const chunk = 'BT /F1 12 Tf 10 70 Td (hola pdf MANZANA-VERDE-42) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 200 100] /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(chunk, 'ascii') + ' >>\nstream\n' + chunk + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  objs.forEach((body, index) => {
    out += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  out += 'trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n';
  return Buffer.from(out, 'latin1').toString('base64');
}
const TINY_PDF_BASE64 = tinyPdfBase64();

/** Comprobaciones rapidas, sin red: nombre de fichero y errores de vision. */
function offlineChecks() {
  const mod = require('../src/server.js');
  check('safeFilename quita rutas y comillas', mod.safeFilename('../../carpetas/"imagen" rara.png') === 'imagen rara.png', JSON.stringify(mod.safeFilename('../../carpetas/"imagen" rara.png')));
  check('safeFilename sin nombre -> imagen', mod.safeFilename('   ') === 'imagen', JSON.stringify(mod.safeFilename('   ')));
  check('safeFilename recorta nombres enormes', mod.safeFilename('a'.repeat(300) + '.png').length <= 120, String(mod.safeFilename('a'.repeat(300) + '.png').length));
  check('error de proyector se toma como falta de vision', mod.looksLikeVisionCapabilityError(new Error('the model has no projector for vision')));
  check('error de red no marca vision=false', !mod.looksLikeVisionCapabilityError(new Error('socket hang up')));
  check('error con la palabra imagen si se reintenta', mod.looksLikeImageError(new Error('invalid image payload')));
  check('el historial avisa de la imagen adjuntada', JSON.stringify(mod.buildPrompt([{ role: 'user', content: 'mira', attachments: [{ name: 'gato.png' }] }])).includes('imagen adjuntada: gato.png'));
  check('el prompt multimodal usa data: local', JSON.stringify(mod.decoratePrompt([{ role: 'user', content: 'hola' }], [{ mime: 'image/png', blob: Buffer.from('x') }])).includes('data:image/png;base64,'));

  const pdf = require('../src/pdfService.js');
  const pdfOut = pdf.extractPdfText(Buffer.from(TINY_PDF_BASE64, 'base64'));
  check('pdf: saca el texto de un PDF minimo', pdfOut.ok && /hola pdf/.test(pdfOut.text), JSON.stringify(pdfOut.text || pdfOut.error || ''));
  check('pdf: la cabecera si se reconoce', pdf.looksLikePdf(Buffer.from('%PDF-1.4 x', 'latin1')));
  check('pdf: una foto no pasa por PDF', !pdf.looksLikePdf(Buffer.from(TINY_PNG_BASE64, 'base64')));
  check('pdf: sin paginas legibles lo dice claro', /paginas legibles/.test(String(pdf.extractPdfText(Buffer.from('%PDF-1.4\ntrailer\n<< /Size 1 >>\n%%EOF', 'latin1')).error || '')));

  const md = require('../src/public/markdown.js');
  const sample = md.renderMarkdown([
    '# titulo',
    '',
    '- uno',
    '- [ ] tarea pendiente',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '<script>alert(1)</script>',
    '',
    '[pulsa](javascript:alert(1)) y [web](https://127.0.0.1)',
    '',
    '`codigo` y **negrita**',
  ].join('\n'));
  check('markdown: titulos y listas', sample.includes('<h1') && sample.includes('<li>uno</li>'));
  check('markdown: tablas', sample.includes('<table') && sample.includes('<td>1</td>'));
  check('markdown: casillas de tarea', sample.includes('md-task'));
  check('markdown: escapa el HTML del modelo', !/<script>/i.test(sample) && sample.includes('&lt;script&gt;'));
  check('markdown: bloquea enlaces javascript:', !/href="javascript:/i.test(sample) && sample.includes('href="https://127.0.0.1"'));
  check('markdown: codigo y negrita', sample.includes('<code') && sample.includes('<strong>negrita</strong>'));
}

async function main() {
  offlineChecks();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(SMOKE_DB + suffix)) fs.unlinkSync(SMOKE_DB + suffix);
  }

  console.log('Arrancando el servidor de pruebas en ' + BASE + ' ...');
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: './database/smoke-test.db',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    const up = await waitServer(20000);
    check('el servidor escucha en 127.0.0.1:' + PORT, up, up ? '' : 'no respondio en 20 s');
    if (!up) throw new Error('el servidor no se levanto');

    // 1) Interfaz estatica y endurecimiento
    const page = await fetch(BASE + '/');
    const html = await page.text();
    check('GET / devuelve la interfaz', page.status === 200 && html.includes('Strata'), 'HTTP ' + page.status);
    check('la interfaz no carga recursos externos', !/<script[^>]+src=["']https?:/i.test(html) && !/<link[^>]+href=["']https?:/i.test(html));
    check('Content-Security-Policy restrictiva', String(page.headers.get('content-security-policy') || '').includes("default-src 'none'"));
    check('la CSP permite imagenes locales y data:', String(page.headers.get('content-security-policy') || '').includes("img-src 'self' data:"));
    const css = await fetch(BASE + '/style.css');
    const js = await fetch(BASE + '/script.js');
    check('style.css y script.js se sirven', css.status === 200 && js.status === 200, css.status + '/' + js.status);

    // 1a-bis) Enlaces limpios: la portada enlaza la hoja y los scripts TAL CUAL
    //         (href="style.css", src="script.js", src="markdown.js"), sin
    //         consulta de version. Lo que evita la copia rancia no es una URL
    //         distinta sino «Cache-Control: no-store»: el navegador no guarda
    //         copia y por eso, tras reiniciar el PC, la pestana restaurada no
    //         puede pintar la interfaz de otra tanda.
    check(
      'la portada enlaza hoja y scripts limpios, sin consulta de version',
      /href="style\.css"/.test(html) && /src="script\.js"/.test(html) &&
        /src="markdown\.js"/.test(html) &&
        !/style\.css\?/.test(html) && !/script\.js\?/.test(html) &&
        !/markdown\.js\?/.test(html),
      'href="style.css" - src="script.js" - src="markdown.js"'
    );
    check(
      'la portada no se guarda en el navegador (no-store)',
      /no-store/.test(String(page.headers.get('cache-control') || '')) &&
        String(page.headers.get('pragma') || '') === 'no-cache' &&
        String(page.headers.get('expires') || '') === '0',
      String(page.headers.get('cache-control')) + ' - pragma ' + String(page.headers.get('pragma'))
    );
    const stampProbe = await json('GET', '/api/status');
    const buildStamp = String(stampProbe.data.server.build || '');
    check(
      'el servidor informa de su sello de arrancada en /api/status',
      buildStamp.length > 0 &&
        buildStamp.indexOf(String(stampProbe.data.server.revision)) === 0,
      'build ' + buildStamp
    );
    const queryCss = await fetch(BASE + '/style.css?prueba=1');
    check(
      'una consulta rara en la ruta del fichero no rompe nada',
      queryCss.status === 200 && (queryCss.headers.get('content-type') || '').indexOf('text/css') !== -1,
      queryCss.status + ' ' + queryCss.headers.get('content-type')
    );
    const launcherCmd = readOwnText('start-strata-chat.cmd');
    check(
      'el lanzador de la raiz delega en tools/server.ps1',
      launcherCmd.indexOf('server.ps1') !== -1 && !/^start\s+""\s+http/m.test(launcherCmd) && !/^node\s+src\\server\.js/m.test(launcherCmd),
      'un unico modo de arrancar'
    );
    const launcherPs = readOwnText('tools/server.ps1');
    check(
      'el lanzador abre la pestana solo cuando el puerto responde',
      launcherPs.indexOf('function Open-Page') !== -1 && /if \(\$Open\) \{ Open-Page \$port \}/.test(launcherPs),
      'nunca antes de que el servidor escuche'
    );
    check(
      'el lanzador para y relanza el servidor de una tanda anterior',
      launcherPs.indexOf('function Stale-Owner') !== -1 && /if \(Stale-Owner \$port\)/.test(launcherPs),
      'asi la pestana nueva muestra siempre la version nueva'
    );
    check(
      'el lanzador detecta si el puerto lo tiene OTRO programa y se pasa de puerto',
      launcherPs.indexOf('function Owner-Report') !== -1 &&
        /\$report -and -not \$report\.ours/.test(launcherPs) &&
        /\$env:PORT = \[string\]\$port/.test(launcherPs),
      'la pestana no puede abrir la interfaz de otro proyecto'
    );
    check(
      'la hoja de estilo no se guarda en el navegador (no-store, sigue con ETag)',
      /no-store/.test(String(css.headers.get('cache-control') || '')) && Boolean(css.headers.get('etag')),
      String(css.headers.get('cache-control')) + ' · etag ' + String(css.headers.get('etag'))
    );

    // 1b) Favicon y renderizador de markdown
    const svg = await fetch(BASE + '/favicon.svg');
    const png = await fetch(BASE + '/favicon.png');
    const mdJs = await fetch(BASE + '/markdown.js');
    check('favicon.svg se sirve', svg.status === 200 && (svg.headers.get('content-type') || '').indexOf('svg') !== -1, svg.status + ' ' + svg.headers.get('content-type'));
    check('favicon.png se sirve como imagen', png.status === 200 && (png.headers.get('content-type') || '').indexOf('image/png') !== -1, png.status + ' ' + png.headers.get('content-type'));
    check('el HTML enlaza el favicon', /rel=[\"']icon/.test(html));
    check('markdown.js se sirve y se carga antes que script.js', mdJs.status === 200 && html.indexOf('markdown.js') < html.indexOf('script.js'), 'HTTP ' + mdJs.status);
    check('el panel de detalles esta en la interfaz', html.includes('id=\"inspector\"') && html.includes('id=\"btn-inspector\"'));
    check('hay boton de adjuntar imagen', html.includes('id=\"btn-attach\"') && html.includes('id=\"file-input\"'));
    check('la interfaz tambien acepta PDF', html.indexOf('application/pdf') !== -1 && html.includes('Adjuntar imagen o PDF'), 'accept y boton actualizados');
    check('la interfaz prepara la lectura en voz alta', html.includes('id=\"insp-voice\"') && html.includes('id=\"insp-api\"'));

    const cssText = await css.text();
    const jsText = await js.text();
    check('script.js trae la sintesis de voz y el aviso de documentos', jsText.includes('speechSynthesis') && jsText.includes('Leer en voz alta') && jsText.includes('notImageHint'));
    check(
      'script.js lee el PDF en local y lo manda como documento',
      jsText.includes('function readDocument') && jsText.includes('function docNode') && jsText.includes('body.documents =') && jsText.includes('maxPdfBytes'),
      'lector en el navegador, ficha de documento y envio aparte'
    );
    check('style.css pinta las fichas de documento', cssText.includes('.attach-doc') && cssText.includes('.doc-mark'), 'tarjeta con marca PDF');
  check('script.js calcula el paquete contando imagenes y PDF', jsText.includes('maxImagesPerMessage() * maxImageBytes()') && jsText.includes('maxPdfsPerMessage() * maxPdfBytes()'), 'el aviso previo ya no se queda en un tope fijo de 8 MB');
    check(
      'la voz de lectura evita las voces que salen a internet',
      jsText.includes('function isCloudVoice') &&
        jsText.includes('voices.filter((voice) => !isCloudVoice(voice))') &&
        jsText.includes("localSetting(VOICE_CLOUD_KEY, '0') === '1'"),
      'solo se usan voces locales salvo permiso explicito'
    );
    check('la interfaz trae selector de voz y control de velocidad', html.includes('id="voice-pick"') && html.includes('id="voice-rate"') && html.includes('id="voice-cloud"'), 'panel de detalles');
    check(
      'la velocidad de lectura va del 100% al 200%',
      /id="voice-rate"[\s\S]*?min="100"[\s\S]*?max="200"/.test(html) &&
        jsText.includes('const RATE_MIN = 100;') &&
        jsText.includes('const RATE_MAX = 200;') &&
        jsText.includes('line.rate = voiceRateFactor();'),
      'tope en el doble de velocidad'
    );
    check(
      'script.js cuida la prosodia y el troceado de la lectura',
      jsText.includes('function prosodyFor(') && jsText.includes('function speechChunks(') && jsText.includes('Number(limit) || 320') && jsText.includes('function speakQueued()'),
      'trozos cortos, pausas y tono variable'
    );
    check('style.css pinta los ajustes de voz', cssText.includes('.voice-select') && cssText.includes('.voice-rate') && cssText.includes('.voice-check'), 'desplegable, slider y aviso');
    check('las fotos grandes se reducen antes de enviarlas', jsText.includes('shrinkToLimit') && jsText.includes('IMAGE_MAX_EDGE') && jsText.includes('bodyLimitBytes'));
    const narrowBlock = /@media \(max-width: 980px\)[\s\S]*?\n\}/.exec(cssText);
    check(
      'el panel de detalles sigue accesible en ventana estrecha',
      Boolean(narrowBlock) && !/\.inspector\s*\{[^}]*display:\s*none/.test(narrowBlock[0]),
      narrowBlock ? 'bloque 980px revisado' : 'no existe el bloque 980px'
    );

    // 1c) Maquetacion fluida: nada de topes fijos que dejen hueco a la derecha.
    check(
      'la interfaz usa una medida fluida compartida',
      /--thread-max:\s*100%/.test(cssText) &&
        /--frame:\s*clamp\(10px,\s*1\.1vw,\s*20px\)/.test(cssText) &&
        (cssText.match(/var\(--frame\)/g) || []).length >= 4,
      'cabecera, mensajes y cuadro comparten el mismo canto'
    );
    check(
      'la cadena de contenedores llega hasta el borde derecho, sin topes fijos',
      /--thread-max:\s*100%\s*;/.test(cssText) &&
        !/--thread-max:\s*\d+px\s*;/.test(cssText) &&
        !/--thread-max:\s*clamp\(/.test(cssText) &&
        /html,\s*body\s*\{[\s\S]*?max-width:\s*none/.test(cssText) &&
        /body\s*\{[^}]*width:\s*100%/.test(cssText) &&
        /\.thread\s*\{[^}]*max-width:\s*var\(--thread-max\)/.test(cssText) &&
        !/\.thread\s*\{[^}]*max-width:\s*\d+px/.test(cssText),
      'el chat se estira de borde a borde por defecto'
    );
    check(
      'recortar la lectura es opcional (boton «Ancho comodo»), no el defecto',
      /:root\s*\{[^}]*--thread-max:\s*100%/.test(cssText) &&
        /body\.width-cozy\s*\{[^}]*--thread-max:\s*100%/.test(cssText) &&
        !/--thread-max:\s*\d+px/.test(cssText) &&
        html.includes('id="btn-width"') &&
        jsText.includes("const WIDTH_KEY = 'strata.width.cozy';") &&
        jsText.includes('function toggleWidthMode()') &&
        jsText.includes('function restoreWidthMode()'),
      'ningun tope fijo de pixeles en la hoja: el modo comodo solo cambia la tipografia, nunca el ancho'
    );
    check(
      'la direccion puede forzar el ancho (?ancho=completo o ?ancho=comodo) y lo recuerda',
      jsText.includes('function widthModeFromUrl()') &&
        /ancho=\(completo\|comodo\)/.test(jsText) &&
        jsText.includes("if (forced === 'completo') cozy = false;") &&
        jsText.includes("window.localStorage.setItem(WIDTH_KEY, cozy ? '1' : '0');"),
      'el lanzador garantiza el 100% pase lo que este memorizado el navegador'
    );
    check(
      'el lanzador abre la pestana a ancho=completo y SIN barra de medida',
      /\/\?ancho=completo'/.test(launcherPs) &&
        !/\?medida=1&/.test(launcherPs) &&
        /if \(\$Medida\) \{ \$url \+= '&medida=1' \}/.test(launcherPs),
      'la interfaz se abre limpia; el diagnostico solo si se pide con -Medida o ?medida=1'
    );
    check(
      'la barra de medida solo aparece si se la pide, y ?medida=0 la quita',
      jsText.includes('function measureBarWanted()') &&
        jsText.includes('if (/[?&]medida=0/.test(search)) return false;') &&
        jsText.includes('if (!measureBarWanted()) {'),
      'es una herramienta de diagnostico, no parte de la interfaz: nadie quiere esa franja abajo'
    );
    check(
      'la portada sale como HTML y no como error del servidor',
      /<!DOCTYPE html>/i.test(html) &&
        !html.includes('Error interno del servidor') &&
        readOwnText('src/server.js').includes('const shellCache = {'),
      'fallo real del 26/10: al quitar el sellado ?v= se borro la cache de la portada y «/» devolvia {"ok":false,...}'
    );
    check(
      'el servidor se lanza sin ventana y con la salida escrita en el disco',
      launcherPs.includes('-RedirectStandardOutput') &&
        launcherPs.includes('if ($Consola)') &&
        launcherPs.includes("'server-error.log'"),
      'la consola negra ERA el servidor: al cerrarla la pestana se quedaba para siempre en «Comprobando conexion»'
    );
    check(
      'start-strata-chat.cmd ya no se queda esperando una tecla',
      !/(?:\r?\n)[ \t]*pause[ \t]*(?:\r?\n)*$/.test(launcherCmd) && launcherCmd.includes('timeout /t 8'),
      'pulsar una tecla cerraba la ventana y se llevaba el servicio por delante: ahora se cierra solo en 8 s'
    );
    check(
      'el lanzador abre una direccion distinta en cada arranque (&arranque=...)',
      /&arranque=' \+ \[DateTimeOffset\]::UtcNow\.ToUnixTimeMilliseconds\(\)/.test(launcherPs) &&
        /\$url \+= '&sello='/.test(launcherPs),
      'URL jamas vista: el navegador no puede responder de su memoria ni tras reiniciar el PC'
    );
    check(
      'el diagnostico mide tambien el hueco detras de la columna de texto',
      jsText.includes('gapColumn') &&
        jsText.includes('gapWindow') &&
        /gap:\s*Math\.max\(gapWindow,\s*gapColumn\)/.test(jsText) &&
        jsText.includes('scroll.offsetWidth - scroll.clientWidth'),
      'antes el modo comodo salia en verde con media pantalla libre: ceguera del diagnostico'
    );
    check(
      'el codigo esta limpio: ni auto-reparacion de hoja ni contrato inyectado',
      !jsText.includes('function healStaleCss(') &&
        !jsText.includes('function installLayoutContract(') &&
        !jsText.includes('function hardenLayout(') &&
        !jsText.includes('function applyHardening(') &&
        !jsText.includes('function explainGap(') &&
        !jsText.includes('function showTopNote(') &&
        !jsText.includes('function freshBootUrl(') &&
        !jsText.includes('CSS_SENTINEL') &&
        !cssText.includes('--css-sentinel'),
      'el hueco de 384 px lo causaba una extension del navegador: los parches fuera'
    );
    check(
      'el boton de la cabecera dice cuantos px ocupa el panel de detalles',
      jsText.includes('function paintInspectorButton(details)') &&
        jsText.includes("button.textContent = 'Ocultar detalles (-' + details + ' px)';") &&
        jsText.includes('paintInspectorButton(metrics.details);') &&
        /flex: 0 0 clamp\(238px,\s*18vw,\s*336px\)/.test(cssText),
      'la «parte derecha libre» era el panel abierto a 372 px con un fondo casi igual al del chat'
    );
    check(
      'el diagnostico distingue el panel de detalles de un hueco real',
      jsText.includes('(no es hueco: es el panel)') &&
        jsText.includes('HUECO REAL al borde de la ventana') &&
        jsText.includes('no es un hueco: es el panel;'),
      'antes salia «detalles 372 px» junto a «hueco 0 px» y nadie sabia de quien eran esos 372 px'
    );
    check(
      'la interfaz se reconecta sola cuando el servidor vuelve',
      jsText.includes('function armStatusTimer()') &&
        jsText.includes('serverWasDown ? 4000 : 60000') &&
        jsText.includes("'Buscando el servidor de este PC...'") &&
        jsText.includes('if (state.loadError) {') &&
        jsText.includes('armStatusTimer();'),
      'el servidor ya no tiene ventana: la pestana reintenta cada 4 s y trae el historial al volver'
    );
    check(
      'la direccion tambien puede forzar el panel de detalles (?panel=abierto u ?panel=oculto)',

      jsText.includes('function panelModeFromUrl()') &&
        /panel=\(abierto\|oculto\)/.test(jsText) &&
        jsText.includes("if (forced === 'oculto') off = true;") &&
        jsText.includes("window.localStorage.setItem(INSPECTOR_KEY, off ? '1' : '0');"),
      'permite reproducir y verificar el caso exacto que esta viendo cada usuario'
    );
    check(
      'la app mide su propia pantalla y lo enseña en el panel de detalles',
      jsText.includes('function measureLayout()') &&
        jsText.includes('function paintMeasureBar(') &&
        jsText.includes("function serverBuildStamp()") &&
        cssText.includes('.measure-bar') &&
        html.includes('id="insp-viewport"') &&
        html.includes('id="insp-width"') &&
        html.includes('id="insp-build"') &&
        /id="stylesheet"/.test(html),
      'panel de detalles + barra opcional con ?medida=1'
    );
    check(
      'cabecera, hilo y cuadro de escritura comparten tambien el canto derecho',
      /\.chat-header\s*\{[^}]*padding:\s*12px var\(--frame\);/.test(cssText) &&
        /\.messages\s*\{[^}]*padding:\s*20px var\(--frame\);/.test(cssText) &&
        /\.composer\s*\{[^}]*padding:\s*12px var\(--frame\);/.test(cssText),
      'margen simetrico: el cuadro no se sale del canto del hilo'
    );
    check(
      'la respuesta del asistente ocupa todo el ancho del hilo',
      /\.msg\.is-assistant \.bubble\s*\{[^}]*width:\s*100%/.test(cssText) &&
        /\.msg\.is-assistant\s*\{[^}]*align-self:\s*stretch/.test(cssText) &&
        !/\.thread\s*\{[^}]*max-width:\s*900px/.test(cssText),
      'adios al tope de 900px y a la burbuja pegada a la izquierda'
    );
    check(
      'barra lateral y panel derecho se adaptan a la ventana',
      (cssText.match(/flex: 0 0 clamp\(/g) || []).length >= 2 &&
        !/\.sidebar\s*\{[^}]*width:\s*296px/.test(cssText) &&
        !/\.inspector\s*\{[^}]*width:\s*320px/.test(cssText) &&
        /@media \(max-width: 520px\)/.test(cssText),
      'anchos con clamp() y punto de corte telefonico'
    );

    // 1d) Copiado: la respuesta y cada bloque de codigo, con su boton.
    const mdText = await mdJs.text();
    check(
      'cada respuesta lleva boton de copiar',
      jsText.includes('function copyButton') &&
        jsText.includes('function answerActions') &&
        jsText.includes("'Copiar respuesta'") &&
        jsText.includes("'Copiar sin formato'") &&
        jsText.includes('function plainForCopy'),
      'copiar con formato y como texto corriente'
    );
    check(
      'cada bloque de codigo lleva su boton y su lenguaje',
      mdText.includes('data-copy-block') && mdText.includes('md-codebar') && mdText.includes('md-codelang') && jsText.includes('wireBlockCopy'),
      'cabecera del bloque con etiqueta y «Copiar bloque»'
    );
    check(
      'el copiado funciona sin scripts embebidos ni permisos raros',
      jsText.includes('navigator.clipboard') && jsText.includes('function legacyCopy') && !/onclick=/.test(mdText),
      'portapapeles moderno + plan B con execCommand'
    );

    // Los ficheros propios no se guardan: con no-store no existe la copia rancia.
    const jsCache = String(js.headers.get('cache-control') || '');
    check('los ficheros propios no se guardan en el navegador', /no-store/.test(jsCache) && Boolean(js.headers.get('etag')), jsCache);
    const statusResponse = await fetch(BASE + '/api/status');
    check(
      'la respuesta de /api/status tampoco se guarda (si no, el sello viejo pareceria el bueno)',
      /no-store/.test(String(statusResponse.headers.get('cache-control') || '')),
      String(statusResponse.headers.get('cache-control'))
    );

    // Arranque y cierre: sin script de parada no hay forma de limpiar servidores viejos.
    const launcherText = readOwnText(path.join('tools', 'server.ps1'));
    const pkgScripts = (pkg.scripts || {});
    check(
      'el arranque y el cierre tienen su script',
      Boolean(pkgScripts['start:open']) && Boolean(pkgScripts.stop) && Boolean(pkgScripts.serve) && launcherText.includes('-Stop') && launcherText.includes('server.pid'),
      'npm run start:open / stop / serve'
    );
    check(
      'el arnes de voz esta registrado en npm',
      Boolean(pkgScripts.voicecheck) && String(pkgScripts.verify || '').includes('voice-check.js'),
      'npm run voicecheck y dentro de npm run verify'
    );

    // 2) Estado y conexion con Strata
    const status = await json('GET', '/api/status');
    const strata = status.data && status.data.strata;
    const strataReachable = Boolean(strata && strata.reachable);
    check('GET /api/status', status.status === 200 && Boolean(status.data && status.data.db));
    if (strataReachable) {
      check('Strata accesible desde el servidor', true, strata.model + ' en ' + strata.latencyMs + ' ms');
    } else {
      needsModel('Strata accesible desde el servidor');
      console.log('        (Strata no responde: ' + (strata && strata.error ? strata.error : 'sin datos') + ')');
    }
    check('la URL base es solo loopback', Boolean(strata && /^http:\/\/(127\.0\.0\.1|localhost):/.test(strata.baseUrl)), strata && strata.baseUrl);

    let testChatId = null;
    let attachmentId = null;

    if (strataReachable) {
      console.log('\n  Modelo en uso: ' + strata.model + '  (vision: ' + (strata.vision === true ? 'si' : strata.vision === false ? 'no' : 'sin declarar') + ')');
    } else {
      console.log('\n  Strata no esta accesible: se saltan las comprobaciones que dependen del modelo.');
    }

    if (strataReachable) {
    // 3) Chat con streaming real contra Strata
    const streamed = await streamChat({ content: 'Responde exactamente con una sola palabra: vale' });
    check('POST /api/chat emite eventos SSE', streamed.events.length > 0, streamed.events.map((e) => e.type).join(','));
    check('el modelo responde texto', streamed.text.trim().length > 0, JSON.stringify(streamed.text.trim().slice(0, 60)));
    check('se crea el chat automaticamente', Boolean(streamed.chatId));
    check('el evento done trae tiempo y modelo', Boolean(streamed.meta && streamed.meta.elapsedMs && streamed.meta.model), streamed.meta && streamed.meta.model);

    // 4) Persistencia del historial
    const loaded = await json('GET', '/api/chats/' + streamed.chatId);
    const roles = ((loaded.data && loaded.data.messages) || []).map((m) => m.role).join(',');
    check('quedan 2 mensajes (user + assistant)', roles === 'user,assistant', roles);

    // 5) Segunda ronda con contexto
    const follow = await streamChat({ chatId: streamed.chatId, content: 'Repite solo la palabra anterior, sin mas.' }, streamed.chatId);
    check('segunda ronda en el mismo chat', follow.events.some((e) => e.type === 'done'), follow.text.trim().slice(0, 40));
    const loaded2 = await json('GET', '/api/chats/' + streamed.chatId);
    check('el chat acumula 4 mensajes', ((loaded2.data && loaded2.data.messages) || []).length === 4, String(((loaded2.data && loaded2.data.messages) || []).length));
    check('el chat se titulo solo con el primer mensaje', Boolean(loaded2.data && loaded2.data.chat && /vale/i.test(loaded2.data.chat.title)), loaded2.data && loaded2.data.chat && loaded2.data.chat.title);
    testChatId = streamed.chatId;
    } else {
      needsModel('POST /api/chat emite eventos SSE');
      needsModel('el modelo responde texto');
      needsModel('se crea el chat automaticamente');
      needsModel('el evento done trae tiempo y modelo');
      needsModel('quedan 2 mensajes (user + assistant)');
      needsModel('segunda ronda en el mismo chat');
      needsModel('el chat acumula 4 mensajes');
      needsModel('el chat se titulo solo con el primer mensaje');
    }

    // 6) Limites de adjuntos, revision de la API y estado de la vision
    const limits = status.data && status.data.limits;
    const apiInfo = (status.data && status.data.server) || {};
    const apiLimits = limits || {};
    check('la API se identifica con su revision', typeof apiInfo.revision === 'string' && apiInfo.revision.length > 2, String(apiInfo.revision || '(sin revision: servidor viejo)'));
    check('la API publica el tamano maximo del paquete', Number.isFinite(apiLimits.bodyLimitBytes) && apiLimits.bodyLimitBytes > 1024 * 1024, apiLimits.bodyLimitBytes + ' bytes');
    check('el estado publica los limites de imagen', Boolean(limits && limits.maxImageBytes && Array.isArray(limits.imageTypes) && limits.imageTypes.length), limits && limits.imageTypes && limits.imageTypes.join(','));
    check('el estado informa del soporte de vision', Boolean(status.data.strata) && 'vision' in status.data.strata, 'vision: ' + (status.data.strata && status.data.strata.vision));
    check(
      'el estado publica los limites de PDF',
      Boolean(limits && Number.isFinite(limits.maxPdfBytes) && Number.isFinite(limits.maxPdfPerMessage) && Array.isArray(limits.pdfTypes) && limits.pdfTypes.indexOf('application/pdf') !== -1),
      limits && Array.isArray(limits.pdfTypes) ? limits.pdfTypes.join(',') + ' x ' + limits.maxPdfPerMessage : 'sin pdfTypes'
    );

    if (strataReachable && testChatId) {
    const withImage = await streamChat({
      chatId: testChatId,
      content: 'Describe en una palabra esta imagen.',
      images: [{ name: 'pixel.png', mime: 'image/png', data: TINY_PNG_BASE64 }],
    });
    check('mensaje con imagen responde igualmente', withImage.events.some((e) => e.type === 'done'), withImage.text.trim().slice(0, 40));

    const withImageChat = await json('GET', '/api/chats/' + testChatId);
    const userMessages = ((withImageChat.data && withImageChat.data.messages) || []).filter((m) => m.role === 'user');
    const attached = (userMessages[userMessages.length - 1] && userMessages[userMessages.length - 1].attachments) || [];
    check('la imagen queda guardada en el chat', attached.length === 1 && attached[0].name === 'pixel.png', JSON.stringify(attached));

    if (attached.length) {
      attachmentId = attached[0].id;
      const served = await fetch(BASE + '/api/attachments/' + attachmentId);
      const servedBytes = Buffer.from(await served.arrayBuffer());
      check(
        'GET /api/attachments/:id devuelve los mismos bytes',
        served.status === 200 && servedBytes.equals(Buffer.from(TINY_PNG_BASE64, 'base64')),
        served.status + ' ' + servedBytes.length + ' bytes ' + served.headers.get('content-type')
      );
      check('la descarga conserva el nombre original', String(served.headers.get('content-disposition') || '').includes('pixel.png'), served.headers.get('content-disposition'));
      check('el adjunto se ve en el navegador, no se descarga', String(served.headers.get('content-disposition') || '').startsWith('inline'), served.headers.get('content-disposition'));
    }

    const nastyName = await streamChat({
      chatId: testChatId,
      content: 'Otra vez la misma imagen.',
      images: [{ name: '../../carpetas/imagen"mal.png', mime: 'image/png', data: TINY_PNG_BASE64 }],
    });
    check('nombre raro no rompe el envio', nastyName.events.some((e) => e.type === 'done'), nastyName.events.map((e) => e.type).join(','));
    const nastyChat = await json('GET', '/api/chats/' + testChatId);
    const nastyUser = (((nastyChat.data && nastyChat.data.messages) || []).filter((m) => m.role === 'user') || []).pop();
    const nastyAttached = (nastyUser && nastyUser.attachments) || [];
    const safeName = nastyAttached.length ? nastyAttached[0].name : '';
    check('el nombre guardado queda limpio', safeName === 'imagenmal.png', JSON.stringify(safeName));

    // 6c) Un PDF de verdad: se le saca el texto en local y queda guardado con su cuenta.
    const pdfTurn = await streamChat({
      chatId: testChatId,
      content: 'Copia exactamente el texto del PDF adjunto.',
      documents: [{ name: 'nota.pdf', mime: 'application/pdf', data: TINY_PDF_BASE64 }],
    });
    check('mensaje con PDF responde', pdfTurn.events.some((e) => e.type === 'done'), pdfTurn.events.map((e) => e.type).join(','));
    const pdfNotices = pdfTurn.events.filter((e) => e.type === 'notice').map((e) => e.notice);
    check('el aviso de lo leido en el PDF llega en el stream', pdfNotices.some((notice) => /caracteres leidos/.test(String(notice))), JSON.stringify(pdfNotices).slice(0, 120));
    const pdfStart = pdfTurn.events.filter((e) => e.type === 'start').pop();
    const startDocs = ((pdfStart && pdfStart.userMessage && pdfStart.userMessage.attachments) || []).filter((a) => a.mime === 'application/pdf');
    check('el evento start ya trae lo leido del PDF', startDocs.length === 1 && Number(startDocs[0].text_chars) > 0, JSON.stringify(startDocs).slice(0, 150));
    const pdfChat = await json('GET', '/api/chats/' + testChatId);
    const pdfUser = (((pdfChat.data && pdfChat.data.messages) || []).filter((m) => m.role === 'user') || []).pop();
    const savedDocs = ((pdfUser && pdfUser.attachments) || []).filter((a) => a.mime === 'application/pdf');
    check('el PDF queda guardado como documento', savedDocs.length === 1 && savedDocs[0].name === 'nota.pdf', JSON.stringify(savedDocs).slice(0, 150));
    check('la ficha guarda cuantos caracteres se han leido', savedDocs.length === 1 && Number(savedDocs[0].text_chars) > 0, String(savedDocs[0] && savedDocs[0].text_chars));
    check('el modelo puede copiar lo que decia el PDF', /MANZANA/i.test(pdfTurn.text || '') || /hola pdf/i.test(pdfTurn.text || ''), JSON.stringify(String(pdfTurn.text || '').slice(0, 120)));
    } else {
      needsModel('mensaje con imagen responde igualmente');
      needsModel('la imagen queda guardada en el chat');
      needsModel('GET /api/attachments/:id devuelve los mismos bytes');
      needsModel('la descarga conserva el nombre original');
      needsModel('el adjunto se ve en el navegador, no se descarga');
      needsModel('nombre raro no rompe el envio');
      needsModel('el nombre guardado queda limpio');
      needsModel('mensaje con PDF responde');
      needsModel('el aviso de lo leido en el PDF llega en el stream');
      needsModel('el evento start ya trae lo leido del PDF');
      needsModel('el PDF queda guardado como documento');
      needsModel('la ficha guarda cuantos caracteres se han leido');
      needsModel('el modelo puede copiar lo que decia el PDF');
    }

    const missingAttachment = await fetch(BASE + '/api/attachments/00000000-0000-4000-8000-000000000000');
    check('adjunto inexistente -> 404', missingAttachment.status === 404, 'HTTP ' + missingAttachment.status);

    const fakeImage = await json('POST', '/api/chat', {
      chatId: testChatId,
      content: 'esto no es una imagen',
      images: [{ name: 'nota.png', mime: 'image/png', data: Buffer.from('esto es texto', 'utf8').toString('base64') }],
    });
    check('fichero que no es imagen -> 400 claro', fakeImage.status === 400 && /imagen/.test(String(fakeImage.data && fakeImage.data.error)), fakeImage.status + ' ' + (fakeImage.data && fakeImage.data.error));

    const datalessImage = await json('POST', '/api/chat', {
      chatId: testChatId,
      content: 'sin datos',
      images: [{ name: 'x.png', mime: 'image/png' }],
    });
    check('imagen sin datos -> 400', datalessImage.status === 400, 'HTTP ' + datalessImage.status);

    // Documentos: se comprueban igual que las imagenes, sin necesitar el modelo.
    const fakeDoc = await json('POST', '/api/chat', {
      content: 'esto no es un PDF',
      documents: [{ name: 'nota.pdf', mime: 'application/pdf', data: Buffer.from('esto es texto', 'utf8').toString('base64') }],
    });
    const fakeDocText = String((fakeDoc.data && fakeDoc.data.error) || '');
    check('fichero que no es PDF -> 400 claro', fakeDoc.status === 400 && /PDF/.test(fakeDocText), fakeDoc.status + ' ' + fakeDocText.slice(0, 90));
    const wrongDocType = await json('POST', '/api/chat', {
      content: 'tipo equivocado',
      documents: [{ name: 'nota.doc', mime: 'application/msword', data: TINY_PDF_BASE64 }],
    });
    check('un tipo que no sea PDF -> 400 claro', wrongDocType.status === 400 && /PDF/.test(String((wrongDocType.data && wrongDocType.data.error) || '')), wrongDocType.status + ' ' + String((wrongDocType.data && wrongDocType.data.error) || '').slice(0, 90));
    const listDoc = await json('POST', '/api/chat', { content: 'documents raros', documents: 'una cadena' });
    check('documents que no es lista -> 400', listDoc.status === 400, 'HTTP ' + listDoc.status);
    const tooManyPdfs = [];
    for (let i = 0; i <= Number(apiLimits.maxPdfPerMessage || 4); i += 1) tooManyPdfs.push({ name: 'nota' + i + '.pdf', mime: 'application/pdf', data: TINY_PDF_BASE64 });
    const manyDocs = await json('POST', '/api/chat', { content: 'demasiados pdf', documents: tooManyPdfs });
    const manyDocText = String((manyDocs.data && manyDocs.data.error) || '');
    check('demasiados PDF -> 400 con el maximo claro', manyDocs.status === 400 && /maximo/.test(manyDocText), manyDocs.status + ' ' + manyDocText.slice(0, 90));
    const fatPdf = 'A'.repeat(Math.ceil((Number(apiLimits.maxPdfBytes) * 4) / 3) + 4000);
    const fatDoc = await json('POST', '/api/chat', { content: 'pdf enorme', documents: [{ name: 'gordo.pdf', mime: 'application/pdf', data: fatPdf }] });
    const fatDocText = String((fatDoc.data && fatDoc.data.error) || '');
    check('PDF pasado de peso -> 400 con el maximo en MB', fatDoc.status === 400 && /maximo/.test(fatDocText) && /MB/.test(fatDocText), fatDoc.status + ' ' + fatDocText.slice(0, 90));

    // 7) Busqueda, renombrar y borrar (hace falta el chat creado con el modelo)
    if (strataReachable && testChatId) {
    const search = await json('GET', '/api/search?q=' + encodeURIComponent('vale'));
    check('GET /api/search encuentra el chat', ((search.data && search.data.chats) || []).some((c) => c.id === testChatId));
    const renamed = await json('PATCH', '/api/chats/' + testChatId, { title: 'Chat de prueba' });
    check('PATCH renombra el chat', renamed.status === 200 && renamed.data.chat.title === 'Chat de prueba');
    const listBefore = (await json('GET', '/api/chats')).data.chats.length;
    const removed = await json('DELETE', '/api/chats/' + testChatId);
    const listAfter = (await json('GET', '/api/chats')).data.chats.length;
    check('DELETE borra el chat', removed.status === 200 && listAfter === listBefore - 1, listBefore + ' -> ' + listAfter);
    const afterDelete = await json('GET', '/api/status');
    check('no quedan mensajes hueso en cascada', afterDelete.data.db.messages === 0, 'mensajes: ' + afterDelete.data.db.messages);
    check('no quedan adjuntos hueso en cascada', afterDelete.data.db.attachmentBytes === 0 && afterDelete.data.db.attachments === 0, 'adjuntos: ' + afterDelete.data.db.attachments);
    if (attachmentId) {
      const orphan = await fetch(BASE + '/api/attachments/' + attachmentId);
      check('el adjunto borrado deja de servirse', orphan.status === 404, 'HTTP ' + orphan.status);
    }
    } else {
      needsModel('GET /api/search encuentra el chat');
      needsModel('PATCH renombra el chat');
      needsModel('DELETE borra el chat');
      needsModel('no quedan mensajes hueso en cascada');
      needsModel('no quedan adjuntos hueso en cascada');
      needsModel('el adjunto borrado deja de servirse');
    }

    // 8) Errores controlados
    const emptyPost = await json('POST', '/api/chat', { content: '   ' });
    check('mensaje vacio -> 400 claro', emptyPost.status === 400 && Boolean(emptyPost.data && emptyPost.data.error), 'HTTP ' + emptyPost.status);
    const badRoute = await json('GET', '/api/no-existe');
    check('ruta desconocida -> 404 JSON', badRoute.status === 404 && Boolean(badRoute.data && badRoute.data.error));
    const badChat = await json('GET', '/api/chats/inexistente');
    check('chat inexistente -> 404', badChat.status === 404);

    // Un cuerpo pasado de tamano debe llegar explicado en espanol, no en el
    // "request entity too large" bruto del parser de Express.
    const bodyCap = Number(apiLimits.bodyLimitBytes) || 8 * 1024 * 1024;
    const giant = await json('POST', '/api/chat', { content: 'x'.repeat(bodyCap + 4096) });
    const giantText = String((giant.data && giant.data.error) || '');
    check('cuerpo pasado de tamano -> 413 explicado', giant.status === 413 && /demasiado/.test(giantText), 'HTTP ' + giant.status + ' ' + giantText.slice(0, 110));
    check('el aviso de tamano no sale en ingles bruto', !/request entity too large/i.test(giantText) && /servidor local/.test(giantText), giantText.slice(0, 130));

    // Una imagen que pasa del limite por imagen debe decir el maximo, no reventar.
    const heavyImage = await json('POST', '/api/chat', {
      content: 'foto enorme',
      images: [{ name: 'enorme.png', mime: 'image/png', data: 'A'.repeat(6 * 1024 * 1024) }],
    });
    const heavyText = String((heavyImage.data && heavyImage.data.error) || '');
    check('imagen pasada de peso -> 400 con el maximo claro', heavyImage.status === 400 && /maximo/.test(heavyText) && /MB/.test(heavyText), 'HTTP ' + heavyImage.status + ' ' + heavyText.slice(0, 90));
  } catch (err) {
    check('el arnes termina sin excepciones', false, err.message);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(SMOKE_DB + suffix)) fs.unlinkSync(SMOKE_DB + suffix);
    }
    console.log('\n--- log del servidor de pruebas ---');
    console.log(serverLog.trim());
    console.log('\n' + checks + ' comprobaciones, ' + failures + ' fallos' + (skipped ? ' (' + skipped + ' sin modelo por no haber IA)' : '') + '.');
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

main();
