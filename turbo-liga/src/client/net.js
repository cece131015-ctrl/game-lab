// Cliente online: conexion WebSocket con el servidor de salas y sesion de juego con
// prediccion local + reconciliacion (rebobinar al estado del servidor y re-simular las entradas propias).
import { Game, PHASE } from '../shared/game.js';
import { DT } from '../shared/constants.js';
import { copyControls, packControls, emptyControls } from '../shared/car.js';
import { V3, Quat } from '../shared/vec.js';
import { PoseHistory } from './localSession.js';

// Eventos que decide el servidor (los demas se predicen localmente para que respondan al instante)
const SERVER_EVENTS = new Set(['goal', 'demo', 'save', 'shot', 'countdown', 'go', 'overtime', 'end', 'respawn']);
const LOCAL_EVENTS = new Set(['hit', 'bounce', 'jump', 'flip', 'pad', 'bump']);

export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.id = null;
    this.ice = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.rtt = 0;
    this.connected = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  off(type) { delete this.handlers[type]; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  connect(profile) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) { reject(e); return; }
      this.ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('timeout')); this.ws.close(); } }, 8000);
      this.ws.onopen = () => {
        this.send({ t: 'hello', v: 1, ...profile });
      };
      this.ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') { this.emit('snapshot', ev.data); return; }
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          this.id = msg.id;
          if (msg.ice && msg.ice.length) this.ice = msg.ice;
          this.connected = true;
          if (!settled) { settled = true; clearTimeout(timer); resolve(msg); }
          this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
        } else if (msg.t === 'pong') {
          this.rtt = performance.now() - msg.ts;
        }
        this.emit(msg.t, msg);
      };
      this.ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('closed')); }
        this.emit('close', {});
      };
      this.ws.onerror = () => {};
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
    this.connected = false;
  }
}

const _q = new Quat();
const _qi = new Quat();

export class OnlineSession {
  constructor(net, startMsg) {
    this.net = net;
    this.online = true;
    this.kind = 'online';
    this.paused = false;
    this.events = [];
    this.history = new PoseHistory();
    this.acc = 0;
    this.alpha = 0;
    this.seq = 0;
    this.inputs = new Map();
    this.sendBuf = [];
    this.sendFirst = 1;
    this.lastEmitted = 0;
    this.timeScale = 1;
    this.pending = null;
    this.offsets = new Map(); // suavizado visual tras correcciones
    this.ballOffset = new V3();
    this.serverTick = 0;
    this.queueLen = 0;
    this.lastSnapshotAt = 0;
    this.setup(startMsg);
    net.on('snapshot', (buf) => { this.pending = buf; this.lastSnapshotAt = performance.now(); });
  }

  setup(msg) {
    this.game = new Game({ ...msg.opts, authoritative: false, seed: msg.seed });
    this.localCarId = msg.you ?? null;
    for (const p of msg.players) this.game.addPlayer(p.id, p);
    this.game.start();
    this.history.save(this.game.world);
    this.rosterVersion = (this.rosterVersion || 0) + 1;
  }

  // Cambio de jugadores en mitad del partido (alguien entra o sale)
  updateRoster(players, you) {
    const g = this.game;
    const ids = new Set(players.map((p) => p.id));
    for (const p of g.playerList()) if (!ids.has(p.id)) g.removePlayer(p.id);
    for (const p of players) {
      const existing = g.players.get(p.id);
      if (!existing) g.addPlayer(p.id, p);
      else {
        Object.assign(existing, { name: p.name, isBot: p.isBot, colors: p.colors, carType: p.carType, team: p.team });
        const car = g.world.getCar(p.id);
        if (car && car.type !== p.carType) car.setType(p.carType);
        if (car) car.team = p.team;
      }
    }
    this.localCarId = you ?? null;
    this.rosterVersion++;
  }

  get players() { return this.game.playerList(); }

  update(frameDt, controls) {
    if (this.pending) {
      this.applySnapshot(this.pending);
      this.pending = null;
    }
    const game = this.game;
    this.acc += Math.min(frameDt, 0.25) * this.timeScale;
    const me = this.localCarId != null ? game.world.getCar(this.localCarId) : null;
    while (this.acc >= DT) {
      this.seq++;
      const c = copyControls(emptyControls(), controls);
      if (game.phase === PHASE.COUNTDOWN) { c.throttle = 0; c.boost = false; }
      this.inputs.set(this.seq, c);
      if (this.sendBuf.length === 0) this.sendFirst = this.seq;
      this.sendBuf.push(packControls(c));
      this.history.save(game.world);
      if (me) copyControls(me.controls, c);
      game.step(DT);
      this._collectEvents(true);
      this.lastEmitted = this.seq;
      this.acc -= DT;
    }
    if (this.sendBuf.length && this.localCarId != null) {
      this.net.send({ t: 'in', s: this.sendFirst, c: this.sendBuf });
    }
    this.sendBuf = [];
    this.alpha = this.acc / DT;
    // desvanecer los offsets de suavizado
    const k = Math.exp(-frameDt * 10);
    for (const o of this.offsets.values()) {
      o.pos.scale(k);
      _qi.set(0, 0, 0, 1);
      o.quat.slerp(_qi, 1 - k);
    }
    this.ballOffset.scale(Math.exp(-frameDt * 14));
  }

