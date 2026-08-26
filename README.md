Discord Music Bot (discord.js)

Instalación rápida:

1. Instala dependencias:

```bash
npm install
```

> **Nota:** `ffmpeg` y `yt-dlp` vienen incluidos como dependencias npm (`ffmpeg-static` y `youtube-dl-exec`), así que no necesitas instalarlos en tu sistema.

2. Crea un archivo `.env` en la raíz con:

```
DISCORD_TOKEN=tu_token
CLIENT_ID=tu_client_id
GUILD_ID=tu_guild_id   # opcional, útil para registros en guild específico
YTDLP_COOKIES=ruta/a/cookies.txt   # opcional, ver nota de cookies abajo
```

### Cookies de YouTube

YouTube bloquea a menudo la extracción anónima con "Sign in to confirm
you're not a bot". Si `/play` falla con ese error, exporta tus cookies de
YouTube en formato Netscape y deja el archivo en la raíz del proyecto como
`cookies.txt` (o apúntalo con `YTDLP_COOKIES` en `.env`).

**Cómo exportarlas correctamente** (recomendación oficial de yt-dlp): no uses
`--cookies-from-browser`, porque YouTube rota esas cookies al abrir YouTube en
el navegador normal y dejan de servir a los pocos días. En su lugar:

1. Abre una **ventana de incógnito** e inicia sesión en YouTube.
2. En esa misma pestaña entra en `https://www.youtube.com/robots.txt`.
3. Con una extensión tipo "Get cookies.txt LOCALLY" exporta solo las cookies
   de `youtube.com` desde esa pestaña.
4. Cierra la ventana de incógnito sin abrir YouTube de nuevo: así la sesión no
   se rota y dura mucho más.

El bot detecta el archivo automáticamente y añade `--cookies cookies.txt` a
todas las llamadas de yt-dlp. Al arrancar imprime el estado:
`[cookies] archivo: /ruta/cookies.txt (disponible)`.

**En un hosting (Pterodactyl u otro) sin gestor de archivos:** puedes pasar el
contenido del archivo por la variable de entorno `YTDLP_COOKIES_CONTENT`
(cada salto de línea como `\n`) y el bot lo escribe en disco al arrancar:

```
YTDLP_COOKIES_CONTENT=# Netscape HTTP Cookie File\nyoutube.com... etc
```

`cookies.txt` contiene credenciales sensibles y está excluido de git
(`.gitignore`). Las cookies caducan; re-expórtalas periódicamente.

### Bloqueo "Sign in to confirm you're not a bot"

Causas típicas, ordenadas por probabilidad:

1. **Versión antigua de yt-dlp**: YouTube rompe clientes en cada cambio de API.
   El bot registra la versión en el arranque (`[yt-dlp] versión del binario:`)
   y se auto-actualiza en segundo plano a la última estable (apagable con
   `YTDLP_AUTO_UPDATE=0`). También puedes forzarla a mano con
   `npm run update-yt-dlp`. Si tu hosting no puede descargar de GitHub, fija un
   binario propio con `YTDLP_BIN=/ruta/yt-dlp`.
