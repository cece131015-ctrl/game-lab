import { V3, Quat, clamp, sign } from './vec.js';
import { getCarConfig } from './cars.js';
import { arenaDist, arenaNormal, arenaRaycast } from './arena.js';
import * as C from './constants.js';

const { curve } = C;

// Temporales reutilizables (evitan crear objetos en cada tick)
const _f = new V3(), _l = new V3(), _u = new V3();
const _tmp = new V3(), _tmp2 = new V3(), _tmp3 = new V3();
const _r = new V3(), _pv = new V3(), _n = new V3();
const _upDir = new V3(), _fp = new V3(), _lp = new V3();
const _dir = new V3(), _hp = new V3();

const WORLD_CONTACT_SKIN = 1; // uu

export function emptyControls() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
}

export function copyControls(dst, src) {
  dst.throttle = src.throttle; dst.steer = src.steer; dst.pitch = src.pitch;
  dst.yaw = src.yaw; dst.roll = src.roll; dst.jump = !!src.jump;
  dst.boost = !!src.boost; dst.handbrake = !!src.handbrake;
  return dst;
}

export function packControls(c) {
  return [
    Math.round(c.throttle * 100) / 100, Math.round(c.steer * 100) / 100,
    Math.round(c.pitch * 100) / 100, Math.round(c.yaw * 100) / 100, Math.round(c.roll * 100) / 100,
    (c.jump ? 1 : 0) | (c.boost ? 2 : 0) | (c.handbrake ? 4 : 0),
  ];
}

export function unpackControls(a, out = emptyControls()) {
  out.throttle = clamp(+a[0] || 0, -1, 1); out.steer = clamp(+a[1] || 0, -1, 1);
  out.pitch = clamp(+a[2] || 0, -1, 1); out.yaw = clamp(+a[3] || 0, -1, 1); out.roll = clamp(+a[4] || 0, -1, 1);
  const b = a[5] | 0;
  out.jump = !!(b & 1); out.boost = !!(b & 2); out.handbrake = !!(b & 4);
  return out;
}

export class Car {
  constructor(id, team, type = 'octane') {
    this.id = id;
    this.team = team;
    this.setType(type);
    this.pos = new V3();
    this.vel = new V3();
    this.quat = new Quat();
    this.angVel = new V3();
    this.velCache = new V3();
    this.controls = emptyControls();
    this.wheelContact = [false, false, false, false];
    this.wheelSusp = [0, 0, 0, 0]; // longitud de suspension (para la animacion)
    this.wheelNormals = [new V3(0, 0, 1), new V3(0, 0, 1), new V3(0, 0, 1), new V3(0, 0, 1)];
    this.worldNormal = new V3(0, 0, 1);
    this.resetState();
  }

  setType(type) {
    this.cfg = getCarConfig(type);
    this.type = this.cfg.type; // tipo normalizado (nunca el texto recibido)
  }

  resetState() {
    this.boost = C.BOOST_SPAWN_AMOUNT;
    this.isOnGround = false;
    this.numContacts = 0;
    this.hasJumped = false;
    this.isJumping = false;
    this.jumpTime = 0;
    this.hasDoubleJumped = false;
    this.hasFlipped = false;
    this.isFlipping = false;
    this.flipTime = 0;
    this.flipTorqueF = 0; // componente de roll (eje adelante)
    this.flipTorqueL = 0; // componente de pitch (eje izquierda)
    this.airTime = 0;
    this.airTimeSinceJump = 0;
    this.handbrakeVal = 0;
    this.isBoosting = false;
    this.boostingTime = 0;
    this.timeSinceBoosted = 0;
    this.isSupersonic = false;
    this.supersonicTime = 0;
    this.isDemoed = false;
    this.demoTimer = 0;
    this.isAutoFlipping = false;
    this.autoFlipTimer = 0;
    this.autoFlipScale = 0;
    this.worldContact = false;
    this.bumpCooldown = 0;
    this.bumpOther = -1;
    this.lastJump = false;
    this.lastExtraHitTick = -10;
    this.velCache.set(0, 0, 0);
  }

