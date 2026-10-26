'use strict';

/**
 * pdfService.js - Saca texto plano de un PDF sin usar librerias externas.
 *
 * Se escribio a mano (solo usa 'zlib' de Node) para no anadir dependencias ni
 * telemetria: el PDF se abre aqui, en tu PC, y solo su texto pasa al modelo.
 *
 * API publica:
 *   PDF_MIME                            ->  'application/pdf'
 *   looksLikePdf(buffer)                ->  booleano
 *   extractPdfText(buffer, { maxChars }) ->  { ok, pages, chars, text,
 *                                              truncated, note, error, encrypted }
 *
 * Que entiende:
 *   - objetos clasicos "n g obj" y objetos metidos dentro de un flujo de
 *     objetos (ObjStm, lo normal en los PDF 1.5 de Word o de Chrome)
 *   - filtros FlateDecode (con predictores PNG), ASCIIHexDecode,
 *     ASCII85Decode y RunLengthDecode
 *   - fuentes simples (WinAnsi/PDFDoc con /Differences) y fuentes tipo 0
 *     (Identity-H) con su tabla ToUnicode
 * Que NO entiende, y lo dice en vez de inventar:
 *   - PDFs protegidos con /Encrypt (contrasena)
 *   - paginas que son solo la foto de un escaneado: no hay texto que sacar
 */

const zlib = require('zlib');

const PDF_MIME = 'application/pdf';

// Cortes de seguridad: un PDF mal formado no debe tumbar el servidor local.
const MAX_CHARS = 200000; // texto extraido que se retiene
const MAX_STREAM_BYTES = 64 * 1024 * 1024; // un flujo ya descomprimido
const MAX_PAGE_BYTES = 8 * 1024 * 1024; // contenido de una pagina

/** Codigos 0x80-0x9F de WinAnsiEncoding, que no coinciden con Latin-1. */
const WINANSI_HIGH = {
  0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030', 0x8a: '\u0160',
  0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017d', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02dc', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153',
  0x9e: '\u017e', 0x9f: '\u0178',
};

/** Nombres de glifo (PostScript) a caracter Unicode: los mas habituales. */
const GLYPH_NAMES = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', colon: ':',
  semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^',
  underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}',
  asciitilde: '~', exclamdown: '\u00a1', cent: '\u00a2', sterling: '\u00a3',
  fraction: '\u2044', yen: '\u00a5', florin: '\u0192', section: '\u00a7',
  currency: '\u00a4', quotesinglbase: '\u201a', quotedblbase: '\u201e',
  perthousand: '\u2030', guillemotleft: '\u00ab', guillemotright: '\u00bb',
  questiondown: '\u00bf', endash: '\u2013', emdash: '\u2014',
  quotedblleft: '\u201c', quotedblright: '\u201d', quoteleft: '\u2018',
  quoteright: '\u2019', bullet: '\u2022', dagger: '\u2020', daggerdbl: '\u2021',
  periodcentered: '\u00b7', ellipsis: '\u2026',
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl',
  oe: '\u0153', OE: '\u0152', ae: '\u00e6', AE: '\u00c6', oslash: '\u00f8',
  Oslash: '\u00d8', lslash: '\u0142', Lslash: '\u0141', dotlessi: '\u0131',
  plusminus: '\u00b1', multiply: '\u00d7', divide: '\u00f7', degree: '\u00b0',
  micro: '\u00b5', paragraph: '\u00b6', copyright: '\u00a9', ordfeminine: '\u00aa',
  registered: '\u00ae', macron: '\u00af', twosuperior: '\u00b2', threesuperior: '\u00b3',
  onesuperior: '\u00b9', onequarter: '\u00bc', onehalf: '\u00bd', threequarters: '\u00be',
  cedilla: '\u00b8', nbspace: '\u00a0',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};


// --- lector de base: tokens y estructuras ------------------------------------
function isSpace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0';
}

function isDelimiter(ch) {
  return (
    isSpace(ch) || ch === '(' || ch === ')' || ch === '<' || ch === '>' ||
    ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '/' || ch === '%'
  );
}

function skipSpace(s, i) {
  while (i < s.length) {
    const ch = s[i];
    if (isSpace(ch)) { i += 1; continue; }
    if (ch === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i += 1;
      continue;
    }
    break;
  }
  return i;
}

/** Cadena literal "( ... )" -> texto en latin1 y posicion siguiente. */
function readLiteralString(s, start) {
  let i = start + 1;
  let depth = 1;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const nx = s[i + 1];
      i += 1;
      if (nx === 'n') { out += '\n'; i += 1; }
      else if (nx === 'r') { out += '\r'; i += 1; }
      else if (nx === 't') { out += '\t'; i += 1; }
      else if (nx === 'b') { out += '\b'; i += 1; }
      else if (nx === 'f') { out += '\f'; i += 1; }
      else if (nx === '\r' || nx === '\n') {
        i += 1;
        if ((nx === '\r' && s[i] === '\n') || (nx === '\n' && s[i] === '\r')) i += 1;
      } else if (nx >= '0' && nx <= '7') {
        let oct = '';
        while (i < s.length && oct.length < 3 && s[i] >= '0' && s[i] <= '7') { oct += s[i]; i += 1; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else { out += nx; i += 1; }
      continue;
    }
    if (ch === '(') { depth += 1; out += ch; i += 1; continue; }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { text: out, next: i + 1 };
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, next: i };
}

