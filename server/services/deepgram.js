const { DeepgramClient } = require('@deepgram/sdk');

const DEFAULT_MODEL = process.env.DEEPGRAM_MODEL || 'nova-3';

let client = null;

function getClient() {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not configured on the server.');
  }
  if (!client) {
    client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
  }
  return client;
}

// Opens a Deepgram live ("listen v1") connection configured for linear16
// PCM streaming. The connection is created but not yet connected; the
// caller is responsible for attaching listeners and calling .connect().
async function createLiveConnection({ language, sampleRate, channels }) {
  const deepgram = getClient();

  const connection = await deepgram.listen.v1.createConnection({
    model: DEFAULT_MODEL,
    language: language || 'en',
    encoding: 'linear16',
    sample_rate: sampleRate,
    channels: channels || 1,
    punctuate: 'true',
    smart_format: 'true',
    interim_results: 'true',
  });

  return connection;
}

module.exports = { createLiveConnection };