  placeAt(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromEuler(yaw, 0, 0);
    this.velCache.set(0, 0, 0);
  }

  forward(out) { return out.set(1, 0, 0).applyQuat(this.quat); }
  left(out) { return out.set(0, 1, 0).applyQuat(this.quat); }
  up(out) { return out.set(0, 0, 1).applyQuat(this.quat); }

  // Multiplica por la inversa del tensor de inercia (por unidad de masa) en coordenadas de mundo
  invInertiaMul(v, out) {
    out.copy(v).applyQuatInv(this.quat);
    const inv = this.cfg.invInertia;
    out.x *= inv[0]; out.y *= inv[1]; out.z *= inv[2];
    return out.applyQuat(this.quat);
  }

  // Aplica un cambio de velocidad dv (impulso / masa) en el punto relativo r
  applyImpulseAt(dv, r) {
    this.vel.add(dv);
    _tmp3.crossVectors(r, dv);
    this.invInertiaMul(_tmp3, _tmp3);
    this.angVel.add(_tmp3);
  }

  // Aplica una aceleracion (fuerza / masa) en el punto relativo r durante dt
  applyAccelAt(acc, r, dt) {
    this.vel.addScaled(acc, dt);
    _tmp3.crossVectors(r, acc);
    this.invInertiaMul(_tmp3, _tmp3);
    this.angVel.addScaled(_tmp3, dt);
  }

  pointVelocity(r, out) {
    return out.crossVectors(this.angVel, r).add(this.vel);
  }

  // Masa efectiva inversa (por unidad de masa) en el punto r a lo largo de n
  effInvMass(r, n) {
    _tmp.crossVectors(r, n);
    this.invInertiaMul(_tmp, _tmp);
    _tmp2.crossVectors(_tmp, r);
    return 1 + n.dot(_tmp2);
  }

