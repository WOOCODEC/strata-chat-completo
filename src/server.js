'use strict';

/**
 * server.js - Servidor local del chat con Strata.
 *
 * Escucha SOLO en 127.0.0.1, asi que nadie de tu red puede abrirlo: es tuyo.
 * Sirve la interfaz de src/public y expone una API propia que guarda el
 * historial en SQLite y reenvia los mensajes a tu IA local.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const express = require('express');
const cors = require('cors');

const db = require('./dbService');
const strata = require('./strataService');
const pdf = require('./pdfService');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  return String(raw).trim().toLowerCase() === 'true';
}

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: envNumber('PORT', 3000),
  baseUrl: String(process.env.STRATA_BASE_URL || 'http://127.0.0.1:8080/v1').trim().replace(/\/+$/, ''),
  apiKey: process.env.STRATA_API_KEY || 'strata-local',
  model: String(process.env.STRATA_MODEL || '').trim(),
  dbPath: path.resolve(ROOT, process.env.DB_PATH || './database/chat.db'),
  maxHistory: Math.max(2, envNumber('MAX_HISTORY_MESSAGES', 24)),
  temperature: envNumber('TEMPERATURE', 0.7),
  maxTokens: envNumber('MAX_TOKENS', 0) > 0 ? envNumber('MAX_TOKENS', 0) : null,
  timeoutMs: envNumber('REQUEST_TIMEOUT_MS', 180000),
  allowRemote: envFlag('ALLOW_REMOTE_STRATA', false),
  maxInputChars: envNumber('MAX_INPUT_CHARS', 12000),
  contextChars: envNumber('MAX_CONTEXT_CHARS', 60000),
  maxImageBytes: Math.max(16384, envNumber('MAX_IMAGE_BYTES', 4 * 1024 * 1024)),
  maxImagesPerMessage: Math.min(8, Math.max(1, envNumber('MAX_IMAGES_PER_MESSAGE', 4))),
  maxPdfBytes: Math.max(65536, envNumber('MAX_PDF_BYTES', 8 * 1024 * 1024)),
  maxPdfPerMessage: Math.min(8, Math.max(1, envNumber('MAX_PDF_PER_MESSAGE', 4))),
  // Lo que se le inyecta al modelo por documento y por mensaje. Sin estos topes
  // un PDF de 300 paginas se comeria toda la ventana de contexto.
  maxPdfTextChars: Math.max(2000, envNumber('MAX_PDF_TEXT_CHARS', 12000)),
  maxPdfTotalChars: Math.max(4000, envNumber('MAX_PDF_TOTAL_CHARS', 40000)),
};

const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PDF_MIME = pdf.PDF_MIME;

// Se publica en /api/status: si la interfaz no la ve, el servidor que esta
// sonando es de una tanda anterior y hay que reiniciarlo.
const API_REVISION = 'v4-adjuntos-pdf';

const state = {
  startedAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  model: config.model || null,
  models: [],
  lastHealth: null,
  privacyWarning: null,
  vision: null,
};

// --- Salvaguarda de privacidad: nada debe salir de este equipo ---------------
let privacy;
try {
  privacy = strata.assertPrivateBaseUrl(config.baseUrl, config.allowRemote);
} catch (err) {
  console.error('[ARRANQUE] ' + err.message);
  process.exit(1);
}
state.privacyWarning = privacy.warning;
if (!privacy.local) console.warn('[AVISO] ' + privacy.warning);

db.init(config.dbPath);

const client = strata.createClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: config.timeoutMs });

const app = express();
app.disable('x-powered-by');
// Limite a medida: las imagenes y los PDF viajan en base64 dentro del JSON
// (4/3 de su tamano real) mas el resto del mensaje. Se publica en /api/status
// para que el navegador pueda avisar ANTES de enviar nada.
const JSON_BODY_LIMIT_BYTES =
  Math.ceil(
    (((config.maxImageBytes * config.maxImagesPerMessage) + (config.maxPdfBytes * config.maxPdfPerMessage)) * 4) /
      3 /
      (1024 * 1024) +
      2
  ) * 1024 * 1024;

/** Tamano legible para los avisos: 24 MB, 4 MB, 512 KB... */
function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '?';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return Math.round(n) + ' B';
}

app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));