  _collectEvents(emit) {
    const game = this.game;
    if (emit) {
      for (const e of game.events) {
        if (!LOCAL_EVENTS.has(e.type)) continue;
        if (e.car === this.localCarId) e.local = true;
        this.events.push(e);
      }
    }
    game.events.length = 0;
  }

  // Eventos autoritativos que llegan del servidor
  pushServerEvents(list) {
    for (const e of list) {
      if (!SERVER_EVENTS.has(e.type)) continue;
      if (e.car === this.localCarId) e.local = true;
      this.events.push(e);
    }
  }

  applySnapshot(buf) {
    const arr = new Float32Array(buf);
    const game = this.game;
    const lastSeq = arr[0];
    this.queueLen = arr[1];
    this.serverTick = arr[2];
    // pose renderizada antes de corregir (para suavizar)
    const before = new Map();
    for (const car of game.world.cars) {
      const p = new V3(), q = new Quat();
      this.getCarPose(car, p, q);
      before.set(car.id, { p, q, demoed: car.isDemoed });
    }
    const ballBefore = new V3();
    this.getBallPos(ballBefore);

    game.deserialize(arr, 3, { skipControlsFor: this.localCarId });
    game.events.length = 0;

    // re-simular las entradas que el servidor aun no ha procesado
    const me = this.localCarId != null ? game.world.getCar(this.localCarId) : null;
    let from = lastSeq + 1;
    if (this.seq - from > 90) from = this.seq - 90;
    if (from > this.seq + 1) { this.seq = lastSeq; from = lastSeq + 1; }
    this.history.save(game.world);
    for (let s = from; s <= this.seq; s++) {
      const c = this.inputs.get(s);
      if (me && c) copyControls(me.controls, c);
      this.history.save(game.world);
      game.step(DT);
      this._collectEvents(false);
    }
    for (const s of this.inputs.keys()) if (s <= lastSeq) this.inputs.delete(s);

    // offsets de suavizado
    const p = new V3(), q = new Quat();
    for (const car of game.world.cars) {
      const b = before.get(car.id);
      let o = this.offsets.get(car.id);
      if (!o) { o = { pos: new V3(), quat: new Quat() }; this.offsets.set(car.id, o); }
      o.pos.set(0, 0, 0); o.quat.set(0, 0, 0, 1);
      if (!b || b.demoed || car.isDemoed) continue;
      this._rawPose(car, p, q);
      const dx = b.p.x - p.x, dy = b.p.y - p.y, dz = b.p.z - p.z;
      if (dx * dx + dy * dy + dz * dz > 600 * 600) continue; // teletransporte (saque, reaparicion)
      o.pos.set(dx, dy, dz);
      // quatOffset = before * inverse(nuevo)
      _qi.set(-q.x, -q.y, -q.z, q.w);
      o.quat.copy(b.q).multiply(_qi);
    }
    const bp = game.world.ball.pos;
    const hp = this.history.ballPrev, a = this.alpha;
    const nx = hp.x + (bp.x - hp.x) * a, ny = hp.y + (bp.y - hp.y) * a, nz = hp.z + (bp.z - hp.z) * a;
    const ox = ballBefore.x - nx, oy = ballBefore.y - ny, oz = ballBefore.z - nz;
    if (ox * ox + oy * oy + oz * oz < 800 * 800) this.ballOffset.set(ox, oy, oz); else this.ballOffset.set(0, 0, 0);

    // ajustar el ritmo para mantener 2-4 entradas en la cola del servidor
    if (this.queueLen < 1.5) this.timeScale = 1.04;
    else if (this.queueLen > 5) this.timeScale = 0.96;
    else this.timeScale = 1;
  }

  _rawPose(car, outPos, outQuat) {
    const prev = this.history.prev.get(car.id);
    const a = this.alpha;
    if (!prev) { outPos.copy(car.pos); outQuat.copy(car.quat); return; }
    outPos.set(prev.pos.x + (car.pos.x - prev.pos.x) * a, prev.pos.y + (car.pos.y - prev.pos.y) * a, prev.pos.z + (car.pos.z - prev.pos.z) * a);
    outQuat.copy(prev.quat).slerp(car.quat, a);
  }

  getCarPose(car, outPos, outQuat) {
    this._rawPose(car, _p, _q);
    const o = this.offsets.get(car.id);
    if (o) {
      _p.add(o.pos);
      _q2.copy(o.quat).multiply(_q);
      _q.copy(_q2);
    }
    outPos.set(_p.x, _p.y, _p.z);
    outQuat.set(_q.x, _q.y, _q.z, _q.w);
  }

  getBallPos(out) {
    const b = this.game.world.ball.pos, p = this.history.ballPrev, a = this.alpha;
    out.set(p.x + (b.x - p.x) * a + this.ballOffset.x, p.y + (b.y - p.y) * a + this.ballOffset.y, p.z + (b.z - p.z) * a + this.ballOffset.z);
  }

  drainEvents() {
    const ev = this.events.slice();
    this.events.length = 0;
    return ev;
  }

  destroy() {
    this.net.off('snapshot');
  }
}

const _p = new V3();
const _q2 = new Quat();