2. **IP de datacenter marcada por YouTube** (hosting tipo Pterodactyl/VPS): aun
   con cookies válidas, todos los clientes pueden recibir ese mensaje. Es el
   caso más difícil y tiene estas soluciones, de mayor a menor eficacia:
   - **PO Token Provider** (solución recomendada por yt-dlp): instala el plugin
     [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
     con un solo comando:

     ```bash
     npm run setup-pot-provider
     ```

     Deja el plugin en `yt-dlp-plugins/` (el bot añade automáticamente
     `--plugin-dirs` a cada llamada de yt-dlp) e instala el generador de tokens
     en modo script en `~/bgutil-ytdlp-pot-provider` (sin Docker ni procesos
     extra; requiere Node >= 20 y acceso a registry.npmjs.org). Después
     **reinicia el bot** y prueba con `npm run yt-test`. Si en los logs de
     yt-dlp ves `timed out after 15.0 seconds` (el límite de 15 s del modo
     script es fijo y no configurable en yt-dlp), levanta en su lugar el
     generador HTTP persistente y reinicia:

     ```bash
     docker run -d --name bgutil-provider --init \
       -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider
     npm run setup-pot-provider   # el plugin ya está; esto solo asegura que el generador viva
     ```

     El plugin prioriza el servidor HTTP sobre el script cuando responde en su
     puerto por defecto. Como alternativa manual, sigue las instrucciones del
     README del plugin (servidor HTTP en Node/Docker o modo script); sin
     generador, el plugin no puede emitir tokens. Variable de entorno:
     `BGUTIL_TAG=<versión>` fija la versión y `BGUTIL_HOME=<ruta>` cambia dónde
     se instala el generador.
   - **Proxy residencial**: `YTDLP_PROXY=http://user:pass@host:port` en el panel
     o `.env`. Enruta solo yt-dlp, no el resto del bot.
   - **Renovar cookies** con el método de incógnito de arriba; unas cookies
     caducadas pueden *provocar* el bot-check en vez de evitarlo (la cadena de
     reintento también prueba los últimos intentos sin cookies por esto).
3. **Límite de peticiones**: YouTube permite ~300 vídeos/hora como anónimo y
   ~2000/hora con cuenta. Un uso intensivo (playlists grandes, autoplay) puede
   disparar comprobaciones temporales.

Diagnóstico desde la consola del hosting — prueba la cadena de clientes que usa
el bot y dice cuál pasa el bloqueo desde esa IP:

```bash
npm run yt-test
```

Si algún cliente individual funciona, fíjalo para saltarte los anteriores:

```
# uno concreto...
YTDLP_PLAYER_CLIENT=android_vr
# ...o varios, separados por comas (se probarán en ese orden)
YTDLP_PLAYER_CLIENT=tv_simply,tv,android_vr
```

Variables de entorno relacionadas (`.env` o panel):

- `YTDLP_PLAYER_CLIENT=<cliente[,cliente2]>` — fuerza el/los player clients.
- `YTDLP_PROXY=<url>` — proxy http/https/socks5 solo para yt-dlp.
- `YTDLP_COOKIES`, `YTDLP_COOKIES_CONTENT` — ver sección de cookies.
- `YTDLP_BIN=<ruta>` — usa un binario de yt-dlp externo (desactiva auto-update).
- `YTDLP_AUTO_UPDATE=0` — desactiva el auto-update del arranque.
- `YTDLP_PLUGIN_DIRS=<ruta>` — directorio(s) de plugins; por defecto se usa
  `yt-dlp-plugins/` de la raíz si existe.

3. Ejecuta el bot:

```bash
npm start
```

Comandos slash (todos responden con embeds, sin emojis):
- `/play <query_or_url>`: encola y reproduce. Acepta búsquedas, URL de vídeo y playlists. Muestra la miniatura del video, canal, duración y solicitante.
- `/skip`: salta la pista actual.
- `/pause`: pausa la reproducción.
- `/resume`: reanuda la reproducción.
- `/queue`: muestra la cola con la foto de la pista actual.
- `/nowplaying`: muestra la pista que suena ahora con su miniatura y estado (sonando / pausada / cargando / detenida).
- `/autoplay`: activa/desactiva el autoplay "radio similar". En cuanto se activa (o al empezar a sonar una canción), el bot **pre-carga en segundo plano** una cola de ~10 pistas del mismo estilo musical (usando el radio/mix de YouTube de la canción que suena), así al terminar una canción la siguiente ya está lista y no hay silencio. El estado se guarda solo mientras el bot permanece en el canal de voz; si el bot sale del VC, el autoplay se apaga solo.

Estructura del proyecto:

```
src/
  index.js           # Punto de entrada: cliente, registro de comandos y routing de interacciones
  commands/          # Un archivo por comando slash
    play.js          # /play (embed con miniatura)
    skip.js          # /skip
    pause.js         # /pause
    resume.js        # /resume
    queue.js         # /queue (embed con la foto de la pista actual)
    nowplaying.js    # /nowplaying (pista actual + estado)
    autoplay.js      # /autoplay (activa/desactiva la radio del mismo estilo)
  core/              # Infraestructura y configuración de la app
    config.js        # Configuración y constantes (token, rutas de binarios)
    lock.js          # Bloqueo de instancia única (evita interacciones duplicadas / 10062)
  discord/           # Capa de presentación de Discord
    reply.js         # Helpers de respuesta segura ante DiscordAPIError
    embeds.js        # Constructores de embeds reutilizables (miniatura, cola, avisos, etc.)
  media/             # Extracción y procesamiento multimedia
    ytdlp.js         # Helpers para yt-dlp (URL directa, JSON, resolver pistas, playlists)
    ytdlpUpdater.js  # Auto-update del binario de yt-dlp (arranque y npm run update-yt-dlp)
    ffmpeg.js        # Helper para transcode de audio con ffmpeg-static
  voice/             # Motor de reproducción de audio
    player.js        # Reproductor (cola, conexión de voz, autoplay "radio similar")
```

Notas:
- Se usa la herramienta `yt-dlp` (bundled en `youtube-dl-exec`) para obtener el stream de audio y `ffmpeg-static` para convertir/transcodificar el audio a PCM para Discord.
- **Node.js >= 22.12.0 requerido** (requisito de `@discordjs/voice`).
