import * as THREE from 'three';
import { arenaDist, arenaNormal } from '../../shared/arena.js';
import { V3 } from '../../shared/vec.js';

const _n = new V3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _look = new THREE.Vector3();

// Camara de persecucion al estilo Rocket League (FOV 110, distancia 270, altura 110)
export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.ballCam = true;
    this.settings = { fov: 110, distance: 270, height: 110, angle: -3, stiffness: 0.45, shake: true };
    this.pos = new THREE.Vector3(0, -6000, 1500);
    this.lookAt = new THREE.Vector3();
    this.heading = Math.PI / 2;
    this.initialized = false;
    this.shakeAmount = 0;
    this.orbitT = 0;
    this.mode = 'orbit';
  }

  setFov(aspect) {
    const h = THREE.MathUtils.degToRad(this.settings.fov);
    const v = 2 * Math.atan(Math.tan(h / 2) / Math.max(aspect, 0.5));
    this.camera.fov = THREE.MathUtils.radToDeg(Math.min(v, THREE.MathUtils.degToRad(100)));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(amount) {
    if (this.settings.shake) this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  reset() { this.initialized = false; }

  // Vista orbital (menus)
  updateOrbit(dt) {
    this.orbitT += dt * 0.05;
    const r = 7500;
    this.camera.position.set(Math.cos(this.orbitT) * r, Math.sin(this.orbitT) * r * 1.2, 2400);
    this.camera.lookAt(0, 0, 200);
    this.initialized = false;
  }

  update(dt, car, ballPos, carPos, carQuatForward, carUp) {
    const cam = this.camera;
    const s = this.settings;
    // direccion deseada
    let targetHeading = this.heading;
    let dirZ = 0;
    if (this.ballCam && ballPos) {
      const dx = ballPos.x - carPos.x, dy = ballPos.y - carPos.y, dz = ballPos.z - carPos.z;
      const hd = Math.hypot(dx, dy);
      if (hd > 30) targetHeading = Math.atan2(dy, dx);
      dirZ = Math.atan2(dz, Math.max(hd, 1));
    } else {
      const onGround = car.numContacts >= 3;
      let fx, fy;
      if (onGround || car.vel.length() < 300) { fx = carQuatForward.x; fy = carQuatForward.y; } else { fx = car.vel.x; fy = car.vel.y; }
      // si el coche mira hacia arriba (muro), usar su "arriba" invertido como referencia
      if (Math.hypot(fx, fy) < 0.2 && carUp) { fx = -carUp.x; fy = -carUp.y; }
      if (Math.hypot(fx, fy) > 0.05) targetHeading = Math.atan2(fy, fx);
    }
    if (!this.initialized) { this.heading = targetHeading; }
    let dh = targetHeading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const swivel = 1 - Math.exp(-dt * (this.ballCam ? 9 : 7));
    this.heading += dh * swivel;

    const hx = Math.cos(this.heading), hy = Math.sin(this.heading);
    const elev = THREE.MathUtils.clamp(dirZ, -0.2, 0.9);
    const dist = s.distance;
    const height = s.height * (1 - elev * 0.55);
    _v.set(carPos.x - hx * dist * Math.cos(elev * 0.6), carPos.y - hy * dist * Math.cos(elev * 0.6), carPos.z + height);

    // mantener la camara dentro del estadio
    let d = arenaDist(_v.x, _v.y, _v.z);
    if (d < 40) {
      arenaNormal(_v.x, _v.y, _v.z, _n);
      _v.x += _n.x * (40 - d); _v.y += _n.y * (40 - d); _v.z += _n.z * (40 - d);
    }

    if (!this.initialized) {
      this.pos.copy(_v);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * 18);
      this.pos.lerp(_v, k);
    }

    // punto de mira
    if (this.ballCam && ballPos) {
      _f.set(ballPos.x - carPos.x, ballPos.y - carPos.y, ballPos.z - carPos.z);
      const len = _f.length();
      _f.normalize();
      const ahead = Math.min(len, 1200);
      _look.set(carPos.x + _f.x * ahead, carPos.y + _f.y * ahead, carPos.z + 40 + _f.z * ahead * 0.75);
    } else {
      const ang = THREE.MathUtils.degToRad(s.angle);
      _look.set(carPos.x + hx * 600, carPos.y + hy * 600, carPos.z + 70 + Math.tan(ang) * 600);
    }
    this.lookAt.lerp(_look, this.initialized ? 1 - Math.exp(-dt * 20) : 1);

    cam.position.copy(this.pos);
    if (this.shakeAmount > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmount;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmount;
      cam.position.z += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.lookAt);
  }

  // Seguir el balon (coche demolido o espectador)
  updateSpectate(dt, ballPos) {
    _v.set(ballPos.x * 0.6, ballPos.y * 0.6 - 2500, Math.max(900, ballPos.z + 700));
    if (!this.initialized) { this.pos.copy(_v); this.initialized = true; }
    this.pos.lerp(_v, 1 - Math.exp(-dt * 3));
    this.camera.position.copy(this.pos);
    this.lookAt.lerp(_look.set(ballPos.x, ballPos.y, ballPos.z), 1 - Math.exp(-dt * 6));
    this.camera.lookAt(this.lookAt);
  }
}