/** Cadena hexadecimal "< ... >" -> texto en latin1 y posicion siguiente. */
function readHexString(s, start) {
  let i = start + 1;
  let hex = '';
  while (i < s.length && s[i] !== '>') {
    const ch = s[i];
    if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) hex += ch;
    i += 1;
  }
  if (hex.length % 2 === 1) hex += '0';
  let out = '';
  for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
  return { text: out, next: i + 1 };
}

/** Recorta el diccionario que empieza en "<<" respetando cadenas y anidados. */
function readDictSource(s, start) {
  let i = start + 2;
  let depth = 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '<' && s[i + 1] === '<') { depth += 1; i += 2; continue; }
    if (ch === '>' && s[i + 1] === '>') {
      depth -= 1;
      i += 2;
      if (depth === 0) return { text: s.slice(start, i), next: i };
      continue;
    }
    if (ch === '(') { i = readLiteralString(s, i).next; continue; }
    if (ch === '<') { i = readHexString(s, i).next; continue; }
    i += 1;
  }
  return { text: s.slice(start), next: i };
}

/** Divide un trozo de PDF en fichas: numeros, nombres, cadenas, corchetes, operadores. */
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isSpace(ch) || ch === '{' || ch === '}') { i += 1; continue; }
    if (ch === '%') { i = skipSpace(s, i); continue; }
    if (ch === '(') { const got = readLiteralString(s, i); out.push({ t: 'string', v: got.text }); i = got.next; continue; }
    if (ch === '<') {
      if (s[i + 1] === '<') { out.push({ t: 'dict' }); i += 2; continue; }
      const got = readHexString(s, i);
      out.push({ t: 'string', v: got.text });
      i = got.next;
      continue;
    }
    if (ch === '>') {
      if (s[i + 1] === '>') { out.push({ t: 'dict-end' }); i += 2; continue; }
      i += 1;
      continue;
    }
    if (ch === '[') { out.push({ t: '[' }); i += 1; continue; }
    if (ch === ']') { out.push({ t: ']' }); i += 1; continue; }
    if (ch === '/') {
      i += 1;
      let name = '';
      while (i < s.length && !isDelimiter(s[i])) {
        if (s[i] === '#' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
          name += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
          i += 3;
          continue;
        }
        name += s[i];
        i += 1;
      }
      out.push({ t: 'name', v: name });
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '+' || ch === '-' || ch === '.') {
      let j = i;
      let sign = '';
      if (s[j] === '+' || s[j] === '-') { sign = s[j]; j += 1; }
      let digits = '';
      let dotted = false;
      while (j < s.length) {
        const c = s[j];
        if (c >= '0' && c <= '9') { digits += c; j += 1; }
        else if (c === '.' && !dotted) { dotted = true; digits += c; j += 1; }
        else break;
      }
      if (digits === '' || digits === '.') { out.push({ t: 'op', v: ch }); i += 1; continue; }
      out.push({ t: 'num', v: parseFloat(sign + digits) });
      i = j;
      continue;
    }
    let j = i;
    while (j < s.length && !isDelimiter(s[j])) j += 1;
    if (j === i) { i += 1; continue; }
    const word = s.slice(i, j);
    i = j;
    if (word === 'true' || word === 'false' || word === 'null') {
      out.push({ t: 'lit', v: word === 'true' ? true : word === 'false' ? false : null });
    } else {
      out.push({ t: 'op', v: word });
    }
  }
  return out;
}

/** Valor de una ficha: numeros, referencias, nombres, cadenas, arrays y dictados. */
function valueFromTokens(tokens, pos) {
  const tok = tokens[pos];
  if (!tok) return { value: null, next: pos };
  if (tok.t === 'num') {
    const nxt = tokens[pos + 1];
    const third = tokens[pos + 2];
    if (nxt && nxt.t === 'num' && third && third.t === 'op' && third.v === 'R') {
      return { value: { ref: [tok.v, nxt.v] }, next: pos + 3 };
    }
    return { value: tok.v, next: pos + 1 };
  }
  if (tok.t === 'name') return { value: { name: tok.v }, next: pos + 1 };
  if (tok.t === 'string') return { value: Buffer.from(tok.v, 'latin1'), next: pos + 1 };
  if (tok.t === 'lit') return { value: tok.v, next: pos + 1 };
  if (tok.t === 'op') return { value: { word: tok.v }, next: pos + 1 };
  if (tok.t === 'dict') {
    const dict = {};
    let i = pos + 1;
    while (i < tokens.length) {
      if (tokens[i].t === 'dict-end') { i += 1; break; }
      if (tokens[i].t !== 'name') { i += 1; continue; }
      const key = tokens[i].v;
      const read = valueFromTokens(tokens, i + 1);
      dict[key] = read.value;
      i = read.next;
    }
    return { value: dict, next: i };
  }
  if (tok.t === '[') {
    const list = [];
    let i = pos + 1;
    while (i < tokens.length && tokens[i].t !== ']') {
      const read = valueFromTokens(tokens, i);
      if (read.next === i) { i += 1; continue; }
      list.push(read.value);
      i = read.next;
    }
    return { value: list, next: i + 1 };
  }
  return { value: null, next: pos + 1 };
}

function dictFromSource(source) {
  const tokens = tokenize(source);
  const read = valueFromTokens(tokens, 0);
  return read.value && !Array.isArray(read.value) && !read.value.ref && !read.value.name ? read.value : {};
}

function makeStore() {
  const objects = new Map();
  return {
    objects,
    put(num, gen, entry) {
      const held = objects.get(num);
      if (!held || gen >= (held.gen || 0)) objects.set(num, entry);
    },
    get(num) {
      return objects.get(Number(num)) || null;
    },
  };
}

