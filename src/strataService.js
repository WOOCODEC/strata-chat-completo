'use strict';

/**
 * strataService.js - Cliente de tu IA local (Strata, API compatible con OpenAI).
 *
 * Unica via de salida hacia Strata. La URL base se valida: si no es loopback y
 * ALLOW_REMOTE_STRATA no esta activado, el servidor se niega a arrancar antes
 * de poder enviar tus mensajes a otro sitio.
 *
 * API publica:
 *   isLocalBaseUrl(url)
 *   assertPrivateBaseUrl(url, allowRemote)
 *   createClient({ baseUrl, apiKey, timeoutMs })
 *   listModels(client, timeoutMs?)
 *   health(client, baseUrl, timeoutMs?)
 *   complete({ client, model, messages, ..., onEvent })
 *   describeError(err)
 *
 * onEvent recibe: { type: 'delta', content } | { type: 'reset' } | { type: 'usage', usage }
 */

const OpenAI = require('openai');

const CHAT_ROLES = ['system', 'user', 'assistant'];

// Unicas imagenes admitidas: las que ya estan dentro del propio mensaje
// (data: URI), nunca enlaces a otro sitio.
const INLINE_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

function isLocalBaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (_) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = String(url.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function assertPrivateBaseUrl(baseUrl, allowRemote) {
  if (isLocalBaseUrl(baseUrl)) return { local: true, warning: null };
  if (allowRemote === true) {
    return {
      local: false,
      warning: 'ALLOW_REMOTE_STRATA=true: la base URL no es local, revisa que sea lo que quieres.',
    };
  }
  throw new Error(
    'STRATA_BASE_URL apunta a "' + baseUrl + '", que no es una direccion local (127.0.0.1 / localhost). ' +
      'Esta app esta pensada para no sacar datos del ordenador: corrige la URL en .env ' +
      'o, si de verdad quieres una API remota, pon ALLOW_REMOTE_STRATA=true.'
  );
}

function createClient(config) {
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 180000;
  return new OpenAI({
    apiKey: config.apiKey || 'strata-local',
    baseURL: config.baseUrl,
    timeout: timeoutMs,
    maxRetries: 0,
  });
}

/** Partes de un mensaje multimodal: solo texto e imagenes en linea (data:). */
function normalizeContentParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => {
      if (!part || typeof part !== 'object') return null;
      if (part.type === 'text') return { type: 'text', text: String(part.text || '') };
      if (part.type === 'image_url') {
        const url = part.image_url && typeof part.image_url.url === 'string' ? part.image_url.url : '';
        if (!INLINE_IMAGE.test(url)) return null;
        return { type: 'image_url', image_url: { url } };
      }
      return null;
    })
    .filter((part) => part && (part.type === 'text' ? part.text.length > 0 : true));
}

function hasContent(message) {
  if (typeof message.content === 'string') return message.content.length > 0;
  if (Array.isArray(message.content)) return message.content.length > 0;
  return false;
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m === 'object' && hasContent(m))
    .map((m) => ({
      role: CHAT_ROLES.includes(m.role) ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content : normalizeContentParts(m.content),
    }))
    .filter((m) => (typeof m.content === 'string' ? m.content.length > 0 : m.content.length > 0));
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const completion = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const total = Number.isFinite(usage.total_tokens) ? usage.total_tokens : prompt !== null && completion !== null ? prompt + completion : null;
  if (prompt === null && completion === null && total === null) return null;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function truncate(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const limit = max || 220;
  return clean.length > limit ? clean.slice(0, limit) + '...' : clean;
}

function describeError(err) {
  if (!err) return 'Error desconocido contra Strata.';
  const name = String(err.name || '');
  const message = String(err.message || '');
  if (name === 'AbortError' || /aborted/i.test(message)) return 'La peticion se cancelo.';
  if (name === 'APIConnectionTimeoutError' || /timeout|timed out/i.test(message)) {
    return 'Strata ha tardado demasiado en responder (sube REQUEST_TIMEOUT_MS en .env si tu modelo es lento).';
  }
  if (name === 'APIConnectionError' || err.code === 'ECONNREFUSED' || /connect|ECONNRESET|fetch failed/i.test(message)) {
    return 'No hay conexion con Strata. Comprueba que este levantado y que la URL de .env es correcta.';
  }
  if (err.status === 404) {
    return 'Strata contesto 404: la URL base no parece una API compatible con OpenAI (revisa STRATA_BASE_URL).';
  }
  if (err.status === 400 || err.status === 422) {
    return 'Strata rechazo la peticion (HTTP ' + err.status + '): ' + truncate(message);
  }
  if (err.status) return 'Strata devolvio HTTP ' + err.status + ': ' + truncate(message);
  return truncate(message);
}

