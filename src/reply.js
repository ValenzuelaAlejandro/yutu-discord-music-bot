// Safe response helpers that swallow DiscordAPIError (e.g. Unknown interaction 10062).
// Aceptan strings o objetos ({ embeds: [EmbedBuilder], content: '...' }).

async function safeReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(content);
    return await interaction.reply(content);
  } catch (err) {
    console.warn('[SafeReply] No se pudo responder la interacción:', err?.message || err);
  }
}

async function safeEditReply(interaction, content) {
  try {
    return await interaction.editReply(content);
  } catch (err) {
    console.warn('[SafeEditReply] No se pudo editar la respuesta:', err?.message || err);
  }
}

module.exports = { safeReply, safeEditReply };