function asName(value) {
  return value && typeof value === 'object' && typeof value.name === 'string' ? value.name : null;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRefId(value) {
  return value && typeof value === 'object' && Array.isArray(value.ref) ? value.ref[0] : null;
}

/** Devuelve el diccionario al que apunta una referencia, o el propio valor. */
function deref(store, value) {
  const id = asRefId(value);
  if (id === null) return value;
  const entry = store.get(id);
  return entry ? entry.dict : null;
}

// --- filtros de flujo --------------------------------------------------------
function inflate(raw) {
  const attempts = [zlib.inflateSync, zlib.inflateRawSync, zlib.unzipSync];
  for (const attempt of attempts) {
    try {
      const done = attempt(raw);
      if (done && done.length) return done;
    } catch (_) {
      /* se prueba con el siguiente formato */
    }
  }
  return null;
}

/** Predictores TIFF/PNG que llevan dentro los flujos comprimidos modernos. */
function applyPredictor(buf, parms) {
  const predictor = asNumber(parms && parms.Predictor) || 1;
  const columns = asNumber(parms && parms.Columns) || 0;
  const bpc = asNumber(parms && parms.BitsPerComponent) || 8;
  const colors = asNumber(parms && parms.Colors) || 1;
  if (predictor === 1 || columns <= 0 || predictor < 10) return buf;

  const bpp = Math.max(1, Math.round((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * bpc) / 8);
  if (!rowLen || buf.length < rowLen + 1) return buf;
  // Cada fila lleva delante su byte de filtro (0..4); si no lo lleva, se deja
  // el flujo tal cual en vez de inventar bytes.
  if (buf[0] > 4) return buf;

  const out = Buffer.alloc(buf.length);
  let prev = Buffer.alloc(rowLen);
  let src = 0;
  let dst = 0;
  while (src < buf.length) {
    const type = buf[src];
    src += 1;
    const row = buf.slice(src, src + rowLen);
    src += rowLen;
    const line = Buffer.alloc(rowLen);
    for (let k = 0; k < rowLen; k += 1) {
      const rawByte = row[k] || 0;
      const left = k >= bpp ? line[k - bpp] : 0;
      const up = prev[k];
      const upLeft = k >= bpp ? prev[k - bpp] : 0;
      let value = rawByte;
      if (type === 1) value = rawByte + left;
      else if (type === 2) value = rawByte + up;
      else if (type === 3) value = rawByte + ((left + up) >> 1);
      else if (type === 4) {
        const pa = Math.abs(up - upLeft) + Math.abs(upLeft - left);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const guess = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = rawByte + guess;
      }
      line[k] = value & 0xff;
    }
    line.copy(out, dst);
    dst += rowLen;
    prev = line;
    if (predictor === 2 && type >= 0x80) break;
  }
  return out.slice(0, dst);
}


function listOf(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function decodeAsciiHex(raw) {
  const text = raw.toString('latin1');
  const stop = text.indexOf('>');
  const hex = (stop === -1 ? text : text.slice(0, stop)).replace(/[^0-9A-Fa-f]/g, '');
  const size = Math.floor(hex.length / 2);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function decodeAscii85(raw) {
  const text = raw.toString('latin1').replace(/\s+/g, '');
  const body = text.replace(/^<~/, '').replace(/~>[\s\S]*$/, '');
  const out = [];
  let value = 0;
  let count = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === 'z' && count === 0) { out.push(0, 0, 0, 0); continue; }
    const code = ch.charCodeAt(0) - 33;
    if (code < 0 || code > 84) continue;
    value = value * 85 + code;
    count += 1;
    if (count === 5) {
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      value = 0;
      count = 0;
    }
  }
  if (count > 1) {
    for (let k = count; k < 5; k += 1) value = value * 85 + 84;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    for (let k = 0; k < count - 1; k += 1) out.push(bytes[k]);
  }
  return Buffer.from(out);
}

function decodeRunLength(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const len = raw[i];
    i += 1;
    if (len === 128) break;
    if (len < 128) {
      for (let k = 0; k <= len && i < raw.length; k += 1) out.push(raw[i++]);
    } else {
      const byte = raw[i];
      i += 1;
      for (let k = 0; k < 257 - len; k += 1) out.push(byte);
    }
  }
  return Buffer.from(out);
}

/** Aplica al binario los filtros que declara el diccionario del flujo. */
function decodeStream(store, raw, dict, notes) {
  if (!raw || !raw.length) return null;
  const filters = listOf(dict.Filter).map(asName).filter(Boolean);
  const parmsList = listOf(dict.DecodeParms);
  let data = raw;
  for (let i = 0; i < filters.length; i += 1) {
    const filter = filters[i];
    let parms = {};
    const declared = parmsList[i];
    if (declared && typeof declared === 'object') parms = deref(store, declared) || declared;
    if (filter === 'FlateDecode' || filter === 'Fl') {
      const done = inflate(data);
      if (!done) {
        if (notes) notes.push('un flujo comprimido llega corrupto');
        return null;
      }
      data = applyPredictor(done.length > MAX_STREAM_BYTES ? done.slice(0, MAX_STREAM_BYTES) : done, parms);
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      data = decodeAsciiHex(data);
    } else if (filter === 'ASCII85Decode' || filter === 'A85') {
      data = decodeAscii85(data);
    } else if (filter === 'RunLengthDecode' || filter === 'RL') {
      data = decodeRunLength(data);
    } else if (filter === 'DCTDecode' || filter === 'JPXDecode' || filter === 'CCITTFaxDecode' || filter === 'JBIG2Decode') {
      return null; // es una imagen dentro del PDF: aqui solo interesa el texto
    } else {
      if (notes) notes.push('el filtro ' + filter + ' no se sabe leer');
      return null;
    }
    if (!data || !data.length) return null;
  }
  return data;
}

// --- lector del documento: objetos, flujos y paginas -------------------------
/** Binario crudo de un flujo, fiandose de /Length o buscando "endstream". */
function streamRawAt(s, buf, dict, afterKeyword) {
  let dataStart = afterKeyword;
  if (s[dataStart] === '\r') dataStart += 1;
  if (s[dataStart] === '\n') dataStart += 1;

  let rawEnd = -1;
  const declared = asNumber(dict.Length);
  if (declared !== null && declared >= 0 && dataStart + declared <= s.length) {
    let probe = dataStart + declared;
    while (s[probe] === '\r' || s[probe] === '\n') probe += 1;
    if (s.startsWith('endstream', probe)) rawEnd = dataStart + declared;
  }
  const marker = s.indexOf('endstream', dataStart);
  if (rawEnd === -1) {
    rawEnd = marker === -1 ? s.length : marker;
    while (rawEnd > dataStart && (s[rawEnd - 1] === '\r' || s[rawEnd - 1] === '\n')) rawEnd -= 1;
  }
  return {
    bytes: buf.slice(dataStart, rawEnd),
    next: marker === -1 ? s.length : marker + 'endstream'.length,
  };
}

/** Recorre el fichero entero sacando cada "n g obj ... endobj". */
function scanObjects(buf) {
  const s = buf.toString('latin1');
  const store = makeStore();
  const objRe = /(\d{1,10})\s+(\d{1,5})\s+obj(?![A-Za-z0-9])/g;
  let match;
  let guard = 0;
  while ((match = objRe.exec(s)) && guard < 200000) {
    guard += 1;
    const num = Number(match[1]);
    const gen = Number(match[2]);
    const cursor = skipSpace(s, match.index + match[0].length);
    if (s[cursor] !== '<' || s[cursor + 1] !== '<') continue;

    const dictRead = readDictSource(s, cursor);
    const entry = { num, gen, dict: dictFromSource(dictRead.text), raw: null, decoded: null };
    let next = dictRead.next;
    const after = skipSpace(s, next);
    if (s.startsWith('stream', after)) {
      const flow = streamRawAt(s, buf, entry.dict, after + 'stream'.length);
      entry.raw = flow.bytes;
      next = flow.next;
      if (next > objRe.lastIndex) objRe.lastIndex = next;
    }
    store.put(num, gen, entry);
  }
  return { s, store };
}

/** Saca los objetos que van metidos dentro de un flujo de objetos (ObjStm). */
function expandObjStreams(store, notes) {
  const sources = Array.from(store.objects.values()).filter((entry) => asName(entry.dict.Type) === 'ObjStm');
  sources.forEach((entry) => {
    const data = decodeStream(store, entry.raw, entry.dict, notes);
    if (!data) return;
    const text = data.toString('latin1');
    const count = asNumber(entry.dict.N) || 0;
    const first = asNumber(entry.dict.First) || 0;
    if (!count || count > 20000 || first <= 0 || first >= text.length) return;

    const header = text.slice(0, first).split(/[^0-9]+/).filter((v) => v !== '').map(Number);
    for (let k = 0; k < count; k += 1) {
      const num = header[k * 2];
      const offset = header[k * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(offset) || store.objects.has(num)) continue;
      const cursor = skipSpace(text, first + offset);
      if (text[cursor] !== '<' || text[cursor + 1] !== '<') continue;
      const inner = readDictSource(text, cursor);
      store.objects.set(num, { num, gen: 0, dict: dictFromSource(inner.text), raw: null, decoded: null });
    }
  });
}

/** true si el documento va cifrado: ahi el texto no se puede leer sin clave. */
function detectEncryption(s, store) {
  let idx = s.lastIndexOf('trailer');
  let hops = 0;
  while (idx !== -1 && hops < 32) {
    hops += 1;
    const at = skipSpace(s, idx + 'trailer'.length);
    if (s[at] === '<' && s[at + 1] === '<') {
      const dict = dictFromSource(readDictSource(s, at).text);
      if (dict.Encrypt !== undefined && dict.Encrypt !== null) return true;
    }
    idx = s.lastIndexOf('trailer', idx - 1);
  }
  for (const entry of store.objects.values()) {
    if (entry.dict.Encrypt === undefined || entry.dict.Encrypt === null) continue;
    if (asName(entry.dict.Type) === 'XRef' || entry.dict.W !== undefined) return true;
  }
  return false;
}

function findCatalog(store) {
  let fallback = null;
  for (const entry of store.objects.values()) {
    if (asName(entry.dict.Type) === 'Catalog') return entry;
    if (entry.dict.Pages !== undefined && !fallback) fallback = entry;
  }
  return fallback;
}

/** Pagina en el orden en que la ve el lector; si falla el arbol, por numero. */
function collectPages(store) {
  const ordered = [];
  const seen = new Set();
  const catalog = findCatalog(store);

  function walk(id, depth, inherited) {
    if (id === null || depth > 40 || seen.has(id)) return;
    seen.add(id);
    const entry = store.get(id);
    if (!entry) return;
    const resources = entry.dict.Resources !== undefined ? entry.dict.Resources : inherited;
    const type = asName(entry.dict.Type);
    if (type === 'Pages' || (type !== 'Page' && entry.dict.Kids !== undefined)) {
      listOf(entry.dict.Kids).forEach((kid) => walk(asRefId(kid), depth + 1, resources));
      return;
    }
    if (type === 'Page' || entry.dict.Contents !== undefined) ordered.push({ entry, resources });
  }

  if (catalog && catalog.dict.Pages !== undefined) walk(asRefId(catalog.dict.Pages), 0, null);
  if (!ordered.length) {
    Array.from(store.objects.values())
      .filter((entry) => asName(entry.dict.Type) === 'Page')
      .sort((a, b) => a.num - b.num)
      .forEach((entry) => ordered.push({ entry, resources: entry.dict.Resources }));
  }
  return ordered;
}


// --- fuentes: de los codigos internos a caracteres legibles ------------------
function padHex(value, size) {
  let hex = Math.max(0, value >>> 0).toString(16).toUpperCase();
  while (hex.length < size) hex = '0' + hex;
  return hex.length > size ? hex.slice(hex.length - size) : hex;
}

/** Hexadecimal UTF-16BE -> cadena (es lo que traen las tablas ToUnicode). */
function hexToUnicode(hex) {
  const clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    const code = parseInt(clean.slice(i, i + 4), 16);
    if (code) out += String.fromCharCode(code);
  }
  return out;
}

