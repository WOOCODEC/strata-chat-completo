'use strict';

/**
 * tools/voice-check.js - Comprueba la voz de lectura sin abrir el navegador.
 *
 * Las funciones puras de la voz (velocidad, prosodia, limpieza del texto,
 * puntuacion de voces y troceado) viven en src/public/script.js, que es codigo
 * de navegador. Aqui se extraen con regex y se ejecutan sueltas en Node, igual
 * que hace tools/copy-check.js con plainForCopy.
 *
 * Uso: node tools/voice-check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'public', 'script.js'), 'utf8').replace(/\r/g, '');
const html = fs.readFileSync(path.join(ROOT, 'src', 'public', 'index.html'), 'utf8').replace(/\r/g, '');
const css = fs.readFileSync(path.join(ROOT, 'src', 'public', 'style.css'), 'utf8').replace(/\r/g, '');

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

/** Saca una funcion de primer nivel del codigo de navegador. */
function grab(name) {
  const found = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}').exec(source);
  check('script.js define ' + name, Boolean(found), found ? 'extraida' : 'no aparece');
  return found ? found[0] : '';
}

/** La funcion extraida se ejecuta con sus dependencias inyectadas como argumentos. */
function build(name, deps) {
  const body = grab(name);
  if (!body) return null;
  const names = Object.keys(deps || {});
  try {
    return new Function(...names, 'return ' + body + ';')(...names.map((key) => deps[key]));
  } catch (error) {
    check('se puede ejecutar ' + name, false, String(error.message));
    return null;
  }
}

function constantNumber(name) {
  const found = new RegExp('const ' + name + ' = (\\d+);').exec(source);
  check('script.js declara ' + name, Boolean(found), found ? found[1] : 'no aparece');
  return found ? Number(found[1]) : NaN;
}

console.log('\n- Limites de velocidad (100% - 200%)');
const RATE_MIN = constantNumber('RATE_MIN');
const RATE_MAX = constantNumber('RATE_MAX');
const RATE_DEFAULT = constantNumber('RATE_DEFAULT');
check('el minimo es 100%', RATE_MIN === 100, RATE_MIN);
check('el maximo es 200%', RATE_MAX === 200, RATE_MAX);
check('por defecto es la velocidad normal', RATE_DEFAULT === 100, RATE_DEFAULT);

const clampVoiceRate = new Function('RATE_MIN', 'RATE_MAX', 'RATE_DEFAULT', 'return ' + grab('clampVoiceRate') + ';')(
  RATE_MIN,
  RATE_MAX,
  RATE_DEFAULT
);
check('150 se queda tal cual', clampVoiceRate('150') === 150, clampVoiceRate('150'));
check('por debajo del minimo sube a 100', clampVoiceRate(40) === 100, clampVoiceRate(40));
check('por encima del maximo baja a 200', clampVoiceRate(750) === 200, clampVoiceRate(750));
check('el maximo justo se respeta', clampVoiceRate(200) === 200, clampVoiceRate(200));
check('el minimo justo se respeta', clampVoiceRate(100) === 100, clampVoiceRate(100));
check('vacio o loco vuelve a 100', clampVoiceRate('') === 100 && clampVoiceRate(undefined) === 100 && clampVoiceRate('nope') === 100);
check('redondea los decimales', clampVoiceRate(144.6) === 145, clampVoiceRate(144.6));
check('los negativos no cuelan', clampVoiceRate(-20) === 100, clampVoiceRate(-20));

const voiceRateFactor = new Function('voiceRateSetting', 'return ' + grab('voiceRateFactor') + ';')(() => 145);
check('145% se convierte en 1.45x', voiceRateFactor() === 1.45, voiceRateFactor());
const factorMax = new Function('voiceRateSetting', 'return ' + grab('voiceRateFactor') + ';')(() => RATE_MAX)();
check('el doble de velocidad es 2', factorMax === 2, factorMax);

