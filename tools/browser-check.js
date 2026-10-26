/*
  Arnes de interfaz: abre la portada en un Chrome real (headless, perfil limpio y
  SIN extensiones) y, por el protocolo de depuracion (CDP), mira lo que de verdad
  pinta la pagina y los errores de JavaScript que lanza.

  Uso (con el servidor del proyecto arrancado):
    node tools/browser-check.js
    node tools/browser-check.js --url http://127.0.0.1:3000/
    node tools/browser-check.js --keep      (deja el Chrome abierto)

  Hace lo que no hacen los demas arneses: verificar el lado del navegador.
  - Inyecta un cazador de errores ANTES de que cargue la pagina, asi se ve un
    ReferenceError del script (era lo que dejaba la pestana en «Comprobando
    conexion con Strata...» con todos los datos en guion largo).
  - Lee el texto real de la barra de estado, del panel de detalles y de la barra
    de medida, y comprueba que el chat llega al borde derecho (hueco 0 px).

  Sale con codigo 0 si todo esta bien, 1 si algo falla.
*/
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] || null;
};
const hasFlag = (name) => args.indexOf(name) !== -1;

const CDP_PORT = 9333;
// Por defecto se comprueba la experiencia REAL del usuario: la pestana que abre
// start-strata-chat.cmd, sin la barra de medidas. Para ver la barra, pasar
// --url con ?medida=1 (el arnes comprueba que solo aparece cuando se la pide).
const APP_URL = getArg('--url') ||
  'http://127.0.0.1:3000/?ancho=completo&arranque=' + Date.now();

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function httpJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout consultando ' + urlPath)); });
  });
}

async function waitForDevtools(port, tries) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const info = await httpJson(port, '/json/version');
      if (info && info.webSocketDebuggerUrl) return info;
    } catch (_) { /* aun no escucha */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Chrome no abrio el puerto de depuracion ' + CDP_PORT);
}



/**
 * Cliente minimo del protocolo de depuracion de Chrome (CDP) sobre WebSocket.
 * Node 22 ya trae WebSocket global, o sea que no hace falta ningun paquete extra.
 */
class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.ws = socket;
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('el WebSocket de depuracion ha fallado')));
      socket.addEventListener('message', (event) => {
        let message = null;
        try {
          message = JSON.parse(String(event.data));
        } catch (_) {
          return;
        }
        if (message.id && this.pending.has(message.id)) {
          const waiter = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) waiter.reject(new Error(message.error.message || 'error de depuracion'));
          else waiter.resolve(message.result);
        }
      });
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== 1) {
          reject(new Error('Chrome no ha abierto el canal de depuracion'));
        }
      }, 6000);
    });
  }

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout esperando ' + method));
        }
      }, 9000);
    });
  }

  close() {
    try { this.ws.close(); } catch (_) { /* ya estaba cerrado */ }
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception;
    throw new Error('la pestana ha devuelto un error: ' +
      ((detail && detail.description) || result.exceptionDetails.text));
  }
  return result.result.value;
}

// Se ejecuta DENTRO de la pestana. Se reenvia como texto (Function.toString),
// asi que tiene que ser autocontenida: nada de variables de fuera.
function pageProbe() {
  const text = (id) => {
    const element = document.getElementById(id);
    return element ? element.textContent.trim() : '-';
  };
  const field = document.documentElement.clientWidth;
  const main = document.querySelector('main.chat');
  const side = document.querySelector('.sidebar');
  const inspector = document.getElementById('inspector');
  const inspectorShown = Boolean(inspector) &&
    window.getComputedStyle(inspector).display !== 'none' &&
    inspector.getBoundingClientRect().right > 0;
  const lastRight = inspectorShown
    ? inspector.getBoundingClientRect().right
    : (main ? main.getBoundingClientRect().right : 0);
  return {
    statusText: text('status-text'),
    modelName: text('model-name'),
    inspModel: text('insp-model'),
    inspApi: text('insp-api'),
    inspUrl: text('insp-url'),
    inspWidth: text('insp-width'),
    inspBuild: text('insp-build'),
    listHint: text('chat-list-hint'),
    measureBar: Boolean(document.getElementById('measure-bar')),
    chatItems: document.querySelectorAll('.chat-item').length,
    field: field,
    chat: main ? Math.round(main.getBoundingClientRect().width) : 0,
    sidebar: side ? Math.round(side.getBoundingClientRect().width) : 0,
    gapWindow: Math.max(0, field - Math.round(lastRight)),
    jsErrors: window.__pagErrores || [],
    scripts: Array.prototype.slice.call(document.scripts)
      .map((script) => script.getAttribute('src') || ''),
    styles: Array.prototype.slice.call(document.querySelectorAll('link[rel=stylesheet]'))
      .map((link) => link.getAttribute('href') || ''),
  };
}

const PROBE = '(' + pageProbe.toString() + ')()';

