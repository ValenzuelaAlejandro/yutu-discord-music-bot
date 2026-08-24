// Single-instance guard: prevents two bot processes running with the same
// token. Discord delivers each interaction to EVERY gateway connection with
// the token, so a duplicate instance causes "Unknown interaction (10062)" on
// whichever instance responds second.
const net = require('net');

const SINGLE_INSTANCE_PORT = 57631;

function acquireSingleInstanceLock() {
  const server = net.createServer();

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Ya hay una instancia del bot corriendo (puerto ${SINGLE_INSTANCE_PORT} en uso). Cierra la otra antes de iniciar.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(SINGLE_INSTANCE_PORT, '127.0.0.1', () => {
    console.log(`[Lock] Instancia única adquirida (127.0.0.1:${SINGLE_INSTANCE_PORT})`);
  });

  process.on('exit', () => {
    try { server.close(); } catch {}
  });

  return server;
}

module.exports = { acquireSingleInstanceLock };