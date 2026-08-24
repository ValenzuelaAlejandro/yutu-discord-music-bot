require('dotenv').config();
const { constants } = require('youtube-dl-exec');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional, useful for testing

// Path to the bundled yt-dlp binary (yt-dlp.exe on Windows)
const YTDLP_BIN = constants.YOUTUBE_DL_PATH;

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en .env');
  process.exit(1);
}

module.exports = { TOKEN, CLIENT_ID, GUILD_ID, YTDLP_BIN };