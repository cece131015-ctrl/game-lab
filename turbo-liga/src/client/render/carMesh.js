import * as THREE from 'three';
import { getCarConfig } from '../../shared/cars.js';
import { makeGlowTexture } from './textures.js';

// Perfiles laterales normalizados (x: 0 = trasera, 1 = morro; z: 0 = bajos, 1 = techo)
// body: carroceria, cabin: cristales. widths: anchura relativa de cada pieza.
const STYLES = {
  octane: {
    body: [[0, 0.2], [0, 0.62], [0.08, 0.7], [0.32, 0.72], [0.62, 0.66], [0.84, 0.5], [1, 0.42], [1, 0.16], [0.9, 0.08], [0.1, 0.08]],
    cabin: [[0.18, 0.68], [0.3, 0.98], [0.52, 1.0], [0.72, 0.66]],
    bodyW: 0.94, cabinW: 0.7, spoiler: true, scale: [1.08, 1.12, 1.18],
  },
  dominus: {
    body: [[0, 0.25], [0, 0.66], [0.15, 0.72], [0.6, 0.7], [0.88, 0.55], [1, 0.42], [1, 0.15], [0.9, 0.08], [0.06, 0.08]],
    cabin: [[0.2, 0.7], [0.36, 0.98], [0.56, 0.98], [0.74, 0.66]],
    bodyW: 0.96, cabinW: 0.68, spoiler: true, scale: [1.06, 1.1, 1.15],
  },
  plank: {
    body: [[0, 0.3], [0, 0.75], [0.25, 0.8], [0.7, 0.62], [1, 0.42], [1, 0.15], [0.9, 0.06], [0.05, 0.06]],
    cabin: [[0.28, 0.78], [0.42, 1.0], [0.58, 0.95], [0.68, 0.66]],
    bodyW: 1.0, cabinW: 0.5, spoiler: true, scale: [1.05, 1.08, 1.2],
  },
  breakout: {
    body: [[0, 0.3], [0, 0.72], [0.2, 0.78], [0.55, 0.72], [1, 0.32], [1, 0.12], [0.9, 0.06], [0.06, 0.06]],
    cabin: [[0.24, 0.76], [0.38, 1.0], [0.55, 0.98], [0.66, 0.66]],
    bodyW: 0.95, cabinW: 0.62, spoiler: true, scale: [1.05, 1.1, 1.2],
  },
  hybrid: {
    body: [[0, 0.22], [0, 0.66], [0.1, 0.72], [0.4, 0.74], [0.7, 0.62], [1, 0.46], [1, 0.15], [0.9, 0.08], [0.08, 0.08]],
    cabin: [[0.2, 0.72], [0.32, 0.98], [0.55, 0.98], [0.72, 0.62]],
    bodyW: 0.95, cabinW: 0.68, spoiler: false, scale: [1.07, 1.1, 1.15],
  },
  merc: {
    body: [[0, 0.15], [0, 0.82], [0.05, 0.88], [0.55, 0.88], [0.78, 0.7], [1, 0.55], [1, 0.12], [0.9, 0.05], [0.08, 0.05]],
    cabin: [[0.1, 0.86], [0.12, 1.0], [0.6, 1.0], [0.78, 0.7]],
    bodyW: 0.98, cabinW: 0.86, spoiler: false, scale: [1.06, 1.08, 1.1],
  },
};

function extrudeProfile(points, length, height, width, x0, z0, bevel) {
  const shape = new THREE.Shape();
  points.forEach(([px, pz], i) => {
    const x = x0 + px * length, z = z0 + pz * height;
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4,
  });
  // forma en XY (x adelante, y arriba) extruida en Z -> pasar a X adelante, Y izquierda, Z arriba
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

const glowTex = typeof document !== 'undefined' ? makeGlowTexture() : null;

// Libera geometrias, materiales y texturas de un objeto retirado de la escena.
// No toca lo compartido: la textura del brillo ni la geometria comun de los sprites.
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mm.map && mm.map !== glowTex) mm.map.dispose();
      mm.dispose();
    }
  });
}

