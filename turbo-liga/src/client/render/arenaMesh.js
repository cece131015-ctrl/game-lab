import * as THREE from 'three';
import {
  ARENA_EXTENT_X, ARENA_EXTENT_Y, ARENA_HEIGHT, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_BACK_Y,
  BOOST_PADS_BIG, BOOST_PADS_SMALL,
} from '../../shared/constants.js';
import { ARENA_SHAPE } from '../../shared/arena.js';
import {
  makeFieldTexture, makeNetTexture, makeWallTexture, makeCrowdTexture, makeGlowTexture,
} from './textures.js';

const { RP, RE, PX, PY, PXC, PYC } = ARENA_SHAPE;
export const BLUE = new THREE.Color('#1f6fff');
export const ORANGE = new THREE.Color('#ff7a1a');

// Contorno en planta (cerrado) con normales hacia fuera. Incluye puntos exactos en los postes.
function buildOutline() {
  const pts = [];
  const push = (x, y, nx, ny) => pts.push({ x, y, nx, ny });
  // Un cuadrante (x>=0, y>=0), desde (0, PY+RP) hacia (PX+RP, 0)
  const quadrant = [];
  // muro de fondo: de x=0 a x=PXC
  const backXs = [0, GOAL_HALF_WIDTH * 0.5, GOAL_HALF_WIDTH, GOAL_HALF_WIDTH + 1, (GOAL_HALF_WIDTH + PXC) / 2, PXC];
  for (const x of backXs) quadrant.push([x, PY + RP, 0, 1]);
  // arco 1: centro (PXC, PY), de 90deg a 45deg
  const arc = (cx, cy, a0, a1, n) => {
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      quadrant.push([cx + Math.cos(a) * RP, cy + Math.sin(a) * RP, Math.cos(a), Math.sin(a)]);
    }
  };
  arc(PXC, PY, Math.PI / 2, Math.PI / 4, 6);
  // diagonal
  const dn = Math.SQRT1_2;
  const ax = PXC + dn * RP, ay = PY + dn * RP, bx = PX + dn * RP, by = PYC + dn * RP;
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    quadrant.push([ax + (bx - ax) * t, ay + (by - ay) * t, dn, dn]);
  }
  quadrant.push([bx, by, dn, dn]);
  // arco 2: centro (PX, PYC), de 45deg a 0deg
  arc(PX, PYC, Math.PI / 4, 0, 6);
  // muro lateral: de y=PYC a y=0
  const sideN = 8;
  for (let i = 1; i <= sideN; i++) quadrant.push([PX + RP, PYC * (1 - i / sideN), 1, 0]);

  // Montar los cuatro cuadrantes en orden (antihorario visto desde arriba)
  // Q1 (x+, y+) recorrido de fondo->lateral es horario; construimos el lazo completo:
  const q1 = quadrant; // (0,Ymax) -> (Xmax,0)  sentido horario
  const loop = [];
  // de (0, +Y) a (+X, 0): q1
  for (const p of q1) loop.push(p);
  // de (+X, 0) a (0, -Y): q1 reflejado en y, recorrido inverso
  for (let i = q1.length - 2; i >= 0; i--) { const p = q1[i]; loop.push([p[0], -p[1], p[2], -p[3]]); }
  // de (0, -Y) a (-X, 0)
  for (let i = 1; i < q1.length; i++) { const p = q1[i]; loop.push([-p[0], -p[1], -p[2], -p[3]]); }
  // de (-X, 0) a (0, +Y)
  for (let i = q1.length - 2; i >= 1; i--) { const p = q1[i]; loop.push([-p[0], p[1], -p[2], p[3]]); }
  // eliminar duplicados consecutivos
  for (const p of loop) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p[0]) < 0.01 && Math.abs(last.y - p[1]) < 0.01) continue;
    push(p[0], p[1], p[2], p[3]);
  }
  return pts; // sentido horario
}

function buildProfile() {
  // [inset, z]
  const prof = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([RE - RE * Math.sin(a), RE - RE * Math.cos(a)]);
  }
  const zs = [GOAL_HEIGHT * 0.5, GOAL_HEIGHT, 900, 1250, 1600, ARENA_HEIGHT - RE];
  for (const z of zs) prof.push([0, z]);
  for (let i = 1; i <= n; i++) {
    const a = Math.PI / 2 - (i / n) * (Math.PI / 2);
    prof.push([RE - RE * Math.sin(a), ARENA_HEIGHT - RE + RE * Math.cos(a)]);
  }
  return prof;
}

