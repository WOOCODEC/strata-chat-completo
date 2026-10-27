/*
  tools/clean.js - Limpieza local del workspace: borra lo que vuelve a crearse
  solo y no es codigo fuente (logs de arrancadas anteriores y sobras del arnes de
  pruebas). No hay compilacion ni empaquetado en este proyecto, asi que lo unico
  que se acumula aqui son estos ficheros.

  Jamas toca: database\chat.db y sus -shm / -wal (tu historial), server.pid y los
  logs del servidor en marcha, .env, node_modules ni nada del codigo.

  Uso:
    npm run clean              borra
    npm run clean -- --dry     solo ensena lo que borraria
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.slice(2).indexOf('--dry') !== -1;

// Unicamente nombres que se vuelven a generar solos.
const BORRABLES = [
  // logs de la arrancada anterior que guarda tools\server.ps1 al relanzar
  /^server\.log\.old$/,
  /^server-error\.log\.old$/,
  // base de datos temporal del arnes, por si una tanda se quedo a medias
  /^smoke-test\.db(-shm|-wal)?$/,
  // sobras de las sondas manuales
  /^sonda-[A-Za-z0-9._-]+\.(db|db-shm|db-wal|log|txt)$/,
  /^__sonda[A-Za-z0-9._-]*$/,
  /\.tmp$/,
  /\.bak$/,
  /\.orig$/,
];

// Lo que bajo ningun concepto se borra, aunque coincida con algo de arriba.
const INTOCABLES = [/^chat\.db(-shm|-wal)?$/, /^server\.pid$/, /^server\.log$/, /^server-error\.log$/];

const DIRS = ['database', 'src/public', 'src', 'tools', '.'];

let encontrados = 0;
let liberados = 0;

DIRS.forEach((relative) => {
  const dir = path.join(ROOT, relative);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return; // la carpeta no existe: nada que limpiar
  }
  entries.forEach((entry) => {
    if (!entry.isFile()) return;
    const name = entry.name;
    if (INTOCABLES.some((pattern) => pattern.test(name))) return;
    if (!BORRABLES.some((pattern) => pattern.test(name))) return;

    const absolute = path.join(dir, name);
    let size = 0;
    try {
      size = fs.statSync(absolute).size;
    } catch (_) {
      /* ya no esta: da igual */
    }
    encontrados += 1;
    liberados += size;
    if (DRY) {
      console.log('SECO     ' + (relative === '.' ? '' : relative + '/') + name + '  ' + size + ' bytes');
      return;
    }
    try {
      fs.unlinkSync(absolute);
      console.log('BORRADO  ' + (relative === '.' ? '' : relative + '/') + name + '  ' + size + ' bytes');
    } catch (err) {
      // Un log abierto por el servidor en marcha no se puede borrar: se avisa y
      // se sigue, no es un fallo de la limpieza.
      console.log('OCUPADO  ' + (relative === '.' ? '' : relative + '/') + name + '  (' + err.code + ')');
    }
  });
});

console.log(
  (DRY ? 'sin borrar nada (--dry): ' : '') +
    encontrados +
    ' ficheros, ' +
    Math.round(liberados / 1024) +
    ' KB' +
    (DRY ? ' recuperables' : ' liberados') +
    '. Nada de codigo, historial ni .env ha sido tocado.'
);