  // ---------------------------------------------------------------------------
  preTick(dt, world) {
    if (this.isDemoed) {
      this.demoTimer -= dt;
      if (this.demoTimer <= 0) world.respawnCar(this);
      return;
    }
    const ctl = this.controls;
    const f = this.forward(_f), l = this.left(_l), u = this.up(_u);
    const jumpPressed = ctl.jump && !this.lastJump;
    const cfg = this.cfg;

    // --- Ruedas (raycast contra el SDF del estadio) ---
    let numContacts = 0;
    _upDir.set(0, 0, 0);
    _dir.copy(u).scale(-1);
    const wheelHits = this._wheelHits || (this._wheelHits = [0, 0, 0, 0].map(() => ({ cp: new V3(), comp: 0 })));
    for (let i = 0; i < 4; i++) {
      const w = cfg.wheels[i];
      _hp.set(w.offset[0], w.offset[1], w.offset[2]).applyQuat(this.quat).add(this.pos);
      const maxLen = w.restLength + w.radius;
      const t = arenaRaycast(_hp, _dir, maxLen);
      if (t >= 0) {
        numContacts++;
        this.wheelContact[i] = true;
        const hit = wheelHits[i];
        hit.cp.copy(_hp).addScaled(_dir, t);
        arenaNormal(hit.cp.x, hit.cp.y, hit.cp.z, this.wheelNormals[i]);
        hit.comp = maxLen - t;
        this.wheelSusp[i] = Math.max(t - w.radius, w.restLength - C.MAX_SUSPENSION_TRAVEL);
        _upDir.add(this.wheelNormals[i]);
      } else {
        this.wheelContact[i] = false;
        this.wheelSusp[i] = w.restLength;
      }
    }
    this.numContacts = numContacts;
    this.isOnGround = numContacts >= 3;
    if (numContacts > 0) _upDir.normalize();

    const forwardSpeed = this.vel.dot(f);
    const absFwd = Math.abs(forwardSpeed);

    // --- Freno de mano (powerslide analogico) ---
    if (ctl.handbrake) this.handbrakeVal += C.POWERSLIDE_RISE_RATE * dt;
    else this.handbrakeVal -= C.POWERSLIDE_FALL_RATE * dt;
    this.handbrakeVal = clamp(this.handbrakeVal, 0, 1);

    let realThrottle = ctl.throttle;
    let realBrake = 0;
    if (ctl.boost && this.boost > 0) realThrottle = 1;
    let engineThrottle = realThrottle;
    if (!ctl.handbrake) {
      if (Math.abs(realThrottle) >= C.THROTTLE_DEADZONE) {
        if (absFwd > C.STOPPING_FORWARD_VEL && sign(realThrottle) !== sign(forwardSpeed)) {
          realBrake = 1;
          engineThrottle = 0;
        }
      } else {
        engineThrottle = 0;
        realBrake = absFwd < C.STOPPING_FORWARD_VEL ? 1 : C.COASTING_BRAKE_FACTOR;
      }
    }

    if (numContacts > 0) {
      // --- Suspension ---
      for (let i = 0; i < 4; i++) {
        if (!this.wheelContact[i]) continue;
        const w = cfg.wheels[i];
        const hit = wheelHits[i];
        const n = this.wheelNormals[i];
        _r.subVectors(hit.cp, this.pos);
        this.pointVelocity(_r, _pv);
        const projVel = _pv.dot(n);
        const denom = n.dot(u);
        let inv, relVel;
        if (denom <= 0.1) { inv = 10; relVel = 0; } else { inv = 1 / denom; relVel = projVel * inv; }
        let comp = hit.comp;
        // Mas alla del recorrido maximo la suspension se endurece (evita que la carroceria toque)
        if (comp > C.MAX_SUSPENSION_TRAVEL) comp += (comp - C.MAX_SUSPENSION_TRAVEL) * 3;
        let acc = w.k * comp * Math.min(inv, 3) - (relVel < 0 ? w.cComp : w.cRelax) * relVel;
        if (acc < 0) acc = 0;
        _tmp2.copy(n).scale(acc);
        this.applyAccelAt(_tmp2, _r, dt);
      }

      const contactFrac = numContacts / 4;
      // direcciones proyectadas en el plano de contacto
      _fp.copy(f).addScaled(_upDir, -f.dot(_upDir)).normalize();
      _lp.copy(l).addScaled(_upDir, -l.dot(_upDir)).normalize();
      const vLong = this.vel.dot(_fp);
      const vLat = this.vel.dot(_lp);

      const slip = Math.abs(vLat) > 5 ? Math.abs(vLat) / (Math.abs(vLat) + Math.abs(vLong)) : 0;
      let latFric = curve(C.LAT_FRICTION, slip);
      let longFric = 1;
      if (this.handbrakeVal > 0) {
        latFric *= (C.HANDBRAKE_LAT_FRICTION_FACTOR - 1) * this.handbrakeVal + 1;
        longFric = (curve(C.HANDBRAKE_LONG_FRICTION_FACTOR, slip) - 1) * this.handbrakeVal + 1;
      }
      if (realThrottle === 0) {
        const ns = curve(C.NON_STICKY_FRICTION_FACTOR, _upDir.z);
        latFric *= ns;
        longFric *= ns;
      }

      // --- Motor ---
      let driveScale = curve(C.DRIVE_SPEED_TORQUE_FACTOR, absFwd);
      if (numContacts < 3) driveScale /= 4;
      if (engineThrottle !== 0) {
        this.vel.addScaled(_fp, engineThrottle * C.THROTTLE_ACCEL * driveScale * contactFrac * longFric * dt);
      }
      // --- Freno ---
      if (realBrake > 0) {
        const vl = this.vel.dot(_fp);
        const dec = realBrake * C.BRAKE_ACCEL * dt * contactFrac * longFric;
        if (Math.abs(vl) <= dec) this.vel.addScaled(_fp, -vl);
        else this.vel.addScaled(_fp, -sign(vl) * dec);
      }
      // --- Friccion lateral ---
      const k = clamp(latFric * 0.8 * contactFrac, 0, 1);
      this.vel.addScaled(_lp, -vLat * k);

      // --- Direccion (modelo de bicicleta con las curvas de angulo de RocketSim) ---
      let steerAngle = curve(C.STEER_ANGLE_FROM_SPEED, absFwd);
      if (this.handbrakeVal > 0) {
        steerAngle += (curve(C.POWERSLIDE_STEER_ANGLE_FROM_SPEED, absFwd) - steerAngle) * this.handbrakeVal;
      }
      const curvature = Math.tan(steerAngle) / cfg.wheelBase;
      const targetYaw = -forwardSpeed * curvature * ctl.steer;
      const curYaw = this.angVel.dot(u);
      const gain = clamp(50 * dt * contactFrac, 0, 1);
      this.angVel.addScaled(u, (targetYaw - curYaw) * gain);

      // --- Fuerza de adherencia (sticky) ---
      const fullStick = realThrottle !== 0 || absFwd > C.STOPPING_FORWARD_VEL;
      let stickScale = 0.5;
      if (fullStick) stickScale += 1 - Math.abs(_upDir.z);
      this.vel.addScaled(_upDir, stickScale * C.GRAVITY_Z * dt);
    }

    // --- Control aereo ---
    if (numContacts < 3) {
      this._updateAirTorque(dt, numContacts === 0, f, l, u);
    } else {
      this.isFlipping = false;
    }

    this._updateJump(dt, jumpPressed, u);
    this._updateAutoFlip(dt, jumpPressed, f, l, u);
    this._updateDoubleJumpOrFlip(dt, jumpPressed, forwardSpeed, f, u);

    if (ctl.throttle !== 0 && ((numContacts > 0 && numContacts < 4) || this.worldContact)) {
      this._updateAutoRoll(dt, numContacts, u);
    }
    this.worldContact = false;

    this._updateBoost(dt, f);

    // Gravedad
    this.vel.z += C.GRAVITY_Z * dt;
  }

