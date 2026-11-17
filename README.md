# Cortador de vídeo (YouTube → MP4)

Duas partes: **web/** (Vercel) e **server/** (Docker em Railway, Render ou Fly.io).

## 1. Backend
1. Suba a pasta `server/` em um repositório (ou use o repositório todo com "Root Directory = server").
2. Crie um serviço no Railway/Render apontando para o `Dockerfile`.
3. Variável opcional: `ALLOWED_ORIGIN=https://SEU-APP.vercel.app` (restringe quem pode chamar o servidor).
4. Copie a URL pública gerada (ex.: https://cortador.up.railway.app).
   Teste: abrir `/health` deve mostrar "ok".

## 2. Frontend (Vercel)
1. Suba a pasta `web/` em um repositório e importe na Vercel (Root Directory = `web`).
2. Em Settings → Environment Variables, crie `NEXT_PUBLIC_API_URL` com a URL do backend.
3. Faça o deploy.

## Rodar local
```
cd server && npm install && node server.js      # precisa de yt-dlp e ffmpeg instalados
cd web && npm install && npm run dev
```

## Observações
- Mantenha o yt-dlp atualizado: refaça o deploy do backend de tempos em tempos.
- O YouTube pode bloquear IPs de servidores; se acontecer, o backend retorna erro na linha.
- Limites configuráveis no backend: `MAX_CLIP_SECONDS` (padrão 600) e `MAX_PARALLEL` (padrão 2).
