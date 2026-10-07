// Geometria del estadio como campo de distancia con signo (SDF).
// dist(p) > 0 dentro del espacio libre (distancia a la pared mas cercana), < 0 dentro de los muros.
import {
  ARENA_EXTENT_X, ARENA_EXTENT_Y, ARENA_HEIGHT, ARENA_CORNER_SUM, ARENA_PLAN_ROUND, ARENA_EDGE_ROUND,
  GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_BACK_Y,
} from './constants.js';

const RP = ARENA_PLAN_ROUND;
const RE = ARENA_EDGE_ROUND;
const PX = ARENA_EXTENT_X - RP;
const PY = ARENA_EXTENT_Y - RP;
const PK = ARENA_CORNER_SUM - RP * Math.SQRT2;
const PXC = PK - PY; // x donde el muro de fondo se une a la diagonal
const PYC = PK - PX; // y donde el muro lateral se une a la diagonal
const INV_SQRT2 = Math.SQRT1_2;

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t), ey = py - (ay + dy * t);
  return Math.sqrt(ex * ex + ey * ey);
}

// Distancia con signo (negativa dentro) al contorno en planta (octogono con esquinas redondeadas)
export function planSD(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  const d1 = ax - PX, d2 = ay - PY, d3 = (ax + ay - PK) * INV_SQRT2;
  const m = Math.max(d1, d2, d3);
  if (m <= 0) return m - RP;
  const a = segDist(ax, ay, PX, 0, PX, PYC);
  const b = segDist(ax, ay, PX, PYC, PXC, PY);
  const c = segDist(ax, ay, PXC, PY, 0, PY);
  return Math.min(a, b, c) - RP;
}

function arenaF(x, y, z) {
  const dPlan = planSD(x, y);
  const dVert = Math.max(-z, z - ARENA_HEIGHT);
  const qa = dPlan + RE, qb = dVert + RE;
  const ma = qa > 0 ? qa : 0, mb = qb > 0 ? qb : 0;
  return Math.sqrt(ma * ma + mb * mb) + Math.min(Math.max(qa, qb), 0) - RE;
}

function goalF(x, y, z) {
  const gx = Math.abs(x) - GOAL_HALF_WIDTH;
  const gy = Math.abs(y) - GOAL_BACK_Y;
  const gyIn = 4600 - Math.abs(y);
  const gz = z - GOAL_HEIGHT;
  return Math.max(gx, gy, gyIn, gz, -z);
}

export function arenaDist(x, y, z) {
  return -Math.min(arenaF(x, y, z), goalF(x, y, z));
}

const H = 0.5;
// Normal (apuntando al espacio libre) en el punto dado. Escribe en out.
export function arenaNormal(x, y, z, out) {
  const nx = arenaDist(x + H, y, z) - arenaDist(x - H, y, z);
  const ny = arenaDist(x, y + H, z) - arenaDist(x, y - H, z);
  const nz = arenaDist(x, y, z + H) - arenaDist(x, y, z - H);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (l < 1e-9) return out.set(0, 0, 1);
  return out.set(nx / l, ny / l, nz / l);
}

// Lanza un rayo desde (o) en direccion (d) normalizada hasta maxT. Devuelve t del impacto o -1.
export function arenaRaycast(o, d, maxT) {
  let t = 0;
  for (let i = 0; i < 16; i++) {
    const s = arenaDist(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    if (s < 0.25) return t < 0 ? 0 : t;
    t += s;
    if (t > maxT) return -1;
  }
  return t <= maxT ? t : -1;
}

// Exportado para generar la malla del estadio en el cliente
export const ARENA_SHAPE = { RP, RE, PX, PY, PK, PXC, PYC };
