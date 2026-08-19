const BACKEND_HEALTH_URL = 'http://localhost:3000/health';

const STATUS_LABELS = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  capturing: 'Capturing audio…',
  listening: 'Transcribing',
  stopped: 'Disconnected',
  error: 'Error',
};

const RUNNING_STATUSES = new Set(['connecting', 'capturing', 'listening']);

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusBadge = document.getElementById('status-badge');
const listeningDot = document.getElementById('listening-dot');
const infoBanner = document.getElementById('info-banner');
const finalTranscriptEl = document.getElementById('final-transcript');
const interimTranscriptEl = document.getElementById('interim-transcript');
const languageSelect = document.getElementById('language-select');

let finalText = '';

function setStatus(status, detail) {
  const normalized = status || 'disconnected';
  statusBadge.textContent = STATUS_LABELS[normalized] || normalized;
  statusBadge.className = `status-badge status-${normalized}`;
  listeningDot.classList.toggle('active', normalized === 'listening');

  const running = RUNNING_STATUSES.has(normalized);
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  languageSelect.disabled = running;

  if (detail) {
    infoBanner.textContent = detail;
    infoBanner.classList.toggle('danger', normalized === 'error');
    infoBanner.hidden = false;
  } else {
    infoBanner.hidden = true;
  }
}

function handleTranscript(data) {
  if (!data || data.type !== 'Results') return;
  const alternative = data.channel?.alternatives?.[0];
  const transcript = alternative?.transcript || '';
  if (!transcript) return;

  if (data.is_final) {
    finalText += (finalText ? ' ' : '') + transcript;
    finalTranscriptEl.textContent = finalText;
    interimTranscriptEl.textContent = '';
  } else {
    interimTranscriptEl.textContent = transcript;
  }
  finalTranscriptEl.scrollTop = finalTranscriptEl.scrollHeight;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS') {
    setStatus(message.status, message.error);
  } else if (message?.type === 'TRANSCRIPT') {
    handleTranscript(message.payload);
  }
});

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(BACKEND_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

startBtn.addEventListener('click', async () => {
  setStatus('connecting');

  const health = await checkBackendHealth();
  if (!health) {
    setStatus('error', 'Backend unavailable at localhost:3000. Is the server running?');
    return;
  }
  if (!health.deepgramConfigured) {
    setStatus('error', 'Backend is missing DEEPGRAM_API_KEY. Check server/.env.');
    return;
  }

  finalText = '';
  finalTranscriptEl.textContent = '';
  interimTranscriptEl.textContent = '';

  chrome.runtime.sendMessage(
    { type: 'START_TRANSCRIPTION', language: languageSelect.value },
    (response) => {
      if (!response?.ok) {
        setStatus('error', response?.error || 'Could not start transcription.');
      }
    }
  );
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TRANSCRIPTION' });
  setStatus('disconnected');
});

(async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  setStatus(state?.status, state?.error);
})();
