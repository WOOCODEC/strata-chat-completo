'use strict';

/**
 * tools/pdf-check.js - Comprueba el extractor de PDF con PDFs fabricados aqui.
 *
 * No se descarga ninguna muestra de fuera: cada PDF se escribe a mano en
 * memoria (con su tabla xref o con su xref en flujo) para poder verificar que
 * el servidor local saca el texto de verdad, tambien cuando va comprimido o
 * con fuente Unicode, que es lo que producen Word y Chrome.
 *
 * Uso: node tools/pdf-check.js
 */

const zlib = require('zlib');
const pdf = require('../src/pdfService.js');

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

const latin1 = (value) => Buffer.from(value, 'latin1');
const size = (value) => Buffer.byteLength(value, 'latin1');

function streamBody(dictText, data) {
  const bytes = Buffer.isBuffer(data) ? data : latin1(data);
  return '<< ' + dictText + ' /Length ' + bytes.length + ' >>\nstream\n' + bytes.toString('latin1') + '\nendstream';
}

function rawObject(num, body) {
  return num + ' 0 obj\n' + body + '\nendobj\n';
}

/** PDF clasico: objetos numerados en orden, tabla xref y trailer. */
function classicPdf(parts, trailerExtra) {
  let out = '%PDF-1.7\n';
  const offsets = [];
  parts.forEach((part, index) => {
    offsets.push(size(out));
    out += rawObject(index + 1, part);
  });
  const startxref = size(out);
  out += 'xref\n0 ' + (parts.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach((offset) => {
    out += String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  out +=
    'trailer\n<< /Size ' + (parts.length + 1) + ' /Root 1 0 R' + (trailerExtra || '') +
    ' >>\nstartxref\n' + startxref + '\n%%EOF\n';
  return latin1(out);
}

/** Filas PNG con filtro "up", el que traen los xref en flujo modernos. */
function pngUpRows(rows) {
  const bytes = [];
  let prev = null;
  rows.forEach((row) => {
    if (!prev) {
      bytes.push(0);
      row.forEach((byte) => bytes.push(byte));
    } else {
      bytes.push(2);
      for (let k = 0; k < row.length; k += 1) bytes.push((row[k] - prev[k] + 256) & 0xff);
    }
    prev = row.slice();
  });
  return Buffer.from(bytes);
}

// --- 1) fuente clasica Helvetica: acentos y parentesis escapados -------------
const simpleContent = [
  'BT /F1 12 Tf 40 750 Td',
  '(Primera l\\355nea: p\\341rrafo) Tj',
  'T*',
  '(Segunda con \\(parentesis\\) y \\101) Tj',
  'ET',
].join('\n');

const simplePdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  streamBody('', simpleContent),
]);

const simple = pdf.extractPdfText(simplePdf);
check('PDF sencillo: saca el texto', simple.ok, simple.error);
check('PDF sencillo: los acentos salen bien', simple.text.includes('Primera l\u00ednea: p\u00e1rrafo'), simple.text);
check('PDF sencillo: parentesis y codigos octales', simple.text.includes('Segunda con (parentesis) y A'), simple.text);
check('PDF sencillo: cada frase en su linea', simple.text.split('\n').length === 2, JSON.stringify(simple.text));
check('PDF sencillo: una sola pagina', simple.pages === 1, simple.pages);
check('PDF sencillo: sin avisos raros', simple.note === null, simple.note);

// --- 2) contenido comprimido, dos paginas y ajuste de kerning ---------------
const pageOne = 'BT /F1 12 Tf 40 750 Td [(una)-300(palabra)] TJ T* [(otra)-20(palabra)] TJ ET';
const pageTwo = 'BT /F1 12 Tf 40 700 Td (pagina dos) Tj ET';

const flatePdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  streamBody('/Filter /FlateDecode', zlib.deflateSync(latin1(pageOne))),
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  streamBody('/Filter /FlateDecode', zlib.deflateSync(latin1(pageTwo))),
]);

const flate = pdf.extractPdfText(flatePdf);
check('flujo Flate: se descomprime y se lee', flate.ok && flate.text.includes('una palabra'), flate.error || flate.text);
check('flujo Flate: el kerning corto no inventa espacios', flate.text.includes('otrapalabra'), flate.text);
check('dos paginas: se cuentan las dos', flate.pages === 2, flate.pages);
check('dos paginas: la segunda tambien sale', flate.text.includes('pagina dos'), flate.text);
check('dos paginas: marca el folio para la IA', flate.text.includes('[pagina 2]'), flate.text);