// CORS: solo la propia pagina del servidor, sin origenes externos.
const allowedOrigins = new Set(['http://127.0.0.1:' + config.port, 'http://localhost:' + config.port]);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido: ' + origin));
    },
  })
);

// Encabezados para que el navegador no cargue NADA de fuera (ni un CDN).
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
      "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Nada de lo que sale de este servidor puede guardarse en el navegador. Antes la
// portada iba con `no-cache` y los ficheros con `max-age=0`, o sea «guardalo pero
// pregunta cada vez». Ese «pregunta cada vez» se cae cuando el servidor NO esta
// arriba: al reiniciar el PC y restaurar Chrome la pestana, pinta directamente la
// copia de su disco y sale la maquetacion de otra tanda (el sidebar de 428 px con
// el chat de 1868 px montado encima, y la franja negra a la derecha). Con
// `no-store` la copia no llega a existir, y encima cada arrancada enlaza los
// ficheros con ?v=SELO, una URL jamas vista. Se aplica a TODO: portada,
// style.css/script.js/markdown.js y tambien /api/status (una respuesta de /api/status
// guardada haria creer a la interfaz que su sello es el bueno cuando no lo es).
const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0, no-transform';
app.use((req, res, next) => {
  res.setHeader('Cache-Control', NO_STORE);
  res.setHeader('Pragma', 'no-cache'); // clientes y proxies antiguos
  res.setHeader('Expires', '0');
  next();
});

// Sello de ESTA arrancada, para diagnostico: se publica en /api/status como
// server.build y asi el panel de detalles puede decir que la interfaz que ves
// es la del servidor que suena en este puerto. Los enlaces de la portada NO
// llevan consulta de version: salen limpios (href="style.css",
// src="script.js"). Lo que impide reutilizar una copia rancia no es una URL
// distinta, es la cabecera «Cache-Control: no-store» de arriba: si el
// navegador no guarda copia, no puede pintar la interfaz de otra tanda. Y es
// lo que resuelve el caso del reinicio del PC, cuando la pestana restaurada
// contestaba de su propio disco sin tener a quien preguntarle.
//
// El sello sigue sirviendo para el diagnostico (panel de detalles y arneses),
// pero ya no se mete en los enlaces de la portada.
const BUILD_STAMP = API_REVISION + '-' + process.pid + '-' + Date.now().toString(36);
// Cache de la portada leida del disco: se releera solo si el fichero cambia de
// fecha o de tamano. TIENE que estar declarada aqui: al quitar el sellado ?v= de
// los enlaces desaparecio esta linea, y la portada reventaba con
// «ReferenceError: shellCache is not defined», devolviendo
// {"ok":false,"error":"Error interno del servidor local."} en lugar del HTML.
// Eso es lo que dejaba la pantalla parada en «Comprobando conexion con Strata».
const shellCache = { key: '', html: '' };

function stampedShell() {
  const file = path.join(PUBLIC_DIR, 'index.html');
  const stat = fs.statSync(file);
  const key = stat.mtimeMs + ':' + stat.size;
  if (shellCache.key !== key) {
    shellCache.key = key;
    shellCache.html = fs.readFileSync(file, 'utf8');
  }
  return shellCache.html;
}

// La portada NO la sirve express.static: pasa por aqui para que el navegador
// nunca se quede con un HTML de otra tanda (el no-store lo pone la cabecera
// global de arriba).
// no-store lo pone la cabecera global de arriba.
app.get(['/', '/index.html'], (req, res) => {
  res.type('html');
  res.send(stampedShell());
});

// El resto de ficheros salen del disco con su ETag de siempre. `cacheControl:
// false` es obligatorio: si no, send() escribiese su propio «Cache-Control:
// public, max-age=0» y tapase el no-store global. Con max-age=0 el navegador
// guardaba la copia y solo la revalidaba si el servidor estaba arriba; al
// reiniciar el PC con la pestana abierta no habia a quien preguntar y acababa
// pintando la hoja de estilo de otra tanda. El ETag sigue ahi para que un cambio
// de fichero se note al instante. La consulta ?v=... no afecta a la ruta, asi
// que /style.css?v=SELO funciona igual.
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    index: 'index.html',
    cacheControl: false,
    etag: true,
    lastModified: true,
  })
);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function pickModel(requested) {
  const candidate = String((requested && requested.model) || requested || '').trim();
  if (candidate && /^[A-Za-z0-9._:/\-]+$/.test(candidate)) return candidate;
  return state.model || (state.models.length ? state.models[0].id : null);
}

