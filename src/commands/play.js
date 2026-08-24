// /play command: joins the voice channel, resolves the track(s) and starts playback.
const { joinChannelAndPrepare, playNext, addToQueue, setAnnounceChannel, ensureQueue, scheduleQueuePreload } = require('../voice/player');
const { resolveTrack, getPlaylistEntries } = require('../media/ytdlp');
const { safeEditReply } = require('../discord/reply');
const { trackEmbed, playlistEmbed, warningEmbed, errorEmbed } = require('../discord/embeds');

async function handlePlay(interaction, query) {
  console.log(`[Command:${interaction.guildId}] /play by ${interaction.user.tag}: ${query}`);
  try {
    await interaction.deferReply();
  } catch (err) {
    console.warn('[handlePlay] No se pudo diferir la interacción (posible instancia duplicada o vencida):', err?.message || err);
    return;
  }

  const member = interaction.member;
  if (!member.voice.channel) {
    return safeEditReply(interaction, { embeds: [warningEmbed('Únete a un canal de voz primero.')] });
  }

  const guildId = interaction.guildId;
  const isPlaylist = /list=/.test(query) || /playlist/i.test(query);

  // Unirse al canal de voz y resolver/encolar la pista EN PARALELO: antes eran
  // secuenciales (primero el join ~1-3s y después la extracción de yt-dlp ~2-6s),
  // lo que alargaba el silencio inicial. Así ambos corren a la vez.
  let q;
  let enqueued;
  try {
    const [joined, entries] = await Promise.all([
      joinChannelAndPrepare(member),
      (async () => {
        if (isPlaylist) {
          console.log(`[Playlist:${guildId}] fetching playlist entries`);
          const items = await getPlaylistEntries(query);
          items.forEach((en) => {
            en.requester = interaction.user.tag;
            addToQueue(guildId, en);
            console.log(`[Playlist:${guildId}] enqueued ${en.title}`);
          });
          return items;
        }
        // Single track (URL o búsqueda)
        const track = await resolveTrack(query);
        track.requester = interaction.user.tag;
        addToQueue(guildId, track);
        console.log(`[Queue:${guildId}] size after add: ${ensureQueue(guildId).queue.length}`);
        return track;
      })(),
    ]);
    q = joined;
    enqueued = entries;
  } catch (err) {
    console.error('[handlePlay] error:', err);
    return safeEditReply(interaction, {
      embeds: [errorEmbed('Error al encolar la pista: ' + (err.message || err))],
    });
  }

  setAnnounceChannel(guildId, interaction.channel);

  const wasNotPlaying = !q.playing;
  if (wasNotPlaying) {
    playNext(guildId, 0, false);
    // Pre-resuelve en segundo plano las siguientes pistas mientras arranca la
    // primera, de modo que el embed ya no bloquea nada de audio.
    scheduleQueuePreload(guildId);
  }

  return safeEditReply(interaction, {
    embeds: isPlaylist
      ? [playlistEmbed({ entries: enqueued, count: enqueued.length, user: interaction.user.tag })]
      : [trackEmbed({ track: enqueued, user: interaction.user.tag, mode: wasNotPlaying ? 'now' : 'queued' })],
  });
}

module.exports = { handlePlay };