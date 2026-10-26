'use strict';

/**
 * tools/markdown-check.js - Prueba rapida del renderizador de markdown.
 * Comprueba que el enfasis se convierte y que el HTML del modelo no se ejecuta.
 *
 * Uso: node tools/markdown-check.js
 */

const path = require('path');
const md = require(path.join(__dirname, '..', 'src', 'public', 'markdown.js'));

let failures = 0;

function check(label, ok, detail) {
  console.log((ok ? '  OK    ' : '  FALLO ') + label + (detail ? '  ->  ' + detail : ''));
  if (!ok) failures += 1;
}

/* Red de seguridad: ninguna etiqueta debe quedar abierta o de mas. Se usa con
   todas las muestras, incluido el bloque de codigo con su cabecera nueva. */
const PAIRED = ['div', 'pre', 'code', 'span', 'button', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'del', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function tagBalance(html) {
  let balance = 0;
  PAIRED.forEach((tag) => {
    const open = (html.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>', 'g')) || []).length;
    const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    balance += open - close;
  });
  return balance === 0;
}

const samples = [
  ['negrita', 'esto es **fuerte**'],
  ['cursiva', 'esto *ita* y esto _gui_'],
  ['tachado', '~~borrado~~'],
  ['codigo en linea', 'usa `npm run start` aqui'],
  ['codigo bloque', '```js\nconst a = **b**;\nconsole.log(1);\n```'],
  ['codigo sin cerrar', '```python\nprint(**x)'],
  ['encabezados', '# Uno\n## Dos'],
  ['lista', '- uno\n- dos\n- [x] hecho\n- [ ] pendiente'],
  ['lista numerada', '1. primero\n2. segundo'],
  ['cita', '> citado\n> sigue'],
  ['regla', 'a\n---\nb'],
  ['tabla', '| a | b |\n|---|---|\n| 1 | **2** |'],
  ['parrafos', 'uno\ndos\n\ntres'],
  ['respuesta mezclada', '## Resumen\n\nEsto es **clave**:\n\n```js\nconst a = 1;\n```\n\n- uno\n- [x] dos\n\n| a | b |\n|---|---|\n| 1 | 2 |'],
  ['codigo rodeado de texto', 'mira `x` primero\n\n```\nsin lenguaje\n```\n\ny despues fin'],
];

samples.forEach(([label, input]) => {
  const out = md.renderMarkdown(input);
  check('renderiza ' + label, out.length > 0, JSON.stringify(out).slice(0, 120));
  check('las etiquetas cuadran en ' + label, tagBalance(out), out.slice(0, 120));
});

const bold = md.renderMarkdown('esto es **fuerte**');
check('las ** se convierten en <strong>', bold.includes('<strong>fuerte</strong>'), bold);
check('no quedan ** sueltos', bold.indexOf('**') === -1, bold);

const code = md.renderMarkdown('```js\nconst a = **b**;\n```');
check('el codigo en bloque no se toca', code.includes('<code>const a = **b**;</code>'), code);
check('el bloque lleva cabecera con su lenguaje', code.includes('class="md-codebox"') && code.includes('md-codelang">js<'), code.slice(0, 170));
check('el bloque lleva su boton de copiar', code.includes('data-copy-block') && code.includes('Copiar bloque'), code.slice(0, 230));
check('el boton no usa onclick (lo atiende script.js)', code.indexOf('onclick=') === -1, code.slice(0, 230));
check('un bloque suelto no queda dentro de <p>', !/<p>[^<]*<div class="md-codebox"/.test(code), code.slice(0, 130));

const codeNoLang = md.renderMarkdown('```\nsin lenguaje\n```');
check('bloque sin lenguaje conserva cabecera y boton', codeNoLang.includes('md-codelang">codigo<') && codeNoLang.includes('data-copy-block'), codeNoLang.slice(0, 200));

const codeUnclosed = md.renderMarkdown('```python\nprint(1)');
check('bloque sin cerrar conserva cabecera y boton', codeUnclosed.includes('md-codelang">python<') && codeUnclosed.includes('data-copy-block'), codeUnclosed.slice(0, 200));

const twoBlocks = md.renderMarkdown('```js\nuno\n```\ntexto suelto\n```py\ndos\n```');
check('dos bloques, dos botones de copiar', (twoBlocks.match(/data-copy-block/g) || []).length === 2, twoBlocks.slice(0, 260));
check('el texto entre bloques se respeta', twoBlocks.includes('<p>texto suelto</p>'), twoBlocks.slice(0, 260));

const escaped = md.renderMarkdown('<img src=x onerror=alert(1)> <script>mal()</script>');
check('escapa el HTML del modelo', escaped.indexOf('<img') === -1 && escaped.indexOf('<script') === -1 && escaped.includes('&lt;img'), escaped);

const evil = md.renderMarkdown('[pulsa](javascript:alert(1))');
check('rechaza enlaces javascript:', evil.indexOf('javascript:') === -1, evil);

const link = md.renderMarkdown('mira [strata](https://example.com/a?x=1&y=2) y https://auto.link/end');
check('enlaces con rel=noopener', link.includes('rel="noopener noreferrer nofollow"'), link);

check('texto vacio', md.renderMarkdown('') === '');
check('null no rompe', md.renderMarkdown(null) === '');

console.log('\n' + (failures === 0 ? 'markdown OK' : failures + ' fallos de markdown'));
process.exitCode = failures === 0 ? 0 : 1;
