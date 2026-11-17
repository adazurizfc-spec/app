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

const videoId = (value) => {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host === "youtube.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
      return m ? m[2] : null;
    }
  } catch {}
  return null;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState([newRow(), newRow(), newRow()]);
  const id = videoId(url);

  const patch = (rid, changes) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...changes } : r)));

  async function cut(row) {
    if (!id) return patch(row.id, { status: "error", error: "Cole um link válido do YouTube acima." });
    const s = toSeconds(row.start);
    const e = toSeconds(row.end);
    if (s === null || e === null) return patch(row.id, { status: "error", error: "Use o formato mm:ss ou hh:mm:ss." });
    if (e <= s) return patch(row.id, { status: "error", error: "O fim precisa ser maior que o início." });

    patch(row.id, { status: "loading", error: "", href: "" });
    try {
      const res = await fetch(`${API}/api/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, start: hms(s), end: hms(e) }),
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
      <p className="sub">Cole o link, marque início e fim e baixe o trecho em MP4.</p>

      <div className="urlbar">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="Link do YouTube"
        />
      </div>

      {id && (
        <div className="player">
          <iframe src={`https://www.youtube.com/embed/${id}`} title="Vídeo" allowFullScreen />
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

      <p className="aviso">
        Use apenas com vídeos seus ou que você tenha autorização para baixar. Baixar conteúdo do YouTube sem permissão
        viola os Termos de Serviço da plataforma.
      </p>
    </main>
  );
}
