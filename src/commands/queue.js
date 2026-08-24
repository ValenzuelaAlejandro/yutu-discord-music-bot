// /queue command: shows the current queue with the current track's thumbnail.
const { getQueueState } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { queueEmbed } = require('../discord/embeds');

function handleQueue(interaction) {
  const state = getQueueState(interaction.guildId);
  safeReply(interaction, { embeds: [queueEmbed(state)] });
}

module.exports = { handleQueue };