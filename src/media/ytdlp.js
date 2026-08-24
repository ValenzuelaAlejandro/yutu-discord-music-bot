// Helpers for interacting with the bundled yt-dlp binary.
const { spawn } = require('child_process');
const { YTDLP_BIN } = require('../core/config');

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
 * Returns the direct audio URL, or null if it failed.
 */
function getDirectAudioUrl(target) {
  return new Promise((resolve) => {
    const isSearch = !/^https?:\/\//i.test(target);
    const args = ['-f', 'bestaudio', '--no-playlist', '-g', '--no-warnings'];
    const argTarget = isSearch ? `ytsearch1:${target}` : target;
    args.push(argTarget);
    console.log(`[yt-dlp] direct URL for: ${argTarget} ${isSearch ? '(search)' : ''}`);
    const child = spawn(YTDLP_BIN, args);
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('close', () => {
      const first = out.split(/\r?\n/).find(Boolean);
      if (!first) console.warn(`[yt-dlp] no URL produced:\n${errOut.slice(0, 500)}`);
      resolve(first || null);
    });
    child.on('error', (e) => {
      console.error('[yt-dlp] spawn error:', e);
      resolve(null);
    });
  });
}

/** Run yt-dlp with `--dump-single-json` and parse the JSON output. */
function ytDlpJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args);
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0 || !out.trim()) {
        return reject(new Error(`yt-dlp exit ${code}: ${errOut.slice(0, 500)}`));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('yt-dlp JSON parse error: ' + e.message));
      }
    });
    child.on('error', reject);
  });
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
    // Una sola ejecución: metadatos + URL de audio directa (bestaudio).
    const info = await ytDlpJson(['-f', 'bestaudio', '-J', '--no-playlist', '--no-warnings', query]);
    return normalizeTrack(info, query);
  }
  // treat as search
  const searchResult = await ytDlpJson(['-f', 'bestaudio', '-J', '--no-playlist', '--no-warnings', `ytsearch1:${query.replace(/"/g, '')}`]);
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
  const child = spawn(YTDLP_BIN, ['-j', '--flat-playlist', '--no-warnings', playlistUrl]);
  let out = '';
  let errOut = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { errOut += d.toString(); });

  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code !== 0 || !out) {
        return reject(new Error(`yt-dlp exit ${code}: ${errOut.slice(0, 300)}`));
      }
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
      resolve(entries);
    });
    child.on('error', reject);
  });
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
  resolveTrack,
  getPlaylistEntries,
  getRelatedEntries,
  getCachedDirectUrl,
  setCachedDirectUrl,
  clearCachedDirectUrl,
};