async function main() {
  const chrome = chromePath();
  if (!chrome) {
    console.log('FALLO: no se encontro Chrome/Edge. Marca la ruta con CHROME_PATH.');
    return 1;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-cdp-'));
  const child = childProcess.spawn(chrome, [
    '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-component-extensions-with-background-pages',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=1702,1000', 'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    if (hasFlag('--keep')) return;
    try { child.kill(); } catch (_) { /* ya habia muerto */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  };

  let code = 0;
  try {
    await waitForDevtools(CDP_PORT, 40);
    let pages = [];
    for (let i = 0; i < 20; i += 1) {
      try { pages = await httpJson(CDP_PORT, '/json/list'); break; }
      catch (_) { await new Promise((r) => setTimeout(r, 250)); }
    }
    const page = pages.find((t) => t.type === 'page');
    if (!page) throw new Error('el depurador no lista ninguna pestana');

    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // El cazador entra ANTES de la pagina: sin esto un ReferenceError del script
    // pasa desapercibido y la interfaz se queda con el texto inicial del HTML.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__pagErrores = [];' +
        'window.addEventListener("error", function (e) { window.__pagErrores.push((e.message || "error") +' +
        ' " en " + (e.filename || "?") + ":" + (e.lineno || "?")); });' +
        'window.addEventListener("unhandledrejection", function (e) { window.__pagErrores.push(' +
        '"promesa sin controlar: " + ((e.reason && e.reason.message) || e.reason)); });',
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await new Promise((r) => setTimeout(r, 3500));

    let probe = await evaluate(cdp, PROBE);
    for (let i = 0; i < 10; i += 1) {
      if (!probe.jsErrors.length && !/Comprobando/.test(probe.statusText) &&
        /Conectado a Strata/.test(probe.statusText) && probe.gapWindow === 0) break;
      await new Promise((r) => setTimeout(r, 700));
      probe = await evaluate(cdp, PROBE);
    }

    const check = (label, ok, detail) => {
      console.log((ok ? 'OK   ' : 'FALLO') + '  ' + label + (detail ? '  -> ' + detail : ''));
      if (!ok) code = 1;
    };

    console.log('pagina analizada: ' + APP_URL);
    console.log('navegador      : ' + chrome);
    console.log('');
    check('sin errores de JavaScript en la pestana', probe.jsErrors.length === 0,
      probe.jsErrors.length ? probe.jsErrors.join(' | ') : 'ninguno');
    check('no se queda en «Comprobando conexion con Strata»', !/Comprobando/.test(probe.statusText),
      probe.statusText);
    check('no anuncia servidor caido', !/Buscando el servidor|no responde/i.test(probe.statusText),
      probe.statusText);
    check('la barra lateral anuncia conexion con Strata', /Conectado a Strata/.test(probe.statusText),
      probe.statusText);
    check('el modelo aparece en la barra lateral', /Modelo:\s*\S/.test(probe.modelName), probe.modelName);
    check('el panel de detalles tiene modelo', Boolean(probe.inspModel) && probe.inspModel !== '-' &&
      !/\(sin modelo\)/.test(probe.inspModel), probe.inspModel);
    check('el panel de detalles tiene revision y arrancado', Boolean(probe.inspApi) && probe.inspApi !== '-' &&
      !/sin respuesta/.test(probe.inspApi), probe.inspApi);
    check('la direccion del modelo local esta declarada', Boolean(probe.inspUrl) && probe.inspUrl !== '-', probe.inspUrl);
    check('el chat llega al borde derecho (hueco 0 px)', probe.gapWindow === 0,
      'campo ' + probe.field + ' px · chat ' + probe.chat + ' px · hueco ' + probe.gapWindow + ' px');
    check('la barra lateral ocupa su sitio', probe.sidebar > 100, 'barra lateral ' + probe.sidebar + ' px');
    check('los scripts se enlazan limpios, sin ?v=', probe.scripts.every((src) => src.indexOf('?') === -1),
      probe.scripts.join(' , '));
    check('la hoja de estilo se enlaza limpia, sin ?v=', probe.styles.every((href) => href.indexOf('?') === -1),
      probe.styles.join(' , '));
    check('la barra de medidas de abajo solo existe si la direccion la pide',
      probe.measureBar === /[?&]medida=1/.test(APP_URL),
      (probe.measureBar ? 'barra presente' : 'sin barra') + ' · ' + APP_URL);
    console.log('');
    console.log('barra de medida : ' + probe.inspWidth);
    console.log('version servida : ' + probe.inspBuild);
    console.log('historial       : ' + probe.chatItems + ' chats · ' + probe.listHint);
    cdp.close();
  } catch (err) {
    console.log('FALLO: ' + err.message);
    code = 1;
  } finally {
    cleanup();
  }
  return code;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.log('FALLO general: ' + err.message);
  process.exit(1);
});
