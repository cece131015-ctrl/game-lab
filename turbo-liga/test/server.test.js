// Prueba de extremo a extremo del servidor de salas: crear sala, unirse, señalizacion de voz,
// empezar partido, recibir instantaneas y enviar entradas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { packControls, emptyControls } from '../src/shared/car.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19000 + Math.floor(Math.random() * 1000);
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/healthz`); if (r.ok) return; } catch { /* aun arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el servidor no arranco');
});
after(() => proc && proc.kill());

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs = [];
  const snapshots = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) { snapshots.push(new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)); return; }
    const m = JSON.parse(data.toString());
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const c = {
    ws, msgs, snapshots, name,
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (pred, ms = 4000) => new Promise((resolve, reject) => {
      const found = msgs.find(pred);
      if (found) { resolve(found); return; }
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error(`${name}: timeout esperando mensaje`)), ms);
    }),
    open: () => new Promise((r) => ws.on('open', r)),
  };
  return c;
}

test('flujo completo de una sala online', async () => {
  const a = client('A'); const b = client('B');
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', name: 'Ana', carType: 'octane', colors: { primary: 1, accent: '#ffd23f' } });
  b.send({ t: 'hello', name: 'Beto', carType: 'dominus', colors: { primary: 0, accent: '#ffffff' } });
  const wa = await a.wait((m) => m.t === 'welcome');
  const wb = await b.wait((m) => m.t === 'welcome');
  assert.ok(wa.ice.length > 0);

  a.send({ t: 'create', settings: { teamSize: 2, bots: true, difficulty: 'pro' } });
  const joined = await a.wait((m) => m.t === 'joined');
  assert.match(joined.code, /^[A-Z2-9]{6}$/);

  b.send({ t: 'join', code: 'NOPE00' });
  await b.wait((m) => m.t === 'error');
  b.send({ t: 'join', code: joined.code });
  await b.wait((m) => m.t === 'joined');
  const room = await a.wait((m) => m.t === 'room' && m.members.length === 2);
  assert.equal(room.host, wa.id);
  const teams = room.members.map((m) => m.team).sort();
  assert.deepEqual(teams, [0, 1], 'cada jugador en un equipo');

  // señalizacion WebRTC retransmitida al otro miembro
  a.send({ t: 'rtc', to: wb.id, data: { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } } });
  const rtc = await b.wait((m) => m.t === 'rtc');
  assert.equal(rtc.from, wa.id);

  // estado del micro
  b.send({ t: 'mic', on: true });
  await a.wait((m) => m.t === 'room' && m.members.some((x) => x.id === wb.id && x.mic));

  // chat
  b.send({ t: 'chat', text: '¡hola!' });
  const chat = await a.wait((m) => m.t === 'chat' && m.text === '¡hola!');
  assert.equal(chat.name, 'Beto');

  // solo el anfitrion puede empezar
  b.send({ t: 'start' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!a.msgs.some((m) => m.t === 'start'));
  a.send({ t: 'start' });
  const sa = await a.wait((m) => m.t === 'start');
  const sb = await b.wait((m) => m.t === 'start');
  assert.equal(sa.players.length, 4, '2 humanos + 2 bots');
  assert.ok(sa.you != null && sb.you != null && sa.you !== sb.you);

  // enviar entradas (acelerar) y comprobar que el servidor las procesa
  const ctl = emptyControls(); ctl.throttle = 1;
  let seq = 1;
  const timer = setInterval(() => {
    const batch = [];
    for (let i = 0; i < 2; i++) batch.push(packControls(ctl));
    a.send({ t: 'in', s: seq, c: batch });
    seq += 2;
  }, 1000 / 60);
  await new Promise((r) => setTimeout(r, 1500));
  clearInterval(timer);
  assert.ok(a.snapshots.length > 20, `instantaneas recibidas: ${a.snapshots.length}`);
  const last = a.snapshots[a.snapshots.length - 1];
  assert.ok(last[0] > 50, `el servidor proceso las entradas (lastSeq=${last[0]})`);
  assert.ok(last[2] > 100, 'tick del servidor avanza');

  // mensajes malformados no tumban el servidor
  a.send({ t: 'in', s: 'x', c: [null, 5, 'a', [1, 2]] });
  a.send({ t: 'settings', settings: { teamSize: 'NaN' } });
  a.ws.send('no es json');
  b.send({ t: 'rtc', to: 99999, data: {} });
  const r = await fetch(`http://localhost:${PORT}/healthz`);
  assert.ok(r.ok);

  // al salir un humano, su coche pasa a ser un bot
  b.ws.close();
  const roster = await a.wait((m) => m.t === 'roster');
  assert.equal(roster.players.length, 4);
  assert.ok(roster.players.find((p) => p.id === sb.you).isBot);
  a.ws.close();
});
