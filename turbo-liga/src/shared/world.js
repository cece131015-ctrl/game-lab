import { V3, clamp } from './vec.js';
import { Ball, BALL_SERIAL_SIZE } from './ball.js';
import { Car, CAR_SERIAL_SIZE, emptyControls } from './car.js';
import * as C from './constants.js';

const { curve } = C;

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3();
const _n = new V3(), _p = new V3(), _rA = new V3(), _rB = new V3(), _vA = new V3(), _vB = new V3();
const _axA = [new V3(), new V3(), new V3()];
const _axB = [new V3(), new V3(), new V3()];
const _ca = new V3(), _cb = new V3(), _t = new V3(), _ax = new V3();

export class World {
  constructor() {
    this.cars = [];
    this.ball = new Ball();
    this.ballEnabled = true;
    this.tick = 0;
    this.events = [];
    this.onTouch = null; // callback(car, strength)
    this.pads = [];
    for (const [x, y] of C.BOOST_PADS_BIG) this.pads.push({ x, y, big: true, timer: 0 });
    for (const [x, y] of C.BOOST_PADS_SMALL) this.pads.push({ x, y, big: false, timer: 0 });
  }

  addCar(id, team, type) {
    const car = new Car(id, team, type);
    car.events = this.events;
    this.cars.push(car);
    return car;
  }

  removeCar(id) {
    this.cars = this.cars.filter((c) => c.id !== id);
  }

  getCar(id) {
    for (const c of this.cars) if (c.id === id) return c;
    return null;
  }

  respawnCar(car) {
    const spots = C.RESPAWN_SPOTS;
    const s = spots[(this.tick + car.id * 7) % spots.length];
    const flip = car.team === C.TEAM_BLUE ? 1 : -1;
    car.resetState();
    car.placeAt(s.x * flip, s.y * flip, C.CAR_RESPAWN_Z, s.yaw + (flip === 1 ? 0 : Math.PI));
    this.events.push({ type: 'respawn', car: car.id });
  }

  demolish(car, by) {
    car.isDemoed = true;
    car.demoTimer = C.DEMO_RESPAWN_TIME;
    car.isBoosting = false;
    this.events.push({ type: 'demo', car: car.id, by: by.id, x: car.pos.x, y: car.pos.y, z: car.pos.z });
    if (this.onDemo) this.onDemo(car, by);
  }

