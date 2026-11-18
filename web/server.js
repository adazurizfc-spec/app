const express = require('express');
const path = require('path');

const app = express();
const BACKEND = process.env.BACKEND_URL || 'https://cortador-youtube-server.onrender.com';

app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(`window.BACKEND_URL = ${JSON.stringify(BACKEND)};`);
});
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Web na porta ' + PORT));
