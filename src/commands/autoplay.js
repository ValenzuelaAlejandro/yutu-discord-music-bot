// /autoplay command: toggles the "radio similar" autoplay for the current VC session.
// El estado solo se conserva mientras el bot permanece en el canal de voz.
const { getAutoplayState, setAutoplayEnabled } = require('../voice/player');
const { safeReply } = require('../discord/reply');
const { statusEmbed } = require('../discord/embeds');

function handleAutoplay(interaction) {
  const enabled = setAutoplayEnabled(interaction.guildId, !getAutoplayState(interaction.guildId));
  safeReply(interaction, {
    embeds: [
      statusEmbed(
        enabled ? 'Autoplay activado' : 'Autoplay desactivado',
        enabled
          ? 'Cuando la cola se vacíe, se reproducirán pistas del mismo estilo musical automáticamente. Se apaga si el bot sale del canal de voz.'
          : 'Autoplay apagado. Cuando la cola se vacíe, la reproducción se detiene.'
      ),
    ],
  });
}

module.exports = { handleAutoplay };