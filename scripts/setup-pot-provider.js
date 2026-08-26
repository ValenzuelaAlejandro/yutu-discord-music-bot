#!/usr/bin/env node
// Instala el proveedor de PO Tokens de YouTube (bgutil-ytdlp-pot-provider),
// la solución recomendada por yt-dlp contra el bloqueo "Sign in to confirm
// you're not a bot" en IPs de datacenter (hosting tipo Pterodactyl/VPS).
//
// Qué hace:
//  1. Plugin de yt-dlp: descarga el zip oficial de la última release a
//     <raíz>/yt-dlp-plugins/. El bot ya pasa --plugin-dirs cuando esa carpeta
//     existe, y yt-dlp carga los plugins empaquetados en zip tal cual.
//  2. Generador de tokens (modo script): descarga el código fuente de la MISMA
//     versión y lo compila en ~/bgutil-ytdlp-pot-provider (ruta por defecto que
//     el plugin autodetecta, sin configurar nada). Requiere Node >= 20 y acceso
//     al registry de npm (`npm ci` + `npx tsc`). Sin Docker ni procesos extra:
//     el plugin lanza el script él mismo cuando necesita un token.
//
// Tras instalarlo, reinicia el bot y comprueba con: npm run yt-test
// Uso: npm run setup-pot-provider
// Opcionales: BGUTIL_TAG=<versión>  fija la versión del generador (por defecto: última)
//             BGUTIL_HOME=<ruta>    instala el generador en otra ruta

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const config = require('../src/core/config');

const GH_API_RELEASE = 'https://api.github.com/repos/Brainicism/bgutil-ytdlp-pot-provider/releases/latest';
const PLUGIN_ZIP_URL = 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip';
const TARBALL_URL = (tag) => `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/${tag}.tar.gz`;
const HEADERS = { 'user-agent': 'yutu-discord-music-bot', accept: 'application/vnd.github+json' };

const PLUGINS_DIR = path.join(__dirname, '..', 'yt-dlp-plugins');
// Versión mínima de yt-dlp exigida por el framework de PO Token Providers.
const MIN_YTDLP = [2025, 5, 22];

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: -1, out: e.message }));
  });
}