/** Recorta el historial que se reenvia al modelo (por mensajes y por caracteres). */
function buildPrompt(messages) {
  const recent = messages.slice(-config.maxHistory);
  const kept = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    let text = message.content || '';
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const documents = attachments.filter((file) => String(file.mime || '') === PDF_MIME);
    const pictures = attachments.filter((file) => String(file.mime || '') !== PDF_MIME);
    if (pictures.length) {
      text += (text ? '\n' : '') + '[imagen adjuntada: ' + pictures.map((file) => file.name).join(', ') + ']';
    }
    // De los documentos de mensajes anteriores solo se nombra: el texto completo
    // se inyecta una vez, en el mensaje que lo subio (si no, el contexto se llena solo).
    if (documents.length) {
      text +=
        (text ? '\n' : '') +
        '[documento adjuntado: ' +
        documents
          .map((file) => file.name + (file.text_chars ? ' (' + file.text_chars + ' caracteres leidos)' : ''))
          .join(', ') +
        ']';
    }
    const size = text.length;
    if (kept.length > 0 && used + size > config.contextChars) break;
    used += size;
    kept.unshift({ role: message.role, content: text });
  }
  return kept;
}

// --- Adjuntos de imagen ------------------------------------------------------
const IMAGE_SIGNATURES = [
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.length > 6 && b.slice(0, 3).toString('latin1') === 'GIF' },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP',
  },
];

function imageLimitMessage() {
  return 'Imagen demasiado grande (maximo ' + Math.round(config.maxImageBytes / 1024 / 1024) + ' MB).';
}