  _updateAirTorque(dt, updateAirControl, f, l, u) {
    const ctl = this.controls;
    let doAirControl = false;
    if (this.isFlipping) this.isFlipping = this.hasFlipped && this.flipTime < C.FLIP_TORQUE_TIME;

    if (this.isFlipping) {
      if (this.flipTorqueF !== 0 || this.flipTorqueL !== 0) {
        let pitchScale = 1;
        // Cancelar el flip tirando del stick en sentido contrario
        if (this.flipTorqueL !== 0 && ctl.pitch !== 0 && sign(this.flipTorqueL) === sign(ctl.pitch)) {
          pitchScale = 1 - Math.min(Math.abs(ctl.pitch), 1);
          doAirControl = true;
        }
        const aF = this.flipTorqueF * C.FLIP_TORQUE_X;
        const aL = this.flipTorqueL * pitchScale * C.FLIP_TORQUE_Y;
        this.angVel.addScaled(f, aF * dt).addScaled(l, aL * dt);
      } else {
        doAirControl = true; // stall
      }
    } else {
      doAirControl = true;
    }

    doAirControl = doAirControl && !this.isAutoFlipping && updateAirControl;
    if (doAirControl) {
      let pitchTorqueScale = 1;
      if (this.isFlipping) pitchTorqueScale = 0;
      else if (this.hasFlipped && this.flipTime < C.FLIP_TORQUE_TIME + C.FLIP_PITCHLOCK_EXTRA_TIME) pitchTorqueScale = 0;

      // Ejes: pitch (+ = morro arriba) gira alrededor de la derecha (-l),
      // yaw (+ = derecha) alrededor de -u, roll (+ = derecha) alrededor de +f.
      const S = C.CAR_TORQUE_SCALE;
      const wPitch = -this.angVel.dot(l); // velocidad angular alrededor de la derecha
      const wYaw = -this.angVel.dot(u);
      const wRoll = this.angVel.dot(f);
      const p = ctl.pitch * pitchTorqueScale;
      const aPitch = (p * C.AIR_TORQUE[0] - wPitch * C.AIR_DAMPING[0] * (1 - Math.abs(p))) * S;
      const aYaw = (ctl.yaw * C.AIR_TORQUE[1] - wYaw * C.AIR_DAMPING[1] * (1 - Math.abs(ctl.yaw))) * S;
      const aRoll = (ctl.roll * C.AIR_TORQUE[2] - wRoll * C.AIR_DAMPING[2]) * S;
      this.angVel.addScaled(l, -aPitch * dt).addScaled(u, -aYaw * dt).addScaled(f, aRoll * dt);
    }

    if (ctl.throttle !== 0) this.vel.addScaled(f, ctl.throttle * C.THROTTLE_AIR_ACCEL * dt);
  }

