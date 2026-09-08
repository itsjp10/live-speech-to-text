# Live Speech-to-Text (Tab Audio)

Extensión de Chrome (Manifest V3) que captura el **audio que reproduce una pestaña** (YouTube, una videollamada, un podcast, etc.) y lo transcribe en tiempo real usando **Deepgram Speech-to-Text**, a través de un backend en Express que hace de puente.

No usa el micrófono. Captura el audio de salida de la pestaña con `chrome.tabCapture`.

## Arquitectura

```
Extensión (offscreen doc)          Backend (Express)              Deepgram
  tabCapture → getUserMedia
  → AudioWorklet (PCM16)
  → WebSocket ───────────────→  /ws/transcribe  ───────────────→  Live API
                                  (guarda DEEPGRAM_API_KEY)
  ←──────────── transcripts JSON (Results/Metadata) ←──────────────┘
```

La API key de Deepgram vive **solo en el backend** (`server/.env`). La extensión nunca la ve.

## Estructura del proyecto

```
live-speech-to-text/
├── server/                          # Backend Express
│   ├── server.js                    # HTTP server + wiring del WebSocket
│   ├── services/deepgram.js         # Cliente Deepgram (@deepgram/sdk)
│   ├── ws/transcribeSocket.js       # Puente WebSocket: extensión ↔ Deepgram
│   ├── test/                        # Tests (node:test)
│   ├── .env                         # Variables de entorno (no se sube a git)
│   └── .env.example
└── extension/                       # Extensión Chrome (Manifest V3)
    ├── manifest.json
    ├── background/service-worker.js # Orquesta tabCapture + offscreen doc
    ├── offscreen/                   # Captura de audio real (AudioWorklet)
    └── popup/                       # UI: Start/Stop, estado, transcript
```

## Requisitos

- Node.js 18+ (probado con Node 24)
- Google Chrome 116+
- Una API key de [Deepgram](https://console.deepgram.com/)

## 1. Configurar y correr el backend

```bash
cd server
npm install
```

Completá `server/.env` (ya existe, editalo con tu key real):

```env
PORT=3000
DEEPGRAM_API_KEY=tu_api_key_real
DEEPGRAM_MODEL=nova-3        # opcional, default nova-3
```

Levantar el servidor:

```bash
npm run dev     # con auto-reload (nodemon)
# o
npm start       # sin auto-reload
```

Deberías ver `Servidor en http://localhost:3000`. Verificá que esté sano y que la key esté cargada:

```bash
curl http://localhost:3000/health
# {"status":"ok","deepgramConfigured":true}
```

Correr los tests del backend:

```bash
npm test
```

## 2. Cargar la extensión en Chrome

1. Andá a `chrome://extensions`
2. Activá **"Modo de desarrollador"** (arriba a la derecha)
3. Clic en **"Cargar descomprimida"**
4. Seleccioná la carpeta `extension/` de este proyecto
5. (Opcional) Fijá la extensión en la barra de herramientas

La extensión asume que el backend corre en `ws://localhost:3000`. Si cambiás el puerto en `.env`, actualizá también la constante `BACKEND_WS_URL` en `extension/background/service-worker.js` y `BACKEND_HEALTH_URL` en `extension/popup/popup.js`.

## 3. Probarla (ejemplo con YouTube)

1. Con el backend corriendo, abrí un video de YouTube y dejalo reproduciendo
2. Clic en el ícono de la extensión
3. Elegí el idioma del audio (o "Multilingual (auto)")
4. **"Start Transcription"** — vas a ver `Connecting…` → `Capturing audio…` → `Transcribing`
5. El audio del video se sigue escuchando normalmente; el texto va apareciendo en vivo (gris/cursiva = parcial, texto fijo = final confirmado por Deepgram)
6. **"Stop"** para cortar la captura y cerrar la conexión

## Permisos de la extensión

| Permiso | Por qué |
|---|---|
| `tabCapture` | Única forma de obtener el stream de audio de una pestaña |
| `offscreen` | El service worker no tiene acceso a DOM/Web Audio API; el offscreen document sí, y sobrevive aunque el popup se cierre |

No usa `activeTab`, `scripting`, `tabs` ni `host_permissions` — no son necesarios para este flujo.

## Limitaciones conocidas

- Requiere Chrome 116+ (`tabCapture.getMediaStreamId` no existe antes)
- No funciona en páginas `chrome://`, la Web Store, ni pestañas sin audio
- Capturar la pestaña la silencia por defecto; la extensión reconecta el audio a los parlantes manualmente
- Solo puede haber un offscreen document activo por extensión a la vez

## Variables de entorno (`server/.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `DEEPGRAM_API_KEY` | Sí | API key de Deepgram. Sin ella, `/ws/transcribe` rechaza la conexión |
| `PORT` | No | Puerto del backend (default `3000`) |
| `DEEPGRAM_MODEL` | No | Modelo de Deepgram (default `nova-3`) |