// --- 3) fuente Unicode tipo 0 (la que usan Word y Chrome) -------------------
const toUnicodeCMap = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '4 beginbfchar',
  '<0001> <0048>',
  '<0002> <006F>',
  '<0003> <006C>',
  '<0004> <0061>',
  'endbfchar',
  '1 beginbfrange',
  '<0010> <0012> <0041>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
].join('\n');

const unicodeContent = 'BT /F1 20 Tf 40 700 Td <0001000200030004001000110012> Tj ET';

const unicodePdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Calibri /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Calibri /DW 1000 >>',
  streamBody('/Filter /FlateDecode', zlib.deflateSync(latin1(toUnicodeCMap))),
  streamBody('', unicodeContent),
]);

const unicode = pdf.extractPdfText(unicodePdf);
check('fuente Identity-H: traduce los codigos con ToUnicode', unicode.ok && unicode.text.includes('Hola'), unicode.error || unicode.text);
check('fuente Identity-H: el rango bfrange sale como ABC', unicode.text.includes('HolaABC'), unicode.text);

// --- 4) objetos dentro de un flujo (ObjStm), sin tabla xref visible ----------
const innerObjects = [
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
];
const innerIds = [2, 3, 4];
let objStmOffsets = '';
let objStmBody = '';
innerObjects.forEach((text, index) => {
  objStmOffsets += innerIds[index] + ' ' + objStmBody.length + ' ';
  objStmBody += text;
});

const objStmContent = 'BT /F1 12 Tf 30 760 Td (objetos en flujo) Tj T* (leidos sin xref) Tj ET';

let objStmFile = '%PDF-1.5\n';
objStmFile += rawObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
objStmFile += rawObject(5, streamBody('/Filter /FlateDecode', zlib.deflateSync(latin1(objStmContent))));
objStmFile += rawObject(
  6,
  streamBody('/Type /ObjStm /N ' + innerObjects.length + ' /First ' + objStmOffsets.length + ' /Filter /FlateDecode',
    zlib.deflateSync(latin1(objStmOffsets + objStmBody)))
);
objStmFile += '%%EOF\n';

const objStm = pdf.extractPdfText(latin1(objStmFile));
check('ObjStm: lee objetos guardados dentro de un flujo', objStm.ok && objStm.text.includes('objetos en flujo'), objStm.error || objStm.text);
check('ObjStm: respeta el salto de T*', objStm.text.includes('leidos sin xref'), objStm.text);


// --- 5) flujo comprimido con preditor PNG (los CMap de Word/Chrome) ----------
const cmapColumns = 12;
const cmapPadded = toUnicodeCMap + ' '.repeat((cmapColumns - (toUnicodeCMap.length % cmapColumns)) % cmapColumns);
const cmapRows = [];
for (let i = 0; i < cmapPadded.length; i += cmapColumns) {
  const row = [];
  for (let k = 0; k < cmapColumns; k += 1) row.push(cmapPadded.charCodeAt(i + k) || 32);
  cmapRows.push(row);
}

const predictorPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /BBBBBB+Cambria /Encoding /Identity-H /ToUnicode 6 0 R >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /BBBBBB+Cambria >>',
  streamBody('/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ' + cmapColumns + ' >>', zlib.deflateSync(pngUpRows(cmapRows))),
  streamBody('', unicodeContent),
]);

const predictor = pdf.extractPdfText(predictorPdf);
check('preditor PNG: reconstruye el CMap comprimido', predictor.ok && predictor.text.includes('HolaABC'), predictor.error || predictor.text);

// --- 6) /Differences: glifos sueltos con nombre ------------------------------
const diffsContent = 'BT /F1 12 Tf 40 740 Td (AB) Tj ET';
const diffsPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Font /Subtype /TrueType /BaseFont /Calibri /Encoding 5 0 R >>',
  '<< /Type /Encoding /Differences [65 /copyright 66 /emdash] >>',
  streamBody('', diffsContent),
]);
const diffs = pdf.extractPdfText(diffsPdf);
check('/Differences: traduce los nombres de glifo', diffs.ok && diffs.text === '\u00a9\u2014', JSON.stringify(diffs.text));

// --- 7) imagen en linea (BI..EI) y Form XObject ------------------------------
const formContent = 'BT /F1 12 Tf 0 0 Td (dentro del form) Tj ET';
const mixedContent = 'q 1 0 0 1 40 700 cm /Fm Do Q BT /F1 12 Tf 40 600 Td (fuera del form) Tj ET BI /W 2 /H 2 /CS /G ID \u0000\u0001\u0002\u0003 EI BT /F1 12 Tf 40 500 Td (despues de la imagen) Tj ET';

const mixedPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Fm 6 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  'null',
  streamBody('/Type /XObject /Subtype /Form /BBox [0 0 200 40] /Filter /FlateDecode /Resources << /Font << /F1 4 0 R >> >>', zlib.deflateSync(latin1(formContent))),
  streamBody('', mixedContent),
]);

