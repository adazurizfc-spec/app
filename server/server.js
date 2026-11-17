import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // em produção: https://seu-app.vercel.app
const MAX_CLIP_SECONDS = Number(process.env.MAX_CLIP_SECONDS || 600);
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 2);
let active = 0;

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

const isYouTube = (value) => {
  try {
    const h = new URL(value).hostname.replace(/^www\.|^m\./, "");
    return h === "youtube.com" || h === "youtu.be";
  } catch {
    return false;
  }
};

const toSeconds = (t) => {
  if (typeof t !== "string") return null;
  const p = t.trim().split(":").map(Number);
  if (p.length < 1 || p.length > 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};

const run = (args, timeoutMs = 300000) =>
  new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args); // sem shell: sem injeção de comandos
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-800)));
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || "Falha ao baixar o trecho."));
    });
  });

app.get("/health", (_req, res) => res.send("ok"));

app.post("/api/clip", async (req, res) => {
  const { url, start, end } = req.body || {};
  const s = toSeconds(start);
  const e = toSeconds(end);

  if (!isYouTube(url)) return res.status(400).json({ error: "Link do YouTube inválido." });
  if (s === null || e === null || e <= s) return res.status(400).json({ error: "O tempo final precisa ser maior que o inicial." });
  if (e - s > MAX_CLIP_SECONDS) return res.status(400).json({ error: `Recorte máximo de ${MAX_CLIP_SECONDS / 60} minutos.` });
  if (active >= MAX_PARALLEL) return res.status(429).json({ error: "Servidor ocupado. Tente novamente em instantes." });

  active++;
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  let streaming = false;

  try {
    await run([
      "--no-playlist",
      "--js-runtimes", "node",
      "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b",
      "--download-sections", `*${s}-${e}`,
      "--force-keyframes-at-cuts",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, "clip.%(ext)s"),
      url,
    ]);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="recorte.mp4"');
    streaming = true;
    const stream = createReadStream(path.join(dir, "clip.mp4"));
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