  _updateJump(dt, jumpPressed, u) {
    if (this.isOnGround && !this.isJumping) {
      if (this.hasJumped && this.jumpTime < C.JUMP_MIN_TIME + C.JUMP_RESET_TIME_PAD) {
        // todavia saliendo del suelo
      } else {
        this.hasJumped = false;
        this.jumpTime = 0;
      }
    }
    if (this.isJumping) {
      this.isJumping = this.jumpTime < C.JUMP_MIN_TIME || (this.controls.jump && this.jumpTime < C.JUMP_MAX_TIME);
    } else if (this.isOnGround && jumpPressed) {
      this.isJumping = true;
      this.jumpTime = 0;
      this.vel.addScaled(u, C.JUMP_IMMEDIATE_FORCE);
      this.events?.push({ type: 'jump', car: this.id });
    }
    if (this.isJumping) {
      this.hasJumped = true;
      let a = C.JUMP_ACCEL;
      if (this.jumpTime < C.JUMP_MIN_TIME) a *= C.JUMP_PRE_MIN_ACCEL_SCALE;
      this.vel.addScaled(u, a * dt);
    }
    if (this.isJumping || this.hasJumped) this.jumpTime += dt;
  }

  _updateAutoFlip(dt, jumpPressed, f, l, u) {
    if (jumpPressed && this.worldContact && this.worldNormal.z > C.CAR_AUTOFLIP_NORMZ_THRESH) {
      const roll = Math.atan2(l.z, u.z);
      const absRoll = Math.abs(roll);
      if (absRoll > C.CAR_AUTOFLIP_ROLL_THRESH) {
        this.autoFlipTimer = C.CAR_AUTOFLIP_TIME * (absRoll / Math.PI);
        this.autoFlipScale = roll > 0 ? -1 : 1; // por el camino mas corto
        this.isAutoFlipping = true;
        this.vel.addScaled(u, -C.CAR_AUTOFLIP_IMPULSE);
      }
    }
    if (this.isAutoFlipping) {
      if (this.autoFlipTimer <= 0) {
        this.isAutoFlipping = false;
        this.autoFlipTimer = 0;
      } else {
        this.angVel.addScaled(f, C.CAR_AUTOFLIP_TORQUE * this.autoFlipScale * dt);
        this.autoFlipTimer -= dt;
      }
    }
  }