async function listModels(client, timeoutMs) {
  const res = await client.models.list({ timeout: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 5000 });
  const data = res && Array.isArray(res.data) ? res.data : [];
  return data
    .filter((m) => m && m.id)
    .map((m) => {
      const info = { id: String(m.id), object: m.object || 'model' };
      if (m.meta && Number.isFinite(m.meta.n_ctx)) info.n_ctx = m.meta.n_ctx;
      if (m.meta && typeof m.meta === 'object') {
        const modalities = m.meta.modalities || m.meta.supported_modalities || m.meta.input_modalities;
        if (Array.isArray(modalities)) info.modalities = modalities.map((value) => String(value).toLowerCase());
        const projector = m.meta.projector_file || m.meta.projector_filename || m.meta.projector;
        if (projector) info.projector = String(projector);
      }
      if (m.status && typeof m.status === 'object' && m.status.value) info.status = m.status.value;
      return info;
    });
}

async function health(client, baseUrl, timeoutMs) {
  const started = Date.now();
  try {
    const models = await listModels(client, timeoutMs);
    return {
      ok: true,
      baseUrl,
      latencyMs: Date.now() - started,
      count: models.length,
      models,
      defaultModel: models.length ? models[0].id : null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      latencyMs: Date.now() - started,
      count: 0,
      models: [],
      defaultModel: null,
      error: describeError(err),
    };
  }
}

async function streamComplete(client, params, signal) {
  const stream = await client.chat.completions.create({ ...params, stream: true }, { signal });
  let content = '';
  let usage = null;
  let finishReason = null;
  let modelUsed = params.model;

  for await (const chunk of stream) {
    if (chunk.usage) usage = normalizeUsage(chunk.usage);
    if (chunk.model) modelUsed = chunk.model;
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta && typeof choice.delta.content === 'string' ? choice.delta.content : '';
    if (delta) content += delta;
  }

  return { content, usage, finishReason, model: modelUsed, streamed: true };
}

async function plainComplete(client, params, signal) {
  const res = await client.chat.completions.create({ ...params, stream: false }, { signal });
  const choice = res && Array.isArray(res.choices) ? res.choices[0] : null;
  const content = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  return {
    content,
    usage: normalizeUsage(res && res.usage),
    finishReason: choice ? choice.finish_reason || null : null,
    model: (res && res.model) || params.model,
    streamed: false,
  };
}

/**
 * Pide una respuesta al modelo.
 *
 * Estrategia en 3 intentos, porque los servidores locales OpenAI-compatible no
 * se comportan todos igual:
 *   1) streaming con stream_options.include_usage (da contador de tokens)
 *   2) streaming normal
 *   3) peticion normal sin streaming
 * Si un intento ya emitio texto, se avisa con { type: 'reset' } para que la
 * interfaz limpie la burbuja antes de volver a pintar.
 */
async function complete(options) {
  const {
    client,
    model,
    messages,
    temperature,
    maxTokens,
    preferUsage = true,
    signal,
    onEvent,
  } = options || {};

  if (!client) throw new Error('strataService.complete necesita un cliente.');
  if (!model) throw new Error('No hay modelo configurado (STRATA_MODEL o el primero de /v1/models).');

  const params = { model, messages: normalizeMessages(messages) };
  if (!params.messages.length) throw new Error('No hay mensajes que enviar al modelo.');
  if (Number.isFinite(Number(temperature))) params.temperature = Number(temperature);
  if (Number.isFinite(Number(maxTokens))) params.max_tokens = Number(maxTokens);

  let emitted = false;
  const emit = (event) => {
    if (event && event.type === 'delta' && event.content) emitted = true;
    if (typeof onEvent === 'function') onEvent(event);
  };

  const attempts = [];
  if (preferUsage) attempts.push({ label: 'stream+usage', run: () => streamComplete(client, { ...params, stream_options: { include_usage: true } }, signal) });
  attempts.push({ label: 'stream', run: () => streamComplete(client, params, signal) });
  attempts.push({ label: 'plain', run: () => plainComplete(client, params, signal) });

  const startedAt = Date.now();
  let lastError = null;

  for (let i = 0; i < attempts.length; i += 1) {
    if (signal && signal.aborted) {
      const abortError = new Error('La peticion se cancelo.');
      abortError.name = 'AbortError';
      throw abortError;
    }
    if (emitted) emit({ type: 'reset' });
    try {
      const result = await attempts[i].run();
      if (result.usage) emit({ type: 'usage', usage: result.usage });
      return { ...result, attempt: attempts[i].label, attemptsUsed: i + 1, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (String(err && err.name) === 'AbortError') throw err;
      lastError = err;
      // Un error de ya-intentado streaming con usage se reintenta sin usage;
      // cualquier otro tambien se deja caer al siguiente intento.
    }
  }

  const friendly = new Error(describeError(lastError));
  friendly.status = lastError && Number.isFinite(lastError.status) ? lastError.status : 502;
  friendly.cause = lastError;
  throw friendly;
}

module.exports = {
  CHAT_ROLES,
  INLINE_IMAGE,
  isLocalBaseUrl,
  assertPrivateBaseUrl,
  createClient,
  normalizeMessages,
  normalizeContentParts,
  normalizeUsage,
  describeError,
  listModels,
  health,
  complete,
};
