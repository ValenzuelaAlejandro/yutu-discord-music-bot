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

// guildId -> { voiceChannel, connection, player, queue: [], playing, lastTrack, ffmpegProcess }
const queueMap = new Map();

function ensureQueue(guildId) {
  if (!queueMap.has(guildId)) {
    const player = createAudioPlayer();
    queueMap.set(guildId, {
      voiceChannel: null,
      connection: null,
      player,
      queue: [],
      playing: false,
      lastTrack: null,
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

async function playNext(guildId) {
  const q = ensureQueue(guildId);
  const track = q.queue.shift();
  if (!track) {
    q.playing = false;
    return;
  }
  q.playing = true;
  q.lastTrack = track;
  console.log(`[PlayNext:${guildId}] Now playing: ${track.title} (${track.url}) -- remaining: ${q.queue.length}`);
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
  } catch (err) {
    console.error('[PlayNext] Error reproduciendo pista:', err);
    playNext(guildId);
  }
}

function addToQueue(guildId, track) {
  const q = ensureQueue(guildId);
  q.queue.push(track);
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
  joinChannelAndPrepare,
  playNext,
  addToQueue,
  skip,
  pause,
  resume,
  getQueueState,
};
