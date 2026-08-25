require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { constants } = require('youtube-dl-exec');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional, useful for testing

// Path to the bundled yt-dlp binary (yt-dlp.exe on Windows)
const YTDLP_BIN = constants.YOUTUBE_DL_PATH;

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

console.log(`[cookies] archivo: ${COOKIES_FILE} (${COOKIES_AVAILABLE ? 'disponible' : 'NO disponible — YouTube puede bloquear la extracción'})`);

module.exports = { TOKEN, CLIENT_ID, GUILD_ID, YTDLP_BIN, COOKIES_FILE, COOKIES_AVAILABLE };