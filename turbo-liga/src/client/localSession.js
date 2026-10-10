// Partida local (contra bots o entrenamiento libre). Simulacion fija a 120 Hz con interpolacion.
import { Game, PHASE } from '../shared/game.js';
import { Bot } from '../shared/bot.js';
import { DT, TEAM_BLUE, TEAM_ORANGE, BALL_REST_Z } from '../shared/constants.js';
import { copyControls } from '../shared/car.js';
import { V3, Quat } from '../shared/vec.js';
import { CAR_TYPES } from '../shared/cars.js';

const BOT_NAMES = ['Turbo', 'Chispa', 'Rayo', 'Nitro', 'Pistón', 'Bólido', 'Cometa', 'Trueno', 'Halcón', 'Rocket', 'Neón', 'Vértigo'];

export class PoseHistory {
  constructor() {
    this.prev = new Map();
    this.ballPrev = new V3();
  }
  save(world) {
    for (const car of world.cars) {
      let p = this.prev.get(car.id);
      if (!p) { p = { pos: new V3(), quat: new Quat() }; this.prev.set(car.id, p); }
      p.pos.copy(car.pos); p.quat.copy(car.quat);
    }
    this.ballPrev.copy(world.ball.pos);
  }
}

export class LocalSession {
  constructor(opts) {
    this.opts = opts;
    this.kind = opts.freePlay ? 'freeplay' : 'bots';
    this.online = false;
    this.paused = false;
    this.events = [];
    this.history = new PoseHistory();
    this.acc = 0;
    this.alpha = 0;
    this.build();
  }

  build() {
    const o = this.opts;
    const teamSize = o.freePlay ? 1 : o.teamSize;
    this.game = new Game({
      teamSize, matchTime: o.matchTime || 300, freePlay: !!o.freePlay, unlimitedBoost: !!o.unlimitedBoost,
    });
    this.bots = [];
    this.localCarId = 0;
    const myTeam = o.freePlay ? TEAM_BLUE : (o.team ?? TEAM_BLUE);
    this.game.addPlayer(0, { team: myTeam, name: o.player.name || 'Tú', carType: o.player.carType, colors: o.player.colors });
    let id = 1;
    if (!o.freePlay) {
      const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      for (const team of [TEAM_BLUE, TEAM_ORANGE]) {
        const count = team === myTeam ? teamSize - 1 : teamSize;
        for (let i = 0; i < count; i++) {
          const carType = CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)];
          this.game.addPlayer(id, {
            team, name: `${names[id % names.length]} (bot)`, isBot: true, carType,
            colors: { primary: Math.floor(Math.random() * 6) }, difficulty: o.difficulty,
          });
          this.bots.push(new Bot(id, o.difficulty || 'pro'));
          id++;
        }
      }
    }
    this.game.start();
    this.history.save(this.game.world);
    this.rosterVersion = (this.rosterVersion || 0) + 1;
  }

  restart() {
    this.build();
    this.events.length = 0;
  }

  get players() { return this.game.playerList(); }

  update(frameDt, controls) {
    if (this.paused) return;
    this.acc += Math.min(frameDt, 0.25);
    const game = this.game;
    const me = game.world.getCar(this.localCarId);
    while (this.acc >= DT) {
      this.history.save(game.world);
      if (me) copyControls(me.controls, controls);
      for (const b of this.bots) {
        const c = game.world.getCar(b.carId);
        if (c) copyControls(c.controls, b.update(game, DT));
      }
      game.step(DT);
      if (game.events.length) {
        for (const e of game.events) {
          if (e.car === this.localCarId) e.local = true;
          this.events.push(e);
        }
        game.events.length = 0;
      }
      this.acc -= DT;
    }
    this.alpha = this.acc / DT;
  }

  drainEvents() {
    const ev = this.events.slice();
    this.events.length = 0;
    return ev;
  }

  getCarPose(car, outPos, outQuat) {
    const p = this.history.prev.get(car.id);
    const a = this.alpha;
    if (!p) { outPos.set(car.pos.x, car.pos.y, car.pos.z); outQuat.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w); return; }
    outPos.set(p.pos.x + (car.pos.x - p.pos.x) * a, p.pos.y + (car.pos.y - p.pos.y) * a, p.pos.z + (car.pos.z - p.pos.z) * a);
    _q.copy(p.quat).slerp(car.quat, a);
    outQuat.set(_q.x, _q.y, _q.z, _q.w);
  }

  getBallPos(out) {
    const b = this.game.world.ball.pos, p = this.history.ballPrev, a = this.alpha;
    out.set(p.x + (b.x - p.x) * a, p.y + (b.y - p.y) * a, p.z + (b.z - p.z) * a);
  }

  // Entrenamiento: recolocar el balon delante del coche
  resetBall() {
    const g = this.game;
    const car = g.world.getCar(this.localCarId);
    if (!car) return;
    const f = car.forward(new V3());
    const x = Math.max(-3500, Math.min(3500, car.pos.x + f.x * 800));
    const y = Math.max(-4500, Math.min(4500, car.pos.y + f.y * 800));
    g.world.ball.reset(x, y, BALL_REST_Z + 300);
    g.world.ballEnabled = true;
    if (g.phase !== PHASE.PLAY) g.phase = PHASE.PLAY;
  }

  resetCar() {
    const car = this.game.world.getCar(this.localCarId);
    if (!car) return;
    car.resetState();
    car.boost = 100;
    car.placeAt(0, -2500, 17, Math.PI / 2);
  }

  destroy() {}
}

const _q = new Quat();
