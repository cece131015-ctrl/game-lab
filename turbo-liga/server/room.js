import { Game, PHASE } from '../src/shared/game.js';
import { Bot, DIFFICULTIES } from '../src/shared/bot.js';
import { DT, TEAM_BLUE, TEAM_ORANGE } from '../src/shared/constants.js';
import { unpackControls } from '../src/shared/car.js';
import { CAR_TYPES } from '../src/shared/cars.js';

const BOT_NAMES = ['Turbo', 'Chispa', 'Rayo', 'Nitro', 'Pistón', 'Bólido', 'Cometa', 'Trueno', 'Halcón', 'Neón'];
const SNAPSHOT_EVERY = 4; // 30 Hz
const MAX_QUEUE = 40;

function sanitizeSettings(s, prev = {}) {
  const out = { teamSize: 2, bots: true, difficulty: 'pro', matchTime: 300, ...prev };
  if (s.teamSize !== undefined) out.teamSize = Math.max(1, Math.min(3, Number(s.teamSize) | 0 || 2));
  if (s.bots !== undefined) out.bots = !!s.bots;
  if (typeof s.difficulty === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTIES, s.difficulty)) out.difficulty = s.difficulty;
  if (s.matchTime !== undefined) out.matchTime = [120, 180, 300, 420, 600].includes(Number(s.matchTime)) ? Number(s.matchTime) : 300;
  return out;
}

export class Room {
  constructor(code, settings, onEmpty) {
    this.code = code;
    this.settings = sanitizeSettings(settings);
    this.members = new Map();
    this.teams = new Map();
    this.host = null;
    this.match = null;
    this.onEmpty = onEmpty;
  }

  broadcast(obj, except = null) {
    const s = JSON.stringify(obj);
    for (const c of this.members.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s);
  }

  teamCount(team) {
    let n = 0;
    for (const t of this.teams.values()) if (t === team) n++;
    return n;
  }

  addMember(client) {
    this.members.set(client.id, client);
    client.room = this;
    if (this.host == null) this.host = client.id;
    // equipo con menos jugadores (o espectador si estan llenos)
    const b = this.teamCount(TEAM_BLUE), o = this.teamCount(TEAM_ORANGE);
    let team = -1;
    if (b <= o && b < this.settings.teamSize) team = TEAM_BLUE;
    else if (o < this.settings.teamSize) team = TEAM_ORANGE;
    else if (b < this.settings.teamSize) team = TEAM_BLUE;
    this.teams.set(client.id, team);
    client.send({ t: 'joined', code: this.code });
    this.broadcast({ t: 'chat', system: true, text: `${client.name} se ha unido a la sala` }, client);
    this.broadcastState();
    if (this.match) this.match.addHuman(client);
  }

  removeMember(client) {
    if (!this.members.has(client.id)) return;
    this.members.delete(client.id);
    this.teams.delete(client.id);
    client.room = null;
    if (this.match) this.match.removeHuman(client);
    if (this.members.size === 0) {
      if (this.match) this.match.destroy();
      this.match = null;
      this.onEmpty();
      return;
    }
    if (this.host === client.id) this.host = this.members.keys().next().value;
    this.broadcast({ t: 'chat', system: true, text: `${client.name} ha salido de la sala` });
    this.broadcastState();
  }

  updateProfile(client) {
    this.broadcastState();
    if (this.match) this.match.updateHumanProfile(client);
  }

  state() {
    return {
      t: 'room', code: this.code, host: this.host, settings: this.settings, inGame: !!this.match,
      members: [...this.members.values()].map((c) => ({
        id: c.id, name: c.name, team: this.teams.get(c.id), carType: c.carType, colors: c.colors, mic: !!c.mic,
      })),
    };
  }

  broadcastState() { this.broadcast(this.state()); }