/** Nombre de fichero inofensivo: sin rutas, sin comillas y sin saltos de linea. */
function safeFilename(name, fallback = 'imagen') {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop();
  const clean = base.replace(/["'\r\n\t\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || fallback;
}

/** Valida las imagenes que llegan en el mensaje. Devuelve { files, error }. */
function readIncomingImages(body) {
  if (body.images === undefined || body.images === null || body.images === '') return { files: [], error: null };
  if (!Array.isArray(body.images)) return { files: [], error: 'El campo images debe ser una lista de imagenes.' };
  if (!body.images.length) return { files: [], error: null };
  if (body.images.length > config.maxImagesPerMessage) {
    return { files: [], error: 'Puedes adjuntar como maximo ' + config.maxImagesPerMessage + ' imagenes por mensaje.' };
  }

  const files = [];
  for (const raw of body.images) {
    if (!raw || typeof raw !== 'object') return { files: [], error: 'Cada imagen necesita nombre, tipo y datos.' };
    const mime = String(raw.mime || '').toLowerCase();
    if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
      return { files: [], error: 'Tipo no admitido: ' + (mime || '(vacio)') + '. Solo PNG, JPG, WEBP o GIF.' };
    }
    const base64 = String(raw.data || '').replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
    if (!base64) return { files: [], error: 'Llega una imagen sin datos.' };
    if (base64.length > Math.ceil((config.maxImageBytes * 4) / 3)) return { files: [], error: imageLimitMessage() };

    const blob = Buffer.from(base64, 'base64');
    if (!blob.length) return { files: [], error: 'La imagen no se ha podido decodificar.' };
    if (blob.length > config.maxImageBytes) return { files: [], error: imageLimitMessage() };
    const signature = IMAGE_SIGNATURES.find((sig) => sig.mime === mime && sig.test(blob));
    if (!signature) return { files: [], error: 'La imagen ' + safeFilename(raw.name) + ' no es realmente un archivo ' + mime + '.' };

    files.push({
      id: crypto.randomUUID(),
      name: safeFilename(raw.name),
      mime,
      bytes: blob.length,
      blob,
    });
  }
  return { files, error: null };
}

// --- Adjuntos de documento (PDF) ---------------------------------------------
function pdfLimitMessage() {
  return 'PDF demasiado grande (maximo ' + Math.round(config.maxPdfBytes / 1024 / 1024) + ' MB).';
}

/**
 * Valida los PDF que llegan en el mensaje y les saca el texto aqui mismo, en
 * local. Devuelve { files, notices, error }: cada archivo trae `text`, que es
 * lo que se inyectara en el aviso del modelo.
 */
function readIncomingDocuments(body) {
  if (body.documents === undefined || body.documents === null || body.documents === '') return { files: [], notices: [], error: null };
  if (!Array.isArray(body.documents)) return { files: [], notices: [], error: 'El campo documents debe ser una lista de PDF.' };
  if (!body.documents.length) return { files: [], notices: [], error: null };
  if (body.documents.length > config.maxPdfPerMessage) {
    return { files: [], notices: [], error: 'Puedes adjuntar como maximo ' + config.maxPdfPerMessage + ' PDF por mensaje.' };
  }

  const files = [];
  const notices = [];
  for (const raw of body.documents) {
    if (!raw || typeof raw !== 'object') return { files: [], notices: [], error: 'Cada PDF necesita nombre y datos.' };
    const mime = String(raw.mime || '').toLowerCase();
    if (mime && mime !== PDF_MIME) {
      return { files: [], notices: [], error: 'Tipo no admitido: ' + mime + '. Los documentos solo pueden ser PDF.' };
    }
    const base64 = String(raw.data || '').replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
    if (!base64) return { files: [], notices: [], error: 'Llega un PDF sin datos.' };
    if (base64.length > Math.ceil((config.maxPdfBytes * 4) / 3)) return { files: [], notices: [], error: pdfLimitMessage() };

    const blob = Buffer.from(base64, 'base64');
    if (!blob.length) return { files: [], notices: [], error: 'El PDF no se ha podido decodificar.' };
    if (blob.length > config.maxPdfBytes) return { files: [], notices: [], error: pdfLimitMessage() };
    if (!pdf.looksLikePdf(blob)) {
      return { files: [], notices: [], error: 'El archivo ' + safeFilename(raw.name, 'documento') + ' no es realmente un PDF.' };
    }

    const name = safeFilename(raw.name, 'documento');
    const extraction = pdf.extractPdfText(blob, { maxChars: config.maxPdfTextChars });
    const file = {
      id: crypto.randomUUID(),
      name,
      mime: PDF_MIME,
      bytes: blob.length,
      blob,
      text: extraction.ok ? extraction.text : '',
    };
    if (!extraction.ok) {
      // Un PDF que no se puede abrir no debe tirar el mensaje: se guarda y se avisa.
      notices.push(name + ': ' + (extraction.error || 'no se ha podido leer.'));
    } else if (!extraction.text) {
      notices.push(name + ': ' + (extraction.note || 'no tiene texto que se pueda leer.'));
    } else {
      const extra = [];
      if (extraction.truncated) extra.push('se ha cortado en ' + file.text.length + ' caracteres');
      if (extraction.note) extra.push(extraction.note);
      notices.push(
        name + ': ' + file.text.length + ' caracteres leidos' +
        (extraction.pages ? ' de ' + extraction.pages + (extraction.pages === 1 ? ' pagina' : ' paginas') : '') +
        (extra.length ? ' (' + extra.join('; ') + ')' : '')
      );
    }
    files.push(file);
  }
  return { files, notices, error: null };
}

/** El texto de los PDF del mensaje actual, metido en el aviso del modelo. */
function withDocumentText(prompt, documents) {
  const usable = (documents || []).filter((file) => file.text);
  if (!usable.length || !prompt.length) return prompt;
  const copy = prompt.slice();
  const last = copy[copy.length - 1];
  let budget = config.maxPdfTotalChars;
  const blocks = [];
  usable.forEach((file) => {
    if (budget <= 0) {
      blocks.push('[el texto de "' + file.name + '" no cabe mas en el contexto]');
      return;
    }
    const body = file.text.length > budget ? file.text.slice(0, budget) + '\n[... cortado ...]' : file.text;
    budget -= body.length;
    blocks.push('--- texto de "' + file.name + '" ---\n' + body + '\n--- fin de "' + file.name + '" ---');
  });
  copy[copy.length - 1] = Object.assign({}, last, { content: String(last.content || '') + '\n\n' + blocks.join('\n\n') });
  return copy;
}

/** Mensaje multimodal: texto + imagenes en data:, nunca enlaces externos. */
function withImageParts(entry, files) {
  const parts = [];
  if (entry.content) parts.push({ type: 'text', text: entry.content });
  files.forEach((file) =>
    parts.push({ type: 'image_url', image_url: { url: 'data:' + file.mime + ';base64,' + file.blob.toString('base64') } })
  );
  return { role: entry.role, content: parts };
}

function decoratePrompt(prompt, files) {
  if (!files.length || !prompt.length) return prompt;
  const copy = prompt.slice();
  copy[copy.length - 1] = withImageParts(copy[copy.length - 1], files);
  return copy;
}

function looksLikeImageError(err) {
  const text = String((err && err.message) || '') + ' ' + String((err && err.code) || '');
  return /image|vision|multimodal|modalit|projector|not supported|imagen/i.test(text);
}

/** Solo los errores que gritan "este modelo no ve imagenes". */
function looksLikeVisionCapabilityError(err) {
  const text = String((err && err.message) || '') + ' ' + String((err && err.code) || '');
  return /projector|multimodal|modalit|vision|does not support|unsupported|no soport|not supported/i.test(text);
}

/** Separa los adjuntos en imagenes (van como data:) y documentos (van como texto). */
function splitMedia(files) {
  const list = Array.isArray(files) ? files : [];
  return {
    images: list.filter((file) => String(file.mime || '').indexOf('image/') === 0),
    documents: list.filter((file) => String(file.mime || '') === PDF_MIME),
  };
}

/**
 * Pide la respuesta al modelo. El texto de los PDF se inyecta en el aviso; si el
 * modelo rechaza la imagen (le falta el proyector visual, por ejemplo) se
 * reintenta solo con texto en vez de cortar el chat.
 */
async function askStrata(prompt, files, model, signal, onEvent) {
  const base = { client, model, temperature: config.temperature, maxTokens: config.maxTokens, signal };
  if (typeof onEvent === 'function') base.onEvent = onEvent;
  const media = splitMedia(files);
  const ready = withDocumentText(prompt, media.documents);

  try {
    const result = await strata.complete(Object.assign({}, base, { messages: decoratePrompt(ready, media.images) }));
    return { result, droppedImages: false, imageError: null };
  } catch (err) {
    if (!media.images.length || !looksLikeImageError(err)) throw err;
    const permanent = looksLikeVisionCapabilityError(err);
    const reason = String((err && err.message) || 'error desconocido');
    console.log('[imagen] el modelo ha rechazado la imagen (' + (permanent ? 'no admite vision' : 'fallo puntual') + '): ' + reason);
    if (typeof onEvent === 'function') {
      onEvent({
        type: 'notice',
        notice: permanent
          ? 'Tu modelo no acepta imagenes; reintento solo con el texto.'
          : 'No se ha podido procesar la imagen con este modelo; reintento solo con el texto.',
      });
      onEvent({ type: 'reset' });
    }
    if (permanent) state.vision = false;
    const result = await strata.complete(Object.assign({}, base, { messages: ready }));
    return { result, droppedImages: true, imageError: reason.slice(0, 300) };
  }
}

/** true/false si Strata declara vision en sus modelos, null si no lo dice. */
function deriveVision(models) {
  if (!Array.isArray(models) || !models.length) return null;
  const declared = models.some((model) => Array.isArray(model.modalities) || Boolean(model.projector));
  if (!declared) return null;
  return models.some(
    (model) => (Array.isArray(model.modalities) && model.modalities.includes('image')) || Boolean(model.projector)
  );
}

// --- Estado y modelos --------------------------------------------------------
app.get(
  '/api/status',
  asyncRoute(async (req, res) => {
    const probe = await strata.health(client, config.baseUrl, 4000);
    state.lastHealth = probe;
    if (probe.ok) {
      state.models = probe.models;
      if (!state.model) state.model = probe.defaultModel;
      state.vision = deriveVision(probe.models);
    }
    res.json({
      ok: true,
      server: {
        host: config.host,
        port: config.port,
        startedAt: state.startedAt,
        revision: API_REVISION,
        build: BUILD_STAMP,
        localOnly: strata.isLocalBaseUrl('http://' + config.host + '/'),
      },
      strata: {
        baseUrl: config.baseUrl,
        reachable: probe.ok,
        latencyMs: probe.latencyMs,
        error: probe.error,
        model: state.model,
        models: probe.ok ? probe.models : state.models,
        vision: state.vision,
      },
      db: db.stats(),
      limits: {
        maxHistory: config.maxHistory,
        maxInputChars: config.maxInputChars,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        maxImageBytes: config.maxImageBytes,
        maxImagesPerMessage: config.maxImagesPerMessage,
        imageTypes: ALLOWED_IMAGE_MIMES,
        maxPdfBytes: config.maxPdfBytes,
        maxPdfPerMessage: config.maxPdfPerMessage,
        maxPdfTextChars: config.maxPdfTextChars,
        pdfTypes: [PDF_MIME],
        bodyLimitBytes: JSON_BODY_LIMIT_BYTES,
      },
      warning: state.privacyWarning,
    });
  })
);

app.get(
  '/api/models',
  asyncRoute(async (req, res) => {
    const probe = await strata.health(client, config.baseUrl, 6000);
    state.lastHealth = probe;
    if (probe.ok) {
      state.models = probe.models;
      if (!state.model) state.model = probe.defaultModel;
      state.vision = deriveVision(probe.models);
    }
    res.json({ ok: probe.ok, baseUrl: config.baseUrl, error: probe.error, models: probe.models, current: state.model, vision: state.vision });
  })
);

// --- Chats e historial -------------------------------------------------------
app.get('/api/chats', (req, res) => {
  res.json({ ok: true, chats: db.listChats() });
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json({ ok: true, query: q, chats: db.searchChats(q) });
});

app.post('/api/chats', (req, res) => {
  const chat = db.createChat(req.body && req.body.title, pickModel(req.body && req.body.model));
  res.status(201).json({ ok: true, chat });
});

app.get('/api/chats/:id', (req, res) => {
  const chat = db.getChat(req.params.id);
  if (!chat) return res.status(404).json({ ok: false, error: 'Ese chat no existe en la base de datos local.' });
  res.json({ ok: true, chat, messages: db.getMessages(chat.id) });
});

app.patch('/api/chats/:id', (req, res) => {
  const chat = db.renameChat(req.params.id, req.body && req.body.title);
  if (!chat) return res.status(400).json({ ok: false, error: 'El titulo no puede quedar vacio.' });
  res.json({ ok: true, chat });
});

app.delete('/api/chats/:id', (req, res) => {
  const removed = db.deleteChat(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Ese chat no existe.' });
  res.json({ ok: true, deleted: String(req.params.id) });
});

// Un adjunto guardado (foto o PDF), servido desde el disco local (nunca desde fuera).
app.get('/api/attachments/:id', (req, res) => {
  const file = db.getAttachment(req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: 'Ese archivo ya no existe.' });
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.setHeader('Content-Disposition', 'inline; filename="' + safeFilename(file.name) + '"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', file.bytes);
  res.type(file.mime);
  res.end(file.blob);
});

// --- Generar respuesta con Strata --------------------------------------------
// Con stream: true responde Server-Sent Events (texto en directo).
// Con stream: false responde JSON normal.
app.post(
  '/api/chat',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const content = typeof body.content === 'string' ? body.content.trim() : '';

    const incoming = readIncomingImages(body);
    if (incoming.error) return res.status(400).json({ ok: false, error: incoming.error });
    const incomingDocs = readIncomingDocuments(body);
    if (incomingDocs.error) return res.status(400).json({ ok: false, error: incomingDocs.error });
    const files = incoming.files.concat(incomingDocs.files);

    if (!content && !files.length) return res.status(400).json({ ok: false, error: 'El mensaje esta vacio.' });
    if (content.length > config.maxInputChars) {
      return res.status(413).json({ ok: false, error: 'Mensaje demasiado largo (maximo ' + config.maxInputChars + ' caracteres).' });
    }

    let chat = body.chatId ? db.getChat(String(body.chatId)) : null;
    if (body.chatId && !chat) return res.status(404).json({ ok: false, error: 'El chat indicado ya no existe.' });
    if (!chat) {
      const firstIsPdf = String((files[0] || {}).mime || '') === PDF_MIME;
      chat = db.createChat(content ? 'Nuevo chat' : (firstIsPdf ? 'Documento: ' : 'Imagen: ') + files[0].name, pickModel(body.model));
    }

    const model = pickModel(body.model);
    if (!model) {
      return res.status(503).json({ ok: false, error: 'No hay modelo disponible: levanta Strata o define STRATA_MODEL en .env.' });
    }

    const wantStream = body.stream !== false;
    const controller = new AbortController();
    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
      controller.abort();
    });

    const userMessage = db.addMessage(chat.id, 'user', content, undefined, files);

    // Modo sin streaming: una unica respuesta JSON.
    if (!wantStream) {
      try {
        const history = db.getMessages(chat.id);
        const { result, droppedImages, imageError } = await askStrata(buildPrompt(history), files, model, controller.signal, null);
        const text = result.content && result.content.trim() ? result.content : '(Strata no devolvio texto)';
        const assistant = db.addMessage(chat.id, 'assistant', text, result.usage || undefined);
        db.setChatModel(chat.id, result.model || model);
        state.model = result.model || state.model;
        return res.json({
          ok: true,
          chat: db.getChat(chat.id),
          userMessage,
          message: assistant,
          notices: incomingDocs.notices,
          meta: { model: result.model, elapsedMs: result.elapsedMs, attempt: result.attempt, usage: result.usage, finishReason: result.finishReason, droppedImages, imageError },
        });
      } catch (err) {
        return res.status(Number.isFinite(err.status) && err.status < 600 ? err.status : 502).json({ ok: false, error: err.message });
      }
    }

    // Modo streaming.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let streamed = '';
    const send = (event) => {
      if (event && event.type === 'delta') streamed += event.content || '';
      if (event && event.type === 'reset') streamed = '';
      if (!res.writableEnded) res.write('data: ' + JSON.stringify(event) + '\n\n');
    };

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    // En el 'start' ya van los id guardados y lo que se ha sacado de cada PDF.
    const stored = files.map((file) => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      bytes: file.bytes,
      text_chars: file.text ? file.text.length : 0,
    }));
    send({ type: 'start', chatId: chat.id, chat: db.getChat(chat.id), userMessage: Object.assign({}, userMessage, { attachments: stored }), model });
    // Lo que se ha sacado (o no) de cada PDF, antes de que el modelo empiece a hablar.
    incomingDocs.notices.forEach((notice) => send({ type: 'notice', notice }));

    try {
      const history = db.getMessages(chat.id);
      const { result, droppedImages, imageError } = await askStrata(buildPrompt(history), files, model, controller.signal, send);

      const text = result.content && result.content.trim() ? result.content : '(Strata no devolvio texto)';
      const assistant = db.addMessage(chat.id, 'assistant', text, result.usage || undefined);
      db.setChatModel(chat.id, result.model || model);
      state.model = result.model || state.model;

      send({
        type: 'done',
        message: assistant,
        chat: db.getChat(chat.id),
        meta: { model: result.model, elapsedMs: result.elapsedMs, attempt: result.attempt, usage: result.usage, finishReason: result.finishReason, droppedImages, imageError },
      });
    } catch (err) {
      // Si se cortó a medias, se guarda lo que si llegue a salir del modelo.
      if (streamed.trim()) {
        db.addMessage(chat.id, 'assistant', streamed, undefined);
      }
      send({ type: 'error', error: err.message || 'Fallo contra Strata.', aborted: clientGone });
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
    }
  })
);