/** Tabla ToUnicode de una fuente tipo 0: bloques bfchar y bfrange. */
function parseToUnicodeCMap(text) {
  const map = new Map();
  (text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []).forEach((block) => {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let hit;
    while ((hit = pair.exec(block))) {
      const key = hit[1].toUpperCase();
      const value = hexToUnicode(hit[2]);
      if (key && value) map.set(key, value);
    }
  });
  (text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []).forEach((block) => {
    const entry = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g;
    let hit;
    while ((hit = entry.exec(block))) {
      const lo = parseInt(hit[1], 16);
      const hi = parseInt(hit[2], 16);
      const span = hi - lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || span < 0 || span > 65535) continue;
      if (hit[3] !== undefined) {
        const dest = hit[3].replace(/[^0-9A-Fa-f]/g, '');
        if (dest.length === 4) {
          const base = parseInt(dest, 16);
          for (let k = 0; k <= span; k += 1) map.set(padHex(lo + k, hit[1].length), String.fromCharCode(base + k));
        } else {
          for (let k = 0; k <= span; k += 1) map.set(padHex(lo + k, hit[1].length), hexToUnicode(dest.slice(k * 4, k * 4 + 4)));
        }
      } else if (hit[4] !== undefined) {
        const items = hit[4].match(/<([0-9A-Fa-f]+)>/g) || [];
        for (let k = 0; k <= span && k < items.length; k += 1) {
          map.set(padHex(lo + k, hit[1].length), hexToUnicode(items[k].slice(1, -1)));
        }
      }
    }
  });
  return map;
}

