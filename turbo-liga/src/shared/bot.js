// IA de los bots: prediccion del balon, intercepcion, tiros, defensa, rotaciones,
// saques, esquivas y (en dificultad alta) jugadas aereas.
import { V3, clamp } from './vec.js';
import { Ball } from './ball.js';
import { PHASE } from './game.js';
import { emptyControls } from './car.js';
import * as C from './constants.js';

export const DIFFICULTIES = {
  rookie: { label: 'Principiante', reaction: 0.4, boost: false, flips: false, maxReach: 150, aerial: false, aimError: 700, speedCap: 1000, kickoffFlip: false, rotate: false },
  pro: { label: 'Pro', reaction: 0.1, boost: true, flips: true, maxReach: 320, aerial: false, aimError: 180, speedCap: 2300, kickoffFlip: true, rotate: true },
  allstar: { label: 'Leyenda', reaction: 0.03, boost: true, flips: true, maxReach: 1300, aerial: true, aimError: 60, speedCap: 2300, kickoffFlip: true, rotate: true },
};

const PRED_DT = 1 / 60;
const PRED_STEPS = 240; // 4 segundos
const predBall = new Ball();

// Prediccion del balon (solo estadio, sin coches) cacheada por tick
export function predictBall(game) {
  const w = game.world;
  if (game._pred && game._predTick === w.tick) return game._pred;
  let pred = game._pred;
  if (!pred) {
    pred = [];
    for (let i = 0; i < PRED_STEPS; i++) pred.push({ t: 0, pos: new V3(), vel: new V3() });
    game._pred = pred;
  }
  predBall.copyFrom(w.ball);
  for (let i = 0; i < PRED_STEPS; i++) {
    // 2 sub-pasos por muestra para mas precision
    for (let s = 0; s < 2; s++) {
      predBall.applyForces(PRED_DT / 2);
      predBall.collideArena();
      predBall.finishTick();
      predBall.integrate(PRED_DT / 2);
    }
    const p = pred[i];
    p.t = (i + 1) * PRED_DT;
    p.pos.copy(predBall.pos);
    p.vel.copy(predBall.vel);
  }
  game._predTick = w.tick;
  return pred;
}

const _f = new V3(), _l = new V3(), _u = new V3(), _d = new V3(), _tmp = new V3(), _tmp2 = new V3();

let botSeed = 1;
function rnd() {
  botSeed = (botSeed * 16807) % 2147483647;
  return botSeed / 2147483647;
}

export class Bot {
  constructor(carId, difficulty = 'pro') {
    this.carId = carId;
    this.setDifficulty(difficulty);
    this.controls = emptyControls();
    this.decisionTimer = 0;
    this.target = new V3();
    this.targetTime = 0;
    this.targetSpeed = 1400;
    this.mode = 'idle';
    this.maneuver = null;
    this.aimOffset = 0;
    this.stuckTimer = 0;
    this.stuckThrottle = 1;
    this.stuckSteer = 0;
    this.lastJumpPress = 0;
    this.time = 0;
    this.shotDir = new V3(0, 1, 0);
    this.ballTarget = new V3();
  }

  setDifficulty(d) {
    this.difficulty = DIFFICULTIES[d] ? d : 'pro';
    this.p = DIFFICULTIES[this.difficulty];
  }