async function runInherited(bin, args, cwd) {
  console.log(`[pot] $ ${bin} ${args.join(' ')}`);
  const code = await new Promise((resolve) => {
    // En Windows npm/npx son .cmd: desde el parche de seguridad de Node hay que
    // lanzarlos con shell o spawn devuelve EINVAL.
    const child = spawn(bin, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', resolve);
    child.on('error', () => resolve(-1));
  });
  if (code !== 0) throw new Error(`${bin} ${args.join(' ')} falló (exit ${code})`);
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`descarga HTTP ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function fetchLatestTag() {
  const res = await fetch(GH_API_RELEASE, { headers: HEADERS });
  if (!res.ok) throw new Error(`GitHub API respondió ${res.status}`);
  const payload = await res.json();
  if (!payload.tag_name) throw new Error('release sin tag_name');
  return String(payload.tag_name).trim();
}

async function checkYtDlpVersion() {
  const { code, out } = await run(config.getYtDlpBin(), ['--version']);
  const m = out.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (code !== 0 || !m) throw new Error(`no se pudo determinar la versión de yt-dlp (${out.trim() || 'sin salida'})`);
  const parts = m.slice(1).map(Number);
  const [y, mo, d] = parts;
  const [minY, minMo, minD] = MIN_YTDLP;
  const outdated = y < minY || (y === minY && (mo < minMo || (mo === minMo && d < minD)));
  if (outdated) {
    throw new Error(`tu yt-dlp (${parts.join('.')}) es anterior a la mínima soportada por el plugin (2025.05.22); ejecuta antes: npm run update-yt-dlp`);
  }
  console.log(`[pot] yt-dlp ${parts.join('.')} OK`);
}

// ---------------------------------------------------------------------------
// 1) Plugin de yt-dlp: el zip oficial se deja tal cual en <raíz>/yt-dlp-plugins/
//    (yt-dlp carga plugins empaquetados en zip; el bot añade --plugin-dirs).
// ---------------------------------------------------------------------------
async function installPluginZip() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const dest = path.join(PLUGINS_DIR, 'bgutil-ytdlp-pot-provider.zip');
  console.log(`[pot] descargando plugin -> ${dest}`);
  await downloadTo(PLUGIN_ZIP_URL, dest);
  // Verificación mínima: firma "PK" de un zip válido.
  const fd = fs.openSync(dest, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  if (magic.toString('ascii') !== 'PK') throw new Error('el zip del plugin descargado no es válido');
  console.log('[pot] plugin instalado');
}

// ---------------------------------------------------------------------------
// 2) Generador de tokens en modo script: ~/bgutil-ytdlp-pot-provider (ruta por
//    defecto que el plugin autodetecta). Compilado con npm ci + tsc.
// ---------------------------------------------------------------------------
function providerHome() {
  return process.env.BGUTIL_HOME
    ? path.resolve(process.env.BGUTIL_HOME)
    : path.join(os.homedir(), 'bgutil-ytdlp-pot-provider');
}

function npmCmd(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

async function installProvider(tag) {
  const home = providerHome();
  const marker = path.join(home, '.yutu-setup-version');
  const builtMain = path.join(home, 'server', 'build', 'main.js');
  if (fs.existsSync(builtMain)
      && fs.existsSync(marker)
      && fs.readFileSync(marker, 'utf8').trim() === tag) {
    console.log(`[pot] generador ya instalado en ${home} (versión ${tag})`);
    return;
  }

  // Si ya hay una fuente de la misma versión (instalación interrumpida a medias),
  // se reutiliza en vez de descargar y extraer otra vez.
  const pkgFile = path.join(home, 'server', 'package.json');
  let reuseSource = false;
  try {
    reuseSource = fs.existsSync(pkgFile)
      && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version === String(tag).replace(/^v/, '');
  } catch { /* versión desconocida: se reinstala */ }

  if (!reuseSource) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bgutil-'));
    try {
      console.log(`[pot] descargando fuente del generador (${tag})...`);
      const tgz = path.join(tmpRoot, 'src.tar.gz');
      await downloadTo(TARBALL_URL(tag), tgz);

      console.log('[pot] extrayendo...');
      const { code, out } = await run('tar', ['-xzf', tgz, '-C', tmpRoot]);
      if (code !== 0) throw new Error(`tar no pudo extraer el tarball (${out.trim().slice(0, 200)}). ¿Está 'tar' en el PATH?`);
      const extractedDir = fs.readdirSync(tmpRoot)
        .find((n) => n.startsWith('bgutil-ytdlp-pot-provider'));
      if (!extractedDir) throw new Error('contenido inesperado del tarball');
      if (fs.existsSync(home)) fs.rmSync(home, { recursive: true, force: true });
      fs.renameSync(path.join(tmpRoot, extractedDir), home);
    } finally {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  } else {
    console.log(`[pot] fuente ya presente en ${home} (versión ${tag}); reutilizando`);
  }

  const serverDir = path.join(home, 'server');

  // --include=dev: TypeScript vive en devDependencies y algunos entornos
  // (NODE_ENV=production, .npmrc con omit=dev...) los omitirían.
  console.log('[pot] instalando dependencias del generador (npm ci; puede tardar)...');
  await runInherited(npmCmd('npm'), ['ci', '--include=dev'], serverDir);

  // Red de seguridad: sin TypeScript local, npx resolvería el paquete equivocado
  // ("tsc", un placeholder antiguo) o se quedaría esperando confirmación.
  if (!fs.existsSync(path.join(serverDir, 'node_modules', 'typescript'))) {
    console.log('[pot] TypeScript no vino con npm ci; instalándolo aparte...');
    await runInherited(npmCmd('npm'), ['install', '--no-save', 'typescript'], serverDir);
  }

  console.log('[pot] compilando generador (tsc)...');
  // --yes evita el prompt interactivo de npx en entornos no interactivos.
  await runInherited(npmCmd('npx'), ['--yes', 'tsc'], serverDir);

  if (!fs.existsSync(builtMain)) throw new Error('la compilación no produjo server/build/main.js');
  fs.writeFileSync(marker, `${tag}\n`);
  console.log(`[pot] generador instalado en ${home}`);
}

(async () => {
  try {
    console.log('=== setup-pot-provider: proveedor de PO Tokens (bgutil) para yt-dlp ===');
    await checkYtDlpVersion();
    const tag = process.env.BGUTIL_TAG || await fetchLatestTag();
    console.log(`[pot] versión del proveedor: ${tag}`);
    await installPluginZip();
    await installProvider(tag);

    console.log('\n[pot] Listo. Pasos siguientes:');
    console.log('  1. Reinicia el bot (el directorio de plugins se detecta al arrancar).');
    console.log('  2. Comprueba con: npm run yt-test');
    console.log('\nNotas:');
    console.log('- El generador quedó COMPILADO en modo "script" en ~/bgutil-ytdlp-pot-provider:');
    console.log('  yt-dlp lo autodetecta y genera su token al vuelo con cada extracción.');
    console.log('  OJO: el plugin limita a 15 s (fijo, no configurable) el tiempo del check de');
    console.log('  disponibilidad; en máquinas muy lentas el propio check puede agotar ese límite.');
    console.log('  Si ves "Command ... timed out after 15.0 seconds" en yt-dlp, usa el servidor');
    console.log('  HTTP persistente (recomendado para este caso):');
    console.log('    docker run --name bgutil-provider -d --init -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider');
    console.log('    # y reinicia el bot; el plugin prioriza el servidor sobre el script.');
    console.log('- Un PO Token no lo garantiza todo; si aun así sigues bloqueado,');
    console.log('  queda el proxy residencial (YTDLP_PROXY) o renovar cookies.');
  } catch (err) {
    console.error('\n[pot] error:', err?.message || err);
    console.error('[pot] Pasos manuales: https://github.com/Brainicism/bgutil-ytdlp-pot-provider#installation');
    process.exitCode = 1;
  }
})();