  _updateDoubleJumpOrFlip(dt, jumpPressed, forwardSpeed, f, u) {
    const ctl = this.controls;
    const tickScale = dt / (1 / 120);
    if (this.isOnGround) {
      this.hasDoubleJumped = false;
      this.hasFlipped = false;
      this.airTime = 0;
      this.airTimeSinceJump = 0;
      this.flipTime = 0;
    } else {
      this.airTime += dt;
      if (this.hasJumped && !this.isJumping) this.airTimeSinceJump += dt;
      else this.airTimeSinceJump = 0;

      // Sin salto previo (caida desde el muro) tambien se permite un salto en el aire
      const canAirJump = this.hasJumped ? this.airTimeSinceJump < C.DOUBLEJUMP_MAX_DELAY : true;
      if (jumpPressed && canAirJump && !this.hasDoubleJumped && !this.hasFlipped && !this.isAutoFlipping) {
        const inputMag = Math.abs(ctl.yaw) + Math.abs(ctl.pitch) + Math.abs(ctl.roll);
        if (inputMag >= C.DODGE_DEADZONE) {
          // --- Flip / esquiva ---
          this.flipTime = 0;
          this.hasFlipped = true;
          this.isFlipping = true;
          const ratio = Math.abs(forwardSpeed) / C.CAR_MAX_SPEED;
          let dx = -ctl.pitch; // adelante
          let dy = ctl.yaw + ctl.roll; // derecha
          if (Math.abs(dy) < 0.1 && Math.abs(dx) < 0.1) { dx = 0; dy = 0; } else {
            const len = Math.hypot(dx, dy); dx /= len; dy /= len;
          }
          this.flipTorqueF = dy / tickScale; // roll a la derecha = +f
          this.flipTorqueL = dx / tickScale; // morro abajo = +l
          if (Math.abs(dx) < 0.1) dx = 0;
          if (Math.abs(dy) < 0.1) dy = 0;
          if (dx !== 0 || dy !== 0) {
            let backwards;
            if (Math.abs(forwardSpeed) < 100) backwards = dx < 0;
            else backwards = (dx >= 0) !== (forwardSpeed >= 0);
            let ix = dx * C.FLIP_INITIAL_VEL_SCALE;
            let iy = dy * C.FLIP_INITIAL_VEL_SCALE;
            const maxX = backwards ? C.FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE : C.FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE;
            ix *= (maxX - 1) * ratio + 1;
            iy *= (C.FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE - 1) * ratio + 1;
            if (backwards) ix *= C.FLIP_BACKWARD_IMPULSE_SCALE_X;
            // direccion 2D del coche
            let fx = f.x, fy = f.y;
            const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
            // derecha 2D = (fy, -fx) en coordenadas dextrogiras con z arriba
            this.vel.x += ix * fx + iy * fy;
            this.vel.y += ix * fy - iy * fx;
          }
          this.events?.push({ type: 'flip', car: this.id });
        } else {
          // --- Doble salto ---
          this.vel.addScaled(u, C.JUMP_IMMEDIATE_FORCE);
          this.hasDoubleJumped = true;
          this.events?.push({ type: 'jump', car: this.id });
        }
      }
    }

    if (this.isFlipping) {
      this.flipTime += dt;
      if (this.flipTime <= C.FLIP_TORQUE_TIME) {
        if (this.flipTime >= C.FLIP_Z_DAMP_START && (this.vel.z < 0 || this.flipTime < C.FLIP_Z_DAMP_END)) {
          this.vel.z *= Math.pow(1 - C.FLIP_Z_DAMP_120, tickScale);
        }
      }
    } else if (this.hasFlipped) {
      this.flipTime += dt;
    }
  }

  _updateAutoRoll(dt, numContacts, u) {
    const groundUp = numContacts > 0 ? _upDir : this.worldNormal;
    this.vel.addScaled(groundUp, -C.CAR_AUTOROLL_FORCE * dt);
    // par que alinea el techo con la normal del suelo
    _tmp.crossVectors(u, groundUp);
    this.angVel.addScaled(_tmp, C.CAR_AUTOROLL_TORQUE * dt);
  }

  _updateBoost(dt, f) {
    const hasBoost = this.boost > 0;
    if (hasBoost) {
      if (this.isBoosting) this.isBoosting = this.controls.boost || this.boostingTime < C.BOOST_MIN_TIME;
      else this.isBoosting = this.controls.boost;
    } else {
      this.isBoosting = false;
    }
    if (this.isBoosting) this.boostingTime += dt;
    else this.boostingTime = 0;

    if (this.isBoosting) {
      if (!this.unlimitedBoost) this.boost = Math.max(this.boost - C.BOOST_USED_PER_SECOND * dt, 0);
      this.vel.addScaled(f, (this.isOnGround ? C.BOOST_ACCEL_GROUND : C.BOOST_ACCEL_AIR) * dt);
      this.timeSinceBoosted = 0;
    } else {
      this.timeSinceBoosted += dt;
    }
    this.boost = Math.min(this.boost, C.BOOST_MAX);
  }