  update(game, dt) {
    const ctl = this.controls;
    const car = game.world.getCar(this.carId);
    this.time += dt;
    resetControls(ctl);
    if (!car || car.isDemoed) { this.maneuver = null; return ctl; }
    if (game.phase === PHASE.COUNTDOWN || game.phase === PHASE.ENDED) {
      this.maneuver = null;
      this.kickoffStarted = false;
      return ctl;
    }

    car.forward(_f); car.left(_l); car.up(_u);
    const ball = game.world.ball;
    const team = car.team;
    const dirY = team === C.TEAM_BLUE ? 1 : -1; // hacia la porteria rival
    const oppGoal = _tmp2.set(0, dirY * (C.ARENA_EXTENT_Y + 200), 320);
    const ownGoalY = -dirY * C.ARENA_EXTENT_Y;

    // Maniobra en curso (flip, salto, aereo)
    if (this.maneuver) {
      const done = this.runManeuver(car, game, dt);
      if (!done) return ctl;
      this.maneuver = null;
    }

    // Volcado sobre el techo (sin ruedas en el suelo): saltar activa el autoflip
    if (car.numContacts === 0 && car.worldContact && car.worldNormal.z > C.CAR_AUTOFLIP_NORMZ_THRESH &&
        Math.abs(Math.atan2(_l.z, _u.z)) > C.CAR_AUTOFLIP_ROLL_THRESH) {
      if (this.time - this.lastJumpPress > 0.3) { ctl.jump = true; this.lastJumpPress = this.time; }
      return ctl;
    }

    // Recuperacion en el aire: aterrizar sobre las ruedas
    if (car.numContacts === 0 && !car.isOnGround) {
      this.recover(car);
      return ctl;
    }

    // Volcado o atascado
    if (_u.z < -0.3 && car.pos.z < 120) {
      if (this.time - this.lastJumpPress > 0.3) { ctl.jump = true; this.lastJumpPress = this.time; }
      return ctl;
    }
    if (this.stuckTimer > 1.2) {
      // desatascar: salto corto y marcha atras (contra lo que empujaba), girando al otro lado
      this.stuckTimer = 0;
      this.maneuver = { type: 'jump', t: 0, hold: 0.15, throttle: -this.stuckThrottle, steer: -this.stuckSteer };
      return ctl;
    }

    // --- Saque inicial ---
    const isKickoff = !game.ballHitThisKickoff && Math.abs(ball.pos.x) < 5 && Math.abs(ball.pos.y) < 5 && game.phase === PHASE.PLAY && !game.opts.freePlay;
    if (isKickoff) {
      let arrived = false;
      if (this.isClosestOnTeam(game, car, ball.pos)) {
        this.kickoff(car, ball, dirY);
      } else {
        // los demas se colocan sin cruzarse: el mas lejano en la porteria y el otro de segundo hombre
        const far = this.isFarthestOnTeam(game, car, ball.pos);
        _tmp.set(clamp(car.pos.x, -1500, 1500) * 0.3, ownGoalY * (far ? 0.93 : 0.45), 0);
        this.driveTo(car, _tmp, 1400, false);
        arrived = Math.hypot(_tmp.x - car.pos.x, _tmp.y - car.pos.y) < 250;
        if (arrived) this.faceTowards(car, ball.pos);
      }
      this.trackStuck(game, car, dt, arrived);
      return ctl;
    }

    // --- Decision (con tiempo de reaccion) ---
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.p.reaction;
      this.decide(game, car, oppGoal, ownGoalY, dirY);
    }