const mixed = pdf.extractPdfText(mixedPdf);
check('Form XObject: se lee lo que dibuja', mixed.ok && mixed.text.includes('dentro del form'), mixed.error || mixed.text);
check('Form XObject: lo de la pagina sigue presente', mixed.text.includes('fuera del form'), mixed.text);
check('BI..EI: la imagen en linea no se cuela como texto', mixed.text.includes('despues de la imagen') && !mixed.text.includes('/CS'), JSON.stringify(mixed.text));


// --- 8) otros filtros y recursos heredados -----------------------------------
const hexContent = 'BT /F1 12 Tf 40 740 Td (hex) Tj ET';
const hexBody = Buffer.from(hexContent, 'latin1').toString('hex').toUpperCase() + '>';
const inheritedPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R >> >> >>',
  '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Filter /ASCIIHexDecode /Length ' + (hexBody.length + 1) + ' >>\nstream\n' + hexBody + ' \nendstream',
]);
const inherited = pdf.extractPdfText(inheritedPdf);
check('ASCIIHexDecode + recursos heredados del nodo Pages', inherited.ok && inherited.text === 'hex', inherited.error || JSON.stringify(inherited.text));

const winansiContent = 'BT /F1 12 Tf 40 740 Td (\\223citado\\224 caf\\351 \\200 y guion\\226largo) Tj ET';
const winansiPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  streamBody('', winansiContent),
]);
const winansi = pdf.extractPdfText(winansiPdf);
check('WinAnsi: comas tipograficas (0x93-0x94)', winansi.ok && winansi.text.includes('\u201ccitado\u201d'), winansi.error || JSON.stringify(winansi.text));
check('WinAnsi: acentos altos (0xE9) y euro (0x80)', winansi.text.includes('caf\u00e9 \u20ac'), JSON.stringify(winansi.text));
check('WinAnsi: guion largo (0x96)', winansi.text.includes('guion\u2013largo'), JSON.stringify(winansi.text));

// --- 9) kerning, parrafos y saltos de pagina ---------------------------------
const kernContent = [
  'BT /F1 12 Tf 40 750 Td (separo) Tj',
  '1 0 0 1 40 600 Tm',
  '(parrafo nuevo) Tj',
  'ET',
].join('\n');
const kerned = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  streamBody('', kernContent),
]));
check('Tm con salto grande de Y abre parrafo', kerned.ok && kerned.text === 'separo\n\nparrafo nuevo', kerned.error || JSON.stringify(kerned.text));

const tight = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  streamBody('', 'BT /F1 10 Tf 40 700 Td [(a)-1200(b)] TJ ET'),
]));
check('kerning muy negativo mete un espacio', tight.ok && tight.text === 'a b', tight.error || JSON.stringify(tight.text));

// --- 10) lo que no se puede: avisos honestos ---------------------------------
const locked = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  streamBody('', 'BT /F1 12 Tf 40 700 Td (texto cifrado) Tj ET'),
  '<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O (abcdefghijklmnopqrstuvwxyz123456) /U (abcdefghijklmnopqrstuvwxyz123456) >>',
], ' /Encrypt 6 0 R'));
check('PDF cifrado: lo dice en vez de dar basura', !locked.ok && locked.encrypted === true, JSON.stringify({ ok: locked.ok, encrypted: locked.encrypted, error: locked.error }));
check('PDF cifrado: el aviso habla de contrasena', /contrasena/i.test(locked.error || ''), locked.error);

const scannedPdf = classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length 4 >>\nstream\n\u0001\u0002\u0003\u0004\nendstream',
  streamBody('', 'q 200 0 0 200 40 500 cm /Im1 Do Q'),
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 7 0 R >> >> /Contents 8 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  streamBody('', 'BT /F1 12 Tf 40 700 Td (esta pagina si tiene texto) Tj ET'),
]);
const scanned = pdf.extractPdfText(scannedPdf);
check('foto escaneada: no inventa texto', scanned.ok && !scanned.text.includes('pagina 1'), JSON.stringify(scanned.text));
check('foto escaneada: la pagina con texto si sale', scanned.text.includes('esta pagina si tiene texto'), scanned.text);
check('PDF vacio de texto: avisa del escaneado', /escaneada|plano/.test(pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
  streamBody('', 'q Q'),
])).note || ''), pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
  streamBody('', 'q Q'),
])).note);

const broken = pdf.extractPdfText(latin1('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\nxref\n0 2\n0000000000 65535 f \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n7\n%%EOF\n'));
check('PDF truncado: error claro y sin petar', !broken.ok && /paginas/.test(broken.error || ''), broken.error);

