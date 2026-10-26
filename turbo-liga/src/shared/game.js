// Reglas del partido: saque, cuenta atras, goles, tiempo, prorroga y estadisticas.
import { World } from './world.js';
import { Ball } from './ball.js';
import * as C from './constants.js';

export const PHASE = { COUNTDOWN: 0, PLAY: 1, GOAL: 2, ENDED: 3 };
export const PHASE_NAMES = ['countdown', 'play', 'goal', 'ended'];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  // opts: { teamSize, matchTime, freePlay, unlimitedBoost, authoritative, seed }
  constructor(opts = {}) {
    this.opts = {
      teamSize: 1, matchTime: C.MATCH_TIME, freePlay: false, unlimitedBoost: false,
      authoritative: true, seed: (Math.random() * 1e9) | 0, ...opts,
    };
    this.world = new World();
    this.rand = mulberry32(this.opts.seed);
    this.players = new Map(); // carId -> info
    this.score = [0, 0];
    this.timeLeft = this.opts.matchTime;
    this.overtime = false;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTimer = C.KICKOFF_COUNTDOWN;
    this.events = this.world.events;
    this.touches = []; // historial de toques {carId, team, time}
    this.elapsed = 0;
    this.lastScorer = null;
    this.ballHitThisKickoff = false;
    this.kickoffTouchTime = 0; // momento del primer toque del saque
    this.world.onTouch = (car, strength) => this._onTouch(car, strength);
    this.world.onDemo = (car, by) => {
      if (!this.opts.authoritative) return; // en el cliente las estadisticas llegan del servidor
      const p = this.players.get(by.id);
      if (p) { p.demos++; p.points += 25; }
    };
  }

  addPlayer(id, info) {
    const car = this.world.addCar(id, info.team, info.carType || 'octane');
    car.unlimitedBoost = !!this.opts.unlimitedBoost;
    this.players.set(id, {
      id, name: info.name || `Jugador ${id}`, team: info.team, isBot: !!info.isBot,
      carType: car.type, colors: info.colors || null, difficulty: info.difficulty || null,
      goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, points: 0,
    });
    return car;
  }

  removePlayer(id) {
    this.world.removeCar(id);
    this.players.delete(id);
  }

  start() {
    this.score = [0, 0];
    this.timeLeft = this.opts.matchTime;
    this.overtime = false;
    for (const p of this.players.values()) {
      p.goals = p.assists = p.saves = p.shots = p.demos = p.points = 0;
    }
    this.setupKickoff();
  }

  setupKickoff() {
    const w = this.world;
    w.ball.reset();
    w.ballEnabled = true;
    this.touches = [];
    this.ballHitThisKickoff = false;
    for (const pad of w.pads) pad.timer = 0;
    const blue = w.cars.filter((c) => c.team === C.TEAM_BLUE);
    const orange = w.cars.filter((c) => c.team === C.TEAM_ORANGE);
    const n = Math.max(blue.length, orange.length);
    // elegir posiciones de saque (las mismas, reflejadas, para el otro equipo)
    const idx = [0, 1, 2, 3, 4];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const chosen = idx.slice(0, Math.min(n, 5)).sort((a, b) => a - b);
    const place = (cars, flip) => {
      cars.forEach((car, i) => {
        const s = C.KICKOFF_SPAWNS[chosen[i % chosen.length]];
        const extra = i >= chosen.length ? 400 * Math.floor(i / chosen.length) : 0;
        car.resetState();
        car.placeAt(s.x * flip, (s.y - extra) * flip, C.CAR_SPAWN_REST_Z, s.yaw + (flip === 1 ? 0 : Math.PI));
        car.unlimitedBoost = !!this.opts.unlimitedBoost;
        if (car.unlimitedBoost) car.boost = C.BOOST_MAX;
      });
    };
    place(blue, 1);
    place(orange, -1);
    if (this.opts.freePlay) {
      this.phase = PHASE.PLAY;
      this.phaseTimer = 0;
    } else {
      this.phase = PHASE.COUNTDOWN;
      this.phaseTimer = C.KICKOFF_COUNTDOWN;
      this.events.push({ type: 'countdown' });
    }
  }

  resetBallOnly() {
    this.world.ball.reset(0, 0, C.BALL_REST_Z);
    this.world.ballEnabled = true;
    this.phase = PHASE.PLAY;
  }

  _onTouch(car, strength) {
    if (!this.opts.authoritative) return;
    const p = this.players.get(car.id);
    const last = this.touches[this.touches.length - 1];
    if (!this.ballHitThisKickoff) this.kickoffTouchTime = this.elapsed;
    this.ballHitThisKickoff = true;
    if (!last || last.carId !== car.id || this.elapsed - last.time > 0.5) {
      // el toque anterior se decide con el balon tal como lo dejo (en el mismo tick no se puede)
      if (last) {
        if (this.elapsed > last.time) this._resolveTouch(last);
        else last.checkShot = last.saveCheck = false;
      }
      // posible parada: el balon iba a entrar en nuestra porteria antes del toque.
      // Se confirma unos ticks despues si el toque lo desvio (los toques del saque no cuentan)
      const ball = this.world.ball;
      const saveCheck = !!p && !this.opts.freePlay && strength > 300 &&
        this.elapsed - this.kickoffTouchTime > 0.5 && headingIntoGoal(ball.pos, ball.vel, saveLineY(car.team));
      this.touches.push({ carId: car.id, team: car.team, time: this.elapsed, checkShot: true, saveCheck, shot: false });
      if (this.touches.length > 10) this.touches.shift();
      if (p) p.points += 2;
    } else {
      last.time = this.elapsed;
    }
  }

  step(dt) {
    const w = this.world;
    this.elapsed += dt;
    switch (this.phase) {
      case PHASE.COUNTDOWN: {
        w.step(dt, true);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          // el cliente tambien arranca solo al acabar la cuenta atras (asi no pierde el saque)
          this.phase = PHASE.PLAY;
          this.phaseTimer = 0;
          if (this.opts.authoritative) this.events.push({ type: 'go' });
        }
        break;
      }
      case PHASE.PLAY: {
        w.step(dt);
        if (!this.opts.freePlay) {
          if (this.overtime) this.timeLeft += dt;
          else if (this.ballHitThisKickoff) this.timeLeft = Math.max(0, this.timeLeft - dt); // el reloj arranca con el primer toque
        }
        if (this.opts.authoritative) {
          this._checkShots();
          this._checkGoal();
          if (!this.opts.freePlay && !this.overtime && this.timeLeft <= 0 && this.phase === PHASE.PLAY) {
            // el tiempo se acaba cuando el balon toca el suelo
            if (w.ball.pos.z < C.BALL_RADIUS + 30 || this.timeLeft < -0.01) this._timeUp();
          }
        }
        break;
      }
      case PHASE.GOAL: {
        w.step(dt);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0 && this.opts.authoritative) {
          if (this.opts.freePlay) this.resetBallOnly();
          else if (this.overtime && this.score[0] !== this.score[1]) this._endMatch();
          else if (!this.overtime && this.timeLeft <= 0) this._timeUp();
          else this.setupKickoff();
        }
        break;
      }
      case PHASE.ENDED: {
        w.step(dt);
        break;
      }
    }
  }

  _checkShots() {
    // Tiros y paradas se deciden un poco despues del toque (o al llegar el siguiente)
    const t = this.touches[this.touches.length - 1];
    if (!t) return;
    const age = this.elapsed - t.time;
    if (t.checkShot && age >= 0.05) this._resolveTouch(t, true, false);
    if (t.saveCheck && age >= 0.1) this._resolveTouch(t, false, true);
  }

  _resolveTouch(t, shot = true, save = true) {
    const ball = this.world.ball;
    const p = this.players.get(t.carId);
    if (shot && t.checkShot) {
      // tiro: el toque deja el balon camino de la porteria rival
      t.checkShot = false;
      const oppGoalY = t.team === C.TEAM_BLUE ? C.ARENA_EXTENT_Y : -C.ARENA_EXTENT_Y;
      if (headingIntoGoal(ball.pos, ball.vel, oppGoalY)) {
        t.shot = true;
        if (p) { p.shots++; p.points += 20; }
        this.events.push({ type: 'shot', car: t.carId });
      }
    }
    if (save && t.saveCheck) {
      // parada: el balon ya no va hacia nuestra porteria, ni en linea recta (tambien balones
      // lentos) ni rebotando en el palo o la pared
      t.saveCheck = false;
      const lineY = saveLineY(t.team);
      if (!headingIntoGoal(ball.pos, ball.vel, lineY, 10) && !ballEntersGoal(ball, lineY, 3)) {
        if (p) { p.saves++; p.points += 50; }
        this.events.push({ type: 'save', car: t.carId });
      }
    }
  }

  _checkGoal() {
    const b = this.world.ball;
    if (Math.abs(b.pos.y) <= C.GOAL_SCORE_Y + C.BALL_RADIUS) return;
    const scoringTeam = b.pos.y > 0 ? C.TEAM_BLUE : C.TEAM_ORANGE;
    let scorer = null, assist = null;
    for (let i = this.touches.length - 1; i >= 0; i--) {
      const t = this.touches[i];
      if (!scorer) {
        if (t.team === scoringTeam) scorer = t;
        else if (i === this.touches.length - 1) continue; // gol en propia: el ultimo toque fue rival
      } else if (t.team === scoringTeam && t.carId !== scorer.carId && scorer.time - t.time < 5) {
        assist = t; break;
      }
    }
    for (const t of this.touches) t.saveCheck = false; // con gol no hay parada
    if (!this.opts.freePlay) this.score[scoringTeam]++;
    const sp = scorer && this.players.get(scorer.carId);
    if (sp && !this.opts.freePlay) {
      sp.goals++; sp.points += 100;
      if (!scorer.shot) sp.shots++; // todo gol cuenta como tiro
    }
    const ap = assist && this.players.get(assist.carId);
    if (ap && !this.opts.freePlay) { ap.assists++; ap.points += 50; }
    const speed = b.vel.length();
    this.events.push({
      type: 'goal', team: scoringTeam, scorer: scorer ? scorer.carId : -1, assist: assist ? assist.carId : -1,
      speed, x: b.pos.x, y: b.pos.y, z: b.pos.z,
    });
    this.lastScorer = scorer ? scorer.carId : -1;
    this.world.ballEnabled = false;
    this.phase = PHASE.GOAL;
    this.phaseTimer = this.opts.freePlay ? 2 : C.GOAL_CELEBRATION_TIME;
  }

  _timeUp() {
    if (this.score[0] === this.score[1]) {
      this.overtime = true;
      this.timeLeft = 0;
      this.events.push({ type: 'overtime' });
      this.setupKickoff();
    } else {
      this._endMatch();
    }
  }

  _endMatch() {
    this.phase = PHASE.ENDED;
    this.world.ballEnabled = false;
    const winner = this.score[0] > this.score[1] ? C.TEAM_BLUE : C.TEAM_ORANGE;
    this.events.push({ type: 'end', winner, score: [...this.score] });
  }

  // --- Serializacion (estado de partido + fisica) ---
  serialize(out = []) {
    out.push(this.phase, this.phaseTimer, this.timeLeft, this.overtime ? 1 : 0, this.score[0], this.score[1],
      this.ballHitThisKickoff ? 1 : 0);
    this.world.serialize(out);
    return out;
  }

  deserialize(a, i = 0, opts = {}) {
    this.phase = a[i++];
    this.phaseTimer = a[i++];
    this.timeLeft = a[i++];
    this.overtime = !!a[i++];
    this.score[0] = a[i++];
    this.score[1] = a[i++];
    this.ballHitThisKickoff = !!a[i++];
    return this.world.deserialize(a, i, opts);
  }

  playerList() {
    return [...this.players.values()];
  }
}

