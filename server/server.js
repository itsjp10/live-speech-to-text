const express = require('express');
const morgan = require('morgan')
const app = express();

app.use(morgan('dev'))
const port = 3000;

app.get('/', (req, res) => {
  res.send('¡Hola Mundo!');
});

app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
});
