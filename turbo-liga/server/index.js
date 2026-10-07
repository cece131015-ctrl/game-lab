// Servidor de Turbo Liga: sirve el juego, gestiona las salas (codigo de 6 caracteres),
// simula los partidos de forma autoritativa a 120 Hz y retransmite la señalizacion WebRTC del chat de voz.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
    return;
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
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
  });
});

// --- Servidores ICE para el chat de voz (STUN publico + TURN opcional por variables de entorno) ---
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  }
  return list;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const clients = new Map(); // id -> client
const rooms = new Map(); // code -> Room
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const clean = (s, n = 16) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

wss.on('connection', (ws) => {
  const client = { id: nextId++, ws, name: 'Piloto', carType: 'octane', colors: { primary: 0, accent: '#ffffff' }, room: null, mic: false, alive: true, msgCount: 0 };
  ws.on('pong', () => { client.alive = true; });
  client.send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  client.sendBinary = (buf) => { if (ws.readyState === 1 && ws.bufferedAmount < 512 * 1024) ws.send(buf); };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    client.msgCount++;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(client, msg); } catch (e) { console.error('Error procesando mensaje', msg.t, e); }
  });
  ws.on('close', () => {
    if (client.room) client.room.removeMember(client);
    clients.delete(client.id);
  });
});

function applyProfile(client, msg) {
  if (msg.name !== undefined) client.name = clean(msg.name) || client.name;
  if (typeof msg.carType === 'string') client.carType = clean(msg.carType, 12);
  if (msg.colors && typeof msg.colors === 'object') {
    client.colors = {
      primary: Math.max(0, Math.min(10, Number(msg.colors.primary) | 0)),
      accent: /^#[0-9a-fA-F]{6}$/.test(msg.colors.accent) ? msg.colors.accent : '#ffffff',
    };
  }
}

function handle(client, msg) {
  switch (msg.t) {
    case 'hello':
      applyProfile(client, msg);
      clients.set(client.id, client);
      client.send({ t: 'welcome', id: client.id, ice: iceServers() });
      break;
    case 'profile':
      applyProfile(client, msg);
      if (client.room) client.room.updateProfile(client);
      break;
    case 'ping':
      client.send({ t: 'pong', ts: msg.ts });
      break;
    case 'create': {
      if (client.room) client.room.removeMember(client);
      const code = newCode();
      const room = new Room(code, msg.settings || {}, () => { rooms.delete(code); });
      rooms.set(code, room);
      room.addMember(client);
      break;
    }
    case 'join': {
      const code = clean(msg.code, 6).toUpperCase();
      const room = rooms.get(code);
      if (!room) { client.send({ t: 'error', msg: 'No existe ninguna sala con ese código' }); return; }
      if (room.members.size >= 8) { client.send({ t: 'error', msg: 'La sala está llena' }); return; }
      if (client.room) client.room.removeMember(client);
      room.addMember(client);
      break;
    }
    case 'leave':
      if (client.room) client.room.removeMember(client);
      break;
    case 'rtc': {
      // retransmitir señalizacion solo entre miembros de la misma sala
      const to = client.room && client.room.members.get(Number(msg.to));
      if (to && msg.data && JSON.stringify(msg.data).length < 16000) to.send({ t: 'rtc', from: client.id, data: msg.data });
      break;
    }
    default:
      if (client.room) client.room.handle(client, msg);
  }
}

// latidos para detectar conexiones muertas
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* */ }
    c.msgCount = 0;
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`Turbo Liga escuchando en http://localhost:${PORT}`);
});
