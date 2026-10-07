// Servidor de Turbo Liga: sirve el juego, gestiona las salas (codigo de 6 caracteres),
// simula los partidos de forma autoritativa a 120 Hz y retransmite la señalizacion WebRTC del chat de voz.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHub } from './hub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// --- Servidores ICE para el chat de voz (STUN publico + TURN opcional por variables de entorno) ---
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  }
  return list;
}

const hub = createHub({ iceServers: iceServers() });

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Falta la carpeta dist/. Ejecuta "npm run build" primero (o usa "npm run dev").');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size, players: hub.clients.size }));
    return;
  }
  if (pathname.includes('\0')) { res.writeHead(400); res.end(); return; }
  const file = path.normalize(path.join(DIST, pathname));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    serveFile(res, err || st.isDirectory() ? path.join(DIST, 'index.html') : file);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  ws.on('error', () => { try { ws.terminate(); } catch { /* */ } });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  hub.attach(ws);
});
wss.on('error', (e) => console.error('Error del servidor WebSocket', e));

// latidos para detectar conexiones muertas (incluidas las que nunca dicen 'hello')
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* */ }
  }
}, 10000);

// un error inesperado nunca debe tumbar todas las salas
process.on('uncaughtException', (e) => console.error('Excepcion no capturada', e));
process.on('unhandledRejection', (e) => console.error('Promesa rechazada sin capturar', e));

server.listen(PORT, () => {
  console.log(`Turbo Liga escuchando en http://localhost:${PORT}`);
});
