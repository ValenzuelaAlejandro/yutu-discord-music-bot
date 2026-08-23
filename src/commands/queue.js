// /queue command: shows the current queue with the current track's thumbnail.
const { getQueueState } = require('../audio');
const { safeReply } = require('../reply');
const { queueEmbed } = require('../embeds');

function handleQueue(interaction) {
  const state = getQueueState(interaction.guildId);
  safeReply(interaction, { embeds: [queueEmbed(state)] });
}

module.exports = { handleQueue };