// Linea de gol (centro del balon) de la porteria que defiende el equipo
function saveLineY(team) {
  return (team === C.TEAM_BLUE ? -1 : 1) * (C.GOAL_SCORE_Y + C.BALL_RADIUS);
}

// ¿Cruza el balon (solo con el estadio, sin coches) esa linea de gol en los proximos segundos?
const simBall = new Ball();
function ballEntersGoal(ball, lineY, secs) {
  simBall.copyFrom(ball);
  for (let t = 0; t <= secs; t += C.DT) {
    if (lineY > 0 ? simBall.pos.y > lineY : simBall.pos.y < lineY) return true;
    simBall.applyForces(C.DT);
    simBall.collideArena();
    simBall.finishTick();
    simBall.integrate(C.DT);
  }
  return false;
}

export function headingIntoGoal(pos, vel, goalY, horizon = 3) {
  const dy = goalY - pos.y;
  if (Math.abs(vel.y) < 1 || Math.sign(dy) !== Math.sign(vel.y)) return false;
  const t = dy / vel.y;
  if (t > horizon) return false;
  const x = pos.x + vel.x * t;
  let z = pos.z + vel.z * t + 0.5 * C.GRAVITY_Z * t * t;
  if (z < C.BALL_RADIUS) z = C.BALL_RADIUS; // rebota en el suelo
  return Math.abs(x) < C.GOAL_HALF_WIDTH + 50 && z < C.GOAL_HEIGHT + 50;
}
