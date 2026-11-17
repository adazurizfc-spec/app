"use client";
import { useRef, useState } from "react";

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
const fmt = (s) => (s >= 3600 ? hms(s) : hms(s).slice(3)); // mm:ss ou hh:mm:ss
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
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [range, setRange] = useState(null);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(null);

  const patch = (rid, changes) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...changes } : r)));
  const selCount = rows.filter((r) => r.sel).length;
  const allSel = rows.length > 0 && selCount === rows.length;

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setVideoId("");
    setDuration(0);
    setPlayhead(0);
    setRange(null);
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

  // ---- linha do tempo ----
  const posToSec = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    return (x / r.width) * duration;
  };
  // Ctrl + Option + Command (ou Shift) seleciona; sem tecla, só navega no vídeo
  const isSelectKey = (e) => (e.ctrlKey && e.altKey && e.metaKey) || e.shiftKey;

  function applyRange(a, b) {
    const vals = { start: fmt(a), end: fmt(b), status: "idle", href: "", error: "" };
    setRows((rs) => {
      const i = rs.findIndex((r) => !r.start.trim() && !r.end.trim());
      if (i >= 0) return rs.map((r, k) => (k === i ? { ...r, ...vals } : r));
      return [...rs, { ...newRow(), ...vals }];
    });
  }

  function onTlDown(e) {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = posToSec(e.clientX);
    if (isSelectKey(e)) {
      drag.current = { mode: "select", from: t };
      setRange({ a: t, b: t });
    } else {
      drag.current = { mode: "seek" };
      videoRef.current.currentTime = t;
    }
  }
  function onTlMove(e) {
    const d = drag.current;
    if (!d) return;
    const t = posToSec(e.clientX);
    if (d.mode === "select") setRange({ a: Math.min(d.from, t), b: Math.max(d.from, t) });
    else videoRef.current.currentTime = t;
  }
  function onTlUp(e) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== "select") return;
    const t = posToSec(e.clientX);
    const a = Math.floor(Math.min(d.from, t));
    const b = Math.ceil(Math.max(d.from, t));
    if (b - a < 1) return setRange(null);
    setRange({ a, b });
    applyRange(a, b);
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
          <video
            ref={videoRef}
            src={preview}
            controls
            style={{ width: "100%", height: "100%" }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
          />
        </div>
      )}

      {preview && duration > 0 && (
        <div className="tl-wrap">
          <div
            className="timeline"
            ref={trackRef}
            onPointerDown={onTlDown}
            onPointerMove={onTlMove}
            onPointerUp={onTlUp}
            onContextMenu={(e) => e.preventDefault()}
            role="slider"
            aria-label="Linha do tempo do vídeo"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(playhead)}
          >
            {range && (
              <div
                className="tl-range"
                style={{ left: `${(range.a / duration) * 100}%`, width: `${((range.b - range.a) / duration) * 100}%` }}
              />
            )}
            <div className="tl-head" style={{ left: `${(playhead / duration) * 100}%` }} />
          </div>
          <div className="tl-labels">
            <span>00:00</span>
            <span>{range ? `${fmt(Math.floor(range.a))} – ${fmt(Math.ceil(range.b))}` : ""}</span>
            <span>{fmt(Math.floor(duration))}</span>
          </div>
          <p className="tl-hint">
            Segure Ctrl + Option + Command e arraste na linha para marcar um trecho (Shift + arrastar também funciona).
            O trecho vai para a primeira linha vazia da tabela. Clique ou arraste sem tecla para navegar no vídeo.
          </p>
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
