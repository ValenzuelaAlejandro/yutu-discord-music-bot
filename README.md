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
```

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
- `/autoplay`: activa/desactiva el autoplay "radio similar". En cuanto se activa (o al empezar a sonar una canción), el bot **pre-carga en segundo plano** una cola de ~10 pistas del mismo estilo musical (usando el radio/mix de YouTube de la canción que suena), así al terminar una canción la siguiente ya está lista y no hay silencio. El estado se guarda solo mientras el bot permanece en el canal de voz; si el bot sale del VC, el autoplay se apaga solo.

Estructura del proyecto:

```
src/
  index.js           # Entry point: cliente, registro de comandos y routing de interacciones
  config.js          # Configuración y constantes (token, rutas de binarios)
  lock.js            # Bloqueo de instancia única (evita interacciones duplicadas / 10062)
  reply.js           # Helpers de respuesta segura ante DiscordAPIError
  embeds.js          # Constructores de embeds reutilizables (miniatura del video, cola, etc.)
  ytdlp.js           # Helpers para yt-dlp (URL directa, JSON, resolver pistas, playlists)
  ffmpeg.js          # Helper para transcode de audio con ffmpeg-static
  audio.js           # Subsistema de audio (cola, reproductor, conexión de voz)
  commands/          # Cada comando slash en su propio archivo
    play.js          # /play (embed con miniatura)
    skip.js          # /skip
    pause.js         # /pause
    resume.js        # /resume
    queue.js         # /queue (embed con la foto de la pista actual)
    autoplay.js      # /autoplay (activa/desactiva la radio del mismo estilo)
```

Notas:
- Se usa la herramienta `yt-dlp` (bundled en `youtube-dl-exec`) para obtener el stream de audio y `ffmpeg-static` para convertir/transcodificar el audio a PCM para Discord.
- **Node.js >= 22.12.0 requerido** (requisito de `@discordjs/voice`).
