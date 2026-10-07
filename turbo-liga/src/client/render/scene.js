import * as THREE from 'three';
import { buildArena, BLUE, ORANGE } from './arenaMesh.js';
import { buildCarModel, updateCarModel } from './carMesh.js';
import { Particles, Shockwaves } from './effects.js';
import { CameraController } from './camera.js';
import { makeBallTexture, makeSkyTexture, makeLabelTexture, makeGlowTexture } from './textures.js';
import { BALL_RADIUS, BOOST_PADS_BIG, TEAM_BLUE, ARENA_EXTENT_Y } from '../../shared/constants.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const TEAM_SHADES = [
  ['#1f6fff', '#1846c9', '#3a9bff', '#4b5dff', '#0b8fa8', '#2563eb'],
  ['#ff7a1a', '#ff4d1a', '#ffa41a', '#e85d04', '#ff5f6d', '#f59e0b'],
];
export const ACCENTS = ['#ffffff', '#111318', '#ffd23f', '#38f27a', '#c84bff', '#ff3b3b', '#00e5ff', '#ff8fd1'];

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export class GameRenderer {
  constructor(container, quality = 'high') {
    this.container = container;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const sky = makeSkyTexture();
    scene.background = sky;
    scene.fog = new THREE.Fog('#1b1e33', 16000, 42000);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(75, 1, 10, 80000);
    this.cam = new CameraController(this.camera);

    // luces
    scene.add(new THREE.HemisphereLight('#c8d8ff', '#26402a', 1.1));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(-3000, -2000, 8000);
    sun.target.position.set(0, 0, 0);
    if (renderer.shadowMap.enabled) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
      const sc = sun.shadow.camera;
      sc.left = -5600; sc.right = 5600; sc.top = 6800; sc.bottom = -6800; sc.near = 100; sc.far = 20000;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 2;
    }
    scene.add(sun, sun.target);
    scene.add(new THREE.AmbientLight('#404860', 0.6));

    const arena = buildArena(renderer);
    scene.add(arena.group);
    this.pads = arena.pads;

    // balon
    const ballMat = new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.45, metalness: 0.15, emissive: '#2b3240', emissiveIntensity: 0.3 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 40, 28), ballMat);
    this.ball.castShadow = true;
    scene.add(this.ball);
    this.ballQuat = new THREE.Quaternion();
    // indicador en el suelo bajo el balon
    const ringGeo = new THREE.RingGeometry(BALL_RADIUS * 0.85, BALL_RADIUS, 32);
    this.ballRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballRing.position.z = 2;
    scene.add(this.ballRing);
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: '#bfe3ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ballGlow.scale.set(500, 500, 1);
    scene.add(this.ballGlow);

    this.particles = new Particles(quality === 'low' ? 2000 : 6000);
    scene.add(this.particles.points);
    this.shock = new Shockwaves(scene);

    this.cars = new Map();
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.cam.setFov(w / h);
    this.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  // players: [{id, team, carType, colors:{primary, accent}, name}]
  setRoster(players, localId) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      const key = `${p.team}|${p.carType}|${p.colors?.primary}|${p.colors?.accent}|${p.name}`;
      const existing = this.cars.get(p.id);
      if (existing && existing.key === key) { existing.isLocal = p.id === localId; continue; }
      if (existing) this.removeCarModel(p.id);
      const shades = TEAM_SHADES[p.team] || TEAM_SHADES[0];
      const primary = shades[(p.colors?.primary ?? 0) % shades.length];
      const accent = p.colors?.accent || ACCENTS[p.team === TEAM_BLUE ? 0 : 1];
      const model = buildCarModel(p.carType, primary, accent);
      model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(model.group);
      let label = null;
      if (p.id !== localId) {
        const tex = makeLabelTexture(p.name || '', p.team === TEAM_BLUE ? '#9cc4ff' : '#ffc08a');
        label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
        label.scale.set(260, 49, 1);
        label.renderOrder = 10;
        this.scene.add(label);
      }
      this.cars.set(p.id, { model, label, key, team: p.team, isLocal: p.id === localId, trailT: 0 });
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.removeCarModel(id);
  }

  removeCarModel(id) {
    const c = this.cars.get(id);
    if (!c) return;
    this.scene.remove(c.model.group);
    if (c.label) this.scene.remove(c.label);
    this.cars.delete(id);
  }

  setPreview(type, colors, team = 0) {
    this.clearPreview();
    const shades = TEAM_SHADES[team];
    const model = buildCarModel(type, shades[(colors?.primary ?? 0) % shades.length], colors?.accent || '#ffffff');
    model.group.position.set(0, -2500, 17);
    model.group.rotation.z = Math.PI / 2;
    model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(model.group);
    this.preview = model;
    this.previewT = this.previewT || 0;
    // desplazar la imagen para que el coche quede a la izquierda del panel del garaje
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    if (w > 720) this.camera.setViewOffset(w, h, w * 0.22, 0, w, h);
  }

  clearPreview() {
    if (this.preview) this.scene.remove(this.preview.group);
    if (this.preview) this.camera.clearViewOffset();
    this.preview = null;
  }

  clearCars() {
    for (const id of [...this.cars.keys()]) this.removeCarModel(id);
  }

  // Actualiza la escena a partir de la sesion (juego + interpolacion)
  update(dt, session) {
    this.time += dt;
    const game = session?.game;
    if (!game && this.preview) {
      // garaje: camara girando alrededor del coche
      this.previewT += dt * 0.6;
      const r = 420;
      this.camera.position.set(Math.cos(this.previewT) * r, -2500 + Math.sin(this.previewT) * r, 150);
      this.camera.lookAt(0, -2500, 30);
      this.cam.reset();
      this.ball.visible = false;
      this.ballRing.visible = false;
      this.particles.update(dt);
      this.animatePads(null);
      return;
    }
    if (!game) {
      this.cam.updateOrbit(dt);
      this.ball.position.set(0, 0, BALL_RADIUS);
      this.ball.visible = true;
      this.ballRing.visible = false;
      this.particles.update(dt);
      this.shock.update(dt);
      this.animatePads(null);
      return;
    }
    const world = game.world;

    // balon
    session.getBallPos(_p);
    this.ball.position.copy(_p);
    this.ball.visible = world.ballEnabled;
    const av = world.ball.angVel;
    const angSpeed = Math.hypot(av.x, av.y, av.z);
    if (angSpeed > 1e-4) {
      _v.set(av.x / angSpeed, av.y / angSpeed, av.z / angSpeed);
      _q.setFromAxisAngle(_v, angSpeed * dt);
      this.ballQuat.premultiply(_q);
    }
    this.ball.quaternion.copy(this.ballQuat);
    this.ballRing.visible = world.ballEnabled;
    this.ballRing.position.set(_p.x, _p.y, 2);
    const h = Math.max(0, _p.z - BALL_RADIUS);
    this.ballRing.material.opacity = Math.max(0.08, 0.45 - h / 3000);
    this.ballRing.scale.setScalar(1 + h / 1200);
    const ballSpeed = world.ball.vel.length();
    this.ballGlow.position.copy(_p);
    this.ballGlow.material.opacity = world.ballEnabled ? Math.min(0.8, Math.max(0, (ballSpeed - 1500) / 3000)) : 0;
    if (world.ballEnabled && ballSpeed > 2300 && this.quality !== 'low') {
      this.particles.spawn(_p.x + (Math.random() - 0.5) * 60, _p.y + (Math.random() - 0.5) * 60, _p.z + (Math.random() - 0.5) * 60,
        0, 0, 0, 0.6, 0.8, 1, 120, 0.35, { drag: 0, grow: 0.3 });
    }

    // coches
    for (const car of world.cars) {
      const rc = this.cars.get(car.id);
      if (!rc) continue;
      const m = rc.model;
      m.group.visible = !car.isDemoed;
      if (rc.label) rc.label.visible = !car.isDemoed;
      if (car.isDemoed) continue;
      session.getCarPose(car, _p, _q);
      m.group.position.copy(_p);
      m.group.quaternion.copy(_q);
      _f.set(1, 0, 0).applyQuaternion(_q);
      m._fwdSpeed = car.vel.x * _f.x + car.vel.y * _f.y + car.vel.z * _f.z;
      updateCarModel(m, car, dt);
      if (rc.label) rc.label.position.set(_p.x, _p.y, _p.z + 150);
      // estela de turbo
      if (car.isBoosting) {
        _u.set(0, 0, 1).applyQuaternion(_q);
        const nx = _p.x - _f.x * 60 + _u.x * 30, ny = _p.y - _f.y * 60 + _u.y * 30, nz = _p.z - _f.z * 60 + _u.z * 30;
        const n = this.quality === 'low' ? 1 : 3;
        for (let k = 0; k < n; k++) {
          const sp = 300 + Math.random() * 300;
          const hot = Math.random();
          this.particles.spawn(nx, ny, nz,
            -_f.x * sp + car.vel.x * 0.5 + (Math.random() - 0.5) * 80,
            -_f.y * sp + car.vel.y * 0.5 + (Math.random() - 0.5) * 80,
            -_f.z * sp + car.vel.z * 0.5 + (Math.random() - 0.5) * 80,
            1, 0.45 + hot * 0.4, 0.1 + hot * 0.2, 55 + Math.random() * 30, 0.35 + Math.random() * 0.2, { drag: 2.5, grow: 1.8 });
        }
      }
      if (car.isSupersonic && this.quality !== 'low') {
        const sc = rc.team === TEAM_BLUE ? BLUE : ORANGE;
        for (const sy of [-1, 1]) {
          _u.set(-40, sy * 38, 20).applyQuaternion(_q);
          this.particles.spawn(_p.x + _u.x, _p.y + _u.y, _p.z + _u.z, 0, 0, 0, sc.r * 0.7 + 0.3, sc.g * 0.7 + 0.3, sc.b * 0.7 + 0.3, 30, 0.3, { drag: 0, grow: 0.5 });
        }
      }
    }

    // pads
    this.animatePads(world);

    // camara
    const local = session.localCarId != null ? world.getCar(session.localCarId) : null;
    if (local && !local.isDemoed && game.phase !== 3) {
      session.getCarPose(local, _p, _q);
      _f.set(1, 0, 0).applyQuaternion(_q);
      _u.set(0, 0, 1).applyQuaternion(_q);
      session.getBallPos(_v);
      this.cam.update(dt, local, world.ballEnabled ? _v : null, _p, _f, _u);
    } else if (world.ballEnabled || !local) {
      session.getBallPos(_v);
      this.cam.updateSpectate(dt, _v);
    }
    this.particles.update(dt);
    this.shock.update(dt);
  }

  animatePads(world) {
    for (let i = 0; i < this.pads.length; i++) {
      const pv = this.pads[i];
      const active = world ? world.pads[i]?.timer <= 0 : true;
      pv.base.material = active ? pv.matOn : pv.matOff;
      if (pv.orb) {
        pv.orb.visible = active;
        pv.orb.position.z = 110 + Math.sin(this.time * 2 + i) * 12;
        pv.orb.rotation.z = this.time;
      }
      pv.glow.visible = active;
    }
  }

  handleEvents(events, game) {
    const world = game.world;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const b = world.ball.pos;
          const n = Math.min(40, 6 + e.strength / 80);
          this.particles.burst(b.x, b.y, b.z, '#fff3c4', n, 400 + e.strength * 0.2, 40, 0.35, { drag: 3 });
          if (e.strength > 1500) this.cam.shake(Math.min(25, e.strength / 150));
          break;
        }
        case 'goal': {
          const col = e.team === TEAM_BLUE ? '#3d8bff' : '#ff8a2a';
          this.particles.burst(e.x, e.y, e.z, col, 500, 2600, 160, 1.6, { drag: 1.6, gravity: -300 });
          this.particles.burst(e.x, e.y, e.z, '#ffffff', 200, 1800, 90, 1.0, { drag: 2 });
          this.shock.add(e.x, e.y, e.z, col, 2600, 1.2);
          this.shock.add(e.x, e.y, e.z, '#ffffff', 1400, 0.6);
          this.cam.shake(60);
          break;
        }
        case 'demo': {
          this.particles.burst(e.x, e.y, e.z, '#ff8a00', 160, 1300, 120, 1.0, { drag: 2.2, gravity: -200 });
          this.particles.burst(e.x, e.y, e.z, '#333333', 80, 700, 160, 1.4, { drag: 1.5, grow: 2 });
          this.shock.add(e.x, e.y, e.z, '#ffaa33', 700, 0.5);
          this.cam.shake(30);
          break;
        }
        case 'pad': {
          const car = world.getCar(e.car);
          if (car) this.particles.burst(car.pos.x, car.pos.y, car.pos.z + 30, '#ffc23a', e.big ? 40 : 10, 300, 40, 0.5, { up: 200 });
          break;
        }
        case 'bump': {
          const car = world.getCar(e.car);
          if (car) this.particles.burst(car.pos.x, car.pos.y, car.pos.z + 30, '#ffffff', 20, 500, 40, 0.3);
          break;
        }
        default: break;
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

export function goalDirectionY(team) {
  return team === TEAM_BLUE ? ARENA_EXTENT_Y : -ARENA_EXTENT_Y;
}
export { BOOST_PADS_BIG };
