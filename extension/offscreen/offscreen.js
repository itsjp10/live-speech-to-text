const MAX_RECONNECT_ATTEMPTS = 3;

let ws = null;
let audioContext = null;
let sourceNode = null;
let workletNode = null;
let mediaStream = null;

let stopping = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let receivedServerError = false;
let currentWsUrl = null;
let currentQuery = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'offscreen') return;

  if (message.type === 'START_CAPTURE') {
    startCapture(message.streamId, message.wsUrl, message.config).catch((err) => {
      reportStatus('error', describeCaptureError(err));
      cleanupAudio();
    });
  } else if (message.type === 'STOP_CAPTURE') {
    stopCapture();
  }
});

function describeCaptureError(err) {
  if (err?.name === 'NotAllowedError') {
    return 'Permission to capture tab audio was denied.';
  }
  if (err?.name === 'NotFoundError') {
    return 'No audio source was found for this tab.';
  }
  return err?.message || 'Could not start capturing tab audio.';
}

async function startCapture(streamId, wsUrl, config) {
  if (mediaStream) return; // already capturing

  stopping = false;
  reconnectAttempts = 0;
  receivedServerError = false;
  reportStatus('connecting');

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // Tab capture mutes the tab by default; reconnect it to the speakers so
  // the user keeps hearing the audio while it's being transcribed.
  sourceNode.connect(audioContext.destination);

  await audioContext.audioWorklet.addModule(
    chrome.runtime.getURL('offscreen/pcm-worklet-processor.js')
  );
  workletNode = new AudioWorkletNode(audioContext, 'pcm-worklet-processor', {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  sourceNode.connect(workletNode);
  // Keep the worklet "live" in the graph without adding audible output
  // (the processor never writes to its output buffer, so this stays silent).
  workletNode.connect(audioContext.destination);

  workletNode.port.onmessage = (event) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  };

  reportStatus('capturing');

  currentWsUrl = wsUrl;
  currentQuery = new URLSearchParams({
    sampleRate: String(audioContext.sampleRate),
    channels: '1',
    language: config?.language || 'en',
  }).toString();

  connectWebSocket();
}

function connectWebSocket() {
  ws = new WebSocket(`${currentWsUrl}?${currentQuery}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    reconnectAttempts = 0;
    receivedServerError = false;
    // Stay on 'capturing' until the backend confirms Deepgram is actually
    // ready — the WS to our own backend opening doesn't guarantee that yet.
  });

  ws.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'error') {
      receivedServerError = true;
      reportStatus('error', data.message);
    } else if (data.type === 'ready') {
      reportStatus('listening');
    } else {
      chrome.runtime
        .sendMessage({ target: 'background', type: 'OFFSCREEN_TRANSCRIPT', payload: data })
        .catch(() => {});
    }
  });

  ws.addEventListener('close', () => {
    if (stopping) {
      reportStatus('stopped');
      cleanupAudio();
      return;
    }
    if (receivedServerError) {
      // Backend already told us exactly why (bad key, Deepgram failure,
      // etc.) — retrying blindly would just repeat the same failure.
      stopCapture();
      return;
    }
    attemptReconnect();
  });

  ws.addEventListener('error', () => {
    // 'close' always follows 'error' for browser WebSockets, so recovery
    // logic lives entirely in the close handler to avoid double-handling.
  });
}

function attemptReconnect() {
  if (stopping || !mediaStream) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    reportStatus('error', 'Lost connection to the backend and could not reconnect. Is it running?');
    stopCapture();
    return;
  }

  reconnectAttempts += 1;
  reportStatus('connecting', `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);

  const delay = 1000 * 2 ** (reconnectAttempts - 1);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function stopCapture() {
  stopping = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'stop' }));
    } catch {
      // ignore, we're closing anyway
    }
    setTimeout(() => ws && ws.close(), 300);
  } else if (ws) {
    ws.close();
  } else {
    reportStatus('stopped');
  }

  cleanupAudio();
}

function cleanupAudio() {
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function reportStatus(status, error) {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'OFFSCREEN_STATUS', status, error })
    .catch(() => {});
}
