// Helpers for interacting with the bundled yt-dlp binary.
const { spawn } = require('child_process');
const { YTDLP_BIN, COOKIES_FILE, COOKIES_AVAILABLE } = require('../core/config');

// ---------------------------------------------------------------------------
// Estrategia anti "Sign in to confirm you're not a bot":
//  - Siempre se pasan las cookies (--cookies) cuando están disponibles.
//  - YTDLP_PLAYER_CLIENT (opcional): fija el "player client" de YouTube que usa
//    yt-dlp (p.ej. web_safari, tv, android_vr). En IPs de datacenter YouTube
//    bloquea los clientes por defecto; algunos alternativos pasan el check.
//  - Si una extracción falla por bot-check, se reintenta automáticamente con una
//    cadena de clientes alternativos hasta dar con uno que pase.
//  - YTDLP_PROXY (opcional): proxy por el que enrutar yt-dlp (http o socks5).
// ---------------------------------------------------------------------------
const ENV_PLAYER_CLIENT = (process.env.YTDLP_PLAYER_CLIENT || '').trim();

const FALLBACK_PLAYER_CLIENTS = [
  'web_safari',
  'tv',
  'android_vr',
  'web_embedded',
  'mweb',
].filter((c) => c !== ENV_PLAYER_CLIENT);

// Cadena de intentos (con cookies primero; al final, dos intentos sin cookies
// por si el archivo de cookies está caducado o es la causa del bloqueo).
const ATTEMPTS = (() => {
  const list = [{ client: null, cookies: COOKIES_AVAILABLE }];
  for (const c of FALLBACK_PLAYER_CLIENTS) list.push({ client: c, cookies: true });
  if (COOKIES_AVAILABLE) {
    list.push({ client: 'web_safari', cookies: false });
    list.push({ client: 'tv', cookies: false });
  }
  return list;
})();

const RETRYABLE_ERROR_RE = /sign in to confirm|log in to confirm|confirm you[’' ]*re not a bot|bot check|requested format is not available|page needs to be reloaded|http error 429|service_unavailable/i;

function isRetryable(errorText) {
  return RETRYABLE_ERROR_RE.test(errorText);
}

function withOptions(baseArgs, attempt = {}) {
  const { client = null, cookies = COOKIES_AVAILABLE } = attempt;
  let args = [...baseArgs];
  if (cookies && COOKIES_AVAILABLE) args.push('--cookies', COOKIES_FILE);
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  const pc = client || ENV_PLAYER_CLIENT;
  if (pc) args.push('--extractor-args', `youtube:player_client=${pc}`);
  return args;
}

/** Ejecuta yt-dlp y devuelve { code, out, errOut } sin interpretarlos. */
function runYtDlp(args) {
  return new Promise((resolve) => {
    const child = spawn(YTDLP_BIN, args);
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('close', (code) => resolve({ code, out, errOut }));
    child.on('error', (e) => resolve({ code: -1, out: '', errOut: e.message }));
  });
}

function attemptLabel(attempt) {
  const client = attempt.client || ENV_PLAYER_CLIENT || 'default';
  return attempt.cookies === false ? `${client} (sin cookies)` : client;
}

// ---------------------------------------------------------------
// Caché en memoria de URLs de audio directas.
// El paso más caro es la extracción de yt-dlp (carga de la página de
// YouTube + red). Reutilizar la URL si la misma canción vuelve a sonar
// en la sesión elimina ese coste casi por completo.
// Las URLs de YouTube (googlevideo.com) suelen ser válidas ~6h ligadas a
// la IP de quien las pidió; usamos un TTL conservador de 45 min.
// ---------------------------------------------------------------
const DIRECT_URL_CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutos
const directUrlCache = new Map(); // url -> { directUrl, ts }

function getCachedDirectUrl(url) {
  const entry = directUrlCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > DIRECT_URL_CACHE_TTL_MS) {
    directUrlCache.delete(url);
    return null;
  }
  return entry.directUrl;
}

function setCachedDirectUrl(url, direct) {
  if (!url || !direct) return;
  directUrlCache.set(url, { directUrl: direct, ts: Date.now() });
  // Evita que el mapa crezca sin límite con canciones distintas de la sesión.
  if (directUrlCache.size > 500) {
    const oldest = directUrlCache.keys().next().value;
    if (oldest) directUrlCache.delete(oldest);
  }
}

function clearCachedDirectUrl(url) {
  directUrlCache.delete(url);
}

/**
 * Run yt-dlp to extract a streamable audio URL for the given URL/query.
 * Returns the direct audio URL, or null if it failed (reintentando con
 * clientes alternativos si YouTube bloquea por bot-check).
 */
async function getDirectAudioUrl(target) {
  const isSearch = !/^https?:\/\//i.test(target);
  const argTarget = isSearch ? `ytsearch1:${target}` : target;
  let lastErr = '';
  for (const attempt of ATTEMPTS) {
    const args = withOptions(['-f', 'bestaudio/best', '--no-playlist', '-g', '--no-warnings', argTarget], attempt);
    console.log(`[yt-dlp] direct URL for: ${argTarget} (${attemptLabel(attempt)})`);
    const { code, out, errOut } = await runYtDlp(args);
    const first = out.split(/\r?\n/).find(Boolean);
    if (first) return first;
    lastErr = errOut;
    if (!isRetryable(errOut)) break;
    console.warn(`[yt-dlp] fallo recuperable (${attemptLabel(attempt)}); reintentando con otro cliente`);
  }
  if (!lastErr) lastErr = 'sin salida de yt-dlp';
  console.warn(`[yt-dlp] no URL produced:\n${lastErr.slice(0, 500)}`);
  return null;
}

