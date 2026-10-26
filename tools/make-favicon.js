'use strict';

/**
 * tools/make-favicon.js - Genera src/public/favicon.png (64x64) sin dependencias.
 *
 * Hace falta como respaldo para navegadores que no aceptan favicon.svg.
 * Dibuja el mismo motivo que el SVG: tarjeta redondeada verde sobre fondo
 * oscuro con una chispa blanca.
 *
 * Uso: node tools/make-favicon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 64;
const OUT = path.join(__dirname, '..', 'src', 'public', 'favicon.png');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function insideRoundedRect(x, y, radius) {
  const max = SIZE - radius;
  if (x >= radius && x < max) return true;
  if (y >= radius && y < max) return true;
  const cx = x < radius ? radius : max;
  const cy = y < radius ? radius : max;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius;
}

function pixel(x, y) {
  if (!insideRoundedRect(x, y, 12)) return [0, 0, 0, 0];

  const center = (SIZE - 1) / 2;
  const diamond = Math.abs(x - center) + Math.abs(y - center);

  // chispa de 4 puntas: rombo con los brazos estrechos
  const narrow = Math.abs(x - center) * Math.abs(y - center);
  if (diamond <= 17 && narrow <= 11) return [63, 178, 127, 255];
  if (diamond <= 6) return [231, 237, 244, 255];

  // tarjeta oscura con borde verde
  if (y >= 15 && y <= 45 && x >= 10 && x <= 54) {
    const nearBorder = x <= 12 || x >= 52 || y <= 17;
    return nearBorder ? [63, 178, 127, 255] : [27, 34, 43, 255];
  }

  // marco exterior
  const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
  if (edge <= 3) return [63, 178, 127, 255];
  return [14, 17, 22, 255];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let offset = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0;
  offset += 1;
  for (let x = 0; x < SIZE; x += 1) {
    const [r, g, b, a] = pixel(x, y);
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = a;
    offset += 4;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(OUT, png);
console.log('favicon.png escrito en ' + OUT + ' (' + png.length + ' bytes, ' + SIZE + 'x' + SIZE + ')');
