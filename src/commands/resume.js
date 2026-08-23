// /resume command: resumes the current track.
const { resume } = require('../audio');
const { safeReply } = require('../reply');
const { statusEmbed } = require('../embeds');

function handleResume(interaction) {
  resume(interaction.guildId);
  safeReply(interaction, { embeds: [statusEmbed('Reproducción reanudada', 'Continúa la pista actual.')] });
}

module.exports = { handleResume };