export function buildCarModel(type, teamColor, accentColor) {
  const cfg = getCarConfig(type);
  const st = STYLES[cfg.type] || STYLES.octane;
  const [L, W, H] = cfg.hitbox;
  const [sl, sw, sh] = st.scale;
  const len = L * sl, wid = W * sw, hei = H * sh;
  const x0 = cfg.offset[0] - len / 2;
  const z0 = cfg.offset[2] - H / 2 + 2;

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: teamColor, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15,
  });
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.3, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0c1220', metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.8 });

  const bodyMesh = new THREE.Mesh(extrudeProfile(st.body, len, hei, wid * st.bodyW, x0, z0, 6), paint);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  const cabinMesh = new THREE.Mesh(extrudeProfile(st.cabin, len, hei, wid * st.cabinW, x0, z0, 5), glass);
  cabinMesh.castShadow = true;
  body.add(cabinMesh);

  // franja de color de acento a lo largo del coche
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, wid * st.bodyW + 1, hei * 0.07), accent);
  stripe.position.set(x0 + len * 0.48, 0, z0 + hei * 0.36);
  body.add(stripe);
  // bajos
  const under = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, wid * 0.8, hei * 0.12), dark);
  under.position.set(x0 + len * 0.5, 0, z0 + hei * 0.1);
  body.add(under);

  if (st.spoiler) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(14, wid * 0.95, 3), accent);
    sp.position.set(x0 + 8, 0, z0 + hei * 0.95);
    body.add(sp);
    for (const sy of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(6, 3, hei * 0.3), dark);
      leg.position.set(x0 + 9, sy * wid * 0.3, z0 + hei * 0.8);
      body.add(leg);
    }
  }
  // faros y pilotos
  const headMat = new THREE.MeshBasicMaterial({ color: '#e8f4ff' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  const frontZ = z0 + hei * (st.body.find((p) => p[0] === 1)?.[1] ?? 0.4) * 0.75;
  for (const sy of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(3, 14, 5), headMat);
    hl.position.set(x0 + len + 1, sy * wid * 0.33, frontZ);
    body.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(3, 16, 5), tailMat);
    tl.position.set(x0 - 1, sy * wid * 0.32, z0 + hei * 0.45);
    body.add(tl);
  }
  // tobera del turbo
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 12, 12), dark);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.set(x0 - 4, 0, z0 + hei * 0.35);
  body.add(nozzle);

  // llama del turbo
  const flameGeo = new THREE.ConeGeometry(11, 70, 12, 1, true);
  flameGeo.translate(0, -35, 0);
  flameGeo.rotateZ(-Math.PI / 2); // apunta hacia -X
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(x0 - 8, 0, z0 + hei * 0.35);
  flame.visible = false;
  body.add(flame);
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCore = new THREE.Mesh(flameGeo, flameCoreMat);
  flameCore.scale.set(0.45, 0.5, 0.5);
  flame.add(flameCore);
  let flameGlow = null;
  if (glowTex) {
    flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff9a3c', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    flameGlow.scale.set(90, 90, 1);
    flameGlow.position.set(-10, 0, 0);
    flame.add(flameGlow);
  }

  // ruedas
  const tireMat = new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: 0.8, roughness: 0.3 });
  const wheels = [];
  for (const w of cfg.wheels) {
    const holder = new THREE.Group(); // gira para la direccion
    const spin = new THREE.Group(); // gira con la velocidad
    const tw = w.front ? 16 : 19;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, tw, 18), tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(w.radius * 0.62, w.radius * 0.62, tw + 1, 10), rimMat);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w.radius * 1.1, tw + 2, 3), rimMat);
    spin.add(tire, rim, spoke);
    holder.add(spin);
    holder.position.set(w.offset[0], w.offset[1], w.offset[2] - w.restLength);
    group.add(holder);
    wheels.push({ holder, spin, cfg: w, angle: 0 });
  }

  return { group, body, flame, flameGlow, wheels, paint, accent, cfg };
}

export function updateCarModel(model, car, dt) {
  // ruedas: suspension, direccion y giro
  const fwdSpeed = model._fwdSpeed ?? 0;
  for (let i = 0; i < model.wheels.length; i++) {
    const wm = model.wheels[i];
    const w = wm.cfg;
    const susp = car.wheelSusp[i] ?? w.restLength;
    const targetZ = w.offset[2] - susp;
    wm.holder.position.z += (targetZ - wm.holder.position.z) * Math.min(1, dt * 25);
    if (w.front) wm.holder.rotation.z = -(car.controls.steer || 0) * 0.45;
    wm.angle += (fwdSpeed / w.radius) * dt;
    wm.spin.rotation.y = wm.angle;
  }
  // llama del turbo
  model.flame.visible = car.isBoosting && !car.isDemoed;
  if (model.flame.visible) {
    const s = 0.85 + Math.random() * 0.35;
    model.flame.scale.set(s, 1, 1);
  }
}