export function buildArena(renderer) {
  const group = new THREE.Group();
  const outline = buildOutline();
  const profile = buildProfile();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // --- Suelo de cesped ---
  const shape = new THREE.Shape();
  outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
  const floorGeo = new THREE.ShapeGeometry(shape);
  const pos = floorGeo.attributes.position;
  const uv = floorGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + ARENA_EXTENT_X) / (2 * ARENA_EXTENT_X), (pos.getY(i) + ARENA_EXTENT_Y) / (2 * ARENA_EXTENT_Y));
  }
  const fieldTex = makeFieldTexture(maxAniso);
  const floorMat = new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.92, metalness: 0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  group.add(floor);

  // --- Muros (barrido del perfil a lo largo del contorno) ---
  const verts = [], colors = [], uvs = [], idx = [];
  const nO = outline.length, nP = profile.length;
  let perim = [0];
  for (let i = 1; i <= nO; i++) {
    const a = outline[i - 1], b = outline[i % nO];
    perim.push(perim[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const col = new THREE.Color();
  for (let i = 0; i <= nO; i++) {
    const o = outline[i % nO];
    let s = 0;
    for (let j = 0; j < nP; j++) {
      const [inset, z] = profile[j];
      const x = o.x - o.nx * inset, y = o.y - o.ny * inset;
      verts.push(x, y, z);
      if (j > 0) s += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
      uvs.push(perim[i] / 512, s / 512);
      // color: azul en la mitad azul, naranja en la otra, mas intenso abajo
      const tY = THREE.MathUtils.clamp(y / ARENA_EXTENT_Y, -1, 1);
      col.setRGB(0.75, 0.8, 0.9);
      if (tY < 0) col.lerp(BLUE, Math.min(1, -tY * 1.4));
      else col.lerp(ORANGE, Math.min(1, tY * 1.4));
      colors.push(col.r, col.g, col.b);
    }
  }
  const inGoalMouth = (x, y, z) => Math.abs(x) < GOAL_HALF_WIDTH + 0.5 && z < GOAL_HEIGHT + 0.5 && Math.abs(y) > ARENA_EXTENT_Y - RE - 5;
  for (let i = 0; i < nO; i++) {
    for (let j = 0; j < nP - 1; j++) {
      const a = i * nP + j, b = (i + 1) * nP + j, c = (i + 1) * nP + j + 1, d = i * nP + j + 1;
      const cx = (verts[a * 3] + verts[b * 3] + verts[c * 3] + verts[d * 3]) / 4;
      const cy = (verts[a * 3 + 1] + verts[b * 3 + 1] + verts[c * 3 + 1] + verts[d * 3 + 1]) / 4;
      const cz = (verts[a * 3 + 2] + verts[b * 3 + 2] + verts[c * 3 + 2] + verts[d * 3 + 2]) / 4;
      if (inGoalMouth(cx, cy, cz)) continue;
      // contorno horario -> caras mirando hacia dentro
      idx.push(a, b, c, a, c, d);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  wallGeo.setIndex(idx);
  wallGeo.computeVertexNormals();
  const wallTex = makeWallTexture();
  const wallMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: wallTex, transparent: true, opacity: 0.32, roughness: 0.3, metalness: 0.1,
    side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color('#223355'), emissiveIntensity: 0.25,
  });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.renderOrder = 2;
  group.add(walls);

  // franja luminosa en la base de los muros
  const stripPts = outline.map((o) => new THREE.Vector3(o.x - o.nx * 2, o.y - o.ny * 2, RE + 30));
  stripPts.push(stripPts[0].clone());
  const stripGeo = new THREE.BufferGeometry().setFromPoints(stripPts);
  const stripCols = [];
  for (const p of stripPts) {
    const c = p.y < 0 ? BLUE : ORANGE;
    stripCols.push(c.r, c.g, c.b);
  }
  stripGeo.setAttribute('color', new THREE.Float32BufferAttribute(stripCols, 3));
  group.add(new THREE.Line(stripGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));

  // --- Porterias ---
  const netTex = makeNetTexture();
  for (const side of [-1, 1]) {
    const teamCol = side < 0 ? BLUE : ORANGE;
    const g = new THREE.Group();
    const depth = GOAL_BACK_Y - ARENA_EXTENT_Y;
    const netMat = new THREE.MeshBasicMaterial({
      map: netTex.clone(), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: teamCol.clone().lerp(new THREE.Color('#ffffff'), 0.5),
    });
    netMat.map.wrapS = netMat.map.wrapT = THREE.RepeatWrapping;
    const mk = (w, h, rx, ry) => {
      const m = netMat.clone();
      m.map = netTex.clone();
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      m.map.repeat.set(rx, ry);
      m.map.needsUpdate = true;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    };
    const yMid = side * (ARENA_EXTENT_Y + depth / 2);
    const back = mk(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 18, 7);
    back.position.set(0, side * GOAL_BACK_Y, GOAL_HEIGHT / 2);
    back.rotation.x = Math.PI / 2;
    g.add(back);
    const top = mk(GOAL_HALF_WIDTH * 2, depth, 18, 9);
    top.position.set(0, yMid, GOAL_HEIGHT);
    g.add(top);
    for (const sx of [-1, 1]) {
      const sideNet = mk(depth, GOAL_HEIGHT, 9, 7);
      sideNet.position.set(sx * GOAL_HALF_WIDTH, yMid, GOAL_HEIGHT / 2);
      sideNet.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      g.add(sideNet);
    }
    // suelo de la porteria
    const gFloor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, depth),
      new THREE.MeshStandardMaterial({ color: '#1e5a24', roughness: 1 }));
    gFloor.position.set(0, yMid, 0.5);
    gFloor.receiveShadow = true;
    g.add(gFloor);
    // marco
    const frameMat = new THREE.MeshStandardMaterial({ color: teamCol, emissive: teamCol, emissiveIntensity: 0.9, roughness: 0.4 });
    const postR = 18;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, GOAL_HEIGHT, 12), frameMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(sx * (GOAL_HALF_WIDTH + postR), side * (ARENA_EXTENT_Y + postR), GOAL_HEIGHT / 2);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, GOAL_HALF_WIDTH * 2 + postR * 4, 12), frameMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, side * (ARENA_EXTENT_Y + postR), GOAL_HEIGHT + postR);
    g.add(bar);
    // luz de porteria
    const light = new THREE.PointLight(teamCol, 2.5, 2600, 1.6);
    light.position.set(0, side * (ARENA_EXTENT_Y + 300), GOAL_HEIGHT + 200);
    g.add(light);
    group.add(g);
  }

  // --- Pads de turbo ---
  const pads = [];
  const glowTex = makeGlowTexture();
  const padBaseGeoBig = new THREE.CylinderGeometry(150, 170, 10, 24);
  const padBaseGeoSmall = new THREE.CylinderGeometry(70, 80, 8, 16);
  padBaseGeoBig.rotateX(Math.PI / 2);
  padBaseGeoSmall.rotateX(Math.PI / 2);
  const padMatOn = new THREE.MeshStandardMaterial({ color: '#ffb000', emissive: '#ff9500', emissiveIntensity: 1.2 });
  const padMatOff = new THREE.MeshStandardMaterial({ color: '#4a3a20', emissive: '#000000' });
  const orbGeo = new THREE.SphereGeometry(55, 20, 14);
  const orbMat = new THREE.MeshStandardMaterial({ color: '#ffcc33', emissive: '#ff8a00', emissiveIntensity: 1.6, roughness: 0.3 });
  const allPads = [...BOOST_PADS_BIG.map((p) => [...p, true]), ...BOOST_PADS_SMALL.map((p) => [...p, false])];
  for (const [x, y, big] of allPads) {
    const base = new THREE.Mesh(big ? padBaseGeoBig : padBaseGeoSmall, padMatOn);
    base.position.set(x, y, 4);
    group.add(base);
    let orb = null, glow = null;
    if (big) {
      orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(x, y, 110);
      group.add(orb);
    }
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffaa22', transparent: true, opacity: big ? 0.7 : 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(big ? 420 : 200, big ? 420 : 200, 1);
    glow.position.set(x, y, big ? 110 : 20);
    group.add(glow);
    pads.push({ base, orb, glow, big, matOn: padMatOn, matOff: padMatOff });
  }

  // --- Estadio exterior: gradas, focos y suelo ---
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: '#0d0f16', roughness: 1 }));
  outside.position.z = -60;
  group.add(outside);
  const crowdTex = makeCrowdTexture();
  const standMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 1, emissive: '#111', emissiveMap: crowdTex, emissiveIntensity: 0.35 });
  const standW = 2600;
  for (const [cx, cy, w, h, rot] of [
    [ARENA_EXTENT_X + 1100 + standW / 2, 0, ARENA_EXTENT_Y * 2 + 2000, standW, Math.PI / 2],
    [-(ARENA_EXTENT_X + 1100 + standW / 2), 0, ARENA_EXTENT_Y * 2 + 2000, standW, -Math.PI / 2],
    [0, GOAL_BACK_Y + 900 + standW / 2, ARENA_EXTENT_X * 2 + 3000, standW, Math.PI],
    [0, -(GOAL_BACK_Y + 900 + standW / 2), ARENA_EXTENT_X * 2 + 3000, standW, 0],
  ]) {
    const geo = new THREE.PlaneGeometry(w, Math.hypot(standW, 1800));
    const m = standMat.clone();
    m.map = crowdTex.clone(); m.map.repeat.set(w / 900, 3); m.map.needsUpdate = true;
    m.emissiveMap = m.map;
    const stand = new THREE.Mesh(geo, m);
    // grada inclinada: primero se inclina sobre X y luego se orienta hacia el centro (Z)
    stand.position.set(cx, cy, 900);
    stand.rotation.order = 'ZYX';
    stand.rotation.set(-Math.atan2(1800, standW), 0, rot);
    group.add(stand);
  }
  // torres de focos
  const towerMat = new THREE.MeshStandardMaterial({ color: '#2a2d36' });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6e0' });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const tx = sx * (ARENA_EXTENT_X + 2600), ty = sy * (ARENA_EXTENT_Y + 2600);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(160, 160, 4200), towerMat);
    tower.position.set(tx, ty, 2100);
    group.add(tower);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(700, 120, 380), lampMat);
    lamp.position.set(tx, ty, 4300);
    lamp.lookAt(0, 0, 0);
    group.add(lamp);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2cc', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(2200, 2200, 1);
    glow.position.set(tx, ty, 4300);
    group.add(glow);
  }

  return { group, pads };
}
