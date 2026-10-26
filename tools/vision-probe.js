'use strict';

/** Sonda rapida: que hace Strata cuando le mandamos imagenes de verdad. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3998);
const BASE = 'http://127.0.0.1:' + PORT;
const PROBE_DB = path.join(ROOT, 'database', 'probe.db');

/** Quita la base de datos temporal de la sonda (con sus ficheros WAL). */
function cleanProbeDb() {
  ['', '-wal', '-shm'].forEach((suffix) => {
    if (fs.existsSync(PROBE_DB + suffix)) fs.unlinkSync(PROBE_DB + suffix);
  });
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAwMDAwMAAAA4FA1jJhRYAAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function waitServer(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(BASE + '/api/chats');
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function ask(body) {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ stream: true }, body)),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const seen = [];
  let notice = '';
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
        let ev = null;
        try { ev = JSON.parse(line.slice(5)); } catch (_) { return; }
        seen.push(ev.type);
        if (ev.type === 'notice') notice = ev.notice;
        if (ev.type === 'done' && ev.meta && ev.meta.imageError) notice += ' || ' + ev.meta.imageError;
      });
      sep = buffer.indexOf('\n\n');
    }
  }
  return { types: seen.join(','), notice };
}

(async () => {
  cleanProbeDb();
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: './database/probe.db' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (c) => { log += c.toString(); });
  server.stderr.on('data', (c) => { log += c.toString(); });

  try {
    if (!(await waitServer(20000))) throw new Error('no arranco');
    console.log('PNG pequeno :', JSON.stringify(await ask({ content: 'que hay en esta imagen?' , images: [{ name: 'a.png', mime: 'image/png', data: PNG }] })));
    console.log('GIF 1x1     :', JSON.stringify(await ask({ content: 'y esta?', images: [{ name: 'b.gif', mime: 'image/gif', data: GIF }] })));
    console.log('PNG distinto:', JSON.stringify(await ask({ content: 'y esta otra?', images: [{ name: 'c.png', mime: 'image/png', data: PNG2 }] })));
    console.log('PNG repetido A:', JSON.stringify(await ask({ content: 'primera vez de este', images: [{ name: 'd.png', mime: 'image/png', data: PNG }] })));
    const pad = (n) => PNG + 'QUlLIG5vaXNlAAAAAAAAAAAAAAAAAAAA'.repeat(n) + 'AAAAAAAA';
    console.log('PNG con relleno:', JSON.stringify(await ask({ content: 'y esta con relleno?', images: [{ name: 'e.png', mime: 'image/png', data: pad(3) }] })));
  } catch (err) {
    console.log('sonda falló:', err.message);
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    cleanProbeDb();
    console.log('--- log ---');
    console.log(log.split('\n').filter((l) => l.includes('[imagen]') || l.includes('Vision')).join('\n'));
    process.exitCode = 0;
  }
})();
