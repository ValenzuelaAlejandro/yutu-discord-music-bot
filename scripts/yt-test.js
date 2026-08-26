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
    const child = spawn(config.getYtDlpBin(), ['--version']);
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => resolve(out.trim() || '(desconocida)'));
    child.on('error', (e) => resolve('ERROR: ' + e.message));
  });
}

function describeCookies() {
  if (!config.COOKIES_AVAILABLE) return 'NO disponible (las llamadas van sin --cookies)';
  const raw = fs.readFileSync(config.COOKIES_FILE, 'utf8').replace(/^\ufeff/, '');
  // Igual que en config.js: "#HttpOnly_" es prefijo válido, no comentario.
  const cookieLines = raw.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t && (!t.startsWith('#') || t.startsWith('#HttpOnly_'));
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
  console.log('Binario  :', config.getYtDlpBin());
  console.log('yt-dlp   :', await ytVersion());
  console.log('Cookies  :', describeCookies());
  if (!config.PLUGINS_DIR_AVAILABLE && !process.env.YTDLP_PLUGIN_DIRS) {
    console.log('Plugins  : ninguno (para IPs de datacenter muy marcadas, mira el PO Token provider en el README)');
  } else {
    console.log('Plugins  :', process.env.YTDLP_PLUGIN_DIRS || config.PLUGINS_DIR);
  }
  console.log('Intentos (con cookies salvo indicación):');

  const attempts = [
    ['default', { client: null, cookies: true }],
    ['android_vr', { client: 'android_vr', cookies: true }],
    ['tv_simply', { client: 'tv_simply', cookies: true }],
    ['tv', { client: 'tv', cookies: true }],
    ['web_safari', { client: 'web_safari', cookies: true }],
    ['mweb', { client: 'mweb', cookies: true }],
    ['android_vr SIN cookies', { client: 'android_vr', cookies: false }],
    ['tv SIN cookies', { client: 'tv', cookies: false }],
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
    console.log('Opciones: (1) renueva cookies.txt exportándolas en ventana de incógnito,');
    console.log('          (2) instala un proveedor de PO Tokens (bgutil-ytdlp-pot-provider, ver README),');
    console.log('          (3) usa un proxy residencial con YTDLP_PROXY o cambia a una IP residencial.');
  }
})();