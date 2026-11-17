"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const uid = () => Math.random().toString(36).slice(2, 9);
const newRow = () => ({ id: uid(), start: "", end: "", status: "idle", href: "", name: "", error: "" });

const toSeconds = (t) => {
  const p = t.trim().split(":").map(Number);
  if (!t.trim() || p.length > 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
const hms = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");

function upload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${API}/api/upload`);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch {}
      x.status === 200 && d.id ? resolve(d.id) : reject(new Error(d.error || "Falha no envio do vídeo."));
    };
    x.onerror = () => reject(new Error("Não foi possível conectar ao servidor. Tente de novo em instantes."));
    x.send(file);
  });
}

export default function Home() {
  const [preview, setPreview] = useState("");
  const [videoId, setVideoId] = useState("");
  const [up, setUp] = useState({ status: "idle", pct: 0, error: "" });
  const [rows, setRows] = useState([newRow(), newRow(), newRow()]);

  const patch = (rid, changes) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...changes } : r)));

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setVideoId("");
    setUp({ status: "loading", pct: 0, error: "" });
    try {
      const id = await upload(file, (pct) => setUp({ status: "loading", pct, error: "" }));
      setVideoId(id);
      setUp({ status: "done", pct: 100, error: "" });
    } catch (err) {
      setUp({ status: "error", pct: 0, error: err.message });
    }
  }

  async function cut(row) {
    if (!videoId) return patch(row.id, { status: "error", error: "Envie o vídeo MP4 primeiro." });
    const s = toSeconds(row.start);
    const e = toSeconds(row.end);
    if (s === null || e === null) return patch(row.id, { status: "error", error: "Use o formato mm:ss ou hh:mm:ss." });
    if (e <= s) return patch(row.id, { status: "error", error: "O fim precisa ser maior que o início." });

    patch(row.id, { status: "loading", error: "", href: "" });
    try {
      const res = await fetch(`${API}/api/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: videoId, start: hms(s), end: hms(e) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível gerar o recorte.");
      }
      const blob = await res.blob();
      patch(row.id, {
        status: "done",
        href: URL.createObjectURL(blob),
        name: `recorte-${hms(s).replace(/:/g, "-")}_${hms(e).replace(/:/g, "-")}.mp4`,
      });
    } catch (err) {
      patch(row.id, { status: "error", error: err.message });
    }
  }

  return (
    <main>
      <h1>Cortador de vídeo</h1>
      <p className="sub">Envie um vídeo MP4, marque início e fim e baixe cada trecho.</p>

      <div className="urlbar">
        <input type="file" accept="video/mp4,.mp4" onChange={onFile} aria-label="Vídeo MP4" />
      </div>
      {up.status === "loading" && <p className="msg">Enviando vídeo… {up.pct}%</p>}
      {up.status === "done" && <p className="msg">Vídeo pronto. Preencha os tempos abaixo.</p>}
      {up.status === "error" && <p className="msg err">{up.error}</p>}

      {preview && (
        <div className="player">
          <video src={preview} controls style={{ width: "100%", height: "100%" }} />
        </div>
      )}

      <div className="table">
        <div className="row head">
          <span>Início</span><span>Fim</span><span>Recortar</span><span>Download</span>
        </div>
        {rows.map((r) => (
          <div className="row" key={r.id}>
            <input value={r.start} onChange={(e) => patch(r.id, { start: e.target.value })} placeholder="00:00" aria-label="Início" />
            <input value={r.end} onChange={(e) => patch(r.id, { end: e.target.value })} placeholder="00:30" aria-label="Fim" />
            <button className="ok" onClick={() => cut(r)} disabled={r.status === "loading"}>OK</button>
            <div>
              {r.status === "loading" && <span className="msg">Processando…</span>}
              {r.status === "done" && <a className="dl" href={r.href} download={r.name}>Baixar MP4</a>}
              {r.status === "error" && <span className="msg err">{r.error}</span>}
            </div>
          </div>
        ))}
      </div>

      <button className="ghost" onClick={() => setRows((rs) => [...rs, newRow()])}>Adicionar linha</button>
    </main>
  );
}
