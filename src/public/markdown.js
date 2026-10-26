'use strict';

/**
 * markdown.js - Markdown minimo y SEGURO para pintar las respuestas.
 *
 * Primero escapa todo el HTML (asi un "<script>" o un "<img onerror=...>" del
 * modelo se ve como texto y no se ejecuta) y despues aplica un conjunto pequeno
 * de reglas: negrita, cursiva, tachado, codigo en linea y en bloque, titulos,
 * listas (tambien de tareas), citas, reglas, tablas y enlaces.
 *
 * No usa la red ni librerias: la CSP de la app bloquea cualquier recurso
 * externo, asi que el renderizado tiene que ser propio.
 */
(function (target) {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
  }

  // Enlaces solo a http/https, correo o rutas propias: nada de javascript:.
  const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

  function linkHtml(label, rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!SAFE_URL.test(url) || /\s/.test(url)) return label;
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + label + '</a>';
  }

  function inlineFormat(text) {
    let out = text;
    out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*+([^*\n]+?)\*\*+/g, '<strong>$1</strong>');
    out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^\w_])_([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => linkHtml('imagen: ' + (alt || url), url));
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => linkHtml(label, url));
    out = out.replace(/(^|[\s(])((?:https?:\/\/|mailto:)[^\s<>"')]+[^\s<>"').,;:!?])/g, (m, before, url) => before + linkHtml(url, url));
    return out.replace(/\n/g, '<br>');
  }

  function splitRow(row) {
    let line = String(row || '').trim();
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|')) line = line.slice(0, -1);
    return line.split('|').map((cell) => cell.trim());
  }

  function isTableSeparator(line) {
    const value = String(line === null || line === undefined ? '' : line).trim();
    return value.indexOf('|') !== -1 && /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(value);
  }

  function renderMarkdown(text) {
    const raw = String(text === null || text === undefined ? '' : text)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Los trozos de codigo se guardan aparte para que las reglas de enfasis no
    // los toquen, y se vuelven a colocar al final, ya escapados.
    const stored = [];
    const hold = (html) => {
      stored.push(html);
      return '\u0001' + (stored.length - 1) + '\u0001';
    };
    // Cada bloque de codigo lleva su cabecera con el lenguaje y su boton de
    // copiar. El boton no usa onclick (la CSP lo bloquearia): lo atiende
    // script.js con un unico escucha delegado sobre la conversacion.
    const codeBlock = (code, lang) => {
      const label = String(lang || '').trim().slice(0, 24);
      const body = escapeHtml(String(code).replace(/\s+$/, ''));
      return hold(
        '<div class="md-codebox">' +
          '<div class="md-codebar">' +
            '<span class="md-codelang">' + (label ? escapeHtml(label) : 'codigo') + '</span>' +
            '<button type="button" class="btn-copy btn-copy-block" data-copy-block' +
            ' title="Copiar solo este bloque de codigo">Copiar bloque</button>' +
          '</div>' +
          '<pre class="md-code"><code>' + body + '</code></pre>' +
        '</div>'
      );
    };

    let working = raw
      .replace(/```[^\S\n]*([\w+-]*)[^\S\n]*\n([\s\S]*?)```/g, (m, lang, code) => codeBlock(code, lang))
      .replace(/```[^\S\n]*([\w+-]*)[^\S\n]*\n([\s\S]*)$/g, (m, lang, code) => codeBlock(code, lang))
      .replace(/`([^`\n]+)`/g, (m, code) => hold('<code class="md-inline">' + escapeHtml(code) + '</code>'));

    working = escapeHtml(working);

    const lines = working.split('\n');
    const blocks = [];
    const paragraph = [];
    let index = 0;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      blocks.push('<p>' + inlineFormat(paragraph.join('\n')) + '</p>');
      paragraph.length = 0;
    };

    const isBullet = (line) => /^[-*+]\s+\S/.test(line);
    const isNumbered = (line) => /^\d{1,3}[.)]\s+\S/.test(line);

    while (index < lines.length) {
      const trimmed = lines[index].trim();

      if (!trimmed) {
        flushParagraph();
        index += 1;
        continue;
      }

      if (/^\u0001\d+\u0001$/.test(trimmed)) {
        flushParagraph();
        blocks.push(trimmed);
        index += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        blocks.push('<h' + level + ' class="md-h">' + inlineFormat(heading[2]) + '</h' + level + '>');
        index += 1;
        continue;
      }

      if (/^[-*_]{3,}$/.test(trimmed.replace(/\s+/g, ''))) {
        flushParagraph();
        blocks.push('<hr class="md-hr">');
        index += 1;
        continue;
      }

      if (trimmed.startsWith('&gt;')) {
        flushParagraph();
        const quote = [];
        while (index < lines.length && lines[index].trim().startsWith('&gt;')) {
          quote.push(lines[index].trim().replace(/^&gt;\s?/, ''));
          index += 1;
        }
        blocks.push('<blockquote class="md-quote">' + inlineFormat(quote.join('\n')) + '</blockquote>');
        continue;
      }

      if (isBullet(trimmed) || isNumbered(trimmed)) {
        flushParagraph();
        const ordered = isNumbered(trimmed);
        const items = [];
        while (index < lines.length) {
          const current = lines[index].trim();
          if (!current) {
            const next = (lines[index + 1] || '').trim();
            if (isBullet(next) || isNumbered(next)) {
              index += 1;
              continue;
            }
            break;
          }
          if (isBullet(current) || isNumbered(current)) {
            items.push(current.replace(/^([-*+]|\d{1,3}[.)])\s+/, ''));
            index += 1;
            continue;
          }
          if (items.length && /^\s{2,}\S/.test(lines[index])) {
            items[items.length - 1] += '\n' + current;
            index += 1;
            continue;
          }
          break;
        }
        const rendered = items.map((item) => {
          const task = /^\[([ xX])\]\s+/.exec(item);
          if (task) {
            const mark = task[1] === ' ' ? '\u2610' : '\u2611';
            return '<li class="md-task">' + mark + ' ' + inlineFormat(item.slice(task[0].length)) + '</li>';
          }
          return '<li>' + inlineFormat(item) + '</li>';
        });
        blocks.push((ordered ? '<ol class="md-list">' : '<ul class="md-list">') + rendered.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }

      if (trimmed.indexOf('|') !== -1 && isTableSeparator(lines[index + 1])) {
        flushParagraph();
        const header = splitRow(trimmed);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].indexOf('|') !== -1 && lines[index].trim()) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        const head = '<thead><tr>' + header.map((cell) => '<th>' + inlineFormat(cell) + '</th>').join('') + '</tr></thead>';
        const body = rows
          .map((row) => '<tr>' + row.map((cell) => '<td>' + inlineFormat(cell) + '</td>').join('') + '</tr>')
          .join('');
        blocks.push('<table class="md-table">' + head + (body ? '<tbody>' + body + '</tbody>' : '') + '</table>');
        continue;
      }

      paragraph.push(trimmed);
      index += 1;
    }
    flushParagraph();

    return blocks.join('\n').replace(/\u0001(\d+)\u0001/g, (m, position) => stored[Number(position)] || '');
  }

  target.renderMarkdown = renderMarkdown;
  target.escapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : module.exports);