    // --- Ejecucion ---
    switch (this.mode) {
      case 'attack':
        this.executeAttack(game, car, dirY);
        break;
      case 'boost':
      case 'position':
      default:
        this.driveTo(car, this.target, this.targetSpeed, this.mode !== 'position' || this.targetSpeed > 1500);
        if (this.mode === 'position') {
          // al llegar, mirar hacia el balon
          const dist = Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y);
          if (dist < 250) {
            this.faceTowards(car, ball.pos);
          }
        }
        break;
    }
    // esperar parado en su sitio no es estar atascado
    const parked = this.mode === 'position' && Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y) < 300;
    this.trackStuck(game, car, dt, parked);
    return ctl;
  }

  // Atasco: acelera pero no se mueve (con los controles ya decididos en este tick)
  trackStuck(game, car, dt, parked) {
    const wantsMove = Math.abs(this.controls.throttle) > 0.5 && !parked;
    if (wantsMove && car.vel.length() < 80 && game.phase === PHASE.PLAY) {
      this.stuckTimer += dt;
      this.stuckThrottle = Math.sign(this.controls.throttle);
      this.stuckSteer = this.controls.steer;
    } else {
      this.stuckTimer = 0;
    }
  }

  isFarthestOnTeam(game, car, p) {
    const myD = car.pos.distanceTo(p);
    for (const c of game.world.cars) {
      if (c === car || c.team !== car.team || c.isDemoed) continue;
      const d = c.pos.distanceTo(p);
      if (d > myD + 1 || (Math.abs(d - myD) <= 1 && c.id > car.id)) return false;
    }
    return true;
  }

  isClosestOnTeam(game, car, p) {
    const myD = car.pos.distanceTo(p);
    for (const c of game.world.cars) {
      if (c === car || c.team !== car.team || c.isDemoed) continue;
      const d = c.pos.distanceTo(p);
      if (d < myD - 1 || (Math.abs(d - myD) <= 1 && c.id < car.id)) return false;
    }
    return true;
  }

  // Tiempo estimado (muy aproximado) para que un coche llegue a un punto
  eta(car, p) {
    const dx = p.x - car.pos.x, dy = p.y - car.pos.y;
    const dist = Math.hypot(dx, dy) + Math.max(0, p.z - 150) * 1.5;
    car.forward(_d);
    const fl = Math.hypot(_d.x, _d.y) || 1;
    const cos = (dx * _d.x + dy * _d.y) / ((dist || 1) * fl);
    const turn = (1 - cos) * 0.45;
    const v = Math.max(car.vel.length(), 300);
    const top = car.boost > 15 ? 2000 : 1350;
    return dist / ((v + top) / 2) + turn;
  }

  decide(game, car, oppGoal, ownGoalY, dirY) {
    const ball = game.world.ball;
    const pred = predictBall(game);
    const teammates = game.world.cars.filter((c) => c.team === car.team && !c.isDemoed);
    const opponents = game.world.cars.filter((c) => c.team !== car.team && !c.isDemoed);

    // ¿Va el balon a entrar en nuestra porteria?
    let danger = null;
    for (let i = 0; i < pred.length; i += 2) {
      if (Math.abs(pred[i].pos.y) > C.ARENA_EXTENT_Y && Math.sign(pred[i].pos.y) === Math.sign(ownGoalY)) {
        danger = pred[i]; break;
      }
    }

    // Rol: el mejor colocado ataca
    const score = (c) => {
      let s = this.eta(c, ball.pos);
      // penalizar estar "por delante" del balon (lado equivocado)
      const ahead = (c.pos.y - ball.pos.y) * dirY;
      if (ahead > 200) s += 0.8 + ahead / 3000;
      return s;
    };
    let best = car, bestScore = score(car);
    for (const c of teammates) {
      if (c === car) continue;
      const s = score(c);
      if (s < bestScore - 0.05 || (Math.abs(s - bestScore) <= 0.05 && c.id < best.id)) { best = c; bestScore = s; }
    }
    const isAttacker = best === car || teammates.length === 1 || !this.p.rotate;

    // Posicion en la rotacion (orden por distancia al balon)
    const order = teammates.slice().sort((a, b) => score(a) - score(b));
    const rank = order.indexOf(car);

    const ahead = (car.pos.y - ball.pos.y) * dirY;
    // con peligro de gol tambien sale el segundo hombre; el portero se queda en la linea
    if (isAttacker || (danger && rank <= 1)) {
      // En 1v1, si el rival llega antes y estamos por delante del balon, volver a defender
      const oppFirst = opponents.length && opponents.some((o) => this.eta(o, ball.pos) + 0.3 < this.eta(car, ball.pos));
      if (!danger && oppFirst && ahead > 300 && teammates.length === 1 && this.p.rotate) {
        this.mode = 'position';
        this.target.set(ball.pos.x * 0.4, ownGoalY * 0.85, 0);
        this.targetSpeed = 2300;
        return;
      }
      this.mode = 'attack';
      this.planShot(game, car, pred, oppGoal, dirY, danger);
      return;
    }

    // Apoyo / portero
    if (car.boost < 30 && rank < 2) {
      const pad = this.nearestPad(game, car, ownGoalY);
      if (pad) {
        this.mode = 'boost';
        this.target.set(pad.x, pad.y, 0);
        this.targetSpeed = 2300;
        return;
      }
    }
    this.mode = 'position';
    if (danger) {
      // portero con peligro de gol: sobre la linea, tapando por donde entraria
      this.target.set(clamp(danger.pos.x, -C.GOAL_HALF_WIDTH + 150, C.GOAL_HALF_WIDTH - 150), ownGoalY * 0.97, 0);
    } else if (rank >= 2 || (teammates.length === 2 && rank === 1 && ball.pos.y * dirY < 0)) {
      // portero
      this.target.set(clamp(ball.pos.x * 0.35, -700, 700), ownGoalY * 0.93, 0);
    } else {
      // segundo hombre: detras del balon hacia nuestra porteria, pero por delante del portero
      const back = 2200;
      let y = clamp(ball.pos.y - dirY * back, -4700, 4700);
      if ((y - ownGoalY) * dirY < 1300) y = ownGoalY + dirY * 1300;
      this.target.set(clamp(ball.pos.x * 0.5, -3000, 3000), y, 0);
    }
    const dist = Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y);
    this.targetSpeed = dist > 1500 ? 2300 : clamp(dist * 1.2, 0, 1400);
  }

  nearestPad(game, car, ownGoalY) {
    let best = null, bestD = Infinity;
    for (const pad of game.world.pads) {
      if (!pad.big || pad.timer > 0) continue;
      const d = Math.hypot(pad.x - car.pos.x, pad.y - car.pos.y) + Math.abs(pad.y - ownGoalY) * 0.3;
      if (d < bestD) { bestD = d; best = pad; }
    }
    return bestD < 4500 ? best : null;
  }

  // Elegir el momento y punto de intercepcion del balon
  planShot(game, car, pred, oppGoal, dirY, danger) {
    const maxReach = this.p.maxReach;
    const carHalf = car.cfg.half[0] + car.cfg.offset[0];
    let chosen = null;
    for (let i = 3; i < pred.length; i++) {
      const s = pred[i];
      if (s.pos.z > maxReach + C.BALL_RADIUS) continue;
      if (Math.abs(s.pos.y) > C.ARENA_EXTENT_Y + 50) break; // ya seria gol
      if (Math.abs(s.pos.x) > C.ARENA_EXTENT_X - 150 && s.pos.z > 200) continue; // pegado al muro
      const t = this.eta(car, s.pos);
      if (t <= s.t) { chosen = s; break; }
    }
    if (!chosen) chosen = pred[Math.min(pred.length - 1, 90)];
    this.ballTarget.copy(chosen.pos);
    this.targetTime = chosen.t;

    // Direccion del tiro: hacia la porteria rival (o despejar hacia fuera si defendemos)
    const bp = chosen.pos;
    let gx = clamp(bp.x * 0.25, -500, 500) + this.aimOffset;
    if (rnd() < 0.05) this.aimOffset = (rnd() * 2 - 1) * this.p.aimError;
    _d.set(gx - bp.x, oppGoal.y - bp.y, 0).normalize();
    if (danger || (bp.y * dirY < -3500 && Math.abs(bp.x) < 1500)) {
      // despeje: alejar de nuestra porteria hacia el lateral mas cercano
      const side = bp.x >= 0 ? 1 : -1;
      _d.set(side * 0.6, dirY, 0).normalize();
    }
    this.shotDir.copy(_d);
    // Punto de contacto: detras del balon segun la direccion del tiro
    this.target.copy(bp).addScaled(_d, -(C.BALL_RADIUS + carHalf - 25));
    this.target.z = bp.z;
  }

  executeAttack(game, car, dirY) {
    const ctl = this.controls;
    const ball = game.world.ball;
    const timeLeft = Math.max(0.05, this.targetTime - (this.p.reaction - Math.max(this.decisionTimer, 0)));
    const toBall = _tmp.subVectors(ball.pos, car.pos);
    const distBall = toBall.length();
    const bt = this.ballTarget;

    // Punto de aproximacion para alinear el tiro
    const tx = this.target.x, ty = this.target.y;
    const dist = Math.hypot(tx - car.pos.x, ty - car.pos.y);
    const behind = (car.pos.x - bt.x) * this.shotDir.x + (car.pos.y - bt.y) * this.shotDir.y; // >0: por delante
    const approach = _d.set(tx, ty, 0);
    const circling = behind > -50 && dist > 250;
    if (circling) {
      // estamos al otro lado: rodear el balon
      const side = ((car.pos.x - bt.x) * this.shotDir.y - (car.pos.y - bt.y) * this.shotDir.x) >= 0 ? 1 : -1;
      approach.x = bt.x - this.shotDir.x * 700 + this.shotDir.y * side * 500;
      approach.y = bt.y - this.shotDir.y * 700 - this.shotDir.x * side * 500;
      // cerca y delante del balon: pasar primero por su lado para no empujarlo hacia atras
      const lat = (car.pos.x - ball.pos.x) * this.shotDir.y - (car.pos.y - ball.pos.y) * this.shotDir.x;
      const fwd = (car.pos.x - ball.pos.x) * this.shotDir.x + (car.pos.y - ball.pos.y) * this.shotDir.y;
      if (distBall < 1200 && fwd > -100 && Math.abs(lat) < 350) {
        const s2 = lat >= 0 ? 1 : -1;
        approach.x = ball.pos.x + this.shotDir.y * s2 * 500;
        approach.y = ball.pos.y - this.shotDir.x * s2 * 500;
      }
    } else if (dist > 400) {
      const off = Math.min(dist * 0.4, 700);
      approach.x = tx - this.shotDir.x * off;
      approach.y = ty - this.shotDir.y * off;
    }
    approach.x = clamp(approach.x, -C.ARENA_EXTENT_X + 200, C.ARENA_EXTENT_X - 200);
    approach.y = clamp(approach.y, -C.ARENA_EXTENT_Y + 200, C.ARENA_EXTENT_Y - 200);

    let speed = clamp(dist / timeLeft, 300, this.p.speedCap);
    if (dist > 1800) speed = this.p.speedCap;
    this.driveTo(car, approach, speed, true);

    // Saltos / esquivas al llegar al balon
    if (car.isOnGround) {
      const h = bt.z;
      const tToBall = timeLeft;
      car.forward(_f);
      const align = (toBall.x * _f.x + toBall.y * _f.y) / (Math.hypot(toBall.x, toBall.y) || 1);
      if (h > 400 && this.p.aerial && tToBall < 1.6 && tToBall > 0.5 && align > 0.85 && car.boost > 25) {
        this.maneuver = { type: 'aerial', t: 0, target: bt.clone(), arrive: this.time + tToBall };
      } else if (h > 170 && h < 420 && tToBall < 0.45 && tToBall > 0.12 && align > 0.75 && this.p.maxReach > 200) {
        this.maneuver = { type: 'jumpshot', t: 0, height: h, double: h > 300 };
      } else if (this.p.flips && !circling && distBall < 420 && ball.pos.z < 180 && align > 0.8 && car.vel.length() > 700 &&
          (toBall.x * this.shotDir.x + toBall.y * this.shotDir.y) / (Math.hypot(toBall.x, toBall.y) || 1) > 0.3) {
        // esquiva hacia el balon para darle potencia (solo si lo manda hacia donde queremos)
        car.left(_l);
        const lx = toBall.x * _f.x + toBall.y * _f.y;
        const ly = toBall.x * _l.x + toBall.y * _l.y;
        const ang = Math.atan2(ly, lx);
        this.maneuver = { type: 'flip', t: 0, pitch: -Math.cos(ang), yaw: clamp(-Math.sin(ang) * 1.5, -1, 1), delay: 0.08 };
      }
    }
    return ctl;
  }

  kickoff(car, ball, dirY) {
    const ctl = this.controls;
    const dist = car.pos.distanceTo(ball.pos);
    _tmp.set(0, -dirY * 60, 0);
    this.driveTo(car, _tmp, 2300, true);
    ctl.boost = this.p.boost && car.isOnGround && dist > 600;
    if (this.p.kickoffFlip && dist < 620 && car.vel.length() > 1000 && car.isOnGround) {
      this.maneuver = { type: 'flip', t: 0, pitch: -1, yaw: 0, delay: 0.06 };
    }
  }

  // Controlador de conduccion hacia un punto
  driveTo(car, target, speed, allowBoost) {
    const ctl = this.controls;
    car.forward(_f); car.left(_l); car.up(_u);
    let tx = target.x, ty = target.y;
    if (Math.abs(car.pos.y) > C.ARENA_EXTENT_Y && Math.abs(tx) > C.GOAL_HALF_WIDTH - 150) {
      // dentro de la porteria: salir primero por la boca (no atravesar los postes)
      tx = clamp(tx, -C.GOAL_HALF_WIDTH + 300, C.GOAL_HALF_WIDTH - 300);
      ty = Math.sign(car.pos.y) * (C.ARENA_EXTENT_Y - 300);
    }
    const dx = tx - car.pos.x, dy = ty - car.pos.y, dz = (target.z || 0) - car.pos.z;
    const lx = dx * _f.x + dy * _f.y + dz * _f.z;
    const ly = dx * _l.x + dy * _l.y + dz * _l.z;
    const angle = Math.atan2(ly, lx);
    const dist = Math.hypot(dx, dy);
    ctl.steer = clamp(-angle * 3.2, -1, 1);
    const fwd = car.vel.dot(_f);
    const absAng = Math.abs(angle);
    if (car.isOnGround && absAng > 1.7 && fwd > 400 && this.difficulty !== 'rookie') ctl.handbrake = true;
    // velocidad deseada reducida en curvas cerradas
    let desired = speed;
    if (absAng > 0.6 && dist < 1500) desired = Math.min(desired, 900);
    if (desired > fwd + 60) {
      ctl.throttle = 1;
      if (allowBoost && this.p.boost && desired > fwd + 250 && absAng < 0.35 && car.isOnGround && fwd < 2250 && car.boost > 0 && _u.z > 0.6) ctl.boost = true;
    } else if (desired < fwd - 400) {
      ctl.throttle = -1;
    } else if (desired < fwd - 100) {
      ctl.throttle = 0;
    } else {
      ctl.throttle = clamp(desired / 1410, 0.1, 1);
    }
    if (!this.p.boost && this.difficulty === 'rookie') ctl.boost = false;
  }

  faceTowards(car, p) {
    const ctl = this.controls;
    car.forward(_f); car.left(_l);
    const dx = p.x - car.pos.x, dy = p.y - car.pos.y;
    const angle = Math.atan2(dx * _l.x + dy * _l.y, dx * _f.x + dy * _f.y);
    const fwd = car.vel.dot(_f);
    if (Math.abs(angle) > 0.5) {
      ctl.steer = clamp(-angle * 3, -1, 1);
      ctl.throttle = fwd > 300 ? 0 : 0.6;
      if (Math.abs(angle) > 2.3) { ctl.throttle = -0.6; ctl.steer = -ctl.steer; }
    } else {
      ctl.throttle = fwd > 50 ? -0.3 : 0;
      ctl.steer = 0;
    }
  }

  // Orientacion en el aire con control PD hacia una direccion "adelante" deseada
  orient(car, fwdDir, upDir = null) {
    const ctl = this.controls;
    car.forward(_f); car.left(_l); car.up(_u);
    const w = car.angVel;
    const wPitch = -w.dot(_l), wYaw = -w.dot(_u), wRoll = w.dot(_f);
    const df = fwdDir.dot(_f), dl = fwdDir.dot(_l), du = fwdDir.dot(_u);
    const pitchErr = Math.atan2(du, Math.max(df, 0.05) + Math.max(-df, 0) * 0.5);
    const yawErr = Math.atan2(dl, Math.abs(df) + 0.05);
    ctl.pitch = clamp(pitchErr * 3.2 - wPitch * 0.55, -1, 1);
    ctl.yaw = clamp(-yawErr * 3.2 - wYaw * 0.6, -1, 1);
    if (df < 0 && Math.abs(du) < 0.3) ctl.pitch = du >= 0 ? 1 : -1; // mirar hacia atras: girar
    const ux = upDir ? upDir : _tmp.set(0, 0, 1);
    const rollAng = Math.atan2(ux.dot(_l), ux.dot(_u)); // + = inclinado a la derecha
    ctl.roll = clamp(-rollAng * 2.2 - wRoll * 0.35, -1, 1);
  }

  recover(car) {
    const v = car.vel;
    const hz = Math.hypot(v.x, v.y);
    if (hz > 200) _d.set(v.x / hz, v.y / hz, -0.1).normalize();
    else { car.forward(_d); _d.z = 0; if (_d.lengthSq() < 0.01) _d.set(1, 0, 0); _d.normalize(); }
    this.orient(car, _d);
  }

  runManeuver(car, game, dt) {
    const m = this.maneuver;
    const ctl = this.controls;
    m.t += dt;
    switch (m.type) {
      case 'jump': {
        ctl.jump = m.t < m.hold;
        ctl.throttle = m.throttle;
        ctl.steer = m.steer;
        return m.t > m.hold + 0.5;
      }
      case 'flip': {
        // salto corto + esquiva en la direccion indicada
        ctl.throttle = 1;
        if (m.t < m.delay) { ctl.jump = true; return false; }
        if (m.t < m.delay + 0.035) { ctl.jump = false; return false; }
        if (m.t < m.delay + 0.07) {
          ctl.jump = true; ctl.pitch = m.pitch; ctl.yaw = m.yaw; return false;
        }
        ctl.jump = false;
        ctl.pitch = m.pitch; ctl.yaw = m.yaw;
        if (m.t > m.delay + 0.75) {
          this.recover(car);
          return car.isOnGround || m.t > 2.5;
        }
        return false;
      }
      case 'jumpshot': {
        const hold = clamp((m.height - 120) / 600, 0.05, 0.2);
        ctl.throttle = 1;
        ctl.jump = m.t < hold;
        // orientar hacia el balon
        _d.subVectors(game.world.ball.pos, car.pos).normalize();
        if (m.t > 0.05) this.orient(car, _d);
        // segundo salto con el stick centrado (si no, seria una esquiva)
        if (m.double && m.t > hold + 0.05 && m.t < hold + 0.09) { ctl.jump = true; ctl.pitch = 0; ctl.yaw = 0; ctl.roll = 0; }
        if (!m.double && m.t > 0.25 && this.p.flips && car.pos.distanceTo(game.world.ball.pos) < 260 && !m.flipped) {
          m.flipped = true;
          ctl.jump = true; ctl.pitch = -1; ctl.yaw = 0; ctl.roll = 0;
        }
        return (m.t > 0.3 && car.isOnGround) || m.t > 2;
      }
      case 'aerial': {
        const ball = game.world.ball;
        const T = Math.max(0.05, m.arrive - this.time);
        // apuntar al balon actualizado (prediccion simple)
        const target = _tmp.copy(m.target);
        if (m.t > 0.25) target.copy(ball.pos).addScaled(ball.vel, T).addScaled(_tmp2.set(0, 0, 0.5 * C.GRAVITY_Z * T * T), 1);
        // aceleracion necesaria: A = 2(dP - v T)/T^2 - g
        _d.subVectors(target, car.pos).addScaled(car.vel, -T).scale(2 / (T * T));
        _d.z -= C.GRAVITY_Z;
        const need = _d.length();
        _d.normalize();
        if (m.t < 0.2) { ctl.jump = true; this.orient(car, _d); }
        else if (m.t < 0.24) { ctl.jump = false; this.orient(car, _d); }
        else if (m.t < 0.28) { ctl.jump = true; ctl.pitch = 0; ctl.yaw = 0; ctl.roll = 0; }
        else {
          this.orient(car, _d);
          car.forward(_f);
          ctl.boost = _f.dot(_d) > 0.8 && need > 200 && car.boost > 0;
          ctl.throttle = 1;
        }
        const done = car.isOnGround && m.t > 0.4;
        if (this.time > m.arrive + 0.4 || m.t > 3 || done) return true;
        return false;
      }
    }
    return true;
  }
}

function resetControls(c) {
  c.throttle = 0; c.steer = 0; c.pitch = 0; c.yaw = 0; c.roll = 0;
  c.jump = false; c.boost = false; c.handbrake = false;
}
