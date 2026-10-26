'use strict';

/**
 * tools/copy-check.js - Comprueba lo que llega al portapapeles.
 *
 * «Copiar sin formato» usa plainForCopy, que vive en script.js (codigo de
 * navegador). Aqui se extrae esa funcion y se ejecuta suelta en Node, asi se
 * verifica el texto que sale pegado sin necesidad de abrir el navegador.
 *
 * Uso: node tools/copy-check.js
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'public', 'script.js'), 'utf8')
  .replace(/\r/g, '');

let failures = 0;
let checks = 0;

function check(label, ok, detail) {
  checks += 1;
  if (ok) {
    console.log('  OK    ' + label + (detail ? '  ->  ' + JSON.stringify(detail) : ''));
  } else {
    failures += 1;
    console.log('  FALLO ' + label + (detail ? '  ->  ' + JSON.stringify(detail) : ''));
  }
}

const found = /function plainForCopy\(text\) \{[\s\S]*?\n\}/.exec(source);
check('script.js define plainForCopy', Boolean(found), found ? found[0].slice(0, 40) + '...' : 'no aparece');
if (!found) {
  console.log('\n1 comprobaciones, 1 fallos.');
  process.exitCode = 1;
  return;
}

const plainForCopy = new Function('return ' + found[0])();

check('texto vacio sigue vacio', plainForCopy('') === '', plainForCopy(''));
check('null no rompe', plainForCopy(null) === '');
check('el texto corriente se respeta', plainForCopy('hola que tal') === 'hola que tal', plainForCopy('hola que tal'));

check(
  'fuera la negrita y la cursiva',
  plainForCopy('esto es **fuerte** y *suave*') === 'esto es fuerte y suave',
  plainForCopy('esto es **fuerte** y *suave*')
);
check('fuera el codigo en linea', plainForCopy('usa `npm run start` aqui') === 'usa npm run start aqui', plainForCopy('usa `npm run start` aqui'));
check(
  'el codigo en bloque se conserva sin los triple backtick',
  plainForCopy('```js\nconst a = 1;\nconsole.log(a);\n```') === 'const a = 1;\nconsole.log(a);',
  plainForCopy('```js\nconst a = 1;\nconsole.log(a);\n```')
);
check('fuera el titulo pero no el texto', plainForCopy('## Plan\nde trabajo') === 'Plan\nde trabajo', plainForCopy('## Plan\nde trabajo'));
check('fuera la cita', plainForCopy('> dicho por alguien') === 'dicho por alguien', plainForCopy('> dicho por alguien'));
check(
  'fuera las vinetas y las casillas de tarea',
  plainForCopy('- uno\n- [x] hecho\n- [ ] pendiente') === 'uno\nhecho\npendiente',
  plainForCopy('- uno\n- [x] hecho\n- [ ] pendiente')
);
check('fuera la numeracion', plainForCopy('1. primero\n2. segundo') === 'primero\nsegundo', plainForCopy('1. primero\n2. segundo'));
check(
  'los enlaces se quedan con su texto',
  plainForCopy('mira [la doc](https://example.com/a)') === 'mira la doc',
  plainForCopy('mira [la doc](https://example.com/a)')
);
check('fuera el tachado', plainForCopy('~~borrado~~ sigue') === 'borrado sigue', plainForCopy('~~borrado~~ sigue'));
check(
  'las tablas quedan en filas con barras',
  plainForCopy('| a | b |\n|---|---|\n| 1 | 2 |') === 'a | b\n1 | 2',
  plainForCopy('| a | b |\n|---|---|\n| 1 | 2 |')
);
check(
  'se conserva el salto entre parrafos',
  plainForCopy('uno\n\ndos') === 'uno\n\ndos',
  plainForCopy('uno\n\ndos')
);

const mixed = plainForCopy('# Informe\n\nEsto es **clave**:\n\n| idea | estado |\n|---|---|\n| copiar | listo |\n\n```bash\nnpm start\n```\n\n- [ ] repasar');
check('una respuesta mezclada sale limpia', mixed === 'Informe\n\nEsto es clave:\n\nidea | estado\ncopiar | listo\n\nnpm start\n\nrepasar', mixed);
check('no quedan simbolos de markdown sueltos', !/(\*\*|`|^[-*+] |\|[ -]*\|)/m.test(mixed), mixed);
check('las lineas horizontales no se pegan', plainForCopy('arriba\n\n---\n\nabajo') === 'arriba\n\nabajo', plainForCopy('arriba\n\n---\n\nabajo'));
check('una lista tras un parrafo conserva su salto', plainForCopy('texto suelto\n\n- uno\n- dos') === 'texto suelto\n\nuno\ndos', plainForCopy('texto suelto\n\n- uno\n- dos'));
check('la cursiva con guion bajo no se rompe', plainForCopy('variable _local_ sigue') === 'variable local sigue', plainForCopy('variable _local_ sigue'));
check('un numero suelto no pierde su punto final', plainForCopy('el 3. lugar') === 'el 3. lugar', plainForCopy('el 3. lugar'));

console.log('\n' + checks + ' comprobaciones, ' + failures + ' fallos.');
process.exitCode = failures === 0 ? 0 : 1;
