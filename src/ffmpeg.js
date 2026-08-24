// Spawns ffmpeg to convert a direct audio URL into raw PCM for Discord voice.
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

/**
 * Spawn ffmpeg to convert the direct audio URL to raw PCM.
 * Returns the spawned child process (use .stdout as the audio stream).
 */
function createFfmpegStream(directUrl) {
  const ff = spawn(ffmpegPath, [
    '-re',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '10',
    '-i', directUrl,
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ]);
  ff.stderr.on('data', (d) => console.debug(`[ffmpeg] ${d.toString().slice(0, 200)}`));
  ff.on('error', (e) => console.error('[ffmpeg] error', e));
  return ff;
}

module.exports = { createFfmpegStream };