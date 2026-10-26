'use strict';

/**
 * script.js - Interfaz del chat local con Strata.
 *
 * Todas las peticiones son RUTAS RELATIVAS, o sea que solo pueden hablar con
 * este mismo servidor local. No existe ninguna URL absoluta en el codigo, asi
 * que el navegador no tiene forma de salir a internet.
 */

const api = {
  // Ruta base de la API en este mismo servidor (relativa: nunca sale a internet).
  baseUrl: '/api/',
  async request(path, options) {
    const response = await fetch('/api' + path, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    if (!response.ok) {
      const error = new Error(data && data.error ? data.error : 'El servidor local contesto HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return data;
  },
  get(path) {
    return api.request(path);
  },
  post(path, body) {
    return api.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },
  patch(path, body) {
    return api.request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },
  remove(path) {
    return api.request(path, { method: 'DELETE' });
  },
};

const dom = {};
[
  'btn-new',
  'search',
  'chat-list',
  'chat-list-hint',
  'status',
  'status-text',
  'model-name',
  'db-info',
  'btn-retry',
  'chat-title',
  'chat-meta',
  'btn-rename',
  'btn-delete',
  'btn-inspector',
  'btn-width',
  'btn-inspector-close',
  'inspector',
  'btn-export',
  'messages',
  'thread',
  'composer',
  'input',
  'btn-send',
  'btn-attach',
  'file-input',
  'attach-strip',
  'insp-model',
  'insp-ctx',
  'insp-vision',
  'insp-url',
  'insp-api',
  'insp-voice',
  'insp-last',
  'insp-chat-count',
  'insp-chat-tokens',
  'insp-chat-images',
  'insp-chat-docs',
  'insp-created',
  'insp-limit-history',
  'insp-limit-temp',
  'insp-limit-tokens',
  'insp-limit-images',
  'insp-limit-pdfs',
  'insp-db-path',
  'insp-db-size',
  'inspector',
  'insp-viewport',
  'insp-width',
  'insp-build',
  'voice-pick',
  'voice-rate',
  'voice-rate-value',
  'voice-cloud',
].forEach((id) => {
  dom[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
});

const state = {
  chats: [],
  currentId: null,
  currentChat: null,
  messages: [],
  attachments: [],
  attachNote: null,
  limits: null,
  lastReply: null,
  busy: false,
  abort: null,
  searching: false,
  statusTimer: null,
  loadError: null,
};

const IMAGE_ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PDF_MIME = 'application/pdf';
const ATTACH_ACCEPTED = IMAGE_ACCEPTED.concat([PDF_MIME]);
const INSPECTOR_KEY = 'strata.inspector.off';
// '1' recorta la linea de lectura; por defecto el chat ocupa toda la ventana.
const WIDTH_KEY = 'strata.width.cozy';
// Ajustes de voz guardados en el propio navegador (no van a ningun servidor).
const VOICE_KEY = 'strata.voice.name';
const VOICE_RATE_KEY = 'strata.voice.rate';
const VOICE_CLOUD_KEY = 'strata.voice.online';
// Velocidad de lectura admitida: de la normal (100%) al doble (200%).
const RATE_MIN = 100;
const RATE_MAX = 200;
const RATE_DEFAULT = 100;

// --- Utilidades --------------------------------------------------------------
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Lee un ajuste local sin romperse si el navegador bloquea el almacen. */
function localSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null || value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function saveLocalSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch (_) {
    /* sin almacenamiento local: se pierde al cerrar y ya esta */
  }
}

function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Pinta texto ya sea como markdown o como texto plano si markdown.js no carga. */
function renderInto(element, text) {
  if (typeof window.renderMarkdown === 'function') {
    element.innerHTML = window.renderMarkdown(text);
  } else {
    element.textContent = text || '';
  }
}

// --- Copiar al portapapeles ---------------------------------------------------
/* El portapapeles moderno exige contexto seguro; http://127.0.0.1 lo es, pero si
   algo lo bloquea se usa el plan B (textarea oculto + execCommand), que sigue
   funcionando en el resto de contextos. */
const copyTimers = new WeakMap();

/** Deja la respuesta como texto corriente, sin los simbolos de markdown. */
function plainForCopy(text) {
  return String(text === null || text === undefined ? '' : text)
    // Tablas: fuera la linea de guiones y los bordes; las celdas quedan en fila.
    .replace(/((?:^[ \t]*\|.*\|[ \t]*\n?){2,})/gm, (chunk) => {
      const kept = chunk
        .split('\n')
        .filter((row) => row.trim() && !/^[\s|:+-]*\|[\s|:-]*$/.test(row))
        .map((row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\s*\|\s*/g, ' | ').trim());
      return kept.join('\n') + (chunk.endsWith('\n') ? '\n' : '');
    })
    .replace(/```[^\S\n]*[\w+-]*\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    // Ojo: solo espacios y tabulados por delante, nunca \s (se comería los
    // saltos de linea que hay antes de la lista y pegaría los parrafos).
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]*\d{1,3}[.)][ \t]+/gm, '')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
    .replace(/\*\*+([^*\n]+)\*\*+/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plan B del portapapeles: selecciona en un textarea fuera de pantalla. */
function legacyCopy(value) {
  const area = document.createElement('textarea');
  area.value = value;
  area.readOnly = true;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.left = '0';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (error) {
    ok = false;
  }
  area.remove();
  return Boolean(ok);
}

async function copyToClipboard(text) {
  const value = String(text === null || text === undefined ? '' : text);
  if (!value.trim()) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      /* sin permiso o sin contexto seguro: se intenta el plan B */
    }
  }
  return legacyCopy(value);
}

/** El boton se autoconfirma: «Copiado» un momento y despues vuelve a su nombre. */
function flashCopy(button, ok) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  button.textContent = ok ? 'Copiado' : 'No se pudo copiar';
  button.classList.add(ok ? 'is-copied' : 'is-copy-fail');
  const previous = copyTimers.get(button);
  if (previous) window.clearTimeout(previous);
  copyTimers.set(
    button,
    window.setTimeout(() => {
      button.textContent = label;
      button.classList.remove('is-copied', 'is-copy-fail');
      copyTimers.delete(button);
    }, 1800)
  );
}

/** Pastilla de copiado; el texto se pide al pulsar, no al pintar. */
function copyButton(getText, label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-read btn-copy';
  button.dataset.label = label;
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', async () => {
    let value = '';
    try {
      value = getText();
    } catch (error) {
      value = '';
    }
    flashCopy(button, await copyToClipboard(value));
  });
  return button;
}

/** Un solo escucha sirve los botones «Copiar bloque» que arma markdown.js. */
function wireBlockCopy() {
  dom.thread.addEventListener('click', async (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-copy-block]') : null;
    if (!button || !dom.thread.contains(button)) return;
    const box = button.closest('.md-codebox');
    const code = box ? box.querySelector('pre code') : null;
    if (!code) return;
    flashCopy(button, await copyToClipboard(code.textContent));
  });
}

function setText(key, value) {
  const element = dom[key];
  if (element) element.textContent = value === null || value === undefined || value === '' ? '-' : String(value);
}

function nearBottom() {
  const box = dom.messages;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function scrollToBottom(force) {
  if (force || nearBottom()) dom.messages.scrollTop = dom.messages.scrollHeight;
}

function setBusy(busy) {
  state.busy = busy;
  dom.btnSend.disabled = false;
  dom.btnSend.textContent = busy ? 'Detener' : 'Enviar';
  dom.btnSend.classList.toggle('is-stopping', busy);
  dom.btnSend.title = busy ? 'Cortar la respuesta del modelo' : '';
}

// --- Estado de la conexion ---------------------------------------------------
function paintStatus(payload) {
  state.status = payload || null;
  const strata = payload && payload.strata;
  const online = Boolean(strata && strata.reachable);
  dom.status.classList.toggle('is-online', online);
  dom.status.classList.toggle('is-offline', !online);

  if (online) {
    dom.statusText.textContent = 'Conectado a Strata (' + strata.latencyMs + ' ms)';
    dom.modelName.textContent = 'Modelo: ' + (strata.model || '(sin nombre)');
  } else {
    dom.statusText.textContent = 'Sin conexion con Strata';
    dom.modelName.textContent = strata && strata.error ? strata.error : 'Levanta Strata y pulsa Reintentar.';
  }

  const info = payload && payload.db;
  if (info) {
    dom.dbInfo.textContent =
      info.chats + ' chats · ' + info.messages + ' mensajes · ' + formatBytes(info.bytes) +
      (info.attachments ? ' · ' + info.attachments + ' adjuntos' : '');
  }
  if (payload && payload.warning) dom.dbInfo.textContent += ' · ' + payload.warning;

  state.limits = payload && payload.limits ? payload.limits : null;
  fillInspector();
}

// El servidor local se lanza SIN ventana (su salida va a database/server.log),
// asi que la pestana no puede quedarse esperando a que alguien la recargue:
// si el servidor no estaba, reintenta sola y se recupera en cuanto se lance
// start-strata-chat.cmd. Con servidor caido se comprueba cada 4 segundos; con
// servidor vivo, cada minuto.
let serverWasDown = false;

function armStatusTimer() {
  if (state.statusTimer) {
    window.clearInterval(state.statusTimer);
    state.statusTimer = null;
  }
  state.statusTimer = window.setInterval(() => {
    if (!state.busy) refreshStatus();
  }, serverWasDown ? 4000 : 60000);
}

async function refreshStatus() {
  try {
    const payload = await api.get('/status');
    paintStatus(payload);
    if (serverWasDown) {
      serverWasDown = false;
      armStatusTimer();
      // El servidor volvio: hay que traer el historial que no se pudo leer
      // cuando la pestana arranco con el puerto vacio.
      if (state.loadError) {
        state.loadError = null;
        refreshChats().then((loaded) => {
          if (loaded && state.chats.length && !state.currentId) openChat(state.chats[0].id);
        });
      }
    }
  } catch (err) {
    const firstFailure = !serverWasDown;
    serverWasDown = true;
    dom.status.classList.remove('is-online');
    dom.status.classList.add('is-offline');
    dom.statusText.textContent = 'Buscando el servidor de este PC...';
    dom.modelName.textContent =
      'Nadie escucha en este puerto: lanza start-strata-chat.cmd (no abre ninguna ventana, ' +
      'su log queda en database/server.log) y esta pestana se reconecta sola.';
    if (firstFailure) armStatusTimer();
  }
}

// --- Panel de detalles (derecha) ---------------------------------------------
function visionText(vision) {
  if (vision === true) return 'si, admite imagenes';
  if (vision === false) return 'no: si falla, se reenvia solo el texto';
  return 'sin declarar (se probara al enviar)';
}

/** Que ve la interfaz del servidor: si no declara revision ni adjuntos, es viejo. */
function describeLocalApi(payload) {
  if (!payload) return 'sin respuesta: pulsa Reintentar';
  const server = payload.server || {};
  const limits = payload.limits || {};
  if (!server.revision || !Number.isFinite(limits.maxImageBytes) || !Number.isFinite(limits.maxPdfBytes)) {
    return 'API antigua (sin PDF): para con Ctrl+C en la consola y vuelve a lanzar npm start';
  }
  return server.revision + ' · arrancado ' + (formatDateTime(server.startedAt) || 'ahora');
}

function fillInspector() {
  const payload = state.status;
  const strata = payload && payload.strata ? payload.strata : null;
  const models = strata && Array.isArray(strata.models) ? strata.models : [];
  const modelInfo = models.find((model) => model.id === (strata && strata.model)) || models[0] || null;

  setText('inspModel', strata && strata.model ? strata.model : '(sin modelo)');
  setText('inspCtx', modelInfo && Number.isFinite(modelInfo.n_ctx) ? modelInfo.n_ctx.toLocaleString() + ' fichas' : 'sin dato');
  setText('inspVision', visionText(strata ? strata.vision : null));
  setText('inspUrl', strata && strata.baseUrl ? strata.baseUrl : '-');
  setText('inspApi', describeLocalApi(payload));
  refreshVoiceRow();

  if (state.lastReply) {
    const bits = [];
    if (Number.isFinite(state.lastReply.elapsedMs)) bits.push((state.lastReply.elapsedMs / 1000).toFixed(1) + ' s');
    if (Number.isFinite(state.lastReply.tokens)) bits.push(state.lastReply.tokens + ' tokens de salida');
    if (state.lastReply.droppedImages) bits.push('la imagen no se acepto' + (state.lastReply.imageError ? ': ' + String(state.lastReply.imageError).slice(0, 90) : ''));
    setText('inspLast', bits.join(' · ') || 'respuesta sin medidas');
  } else {
    setText('inspLast', 'nada todavia en esta sesion');
  }

  const chat = state.currentChat;
  const count = state.messages.length || (chat && Number.isFinite(chat.message_count) ? chat.message_count : 0);
  const tokens = state.messages.reduce(
    (total, message) => total + (Number(message.prompt_tokens) || 0) + (Number(message.completion_tokens) || 0),
    0
  );
  const attached = state.messages.reduce((total, message) => total + ((message.attachments || []).length), 0);
  const docs = state.messages.reduce(
    (total, message) => total + ((message.attachments || []).filter((file) => String(file.mime || '') === PDF_MIME).length),
    0
  );

  setText('inspChatCount', count);
  setText('inspChatTokens', tokens.toLocaleString());
  setText('inspChatImages', attached - docs);
  setText('inspChatDocs', docs);
  setText('inspCreated', chat ? formatDateTime(chat.created_at) : 'chat aun sin guardar');

  const limits = state.limits;
  setText('inspLimitHistory', limits ? limits.maxHistory + ' mensajes' : '-');
  setText('inspLimitTemp', limits ? limits.temperature : '-');
  setText('inspLimitTokens', limits && limits.maxTokens ? limits.maxTokens + ' fichas' : 'sin limite');
  if (limits) {
    const imageNote = limits.maxImagesPerMessage + ' de ' + formatBytes(limits.maxImageBytes) + ' (' + (limits.imageTypes || []).join(', ') + ')';
    setText(
      'inspLimitImages',
      Number.isFinite(limits.bodyLimitBytes) ? imageNote + ' · paquete hasta ' + formatBytes(limits.bodyLimitBytes) : imageNote
    );
    if (Number.isFinite(limits.maxPdfBytes)) {
      const docNote = limits.maxPdfPerMessage + ' de ' + formatBytes(limits.maxPdfBytes) + ' (' + (limits.pdfTypes || ['application/pdf']).join(', ') + ')';
      const charNote = Number.isFinite(limits.maxPdfTextChars)
        ? ' · hasta ' + limits.maxPdfTextChars.toLocaleString() + ' caracteres de texto por PDF' +
          (Number.isFinite(limits.maxPdfTotalChars) ? ' (' + limits.maxPdfTotalChars.toLocaleString() + ' en total)' : '')
        : '';
      setText('inspLimitPdfs', docNote + charNote);
    } else {
      setText('inspLimitPdfs', 'este servidor aun no admite PDF: reinicialo');
    }
  } else {
    setText('inspLimitImages', 'este servidor aun no admite imagenes: reinicialo');
    setText('inspLimitPdfs', 'este servidor aun no admite PDF: reinicialo');
  }

  const db = payload && payload.db;
  setText('inspDbPath', db ? db.path : '-');
  setText(
    'inspDbSize',
    db ? formatBytes(db.bytes) + (db.attachmentBytes ? ', adjuntos ' + formatBytes(db.attachmentBytes) : '') : '-'
  );
  paintLayoutRows();
}

function setInspector(visible) {
  document.body.classList.toggle('inspector-off', !visible);
  try {
    window.localStorage.setItem(INSPECTOR_KEY, visible ? '0' : '1');
  } catch (_) {
    /* sin almacenamiento local: no pasa nada */
  }
  paintLayoutRows();
}

function panelModeFromUrl() {
  const found = /[?&]panel=(abierto|oculto)/.exec(window.location.search);
  return found ? found[1] : '';
}

function restoreInspector() {
  let stored = '0';
  try {
    stored = window.localStorage.getItem(INSPECTOR_KEY) || '0';
  } catch (_) {
    /* sin almacenamiento local: se muestra siempre */
  }
  let off = stored === '1';
  // Igual que el ancho, la URL manda sobre lo memorizado: ?panel=oculto /
  // ?panel=abierto. Se guarda lo forzado para que el boton «Detalles» enseñe
  // y funcione segun lo que se esta viendo de verdad.
  const forced = panelModeFromUrl();
  if (forced === 'oculto') off = true;
  if (forced === 'abierto') off = false;
  document.body.classList.toggle('inspector-off', off);
  if (forced) {
    try {
      window.localStorage.setItem(INSPECTOR_KEY, off ? '1' : '0');
    } catch (_) {
      /* sin almacenamiento local: el modo de la URL manda solo en esta pestana */
    }
  }
}

function inspectorOpen() {
  return !document.body.classList.contains('inspector-off');
}

// La maquetacion vive en style.css: el chat es `flex: 1 1 0` y la columna de
// lectura vale `--thread-max`. No hay ningun parche de layout en JavaScript.

// --- Ancho de la interfaz y diagnostico de pantalla -------------------------
/**
 * Por defecto el chat ocupa toda la ventana. El boton solo ofrece el modo
 * "comodo", que recorta la columna de lectura para no pasear la vista de un
 * borde al otro. Se recuerda en el propio navegador.
 *
 * La direccion puede FORZAR el modo, que es lo que usa el lanzador
 * (`?ancho=completo`) para que al abrir con start-strata-chat.cmd se vea igual
 * de ancho que abriendo index.html a mano, este lo que este memorizado en ese
 * origen del navegador:
 *   ?ancho=completo  -> 100% del ancho (ignora lo memorizado)
 *   ?ancho=comodo    -> columna de texto recortada a 1180 px y centrada
 * Lo forzado por URL se guarda, asi que el boton y el panel de detalles enseñan
 * el modo que estas viendo de verdad.
 */
function widthModeFromUrl() {
  const found = /[?&]ancho=(completo|comodo)/.exec(window.location.search);
  return found ? found[1] : '';
}

function applyWidthMode(cozy) {
  document.body.classList.toggle('width-cozy', cozy);
  if (dom.btnWidth) {
    dom.btnWidth.textContent = cozy ? 'Ancho comodo (ACTIVO)' : 'Ancho completo';
    dom.btnWidth.title = cozy
      ? 'La columna de texto esta recortada a 1180 px y centrada: esa es la franja libre que ves a la derecha. Clic para que el chat ocupe toda la ventana.'
      : 'El chat ya ocupa toda la ventana hasta el borde derecho. Clic si prefieres una linea de lectura mas corta.';
  }
}

function restoreWidthMode() {
  const forced = widthModeFromUrl();
  let stored = '0';
  try {
    stored = window.localStorage.getItem(WIDTH_KEY) || '0';
  } catch (_) {
    /* sin almacenamiento local: se queda en ancho completo */
  }
  let cozy = stored === '1';
  if (forced === 'comodo') cozy = true;
  if (forced === 'completo') cozy = false;
  applyWidthMode(cozy);
  if (forced) {
    try {
      window.localStorage.setItem(WIDTH_KEY, cozy ? '1' : '0');
    } catch (_) {
      /* sin almacenamiento local: el modo de la URL manda solo en esta pestana */
    }
  }
}

function toggleWidthMode() {
  const cozy = !document.body.classList.contains('width-cozy');
  applyWidthMode(cozy);
  try {
    window.localStorage.setItem(WIDTH_KEY, cozy ? '1' : '0');
  } catch (_) {
    /* sin almacenamiento local: no se recuerda */
  }
  paintLayoutRows();
}

/**
 * Mide quanto esta ocupando cada zona y cuanto espacio queda libre a la derecha.
 * Hay DOS huecos que se median antes por separado y habia que medir los dos:
 *  - gapWindow: del borde del ultimo panel visible (chat o detalles) al borde de
 *    la ventana. Cero significa que los contenedores llenan, nada mas.
 *  - gapColumn: del canto derecho UTIL del scroll de mensajes al borde de la
 *    columna de texto. Este era el ciego: en el modo «Ancho comodo» el <main>
 *    llegaba hasta el borde (gapWindow 0) y aun asi la columna de texto quedaba
 *    a 1180 px, con media pantalla negra al lado. Se descuenta la barra de
 *    desplazamiento vertical, que no es hueco.
 * El aviso rojo se dispara con cualquiera de los dos por encima de 4 px.
 */
function measureLayout() {
  const viewport = Math.round(window.innerWidth);
  // El ancho REAL aprovechable es el del hueco del documento, no innerWidth:
  // innerWidth incluye la barra de desplazamiento y con eso el diagnostico
  // mentia unos 18 px en el hueco contra el borde.
  const field = Math.round(document.documentElement.clientWidth || window.innerWidth);
  const chat = document.querySelector('main.chat');
  const sidebar = document.querySelector('.sidebar');
  const scroll = dom.messages || document.getElementById('messages');
  const edge = (element) => (element ? Math.round(element.getBoundingClientRect().right) : 0);
  const detailsVisible = dom.inspector && inspectorOpen() && edge(dom.inspector) > 0;
  const lastPanel = detailsVisible ? edge(dom.inspector) : edge(chat);

  // Hueco contra el borde derecho: lo que sobra despues de lo ultimo que hay
  // en la fila (el panel de detalles si esta abierto, si no el chat). Nada mas.
  const gapWindow = Math.max(0, field - lastPanel);

  let gapColumn = 0;
  if (scroll && dom.thread) {
    const styles = window.getComputedStyle(scroll);
    const gutter = (parseFloat(styles.paddingRight) || 0) + (scroll.offsetWidth - scroll.clientWidth);
    const usableRight = Math.round(scroll.getBoundingClientRect().right - gutter);
    gapColumn = Math.max(0, usableRight - Math.round(dom.thread.getBoundingClientRect().right));
  }

  return {
    viewport: viewport,
    field: field,
    chrome: Math.max(0, viewport - field),
    height: Math.round(window.innerHeight),
    sidebar: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
    chat: chat ? Math.round(chat.getBoundingClientRect().width) : 0,
    thread: dom.thread ? Math.round(dom.thread.getBoundingClientRect().width) : 0,
    details: detailsVisible ? Math.round(dom.inspector.getBoundingClientRect().width) : 0,
    gapWindow: gapWindow,
    gapColumn: gapColumn,
    gap: Math.max(gapWindow, gapColumn),
  };
}

function serverBuildStamp() {
  const server = state.status ? state.status.server : null;
  return server && server.build ? String(server.build) : '';
}

function markWarn(key, on) {
  const element = dom[key];
  if (element) element.classList.toggle('is-warn', Boolean(on));
}

/**
 * El boton de la cabecera dice en su propio texto cuantos pixeles esta
 * ocupando el panel de detalles: la franja de la derecha deja de parecer
 * «espacio libre» y se ve el boton que se la devuelve al chat.
 */
function paintInspectorButton(details) {
  const button = dom.btnInspector;
  if (!button) return;
  if (inspectorOpen()) {
    button.textContent = 'Ocultar detalles (-' + details + ' px)';
    button.title = 'El panel de la derecha esta abierto y ocupa ' + details +
      ' px: al cerrarlo, esos pixeles se los queda el chat (no es espacio vacio).';
  } else {
    button.textContent = 'Detalles';
    button.title = 'Abre el panel de detalles a la derecha. Le quita ancho al chat: ' +
      'el chat lo recupera al cerrarlo.';
  }
}

function paintLayoutRows() {
  const metrics = measureLayout();
  paintInspectorButton(metrics.details);
  setText('inspViewport', metrics.viewport + ' x ' + metrics.height + ' px');
  const cozy = document.body.classList.contains('width-cozy');
  setText(
    'inspWidth',
    'barra lateral ' + metrics.sidebar + ' px · chat ' + metrics.chat + ' px · texto ' + metrics.thread +
      ' px · panel de detalles ' +
      (metrics.details
        ? metrics.details + ' px ABIERTO (no es un hueco: es el panel; «Ocultar detalles» se los devuelve al chat)'
        : 'cerrado (0 px)') +
      ' · hueco REAL junto al borde de la ventana ' + metrics.gapWindow +
      ' px · hueco detras de la columna de texto ' + metrics.gapColumn +
      ' px · modo ' + (cozy ? 'comodo (misma anchura de borde a borde, texto mas grande)' : 'ancho completo (100%)')
  );
  markWarn('inspWidth', metrics.gap > 4);

  const serverStamp = serverBuildStamp();
  if (!serverStamp) {
    setText('inspBuild', 'el servidor no informa de su version: pulsa Reintentar');
    markWarn('inspBuild', true);
  } else {
    setText('inspBuild', 'version ' + serverStamp + ' (los ficheros salen con no-store:' +
      ' el navegador no guarda copia de la interfaz)');
    markWarn('inspBuild', false);
  }
  paintMeasureBar(metrics);
}

/**
 * La barra de medida es una herramienta de diagnostico, NO parte de la interfaz.
 * Desde la tanda 2026-10-26 no aparece nunca sola: solo se pide de forma
 * explicita con ?medida=1 (o lanzando tools\server.ps1 -Start -Open -Medida).
 * ?medida=0, o no llevar nada, la quita aunque la pestana viniera con ella
 * puesta de una direccion anterior.
 */
function measureBarWanted() {
  const search = window.location.search;
  if (/[?&]medida=0/.test(search)) return false;
  return /[?&]medida=1/.test(search);
}

function paintMeasureBar(metrics) {
  let bar = document.getElementById('measure-bar');
  if (!measureBarWanted()) {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'measure-bar';
    bar.className = 'measure-bar';
    document.body.appendChild(bar);
  }
  bar.textContent =
    'ventana ' + metrics.viewport + ' px · barra lateral ' + metrics.sidebar + ' px · chat ' + metrics.chat +
    ' px · columna de texto ' + metrics.thread + ' px · panel Detalles ' +
    (metrics.details ? metrics.details + ' px ABIERTO (no es hueco: es el panel)' : 'cerrado') +
    ' · HUECO REAL al borde de la ventana ' + metrics.gapWindow + ' px · hueco dentro del chat ' +
    metrics.gapColumn + ' px · ' +
    (document.body.classList.contains('width-cozy')
      ? 'MODO COMODO (solo tipografia: no recorta el ancho, se cambia con el boton de la cabecera)'
      : 'modo ancho completo') +
    (metrics.details ? ' · «Ocultar detalles» te libera ' + metrics.details + ' px' : '') +
    ' · servidor ' + (serverBuildStamp() || 'sin informar');
  bar.classList.toggle('is-gap', metrics.gap > 4);
}

function exportFileName(title) {
  const clean = String(title || 'chat')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean.slice(0, 60) || 'chat') + '.md';
}

/** Saca el chat actual a un archivo .md en tu disco (todo local). */
async function exportCurrentChat() {
  if (!state.currentChat) return window.alert('Abre o escribe un chat antes de exportarlo.');
  let messages = state.messages;
  if (!messages.length) {
    try {
      const payload = await api.get('/chats/' + encodeURIComponent(state.currentChat.id));
      messages = payload.messages || [];
    } catch (err) {
      return window.alert(err.message);
    }
  }
  if (!messages.length) return window.alert('Este chat aun no tiene mensajes.');

  const lines = ['# ' + (state.currentChat.title || 'Chat'), '', 'Exportado el ' + new Date().toLocaleString(), ''];
  messages.forEach((message) => {
    lines.push('## ' + (message.role === 'user' ? 'Tu' : 'Strata') + ' · ' + formatDateTime(message.created_at), '');
    lines.push(message.content || '(sin texto)');
    (message.attachments || []).forEach((file) => {
      const isPdf = String(file.mime || '') === PDF_MIME;
      const read = Number.isFinite(file.text_chars) && file.text_chars > 0 ? ', ' + file.text_chars.toLocaleString() + ' caracteres leidos' : '';
      lines.push('', (isPdf ? 'PDF adjunto: ' : 'Imagen adjunta: ') + file.name + ' (' + formatBytes(file.bytes) + read + ')');
    });
    lines.push('');
  });

  const blob = new window.Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(state.currentChat.title);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
}

// --- Lista de chats ----------------------------------------------------------
function renderChatList(chats, emptyHint) {
  state.listShown = chats;
  state.listHint = emptyHint;
  dom.chatList.textContent = '';
  if (!chats.length) {
    dom.chatListHint.textContent = emptyHint || 'Aun no hay chats. Pulsa «+ Nuevo Chat».';
    dom.chatListHint.style.display = '';
    return;
  }
  dom.chatListHint.style.display = 'none';

  chats.forEach((chat) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chat-item' + (chat.id === state.currentId ? ' is-active' : '');

    const main = document.createElement('span');
    main.className = 'chat-item-main';

    const title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = chat.title || 'Sin titulo';

    const sub = document.createElement('span');
    sub.className = 'chat-item-sub';
    const count = Number.isFinite(chat.message_count) ? chat.message_count + ' msgs' : '';
    sub.textContent = [formatWhen(chat.updated_at), count].filter(Boolean).join(' · ');

    main.append(title, sub);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-item-del';
    del.title = 'Borrar este chat';
    del.textContent = '\u00d7';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      removeChat(chat.id, chat.title);
    });

    item.append(main, del);
    item.addEventListener('click', () => openChat(chat.id));
    dom.chatList.append(item);
  });
}

/** Devuelve false si el historial no se ha podido leer (servidor caido o viejo). */
async function refreshChats() {
  try {
    const payload = await api.get('/chats');
    state.chats = payload.chats || [];
    state.loadError = null;
    renderChatList(state.chats);
    return true;
  } catch (err) {
    state.chats = [];
    state.loadError = err.message;
    renderChatList([], 'El servidor no ha devuelto los chats: ' + err.message);
    return false;
  }
}

async function runSearch(term) {
  if (!term) {
    state.searching = false;
    await refreshChats();
    return;
  }
  state.searching = true;
  try {
    const payload = await api.get('/search?q=' + encodeURIComponent(term));
    renderChatList(payload.chats || [], 'Nada coincide con «' + term + '».');
  } catch (err) {
    renderChatList([], 'La busqueda ha fallado: ' + err.message);
  }
}

// --- Mensajes ----------------------------------------------------------------
function clearMessages() {
  dom.thread.textContent = '';
}

function emptyState(text) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  box.textContent = text;
  dom.thread.append(box);
}

/** Lo que se pinta bajo un mensaje: miniaturas de fotos y fichas de PDF. */
function galleryNode(attachments) {
  const gallery = document.createElement('div');
  gallery.className = 'attach-gallery';
  attachments.forEach((file) => {
    if (String(file.mime || '') === PDF_MIME) {
      gallery.append(docNode(file));
      return;
    }

    const link = document.createElement('a');
    link.className = 'attach-thumb';
    link.href = file.url || api.baseUrl + 'attachments/' + encodeURIComponent(file.id);
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = file.name + ' · ' + formatBytes(file.bytes);

    const image = document.createElement('img');
    image.src = link.href;
    image.alt = file.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      link.textContent = 'imagen no disponible: ' + file.name;
    });

    const label = document.createElement('span');
    label.textContent = file.name;

    link.append(image, label);
    gallery.append(link);
  });
  return gallery;
}

/**
 * Ficha de un PDF guardado. Se enlaza al archivo local para poder abrirlo y
 * se dice cuanto texto se leyo: eso es lo unico que llego a la IA.
 */
function docNode(file) {
  const stored = Boolean(file.id);
  const card = document.createElement(stored ? 'a' : 'div');
  card.className = 'attach-doc';
  if (stored) {
    card.href = api.baseUrl + 'attachments/' + encodeURIComponent(file.id);
    card.target = '_blank';
    card.rel = 'noopener';
    card.title = 'Abrir ' + file.name + ' (' + formatBytes(file.bytes) + ')';
  } else {
    card.title = file.name + ' · ' + formatBytes(file.bytes);
  }

  const mark = document.createElement('span');
  mark.className = 'doc-mark';
  mark.textContent = 'PDF';

  const block = document.createElement('span');
  block.className = 'doc-text';

  const name = document.createElement('span');
  name.className = 'doc-name';
  name.textContent = file.name;

  const note = document.createElement('span');
  note.className = 'doc-note';
  if (Number.isFinite(file.text_chars) && file.text_chars > 0) {
    note.textContent = formatBytes(file.bytes) + ' · ' + file.text_chars.toLocaleString() + ' caracteres leidos';
  } else if (stored) {
    note.textContent = formatBytes(file.bytes) + ' · sin texto aprovechable: escribelo o pegalo';
  } else {
    note.textContent = formatBytes(file.bytes) + ' · la IA vera su texto en cuanto se procese';
  }

  block.append(name, note);
  card.append(mark, block);
  return card;
}

function messageNode(message) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (message.role === 'user' ? 'is-user' : 'is-assistant');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length) bubble.append(galleryNode(attachments));

  const body = document.createElement('div');
  renderInto(body, message.content || '');
  bubble.append(body);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = messageMetaText(message);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const content = String(message.content || '');
  if (content.trim()) {
    if (message.role === 'assistant') {
      actions.append(answerActions(() => message.content));
    } else {
      actions.append(copyButton(() => content, 'Copiar', 'Copiar tu mensaje tal cual'));
    }
  }

  wrap.append(bubble, meta, actions);
  return wrap;
}

function messageMetaText(message) {
  const who = message.role === 'user' ? 'Tu' : 'Strata';
  const parts = [who, formatDateTime(message.created_at)];
  if (message.role === 'assistant' && Number.isFinite(message.completion_tokens)) {
    parts.push(message.completion_tokens + ' tokens');
  }
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length) {
    const docs = attachments.filter((file) => String(file.mime || '') === PDF_MIME).length;
    const photos = attachments.length - docs;
    const bits = [];
    if (photos) bits.push(photos === 1 ? '1 foto' : photos + ' fotos');
    if (docs) bits.push(docs === 1 ? '1 PDF' : docs + ' PDF');
    parts.push(bits.join(' y '));
  }
  return parts.filter(Boolean).join(' · ');
}

function applyChatHeader(chat) {
  state.currentChat = chat || null;
  dom.chatTitle.textContent = chat ? chat.title : 'Nuevo chat';
  const info = [];
  if (chat && chat.model) info.push('modelo: ' + chat.model);
  if (state.status && state.status.strata && state.status.strata.baseUrl) {
    info.push(state.status.strata.baseUrl);
  }
  dom.chatMeta.textContent = info.join(' · ');
  const hasChat = Boolean(chat);
  dom.btnRename.disabled = !hasChat;
  dom.btnDelete.disabled = !hasChat;
  fillInspector();
}

// --- Navegacion por chats ----------------------------------------------------
function showEmptyChat() {
  clearMessages();
  state.messages = [];
  emptyState('Chat nuevo. Lo que escribas se guarda en tu disco y solo se envia a tu IA local.');
  fillInspector();
}

function newChat() {
  if (state.busy) stopStreaming();
  stopSpeech();
  state.currentId = null;
  state.messages = [];
  clearAttachments();
  applyChatHeader(null);
  showEmptyChat();
  dom.input.value = '';
  autosize();
  dom.input.focus();
  renderChatList(state.listShown || [], state.listHint);
}

async function openChat(id) {
  if (state.busy) stopStreaming();
  stopSpeech();
  try {
    const payload = await api.get('/chats/' + encodeURIComponent(id));
    state.currentId = payload.chat.id;
    state.messages = payload.messages || [];
    applyChatHeader(payload.chat);
    clearMessages();
    clearAttachments();
    if (!state.messages.length) {
      emptyState('Este chat esta vacio. Escribe el primer mensaje.');
    } else {
      state.messages.forEach((message) => dom.thread.append(messageNode(message)));
    }
    renderChatList(state.listShown || [], state.listHint);
    scrollToBottom(true);
    dom.input.focus();
  } catch (err) {
    window.alert(err.message);
    state.currentId = null;
    state.messages = [];
    applyChatHeader(null);
    clearAttachments();
    clearMessages();
    emptyState('No se ha podido abrir ese chat: ' + err.message + '. Pulsa Reintentar o coge otro de la lista.');
    await refreshChats();
  }
}

async function removeChat(id, title) {
  const sure = window.confirm('Se borrara definitivamente el chat «' + (title || '') + '» de tu disco. ¿Continuar?');
  if (!sure) return;
  try {
    await api.remove('/chats/' + encodeURIComponent(id));
    if (state.currentId === id) newChat();
    await refreshChats();
    await refreshStatus();
  } catch (err) {
    window.alert(err.message);
  }
}

async function renameCurrentChat() {
  if (!state.currentChat) return;
  const value = window.prompt('Nuevo titulo del chat', state.currentChat.title || '');
  if (!value || !value.trim()) return;
  try {
    const payload = await api.patch('/chats/' + encodeURIComponent(state.currentChat.id), { title: value.trim() });
    applyChatHeader(payload.chat);
    await refreshChats();
  } catch (err) {
    window.alert(err.message);
  }
}

// --- Adjuntos (imagenes y PDF) ------------------------------------------------
function maxImagesPerMessage() {
  return state.limits && Number.isFinite(state.limits.maxImagesPerMessage) ? state.limits.maxImagesPerMessage : 4;
}

function maxImageBytes() {
  return state.limits && Number.isFinite(state.limits.maxImageBytes) ? state.limits.maxImageBytes : 4 * 1024 * 1024;
}

/** Cuantos PDF deja adjuntar este servidor y cuanto pueden pesar. */
function maxPdfsPerMessage() {
  return state.limits && Number.isFinite(state.limits.maxPdfPerMessage) ? state.limits.maxPdfPerMessage : 4;
}

function maxPdfBytes() {
  return state.limits && Number.isFinite(state.limits.maxPdfBytes) ? state.limits.maxPdfBytes : 8 * 1024 * 1024;
}

function isDocFile(file) {
  return String((file && file.mime) || '') === PDF_MIME;
}

function pickedImages() {
  return state.attachments.filter((item) => !isDocFile(item));
}

function pickedDocs() {
  return state.attachments.filter((item) => isDocFile(item));
}

/** Tamano maximo del paquete (adjuntos en base64 + texto) que traga el servidor. */
function bodyLimitBytes() {
  if (state.limits && Number.isFinite(state.limits.bodyLimitBytes)) return state.limits.bodyLimitBytes;
  // Si el estado aun no ha llegado, se calcula con los mismos valores por defecto
  // del servidor: imagenes y PDF en base64 (x4/3) mas un margen fijo de 2 MB.
  const raw = maxImagesPerMessage() * maxImageBytes() + maxPdfsPerMessage() * maxPdfBytes();
  return Math.ceil(((raw * 4) / 3 / (1024 * 1024)) + 2) * 1024 * 1024;
}

/** Lo que ocupara el JSON con los adjuntos ya codificados, aprox. */
function payloadBytes(text) {
  const attached = state.attachments.reduce((total, item) => total + (item.base64 || '').length + 128, 0);
  return attached + String(text || '').length * 4 + 512;
}

function attachNote(text, isError) {
  state.attachNote = { text: String(text || ''), isError: Boolean(isError) };
  renderAttachStrip();
}

function clearAttachments() {
  state.attachments = [];
  state.attachNote = null;
  dom.attachStrip.textContent = '';
  dom.attachStrip.hidden = true;
  dom.fileInput.value = '';
}

function renderAttachStrip() {
  dom.attachStrip.textContent = '';
  const note = state.attachNote;
  if (!state.attachments.length && !note) {
    dom.attachStrip.hidden = true;
    return;
  }
  dom.attachStrip.hidden = false;

  state.attachments.forEach((item, position) => {
    const isDoc = isDocFile(item);
    const chip = document.createElement('div');
    chip.className = 'attach-chip' + (isDoc ? ' is-doc' : '');

    if (isDoc) {
      // Un PDF no tiene miniatura: se ensena la marca y su tamano real.
      const mark = document.createElement('span');
      mark.className = 'doc-mark';
      mark.textContent = 'PDF';
      chip.append(mark);
    } else {
      const thumb = document.createElement('img');
      thumb.src = item.url;
      thumb.alt = item.name;
      chip.append(thumb);
    }

    const label = document.createElement('span');
    label.textContent = item.name + ' · ' + formatBytes(item.bytes);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = isDoc ? 'Quitar este PDF' : 'Quitar esta imagen';
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => {
      state.attachments.splice(position, 1);
      state.attachNote = null;
      renderAttachStrip();
    });

    chip.append(label, remove);
    dom.attachStrip.append(chip);
  });

  if (state.attachments.length) {
    const images = pickedImages().length;
    const docs = pickedDocs().length;
    const bits = [];
    if (images) bits.push(images + ' imagen' + (images === 1 ? '' : 'es'));
    if (docs) bits.push(docs + ' PDF');
    const hint = document.createElement('span');
    hint.className = 'attach-note';
    hint.textContent = 'Se enviaran ' + bits.join(' y ') + ' con el mensaje';
    dom.attachStrip.append(hint);
  }

  if (note && note.text) {
    const span = document.createElement('span');
    span.className = 'attach-note' + (note.isError ? ' is-error' : '');
    span.textContent = note.text;
    dom.attachStrip.append(span);
  }
}

/** Lee cualquier blob (fichero o lienzo) y lo devuelve en base64. */
function readBlob(blob, name, mime) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve({
        name: name || 'imagen',
        mime: mime || blob.type || 'image/png',
        bytes: blob.size,
        base64: comma !== -1 ? dataUrl.slice(comma + 1) : '',
        url: dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('No se ha podido leer ' + (name || 'la imagen') + '.'));
    reader.readAsDataURL(blob);
  });
}

function readImage(file) {
  return readBlob(file, file.name || 'imagen', file.type);
}

// Una foto de movil de 4000 px no aporta nada al modelo y revienta el paquete:
// se reduce a 1568 px (la ventana de vision habitual) y se volvia a codificar.
const IMAGE_MAX_EDGE = 1568;
const IMAGE_QUALITY = 0.86;

function loadBitmap(file) {
  if (typeof window.createImageBitmap === 'function') return window.createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = window.URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      window.URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      window.URL.revokeObjectURL(url);
      reject(new Error((file.name || 'La imagen') + ' no se ha podido abrir.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('El navegador no ha podido re-codificar la imagen.'))),
      mime,
      quality
    );
  });
}

function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') {
    try {
      bitmap.close();
    } catch (_) {
      /* ya liberada */
    }
  }
}

/**
 * Reduce una foto grande y la re-codifica en varios tamanos hasta que quepa en
 * el limite del servidor. Devuelve la mejor opcion probada y las medidas de origen.
 */
async function shrinkToLimit(file, limitBytes) {
  const bitmap = await loadBitmap(file);
  const wide = Number(bitmap.width || bitmap.naturalWidth || 0);
  const high = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!wide || !high) {
    closeBitmap(bitmap);
    throw new Error((file.name || 'La imagen') + ' no tiene medidas legibles.');
  }

  const stem = String(file.name || 'imagen').replace(/\.[A-Za-z0-9]+$/, '');
  const keepPng = (file.type || '') === 'image/png';
  const tried = [];

  for (const edge of [IMAGE_MAX_EDGE, 1100, 760]) {
    const scale = Math.min(1, edge / Math.max(wide, high));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(wide * scale));
    canvas.height = Math.max(1, Math.round(high * scale));
    const paint = canvas.getContext('2d');
    if (!paint) break;
    paint.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // Un PNG raro (captura con mucho ruido) no encoge perdiendo calidad: se
    // prueba tambien como JPEG, que es lo que el modelo va a ver igual.
    const formats = keepPng ? ['image/png', 'image/jpeg'] : ['image/jpeg'];
    for (const mime of formats) {
      const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 0.95 : IMAGE_QUALITY);
      const option = {
        blob,
        mime,
        name: stem + (mime === 'image/png' ? '.png' : '.jpg'),
        from: wide + 'x' + high,
        to: canvas.width + 'x' + canvas.height,
      };
      tried.push(option);
      if (blob.size <= limitBytes) {
        closeBitmap(bitmap);
        return { picked: option, tried };
      }
    }
  }

  closeBitmap(bitmap);
  const best = tried.reduce((small, item) => (item.blob.size < small.blob.size ? item : small), tried[0] || null);
  return { picked: best, tried };
}

/** Aviso honesto para lo que no se puede adjuntar. */
function notImageHint(files) {
  const names = files.map((file) => (file && file.name) || 'archivo').join(', ');
  return 'Aqui solo entran imagenes (PNG, JPG, WEBP, GIF) y PDF: ' + names + ' no. Si es otro documento, pega su texto.';
}

/**
 * Un PDF se guarda tal cual: el navegador no lo abre.
 * El servidor local le saca el texto y eso es lo unico que llega a la IA.
 */
function readDocument(file) {
  return readBlob(file, file.name || 'documento.pdf', PDF_MIME).then((doc) => {
    doc.url = null; // un PDF no tiene miniatura: se guarda una sola copia del contenido
    return doc;
  });
}

async function addAttachedFiles(list) {
  const candidates = Array.from(list || []);
  if (!candidates.length) return;

  state.attachNote = null;

  const isImage = (file) => Boolean(file && file.type) && IMAGE_ACCEPTED.indexOf(file.type) !== -1;
  const isPdf = (file) => Boolean(file && file.type) && file.type === PDF_MIME;

  const images = candidates.filter(isImage);
  const docs = candidates.filter(isPdf);
  const others = candidates.filter((file) => !isImage(file) && !isPdf(file));
  const notes = [];

  const roomImages = Math.max(0, maxImagesPerMessage() - pickedImages().length);
  const roomDocs = Math.max(0, maxPdfsPerMessage() - pickedDocs().length);

  if (!images.length && !docs.length) {
    attachNote(others.length ? notImageHint(others) : 'Nada de lo que has soltado se puede adjuntar.', true);
    return;
  }
  if (others.length) notes.push(notImageHint(others));
  if (images.length > roomImages) {
    notes.push('Maximo ' + maxImagesPerMessage() + ' imagenes por mensaje: se han dejado ' + (images.length - roomImages) + ' fuera.');
  }
  if (docs.length > roomDocs) {
    notes.push('Maximo ' + maxPdfsPerMessage() + ' PDF por mensaje: se han dejado ' + (docs.length - roomDocs) + ' fuera.');
  }

  for (const file of images.slice(0, roomImages)) {
    try {
      if (Number(file.size || 0) <= maxImageBytes()) {
        state.attachments.push(await readImage(file));
        continue;
      }

      if (file.type === 'image/gif') {
        notes.push((file.name || 'La GIF') + ' pasa de ' + formatBytes(maxImageBytes()) + ' y las animaciones no se reducen: busca una mas pequena.');
        continue;
      }

      // Pasa del limite: se reduce y se re-codifica en vez de descartarla.
      const reduced = await shrinkToLimit(file, maxImageBytes());
      const small = reduced.picked;
      if (!small || Number(small.blob.size || 0) > maxImageBytes()) {
        notes.push((file.name || 'La imagen') + ' no baja de ' + (small ? formatBytes(small.blob.size) : '?') + ' (' + (small ? small.to : 'sin reducir') + ' px): reducela antes de adjuntarla.');
        continue;
      }
      state.attachments.push(await readBlob(small.blob, small.name, small.mime));
      notes.push('Hemos reducido ' + small.name + ' de ' + formatBytes(file.size) + ' a ' + formatBytes(small.blob.size) + ' (' + small.from + ' a ' + small.to + ' px).');
    } catch (err) {
      notes.push(err.message);
    }
  }

  for (const file of docs.slice(0, roomDocs)) {
    if (Number(file.size || 0) > maxPdfBytes()) {
      notes.push((file.name || 'El PDF') + ' pasa de ' + formatBytes(maxPdfBytes()) + ': partelo o manda solo las paginas que te interesen.');
      continue;
    }
    try {
      state.attachments.push(await readDocument(file));
      notes.push((file.name || 'El PDF') + ' listo: el texto se leera en tu PC al enviar (' + formatBytes(file.size) + ').');
    } catch (err) {
      notes.push(err.message);
    }
  }

  const total = payloadBytes(dom.input.value);
  if (total > bodyLimitBytes()) {
    notes.push('Ojo: el paquete sube a ' + formatBytes(total) + ' y este servidor acepta ' + formatBytes(bodyLimitBytes()) + ': quita algun adjunto.');
  }

  renderAttachStrip();
  if (notes.length) attachNote(notes.join('  '), !state.attachments.length);
}

function pickedAttachFiles(dataTransfer) {
  if (!dataTransfer) return [];
  if (dataTransfer.files && dataTransfer.files.length) {
    return Array.from(dataTransfer.files).filter((file) => file.type && ATTACH_ACCEPTED.indexOf(file.type) !== -1);
  }
  return [];
}

// --- Leer en voz alta --------------------------------------------------------
const speech = { voice: null, button: null, queue: [], timer: null };

function speechSupported() {
  return Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === 'function';
}

function speechVoices() {
  if (!speechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch (_) {
    return [];
  }
}

/**
 * Voz que el navegador resuelve fuera de este PC. Se confia en `localService`
 * cuando el navegador lo declara: Windows trae voces "Natural" instaladas en el
 * propio disco, y tratarlas como de internet dejaba solo la voz robotica.
 */
function isCloudVoice(voice) {
  if (!voice) return false;
  const label = (String(voice.name || '') + ' ' + String(voice.uri || '')).toLowerCase();
  const offDevice = /\bon(ly|line)\b|cloud|http|[a-z]+\.microsoft|\bgoogle\b/.test(label);
  if (voice.localService === false) return true;
  if (voice.localService === true) return offDevice;
  return offDevice || /natural|neural|wavenet|premium|enhanced/.test(label);
}

/** Clave estable de una voz: con esto se recuerda la que eligio el usuario. */
function voiceChoiceKey(voice) {
  return String((voice && voice.name) || '') + '|' + String((voice && voice.lang) || '');
}

/**
 * Puntos de naturalidad de una voz. Cuanto mas alto, mejor suena: las voces
 * "Natural"/"Neural"/"Enhanced" de Windows y Edge dejan atras a la SAPI clasica,
 * que es la que suena a robot. Solo sirve para ordenar, nunca para inventar.
 */
function speechVoiceScore(voice, langHint) {
  const name = String((voice && voice.name) || '').toLowerCase();
  const tag = String((voice && voice.lang) || '').toLowerCase().replace('_', '-');
  let score = 0;
  if (/natural|neural|wavenet|premium|enhanced|studio|multispeaker/.test(name)) score += 320;
  if (/compact|robot|console|telugu|konchnic|old/.test(name)) score -= 90;
  const wanted = String(langHint || 'es').toLowerCase().replace('_', '-');
  if (tag && tag === wanted) score += 240;
  else if (tag && tag.split('-')[0] === wanted.split('-')[0]) score += 160;
  if (voice && voice.localService === true) score += 70;
  if (voice && voice.default) score += 30;
  return score;
}

/** El idioma que se prefiere leer: el de la pagina, sin inventarse otro. */
function speechLangHint() {
  return String(document.documentElement.lang || 'es').toLowerCase();
}

/** Solo se usan voces que sacan el texto de casa si el usuario lo marca. */
function allowCloudVoices() {
  return localSetting(VOICE_CLOUD_KEY, '0') === '1';
}

function setCloudVoicesAllowed(allowed) {
  saveLocalSetting(VOICE_CLOUD_KEY, allowed ? '1' : '0');
  speech.voice = null;
  refreshVoiceRow();
}

/** Busca la voz: la elegida a mano si sigue existiendo; si no, la mejor local. */
function pickSpeechVoice() {
  const voices = speechVoices();
  if (!voices.length) return null;
  const saved = localSetting(VOICE_KEY, '');
  if (saved) {
    const chosen = voices.find((voice) => voiceChoiceKey(voice) === saved);
    if (chosen && (allowCloudVoices() || !isCloudVoice(chosen))) return chosen;
  }
  const pool = allowCloudVoices() ? voices.slice() : voices.filter((voice) => !isCloudVoice(voice));
  if (!pool.length) return null;
  const hint = speechLangHint();
  pool.sort((a, b) => {
    const delta = speechVoiceScore(b, hint) - speechVoiceScore(a, hint);
    return delta !== 0 ? delta : String(a.name || '').localeCompare(String(b.name || ''));
  });
  return pool[0];
}

/** Como se describe la voz en el panel: nombre, idioma y de donde sale el audio. */
function describeVoice(voice) {
  const name = String((voice && voice.name) || 'voz sin nombre');
  const bits = [name, (voice && voice.lang) || 'sin idioma'];
  if (isCloudVoice(voice)) bits.push('el texto sale de este PC');
  else if (/natural|neural|enhanced|premium/.test(name.toLowerCase())) bits.push('natural, instalada aqui');
  else bits.push('local');
  return bits.join(' - ');
}

/** Sello de la lista de voces: si no cambia, el desplegable no se reconstruye. */
function voiceSignatureOf(voices, cloudAllowed) {
  return String(cloudAllowed) + '#' + (voices || [])
    .map((voice) => voiceChoiceKey(voice) + (isCloudVoice(voice) ? '~nube' : '~local'))
    .join('|');
}

let voiceListSignature = '';

/** Rellena el desplegable: primero las locales y las del navegador aparte. */
function fillVoiceControls() {
  const select = dom.voicePick;
  if (!select) return;
  const voices = speechVoices();
  const signature = voiceSignatureOf(voices, allowCloudVoices());
  if (signature === voiceListSignature && select.options.length) return;
  voiceListSignature = signature;
  const hint = speechLangHint();
  const ordered = (list) => list
    .slice()
    .sort((a, b) => {
      const delta = speechVoiceScore(b, hint) - speechVoiceScore(a, hint);
      return delta !== 0 ? delta : String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((voice) => {
      const option = document.createElement('option');
      option.value = voiceChoiceKey(voice);
      option.textContent = String(voice.name || 'voz sin nombre') + ' (' + (voice.lang || 'sin idioma') + ')' +
        (isCloudVoice(voice) ? ' - saca el texto de casa' : '');
      return option;
    });

  const saved = localSetting(VOICE_KEY, '');
  select.textContent = '';

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = voices.length
    ? 'Automatica: la mejor local (' + voices.filter((voice) => !isCloudVoice(voice)).length + ' en este PC)'
    : 'el sistema aun no carga voces';
  select.appendChild(auto);

  const local = document.createElement('optgroup');
  local.label = 'Voces locales (el texto no sale de tu PC)';
  ordered(voices.filter((voice) => !isCloudVoice(voice))).forEach((option) => local.appendChild(option));
  select.appendChild(local);

  const remote = document.createElement('optgroup');
  remote.label = 'Voces del navegador (envian el texto fuera)';
  if (allowCloudVoices()) {
    ordered(voices.filter(isCloudVoice)).forEach((option) => remote.appendChild(option));
  } else {
    const blocked = document.createElement('option');
    blocked.value = '';
    blocked.textContent = 'activa "usar voces del navegador" para poder elegirlas';
    blocked.disabled = true;
    remote.appendChild(blocked);
  }
  select.appendChild(remote);

  select.value = saved;
  if (select.value !== saved) select.value = '';
}

function setVoiceChoice(key) {
  saveLocalSetting(VOICE_KEY, key || '');
  speech.voice = pickSpeechVoice();
  refreshVoiceRow();
}

/** Redondea y encierra la velocidad: nunca baja del 100% ni pasa del 200%. */
function clampVoiceRate(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return RATE_DEFAULT;
  const rounded = Math.round(num);
  if (rounded < RATE_MIN) return RATE_MIN;
  if (rounded > RATE_MAX) return RATE_MAX;
  return rounded;
}

function voiceRateSetting() {
  return clampVoiceRate(localSetting(VOICE_RATE_KEY, RATE_DEFAULT));
}

/** Del porcentaje guardado al factor que admite la sintesis de voz (1 a 2). */
function voiceRateFactor() {
  return voiceRateSetting() / 100;
}

/** Como se ensena la velocidad en el panel: 145% (1.45x). */
function formatVoiceRate(percent) {
  return percent + '% (' + (percent / 100).toFixed(2) + 'x)';
}

function paintVoiceRate() {
  const percent = voiceRateSetting();
  if (dom.voiceRate) dom.voiceRate.value = String(percent);
  if (dom.voiceRateValue) dom.voiceRateValue.textContent = formatVoiceRate(percent);
  return percent;
}

function setVoiceRate(value) {
  saveLocalSetting(VOICE_RATE_KEY, clampVoiceRate(value));
  const percent = paintVoiceRate();
  if (speech.voice) setText('inspVoice', describeVoice(speech.voice) + ', al ' + percent + '%');
}

/** Devuelve a lo guardado los controles de voz al abrir la interfaz. */
function restoreVoiceSettings() {
  if (dom.voiceCloud) dom.voiceCloud.checked = allowCloudVoices();
  paintVoiceRate();
}

function refreshVoiceRow() {
  if (!speechSupported()) {
    setText('inspVoice', 'este navegador no puede leer en voz alta');
    return;
  }
  fillVoiceControls();
  speech.voice = pickSpeechVoice();
  const percent = paintVoiceRate();
  if (speech.voice) {
    setText('inspVoice', describeVoice(speech.voice) + ', al ' + percent + '%');
    return;
  }
  const cloud = speechVoices().filter(isCloudVoice);
  if (cloud.length) {
    setText('inspVoice', 'solo hay ' + cloud.length + ' voces del navegador: activalas en "Voz de lectura" si quieres leer con ellas');
    return;
  }
  setText('inspVoice', 'el sistema aun no carga sus voces');
}

/** El markdown no se dice en voz alta: se queda con lo que se leeria. */
function plainForSpeech(text) {
  return String(text || '')
    .replace(/```[^\n]*\n[\s\S]*?```/g, ' (aqui habia codigo, no se lee) ')
    .replace(/~~~[^\n]*\n[\s\S]*?~~~/g, ' (aqui habia codigo, no se lee) ')
    .replace(/`([^`]*)`/g, ' $1 ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' (imagen) ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\|/g, ' , ')
    .replace(/(\*\*|__|~~|[*_~#])/g, '')
    // Emojis, flechas y demas pictogramas: los motores de voz los leen fatal
    // (algunos se los saltan y cortan la frase). Se quitan en silencio.
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
    .replace(/[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/g, ' ')
    // Rayas y puntos suspensivos: mejor una pausa breve que un silencio raro.
    .replace(/[\u2013\u2014\u2026]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * En trozos cortos: los motores de voz se cortan con parrafos eternos y, ademas,
 * entre trozo y trozo hay una pausa natural. Se corta antes en punto y seguido.
 */
function speechChunks(text, limit) {
  const max = Number(limit) || 320;
  const parts = [];
  let rest = String(text || '');
  while (rest.length > max) {
    const windowText = rest.slice(0, max);
    const sentence = Math.max(windowText.lastIndexOf('. '), windowText.lastIndexOf('? '), windowText.lastIndexOf('! '));
    const soft = Math.max(windowText.lastIndexOf(', '), windowText.lastIndexOf('; '), windowText.lastIndexOf(': '), windowText.lastIndexOf(' '));
    if (sentence > max * 0.4) {
      // Se corta despues del punto: el trozo termina de verdad y hay pausa.
      parts.push(rest.slice(0, sentence + 1).trim());
      rest = rest.slice(sentence + 1).trim();
    } else if (soft > max * 0.3) {
      const keepComma = soft > 0 && /[,;:]$/.test(windowText.slice(0, soft + 1));
      const edge = keepComma ? soft + 1 : soft;
      parts.push(rest.slice(0, edge).trim());
      rest = rest.slice(edge).trim();
    } else {
      parts.push(rest.slice(0, max).trim());
      rest = rest.slice(max).trim();
    }
  }
  if (rest) parts.push(rest.trim());
  return parts.filter(Boolean);
}

/**
 * Prosodia por trozo: la sintesis suena a robot si todo va al mismo tono. Se sube
 * un poco en preguntas y exclamaciones y se baja al cerrar el ultimo trozo.
 */
function prosodyFor(text, index, total) {
  const clean = String(text || '').trim();
  const count = Number(total) || 1;
  const position = Number(index) || 0;
  let pitch = 1;
  if (/[?!]\s*$/.test(clean)) pitch += 0.06;
  else if (/[,;:]\s*$/.test(clean)) pitch -= 0.03;
  if (count > 1 && position === 0) pitch += 0.02;
  if (count > 1 && position === count - 1) pitch -= 0.03;
  if (clean.length > 3 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) pitch -= 0.06;
  if (pitch < 0.8) pitch = 0.8;
  if (pitch > 1.2) pitch = 1.2;
  return { pitch: Number(pitch.toFixed(2)) };
}

function speechBusy() {
  if (!speechSupported()) return false;
  return Boolean(window.speechSynthesis.speaking || window.speechSynthesis.pending || speech.queue.length);
}

function clearSpeechQueue() {
  speech.queue = [];
  if (speech.timer) {
    window.clearInterval(speech.timer);
    speech.timer = null;
  }
}

/** Chrome corta la sintesis al cabo de unos 15 s: este reloj la desatasca. */
function startSpeechKeepAlive() {
  if (speech.timer) window.clearInterval(speech.timer);
  speech.timer = window.setInterval(() => {
    if (!speechSupported()) return;
    if (!speech.queue.length && !window.speechSynthesis.speaking) {
      window.clearInterval(speech.timer);
      speech.timer = null;
      return;
    }
    try {
      window.speechSynthesis.resume();
    } catch (_) {
      /* si no estaba pausada, resume no hace nada */
    }
  }, 9000);
}

function stopSpeech() {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {
    /* no habia nada sonando */
  }
  clearSpeechQueue();
  if (speech.button) {
    speech.button.textContent = 'Leer en voz alta';
    speech.button.classList.remove('is-reading');
    speech.button = null;
  }
}

/**
 * Voz, velocidad y tono se aplican en el ultimo momento: si se cambia mientras
 * se esta leyendo, los trozos que faltan salen ya con el ajuste nuevo.
 */
function applyVoiceTo(line, index, total) {
  const voice = speech.voice || pickSpeechVoice();
  if (voice) {
    line.voice = voice;
    line.lang = voice.lang || 'es-ES';
  }
  line.rate = voiceRateFactor();
  line.pitch = prosodyFor(line.text, index, total).pitch;
  line.volume = 1;
}

/** Se encadena trozo a trozo: pausa natural entre ellos y nada de colas eternas. */
function speakQueued() {
  if (!speechSupported() || !speech.button) return;
  if (!speech.queue.length) {
    stopSpeech();
    return;
  }
  const job = speech.queue.shift();
  const next = () => {
    if (!speech.button) return;
    if (speech.queue.length) speakQueued();
    else stopSpeech();
  };
  job.line.onend = next;
  job.line.onerror = next;
  applyVoiceTo(job.line, job.index, job.total);
  try {
    window.speechSynthesis.speak(job.line);
  } catch (_) {
    stopSpeech();
  }
}

function speakAnswer(text, button) {
  if (!speechSupported()) return;
  const same = speech.button === button;
  stopSpeech();
  if (same) return;

  const plain = plainForSpeech(text);
  if (!plain) return;

  speech.voice = pickSpeechVoice();
  if (!speech.voice) {
    // O el sistema no tiene voces, o solo tiene voces que sacan el texto de casa.
    button.textContent = allowCloudVoices() ? 'Sin voz disponible' : 'Sin voz local: eligela en Detalles';
    window.setTimeout(() => {
      if (speech.button !== button) button.textContent = 'Leer en voz alta';
    }, 2600);
    return;
  }

  const parts = speechChunks(plain);
  speech.queue = parts.map((part, index) => ({
    line: new window.SpeechSynthesisUtterance(part),
    index,
    total: parts.length,
  }));
  speech.button = button;
  button.textContent = 'Parar la lectura';
  button.classList.add('is-reading');
  startSpeechKeepAlive();
  speakQueued();
}

/** Boton de lectura para una respuesta; null si el navegador no habla. */
function speakButton(getText) {
  if (!speechSupported()) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-read';
  button.textContent = 'Leer en voz alta';
  button.title = 'Que la voz del navegador lea la respuesta (Esc para parar; voz y velocidad se cambian en Detalles)';
  button.addEventListener('click', () => speakAnswer(getText(), button));
  return button;
}

/**
 * Fila de acciones de una respuesta del asistente: copiar con formato, copiar
 * como texto corriente y, si hay voz local, leer en voz alta. Se reutiliza en
 * el historial cargado y en la respuesta que va llegando en streaming.
 */
function answerActions(getText) {
  const group = document.createDocumentFragment();
  group.append(
    copyButton(getText, 'Copiar respuesta', 'Copiar la respuesta tal cual, con su formato markdown'),
    copyButton(() => plainForCopy(getText()), 'Copiar sin formato', 'Copiar la respuesta como texto corriente')
  );
  const listen = speakButton(getText);
  if (listen) group.append(listen);
  return group;
}

// --- Enviar y recibir en streaming -------------------------------------------
function pendingNode() {
  const wrap = document.createElement('div');
  wrap.className = 'msg is-assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble is-thinking';

  const body = document.createElement('div');
  bubble.append(body);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'Pensando...';

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  wrap.append(bubble, meta, actions);
  dom.thread.append(wrap);
  scrollToBottom(true);
  return { wrap, bubble, body, meta, actions, text: '', finished: false };
}

function paintStreaming(pending) {
  renderInto(pending.body, pending.text);
}

function markFailed(pending, text) {
  pending.finished = true;
  pending.bubble.classList.remove('is-thinking');
  pending.bubble.classList.add('is-error');
  pending.text += (pending.text ? '\n\n' : '') + text;
  paintStreaming(pending);
  pending.meta.textContent = 'fallo';
  if (!pending.actions.querySelector('.btn-copy')) {
    pending.actions.append(copyButton(() => pending.text, 'Copiar aviso', 'Copiar el aviso de error para pegarlo donde haga falta'));
  }
}

function handleStreamEvent(event, pending) {
  if (!event || !event.type) return;

  if (event.type === 'start') {
    if (event.chatId) state.currentId = event.chatId;
    // El servidor ya ha guardado el mensaje: ahi vienen los id y lo que se ha leido de cada PDF.
    if (event.userMessage && pending.localUser) {
      pending.localUser.id = event.userMessage.id || pending.localUser.id;
      if (Array.isArray(event.userMessage.attachments)) pending.localUser.attachments = event.userMessage.attachments;
      const fresh = messageNode(pending.localUser);
      if (pending.userCard && pending.userCard.parentNode) pending.userCard.replaceWith(fresh);
      pending.userCard = fresh;
    }
    if (event.chat) {
      state.currentChat = event.chat;
      applyChatHeader(event.chat);
    }
    return;
  }

  if (event.type === 'notice') {
    pending.notices = (pending.notices || []).concat([event.notice || '']);
    pending.meta.textContent = pending.notices.filter(Boolean).join(' · ');
    return;
  }

  if (event.type === 'reset') {
    pending.text = '';
    pending.body.textContent = '';
    pending.body.classList.add('is-thinking');
    return;
  }

  if (event.type === 'delta') {
    pending.text += event.content || '';
    paintStreaming(pending);
    scrollToBottom();
    return;
  }

  if (event.type === 'done') {
    pending.finished = true;
    pending.bubble.classList.remove('is-thinking');
    pending.body.classList.remove('is-thinking');
    if (event.message) {
      state.messages.push(event.message);
      renderInto(pending.body, event.message.content || '(sin texto)');
      pending.text = event.message.content || '(sin texto)';
      pending.meta.textContent = messageMetaText(event.message);
    }
    if (event.chat) {
      state.currentChat = event.chat;
      applyChatHeader(event.chat);
    }
    if (event.meta) {
      state.lastReply = {
        elapsedMs: event.meta.elapsedMs,
        tokens: event.meta.usage ? event.meta.usage.completion_tokens : null,
        droppedImages: Boolean(event.meta.droppedImages),
        imageError: event.meta.imageError || null,
      };
      if (event.meta.droppedImages) {
        const why = String(event.meta.imageError || '').slice(0, 90);
        pending.meta.textContent += ' · la imagen no se acepto, se reenvio solo el texto' + (why ? ' (' + why + ')' : '');
      }
      const bits = [];
      if (Number.isFinite(event.meta.elapsedMs)) bits.push((event.meta.elapsedMs / 1000).toFixed(1) + ' s');
      if (event.meta.usage && Number.isFinite(event.meta.usage.completion_tokens)) {
        bits.push(event.meta.usage.completion_tokens + ' tokens de salida');
      }
      if (event.meta.model) bits.push(event.meta.model);
      if (bits.length) pending.meta.textContent += ' · ' + bits.join(' · ');
    }
    if (event.message && String(event.message.content || '').trim()) {
      pending.actions.append(answerActions(() => event.message.content));
    }
    fillInspector();
    return;
  }

  if (event.type === 'error') {
    markFailed(pending, 'Strata ha fallado: ' + (event.error || 'error desconocido'));
  }
}

/** Lee el stream SSE de /api/chat y va entregando eventos al llamante. */
async function streamChat(body, signal, onEvent) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ stream: true }, body)),
    signal,
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || contentType.indexOf('text/event-stream') === -1) {
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    throw new Error(data && data.error ? data.error : 'El servidor contesto HTTP ' + response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (signal.aborted) break;
      throw err;
    }
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      rawEvent.split('\n').forEach((line) => {
        if (line.indexOf('data:') !== 0) return;
        const jsonText = line.slice(5).trim();
        if (!jsonText) return;
        try {
          onEvent(JSON.parse(jsonText));
        } catch (_) {
          /* evento incompleto o comentario, se ignora */
        }
      });
      separator = buffer.indexOf('\n\n');
    }
  }
}

function stopStreaming() {
  if (state.abort) {
    try {
      state.abort.abort();
    } catch (_) {
      /* ya cerrada */
    }
    state.abort = null;
  }
}

async function sendCurrentMessage() {
  const text = dom.input.value.trim();
  const picked = state.attachments.slice();
  const images = picked.filter((item) => !isDocFile(item));
  const docs = picked.filter((item) => isDocFile(item));
  if (!text && !picked.length) return;

  // Antes de enviar: si el paquete no cabe en el servidor, se avisa aqui y no se pierde el mensaje.
  if (picked.length && payloadBytes(text) > bodyLimitBytes()) {
    attachNote(
      'Esos ' + picked.length + ' adjuntos suman ' + formatBytes(payloadBytes(text)) +
        ' y este servidor local acepta ' + formatBytes(bodyLimitBytes()) + ': quita alguno o usa archivos mas pequenos.',
      true
    );
    return;
  }

  stopSpeech();
  dom.input.value = '';
  autosize();
  clearAttachments();

  const localUser = {
    role: 'user',
    content: text,
    created_at: new Date().toISOString(),
    attachments: picked.map((item) => ({ id: null, name: item.name, mime: item.mime, bytes: item.bytes, url: item.url })),
  };
  state.messages.push(localUser);
  const userCard = messageNode(localUser);
  dom.thread.append(userCard);
  fillInspector();
  scrollToBottom(true);

  const pending = pendingNode();
  pending.userCard = userCard;
  pending.localUser = localUser;
  setBusy(true);

  const controller = new AbortController();
  state.abort = controller;

  const body = { chatId: state.currentId, content: text };
  if (images.length) {
    body.images = images.map((item) => ({ name: item.name, mime: item.mime, data: item.base64 }));
  }
  // Un PDF nunca viaja como imagen: se manda el binario y el servidor saca su texto.
  if (docs.length) {
    body.documents = docs.map((item) => ({ name: item.name, mime: item.mime, data: item.base64 }));
  }

  try {
    await streamChat(body, controller.signal, (event) => handleStreamEvent(event, pending));
    if (!pending.finished) {
      pending.finished = true;
      pending.bubble.classList.remove('is-thinking');
      pending.body.classList.remove('is-thinking');
      pending.meta.textContent = pending.text ? 'respuesta cortada' : 'respuesta cortada sin texto';
    }
  } catch (err) {
    if (controller.signal.aborted) {
      pending.finished = true;
      pending.bubble.classList.remove('is-thinking');
      pending.meta.textContent = 'respuesta cortada';
    } else {
      markFailed(pending, 'No se pudo hablar con Strata: ' + err.message);
    }
  } finally {
    state.abort = null;
    setBusy(false);
    await refreshStatus().catch(() => {});
    await refreshChats().catch(() => {});
    scrollToBottom();
  }
}

// --- Cuadro de texto y arranque ----------------------------------------------
const debouncedSearch = debounce((term) => runSearch(term), 250);

function autosize() {
  dom.input.style.height = 'auto';
  dom.input.style.height = Math.min(dom.input.scrollHeight, 220) + 'px';
}

function wire() {
  wireBlockCopy();
  dom.btnNew.addEventListener('click', newChat);
  dom.btnRetry.addEventListener('click', () => {
    refreshStatus();
    refreshChats();
  });
  dom.btnDelete.addEventListener('click', () => {
    if (state.currentChat) removeChat(state.currentChat.id, state.currentChat.title);
  });
  dom.btnRename.addEventListener('click', renameCurrentChat);
  dom.chatTitle.addEventListener('dblclick', renameCurrentChat);
  dom.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) {
      stopStreaming();
      return;
    }
    sendCurrentMessage();
  });
  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  dom.input.addEventListener('input', autosize);
  dom.search.addEventListener('input', (event) => debouncedSearch(event.target.value.trim()));

  // Adjuntar imagenes y PDF: boton + selector de ficheros.
  dom.btnAttach.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', async () => {
    await addAttachedFiles(dom.fileInput.files);
    dom.fileInput.value = '';
  });

  // Pegar una imagen o un PDF con Ctrl+V.
  dom.input.addEventListener('paste', async (event) => {
    const files = pickedAttachFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    await addAttachedFiles(files);
  });

  // Arrastrar y soltar sobre la conversacion.
  const chatPane = document.querySelector('.chat');
  if (chatPane) {
    ['dragenter', 'dragover'].forEach((type) => {
      chatPane.addEventListener(type, (event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        chatPane.classList.add('is-dropping');
      });
    });
    chatPane.addEventListener('dragleave', (event) => {
      if (event.relatedTarget && chatPane.contains(event.relatedTarget)) return;
      chatPane.classList.remove('is-dropping');
    });
    chatPane.addEventListener('drop', async (event) => {
      event.preventDefault();
      chatPane.classList.remove('is-dropping');
      await addAttachedFiles(pickedAttachFiles(event.dataTransfer));
    });
  }

  // Panel de detalles.
  dom.btnInspector.addEventListener('click', () => setInspector(!inspectorOpen()));
  dom.btnInspectorClose.addEventListener('click', () => setInspector(false));
  dom.btnExport.addEventListener('click', exportCurrentChat);

  // Ancho del chat y medidas de pantalla (panel de detalles y ?medida=1).
  if (dom.btnWidth) dom.btnWidth.addEventListener('click', toggleWidthMode);
  window.addEventListener('resize', paintLayoutRows);
  window.addEventListener('orientationchange', paintLayoutRows);

  // Leer en voz alta: Esc corta la lectura estemos donde estemos.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && speechBusy()) stopSpeech();
  });
  // Ajustes de voz: se guardan en el propio navegador. Si se esta leyendo, el
  // cambio se nota en los trozos que aun no han empezado a sonar.
  if (dom.voicePick) dom.voicePick.addEventListener('change', () => setVoiceChoice(dom.voicePick.value));
  if (dom.voiceRate) dom.voiceRate.addEventListener('input', () => setVoiceRate(dom.voiceRate.value));
  if (dom.voiceCloud) dom.voiceCloud.addEventListener('change', () => setCloudVoicesAllowed(dom.voiceCloud.checked));
  if (speechSupported() && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', () => refreshVoiceRow());
  }
}

async function init() {
  wire();
  restoreInspector();
  restoreWidthMode();
  autosize();
  restoreVoiceSettings();
  refreshVoiceRow();
  await refreshStatus();
  const loaded = await refreshChats();
  if (loaded && state.chats.length) {
    await openChat(state.chats[0].id);
  } else {
    newChat();
    if (!loaded) {
      clearMessages();
      emptyState(
        'El servidor local no ha devuelto el historial (' + (state.loadError || 'sin respuesta') +
          '). Lanza start-strata-chat.cmd: no abre ninguna ventana y esta pestana se',
          ' reconecta sola en unos segundos, sin recargar.'
      );
    }
  }
  armStatusTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
