'use strict';

/**
 * tools/verify-files.js - Revisa que los ficheros del proyecto esten en UTF-8
 * limpio: sin BOM, sin caracter de reemplazo y sin mojibake (acentos guardados
 * dos veces, que aparecen como los codigos U+00C2 / U+00C3 en vez de la vocal
 * acentuada correspondiente).
 *
 * Uso: node tools/verify-files.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const FILES = [
  'package.json',
  '.env',
  '.env.example',
  '.gitignore',
  'README.md',
  'PROGRESS.md',
  'src/server.js',
  'src/dbService.js',
  'src/strataService.js',
  'src/pdfService.js',
  'src/public/index.html',
  'src/public/style.css',
  'src/public/script.js',
  'src/public/markdown.js',
  'src/public/favicon.svg',
  'tools/smoke.js',
  'tools/status-check.js',
  'tools/vision-probe.js',
  'tools/make-favicon.js',
  'tools/markdown-check.js',
  'tools/copy-check.js',
  'tools/pdf-check.js',
  'tools/voice-check.js',
  'tools/verify-files.js',
  'tools/server.ps1',
  'tools/browser-check.js',
  'tools/clean.js',
];

const MOJIBAKE_PATTERN = /[\u00C2\u00C3\uFFFD]/;
// Cualquier caracter fuera del rango latin-1 (letras espanolas, symbols tipograficos)
// delata un corte de codificacion o un ideograma colado: los .js y .md del proyecto
// se escriben en ASCII mas acentos espanoles.
const EXOTIC_PATTERN = /[^\u0000-\u00FF]/;

let problems = 0;

FILES.forEach((relative) => {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) {
    problems += 1;
    console.log('FALTA     ' + relative);
    return;
  }

  const buffer = fs.readFileSync(absolute);
  const text = buffer.toString('utf8');
  const issues = [];

  if (buffer.includes(0)) issues.push('byte nulo');
  if (text.includes('\uFFFD')) issues.push('char de reemplazo (UTF-8 roto)');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) issues.push('BOM al inicio');
  const mojibake = text.match(MOJIBAKE_PATTERN);
  if (mojibake) {
    issues.push('posible mojibake (U+' + mojibake[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + ')');
  }
  if (!relative.endsWith('.svg')) {
    const exotic = text.match(EXOTIC_PATTERN);
    if (exotic) {
      issues.push('caracter fuera del rango latin-1 (U+' + exotic[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + ' en la linea ' + (text.slice(0, exotic.index).split('\n').length) + ')');
    }
  }

  if (relative.endsWith('index.html') && !/charset=["']?utf-8/i.test(text)) {
    issues.push('falta meta charset utf-8');
  }

  if (issues.length) problems += 1;
  console.log(
    (issues.length ? 'PROBLEMA  ' : 'OK        ') +
      relative.padEnd(24) +
      String(buffer.length + ' bytes').padStart(9) +
      (issues.length ? '  ->  ' + issues.join(' | ') : '')
  );
});

console.log('\n' + (problems === 0 ? 'Sin problemas de codificacion.' : problems + ' ficheros con avisos.'));
process.exitCode = problems === 0 ? 0 : 1;
