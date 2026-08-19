const { WebSocketServer } = require('ws');
const { createLiveConnection } = require('../services/deepgram');

const FINALIZE_GRACE_MS = 1200;
const DEEPGRAM_OPEN_TIMEOUT_MS = 8000;

// Reads the audio config the extension puts on the WS URL's query string
// (?sampleRate=48000&channels=1&language=en) and falls back to sane
// defaults so a malformed/missing query string never crashes the socket.
function parseConfig(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  const sampleRate = Number(url.searchParams.get('sampleRate'));
  const channels = Number(url.searchParams.get('channels'));
  const language = url.searchParams.get('language');

  return {
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000,
    channels: Number.isFinite(channels) && channels > 0 ? channels : 1,
    language: language || 'en',
  };
}

function safeSend(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function safeClose(deepgramConnection) {
  try {
    deepgramConnection.close();
  } catch {
    // Connection may already be closed/closing; nothing to do.
  }
}

function attachTranscriptionSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/transcribe' });

  wss.on('connection', async (clientSocket, request) => {
    if (!process.env.DEEPGRAM_API_KEY) {
      safeSend(clientSocket, {
        type: 'error',
        message: 'Server misconfigured: DEEPGRAM_API_KEY is missing.',
      });
      clientSocket.close(1011, 'Missing DEEPGRAM_API_KEY');
      return;
    }

    const config = parseConfig(request.url);

    let deepgramConnection;
    try {
      deepgramConnection = await createLiveConnection(config);
    } catch (err) {
      safeSend(clientSocket, { type: 'error', message: 'Could not reach Deepgram.' });
      clientSocket.close(1011, 'Deepgram connection failed');
      return;
    }

    let deepgramReady = false;
    let clientCloseInitiated = false; // guards against closing clientSocket twice
    let pendingChunks = [];

    function closeClientSocket(code, reason) {
      if (clientCloseInitiated) return;
      clientCloseInitiated = true;
      if (clientSocket.readyState === clientSocket.OPEN) {
        clientSocket.close(code, reason);
      }
    }

    const openTimeout = setTimeout(() => {
      if (!deepgramReady) {
        safeSend(clientSocket, { type: 'error', message: 'Timed out connecting to Deepgram.' });
        closeClientSocket(1011, 'Deepgram connect timeout');
        safeClose(deepgramConnection);
      }
    }, DEEPGRAM_OPEN_TIMEOUT_MS);

    deepgramConnection.on('open', () => {
      clearTimeout(openTimeout);
      deepgramReady = true;
      for (const chunk of pendingChunks) {
        deepgramConnection.sendMedia(chunk);
      }
      pendingChunks = [];
      safeSend(clientSocket, { type: 'ready' });
    });

    // Deepgram transcript/metadata events are already JSON-shaped
    // ({ type: 'Results' | 'Metadata', ... }); relay them as-is.
    deepgramConnection.on('message', (data) => {
      safeSend(clientSocket, data);
    });

    // This SDK version can emit 'close' before 'error' (verified against a
    // rejected API key: close fires first, then error arrives a tick later).
    // Notifying the client synchronously from 'close' would race that error
    // detail, so we hold the client-facing close for one tick and let a
    // same-tick 'error' fill in the reason first.
    let lastErrorMessage = null;

    function notifyClientAndClose() {
      if (clientCloseInitiated) return; // already closing (e.g. client-requested stop)
      const message = deepgramReady
        ? undefined
        : lastErrorMessage || 'Could not establish a Deepgram connection.';
      if (message) {
        safeSend(clientSocket, { type: 'error', message });
      }
      closeClientSocket(1011, 'Deepgram connection closed');
    }

    deepgramConnection.on('error', (err) => {
      lastErrorMessage =
        typeof err?.message === 'string' && err.message.includes('401')
          ? 'Deepgram rejected the API key (401). Check DEEPGRAM_API_KEY.'
          : 'Deepgram reported an error.';
    });

    deepgramConnection.on('close', () => {
      clearTimeout(openTimeout);
      setTimeout(notifyClientAndClose, 50);
    });

    deepgramConnection.connect();

    clientSocket.on('message', (message, isBinary) => {
      if (!isBinary) {
        handleControlMessage(message);
        return;
      }
      if (deepgramReady) {
        deepgramConnection.sendMedia(message);
      } else {
        pendingChunks.push(message);
      }
    });

    function handleControlMessage(raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (parsed?.type === 'stop') {
        if (deepgramReady) {
          try {
            deepgramConnection.sendFinalize({ type: 'Finalize' });
          } catch {
            // Best-effort flush; fall through to close regardless.
          }
          setTimeout(() => {
            safeClose(deepgramConnection);
            closeClientSocket(1000, 'Stopped by client');
          }, FINALIZE_GRACE_MS);
        } else {
          safeClose(deepgramConnection);
          closeClientSocket(1000, 'Stopped by client');
        }
      }
    }

    clientSocket.on('close', () => {
      clientCloseInitiated = true; // the client itself already closed
      clearTimeout(openTimeout);
      safeClose(deepgramConnection);
    });

    clientSocket.on('error', () => {
      clientCloseInitiated = true;
      clearTimeout(openTimeout);
      safeClose(deepgramConnection);
    });
  });

  return wss;
}

module.exports = { attachTranscriptionSocket, parseConfig };
