// Mantiene el binario de yt-dlp actualizado a la última versión estable.
//
// YouTube cambia su API y su bot-check constantemente, y cada release de
// yt-dlp ajusta los "player clients"; correr una versión antigua es una de las
// causas típicas del bloqueo "Sign in to confirm you're not a bot". Por eso:
//  - Al arrancar, el bot compara la versión local con la última publicada y,
//    si difiere, descarga el binario nuevo a <raíz>/bin/ (esa ruta tiene
//    prioridad sobre el bundled de node_modules). Todo en segundo plano: nunca
//    bloquea el arranque ni tumba el bot si falla.
//  - `npm run update-yt-dlp` fuerza la misma actualización a mano.
// La elección de asset replica el criterio de youtube-dl-exec: `yt-dlp.exe`
// en Windows y el zipapp `yt-dlp` en el resto de plataformas.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const { getYtDlpBin } = require('../core/config');

const RELEASE_API_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const REQUEST_HEADERS = {
  'user-agent': 'yutu-discord-music-bot',
  accept: 'application/vnd.github+json',
};
const BIN_DIR = path.join(__dirname, '..', '..', 'bin');
const ASSET_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const TARGET_PATH = path.join(BIN_DIR, ASSET_NAME);

/** Ejecuta un binario y devuelve { code, out }. */
function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', () => resolve({ code: -1, out: '' }));
  });
}

/** Versión instalada de un binario concreto (string o null). */
async function getVersionOf(bin) {
  const { code, out } = await run(bin, ['--version']);
  const v = out.trim();
  return code === 0 && /^\d{4}\.\d{2}\.\d{2}/.test(v) ? v : null;
}

/** Versión del binario que el bot usaría ahora mismo (getYtDlpBin). */
async function getLocalVersion() {
  return getVersionOf(getYtDlpBin());
}

/** Última release estable publicada de yt-dlp ({ tagName, assetUrl }). */
async function fetchLatestRelease() {
  const res = await fetch(RELEASE_API_URL, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`GitHub API respondió ${res.status}`);
  const payload = await res.json();
  const asset = (payload.assets || []).find((a) => a.name === ASSET_NAME);
  if (!payload.tag_name || !asset?.browser_download_url) {
    throw new Error(`release sin asset ${ASSET_NAME}`);
  }
  return { tagName: String(payload.tag_name).trim(), assetUrl: asset.browser_download_url };
}

/** Descarga el binario a <raíz>/bin/ de forma atómica (temporal + rename). */
async function downloadBinary(assetUrl) {
  const res = await fetch(assetUrl, { headers: REQUEST_HEADERS });
  if (!res.ok || !res.body) throw new Error(`descarga HTTP ${res.status}`);
  await fs.promises.mkdir(BIN_DIR, { recursive: true });
  const tmp = `${TARGET_PATH}.download`;
  await pipeline(res.body, createWriteStream(tmp));
  await fs.promises.rename(tmp, TARGET_PATH);
  if (process.platform !== 'win32') await fs.promises.chmod(TARGET_PATH, 0o755);
}

/**
 * Compara la versión local con la última estable e instala el binario en
 * <raíz>/bin/ si difieren. Con { force: true } descarga sin comparar.
 * Devuelve true si el binario quedó operativo tras la operación.
 */
async function updateYtDlpBinary({ force = false } = {}) {
  try {
    const { tagName, assetUrl } = await fetchLatestRelease();
    const latest = tagName.replace(/^v/, '');
    const current = force ? null : await getLocalVersion();
    if (current && current === latest) {
      console.log(`[yt-dlp] ya está en la última versión (${current})`);
      return true;
    }
    console.log(`[yt-dlp] descargando ${latest} -> ${TARGET_PATH}${current ? ` (actual: ${current})` : ''}`);
    await downloadBinary(assetUrl);
    const installed = await getVersionOf(TARGET_PATH);
    if (!installed) throw new Error('el binario descargado no responde a --version');
    console.log(`[yt-dlp] instalada versión ${installed}`);
    return true;
  } catch (err) {
    console.error('[yt-dlp] no se pudo actualizar:', err?.message || err);
    return false;
  }
}

/** Imprime la versión del binario en uso (diagnóstico de arranque). */
async function logYtDlpVersion() {
  try {
    const v = await getLocalVersion();
    console.log(`[yt-dlp] versión del binario: ${v || '(desconocida)'}`);
  } catch { /* diagnóstico best-effort */ }
}

let autoUpdateStarted = false;

/**
 * Auto-update en segundo plano al arrancar (no bloquea). Apagable con
 * YTDLP_AUTO_UPDATE=0. Si el usuario fija YTDLP_BIN, ese binario es ajeno al
 * bot y no se toca.
 */
async function scheduleYtDlpAutoUpdate() {
  if (autoUpdateStarted) return;
  autoUpdateStarted = true;
  if (process.env.YTDLP_AUTO_UPDATE === '0') return;
  if (process.env.YTDLP_BIN) {
    console.log('[yt-dlp] auto-update desactivado: binario externo fijado con YTDLP_BIN');
    return;
  }
  // Fuera del flujo de arranque: que la conexión a Discord no espere a GitHub.
  setImmediate(() => {
    updateYtDlpBinary().catch(() => {});
  });
}

module.exports = { updateYtDlpBinary, scheduleYtDlpAutoUpdate, logYtDlpVersion };