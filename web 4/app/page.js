"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const TIPOS = [
  "TIRO DE META", "FASE 1", "FASE 2", "FASE 3", "DEFENSIVO", "OFENSIVO",
  "COBERTURA", "SAÍDA", "DEFESA DE META", "GOL MARCADO", "GOL SOFRIDO", "BOLAS PARADAS",
];
const uid = () => Math.random().toString(36).slice(2, 9);
const newRow = () => ({ id: uid(), tipo: "", sel: false, start: "", end: "", status: "idle", href: "", error: "" });

const toSeconds = (t) => {
  const p = t.trim().split(":").map(Number);
  if (!t.trim() || p.length > 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
const hms = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
const slug = (t) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

// nome do arquivo: 01-TIRO-DE-META_00-10-00_00-20-00.mp4
const fileName = (r, i) => {
  const s = toSeconds(r.start);
  const e = toSeconds(r.end);
  const t = s !== null && e !== null ? `_${hms(s).replace(/:/g, "-")}_${hms(e).replace(/:/g, "-")}` : "";
  return `${String(i + 1).padStart(2, "0")}${r.tipo ? "-" + slug(r.tipo) : ""}${t}.mp4`;
};

const triggerDownload = (href, name) => {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

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
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0 });

  const patch = (rid, changes) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...changes } : r)));
  const selCount = rows.filter((r) => r.sel).length;
  const allSel = rows.length > 0 && selCount === rows.length;

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

  // corta a linha; devolve o endereço do arquivo pronto (ou null se falhar)
  async function cut(row) {
    if (!videoId) return patch(row.id, { status: "error", error: "Envie o vídeo MP4 primeiro." }), null;
    const s = toSeconds(row.start);
    const e = toSeconds(row.end);
    if (s === null || e === null) return patch(row.id, { status: "error", error: "Use o formato mm:ss ou hh:mm:ss." }), null;
    if (e <= s) return patch(row.id, { status: "error", error: "O fim precisa ser maior que o início." }), null;

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
      const href = URL.createObjectURL(await res.blob());
      patch(row.id, { status: "done", href });
      return href;
    } catch (err) {
      patch(row.id, { status: "error", error: err.message });
      return null;
    }
  }

  // baixa todas as linhas marcadas (corta antes as que ainda não foram cortadas)
  async function downloadSelected() {
    const chosen = rows.map((r, i) => ({ r, i })).filter((x) => x.r.sel);
    if (!chosen.length) return;
    setBatch({ running: true, done: 0, total: chosen.length });
    let n = 0;
    for (const { r, i } of chosen) {
      const href = r.status === "done" && r.href ? r.href : await cut(r);
      if (href) {
        triggerDownload(href, fileName(r, i));
        await new Promise((ok) => setTimeout(ok, 700));
      }
      n++;
      setBatch({ running: true, done: n, total: chosen.length });
    }
    setBatch({ running: false, done: 0, total: 0 });
  }

  return (
    <main>
      <h1>FOGÃO CUT!</h1>
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
          <label className="num">
            <input
              type="checkbox"
              checked={allSel}
              onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, sel: e.target.checked })))}
              aria-label="Selecionar todas as linhas"
            />
            <span>#</span>
          </label>
          <span>Tipo</span><span>Início</span><span>Fim</span><span>Recortar</span><span>Download</span>
        </div>
        {rows.map((r, i) => (
          <div className="row" key={r.id}>
            <label className="num">
              <input
                type="checkbox"
                checked={r.sel}
                onChange={(e) => patch(r.id, { sel: e.target.checked })}
                aria-label={`Selecionar linha ${i + 1}`}
              />
              <span>{i + 1}</span>
            </label>
            <select value={r.tipo} onChange={(e) => patch(r.id, { tipo: e.target.value })} aria-label="Tipo">
              <option value="">Tipo…</option>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={r.start}
              onChange={(e) => patch(r.id, { start: e.target.value, status: "idle", href: "", error: "" })}
              placeholder="00:00"
              aria-label="Início"
            />
            <input
              value={r.end}
              onChange={(e) => patch(r.id, { end: e.target.value, status: "idle", href: "", error: "" })}
              placeholder="00:30"
              aria-label="Fim"
            />
            <button className="ok" onClick={() => cut(r)} disabled={r.status === "loading"}>OK</button>
            <div>
              {r.status === "loading" && <span className="msg">Processando…</span>}
              {r.status === "done" && <a className="dl" href={r.href} download={fileName(r, i)}>Baixar MP4</a>}
              {r.status === "error" && <span className="msg err">{r.error}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button className="ghost" onClick={() => setRows((rs) => [...rs, newRow()])}>Adicionar linha</button>
        <button className="ghost" onClick={downloadSelected} disabled={!selCount || batch.running}>
          {batch.running ? `Baixando ${batch.done}/${batch.total}…` : `Baixar selecionados (${selCount})`}
        </button>
      </div>
    </main>
  );
}
