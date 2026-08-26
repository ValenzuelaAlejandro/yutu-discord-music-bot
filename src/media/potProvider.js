// Supervisor del proveedor de PO Tokens de YouTube (bgutil-ytdlp-pot-provider).
//
// El servidor HTTP que emite los PO Tokens no debe depender del comando de
// arranque del hosting (que en contenedores tipo Bot-Hosting/Pterodactyl es
// volátil: cualquier proceso en segundo plano muere al reiniciar o porque el
// startup cambia). Por eso el propio bot lo levanta y lo mantiene vivo:
//  - Si el generador compilado existe (instalado por npm run setup-pot-provider),
//    se lanza como proceso hijo con logs en <raíz>/logs/pot-provider.log.
//  - Se vigila cada pocos segundos y, si se cae, se relanza solo.
//  - Apagable con YTDLP_POT_PROVIDER=0 (por si se prefiere gestionarlo externo,
//    p.ej. vía Docker).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Rutas posibles del generador compilado.
function candidatePaths() {
  const repo = path.join(__dirname, '..', '..');
  const build = 'bgutil-ytdlp-pot-provider/server/build/main.js';
  return [
    path.join(repo, build),
    path.join(os.homedir(), build),
    process.env.YTDLP_POT_RUNTIME,
  ].filter(Boolean);
}

function findProviderMain() {
  for (const p of candidatePaths()) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch { /* sigue */ }
  }
  return null;
}

const PROVIDER_MAIN = findProviderMain();
const RESTART_DELAY_MS = 4000;

let proc = null;
let timer = null;
let shuttingDown = false;

function pathToLogs() {
  try {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    return path.join(logsDir, 'pot-provider.log');
  } catch {
    return path.join(process.cwd(), 'pot-provider.log');
  }
}

function startProviderProc() {
  const logFile = pathToLogs();
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [PROVIDER_MAIN], {
    stdio: ['ignore', out, err],
  });
  fs.closeSync(out);
  fs.closeSync(err);
  child.on('exit', (code, signal) => {
    const why = signal ? `señal ${signal}` : `código ${code}`;
    if (!shuttingDown) console.warn(`[pot-provider] el servidor terminó (${why}); se relanza`);
    proc = null;
  });
  child.unref();
  proc = child;
  console.log(`[pot-provider] servidor de PO Tokens en marcha (${PROVIDER_MAIN})`);
}

function supervisorTick() {
  if (shuttingDown || !PROVIDER_MAIN) return;
  if (proc && proc.exitCode === null && proc.signalCode === null) return; // vivo
  startProviderProc();
}

function startPotProvider() {
  if (!PROVIDER_MAIN) {
    console.log('[pot-provider] generador no encontrado; ejecuta antes: npm run setup-pot-provider');
    return;
  }
  if (process.env.YTDLP_POT_PROVIDER === '0') {
    console.log('[pot-provider] desactivado por YTDLP_POT_PROVIDER=0');
    return;
  }
  startProviderProc();
  timer = setInterval(supervisorTick, RESTART_DELAY_MS);
}

function stopPotProvider() {
  shuttingDown = true;
  if (timer) clearInterval(timer);
  if (proc && proc.exitCode === null) {
    try { proc.kill('SIGTERM'); } catch { /* ya salio */ }
  }
}

if (typeof process.on === 'function') {
  process.on('exit', stopPotProvider);
  process.on('SIGINT', stopPotProvider);
  process.on('SIGTERM', stopPotProvider);
}

module.exports = { startPotProvider, stopPotProvider };