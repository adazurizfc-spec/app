const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const DIR = path.join(os.tmpdir(), 'cortador');
fs.mkdirSync(DIR, { recursive: true });

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20480);
const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.mp4'),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

app.get('/', (req, res) => res.send('ok'));

// Recebe o MP4 e devolve um id para usar nos recortes.
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  res.json({ id: path.basename(req.file.filename, '.mp4') });
});

// Corta o trecho [start, end] (em segundos) e devolve o MP4.
app.post('/cut', (req, res) => {
  const { id, start, end } = req.body || {};
  if (!/^[0-9a-f-]{36}$/.test(id || '')) {
    return res.status(400).json({ error: 'Id de vídeo inválido.' });
  }
  const s = Number(start);
  const e = Number(end);
  if (!(s >= 0) || !(e > s)) {
    return res.status(400).json({ error: 'O fim precisa ser maior que o início.' });
  }
  const input = path.join(DIR, id + '.mp4');
  if (!fs.existsSync(input)) {
    return res.status(404).json({ error: 'O vídeo expirou no servidor. Envie o arquivo de novo.' });
  }

  const output = path.join(DIR, `${id}-${Date.now()}-recorte.mp4`);
  const args = [
    '-y', '-ss', String(s), '-i', input, '-t', String(e - s),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-c:a', 'aac', '-movflags', '+faststart', output,
  ];
  const ff = spawn('ffmpeg', args);
  let log = '';
  ff.stderr.on('data', (d) => { log = (log + d).slice(-2000); });
  ff.on('error', () => res.status(500).json({ error: 'ffmpeg não encontrado no servidor.' }));
  ff.on('close', (code) => {
    if (code !== 0) {
      console.error('ffmpeg falhou:', log);
      fs.unlink(output, () => {});
      if (!res.headersSent) res.status(500).json({ error: 'Falha ao cortar o vídeo.' });
      return;
    }
    res.download(output, 'recorte.mp4', () => fs.unlink(output, () => {}));
  });
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Arquivo maior que ${MAX_MB >= 1024 ? (MAX_MB / 1024) + " GB" : MAX_MB + " MB"}.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno.' });
});

// Apaga arquivos com mais de 1 hora.
setInterval(() => {
  const limite = Date.now() - 60 * 60 * 1000;
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    files.forEach((f) => {
      const p = path.join(DIR, f);
      fs.stat(p, (e, st) => { if (!e && st.mtimeMs < limite) fs.unlink(p, () => {}); });
    });
  });
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Servidor na porta ' + PORT));
