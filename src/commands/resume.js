// /resume command: resumes the current track.
const { resume } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { statusEmbed } = require('../discord/embeds');

function handleResume(interaction) {
  resume(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Reproducción reanudada', 'Continúa la pista actual.')] });
}

module.exports = { handleResume };