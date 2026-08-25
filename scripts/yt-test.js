/**
 * Diagnóstico de extracción de YouTube.
 * Prueba distintos "player clients" de yt-dlp para encontrar uno que pase el
 * bloqueo "Sign in to confirm you're not a bot" desde esta IP.
 *
 * Uso:  node scripts/yt-test.js ["consulta"]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('../src/core/config');
const { ytDlpJson } = require('../src/media/ytdlp');

const QUERY = process.argv[2] || 'even flow';

function ytVersion() {
  return new Promise((resolve) => {
    const child = spawn(config.YTDLP_BIN, ['--version']);
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => resolve(out.trim() || '(desconocida)'));
    child.on('error', (e) => resolve('ERROR: ' + e.message));
  });
}

function describeCookies() {
  if (!config.COOKIES_AVAILABLE) return 'NO disponible (las llamadas van sin --cookies)';
  const raw = fs.readFileSync(config.COOKIES_FILE, 'utf8');
  const cookieLines = raw.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('#') && !t.startsWith('\ufeff#');
  });
  const names = cookieLines.map((l) => l.split('\t')[5] || '');
  const hasAuth = names.includes('__Secure-3PSID') || names.includes('SID');
  return `${config.COOKIES_FILE} (${raw.length} bytes, ${cookieLines.length} cookies, cuenta autenticada: ${hasAuth ? 'sí' : 'NO'})`;
}

async function tryClient(label, client) {
  const started = Date.now();
  try {
    const info = await ytDlpJson(
      ['-f', 'bestaudio/best', '-J', '--no-playlist', '--no-warnings', `ytsearch1:${QUERY}`],
      client
    );
    const top = (info.entries && info.entries[0]) || info;
    console.log(`  [PASS] ${label}: "${top.title || top.id}" (${Date.now() - started}ms)`);
    return label;
  } catch (e) {
    const msg = e.message.replace(/\s+/g, ' ').slice(0, 160);
    console.log(`  [FAIL] ${label}: ${msg} (${Date.now() - started}ms)`);
    return null;
  }
}

(async () => {
  console.log('=== yt-test: diagnóstico de extracción de YouTube ===');
  console.log('Consulta :', QUERY);
  console.log('yt-dlp   :', await ytVersion());
  console.log('Cookies  :', describeCookies());
  console.log('Intentos (con cookies salvo indicación):');

  const attempts = [
    ['default', { client: null, cookies: true }],
    ['web_safari', { client: 'web_safari', cookies: true }],
    ['tv', { client: 'tv', cookies: true }],
    ['android_vr', { client: 'android_vr', cookies: true }],
    ['web_embedded', { client: 'web_embedded', cookies: true }],
    ['mweb', { client: 'mweb', cookies: true }],
    ['web_safari SIN cookies', { client: 'web_safari', cookies: false }],
  ];

  const passed = [];
  for (const [label, client] of attempts) {
    const ok = await tryClient(label, client);
    if (ok) passed.push(ok);
  }

  console.log('---');
  if (passed.length) {
    console.log('Clientes que funcionan:', passed.join(', '));
    console.log('Fija el primero en el panel como variable de entorno: YTDLP_PLAYER_CLIENT=<cliente>');
  } else {
    console.log('Ningún cliente pasó el bot-check desde esta IP.');
    console.log('Opciones: (1) revisa/renueva cookies.txt, (2) usa un proxy residencial con YTDLP_PROXY,');
    console.log('          (3) ejecuta el bot desde una IP residencial.');
  }
})();