function glyphNameToChar(name) {
  if (!name) return '';
  if (Object.prototype.hasOwnProperty.call(GLYPH_NAMES, name)) return GLYPH_NAMES[name];
  const uni = /^uni([0-9A-Fa-f]{4,6})/.exec(name);
  if (uni) return hexToUnicode(uni[1]);
  const u = /^u([0-9A-Fa-f]{4,6})/.exec(name);
  if (u) return hexToUnicode(u[1]);
  const base = name.split('.')[0];
  if (Object.prototype.hasOwnProperty.call(GLYPH_NAMES, base)) return GLYPH_NAMES[base];
  if (name.length === 1) return name;
  return '';
}

/** Byte suelto de una fuente simple: WinAnsi, que es la que traen casi todos. */
function winAnsiChar(byte) {
  if (byte === 0x0a || byte === 0x0d || byte === 0x09) return String.fromCharCode(byte);
  if (byte < 0x20) return '';
  if (byte >= 0x80 && byte <= 0x9f) return WINANSI_HIGH[byte] || '';
  return String.fromCharCode(byte);
}

function decodeWinAnsi(bytes) {
  let out = '';
  const units = [];
  for (let i = 0; i < bytes.length; i += 1) {
    out += winAnsiChar(bytes[i]);
    units.push(bytes[i]);
  }
  return { text: out, unknown: 0, units };
}

function decodeUtf16Be(bytes) {
  let out = '';
  const units = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    units.push(code);
    if (code) out += String.fromCharCode(code);
  }
  return { text: out, unknown: 0, units };
}

/** Decodificador para fuentes con mapa a Unicode (codes de 1 o 2 bytes). */
function makeCmapDecoder(map) {
  return function decodeCmap(bytes) {
    const hex = bytes.toString('hex').toUpperCase();
    let out = '';
    let unknown = 0;
    const units = [];
    let i = 0;
    while (i < hex.length) {
      const four = hex.slice(i, i + 4);
      if (four.length === 4 && map.has(four)) { out += map.get(four); units.push(parseInt(four, 16)); i += 4; continue; }
      const two = hex.slice(i, i + 2);
      if (map.has(two)) { out += map.get(two); units.push(parseInt(two, 16)); i += 2; continue; }
      unknown += 1;
      i += 2;
    }
    return { text: out, unknown, units };
  };
}


/** Tabla /Differences de una codificacion simple: numero -> caracter. */
function differencesMap(store, encoding) {
  const map = new Map();
  if (!encoding || !Array.isArray(encoding.Differences)) return map;
  let code = 0;
  encoding.Differences.forEach((item) => {
    const number = asNumber(item);
    if (number !== null) { code = number; return; }
    const name = asName(item);
    if (name !== null) { map.set(code, glyphNameToChar(name)); code += 1; }
  });
  return map;
}