  // Colision de la carroceria (hitbox) con el estadio
  collideArena() {
    if (this.isDemoed) return;
    const cfg = this.cfg;
    const pts = getHitboxSamplePoints(cfg);
    // Piel de contacto: se detecta el contacto un poco antes de penetrar para que
    // worldContact no parpadee al reposar (la correccion deja el coche en d = 0)
    let deepest = WORLD_CONTACT_SKIN;
    for (let i = 0; i < pts.length; i++) {
      const lp = pts[i];
      _r.copy(lp).applyQuat(this.quat);
      const px = this.pos.x + _r.x, py = this.pos.y + _r.y, pz = this.pos.z + _r.z;
      const d = arenaDist(px, py, pz);
      if (d >= WORLD_CONTACT_SKIN) continue;
      const n = arenaNormal(px, py, pz, _n);
      if (d < deepest) { deepest = d; this.worldNormal.copy(n); }
      this.worldContact = true;
      this.pointVelocity(_r, _pv);
      const vn = _pv.dot(n);
      if (vn >= 0) continue;
      const e = vn < -150 ? C.CARWORLD_RESTITUTION : 0;
      const kn = this.effInvMass(_r, n);
      const jn = (-(1 + e) * vn) / kn;
      _tmp2.copy(n).scale(jn);
      this.applyImpulseAt(_tmp2, _r);
      // friccion
      this.pointVelocity(_r, _pv);
      const vn2 = _pv.dot(n);
      _pv.addScaled(n, -vn2);
      const vt = _pv.length();
      if (vt > 1e-4) {
        _pv.scale(1 / vt);
        const kt = this.effInvMass(_r, _pv);
        const jt = Math.min(vt / kt, C.CARWORLD_FRICTION * jn);
        _tmp2.copy(_pv).scale(-jt);
        this.applyImpulseAt(_tmp2, _r);
      }
    }
    // correccion de posicion solo si hay penetracion real (hasta 3 pasadas para esquinas)
    for (let pass = 0; pass < 3 && deepest < 0; pass++) {
      let worst = 0;
      for (let i = 0; i < pts.length; i++) {
        _r.copy(pts[i]).applyQuat(this.quat);
        const d = arenaDist(this.pos.x + _r.x, this.pos.y + _r.y, this.pos.z + _r.z);
        if (d < worst) { worst = d; _hp.copy(_r).add(this.pos); }
      }
      if (worst >= -0.01) break;
      arenaNormal(_hp.x, _hp.y, _hp.z, _n);
      this.pos.addScaled(_n, -worst);
    }
  }

  finishTick() {
    if (this.isDemoed) return;
    if (this.velCache.x !== 0 || this.velCache.y !== 0 || this.velCache.z !== 0) {
      this.vel.add(this.velCache);
      this.velCache.set(0, 0, 0);
    }
    this.vel.clampLength(C.CAR_MAX_SPEED);
    this.angVel.clampLength(C.CAR_MAX_ANG_SPEED);
  }

  integrate(dt) {
    if (this.isDemoed) return;
    this.pos.addScaled(this.vel, dt);
    this.quat.integrate(this.angVel, dt);
  }

  postTick(dt) {
    this.lastJump = this.controls.jump;
    if (this.isDemoed) return;
    const s2 = this.vel.lengthSq();
    if (this.isSupersonic && this.supersonicTime < C.SUPERSONIC_MAINTAIN_MAX_TIME) {
      this.isSupersonic = s2 >= C.SUPERSONIC_MAINTAIN_MIN_SPEED ** 2;
    } else {
      this.isSupersonic = s2 >= C.SUPERSONIC_START_SPEED ** 2;
    }
    if (this.isSupersonic) this.supersonicTime += dt;
    else this.supersonicTime = 0;
    if (this.bumpCooldown > 0) this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
  }

  // Centro de la hitbox en coordenadas de mundo
  hitboxCenter(out) {
    const o = this.cfg.offset;
    return out.set(o[0], o[1], o[2]).applyQuat(this.quat).add(this.pos);
  }

