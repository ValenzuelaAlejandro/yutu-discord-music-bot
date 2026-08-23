// /skip command: stops the current track (queue advances automatically).
const { skip } = require('../audio');
const { safeReply } = require('../reply');
const { statusEmbed } = require('../embeds');

function handleSkip(interaction) {
  skip(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Pista saltada', 'La siguiente pista de la cola empieza ahora.')] });
}

module.exports = { handleSkip };