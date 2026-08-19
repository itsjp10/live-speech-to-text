// Runs on the audio rendering thread. Buffers incoming mono Float32 frames
// (delivered 128 samples at a time by the Web Audio API) and flushes them
// as 16-bit PCM (linear16) roughly every ~40ms, which keeps chunks small
// enough for low-latency streaming without flooding postMessage.
const FLUSH_SAMPLE_THRESHOLD = 2048;

class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._bufferedSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];

    if (channel && channel.length > 0) {
      this._chunks.push(channel.slice());
      this._bufferedSamples += channel.length;

      if (this._bufferedSamples >= FLUSH_SAMPLE_THRESHOLD) {
        this._flush();
      }
    }

    return true;
  }

  _flush() {
    const merged = new Float32Array(this._bufferedSamples);
    let offset = 0;
    for (const chunk of this._chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const pcm16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const sample = Math.max(-1, Math.min(1, merged[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    this._chunks = [];
    this._bufferedSamples = 0;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
