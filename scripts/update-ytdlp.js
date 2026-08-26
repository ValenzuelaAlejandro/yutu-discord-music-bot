#!/usr/bin/env node
// Fuerza la actualización del binario de yt-dlp a la última versión estable.
// Uso: npm run update-yt-dlp
const { updateYtDlpBinary } = require('../src/media/ytdlpUpdater');

updateYtDlpBinary({ force: true }).then((ok) => {
  process.exitCode = ok ? 0 : 1;
});