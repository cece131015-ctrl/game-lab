// Salas sin servidor: el navegador del anfitrion ejecuta el "servidor" de la sala (hub + partido
// autoritativo) y los amigos se conectan directamente por WebRTC. Para encontrarse usan el
// broker publico de PeerJS (solo intercambia la señalizacion, no el juego ni la voz).
import { Peer } from 'peerjs';

const PREFIX = 'turboliga-v1-';

export function peerOptions(iceServers) {
  const opts = { debug: 1, config: { iceServers } };
  // ?peer=host:puerto/ruta para usar un PeerServer propio en lugar del publico
  const custom = new URLSearchParams(location.search).get('peer');
  if (custom) {
    const u = new URL(custom.includes('://') ? custom : `http://${custom}`);
    opts.host = u.hostname;
    opts.secure = u.protocol === 'https:';
    opts.port = Number(u.port) || (opts.secure ? 443 : 80);
    opts.path = u.pathname && u.pathname !== '' ? u.pathname : '/';
  }
  return opts;
}

// Adaptador con la interfaz de un WebSocket sobre un DataConnection de PeerJS
export class PeerSocket {
  constructor(conn) {
    this.conn = conn;
    this.readyState = conn.open ? 1 : 0;
    this.binaryType = 'arraybuffer';
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    conn.on('open', () => { this.readyState = 1; this.onopen?.(); });
    conn.on('data', (data) => {
      // PeerJS en modo 'raw' entrega strings o ArrayBuffer (a veces como vista)
      if (data instanceof ArrayBuffer || typeof data === 'string') this.onmessage?.({ data });
      else if (ArrayBuffer.isView(data)) this.onmessage?.({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    });
    const closed = () => {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({});
    };
    conn.on('close', closed);
    conn.on('error', (e) => { this.onerror?.(e); closed(); });
  }

  get bufferedAmount() { return this.conn.dataChannel?.bufferedAmount || 0; }

  send(data) {
    if (this.readyState !== 1) return;
    try { this.conn.send(data); } catch { /* canal cerrado */ }
  }

  close() {
    if (this.readyState === 3) return;
    try { this.conn.close(); } catch { /* */ }
    this.readyState = 3;
    this.onclose?.({});
  }
}

// Par de sockets en memoria: el anfitrion juega en su propia pagina contra su hub local
export function loopbackPair() {
  const mk = () => ({
    readyState: 1, binaryType: 'arraybuffer', bufferedAmount: 0,
    onopen: null, onmessage: null, onclose: null, onerror: null,
  });
  const a = mk(), b = mk();
  const deliver = (to, data) => {
    // asincrono como una red real (evita reentradas)
    queueMicrotask(() => { if (to.readyState === 1) to.onmessage?.({ data }); });
  };
  a.send = (data) => { if (a.readyState === 1) deliver(b, data); };
  b.send = (data) => { if (b.readyState === 1) deliver(a, data); };
  const closeBoth = () => {
    for (const s of [a, b]) {
      if (s.readyState === 3) continue;
      s.readyState = 3;
      queueMicrotask(() => s.onclose?.({}));
    }
  };
  a.close = closeBoth;
  b.close = closeBoth;
  return [a, b];
}

function waitOpen(peer) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 12000);
    peer.once('open', (id) => { clearTimeout(t); resolve(id); });
    peer.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// Anfitrion: reserva el codigo en el broker y acepta conexiones entrantes
export async function startP2PHost(iceServers, onSocket) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode();
    const peer = new Peer(PREFIX + code, peerOptions(iceServers));
    try {
      await waitOpen(peer);
    } catch (e) {
      lastErr = e;
      peer.destroy();
      if (e && e.type === 'unavailable-id') continue; // codigo ocupado: probar otro
      throw e;
    }
    peer.on('connection', (conn) => {
      const sock = new PeerSocket(conn);
      const ready = () => onSocket(sock);
      if (conn.open) ready(); else conn.on('open', ready);
    });
    // si se pierde el broker, reintentar (las partidas en curso siguen por WebRTC)
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* */ } }, 2000); });
    return { code, peer };
  }
  throw lastErr || new Error('no se pudo reservar un codigo');
}

// Invitado: conecta con el anfitrion de la sala
export async function joinP2P(code, iceServers) {
  const peer = new Peer(undefined, peerOptions(iceServers));
  await waitOpen(peer);
  const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
  const sock = new PeerSocket(conn);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    conn.on('open', () => { clearTimeout(t); resolve(); });
    peer.on('error', (e) => { clearTimeout(t); reject(e); });
    conn.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  sock.peer = peer;
  const origClose = sock.close.bind(sock);
  sock.close = () => { origClose(); peer.destroy(); };
  return sock;
}
