import { V3 } from './vec.js';
import { arenaDist, arenaNormal } from './arena.js';
import {
  GRAVITY_Z, BALL_RADIUS, BALL_DRAG, BALL_MAX_SPEED, BALL_MAX_ANG_SPEED, BALL_MASS,
  BALL_BOUNCE_RESTITUTION, BALL_BOUNCE_MU, BALL_BOUNCE_SPIN_A, BALL_BOUNCE_Y, BALL_REST_Z,
} from './constants.js';

const _n = new V3();
const _vPerp = new V3();
const _vPara = new V3();
const _vSpin = new V3();
const _s = new V3();
const _dv = new V3();
const _t = new V3();

export class Ball {
  constructor() {
    this.pos = new V3(0, 0, BALL_REST_Z);
    this.vel = new V3();
    this.angVel = new V3();
    this.radius = BALL_RADIUS;
    this.mass = BALL_MASS;
    this.invMass = 1 / BALL_MASS;
    this.invInertia = 1 / (0.4 * BALL_MASS * BALL_RADIUS * BALL_RADIUS);
    this.velCache = new V3(); // impulsos extra que se suman al final del tick
    this.lastHitBounce = 0; // velocidad de impacto del ultimo rebote (para sonidos)
  }

  reset(x = 0, y = 0, z = BALL_REST_Z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.velCache.set(0, 0, 0);
  }

  applyForces(dt) {
    this.vel.z += GRAVITY_Z * dt;
    const damp = Math.pow(1 - BALL_DRAG, dt);
    this.vel.scale(damp);
  }

  // Colision con el estadio + modelo de rebote con efecto. Devuelve la velocidad normal de impacto.
  collideArena() {
    const p = this.pos;
    const d = arenaDist(p.x, p.y, p.z);
    if (d >= this.radius) return 0;
    const n = arenaNormal(p.x, p.y, p.z, _n);
    // separar
    p.addScaled(n, this.radius - d);
    const vn = this.vel.dot(n);
    if (vn >= 0) return 0;
    const R = this.radius;
    _vPerp.copy(n).scale(vn);
    _vPara.copy(this.vel).sub(_vPerp);
    _vSpin.crossVectors(n, this.angVel).scale(R);
    _s.copy(_vPara).add(_vSpin);
    const sLen = _s.length();
    const restitution = vn > -60 ? 0 : BALL_BOUNCE_RESTITUTION;
    // delta perpendicular
    this.vel.addScaled(_vPerp, -(1 + restitution));
    if (sLen > 1e-6) {
      const ratio = Math.abs(vn) / sLen;
      const f = -Math.min(1, BALL_BOUNCE_Y * ratio) * BALL_BOUNCE_MU;
      _dv.copy(_s).scale(f);
      this.vel.add(_dv);
      _t.crossVectors(_dv, n).scale(BALL_BOUNCE_SPIN_A * R);
      this.angVel.add(_t);
    }
    return -vn;
  }

  finishTick() {
    if (this.velCache.x !== 0 || this.velCache.y !== 0 || this.velCache.z !== 0) {
      this.vel.add(this.velCache);
      this.velCache.set(0, 0, 0);
    }
    this.vel.clampLength(BALL_MAX_SPEED);
    this.angVel.clampLength(BALL_MAX_ANG_SPEED);
  }

  integrate(dt) {
    this.pos.addScaled(this.vel, dt);
  }

  serialize(out) {
    out.push(this.pos.x, this.pos.y, this.pos.z, this.vel.x, this.vel.y, this.vel.z,
      this.angVel.x, this.angVel.y, this.angVel.z);
  }

  deserialize(arr, i) {
    this.pos.set(arr[i], arr[i + 1], arr[i + 2]);
    this.vel.set(arr[i + 3], arr[i + 4], arr[i + 5]);
    this.angVel.set(arr[i + 6], arr[i + 7], arr[i + 8]);
    this.velCache.set(0, 0, 0);
    return i + 9;
  }

  copyFrom(b) {
    this.pos.copy(b.pos); this.vel.copy(b.vel); this.angVel.copy(b.angVel);
    this.velCache.set(0, 0, 0);
  }
}

export const BALL_SERIAL_SIZE = 9;
