// Configuracion de los tipos de coche (hitbox, ruedas y suspension).
// Datos de RocketSim (MIT) que reproducen la matriz de inercia real del juego.

const BASE = {
  octane: {
    name: 'Octane',
    hitbox: [120.507, 86.6994, 38.6591],
    offset: [13.8757, 0, 20.755],
    frontRadius: 12.5, backRadius: 15,
    frontRest: 38.755, backRest: 37.055,
    frontOffset: [51.25, 25.9, 20.755],
    backOffset: [-33.75, 29.5, 20.755],
  },
  dominus: {
    name: 'Dominus',
    hitbox: [130.427, 85.7799, 33.8],
    offset: [9, 0, 15.75],
    frontRadius: 12, backRadius: 13.5,
    frontRest: 33.95, backRest: 33.85,
    frontOffset: [50.3, 31.1, 15.75],
    backOffset: [-34.75, 33, 15.75],
  },
  plank: {
    name: 'Batmobile',
    hitbox: [131.32, 87.1704, 31.8944],
    offset: [9.00857, 0, 12.0942],
    frontRadius: 12.5, backRadius: 17,
    frontRest: 31.9242, backRest: 27.9242,
    frontOffset: [49.97, 27.8, 12.0942],
    backOffset: [-35.43, 20.28, 12.0942],
  },
  breakout: {
    name: 'Breakout',
    hitbox: [133.992, 83.021, 32.8],
    offset: [12.5, 0, 11.75],
    frontRadius: 13.5, backRadius: 15,
    frontRest: 29.7, backRest: 29.666,
    frontOffset: [51.5, 26.67, 11.75],
    backOffset: [-35.75, 35, 11.75],
  },
  hybrid: {
    name: 'Venom',
    hitbox: [129.519, 84.6879, 36.6591],
    offset: [13.8757, 0, 20.755],
    frontRadius: 12.5, backRadius: 15,
    frontRest: 38.755, backRest: 37.055,
    frontOffset: [51.25, 25.9, 20.755],
    backOffset: [-34, 29.5, 20.755],
  },
  merc: {
    name: 'Merc',
    hitbox: [123.22, 79.2103, 44.1591],
    offset: [11.3757, 0, 21.505],
    frontRadius: 15, backRadius: 15,
    frontRest: 39.505, backRest: 39.105,
    frontOffset: [51.25, 25.9, 21.505],
    backOffset: [-33.75, 29.5, 21.505],
  },
};

export const CAR_TYPES = Object.keys(BASE);

const cache = {};

export function getCarConfig(type) {
  if (!BASE[type]) type = 'octane';
  if (cache[type]) return cache[type];
  const b = BASE[type];
  const [L, W, H] = b.hitbox;
  // Inercia de una caja por unidad de masa (uu^2). Ejes locales: X adelante, Y izquierda, Z arriba.
  const inertia = [(W * W + H * H) / 12, (L * L + H * H) / 12, (L * L + W * W) / 12];
  const wheels = [];
  // Orden: delantera izq, delantera der, trasera izq, trasera der
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const left = i % 2 === 0;
    const off = front ? b.frontOffset : b.backOffset;
    const rest = (front ? b.frontRest : b.backRest) - 12; // MAX_SUSPENSION_TRAVEL
    const radius = front ? b.frontRadius : b.backRadius;
    const scale = front ? 35.75 : 54.265;
    wheels.push({
      front,
      offset: [off[0], left ? off[1] : -off[1], off[2]],
      radius,
      restLength: rest,
      // aceleracion (uu/s^2) por uu de compresion y por uu/s
      k: (500 * scale) / 180,
      cComp: (25 * scale) / 180,
      cRelax: (40 * scale) / 180,
    });
  }
  const wheelBase = b.frontOffset[0] - b.backOffset[0];
  const cfg = {
    type,
    name: b.name,
    hitbox: b.hitbox,
    half: [L / 2, W / 2, H / 2],
    offset: b.offset,
    inertia,
    invInertia: inertia.map((v) => 1 / v),
    wheels,
    wheelBase,
  };
  cache[type] = cfg;
  return cfg;
}
