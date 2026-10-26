'use strict';

/**
 * dbService.js - Persistencia local del historial en SQLite (better-sqlite3).
 *
 * Todo vive en un archivo .db dentro de la carpeta del proyecto, asi que el
 * historial es tuyo y no sale del ordenador.
 *
 * API publica:
 *   init(dbPath?)            abre/crea la BD y aplica el esquema
 *   getDb()                  instancia better-sqlite3 (para diagnosticos)
 *   listChats()              chats por actividad + contador + ultimo mensaje
 *   createChat(title?, model?)
 *   getChat(id)
 *   renameChat(id, title)
 *   setChatModel(id, model)
 *   deleteChat(id)           borra el chat y, en cascada, sus mensajes
 *   getMessages(chatId)      mensajes en orden cronologico + sus adjuntos
 *   getAttachment(id)        un adjunto con el binario, para servirlo
 *   addMessage(chatId, role, content, usage?, attachments?)  inserta + toca updated_at
 *   searchChats(query)       busqueda por titulo y contenido
 *   stats() / close()
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'database', 'chat.db');
const ALLOWED_ROLES = ['system', 'user', 'assistant'];
const MESSAGE_COLUMNS =
  'id, chat_id, role, content, prompt_tokens, completion_tokens, created_at';

let db = null;
let activePath = null;
let prepared = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  model      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content           TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  blob       BLOB NOT NULL,
  text       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
`;

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/** Titulo derivado del primer mensaje del usuario. */
function titleFromText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Nuevo chat';
  return clean.length > 48 ? clean.slice(0, 48) + '...' : clean;
}

/**
 * Ajustes de una base ya creada. Los CREATE TABLE IF NOT EXISTS no meten
 * columnas nuevas en tablas que ya existen, asi que aqui se anaden a mano.
 */
function migrate() {
  const columns = db.prepare('PRAGMA table_info(attachments)').all().map((column) => column.name);
  if (!columns.includes('text')) db.exec('ALTER TABLE attachments ADD COLUMN text TEXT');
}

function init(dbPath) {
  const resolved = dbPath && String(dbPath).trim() ? path.resolve(String(dbPath)) : DEFAULT_DB_PATH;

  if (resolved !== ':memory:') {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate();

  prepared = {
    listChats: db.prepare(`
      SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
             (SELECT m.content FROM messages m WHERE m.chat_id = c.id
               ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM chats c
      ORDER BY c.updated_at DESC, c.id DESC
    `),
    getChat: db.prepare('SELECT id, title, model, created_at, updated_at FROM chats WHERE id = ?'),
    getMessage: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`),
    insertChat: db.prepare(
      'INSERT INTO chats (id, title, model, created_at, updated_at) VALUES (@id, @title, @model, @created, @updated)'
    ),
    renameChat: db.prepare('UPDATE chats SET title = @title, updated_at = @updated WHERE id = @id'),
    setChatModel: db.prepare('UPDATE chats SET model = @model, updated_at = @updated WHERE id = @id'),
    deleteChat: db.prepare('DELETE FROM chats WHERE id = ?'),
    listMessages: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? ORDER BY id ASC`),
    insertMessage: db.prepare(`
      INSERT INTO messages (chat_id, role, content, prompt_tokens, completion_tokens, created_at)
      VALUES (@chat_id, @role, @content, @prompt_tokens, @completion_tokens, @created_at)
    `),
    insertAttachment: db.prepare(`
      INSERT INTO attachments (id, chat_id, message_id, name, mime, bytes, blob, text, created_at)
      VALUES (@id, @chat_id, @message_id, @name, @mime, @bytes, @blob, @text, @created_at)
    `),
    listAttachments: db.prepare(
      'SELECT id, message_id, name, mime, bytes, created_at, ' +
        "CASE WHEN text IS NULL OR text = '' THEN 0 ELSE length(text) END AS text_chars " +
        'FROM attachments WHERE chat_id = ? ORDER BY message_id ASC, id ASC'
    ),
    getAttachment: db.prepare('SELECT id, chat_id, message_id, name, mime, bytes, blob FROM attachments WHERE id = ?'),
    touchChat: db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),
    touchChatTitle: db.prepare('UPDATE chats SET updated_at = ?, title = ? WHERE id = ?'),
    countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?'),
    searchChats: db.prepare(`
      SELECT DISTINCT c.id, c.title, c.model, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
      FROM chats c
      LEFT JOIN messages m ON m.chat_id = c.id
      WHERE c.title LIKE @like ESCAPE '\\' OR m.content LIKE @like ESCAPE '\\'
      ORDER BY c.updated_at DESC
    `),
    countChats: db.prepare('SELECT COUNT(*) AS n FROM chats'),
    countMessagesAll: db.prepare('SELECT COUNT(*) AS n FROM messages'),
    countAttachments: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM attachments'),
  };

  activePath = resolved;
  return db;
}

function ensure() {
  if (!db) init();
  return db;
}

function getDb() {
  return ensure();
}