  handle(client, msg) {
    const isHost = client.id === this.host;
    switch (msg.t) {
      case 'in':
        if (this.match && Array.isArray(msg.c)) this.match.handleInput(client, msg);
        break;
      case 'team': {
        if (this.match) return;
        const team = Number(msg.team);
        if (team === -1) this.teams.set(client.id, -1);
        else if ((team === TEAM_BLUE || team === TEAM_ORANGE) && this.teams.get(client.id) !== team) {
          if (this.teamCount(team) >= this.settings.teamSize) { client.send({ t: 'error', msg: 'Ese equipo está completo' }); return; }
          this.teams.set(client.id, team);
        }
        this.broadcastState();
        break;
      }
      case 'settings': {
        if (!isHost || this.match) return;
        this.settings = sanitizeSettings(msg.settings || {}, this.settings);
        // si se reduce el tamaño de equipo, mover el exceso a espectadores
        for (const team of [TEAM_BLUE, TEAM_ORANGE]) {
          let n = 0;
          for (const [id, t] of this.teams) if (t === team && ++n > this.settings.teamSize) this.teams.set(id, -1);
        }
        this.broadcastState();
        break;
      }
      case 'start': {
        if (!isHost || this.match) return;
        const humans = [...this.teams.values()].filter((t) => t === 0 || t === 1).length;
        if (humans === 0) { client.send({ t: 'error', msg: 'Al menos un jugador debe estar en un equipo' }); return; }
        this.match = new Match(this);
        this.broadcastState();
        break;
      }
      case 'rematch':
        if (isHost && this.match) this.match.restart();
        break;
      case 'toLobby':
        if (isHost && this.match) {
          this.match.destroy();
          this.match = null;
          this.broadcast({ t: 'lobby' });
          this.broadcastState();
        }
        break;
      case 'chat': {
        const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
        if (text) this.broadcast({ t: 'chat', from: client.id, name: client.name, team: this.teams.get(client.id), text });
        break;
      }
      case 'mic':
        client.mic = !!msg.on;
        this.broadcastState();
        break;
      default: break;
    }
  }
}

