// Audio subsystem: per-guild queue, voice connection, player and playback control.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const {
  getDirectAudioUrl,
  getRelatedEntries,
  getCachedDirectUrl,
  setCachedDirectUrl,
  clearCachedDirectUrl,
} = require('../media/ytdlp');
const { createFfmpegStream } = require('../media/ffmpeg');
const { trackEmbed } = require('../discord/embeds');

// guildId -> { voiceChannel, connection, player, queue: [], playing, lastTrack, ffmpegProcess }
const queueMap = new Map();

// Autoplay "radio similar":
// - AUTOPLAY_TOPSIZE: cantidad de pistas que mantenemos de buffer en la cola.
//   Se rellena en segundo plano desde el arranque de cada canción para no dejar silencio.
// - AUTOPLAY_RECENT_CAP: tamaño del historial para no repetir pistas en la sesión.
const AUTOPLAY_TOPSIZE = 10;
const AUTOPLAY_RECENT_CAP = 30;

// Cuántas pistas de la cola pre-resolvemos en segundo plano (URL directa)
// mientras suena la actual, para que el salto entre canciones sea casi
// instantáneo (evita el silencio de esperar una extracción de yt-dlp).
const PRELOAD_AHEAD = 3;

// Manejador de "now playing": se inyecta desde index.js (setClient) para poder
// enviar mensajes al canal de texto donde se usaron los comandos.
let client = null;
function setClient(c) {
  client = c;
}

function ensureQueue(guildId) {
  if (!queueMap.has(guildId)) {
    // maxMissedFrames alto: el valor por defecto es 5 (~100-200ms), lo que hace que
    // cualquier micro-corte en el stream (latencia de red, picos del servidor, backpressure
    // del pipe de ffmpeg/opus) detenga la pista y el handler de Idle avance la cola.
    // Con 300 ciclos (aprox. 6 segundos de tolerancia) un parpadeo breve ya no corta la canción.
    // Cuando la pista termina de verdad, la transición a Idle se da igual por `readable === false`.
    const player = createAudioPlayer({
      maxMissedFrames: 300,
    });
    queueMap.set(guildId, {
      voiceChannel: null,
      connection: null,
      player,
      queue: [],
      playing: false,
      lastTrack: null,
      textChannel: null,
      ffmpegProcess: null,
      // Autoplay "radio similar": solo vive mientras el bot está en el VC.
      // Se activa/desactiva con /autoplay y se reinicia si el bot sale del canal.
      autoplayEnabled: false,
      recentlyPlayed: [],
      refilling: false,
      preloading: false, // guard simple: no lanzar 2 pre-cargas a la vez
    });
    // Attach once
    player.on('stateChange', (oldState, newState) => {
      console.log(`[Player:${guildId}] stateChange ${oldState.status} -> ${newState.status}`);
      const q = queueMap.get(guildId);
      if (!q) return;
      if (newState.status === AudioPlayerStatus.Idle) {
        console.log(`[Player:${guildId}] Idle. Queue length: ${q.queue.length}`);
        if (q.queue.length > 0) {
          playNext(guildId);
        } else {
          // Cola vacía: si el autoplay está activo, buscamos pistas del mismo estilo.
          triggerAutoplay(guildId);
        }
      }
    });
    player.on('error', (err) => {
      console.error(`[Player:${guildId}] error:`, err);
    });
  }
  return queueMap.get(guildId);
}

async function joinChannelAndPrepare(member) {
  const channel = member.voice.channel;
  if (!channel) throw new Error('No estás en un canal de voz');
  const guildId = member.guild.id;
  const q = ensureQueue(guildId);
  q.voiceChannel = channel;
  console.log(`[Voice:${guildId}] Joining channel ${channel.id} (${channel.name})`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });
  q.connection = connection;

  connection.on('stateChange', (oldState, newState) => {
    console.log(`[Voice:${guildId}] connection state ${oldState.status} -> ${newState.status}`);
    // El autoplay solo se conserva mientras el bot sigue en el canal de voz:
    // si la conexión se destruye o se pierde (bot fuera del VC), la sesión se reinicia.
    if (
      newState.status === VoiceConnectionStatus.Destroyed ||
      newState.status === VoiceConnectionStatus.Disconnected
    ) {
      resetAutoplaySession(guildId);
    }
  });
  connection.on('error', (e) => console.error(`[Voice:${guildId}] connection error:`, e));

  // Wait up to 30s for the connection to become Ready
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log(`[Voice:${guildId}] Connection ready`);
  return q;
}