/**
 * Run yt-dlp with `--dump-single-json` and parse the JSON output.
 * `attempt` es opcional ({ client, cookies }); si se omite, usa la configuración
 * por defecto (cookies + cliente de YTDLP_PLAYER_CLIENT si está definido).
 */
async function ytDlpJson(args, attempt = { client: null }) {
  const { code, out, errOut } = await runYtDlp(withOptions(args, attempt));
  if (code !== 0 || !out.trim()) {
    throw new Error(`yt-dlp exit ${code}: ${errOut.slice(0, 500)}`);
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error('yt-dlp JSON parse error: ' + e.message);
  }
}

/**
 * Igual que ytDlpJson pero si falla por bot-check reintenta automáticamente
 * con la cadena de clientes alternativos.
 */
async function ytDlpJsonSmart(args) {
  let lastErr;
  for (const attempt of ATTEMPTS) {
    try {
      return await ytDlpJson(args, attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err.message)) throw err;
      console.warn(`[yt-dlp] fallo recuperable (${attemptLabel(attempt)}); reintentando con otro cliente`);
    }
  }
  throw lastErr;
}

/** Normaliza la info cruda de yt-dlp a un objeto de pista (track). */
function normalizeTrack(info, url) {
  const track = {
    title: info.title || info.fulltitle || url,
    url,
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null,
    channel: info.channel || info.uploader || info.artist || null,
    durationSeconds: info.duration ?? null,
  };
  // Cuando pedimos `-f bestaudio -J`, `info.url` ya es la URL de audio directa
  // (googlevideo.com o un manifiesto HLS). Guardarla aquí evita una 2ª llamada
  // a yt-dlp en playNext -> arranca la canción en la mitad de tiempo.
  const direct = info.url;
  if (direct) {
    track.directUrl = direct;
    setCachedDirectUrl(url, direct);
  }
  return track;
}

/** Get resolved track info (title + playable URL) for any target. */
async function resolveTrack(query) {
  const isURL = /^https?:\/\//i.test(query);
  if (isURL) {
    // Una sola ejecución: metadatos + URL de audio directa (bestaudio/best).
    const info = await ytDlpJsonSmart(['-f', 'bestaudio/best', '-J', '--no-playlist', '--no-warnings', query]);
    return normalizeTrack(info, query);
  }
  // treat as search
  const searchResult = await ytDlpJsonSmart(['-f', 'bestaudio/best', '-J', '--no-playlist', '--no-warnings', `ytsearch1:${query.replace(/"/g, '')}`]);
  // Para buscar, yt-dlp devuelve un objeto "playlist" cuyo nivel superior
  // solo repite la query (id/title/webpage_url = "ytsearch1:...") en lugar
  // del video real, que esta en entries[0].
  const info = (searchResult.entries && searchResult.entries[0]) || searchResult;
  const url = info.webpage_url || info.url || `https://www.youtube.com/watch?v=${info.id}`;
  // Si la URL resultante sigue siendo una busqueda (ytsearch1:), la descartamos.
  const finalUrl = /^ytsearch\d*:/i.test(url) ? `https://www.youtube.com/watch?v=${info.id}` : url;
  return normalizeTrack(info, finalUrl);
}

/** Fetch playlist entries (title + url) for a playlist URL/query. */
async function getPlaylistEntries(playlistUrl) {
  const baseArgs = ['-j', '--flat-playlist', '--no-warnings', playlistUrl];
  let lastErr = '';
  for (const attempt of ATTEMPTS) {
    const { code, out, errOut } = await runYtDlp(withOptions(baseArgs, attempt));
    if (code === 0 && out) {
      const lines = out.split(/\r?\n/).filter(Boolean);
      const entries = [];
      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          entries.push({
            title: e.title || e.fulltitle,
            url: `https://www.youtube.com/watch?v=${e.id}`,
            thumbnail: e.thumbnail || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
            channel: e.channel || e.uploader || null,
            durationSeconds: e.duration ?? null,
          });
        } catch { /* skip malformed lines */ }
      }
      return entries;
    }
    lastErr = errOut;
    if (!isRetryable(errOut)) break;
    console.warn(`[yt-dlp] fallo recuperable (${attemptLabel(attempt)}); reintentando con otro cliente`);
  }
  throw new Error(`yt-dlp exit 1: ${(lastErr || 'sin salida').slice(0, 300)}`);
}

/** Extrae el ID de video de una URL de YouTube, o null si no se puede. */
function getYouTubeVideoId(url) {
  try {
    return new URL(url).searchParams.get('v') || null;
  } catch {
    return null;
  }
}

/**
 * Obtiene pistas relacionadas del mismo estilo musical usando el "radio/mix"
 * autogenerado de YouTube (list=RD<id>), el mismo mecanismo que usa YouTube
 * para su reproducción automática: canciones del mismo género/artista.
 * Devuelve un array de tracks con el mismo formato que getPlaylistEntries,
 * o [] si no se pudo obtener.
 */
async function getRelatedEntries(url) {
  const id = getYouTubeVideoId(url);
  if (!id) return [];
  const radioUrl = `https://www.youtube.com/watch?v=${id}&list=RD${id}`;
  try {
    return await getPlaylistEntries(radioUrl);
  } catch (err) {
    console.warn('[yt-dlp] no se pudo obtener el radio/mix (autoplay):', err?.message || err);
    return [];
  }
}

module.exports = {
  getDirectAudioUrl,
  ytDlpJson,
  ytDlpJsonSmart,
  resolveTrack,
  getPlaylistEntries,
  getRelatedEntries,
  getCachedDirectUrl,
  setCachedDirectUrl,
  clearCachedDirectUrl,
};