// --- Rutas desconocidas y errores --------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta inexistente: ' + req.method + ' ' + req.originalUrl });
});

/** Los rechazos del parser de Express vienen en ingles: aqui se traducen. */
function friendlyRequestError(err) {
  if (!err) return null;
  const type = String(err.type || '');
  const reported = Number(err.status || err.statusCode || 0);
  if (type === 'entity.too.large' || reported === 413) {
    return {
      status: 413,
      message:
        'El paquete con los adjuntos pesa demasiado para este servidor local (maximo ' +
        formatSize(JSON_BODY_LIMIT_BYTES) + '). Prueba con un archivo mas pequeno o con menos adjuntos.',
    };
  }
  if (type === 'encoding.unsupported') {
    return { status: 415, message: 'El navegador ha enviado el mensaje con una codificacion que este servidor no entiende.' };
  }
  if (type === 'entity.parse.failed') {
    return { status: 400, message: 'El servidor no ha entendido el mensaje: el texto recibido llega incompleto o roto.' };
  }
  return null;
}

app.use((err, req, res, next) => {
  const friendly = friendlyRequestError(err);
  if (friendly) console.log('[tamano] ' + String(req && req.method) + ' ' + String(req && req.path) + ' -> ' + friendly.message);
  const expected =
    Boolean(friendly) || Boolean(err && (Number.isFinite(err.status) && err.status < 500 || /Origen no permitido/.test(String(err && err.message))));
  const status = friendly ? friendly.status : expected ? err.status || 400 : 500;
  const message = friendly ? friendly.message : expected ? String(err.message) : 'Error interno del servidor local.';
  if (!expected) console.error('[ERROR]', err && err.stack ? err.stack : err);

  if (res.headersSent) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'error', error: message }) + '\n\n');
      res.end();
    } catch (_) {
      /* conexion ya cortada */
    }
    return;
  }
  res.status(status).json({ ok: false, error: message });
});