async function playNext(guildId, retry = 0, announce = true) {
  const q = ensureQueue(guildId);
  // En reintentos reutilizamos la misma pista (ya la sacamos de la cola); si no hay reintento, avanzamos.
  const track = retry === 0 ? q.queue.shift() : q.lastTrack;
  if (!track) {
    q.playing = false;
    return;
  }
  q.playing = true;
  q.lastTrack = track;
  // Registro para el autoplay: evita repetir lo ya reproducido en esta sesión.
  if (!q.recentlyPlayed.includes(track.url)) {
    q.recentlyPlayed.push(track.url);
    if (q.recentlyPlayed.length > AUTOPLAY_RECENT_CAP) q.recentlyPlayed.shift();
  }
  console.log(`[PlayNext:${guildId}] Now playing: ${track.title} (${track.url}) -- remaining: ${q.queue.length}${retry > 0 ? ` (retry ${retry})` : ''}`);
  try {
    const direct = await resolveTrackDirectUrl(track);
    if (!direct) {
      throw new Error('No se pudo obtener stream para ' + track.url);
    }
    const ff = createFfmpegStream(direct);
    q.ffmpegProcess = ff;
    const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw, metadata: track });
    q.player.play(resource);
    if (q.connection) q.connection.subscribe(q.player);
    console.log(`[PlayNext:${guildId}] resource playing`);
    if (announce) announceNowPlaying(guildId, track);
    // Pre-carga en segundo plano: resuelve la URL de la(s) siguiente(s) pista(s)
    // mientras suena esta, para que al terminar no haya espera (sin silencio).
    scheduleQueuePreload(guildId);
    // Pre-carga en segundo plano: mantiene la cola llena del mismo estilo para
    // que al terminar esta canción la siguiente ya esté lista (sin silencio).
    scheduleAutoplayRefill(guildId);
  } catch (err) {
    console.error('[PlayNext] Error reproduciendo pista:', err);
    // No quemar la cola por un fallo temporal (p.ej. YouTube dejó de responder):
    // reintentamos la misma pista unas veces antes de pasar a la siguiente.
    // Invalidamos la URL en caché para que el reintento use una extracción nueva.
    if (track.directUrl) track.directUrl = null;
    clearCachedDirectUrl(track.url);
    if (retry < 2) {
      if (q.ffmpegProcess && !q.ffmpegProcess.killed) {
        q.ffmpegProcess.kill('SIGKILL');
        q.ffmpegProcess = null;
      }
      setTimeout(() => playNext(guildId, retry + 1), 3000);
    } else {
      playNext(guildId);
    }
  }
}

/**
 * Resuelve la URL de audio directa de una pista, reutilizando caché / directUrl
 * cuando existen y evitando lanzar yt-dlp dos veces a la vez para la misma pista
 * (single-flight a través de track.directUrlPromise). Devuelve la URL o null.
 */
function resolveTrackDirectUrl(track) {
  const cached = getCachedDirectUrl(track.url) || track.directUrl;
  if (cached) return Promise.resolve(cached);
  if (track.directUrlPromise) return track.directUrlPromise;
  track.directUrlPromise = getDirectAudioUrl(track.url)
    .then((direct) => {
      if (direct) {
        track.directUrl = direct;
        setCachedDirectUrl(track.url, direct);
      }
      return direct;
    })
    .finally(() => {
      track.directUrlPromise = null;
    });
  return track.directUrlPromise;
}

/**
 * Pre-resuelve en segundo plano (sin bloquear la reproducción) la URL de audio
 * de las próximas PRELOAD_AHEAD pistas de la cola. Así, cuando una canción
 * termina o se salta, la siguiente ya tiene su URL y solo falta spawnear ffmpeg
 * (~200ms) en lugar de esperar una extracción completa de yt-dlp.
 */
