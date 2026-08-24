// /play command: joins the voice channel, resolves the track(s) and starts playback.
const { joinChannelAndPrepare, playNext, addToQueue, setAnnounceChannel } = require('../voice/player');
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
  const q = await joinChannelAndPrepare(member);
  setAnnounceChannel(guildId, interaction.channel);

  try {
    // Playlist?
    if (/list=/.test(query) || /playlist/i.test(query)) {
      console.log(`[Playlist:${guildId}] fetching playlist entries`);
      const entries = await getPlaylistEntries(query);
      entries.forEach((en) => {
        en.requester = interaction.user.tag;
        addToQueue(guildId, en);
        console.log(`[Playlist:${guildId}] enqueued ${en.title}`);
      });
      const wasNotPlaying = !q.playing;
      if (wasNotPlaying) playNext(guildId, 0, false);
      return safeEditReply(interaction, {
        embeds: [playlistEmbed({ entries, count: entries.length, user: interaction.user.tag })],
      });
    }

    // Single track (URL or search)
    const track = await resolveTrack(query);
    track.requester = interaction.user.tag;
    addToQueue(guildId, track);
    console.log(`[Queue:${guildId}] size after add: ${q.queue.length}`);
    const isNowPlaying = !q.playing;
    if (isNowPlaying) playNext(guildId, 0, false);
    return safeEditReply(interaction, {
      embeds: [trackEmbed({ track, user: interaction.user.tag, mode: isNowPlaying ? 'now' : 'queued' })],
    });
  } catch (err) {
    console.error('[handlePlay] error:', err);
    return safeEditReply(interaction, {
      embeds: [errorEmbed('Error al encolar la pista: ' + (err.message || err))],
    });
  }
}

module.exports = { handlePlay };