// Partido autoritativo de una sala
class Match {
  constructor(room) {
    this.room = room;
    this.build();
    this.lastTime = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), 4);
    this.endedAt = 0;
  }

  build() {
    const s = this.room.settings;
    this.seed = (Math.random() * 1e9) | 0;
    this.game = new Game({ teamSize: s.teamSize, matchTime: s.matchTime, seed: this.seed });
    this.slots = new Map(); // carId -> {clientId, bot, queue, lastSeq}
    this.nextCarId = 1;
    this.botNameIdx = Math.floor(Math.random() * BOT_NAMES.length);
    for (const team of [TEAM_BLUE, TEAM_ORANGE]) {
      const humans = [...this.room.teams.entries()].filter(([, t]) => t === team).map(([id]) => this.room.members.get(id)).filter(Boolean);
      for (const c of humans) this.addSlot(team, c);
      if (s.bots) for (let i = humans.length; i < s.teamSize; i++) this.addSlot(team, null);
    }
    this.game.start();
    this.sendStartAll();
  }

  addSlot(team, client) {
    const id = this.nextCarId++;
    const s = this.room.settings;
    if (client) {
      this.game.addPlayer(id, { team, name: client.name, carType: client.carType, colors: client.colors });
      this.slots.set(id, { clientId: client.id, bot: null, queue: [], lastSeq: 0, lastQueued: 0, starved: 0 });
    } else {
      const name = `${BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length]} (bot)`;
      this.game.addPlayer(id, { team, name, isBot: true, carType: CAR_TYPES[id % CAR_TYPES.length], colors: { primary: id % 6 }, difficulty: s.difficulty });
      this.slots.set(id, { clientId: null, bot: new Bot(id, s.difficulty), queue: [], lastSeq: 0, lastQueued: 0, starved: 0 });
    }
    return id;
  }

  carOf(clientId) {
    for (const [id, s] of this.slots) if (s.clientId === clientId) return id;
    return null;
  }

  roster() {
    return this.game.playerList().map((p) => ({ id: p.id, name: p.name, team: p.team, carType: p.carType, colors: p.colors, isBot: p.isBot }));
  }

  startMsg(client) {
    return {
      t: 'start', seed: this.seed,
      opts: { teamSize: this.game.opts.teamSize, matchTime: this.game.opts.matchTime },
      players: this.roster(), you: this.carOf(client.id),
    };
  }

  sendStartAll() {
    for (const c of this.room.members.values()) c.send(this.startMsg(c));
    this.broadcastStats();
  }

  statsMsg() {
    return {
      t: 'stats',
      players: this.game.playerList().map((p) => ({ id: p.id, goals: p.goals, assists: p.assists, saves: p.saves, shots: p.shots, demos: p.demos, points: p.points })),
    };
  }

  broadcastStats() {
    this.room.broadcast(this.statsMsg());
    this.lastStatsAt = performance.now();
  }

  broadcastRoster() {
    const players = this.roster();
    for (const c of this.room.members.values()) c.send({ t: 'roster', players, you: this.carOf(c.id) });
  }

  addHuman(client) {
    // tomar el control de un bot del equipo con menos humanos, si lo hay
    const humansIn = (team) => [...this.slots.entries()].filter(([id, s]) => s.clientId != null && this.game.players.get(id)?.team === team).length;
    const teams = [TEAM_BLUE, TEAM_ORANGE].sort((a, b) => humansIn(a) - humansIn(b));
    let assigned = null;
    for (const team of teams) {
      for (const [id, s] of this.slots) {
        if (s.bot && this.game.players.get(id)?.team === team) { assigned = id; break; }
      }
      if (assigned) break;
    }
    if (assigned == null) {
      for (const team of teams) {
        const count = [...this.game.players.values()].filter((p) => p.team === team).length;
        if (count < this.game.opts.teamSize) {
          assigned = this.addSlot(team, client);
          this.game.world.respawnCar(this.game.world.getCar(assigned));
          this.room.teams.set(client.id, team);
          break;
        }
      }
    } else {
      const slot = this.slots.get(assigned);
      slot.bot = null;
      slot.clientId = client.id;
      slot.queue = [];
      slot.lastSeq = 0;
      slot.lastQueued = 0;
      const p = this.game.players.get(assigned);
      Object.assign(p, { name: client.name, isBot: false, colors: client.colors, carType: client.carType });
      const car = this.game.world.getCar(assigned);
      if (car) car.setType(client.carType);
      p.carType = car ? car.type : client.carType;
      this.room.teams.set(client.id, p.team);
    }
    if (assigned == null) this.room.teams.set(client.id, -1);
    client.send(this.startMsg(client));
    client.send(this.statsMsg());
    if (this.game.phase === PHASE.ENDED) {
      const winner = this.game.score[0] > this.game.score[1] ? TEAM_BLUE : TEAM_ORANGE;
      client.send({ t: 'ev', list: [{ type: 'end', winner, score: [...this.game.score] }] });
    }
    this.broadcastRoster();
    this.room.broadcastState();
  }

  removeHuman(client) {
    const id = this.carOf(client.id);
    if (id == null) return;
    const slot = this.slots.get(id);
    if (this.room.settings.bots) {
      slot.clientId = null;
      slot.bot = new Bot(id, this.room.settings.difficulty);
      slot.queue = [];
      const p = this.game.players.get(id);
      if (p) { p.isBot = true; p.name = `${BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length]} (bot)`; }
    } else {
      this.slots.delete(id);
      this.game.removePlayer(id);
    }
    this.broadcastRoster();
  }

  updateHumanProfile(client) {
    const id = this.carOf(client.id);
    if (id == null) return;
    const p = this.game.players.get(id);
    if (p) { p.name = client.name; p.colors = client.colors; }
    this.broadcastRoster();
  }

  handleInput(client, msg) {
    const id = this.carOf(client.id);
    if (id == null) return;
    const slot = this.slots.get(id);
    const first = Number(msg.s);
    if (!Number.isInteger(first) || first < 0) return;
    const list = msg.c.slice(0, 64);
    for (let i = 0; i < list.length; i++) {
      const seq = first + i;
      if (seq <= slot.lastQueued) continue;
      if (!Array.isArray(list[i])) continue;
      slot.queue.push({ seq, c: list[i] });
      slot.lastQueued = seq;
    }
    if (slot.queue.length > MAX_QUEUE) slot.queue.splice(0, slot.queue.length - MAX_QUEUE);
  }

  restart() {
    this.build();
    this.endedAt = 0;
  }

  loop() {
    try {
      this.step();
    } catch (e) {
      // un fallo de la simulacion termina este partido, nunca el servidor
      console.error('Error en el partido de la sala', this.room.code, e);
      this.destroy();
      if (this.room.match === this) {
        this.room.match = null;
        this.room.broadcast({ t: 'chat', system: true, text: 'El partido se ha detenido por un error' });
        this.room.broadcast({ t: 'lobby' });
        this.room.broadcastState();
      }
    }
  }

  step() {
    const now = performance.now();
    this.acc += Math.min(now - this.lastTime, 250) / 1000;
    this.lastTime = now;
    const game = this.game;
    let ticks = 0;
    // en el navegador del anfitrion el hilo tambien renderiza: permitir recuperar mas ticks por llamada
    const maxTicks = typeof window !== 'undefined' ? 48 : 12;
    while (this.acc >= DT && ticks < maxTicks) {
      for (const [id, slot] of this.slots) {
        const car = game.world.getCar(id);
        if (!car) continue;
        if (slot.bot) {
          const c = slot.bot.update(game, DT);
          Object.assign(car.controls, c);
        } else if (slot.queue.length) {
          const inp = slot.queue.shift();
          unpackControls(inp.c, car.controls);
          slot.lastSeq = inp.seq;
          slot.starved = 0;
        } else if (++slot.starved > 30) {
          // sin entradas durante 0,25 s (pestaña oculta, corte): soltar los mandos
          const c = car.controls;
          c.throttle = c.steer = c.pitch = c.yaw = c.roll = 0;
          c.jump = c.boost = c.handbrake = false;
        }
      }
      game.step(DT);
      if (game.events.length) {
        this.room.broadcast({ t: 'ev', list: game.events.map(compactEvent) });
        let statsChanged = false;
        for (const e of game.events) {
          if (e.type === 'end') this.endedAt = now;
          if (e.type === 'goal' || e.type === 'save' || e.type === 'shot' || e.type === 'demo' || e.type === 'end') statsChanged = true;
        }
        game.events.length = 0;
        if (statsChanged) this.broadcastStats();
      }
      if (game.world.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
      this.acc -= DT;
      ticks++;
    }
    if (ticks >= maxTicks) this.acc = 0;
    if (now - (this.lastStatsAt || 0) > 2000) this.broadcastStats();
    // volver a la sala automaticamente un rato despues del final
    if (this.endedAt && now - this.endedAt > 90000 && this.room.match === this) {
      this.destroy();
      this.room.match = null;
      this.room.broadcast({ t: 'lobby' });
      this.room.broadcastState();
    }
  }

  sendSnapshot() {
    const body = this.game.serialize([]);
    const n = body.length + 3;
    const byClient = new Map();
    for (const [, slot] of this.slots) if (slot.clientId != null) byClient.set(slot.clientId, slot);
    for (const c of this.room.members.values()) {
      const arr = new Float32Array(n);
      const slot = byClient.get(c.id);
      arr[0] = slot ? slot.lastSeq : 0;
      arr[1] = slot ? slot.queue.length : 0;
      arr[2] = this.game.world.tick;
      arr.set(body, 3);
      c.sendBinary(arr.buffer);
    }
  }

  destroy() {
    clearInterval(this.timer);
  }
}

function compactEvent(e) {
  const o = { ...e };
  for (const k of ['x', 'y', 'z', 'speed', 'strength']) if (typeof o[k] === 'number') o[k] = Math.round(o[k]);
  return o;
}

export { PHASE };
