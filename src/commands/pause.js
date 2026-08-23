// /pause command: pauses the current track.
const { pause } = require('../audio');
const { safeReply } = require('../reply');
const { statusEmbed } = require('../embeds');

function handlePause(interaction) {
  pause(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Reproducción pausada', 'Usa /resume para continuar.')] });
}

module.exports = { handlePause };