const brokenStream = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Filter /FlateDecode /Length 12 >>\nstream\nno es deflate\nendstream',
]));
check('flujo corrupto: lo avisa sin petar', brokenStream.ok && /corrupto/.test(brokenStream.note || ''), JSON.stringify({ ok: brokenStream.ok, note: brokenStream.note }));

const capped = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  streamBody('', 'BT /F1 12 Tf 40 700 Td (' + 'x'.repeat(4000) + ') Tj ET'),
]), { maxChars: 500 });
check('tope de caracteres: corta y lo dice', capped.ok && capped.chars <= 500 && capped.truncated === true && /cortado/.test(capped.note || ''), JSON.stringify({ chars: capped.chars, truncated: capped.truncated, note: capped.note }));

check('una foto PNG no pasa por PDF', pdf.looksLikePdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === false);
check('el PDF se reconoce por su cabecera', pdf.looksLikePdf(latin1('%PDF-1.4\n%bad\r\n')) === true);

// --- 11) Chrome al imprimir: un glifo por Td, con las anchuras de la fuente ---
const helvWidths = (() => {
  const table = { 32: 278, 73: 278, 97: 556, 100: 556, 101: 556, 102: 278, 104: 556, 105: 222, 108: 222, 109: 833, 110: 556, 111: 556, 114: 333, 115: 556 };
  const widths = [];
  for (let code = 32; code <= 126; code += 1) widths.push(table[code] === undefined ? 556 : table[code]);
  return widths;
})();
const widthFont = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /Widths [' + helvWidths.join(' ') + '] >>';
const withWidths = (content) => pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  widthFont,
  streamBody('', content),
]));

// Chrome escribe cada glifo con su propio Td y el avance real de la fuente.
const glyphByGlyph = withWidths([
  'BT /F1 20 Tf 40 700 Td',
  '(I) Tj 5.56 0 Td',
  '(n) Tj 11.12 0 Td',
  '(f) Tj 5.56 0 Td',
  '(o) Tj 11.12 0 Td',
  '(r) Tj 6.66 0 Td',
  '(m) Tj 16.66 0 Td',
  '(e) Tj 11.12 0 Td',
  '( ) Tj 5.56 0 Td',
  '(d) Tj 11.12 0 Td',
  '(e) Tj',
  'ET',
].join('\n'));
check('Chrome glifo a glifo: no parte Informe en I n f o r m e', glyphByGlyph.ok && glyphByGlyph.text === 'Informe de', glyphByGlyph.error || JSON.stringify(glyphByGlyph.text));

const exactAdvance = withWidths('BT /F1 20 Tf 40 700 Td (hol) Tj 26.68 0 Td (a) Tj ET');
check('avance exacto de la fuente: no inventa un espacio dentro de la palabra', exactAdvance.ok && exactAdvance.text === 'hola', exactAdvance.error || JSON.stringify(exactAdvance.text));

const realColumnGap = withWidths('BT /F1 20 Tf 40 700 Td (hola) Tj 200 0 Td (adios) Tj ET');
check('hueco de verdad: ahi si va el espacio entre columnas', realColumnGap.ok && realColumnGap.text === 'hola adios', realColumnGap.error || JSON.stringify(realColumnGap.text));

const kernedWithWidths = withWidths('BT /F1 20 Tf 40 700 Td [(I)-200(n)] TJ ET');
check('kerning con anchuras: no corta In', kernedWithWidths.ok && kernedWithWidths.text === 'In', kernedWithWidths.error || JSON.stringify(kernedWithWidths.text));

const bigKernWithWidths = withWidths('BT /F1 20 Tf 40 700 Td [(I)-600(n)] TJ ET');
check('kerning enorme con anchuras: ahi si es un espacio', bigKernWithWidths.ok && bigKernWithWidths.text === 'I n', bigKernWithWidths.error || JSON.stringify(bigKernWithWidths.text));

const cidWidths = pdf.extractPdfText(classicPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Calibri /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Calibri /DW 1000 /W [ 1[600 500 500 400] 16[650 650 650] ] >>',
  streamBody('/Filter /FlateDecode', zlib.deflateSync(latin1(toUnicodeCMap))),
  streamBody('', 'BT /F1 20 Tf 40 700 Td <0001000200030004> Tj 40 0 Td <001000110012> Tj ET'),
]));
check('Type0 con /W: la anchura evita el espacio falso entre Hol a y ABC', cidWidths.ok && cidWidths.text.includes('HolaABC'), cidWidths.error || JSON.stringify(cidWidths.text));

console.log('\n' + checks + ' comprobaciones, ' + failures + ' fallos.');
process.exitCode = failures === 0 ? 0 : 1;


