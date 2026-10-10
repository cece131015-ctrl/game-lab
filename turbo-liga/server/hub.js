// Hub de salas independiente del entorno: lo usan el servidor Node (sockets 'ws') y el navegador
// del anfitrion en el modo sin servidor (sockets WebRTC o en memoria). Un "socket" es cualquier
// objeto con readyState, send(), close() y las propiedades onmessage / onclose.
import { Room } from './room.js';
import { CAR_TYPES } from '../src/shared/cars.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (s, n = 16) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// Cubo de fichas sencillo para limitar mensajes por segundo
function bucket(capacity, perSecond) {
  return { tokens: capacity, capacity, perSecond, last: Date.now() };
}
function take(b, n = 1) {
  const now = Date.now();
  b.tokens = Math.min(b.capacity, b.tokens + ((now - b.last) / 1000) * b.perSecond);
  b.last = now;
  if (b.tokens < n) return false;
  b.tokens -= n;
  return true;
}

export function createHub({ iceServers = [], log = console } = {}) {
  const clients = new Map(); // id -> cliente que ya dijo 'hello'
  const rooms = new Map(); // codigo -> Room
  let nextId = 1;

  const hub = {
    clients,
    rooms,
    fixedCode: null, // modo anfitrion en el navegador: una sola sala con el codigo reservado
    attach,
    shutdown,
  };

  function newCode() {
    if (hub.fixedCode && !rooms.has(hub.fixedCode)) return hub.fixedCode;
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  function attach(sock) {
    const client = {
      id: nextId++, ws: sock, name: 'Piloto', carType: 'octane', colors: { primary: 0, accent: '#ffffff' },
      room: null, mic: false, alive: true, hello: false,
      rlInput: bucket(150, 90), rlMsg: bucket(40, 20), rlChat: bucket(3, 1), rlJoin: bucket(5, 0.5), dropped: 0,
    };
    client.send = (obj) => { if (sock.readyState === 1) sock.send(JSON.stringify(obj)); };
    client.sendBinary = (buf) => { if (sock.readyState === 1 && (sock.bufferedAmount || 0) < 512 * 1024) sock.send(buf); };

    sock.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data !== 'string') return; // los clientes no envian binario
      if (data.length > 32 * 1024) return;
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      // limite de mensajes
      const ok = msg.t === 'in' ? take(client.rlInput) : take(client.rlMsg);
      if (!ok) {
        if (++client.dropped > 600) { try { sock.close(); } catch { /* */ } }
        return;
      }
      try { handle(client, msg); } catch (e) { log.error('Error procesando mensaje', msg.t, e); }
    };
    sock.onclose = () => {
      if (client.room) {
        try { client.room.removeMember(client); } catch (e) { log.error('Error al salir de la sala', e); }
      }
      clients.delete(client.id);
    };
    return client;
  }

  function applyProfile(client, msg) {
    if (msg.name !== undefined) client.name = clean(msg.name) || client.name;
    if (typeof msg.carType === 'string' && CAR_TYPES.includes(msg.carType)) client.carType = msg.carType;
    if (msg.colors && typeof msg.colors === 'object') {
      client.colors = {
        primary: Math.max(0, Math.min(10, Number(msg.colors.primary) | 0)),
        accent: /^#[0-9a-fA-F]{6}$/.test(msg.colors.accent) ? msg.colors.accent : '#ffffff',
      };
    }
  }

  function handle(client, msg) {
    if (msg.t !== 'hello' && !client.hello) return; // primero hay que presentarse
    switch (msg.t) {
      case 'hello':
        applyProfile(client, msg);
        client.hello = true;
        clients.set(client.id, client);
        client.send({ t: 'welcome', id: client.id, ice: iceServers });
        break;
      case 'profile':
        applyProfile(client, msg);
        if (client.room) client.room.updateProfile(client);
        break;
      case 'ping':
        client.send({ t: 'pong', ts: Number(msg.ts) || 0 });
        break;
      case 'create': {
        if (hub.fixedCode && rooms.has(hub.fixedCode)) { client.send({ t: 'error', msg: 'La sala ya existe' }); return; }
        if (client.room) client.room.removeMember(client);
        const code = newCode();
        const room = new Room(code, msg.settings && typeof msg.settings === 'object' ? msg.settings : {}, () => { rooms.delete(code); });
        rooms.set(code, room);
        room.addMember(client);
        break;
      }
      case 'join': {
        if (!take(client.rlJoin)) { client.send({ t: 'error', msg: 'Demasiados intentos, espera un momento' }); return; }
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
        // retransmitir la señalizacion de voz solo entre miembros de la misma sala
        const to = client.room && client.room.members.get(Number(msg.to));
        if (to && msg.data && typeof msg.data === 'object' && JSON.stringify(msg.data).length < 16000) {
          to.send({ t: 'rtc', from: client.id, data: msg.data });
        }
        break;
      }
      case 'chat':
        if (!take(client.rlChat)) return;
        if (client.room) client.room.handle(client, msg);
        break;
      default:
        if (client.room) client.room.handle(client, msg);
    }
  }

  function shutdown() {
    for (const room of rooms.values()) {
      if (room.match) room.match.destroy();
      room.match = null;
    }
    rooms.clear();
    for (const c of clients.values()) { try { c.ws.close(); } catch { /* */ } }
    clients.clear();
  }

  return hub;
}