async function preloadQueuedTracks(guildId) {
  const q = ensureQueue(guildId);
  if (q.preloading) return;
  q.preloading = true;
  try {
    const toResolve = q.queue.slice(0, PRELOAD_AHEAD);
    // Lanzamos todos en paralelo (no esperar uno tras otro) para minimizar el tiempo.
    await Promise.all(
      toResolve.map(async (track) => {
        const url = await resolveTrackDirectUrl(track);
        if (!url) console.warn(`[Preload:${guildId}] No se pudo pre-cargar "${track.title}"`);
      })
    );
  } catch (err) {
    console.warn(`[Preload:${guildId}] Fallo en la pre-carga en segundo plano:`, err?.message || err);
  } finally {
    q.preloading = false;
  }
}

/** Lanza la pre-carga en segundo plano sin bloquear el hilo de reproducción. */
function scheduleQueuePreload(guildId) {
  setImmediate(() => preloadQueuedTracks(guildId));
}

function addToQueue(guildId, track) {
  const q = ensureQueue(guildId);
  q.queue.push(track);
  // Si ya hay música sonando, pre-resolvemos la URL de lo recién encolado en
  // segundo plano para que cuando llegue su turno arranque al instante.
  if (q.playing) scheduleQueuePreload(guildId);
}

/** Guarda el canal de texto donde se controlan los comandos para anunciar "now playing". */
function setAnnounceChannel(guildId, channel) {
  ensureQueue(guildId).textChannel = channel;
}

/** Envía el embed "Reproduciendo ahora" al canal de texto del guild cuando arranca una pista. */
function announceNowPlaying(guildId, track) {
  const q = queueMap.get(guildId);
  if (!q || !q.textChannel || !client) return;
  const embed = trackEmbed({ track, user: track?.requester, mode: 'now' });
  q.textChannel.send({ embeds: [embed] }).catch((err) => {
    console.warn(`[PlayNext:${guildId}] no se pudo enviar el now playing:`, err?.message || err);
  });
}

function skip(guildId) {
  const q = ensureQueue(guildId);
  q.player.stop();
  if (q.ffmpegProcess && !q.ffmpegProcess.killed) {
    q.ffmpegProcess.kill('SIGKILL');
    q.ffmpegProcess = null;
  }
}

function pause(guildId) {
  ensureQueue(guildId).player.pause();
}

function resume(guildId) {
  ensureQueue(guildId).player.unpause();
}

/** Estado de la cola para el embed: pista actual + próximas. */
function getQueueState(guildId) {
  const q = ensureQueue(guildId);
  return { current: q.lastTrack, queue: q.queue };
}

/** Estado de la pista actual para el comando /nowplaying: pista + estado del player. */
function getNowPlaying(guildId) {
  const q = ensureQueue(guildId);
  return { track: q.lastTrack, status: q.player.state.status };
}

/**
 * Autoplay "radio similar". Se invoca cuando la cola queda vacía y el player
 * pasa a Idle. Busca pistas del mismo estilo musical (radio/mix de YouTube)
 * a partir de la última pista reproducida y las encola.
 */
async function triggerAutoplay(guildId) {
  const q = ensureQueue(guildId);
  if (!q.autoplayEnabled || !q.lastTrack || !q.lastTrack.url) {
    q.playing = false;
    return;
  }
  console.log(`[Autoplay:${guildId}] Buscando pistas del mismo estilo que "${q.lastTrack.title}"...`);
  if (!q.recentlyPlayed.includes(q.lastTrack.url)) {
    q.recentlyPlayed.push(q.lastTrack.url);
    if (q.recentlyPlayed.length > AUTOPLAY_RECENT_CAP) q.recentlyPlayed.shift();
  }
  const related = await getRelatedEntries(q.lastTrack.url);
  let added = 0;
  const queuedUrls = new Set(q.queue.map((x) => x.url));
  const missingCount = AUTOPLAY_TOPSIZE - q.queue.length;
  for (const t of related) {
    if (added >= missingCount) break;
    if (q.recentlyPlayed.includes(t.url) || queuedUrls.has(t.url)) continue;
    t.requester = 'Autoplay (radio similar)';
    addToQueue(guildId, t);
    q.recentlyPlayed.push(t.url);
    if (q.recentlyPlayed.length > AUTOPLAY_RECENT_CAP) q.recentlyPlayed.shift();
    added++;
    queuedUrls.add(t.url);
  }
  if (added === 0) {
    // Si la cola quedó llena por el refill en segundo plano que corrió en paralelo,
    // no detenerse: seguimos con la primera pista ya encolada.
    if (q.queue.length === 0) {
      console.log(`[Autoplay:${guildId}] Sin pistas nuevas del estilo; se detiene.`);
      q.playing = false;
      return;
    }
  }
  console.log(`[Autoplay:${guildId}] ${added} pistas del mismo estilo encoladas (cola: ${q.queue.length}/${AUTOPLAY_TOPSIZE}).`);
  playNext(guildId);
}

