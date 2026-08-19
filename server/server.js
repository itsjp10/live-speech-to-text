require('dotenv').config();

const express = require('express');
const morgan = require('morgan')
const http = require('http');
const { attachTranscriptionSocket } = require('./ws/transcribeSocket');

const app = express();

app.use(morgan('dev'))

// Extension pages (chrome-extension://...) need this to read the /health
// response; WebSocket connections aren't subject to CORS so they don't.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('¡Hola Mundo!');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
  });
});

const server = http.createServer(app);
attachTranscriptionSocket(server);

server.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
  if (!process.env.DEEPGRAM_API_KEY) {
    console.warn('DEEPGRAM_API_KEY is not set — /ws/transcribe will reject connections until it is.');
  }
});
