// Entry point: creates the client, registers slash commands and routes interactions.
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { TOKEN, CLIENT_ID, GUILD_ID } = require('./core/config');
const { acquireSingleInstanceLock } = require('./core/lock');

const { handlePlay } = require('./commands/play');
const { handleSkip } = require('./commands/skip');
const { handlePause } = require('./commands/pause');
const { handleResume } = require('./commands/resume');
const { handleQueue } = require('./commands/queue');
const { handleAutoplay } = require('./commands/autoplay');
const { handleNowPlaying } = require('./commands/nowplaying');
const { setClient } = require('./voice/player');
const { logYtDlpVersion, scheduleYtDlpAutoUpdate } = require('./media/ytdlpUpdater');
const { startPotProvider } = require('./media/potProvider');

// Prevent a second instance from stealing interactions (Unknown interaction 10062).
acquireSingleInstanceLock();

// Levanta y vigila el proveedor de PO Tokens (bgutil). Vive dentro del proceso
// del bot para no depender de un startup volátil en el hosting: si el servidor
// HTTP cae, este supervisor lo relanza en segundos.
startPotProvider();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
// Inyecta el cliente en el subsistema de audio para enviar el embed "now playing".
setClient(client);

const COMMAND_DEFINITIONS = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una canción o encola una URL o búsqueda')
    .addStringOption((o) => o.setName('query').setDescription('URL o búsqueda').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Salta la pista actual').toJSON(),
  new SlashCommandBuilder().setName('pause').setDescription('Pausa la reproducción').toJSON(),
  new SlashCommandBuilder().setName('resume').setDescription('Reanuda la reproducción').toJSON(),
  new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola').toJSON(),
  new SlashCommandBuilder().setName('autoplay').setDescription('Activa/desactiva el autoplay (radio del mismo estilo)').toJSON(),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Muestra la pista que suena ahora y su estado').toJSON(),
];

client.once('clientReady', async () => {
  console.log(`Conectado como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: COMMAND_DEFINITIONS });
      console.log('Comandos registrados en el guild');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: COMMAND_DEFINITIONS });
      console.log('Comandos globales registrados');
    }
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }

  // Diagnóstico y mantenimiento del binario de yt-dlp (ninguno bloquea):
  // saber la versión exacta es clave para depurar bloqueos de YouTube, y el
  // auto-update instala la última release en segundo plano si falta.
  logYtDlpVersion();
  scheduleYtDlpAutoUpdate();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  console.log(`[Interaction] ${interaction.commandName} from ${interaction.user.tag} in ${interaction.guildId}`);

  try {
    switch (interaction.commandName) {
      case 'play':
        await handlePlay(interaction, interaction.options.getString('query'));
        break;
      case 'skip':
        handleSkip(interaction);
        break;
      case 'pause':
        handlePause(interaction);
        break;
      case 'resume':
        handleResume(interaction);
        break;
      case 'queue':
        handleQueue(interaction);
        break;
      case 'autoplay':
        handleAutoplay(interaction);
        break;
      case 'nowplaying':
        handleNowPlaying(interaction);
        break;
    }
  } catch (err) {
    console.error('Error en el comando:', err);
  }
});

client.login(TOKEN);