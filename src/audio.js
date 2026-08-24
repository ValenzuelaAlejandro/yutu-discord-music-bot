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
const { getDirectAudioUrl } = require('./ytdlp');
const { createFfmpegStream } = require('./ffmpeg');
const { trackEmbed } = require('./embeds');

// guildId -> { voiceChannel, connection, player, queue: [], playing, lastTrack, ffmpegProcess }
const queueMap = new Map();

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
          q.playing = false;
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
  console.log(`[PlayNext:${guildId}] Now playing: ${track.title} (${track.url}) -- remaining: ${q.queue.length}${retry > 0 ? ` (retry ${retry})` : ''}`);
  try {
    const direct = await getDirectAudioUrl(track.url);
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
  } catch (err) {
    console.error('[PlayNext] Error reproduciendo pista:', err);
    // No quemar la cola por un fallo temporal (p.ej. YouTube dejó de responder):
    // reintentamos la misma pista unas veces antes de pasar a la siguiente.
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

function addToQueue(guildId, track) {
  const q = ensureQueue(guildId);
  q.queue.push(track);
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
};