/**
 * Pre-carga en segundo plano: mantiene la cola con un buffer de pistas del mismo
 * estilo (hasta AUTOPLAY_TOPSIZE) usando como semilla la última pista encolada
 * o la que suena. Corre sin bloquear la reproducción (scheduleAutoplayRefill).
 */
async function refillAutoplayQueue(guildId) {
  const q = ensureQueue(guildId);
  if (!q.autoplayEnabled || q.refilling || q.queue.length >= AUTOPLAY_TOPSIZE) return;
  q.refilling = true;
  try {
    const seed = q.queue[q.queue.length - 1] || q.lastTrack;
    if (!seed || !seed.url) return;
    console.log(`[Autoplay:${guildId}] Refill en segundo plano desde "${seed.title}"...`);
    const related = await getRelatedEntries(seed.url);
    const queuedUrls = new Set(q.queue.map((x) => x.url));
    const missingCount = AUTOPLAY_TOPSIZE - q.queue.length;
    let added = 0;
    for (const t of related) {
      if (added >= missingCount) break;
      if (q.recentlyPlayed.includes(t.url) || queuedUrls.has(t.url)) continue;
      t.requester = 'Autoplay (radio similar)';
      addToQueue(guildId, t);
      q.recentlyPlayed.push(t.url);
      if (q.recentlyPlayed.length > AUTOPLAY_RECENT_CAP) q.recentlyPlayed.shift();
      added++;
      queuedUrls.add(t.url);
    }
    if (added > 0) {
      console.log(`[Autoplay:${guildId}] Refill listo: ${added} pistas añadidas (cola: ${q.queue.length}/${AUTOPLAY_TOPSIZE}).`);
    }
  } catch (err) {
    console.warn(`[Autoplay:${guildId}] Fallo en el refill en segundo plano:`, err?.message || err);
  } finally {
    q.refilling = false;
  }
}

/** Lanza el refill en segundo plano sin bloquear el hilo de reproducción. */
function scheduleAutoplayRefill(guildId) {
  const q = ensureQueue(guildId);
  if (!q.autoplayEnabled || q.refilling) return;
  setImmediate(() => {
    refillAutoplayQueue(guildId);
  });
}

/** Reinicia la sesión de autoplay (estado + historial). Se usa al salir del VC. */
function resetAutoplaySession(guildId) {
  const q = queueMap.get(guildId);
  if (!q) return;
  q.autoplayEnabled = false;
  q.recentlyPlayed = [];
  q.refilling = false;
  console.log(`[Autoplay:${guildId}] Sesión de autoplay reiniciada (el bot salió del canal de voz).`);
}

/** Activa (true) o desactiva (false) el autoplay para el guild. Devuelve el estado final. */
function setAutoplayEnabled(guildId, enabled) {
  const q = ensureQueue(guildId);
  q.autoplayEnabled = !!enabled;
  if (q.autoplayEnabled) {
    // Al activarlo, llenamos ya la cola en segundo plano desde la pista actual.
    scheduleAutoplayRefill(guildId);
  }
  return q.autoplayEnabled;
}

/** Estado actual del autoplay para el guild. */
function getAutoplayState(guildId) {
  return ensureQueue(guildId).autoplayEnabled;
}

module.exports = {
  ensureQueue,
  setClient,
  joinChannelAndPrepare,
  playNext,
  addToQueue,
  setAnnounceChannel,
  skip,
  pause,
  resume,
  getQueueState,
  getNowPlaying,
  triggerAutoplay,
  resetAutoplaySession,
  setAutoplayEnabled,
  getAutoplayState,
  scheduleQueuePreload,
  preloadQueuedTracks,
};
