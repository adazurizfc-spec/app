import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 300) * 1024 * 1024;
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 2);
const FILE_TTL_MS = 60 * 60 * 1000; // vídeos enviados são apagados após 1 hora
const UP_DIR = path.join(tmpdir(), "cortador-uploads");
await mkdir(UP_DIR, { recursive: true });
let active = 0;

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

const toSeconds = (t) => {
  if (typeof t !== "string") return null;
  const p = t.trim().split(":").map(Number);
  if (p.length < 1 || p.length > 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};

const ffmpeg = (args, timeoutMs = 300000) =>
  new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args); // sem shell
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-800)));
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("Não foi possível cortar este vídeo. Verifique se é um MP4 válido."));
    });
  });

// limpeza periódica dos vídeos enviados
setInterval(async () => {
  try {
    for (const f of await readdir(UP_DIR)) {
      const p = path.join(UP_DIR, f);
      if (Date.now() - (await stat(p)).mtimeMs > FILE_TTL_MS) await rm(p, { force: true });
    }
  } catch {}
}, 10 * 60 * 1000).unref();

app.get("/health", (_req, res) => res.send("ok"));

// 1) envia o vídeo uma vez
app.post("/api/upload", async (req, res) => {
  if (Number(req.headers["content-length"] || 0) > MAX_UPLOAD)
    return res.status(413).json({ error: `Arquivo grande demais (máximo ${MAX_UPLOAD / 1024 / 1024} MB).` });

  const id = randomBytes(8).toString("hex");
  const file = path.join(UP_DIR, `${id}.mp4`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      size > MAX_UPLOAD ? cb(new Error("LIMIT")) : cb(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, createWriteStream(file));
    res.json({ id });
  } catch (e) {
    await rm(file, { force: true });
    if (!res.headersSent)
      res.status(e.message === "LIMIT" ? 413 : 500).json({
        error: e.message === "LIMIT" ? "Arquivo grande demais." : "Falha ao receber o arquivo.",
      });
  }
});

// 2) corta quantos trechos quiser do vídeo enviado
app.post("/api/clip", async (req, res) => {
  const { id, start, end } = req.body || {};
  const s = toSeconds(start);
  const e = toSeconds(end);

  if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: "Vídeo inválido." });
  if (s === null || e === null || e <= s) return res.status(400).json({ error: "O tempo final precisa ser maior que o inicial." });
  const input = path.join(UP_DIR, `${id}.mp4`);
  try { await stat(input); } catch { return res.status(404).json({ error: "Vídeo expirou. Envie o arquivo novamente." }); }
  if (active >= MAX_PARALLEL) return res.status(429).json({ error: "Servidor ocupado. Tente novamente em instantes." });

  active++;
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  let streaming = false;

  try {
    const out = path.join(dir, "clip.mp4");
    // corte rápido sem recodificar (começa no quadro-chave mais próximo)
    await ffmpeg(["-y", "-ss", String(s), "-i", input, "-t", String(e - s), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", out]);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="recorte.mp4"');
    streaming = true;
    const stream = createReadStream(out);
    stream.on("error", () => res.destroy());
    res.on("close", cleanup);
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    active--;
    if (!streaming) cleanup();
  }
});

app.listen(PORT, () => console.log(`Servidor de recortes na porta ${PORT}`));
