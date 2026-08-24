// Builders de embeds reutilizables. Sin emojis. Incluyen miniatura del video/canción.
const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865f2, // Discord blurple
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
};

/** Convierte segundos a hh:mm:ss / mm:ss. */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return 'Desconocida';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/**
 * Embed de una pista (play / playlist entry).
 * - mode 'now': "Reproduciendo ahora" (verde)
 * - mode 'queued': "Agregada a la cola" (blurple)
 * Incluye miniatura del video, canal, duración y solicitante.
 */
function trackEmbed({ track, user, mode }) {
  const isNow = mode === 'now';
  const embed = new EmbedBuilder()
    .setColor(isNow ? COLORS.success : COLORS.primary)
    .setTitle(isNow ? 'Reproduciendo ahora' : 'Agregada a la cola')
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: 'Canal', value: track.channel || 'Desconocido', inline: true },
      { name: 'Duración', value: formatDuration(track.durationSeconds), inline: true },
      { name: 'Solicitada por', value: user || '—', inline: true },
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

/** Embed de playlist: título + número de pistas agregadas + miniatura de la primera. */
function playlistEmbed({ entries, count, user }) {
  const first = entries[0];
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('Playlist agregada a la cola')
    .setDescription(`**${count}** pistas encoladas.`)
    .addFields({ name: 'Solicitada por', value: user || '—', inline: true });
  if (first?.thumbnail) embed.setThumbnail(first.thumbnail);
  return embed;
}

/** Embed de la cola: muestra la pista actual con su foto y lista de siguientes. */
function queueEmbed(state) {
  const now = state.current;
  const list = state.queue;
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('Cola de reproducción');

  if (now) {
    embed.setDescription(`**Ahora suena:** [${now.title}](${now.url})`);
    if (now.thumbnail) embed.setThumbnail(now.thumbnail);
  }

  if (list.length === 0) {
    embed.addFields({ name: 'Siguientes', value: 'La cola está vacía.' });
  } else {
    const lines = list.slice(0, 10).map((t, i) => `${i + 1}. ${t.title} \u2014 ${formatDuration(t.durationSeconds)}`);
    embed.addFields({ name: 'Siguientes', value: lines.join('\n') });
    if (list.length > 10) embed.setFooter({ text: `Y ${list.length - 10} pistas más...` });
  }

  return embed;
}

/**
 * Embed para /nowplaying: muestra la pista actual con su miniatura y estado
 * (sonando / pausada / cargando / detenida) según el status del AudioPlayer.
 */
function nowPlayingEmbed(state) {
  const track = state.track;
  const status = state.status;
  let title = 'Reproduciendo ahora';
  let color = COLORS.success;
  if (status === 'paused' || status === 'autopaused') {
    title = 'Pausada';
    color = COLORS.warning;
  } else if (status === 'buffering') {
    title = 'Cargando...';
    color = COLORS.warning;
  } else if (status === 'idle') {
    title = 'Detenida';
    color = COLORS.warning;
  }
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: 'Canal', value: track.channel || 'Desconocido', inline: true },
      { name: 'Duración', value: formatDuration(track.durationSeconds), inline: true },
      { name: 'Solicitada por', value: track.requester || '—', inline: true },
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

/** Embed de estado simple (skip / pause / resume). */
function statusEmbed(title, description, colorKey = 'success') {
  if (!COLORS[colorKey]) colorKey = 'success';
  return new EmbedBuilder()
    .setColor(COLORS[colorKey])
    .setTitle(title)
    .setDescription(description);
}

/** Embed de aviso (por ejemplo, el usuario no está en un canal de voz). */
function warningEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Aviso')
    .setDescription(message);
}

/** Embed de error. */
function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('Error')
    .setDescription(message);
}

module.exports = {
  formatDuration,
  trackEmbed,
  playlistEmbed,
  queueEmbed,
  nowPlayingEmbed,
  statusEmbed,
  warningEmbed,
  errorEmbed,
  COLORS,
};
