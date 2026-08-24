// /pause command: pauses the current track.
const { pause } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { statusEmbed } = require('../discord/embeds');

function handlePause(interaction) {
  pause(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Reproducción pausada', 'Usa /resume para continuar.')] });
}

module.exports = { handlePause };