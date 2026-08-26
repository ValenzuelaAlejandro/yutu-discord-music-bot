require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { constants } = require('youtube-dl-exec');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional, useful for testing

// ---------------------------------------------------------------------------
// Resolución del binario de yt-dlp, por prioridad:
//  1. YTDLP_BIN (variable de entorno; ruta absoluta o relativa al cwd).
//  2. <raíz>/bin/yt-dlp(.exe) — binario que instalan scripts/update-ytdlp.js y
//     el auto-update del arranque (YouTube rompe versiones antiguas con
//     frecuencia, así que poder refrescar sin tocar node_modules es clave).
//  3. El binario bundled en node_modules/youtube-dl-exec (su postinstall baja
//     la última versión estable de yt-dlp desde GitHub).
// Se expone como función para que cada llamada a yt-dlp use el binario vigente
// aunque el auto-update lo sustituya con el bot ya arrancado.
// ---------------------------------------------------------------------------
function getYtDlpBin() {
  if (process.env.YTDLP_BIN) return path.resolve(process.cwd(), process.env.YTDLP_BIN);
  const updated = path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(updated)) return updated;
  return constants.YOUTUBE_DL_PATH;
}

const YTDLP_BIN = getYtDlpBin();

// Directorio de plugins de yt-dlp dentro del proyecto (p.ej. un proveedor de
// PO Tokens); si existe se pasa a yt-dlp vía --plugin-dirs en cada llamada.
const PLUGINS_DIR = path.join(__dirname, '..', '..', 'yt-dlp-plugins');
const PLUGINS_DIR_AVAILABLE = (() => {
  try {
    return fs.statSync(PLUGINS_DIR).isDirectory();
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Cookies de YouTube (formato Netscape) para evitar el bloqueo
// "Sign in to confirm you're not a bot".
//  1. Si YTDLP_COOKIES se define en .env, se usa esa ruta (absoluta o relativa
//     al directorio de trabajo).
//  2. En otro caso se mira un cookies.txt convencional en la raíz del proyecto.
//  3. Si el archivo no existe pero YTDLP_COOKIES_CONTENT trae el contenido del
//     archivo de cookies (útil en hosts sin gestor de archivos, ej. Pterodactyl),
//     se escribe en la raíz al arrancar. Los saltos de línea pueden ir como
//     secuencia literal "\n" dentro de la variable.
// ---------------------------------------------------------------------------
const DEFAULT_COOKIES_FILE = path.resolve(__dirname, '..', '..', 'cookies.txt');
const COOKIES_FILE = process.env.YTDLP_COOKIES
  ? path.resolve(process.cwd(), process.env.YTDLP_COOKIES)
  : DEFAULT_COOKIES_FILE;

if (!fs.existsSync(COOKIES_FILE) && process.env.YTDLP_COOKIES_CONTENT) {
  try {
    const content = process.env.YTDLP_COOKIES_CONTENT.replace(/\\n/g, '\n');
    fs.writeFileSync(COOKIES_FILE, content, { mode: 0o600 });
    console.log(`[cookies] ${COOKIES_FILE} generado desde YTDLP_COOKIES_CONTENT`);
  } catch (e) {
    console.warn('[cookies] no se pudo escribir cookies.txt desde YTDLP_COOKIES_CONTENT:', e.message);
  }
}

const COOKIES_AVAILABLE = fs.existsSync(COOKIES_FILE);

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en .env');
  process.exit(1);
}

// Detalle útil para diagnosticar el bloqueo "not a bot" desde el arranque.
// En formato Netscape las cookies HttpOnly llevan el prefijo "#HttpOnly_":
// un conteo ingenuo las trata como comentarios, pero son cookies válidas
// (de hecho suelen ser las de sesión: SID, __Secure-3PSID...).
const COOKIE_GROUPS = [
  { label: 'SID (sesión)', names: ['SID', '__Secure-1PSID', '__Secure-3PSID'] },
  { label: 'HSID', names: ['HSID'] },
  { label: 'SSID', names: ['SSID'] },
  { label: 'SAPISID (autorización API)', names: ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID'] },
  { label: 'LOGIN_INFO', names: ['LOGIN_INFO'] },
];

/** Diagnóstico legible del archivo de cookies ('' si no hay archivo o no se lee). */
function summarizeCookieFile() {
  if (!COOKIES_AVAILABLE) return '';
  try {
    const raw = fs.readFileSync(COOKIES_FILE, 'utf8').replace(/^\ufeff/, '');
    const cookieLines = raw.split(/\r?\n/).filter((l) => {
      const t = l.trim();
      return t && (!t.startsWith('#') || t.startsWith('#HttpOnly_'));
    });
    const names = new Set(cookieLines.map((l) => l.split('\t')[5] || ''));
    const hasAuth = names.has('__Secure-3PSID') || names.has('SID');
    let detail = ` (${raw.length} bytes, ${cookieLines.length} cookies, cuenta autenticada: ${hasAuth ? 'sí' : 'NO'})`;
    // Una exportación que omite cookies clave (p.ej. solo __Secure-3P*) no
    // basta para pasar el bot-check aunque figure como "autenticada".
    const missing = COOKIE_GROUPS
      .filter((g) => !g.names.some((n) => names.has(n)))
      .map((g) => g.label);
    if (missing.length) {
      detail += '\n[cookies] AVISO: faltan cookies importantes (' + missing.join(', ') + ').'
        + ' La exportación parece incompleta: re-expórtalas con el método del README'
        + ' (incógnito -> youtube.com/robots.txt -> extensión "Get cookies.txt LOCALLY").';
    }
    return detail;
  } catch {
    return ''; /* si no se puede leer, no importa */
  }
}

const cookieDetail = COOKIES_AVAILABLE ? summarizeCookieFile() : '';

if (COOKIES_AVAILABLE) {
  console.log(`[cookies] archivo: ${COOKIES_FILE} — disponible${cookieDetail}`);
} else {
  console.log('[cookies] archivo: ' + COOKIES_FILE + ' — NO disponible (YouTube puede bloquear la extracción)');
}
if (process.env.YTDLP_PLAYER_CLIENT) {
  console.log(`[cookies] YTDLP_PLAYER_CLIENT=${process.env.YTDLP_PLAYER_CLIENT}`);
}
if (process.env.YTDLP_PROXY) {
  console.log('[cookies] usando proxy (YTDLP_PROXY)');
}
if (process.env.YTDLP_BIN) {
  console.log(`[yt-dlp] binario forzado por YTDLP_BIN: ${YTDLP_BIN}`);
} else if (YTDLP_BIN !== constants.YOUTUBE_DL_PATH) {
  console.log(`[yt-dlp] usando binario actualizado: ${YTDLP_BIN}`);
}
if (PLUGINS_DIR_AVAILABLE) {
  console.log(`[yt-dlp] plugins activados: ${PLUGINS_DIR}`);
}

module.exports = {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  YTDLP_BIN,
  getYtDlpBin,
  COOKIES_FILE,
  COOKIES_AVAILABLE,
  summarizeCookieFile,
  PLUGINS_DIR,
  PLUGINS_DIR_AVAILABLE,
};