  step(dt, frozen = false) {
    const cars = this.cars;
    if (frozen) {
      // Cuenta atras del saque: los coches no se mueven
      for (const car of cars) car.lastJump = car.controls.jump;
      this.tick++;
      return;
    }
    for (const car of cars) car.preTick(dt, this);
    if (this.ballEnabled) this.ball.applyForces(dt);

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) this.collideCars(cars[i], cars[j]);
    }
    if (this.ballEnabled) for (const car of cars) this.collideCarBall(car);
    for (const car of cars) car.collideArena();
    if (this.ballEnabled) {
      const impact = this.ball.collideArena();
      if (impact > 250) this.events.push({ type: 'bounce', strength: impact });
    }
    for (const car of cars) car.finishTick();
    if (this.ballEnabled) this.ball.finishTick();
    for (const car of cars) car.integrate(dt);
    if (this.ballEnabled) this.ball.integrate(dt);
    for (const car of cars) car.postTick(dt);
    this.updatePads(dt);
    this.tick++;
  }

  updatePads(dt) {
    const P = C.BOOST_PAD;
    for (const pad of this.pads) {
      if (pad.timer > 0) { pad.timer = Math.max(0, pad.timer - dt); continue; }
      const r = pad.big ? P.bigRadius : P.smallRadius;
      for (const car of this.cars) {
        if (car.isDemoed || car.boost >= C.BOOST_MAX) continue;
        const dx = car.pos.x - pad.x, dy = car.pos.y - pad.y;
        if (dx * dx + dy * dy < r * r && car.pos.z < 70 + P.height) {
          car.boost = Math.min(C.BOOST_MAX, car.boost + (pad.big ? P.bigAmount : P.smallAmount));
          pad.timer = pad.big ? P.bigCooldown : P.smallCooldown;
          this.events.push({ type: 'pad', car: car.id, big: pad.big });
          break;
        }
      }
    }
  }

  // --- Coche contra balon (OBB vs esfera) + impulso extra de Rocket League ---
  collideCarBall(car) {
    if (car.isDemoed) return;
    const ball = this.ball;
    const cfg = car.cfg;
    const h = cfg.half, o = cfg.offset;
    const R = ball.radius;
    _a.subVectors(ball.pos, car.pos).applyQuatInv(car.quat);
    _a.x -= o[0]; _a.y -= o[1]; _a.z -= o[2];
    let cx = clamp(_a.x, -h[0], h[0]);
    let cy = clamp(_a.y, -h[1], h[1]);
    let cz = clamp(_a.z, -h[2], h[2]);
    let dx = _a.x - cx, dy = _a.y - cy, dz = _a.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R * R) return;
    let pen;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      _n.set(dx / d, dy / d, dz / d);
      pen = R - d;
    } else {
      // centro del balon dentro de la caja: salir por la cara mas cercana
      const px = h[0] - Math.abs(_a.x), py = h[1] - Math.abs(_a.y), pz = h[2] - Math.abs(_a.z);
      if (px < py && px < pz) { _n.set(Math.sign(_a.x) || 1, 0, 0); pen = R + px; cx = h[0] * _n.x; }
      else if (py < pz) { _n.set(0, Math.sign(_a.y) || 1, 0); pen = R + py; cy = h[1] * _n.y; }
      else { _n.set(0, 0, Math.sign(_a.z) || 1); pen = R + pz; cz = h[2] * _n.z; }
    }
    _n.applyQuat(car.quat);
    _p.set(cx + o[0], cy + o[1], cz + o[2]).applyQuat(car.quat).add(car.pos);

    // Impulso extra (como en el juego original), como maximo cada 2 ticks
    if (this.tick > car.lastExtraHitTick + 1 || car.lastExtraHitTick > this.tick) {
      car.lastExtraHitTick = this.tick;
      _b.subVectors(ball.pos, car.pos);
      _c.subVectors(ball.vel, car.vel);
      const relSpeed = Math.min(_c.length(), C.BALL_CAR_EXTRA_IMPULSE_MAXDELTAVEL);
      if (relSpeed > 0) {
        _b.z *= C.BALL_CAR_EXTRA_IMPULSE_Z_SCALE;
        _b.normalize();
        car.forward(_d);
        _b.addScaled(_d, -_b.dot(_d) * (1 - C.BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE)).normalize();
        ball.velCache.addScaled(_b, relSpeed * curve(C.BALL_CAR_EXTRA_IMPULSE_FACTOR, relSpeed));
      }
      if (relSpeed > 120) this.events.push({ type: 'hit', car: car.id, strength: relSpeed });
      if (this.onTouch) this.onTouch(car, relSpeed);
    }

    // Respuesta fisica (restitucion 0, friccion 2.0)
    const mb = ball.mass, mc = C.CAR_MASS;
    _rB.subVectors(_p, ball.pos);
    _rA.subVectors(_p, car.pos);
    _vB.crossVectors(ball.angVel, _rB).add(ball.vel);
    car.pointVelocity(_rA, _vA);
    _c.subVectors(_vB, _vA);
    const vn = _c.dot(_n);
    if (vn < 0) {
      _d.crossVectors(_rB, _n);
      const kb = 1 / mb + ball.invInertia * _d.lengthSq();
      const kc = car.effInvMass(_rA, _n) / mc;
      const j = (-(1 + C.CARBALL_RESTITUTION) * vn) / (kb + kc);
      ball.vel.addScaled(_n, j / mb);
      _e.copy(_n).scale(-j / mc);
      car.applyImpulseAt(_e, _rA);
      // friccion
      _vB.crossVectors(ball.angVel, _rB).add(ball.vel);
      car.pointVelocity(_rA, _vA);
      _c.subVectors(_vB, _vA);
      _c.addScaled(_n, -_c.dot(_n));
      const vt = _c.length();
      if (vt > 1e-4) {
        _c.scale(1 / vt);
        _d.crossVectors(_rB, _c);
        const kbt = 1 / mb + ball.invInertia * _d.lengthSq();
        const kct = car.effInvMass(_rA, _c) / mc;
        const jt = Math.min(vt / (kbt + kct), C.CARBALL_FRICTION * j);
        ball.vel.addScaled(_c, -jt / mb);
        _d.crossVectors(_rB, _c).scale(-jt * ball.invInertia);
        ball.angVel.add(_d);
        _e.copy(_c).scale(jt / mc);
        car.applyImpulseAt(_e, _rA);
      }
    }
    // separar
    const tot = mb + mc;
    ball.pos.addScaled(_n, pen * (mc / tot));
    car.pos.addScaled(_n, -pen * (mb / tot));
  }

  // --- Coche contra coche (OBB vs OBB con SAT) + choques y demoliciones ---
  collideCars(a, b) {
    if (a.isDemoed || b.isDemoed) return;
    a.hitboxCenter(_ca); b.hitboxCenter(_cb);
    _t.subVectors(_cb, _ca);
    if (_t.lengthSq() > 250 * 250) return;
    a.forward(_axA[0]); a.left(_axA[1]); a.up(_axA[2]);
    b.forward(_axB[0]); b.left(_axB[1]); b.up(_axB[2]);
    const hA = a.cfg.half, hB = b.cfg.half;
    let minDepth = Infinity;
    const best = _n;
    const test = (axis, bias) => {
      const ra = hA[0] * Math.abs(_axA[0].dot(axis)) + hA[1] * Math.abs(_axA[1].dot(axis)) + hA[2] * Math.abs(_axA[2].dot(axis));
      const rb = hB[0] * Math.abs(_axB[0].dot(axis)) + hB[1] * Math.abs(_axB[1].dot(axis)) + hB[2] * Math.abs(_axB[2].dot(axis));
      const tt = _t.dot(axis);
      const depth = ra + rb - Math.abs(tt);
      if (depth < 0) return false;
      if (depth * bias < minDepth) {
        minDepth = depth;
        best.copy(axis);
        if (tt < 0) best.scale(-1);
      }
      return true;
    };
    for (let i = 0; i < 3; i++) if (!test(_axA[i], 1)) return;
    for (let i = 0; i < 3; i++) if (!test(_axB[i], 1)) return;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        _ax.crossVectors(_axA[i], _axB[j]);
        const len = _ax.length();
        if (len < 1e-3) continue;
        _ax.scale(1 / len);
        if (!test(_ax, 1.1)) return;
      }
    }
    const n = best;
    const depth = minDepth;
    // Punto de contacto: punto medio entre las caras de soporte de ambas cajas
    supportCenter(_ca, _axA, hA, n, 1, _d);
    supportCenter(_cb, _axB, hB, n, -1, _e);
    _p.addVectors(_d, _e).scale(0.5);

    // Choques / demoliciones (usando las velocidades previas)
    this._bumpCheck(a, b, _p);
    this._bumpCheck(b, a, _p);

    _rA.subVectors(_p, a.pos);
    _rB.subVectors(_p, b.pos);
    a.pointVelocity(_rA, _vA);
    b.pointVelocity(_rB, _vB);
    _c.subVectors(_vB, _vA);
    const vn = _c.dot(n);
    if (vn < 0) {
      const k = a.effInvMass(_rA, n) + b.effInvMass(_rB, n);
      const j = (-(1 + C.CARCAR_RESTITUTION) * vn) / k;
      _c.copy(n).scale(-j); a.applyImpulseAt(_c, _rA);
      _c.copy(n).scale(j); b.applyImpulseAt(_c, _rB);
      a.pointVelocity(_rA, _vA);
      b.pointVelocity(_rB, _vB);
      _c.subVectors(_vB, _vA);
      _c.addScaled(n, -_c.dot(n));
      const vt = _c.length();
      if (vt > 1e-4) {
        _c.scale(1 / vt);
        const kt = a.effInvMass(_rA, _c) + b.effInvMass(_rB, _c);
        const jt = Math.min(vt / kt, C.CARCAR_FRICTION * j);
        _a.copy(_c).scale(jt); a.applyImpulseAt(_a, _rA);
        _a.copy(_c).scale(-jt); b.applyImpulseAt(_a, _rB);
      }
    }
    a.pos.addScaled(n, -depth / 2);
    b.pos.addScaled(n, depth / 2);
  }

  _bumpCheck(car1, car2, contact) {
    if (car1.isDemoed || car2.isDemoed) return;
    if (car1.bumpOther === car2.id && car1.bumpCooldown > 0) return;
    _a.subVectors(car2.pos, car1.pos);
    if (car1.vel.dot(_a) <= 0) return;
    const speed = car1.vel.length();
    if (speed < 1) return;
    _b.copy(car1.vel).scale(1 / speed); // velDir
    _a.normalize();
    const speedTowards = car1.vel.dot(_a);
    const otherAway = car2.vel.dot(_b);
    if (speedTowards <= otherAway) return;
    _c.subVectors(contact, car1.pos).applyQuatInv(car1.quat);
    if (_c.x <= C.BUMP_MIN_FORWARD_DIST) return; // no fue con el parachoques
    const isDemo = car1.isSupersonic && car1.team !== car2.team;
    if (isDemo) {
      this.demolish(car2, car1);
    } else {
      const ground = car2.isOnGround;
      const base = curve(ground ? C.BUMP_VEL_AMOUNT_GROUND : C.BUMP_VEL_AMOUNT_AIR, speedTowards);
      if (car2.isOnGround) car2.up(_d); else _d.set(0, 0, 1);
      car2.velCache.addScaled(_b, base).addScaled(_d, curve(C.BUMP_UPWARD_VEL_AMOUNT, speedTowards));
      this.events.push({ type: 'bump', car: car2.id, by: car1.id, strength: speedTowards });
    }
    car1.bumpOther = car2.id;
    car1.bumpCooldown = C.BUMP_COOLDOWN_TIME;
  }

  // --- Serializacion del estado fisico ---
  serialize(out = []) {
    out.push(this.tick, this.ballEnabled ? 1 : 0);
    this.ball.serialize(out);
    out.push(this.pads.length);
    for (const p of this.pads) out.push(p.timer);
    out.push(this.cars.length);
    for (const car of this.cars) {
      out.push(car.id);
      car.serialize(out);
      const c = car.controls;
      out.push(c.throttle, c.steer, c.pitch, c.yaw, c.roll,
        (c.jump ? 1 : 0) | (c.boost ? 2 : 0) | (c.handbrake ? 4 : 0), car.lastExtraHitTick);
    }
    return out;
  }

  deserialize(a, i = 0, opts = {}) {
    this.tick = a[i++];
    this.ballEnabled = !!a[i++];
    i = this.ball.deserialize(a, i);
    const np = a[i++];
    for (let k = 0; k < np; k++) {
      const v = a[i++];
      if (this.pads[k]) this.pads[k].timer = v;
    }
    const nc = a[i++];
    for (let k = 0; k < nc; k++) {
      const id = a[i++];
      const car = this.getCar(id);
      if (!car) { i += CAR_SERIAL_SIZE + 7; continue; }
      i = car.deserialize(a, i);
      if (opts.skipControlsFor !== id) {
        const c = car.controls;
        c.throttle = a[i]; c.steer = a[i + 1]; c.pitch = a[i + 2]; c.yaw = a[i + 3]; c.roll = a[i + 4];
        const b = a[i + 5];
        c.jump = !!(b & 1); c.boost = !!(b & 2); c.handbrake = !!(b & 4);
      }
      car.lastExtraHitTick = a[i + 6];
      i += 7;
    }
    return i;
  }
}

function supportCenter(center, axes, half, n, dir, out) {
  // Centro de la cara/arista/vertice de la caja mas extremo en la direccion dir*n
  out.copy(center);
  for (let k = 0; k < 3; k++) {
    const d = axes[k].dot(n) * dir;
    if (Math.abs(d) > 0.2) out.addScaled(axes[k], Math.sign(d) * half[k]);
  }
  return out;
}

export { BALL_SERIAL_SIZE, CAR_SERIAL_SIZE, emptyControls };