  // ---------------------------------------------------------------------------
  serialize(out) {
    const flags = (this.hasJumped ? 1 : 0) | (this.isJumping ? 2 : 0) | (this.hasDoubleJumped ? 4 : 0) |
      (this.hasFlipped ? 8 : 0) | (this.isFlipping ? 16 : 0) | (this.isBoosting ? 32 : 0) |
      (this.isSupersonic ? 64 : 0) | (this.isDemoed ? 128 : 0) | (this.isAutoFlipping ? 256 : 0) |
      (this.lastJump ? 512 : 0) | (this.worldContact ? 1024 : 0) | (this.isOnGround ? 2048 : 0);
    out.push(
      this.pos.x, this.pos.y, this.pos.z, this.vel.x, this.vel.y, this.vel.z,
      this.quat.x, this.quat.y, this.quat.z, this.quat.w, this.angVel.x, this.angVel.y, this.angVel.z,
      this.boost, flags, this.jumpTime, this.flipTime, this.flipTorqueF, this.flipTorqueL,
      this.airTime, this.airTimeSinceJump, this.handbrakeVal, this.boostingTime, this.timeSinceBoosted,
      this.supersonicTime, this.demoTimer, this.autoFlipTimer, this.autoFlipScale, this.bumpCooldown,
      this.bumpOther, this.worldNormal.x, this.worldNormal.y, this.worldNormal.z, this.numContacts,
    );
  }

  deserialize(a, i) {
    this.pos.set(a[i], a[i + 1], a[i + 2]);
    this.vel.set(a[i + 3], a[i + 4], a[i + 5]);
    this.quat.set(a[i + 6], a[i + 7], a[i + 8], a[i + 9]).normalize();
    this.angVel.set(a[i + 10], a[i + 11], a[i + 12]);
    this.boost = a[i + 13];
    const fl = a[i + 14];
    this.hasJumped = !!(fl & 1); this.isJumping = !!(fl & 2); this.hasDoubleJumped = !!(fl & 4);
    this.hasFlipped = !!(fl & 8); this.isFlipping = !!(fl & 16); this.isBoosting = !!(fl & 32);
    this.isSupersonic = !!(fl & 64); this.isDemoed = !!(fl & 128); this.isAutoFlipping = !!(fl & 256);
    this.lastJump = !!(fl & 512); this.worldContact = !!(fl & 1024); this.isOnGround = !!(fl & 2048);
    this.jumpTime = a[i + 15]; this.flipTime = a[i + 16]; this.flipTorqueF = a[i + 17]; this.flipTorqueL = a[i + 18];
    this.airTime = a[i + 19]; this.airTimeSinceJump = a[i + 20]; this.handbrakeVal = a[i + 21];
    this.boostingTime = a[i + 22]; this.timeSinceBoosted = a[i + 23]; this.supersonicTime = a[i + 24];
    this.demoTimer = a[i + 25]; this.autoFlipTimer = a[i + 26]; this.autoFlipScale = a[i + 27];
    this.bumpCooldown = a[i + 28]; this.bumpOther = a[i + 29];
    this.worldNormal.set(a[i + 30], a[i + 31], a[i + 32]);
    this.numContacts = a[i + 33];
    this.velCache.set(0, 0, 0);
    return i + CAR_SERIAL_SIZE;
  }
}

export const CAR_SERIAL_SIZE = 34;

const samplePointCache = new Map();
function getHitboxSamplePoints(cfg) {
  let pts = samplePointCache.get(cfg.type);
  if (pts) return pts;
  pts = [];
  const [hx, hy, hz] = cfg.half;
  const [ox, oy, oz] = cfg.offset;
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        const nonZero = (sx !== 0) + (sy !== 0) + (sz !== 0);
        if (nonZero < 1) continue; // sin el centro
        pts.push(new V3(ox + sx * hx, oy + sy * hy, oz + sz * hz));
      }
    }
  }
  samplePointCache.set(cfg.type, pts);
  return pts;
}
