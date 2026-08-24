// /nowplaying command: shows the currently playing track and its state.
const { getNowPlaying } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { nowPlayingEmbed, warningEmbed } = require('../discord/embeds');

function handleNowPlaying(interaction) {
  const state = getNowPlaying(interaction.guildId);
  if (!state.track) {
    return safeReply(interaction, {
      embeds: [warningEmbed('No se está reproduciendo ninguna pista.')],
    });
  }
  safeReply(interaction, { embeds: [nowPlayingEmbed(state)] });
}

module.exports = { handleNowPlaying };