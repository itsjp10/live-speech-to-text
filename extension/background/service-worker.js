const BACKEND_WS_URL = 'ws://localhost:3000/ws/transcribe';

// Single source of truth for the popup, since the popup can be closed and
// reopened at any point while a transcription is running.
const state = {
  status: 'disconnected', // disconnected | connecting | capturing | listening | error
  tabId: null,
  error: null,
};

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No popup listening right now — that's fine, state is still tracked.
  });
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture and stream tab audio to the backend for live transcription.',
  });
}

async function closeOffscreenDocumentIfExists() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

async function handleStart(message) {
  if (state.status === 'connecting' || state.status === 'capturing' || state.status === 'listening') {
    return { ok: false, error: 'A transcription is already running.' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { ok: false, error: 'No active tab found.' };
  }

  state.status = 'connecting';
  state.error = null;
  state.tabId = tab.id;
  broadcast({ type: 'STATUS', status: 'connecting' });

  await ensureOffscreenDocument();

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (err) {
    state.status = 'error';
    state.error = 'Could not capture this tab (try a regular http/https page, not a chrome:// page).';
    broadcast({ type: 'STATUS', status: 'error', error: state.error });
    return { ok: false, error: state.error };
  }

  chrome.runtime
    .sendMessage({
      target: 'offscreen',
      type: 'START_CAPTURE',
      streamId,
      wsUrl: BACKEND_WS_URL,
      config: { language: message?.language || 'en' },
    })
    .catch(() => {});

  return { ok: true };
}

async function handleStop() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' }).catch(() => {});
  state.status = 'disconnected';
  state.tabId = null;
  state.error = null;
  broadcast({ type: 'STATUS', status: 'disconnected' });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target && message.target !== 'background') return;

  switch (message?.type) {
    case 'GET_STATE':
      sendResponse(state);
      return true;

    case 'START_TRANSCRIPTION':
      handleStart(message).then(sendResponse);
      return true;

    case 'STOP_TRANSCRIPTION':
      handleStop().then(sendResponse);
      return true;

    case 'OFFSCREEN_STATUS':
      state.status = message.status;
      state.error = message.error || null;
      broadcast({ type: 'STATUS', status: state.status, error: state.error });
      if (message.status === 'stopped' || message.status === 'error') {
        state.tabId = null;
        closeOffscreenDocumentIfExists().catch(() => {});
      }
      return false;

    case 'OFFSCREEN_TRANSCRIPT':
      broadcast({ type: 'TRANSCRIPT', payload: message.payload });
      return false;

    default:
      return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.tabId === tabId) {
    handleStop();
  }
});
