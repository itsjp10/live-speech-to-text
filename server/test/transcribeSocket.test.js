const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig } = require('../ws/transcribeSocket');

test('parseConfig applies defaults when the query string is empty', () => {
  const config = parseConfig('/ws/transcribe');
  assert.deepEqual(config, { sampleRate: 48000, channels: 1, language: 'en' });
});

test('parseConfig reads sampleRate, channels and language from the query string', () => {
  const config = parseConfig('/ws/transcribe?sampleRate=16000&channels=2&language=es');
  assert.deepEqual(config, { sampleRate: 16000, channels: 2, language: 'es' });
});

test('parseConfig falls back to defaults for invalid numeric values', () => {
  const config = parseConfig('/ws/transcribe?sampleRate=not-a-number&channels=-1');
  assert.deepEqual(config, { sampleRate: 48000, channels: 1, language: 'en' });
});

test('parseConfig ignores an empty language and uses the default', () => {
  const config = parseConfig('/ws/transcribe?language=');
  assert.equal(config.language, 'en');
});
