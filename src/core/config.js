require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { constants } = require('youtube-dl-exec');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional, useful for testing

// Path to the bundled yt-dlp binary (yt-dlp.exe on Windows)
const YTDLP_BIN = constants.YOUTUBE_DL_PATH;

// YouTube exige cookies autenticadas (Netscape) para evitar el bloqueo
// "Sign in to confirm you're not a bot". Si YTDLP_COOKIES se define en .env,
// se usa esa ruta (absoluta o relativa a la raíz del proyecto); en otro caso
// se mira un cookies.txt convencional en la raíz del proyecto.
const cookiesEnv = process.env.YTDLP_COOKIES;
const COOKIES_FILE = cookiesEnv
  ? path.resolve(process.cwd(), cookiesEnv)
  : path.resolve(__dirname, '..', '..', 'cookies.txt');
const COOKIES_AVAILABLE = fs.existsSync(COOKIES_FILE);

module.exports = { TOKEN, CLIENT_ID, GUILD_ID, YTDLP_BIN, COOKIES_FILE, COOKIES_AVAILABLE };