/** Anchuras en 1/1000 de em: acepta [c [w w w]] y [c primero ultimo]. */
function readWidthEntries(list, table) {
  if (!Array.isArray(list)) return;
  let i = 0;
  while (i < list.length) {
    const first = asNumber(list[i]);
    if (first === null) { i += 1; continue; }
    if (Array.isArray(list[i + 1])) {
      list[i + 1].forEach((item, k) => {
        const value = asNumber(item);
        if (value !== null) table.set(first + k, value);
      });
      i += 2;
      continue;
    }
    const last = asNumber(list[i + 1]);
    const value = asNumber(list[i + 2]);
    if (last !== null && value !== null) {
      for (let code = first; code <= last && code - first < 65536; code += 1) table.set(code, value);
      i += 3;
      continue;
    }
    i += 2;
  }
}

/**
 * Anchuras de glifo declaradas por la fuente (/Widths en las simples, /W y /DW
 * en la descendiente de las Type0). Sin tabla no se puede seguir el lapiz y el
 * interprete se queda con el comportamiento de siempre.
 */
function buildFontWidths(store, font) {
  const table = new Map();
  let fallback = 1000;
  if (!font || typeof font !== 'object') return { table, fallback, space: null };
  if (asName(font.Subtype) === 'Type0') {
    const kids = Array.isArray(font.DescendantFonts) ? font.DescendantFonts : [];
    const descendant = deref(store, kids[0]);
    const source = descendant && typeof descendant === 'object' ? descendant : font;
    const dw = asNumber(source.DW);
    if (dw !== null) fallback = dw;
    readWidthEntries(source.W, table);
    if (source !== font) readWidthEntries(font.W, table);
    return { table, fallback, space: null };
  }
  const first = asNumber(font.FirstChar);
  const start = first === null ? 0 : first;
  (Array.isArray(font.Widths) ? font.Widths : []).forEach((item, k) => {
    const value = asNumber(item);
    if (value !== null) table.set(start + k, value);
  });
  const missing = asNumber(font.MissingWidth);
  if (missing !== null) fallback = missing;
  return { table, fallback, space: table.has(32) ? table.get(32) : null };
}

/** Devuelve decode(bytes) -> { text, unknown, units } para una fuente del PDF. */
function buildFontDecoderCore(store, font, stats) {
  if (!font || typeof font !== 'object') return decodeWinAnsi;

  const toUnicodeId = asRefId(font.ToUnicode);
  if (toUnicodeId !== null) {
    const entry = store.get(toUnicodeId);
    if (entry) {
      const data = decodeStream(store, entry.raw, entry.dict, null);
      if (data) {
        const map = parseToUnicodeCMap(data.toString('latin1'));
        if (map.size) {
          if (stats) stats.cmapFonts += 1;
          return makeCmapDecoder(map);
        }
      }
    }
  }

  if (asName(font.Subtype) === 'Type0') {
    const encoding = asName(font.Encoding) || '';
    if (stats) stats.unmappedFonts += 1;
    // Sin ToUnicode, Identity-H suele venir con los codigos en UTF-16 dentro.
    return /Identity|UTF-16|UTF-32/i.test(encoding) ? decodeUtf16Be : decodeWinAnsi;
  }

  const encoding = deref(store, font.Encoding);
  const diffs = differencesMap(store, encoding);
  if (!diffs.size) return decodeWinAnsi;
  return function decodeDifferences(bytes) {
    let out = '';
    let unknown = 0;
    const units = [];
    for (let i = 0; i < bytes.length; i += 1) {
      const held = diffs.get(bytes[i]);
      units.push(bytes[i]);
      if (held) out += held;
      else if (bytes[i] >= 32 && bytes[i] < 127) out += String.fromCharCode(bytes[i]);
      else unknown += 1;
    }
    return { text: out, unknown, units };
  };
}

/** Anade al decodificador la tabla de anchuras, si la fuente la trae. */
function buildFontDecoder(store, font, stats) {
  let decode = buildFontDecoderCore(store, font, stats);
  const widths = buildFontWidths(store, font);
  if (!widths.table.size) return decode;
  if (decode === decodeWinAnsi || decode === decodeUtf16Be) {
    const inner = decode;
    decode = (bytes) => inner(bytes);
  }
  decode.widthFor = (units) => {
    let total = 0;
    (Array.isArray(units) ? units : []).forEach((unit) => {
      total += widths.table.has(unit) ? widths.table.get(unit) : widths.fallback;
    });
    return total;
  };
  decode.spaceWidth = widths.space;
  return decode;
}

function collectFontDecoders(store, resources, stats) {
  const decoders = new Map();
  const resourcesDict = deref(store, resources);
  if (!resourcesDict) return decoders;
  const fonts = deref(store, resourcesDict.Font);
  if (!fonts) return decoders;
  Object.keys(fonts).forEach((name) => {
    const fontDict = deref(store, fonts[name]);
    if (!fontDict) return;
    if (stats) {
      stats.fonts += 1;
      if (/Type3/i.test(asName(fontDict.Subtype) || '')) stats.type3Fonts += 1;
    }
    decoders.set(name, buildFontDecoder(store, fontDict, stats));
  });
  return decoders;
}


// --- el contenido de una pagina: operadores de texto -------------------------
function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : null;
}

/** Junta los flujos /Contents de una pagina o de un Form XObject. */
function pageContentBytes(store, target, stats) {
  const parts = [];
  let total = 0;
  listOf(target.Contents).forEach((item) => {
    const id = asRefId(item);
    const entry = id !== null ? store.get(id) : item && item.dict ? item : null;
    if (!entry) return;
    const data = decodeStream(store, entry.raw, entry.dict, stats ? stats.notes : null);
    if (!data) return;
    if (total + data.length > MAX_PAGE_BYTES) return;
    parts.push(data);
    total += data.length;
  });
  return parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
}