function listChats() {
  ensure();
  return prepared.listChats.all();
}

function createChat(title, model) {
  ensure();
  const record = {
    id: newId(),
    title: title && String(title).trim() ? String(title).trim().slice(0, 120) : 'Nuevo chat',
    model: model || null,
    created: nowIso(),
    updated: nowIso(),
  };
  prepared.insertChat.run(record);
  return getChat(record.id);
}

function getChat(id) {
  ensure();
  return prepared.getChat.get(String(id)) || null;
}

function renameChat(id, title) {
  ensure();
  const clean = String(title || '').trim();
  if (!clean) return null;
  const info = prepared.renameChat.run({ id: String(id), title: clean.slice(0, 120), updated: nowIso() });
  return info.changes > 0 ? getChat(id) : null;
}

function setChatModel(id, model) {
  ensure();
  prepared.setChatModel.run({ id: String(id), model: model || null, updated: nowIso() });
}

function deleteChat(id) {
  ensure();
  return prepared.deleteChat.run(String(id)).changes > 0;
}

/** Mensajes de un chat, cada uno con sus adjuntos (sin el binario). */
function getMessages(chatId) {
  ensure();
  const messages = prepared.listMessages.all(String(chatId));
  const grouped = new Map();
  prepared.listAttachments.all(String(chatId)).forEach((row) => {
    if (!grouped.has(row.message_id)) grouped.set(row.message_id, []);
    grouped.get(row.message_id).push({
      id: row.id,
      name: row.name,
      mime: row.mime,
      bytes: row.bytes,
      text_chars: row.text_chars || 0,
      created_at: row.created_at,
    });
  });
  return messages.map((message) => Object.assign({}, message, { attachments: grouped.get(message.id) || [] }));
}

/** Un adjunto con su binario, para servirlo al navegador. */
function getAttachment(id) {
  ensure();
  return prepared.getAttachment.get(String(id)) || null;
}

/**
 * Inserta un mensaje dentro de una transaccion. Si es el primer mensaje del
 * usuario y el chat aun tiene el titulo generico, se titula con ese mensaje.
 * `attachments` es opcional: [{ id, name, mime, bytes, blob(Buffer) }].
 */
function addMessage(chatId, role, content, usage, attachments) {
  ensure();
  const cleanRole = ALLOWED_ROLES.includes(role) ? role : 'user';
  const text = content === null || content === undefined ? '' : String(content);
  const promptTokens = usage && Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const completionTokens = usage && Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const extras = Array.isArray(attachments) ? attachments : [];

  const run = db.transaction(() => {
    const info = prepared.insertMessage.run({
      chat_id: String(chatId),
      role: cleanRole,
      content: text,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      created_at: nowIso(),
    });
    const messageId = Number(info.lastInsertRowid);

    extras.forEach((file) => {
      const blob = Buffer.isBuffer(file.blob) ? file.blob : Buffer.alloc(0);
      prepared.insertAttachment.run({
        id: file.id || newId(),
        chat_id: String(chatId),
        message_id: messageId,
        name: String(file.name || 'archivo').slice(0, 120),
        mime: String(file.mime || 'application/octet-stream').slice(0, 100),
        bytes: Number.isFinite(file.bytes) ? file.bytes : blob.length,
        blob,
        text: file.text === null || file.text === undefined || file.text === '' ? null : String(file.text),
        created_at: nowIso(),
      });
    });

    const stamp = nowIso();
    if (cleanRole === 'user') {
      const chat = prepared.getChat.get(String(chatId));
      const total = prepared.countMessages.get(String(chatId)).n;
      if (chat && chat.title === 'Nuevo chat' && total === 1) {
        prepared.touchChatTitle.run(stamp, titleFromText(text), String(chatId));
      } else {
        prepared.touchChat.run(stamp, String(chatId));
      }
    } else {
      prepared.touchChat.run(stamp, String(chatId));
    }

    return prepared.getMessage.get(Number(info.lastInsertRowid));
  });

  return run();
}

function searchChats(query) {
  ensure();
  const q = String(query || '').trim();
  if (!q) return [];
  const like = '%' + q.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  return prepared.searchChats.all({ like });
}

function stats() {
  ensure();
  let bytes = 0;
  try {
    bytes = fs.statSync(activePath).size;
  } catch (_) {
    bytes = 0;
  }
  return {
    path: activePath,
    chats: prepared.countChats.get().n,
    messages: prepared.countMessagesAll.get().n,
    attachments: prepared.countAttachments.get().n,
    attachmentBytes: prepared.countAttachments.get().bytes,
    bytes,
  };
}

function close() {
  if (db) {
    db.close();
    db = null;
    prepared = null;
  }
}

module.exports = {
  DEFAULT_DB_PATH,
  titleFromText,
  init,
  getDb,
  listChats,
  createChat,
  getChat,
  renameChat,
  setChatModel,
  deleteChat,
  getMessages,
  getAttachment,
  addMessage,
  searchChats,
  stats,
  close,
};