const formatVoiceRate = build('formatVoiceRate', []);
check('se ensena como 145% (1.45x)', formatVoiceRate(145) === '145% (1.45x)', formatVoiceRate(145));
check('la normal se ensena como 100% (1.00x)', formatVoiceRate(100) === '100% (1.00x)', formatVoiceRate(100));

console.log('\n- Persistencia y controles de la interfaz');
check('la velocidad se guarda con su clave', source.includes("const VOICE_RATE_KEY = 'strata.voice.rate';"));
check('la voz elegida se guarda con su clave', source.includes("const VOICE_KEY = 'strata.voice.name';"));
check(
  'las voces del navegador necesitan permiso explicito',
  source.includes("const VOICE_CLOUD_KEY = 'strata.voice.online';") && source.includes("localSetting(VOICE_CLOUD_KEY, '0') === '1'")
);
check('el slider va de 100 a 200 en pasos de 5', /id="voice-rate"[\s\S]*?min="100"[\s\S]*?max="200"[\s\S]*?step="5"/.test(html), 'min/max/step en el input');
check('el slider arranca en la velocidad normal', /id="voice-rate"[\s\S]*?value="100"/.test(html));
check('hay etiqueta que muestra la velocidad', html.includes('id="voice-rate-value"'));
check('hay desplegable de voces y casilla de voces del navegador', html.includes('id="voice-pick"') && html.includes('id="voice-cloud"'));
check('script.js escucha los tres controles', source.includes('dom.voicePick.addEventListener') && source.includes('dom.voiceRate.addEventListener') && source.includes('dom.voiceCloud.addEventListener'));
check('los ajustes se recuperan al abrir la interfaz', /async function init\(\) \{[\s\S]*?restoreVoiceSettings\(\);[\s\S]*?refreshVoiceRow\(\);/.test(source));
check('cada trozo lleva la velocidad guardada', source.includes('line.rate = voiceRateFactor();'));
check('el CSS pinta los controles de voz', css.includes('.voice-select') && css.includes('.voice-rate') && css.includes('.voice-check') && css.includes('.voice-hint'));

console.log('\n- Voces: elegir la que suena natural');
const isCloudVoice = build('isCloudVoice', {});
const speechVoiceScore = build('speechVoiceScore', {});
const voiceChoiceKey = build('voiceChoiceKey', {});
check('una voz declarada como no local es de internet', isCloudVoice({ name: 'Microsoft Ana - es-ES', lang: 'es-ES', localService: false }) === true);
check('una "Natural" instalada en el PC no se descarta', isCloudVoice({ name: 'Microsoft Ana Natural - es-ES', lang: 'es-ES', localService: true }) === false);
check('una voz con "Online" sigue siendo de internet aunque mienta', isCloudVoice({ name: 'Microsoft David Online - en-US', lang: 'en-US', localService: true }) === true);
check('las voces de Google van por internet', isCloudVoice({ name: 'Google espanol', lang: 'es-US', localService: true }) === true);
check(
  'si el navegador no dice nada, se mira el nombre',
  isCloudVoice({ name: 'Microsoft Neural Voice' }) === true && isCloudVoice({ name: 'Microsoft Helena' }) === false
);
check(
  'la voz natural gana a la clasica',
  speechVoiceScore({ name: 'Microsoft Ana Natural', lang: 'es-ES', localService: true }, 'es') >
    speechVoiceScore({ name: 'Microsoft Helena', lang: 'es-ES', localService: true }, 'es')
);
check(
  'una en espanol supera a una natural en otro idioma',
  speechVoiceScore({ name: 'Microsoft Ana Natural', lang: 'es-ES', localService: true }, 'es') >
    speechVoiceScore({ name: 'Microsoft Natural Voice', lang: 'zh-CN', localService: true }, 'es')
);
check(
  'autodenominarse robot resta puntos',
  speechVoiceScore({ name: 'Microsoft Compact Robot', lang: 'es-ES', localService: true }, 'es') <
    speechVoiceScore({ name: 'Microsoft Helena', lang: 'es-ES', localService: true }, 'es')
);
check(
  'ser la voz por defecto del sistema suma poco',
  speechVoiceScore({ name: 'Microsoft Helena', lang: 'es-ES', localService: true, default: true }, 'es') >
    speechVoiceScore({ name: 'Microsoft Helena', lang: 'es-ES', localService: true }, 'es')
);
check('la clave de voz es nombre e idioma', voiceChoiceKey({ name: 'Ana', lang: 'es-ES' }) === 'Ana|es-ES');
check('la eleccion manual se respeta', source.includes('voices.find((voice) => voiceChoiceKey(voice) === saved)'));
check('sin permiso, solo se usan voces locales', source.includes('voices.filter((voice) => !isCloudVoice(voice))'));
check('la eleccion se guarda al cambiar el desplegable', source.includes('function setVoiceChoice(key)') && source.includes('saveLocalSetting(VOICE_KEY, key || \'\');'));
const ana = { name: 'Ana', lang: 'es-ES', localService: true };
const helena = { name: 'Helena', lang: 'es-ES', localService: true };
const voiceSignatureOf = build('voiceSignatureOf', { voiceChoiceKey, isCloudVoice });
check('el sello de voces es estable con la misma lista', voiceSignatureOf([ana], false) === voiceSignatureOf([ana], false));
check('el sello cambia al permitir las voces del navegador', voiceSignatureOf([ana], false) !== voiceSignatureOf([ana], true));
check('el sello cambia si aparece una voz nueva', voiceSignatureOf([ana], false) !== voiceSignatureOf([ana, helena], false));
check('el sello distingue local de la misma voz en la nube', voiceSignatureOf([ana], true) !== voiceSignatureOf([{ name: 'Ana', lang: 'es-ES', localService: false }], true));
check('el desplegable no se reconstruye si el sello no cambia', source.includes('if (signature === voiceListSignature && select.options.length) return;'));

console.log('\n- Prosodia y troceado (que no suene a robot)');
const prosodyFor = build('prosodyFor', {});
check('una pregunta sube el tono', prosodyFor('Esto es una pregunta?', 0, 1).pitch > 1, prosodyFor('Esto es una pregunta?', 0, 1).pitch);
check('una exclamacion sube el tono', prosodyFor('Mira esto!', 0, 1).pitch > 1, prosodyFor('Mira esto!', 0, 1).pitch);
check('el trozo que continua baja el tono', prosodyFor('y sigue con lo mismo,', 0, 1).pitch < 1, prosodyFor('y sigue con lo mismo,', 0, 1).pitch);
check('el primer trozo arranca algo mas arriba', prosodyFor('uno', 0, 3).pitch > prosodyFor('uno', 1, 3).pitch, [prosodyFor('uno', 0, 3).pitch, prosodyFor('uno', 1, 3).pitch]);
check('el ultimo trozo cierra mas abajo', prosodyFor('tres', 2, 3).pitch < prosodyFor('dos', 1, 3).pitch);
check('todo mayusculas baja el tono (grita menos)', prosodyFor('ESTO GRITA', 0, 1).pitch < prosodyFor('esto no grita', 0, 1).pitch);
check(
  'el tono nunca se sale de 0.8 a 1.2',
  [prosodyFor('?', 0, 1), prosodyFor('MAYUSCULAS RARAS!!', 0, 3), prosodyFor('a,b,c,d,e,f,g,h,i,j', 0, 1)].every((p) => p.pitch >= 0.8 && p.pitch <= 1.2)
);
check('texto vacio no rompe', prosodyFor('', 0, 0).pitch >= 0.8 && prosodyFor('', 0, 0).pitch <= 1.2);

const speechChunks = build('speechChunks', {});
const long = 'Esta frase es bastante larga y explica cosas. '.repeat(30);
const parts = speechChunks(long);
check('los trozos no pasan de 320 caracteres', parts.every((part) => part.length <= 320), Math.max(...parts.map((part) => part.length)));
check('se corta en punto y seguido', parts.slice(0, -1).every((part) => /[.?!]$/.test(part)), parts.slice(0, 3).map((part) => part.slice(-10)));
check('no se pierde ni se duplica texto', parts.join(' ') === long.trim().replace(/\s+/g, ' '), parts.length + ' trozos');
check('un texto corto es un solo trozo', speechChunks('hola que tal').length === 1, speechChunks('hola que tal'));
check('sin espacios raros al principio ni al final', parts.every((part) => part === part.trim() && part.indexOf('  ') === -1));
check('un limite raro no rompe', speechChunks(long, 0).length === parts.length, speechChunks(long, 0).length);
const commaOnly = speechChunks('palabra, '.repeat(60) + 'final');
check('sin puntos se corta en coma y no pasa de 320', commaOnly.every((part) => part.length <= 320) && commaOnly.slice(0, -1).every((part) => /[,;:]$/.test(part)), commaOnly.slice(0, 2).map((part) => part.slice(-8)));
check('una palabra enorme sin espacios se parte igualmente', speechChunks('x'.repeat(700)).every((part) => part.length <= 320), speechChunks('x'.repeat(700)).length);

const plainForSpeech = build('plainForSpeech', {});
check('fuera la negrita y los titulos', plainForSpeech('## **Plan** de trabajo') === 'Plan de trabajo', plainForSpeech('## **Plan** de trabajo'));
check('el codigo en bloque se anuncia', plainForSpeech('```js\nconst a = 1;\n```').indexOf('aqui habia codigo') !== -1, plainForSpeech('```js\nconst a = 1;\n```'));
check('los enlaces se quedan con su texto', plainForSpeech('mira [la doc](https://example.com)') === 'mira la doc', plainForSpeech('mira [la doc](https://example.com)'));
check('fuera los emojis', plainForSpeech('muy bien \u{1F44D} y \u2705 listo') === 'muy bien y listo', plainForSpeech('muy bien \u{1F44D} y \u2705 listo'));
check('fuera las flechas y los cuadros', plainForSpeech('siguiente \u2192 paso \u25A1') === 'siguiente paso', plainForSpeech('siguiente \u2192 paso \u25A1'));
check('la raya se vuelve pausa', plainForSpeech('uno \u2014 dos') === 'uno , dos', plainForSpeech('uno \u2014 dos'));
check('los puntos suspensivos se vuelven pausa', plainForSpeech('y entonces\u2026 nada') === 'y entonces, nada', plainForSpeech('y entonces\u2026 nada'));
check('sin saltos de linea sueltos', plainForSpeech('uno\n\ndos') === 'uno dos', plainForSpeech('uno\n\ndos'));
check('null o vacio no rompen', plainForSpeech(null) === '' && plainForSpeech('   ') === '');

console.log('\n- Leer en voz alta: cola trozo a trozo');
check('los trozos se encadenan al terminar cada uno', source.includes('function speakQueued()') && source.includes('speech.queue.shift()'));
check('se limpian la cola y el reloj al parar', source.includes('clearSpeechQueue();') && source.includes('function clearSpeechQueue()'));
check('hay reloj que evita el corte de Chrome', source.includes('startSpeechKeepAlive') && source.includes('window.speechSynthesis.resume();'));
check('el tono sale de la prosodia por trozo', source.includes('line.pitch = prosodyFor('));
check('la voz se aplica justo antes de sonar', source.includes('function applyVoiceTo(line, index, total)') && source.includes('const voice = speech.voice || pickSpeechVoice();'));
check('el boton dice Parar mientras suena', source.includes("button.textContent = 'Parar la lectura';"));
check('Esc sigue parando la lectura', source.includes("if (event.key === 'Escape' && speechBusy()) stopSpeech();"));

console.log('\n- Leer en voz alta en un navegador simulado (cola, velocidad en caliente y voz elegida)');
const REQUIRED = [
  'speechSupported', 'speechVoices', 'isCloudVoice', 'voiceChoiceKey', 'speechVoiceScore', 'speechLangHint',
  'allowCloudVoices', 'pickSpeechVoice', 'plainForSpeech', 'speechChunks', 'prosodyFor', 'clampVoiceRate',
  'voiceRateSetting', 'voiceRateFactor', 'applyVoiceTo', 'speakQueued', 'clearSpeechQueue', 'startSpeechKeepAlive',
  'stopSpeech', 'speechBusy', 'speakAnswer',
];
const sandboxBody = REQUIRED.map((name) => grab(name)).join('\n\n');

function fakeButton() {
  const classes = [];
  return {
    textContent: 'Leer en voz alta',
    classList: {
      add(name) { classes.push(name); },
      remove(name) { const at = classes.indexOf(name); if (at !== -1) classes.splice(at, 1); },
      has(name) { return classes.indexOf(name) !== -1; },
    },
  };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitUntil(wanted, timeoutMs) {
  const until = Date.now() + (timeoutMs || 1500);
  return new Promise((resolve) => {
    const tick = () => {
      if (wanted()) return resolve(true);
      if (Date.now() > until) return resolve(false);
      setTimeout(tick, 5);
    };
    tick();
  });
}

(async () => {
  const store = {};
  const localSetting = (key, fallback) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback);
  const saveLocalSetting = (key, value) => { store[key] = String(value); };

  const voices = [
    { name: 'Microsoft Helena Local', lang: 'es-ES', localService: true },
    { name: 'Microsoft Ana Natural', lang: 'es-ES', localService: true },
    { name: 'Google es Online', lang: 'es-ES', localService: false },
  ];
  const spoken = [];
  let pending = [];
  let resumes = 0;
  let cancels = 0;

  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.voice = null;
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.onend = null;
      this.onerror = null;
    }
  }

  const synthesis = {
    speaking: false,
    pending: false,
    getVoices: () => voices,
    cancel() { cancels += 1; pending = []; },
    resume() { resumes += 1; },
    addEventListener() {},
    speak(utterance) {
      spoken.push({
        text: utterance.text,
        rate: utterance.rate,
        pitch: utterance.pitch,
        voice: utterance.voice ? utterance.voice.name : '',
        lang: utterance.lang,
      });
      pending.push(utterance);
      // Cada trozo tarda lo que tarda una frase de verdad: da tiempo a cambiar
      // voz y velocidad a media lectura y ver si los trozos siguientes obedecen.
      setTimeout(() => {
        const next = pending.shift();
        if (!next) return;
        synthesis.speaking = true;
        if (typeof next.onend === 'function') next.onend();
        synthesis.speaking = false;
      }, 60);
    },
  };

  const fakeWindow = {
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: FakeUtterance,
    setTimeout,
    setInterval,
    clearInterval,
  };
  const fakeDocument = { documentElement: { lang: 'es' } };
  const sandboxSpeech = { voice: null, button: null, queue: [], timer: null };

  const factory = new Function(
    'speech', 'window', 'document', 'localSetting', 'saveLocalSetting', 'setText',
    'RATE_MIN', 'RATE_MAX', 'RATE_DEFAULT', 'VOICE_KEY', 'VOICE_RATE_KEY', 'VOICE_CLOUD_KEY',
    sandboxBody + '\nreturn { speakAnswer, stopSpeech, speechBusy, pickSpeechVoice, speech };'
  );
  const sandbox = factory(
    sandboxSpeech, fakeWindow, fakeDocument, localSetting, saveLocalSetting, () => {},
    RATE_MIN, RATE_MAX, RATE_DEFAULT, 'strata.voice.name', 'strata.voice.rate', 'strata.voice.online'
  );

  const answer = 'Primera frase bastante explicativa con varias palabras y mas texto. '.repeat(10) + 'Y aqui va la pregunta final?';
  const plain = plainForSpeech(answer);
  const expected = speechChunks(plain);
  store['strata.voice.rate'] = '160';

  check('se elige la voz natural local, no la clasica ni la de internet', sandbox.pickSpeechVoice().name === 'Microsoft Ana Natural', sandbox.pickSpeechVoice().name);
  const button = fakeButton();
  sandbox.speakAnswer(answer, button);
  check('el boton pasa a Parar la lectura', button.textContent === 'Parar la lectura' && button.classList.has('is-reading'), button.textContent);
  check('speechBusy es verdadero mientras queda cola', sandbox.speechBusy() === true);
  check('la cola trae tantos trozos como recorta speechChunks', sandbox.speech.queue.length + 1 >= expected.length, sandbox.speech.queue.length + 1 + ' de ' + expected.length);
  const firstOk = await waitUntil(() => spoken.length >= 1);
  check('suena enseguida el primer trozo', firstOk, spoken.length ? spoken[0].text.slice(0, 22) + '...' : 'nada de voz');
  check('el primer trozo sale al 160% (1.6x)', Boolean(spoken[0]) && spoken[0].rate === 1.6, spoken[0] && spoken[0].rate);
  check('el primer trozo lleva la voz natural con su idioma', Boolean(spoken[0]) && spoken[0].voice === 'Microsoft Ana Natural' && spoken[0].lang === 'es-ES', spoken[0] && [spoken[0].voice, spoken[0].lang]);

  // Voz y velocidad se cambian a media lectura: lo que queda debe obedecer.
  store['strata.voice.rate'] = '200';
  sandbox.speech.voice = voices[0];
  const restOk = await waitUntil(() => spoken.length >= expected.length);
  check('los trozos se encadenan solos hasta acabar la respuesta', restOk, spoken.length + ' de ' + expected.length);
  check('la velocidad nueva se nota en los trozos que quedaban', spoken[1] && spoken[1].rate === 2, spoken[1] && spoken[1].rate);
  check('la voz nueva se nota en los trozos que quedaban', spoken[1] && spoken[1].voice === 'Microsoft Helena Local', spoken[1] && spoken[1].voice);
  check('ningun trozo usa la voz que saca el texto de casa', spoken.every((line) => line.voice.indexOf('Online') === -1), spoken.map((line) => line.voice));
  check('lo leido es exactamente lo que recorta speechChunks', spoken.map((line) => line.text).join(' ') === expected.join(' '), spoken.map((line) => line.text.length));
  check('el tono no es plano: cambia segun el trozo', spoken.every((line, index) => line.pitch === prosodyFor(expected[index], index, expected.length).pitch) && spoken.some((line) => line.pitch !== 1), spoken.map((line) => line.pitch));
  check('la respuesta larga se lee en trozos de menos de 320', expected.every((part) => part.length <= 320), expected.map((part) => part.length));
  check('al terminar el boton vuelve a Leer en voz alta', await waitUntil(() => button.textContent === 'Leer en voz alta'), button.textContent);
  check('al terminar ya no hay cola ni speechBusy', sandbox.speechBusy() === false && sandbox.speech.queue.length === 0);

  // Parar en seco a media lectura.
  const secondButton = fakeButton();
  sandbox.speakAnswer(answer, secondButton);
  await waitUntil(() => spoken.length >= expected.length + 1);
  const beforeStop = spoken.length;
  sandbox.stopSpeech();
  check('al parar se cancela la sintesis del navegador', cancels > 0, 'cancel() ' + cancels + ' veces');
  check('al parar se vacia la cola y se suelta el boton', sandbox.speech.queue.length === 0 && sandbox.speech.button === null && secondButton.textContent === 'Leer en voz alta' && !secondButton.classList.has('is-reading'));
  await waitMs(220);
  check('al parar no siguen saliendo trozos', spoken.length === beforeStop, 'trozos nuevos despues de parar: ' + (spoken.length - beforeStop));
  check('el reloj anti-corte de Chrome se limpia al parar', sandbox.speech.timer === null, 'resume() ' + resumes + ' veces');
  check('un segundo click en el mismo boton para la lectura', (() => {
    const third = fakeButton();
    sandbox.speakAnswer(answer, third);
    sandbox.speakAnswer(answer, third);
    const quiet = third.textContent === 'Leer en voz alta' && sandbox.speech.button === null;
    sandbox.stopSpeech();
    return quiet;
  })());

  console.log('\n' + checks + ' comprobaciones, ' + failures + ' fallos.');
  process.exitCode = failures === 0 ? 0 : 1;
})();