/**
 * Interpretacion minima del contenido: solo lo que afecta al texto.
 * Salto de linea cuando cambia la Y y espacio cuando el hueco entre trozos
 * supera lo que ocuparia un espacio de esa fuente. Si la fuente trae anchuras
 * se sigue el lapiz glifo a glifo (es lo que hace Chrome al imprimir).
 */
function interpretContent(store, resources, content, stats, depth) {
  const tokens = tokenize(content.toString('latin1'));
  const fonts = collectFontDecoders(store, resources, stats);
  const lines = [];
  let pending = '';
  let touched = false;

  let font = null;
  let fontSize = 12;
  let leading = 12;
  let x = 0;
  let y = 0;
  let penX = 0;
  let textScale = 1;
  let dictDepth = 0;
  let skippingImage = false;

  const stack = [];
  const arrays = [];

  const flush = () => {
    if (!touched) return;
    lines.push(pending.replace(/[ \t]+$/, ''));
    pending = '';
    touched = false;
  };
  const breakLine = (paragraph) => {
    flush();
    if (paragraph && lines.length && lines[lines.length - 1] !== '') lines.push('');
  };
  const gapSpace = () => {
    if (pending && !/[ \t]$/.test(pending)) {
      pending += ' ';
      touched = true;
    }
  };
  const knowsWidths = () => Boolean(font && typeof font.widthFor === 'function');
  const spaceUnits = () =>
    (font && Number.isFinite(font.spaceWidth) ? (font.spaceWidth / 1000) * fontSize * textScale : fontSize * 0.28);
  const advanceOf = (units) =>
    (knowsWidths() ? (font.widthFor(units || []) / 1000) * fontSize * textScale : 0);
  const show = (bytes) => {
    if (!bytes || !bytes.length) return;
    const done = (font || decodeWinAnsi)(bytes);
    penX += advanceOf(done.units);
    if (stats) {
      stats.shown += bytes.length;
      stats.unknown += done.unknown;
    }
    if (done.text) {
      pending += done.text;
      touched = true;
    }
  };
  const lineGap = () => (leading > 0 ? leading : fontSize);
  // Con anchuras de fuente el hueco de verdad es lo que sobra por encima del
  // punto donde termino el ultimo glifo; sin ellas se mira el desplazamiento.
  const moveBy = (tx, ty) => {
    const nx = x + tx;
    const ny = y + ty;
    if (Math.abs(ty) > 0.01) breakLine(Math.abs(ty) > lineGap() * 1.9);
    else if (knowsWidths() ? nx - penX > spaceUnits() * 0.5 : tx > fontSize * 0.2) gapSpace();
    x = nx;
    y = ny;
    penX = nx;
  };
  const moveTo = (nx, ny) => {
    if (Math.abs(ny - y) > Math.max(0.6, fontSize * 0.2)) breakLine(Math.abs(ny - y) > lineGap() * 1.9);
    else if (knowsWidths() ? nx - penX > spaceUnits() * 0.5 : nx > x + fontSize * 0.25) gapSpace();
    x = nx;
    y = ny;
    penX = nx;
  };
  const invokeForm = (name) => {
    if (depth >= 3) return;
    const resourcesDict = deref(store, resources);
    const forms = resourcesDict ? deref(store, resourcesDict.XObject) : null;
    const id = forms ? asRefId(forms[name]) : null;
    if (id === null) return;
    const entry = store.get(id);
    if (!entry || asName(entry.dict.Subtype) !== 'Form') return;
    // En un Form XObject el dibujo va en su propio flujo; algunos lo enlazan
    // aparte con /Contents, como hacen las paginas.
    let inner = decodeStream(store, entry.raw, entry.dict, stats && stats.notes ? stats.notes : null);
    if (!inner || !inner.length) inner = pageContentBytes(store, entry.dict, stats);
    if (!inner || !inner.length) return;
    flush();
    interpretContent(store, entry.dict.Resources !== undefined ? entry.dict.Resources : resources, inner, stats, depth + 1)
      .forEach((line) => lines.push(line));
  };



  tokens.forEach((tok) => {
    if (skippingImage) {
      if (tok.t === 'op' && tok.v === 'EI') skippingImage = false;
      return;
    }
    if (tok.t === 'dict') { dictDepth += 1; return; }
    if (tok.t === 'dict-end') { dictDepth = Math.max(0, dictDepth - 1); return; }
    if (dictDepth > 0) return;

    if (tok.t === 'num' || tok.t === 'lit') { stack.push(tok.v); return; }
    if (tok.t === 'string') { stack.push(Buffer.from(tok.v, 'latin1')); return; }
    if (tok.t === 'name') { stack.push({ name: tok.v }); return; }
    if (tok.t === '[') { arrays.push([]); return; }
    if (tok.t === ']') {
      const done = arrays.pop() || [];
      if (arrays.length) arrays[arrays.length - 1].push(done);
      else stack.push(done);
      return;
    }
    if (tok.t !== 'op') return;

    const args = stack.splice(0);
    switch (tok.v) {
      case 'Tf': {
        const named = args.find((item) => item && item.name);
        const size = args.find((item) => typeof item === 'number');
        if (named) font = fonts.has(named.name) ? fonts.get(named.name) : null;
        if (typeof size === 'number' && size > 0) fontSize = size;
        break;
      }
      case 'Td':
      case 'TD': {
        const tx = typeof args[0] === 'number' ? args[0] : 0;
        const ty = typeof args[1] === 'number' ? args[1] : 0;
        if (tok.v === 'TD' && ty) leading = -ty;
        // El desplazamiento viene en el espacio del texto: hay que pasarlo por
        // la escala horizontal de la matriz (con Tm 1 0 0 -1 no cambia nada).
        moveBy(tx * textScale, ty);
        break;
      }
      case 'Tm': {
        const a = typeof args[0] === 'number' ? args[0] : 0;
        if (a) textScale = Math.abs(a);
        const nx = typeof args[4] === 'number' ? args[4] : x;
        const ny = typeof args[5] === 'number' ? args[5] : y;
        moveTo(nx, ny);
        break;
      }
      case 'TL':
        if (typeof args[0] === 'number' && args[0]) leading = args[0];
        break;
      case 'T*':
        y -= lineGap();
        breakLine(false);
        break;
      case 'Tj':
        show(asBuffer(args[0]));
        break;
      case "'":
        y -= lineGap();
        breakLine(false);
        show(asBuffer(args[0]));
        break;
      case '"':
        y -= lineGap();
        breakLine(false);
        show(asBuffer(args[2]));
        break;
      case 'TJ': {
        const items = Array.isArray(args[0]) ? args[0] : args;
        items.forEach((item) => {
          const bytes = asBuffer(item);
          if (bytes) show(bytes);
          else if (typeof item === 'number') {
            const gap = (-item / 1000) * fontSize * textScale;
            penX += gap;
            // Con anchuras el kerning no es un espacio: solo lo que pasa del
            // ancho de un espacio de esa fuente lo es.
            if (knowsWidths() ? gap > spaceUnits() * 0.9 : gap > fontSize * 0.18) gapSpace();
          }
        });
        break;
      }
      case 'BI':
        skippingImage = true;
        break;
      case 'Do': {
        const named = args.find((item) => item && item.name);
        if (named) invokeForm(named.name);
        break;
      }
      default:
        break;
    }
  });

  flush();
  return lines;
}