// --- Arranque ----------------------------------------------------------------
let httpServer = null;

async function start() {
  const probe = await strata.health(client, config.baseUrl, 5000);
  state.lastHealth = probe;
  if (probe.ok) {
    state.models = probe.models;
    if (!state.model) state.model = probe.defaultModel;
    state.vision = deriveVision(probe.models);
  }

  httpServer = app.listen(config.port, config.host, () => {
    const dbInfo = db.stats();
    console.log('============================================================');
    console.log('  Strata Local Chat  (solo accesible desde este PC)');
    console.log('  Abre en el navegador : http://' + config.host + ':' + config.port);
    console.log('  IA local (Strata)    : ' + config.baseUrl);
    console.log('  Historial SQLite     : ' + dbInfo.path);
    console.log('  Chats / mensajes     : ' + dbInfo.chats + ' / ' + dbInfo.messages);
    console.log('  Modelos detectados   : ' + (probe.ok ? state.models.map((m) => m.id).join(', ') : '(Strata no responde)'));
    console.log('  Modelo en uso        : ' + (state.model || '(ninguno)'));
    console.log('  Vision (imagenes)    : ' + (state.vision === null ? 'sin declarar (se probara al enviar)' : state.vision ? 'compatible' : 'el modelo no acepta imagenes'));
    console.log('  Adjuntos por mensaje : ' + config.maxImagesPerMessage + ' x ' + Math.round(config.maxImageBytes / 1024 / 1024) + ' MB (PNG/JPG/WEBP/GIF)');
    console.log('  PDF por mensaje      : ' + config.maxPdfPerMessage + ' x ' + Math.round(config.maxPdfBytes / 1024 / 1024) + ' MB (texto leido en local, hasta ' + config.maxPdfTextChars + ' caracteres cada uno)');
    console.log('  Tamano max. paquete  : ' + formatSize(JSON_BODY_LIMIT_BYTES) + ' (adjuntos en base64 + texto)');
    console.log('  Revolucion de la API : ' + API_REVISION);
  console.log('  Sello de esta version: ' + BUILD_STAMP + ' (solo para diagnostico: los enlaces salen limpios)');
    if (!probe.ok) console.log('  AVISO              : ' + probe.error);
    if (state.privacyWarning) console.log('  AVISO              : ' + state.privacyWarning);
    console.log('============================================================');
  });

  httpServer.on('clientError', (err, socket) => {
    if (socket && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  // Puerto ocupado: el caso tipico es un servidor de una tanda anterior que
  // sigue ahi. Antes esto reventaba con una traza ininteligible y la pestana
  // que el lanzador habia abierto se quedaba mirando al proceso viejo.
  httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error('[ARRANQUE] el puerto ' + config.port + ' ya lo esta usando otro proceso.');
      console.error('[ARRANQUE] suele ser un servidor de una tanda anterior. Para salir de ese');
      console.error('[ARRANQUE] callejon sin salida:  npm run stop   y despues   npm run start:open');
      console.error('[ARRANQUE] (doble clic a start-strata-chat.cmd hace justamente eso: recicla)');
    } else {
      console.error('[ARRANQUE] no se pudo escuchar: ' + (err && err.message ? err.message : err));
    }
    db.close();
    process.exit(1);
  });

  return httpServer;
}

function shutdown(signal) {
  console.log('\n[' + signal + '] cerrando el servidor local...');
  if (httpServer) {
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  } else {
    db.close();
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start().catch((err) => {
    console.error('[ARRANQUE] no se pudo levantar el servidor:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  app,
  config,
  state,
  API_REVISION,
  BUILD_STAMP,
  formatSize,
  start,
  buildPrompt,
  pickModel,
  readIncomingImages,
  readIncomingDocuments,
  withDocumentText,
  splitMedia,
  withImageParts,
  decoratePrompt,
  deriveVision,
  looksLikeImageError,
  looksLikeVisionCapabilityError,
  safeFilename,
  ALLOWED_IMAGE_MIMES,
  PDF_MIME,
};
