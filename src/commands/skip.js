// /skip command: stops the current track (queue advances automatically).
const { skip } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { statusEmbed } = require('../discord/embeds');

function handleSkip(interaction) {
  skip(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Pista saltada', 'La siguiente pista de la cola empieza ahora.')] });
}

module.exports = { handleSkip };