// --- salida limpia y API publica ---------------------------------------------
/** Quita espacios de mas y deja un solo salto entre parrafos. */
function tidyLines(lines) {
  const cleaned = [];
  let blanks = 0;
  lines.forEach((rawLine) => {
    let text = String(rawLine).replace(/\r/g, '').replace(/\t/g, ' ');
    text = text.replace(/ {2,}/g, ' ').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    if (!text) {
      blanks += 1;
      if (cleaned.length && blanks <= 1) cleaned.push('');
      return;
    }
    blanks = 0;
    cleaned.push(text);
  });
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned;
}

function looksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
  return buffer.slice(0, 1024).toString('latin1').indexOf('%PDF-') !== -1;
}

/**
 * Extrae el texto de un PDF. Nunca inventa: si algo no se puede leer, lo dice
 * en `note` o en `error`.
 */
function extractPdfText(buffer, options) {
  const opts = options || {};
  const maxChars = Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : MAX_CHARS;

  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, error: 'El PDF llega vacio.' };
  if (!looksLikePdf(buffer)) return { ok: false, error: 'El archivo no empieza por %PDF-: no parece un PDF.' };

  try {
    const scanned = scanObjects(buffer);
    const stats = { notes: [], fonts: 0, cmapFonts: 0, unmappedFonts: 0, type3Fonts: 0, shown: 0, unknown: 0 };
    expandObjStreams(scanned.store, stats.notes);

    if (detectEncryption(scanned.s, scanned.store)) {
      return {
        ok: false,
        encrypted: true,
        error: 'El PDF esta protegido con contrasena: este servidor no puede abrirlo para sacar su texto.',
      };
    }

    const found = collectPages(scanned.store);
    if (!found.length) {
      return { ok: false, error: 'El PDF no tiene paginas legibles (puede estar truncado o ser de otra version).' };
    }
    const limited = found.length > 400 ? found.slice(0, 400) : found;

    const chunks = [];
    let used = 0;
    let truncated = found.length > limited.length;
    limited.forEach((page, index) => {
      if (used >= maxChars) { truncated = true; return; }
      const rawLines = interpretContent(
        scanned.store,
        page.resources,
        pageContentBytes(scanned.store, page.entry.dict, stats),
        stats,
        0
      );
      let body = tidyLines(rawLines).join('\n');
      if (!body.trim()) return; // pagina sin texto (una foto, un plano)
      if (found.length > 1) body = '[pagina ' + (index + 1) + ']\n' + body;
      const room = maxChars - used;
      if (body.length > room) {
        body = body.slice(0, room);
        truncated = true;
      }
      chunks.push(body);
      used += body.length;
    });

    const text = chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    const notes = [];
    if (!text) {
      notes.push('el PDF no tiene texto que se pueda leer: parece una foto escaneada o un plano');
    } else {
      if (stats.type3Fonts) notes.push('usa fuentes dibujadas (Type3): parte del texto puede no salir');
      if (stats.unmappedFonts && stats.unknown > 8) notes.push('usa fuentes sin tabla a Unicode: pueden faltar caracteres');
    }
    if (stats.notes.length) notes.push(stats.notes.join(' | '));
    if (truncated) notes.push('el texto es largo: se ha cortado en ' + maxChars + ' caracteres');

    return {
      ok: true,
      pages: found.length,
      chars: text.length,
      text,
      truncated,
      note: notes.length ? notes.join(' · ') : null,
    };
  } catch (err) {
    return { ok: false, error: 'El PDF se ha roto al leerlo: ' + (err && err.message ? String(err.message).slice(0, 160) : 'fallo inesperado') };
  }
}

module.exports = {
  PDF_MIME,
  looksLikePdf,
  extractPdfText,
};


