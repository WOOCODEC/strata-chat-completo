'use strict';

/**
 * tools/status-check.js - Comprueba contra el servidor REAL (puerto del .env)
 * que la interfaz se sirve, que las cabeceras de privacidad estan activas y
 * que Strata se ve desde el servidor. No escribe nada en el historial.
 *
 * Uso: node tools/status-check.js
 */

const TARGET = process.env.CHECK_BASE || 'http://127.0.0.1:3000';

async function main() {
  let page;
  try {
    page = await fetch(TARGET + '/');
  } catch (err) {
    console.log('FALLO: el servidor no responde en ' + TARGET + ' (' + err.message + ')');
    process.exitCode = 1;
    return;
  }

  const html = await page.text();
  const csp = page.headers.get('content-security-policy') || '';
  const external = html.match(/(?:src|href)=["'](https?:\/\/[^"']+)/gi) || [];

  console.log('GET ' + TARGET + '/            -> HTTP ' + page.status);
  console.log('  tamano HTML          : ' + html.length + ' bytes');
  console.log('  recursos externos    : ' + (external.length ? external.join(', ') : 'ninguno'));
  console.log('  CSP default-src      : ' + (csp.match(/default-src[^;]+/) || ['(ausente)'])[0]);
  console.log('  CSP connect-src      : ' + (csp.match(/connect-src[^;]+/) || ['(ausente)'])[0]);

  for (const asset of ['/style.css', '/script.js']) {
    const res = await fetch(TARGET + asset);
    console.log('GET ' + asset.padEnd(22) + '-> HTTP ' + res.status + ' (' + res.headers.get('content-type') + ')');
  }

  const statusResponse = await fetch(TARGET + '/api/status');
  const status = await statusResponse.json();
  console.log('GET /api/status        -> HTTP ' + statusResponse.status);
  console.log('  Strata alcanza       : ' + status.strata.reachable + ' (' + status.strata.latencyMs + ' ms)');
  console.log('  URL base             : ' + status.strata.baseUrl);
  console.log('  Modelo en uso        : ' + status.strata.model);
  console.log('  Modelos detectados   : ' + status.strata.models.map((m) => m.id + (m.n_ctx ? ' [n_ctx ' + m.n_ctx + ']' : '')).join(', '));
  console.log('  Escucha              : ' + status.server.host + ':' + status.server.port + ' (solo local: ' + status.server.localOnly + ')');
  console.log('  Historial            : ' + status.db.chats + ' chats / ' + status.db.messages + ' mensajes en ' + status.db.path);
  if (status.strata.error) console.log('  error Strata         : ' + status.strata.error);

  const chats = await fetch(TARGET + '/api/chats').then((r) => r.json());
  console.log('GET /api/chats         -> HTTP 200, ' + chats.chats.length + ' chats guardados');

  const ok = page.status === 200 && external.length === 0 && csp.includes("default-src 'none'") && status.strata.reachable;
  console.log(ok ? '\nRESULTADO: correcto, sin errores y sin llamadas externas.' : '\nRESULTADO: revisa los puntos de arriba.');
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.log('FALLO: ' + err.message);
  process.exitCode = 1;
});
