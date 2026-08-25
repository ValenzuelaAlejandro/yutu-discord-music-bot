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

YouTube con frecuencia bloquea la extracción sin autenticación con
"Sign in to confirm you're not a bot". Si `/play` falla con ese error, exporta
tus cookies de YouTube en formato Netscape y deja el archivo en la raíz del
proyecto como `cookies.txt` (o apúntalo con `YTDLP_COOKIES` en `.env`):

```bash
yt-dlp --cookies-from-browser chrome --cookies cookies.txt
```

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
    ffmpeg.js        # Helper para transcode de audio con ffmpeg-static
  voice/             # Motor de reproducción de audio
    player.js        # Reproductor (cola, conexión de voz, autoplay "radio similar")
```

Notas:
- Se usa la herramienta `yt-dlp` (bundled en `youtube-dl-exec`) para obtener el stream de audio y `ffmpeg-static` para convertir/transcodificar el audio a PCM para Discord.
- **Node.js >= 22.12.0 requerido** (requisito de `@discordjs/voice`).
