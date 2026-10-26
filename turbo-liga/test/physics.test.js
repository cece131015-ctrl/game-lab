// Pruebas de la fisica compartida: comparan con valores conocidos de Rocket League / RocketSim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/shared/game.js';
import { Bot } from '../src/shared/bot.js';
import { DT, BALL_RADIUS } from '../src/shared/constants.js';
import { copyControls } from '../src/shared/car.js';
import { V3 } from '../src/shared/vec.js';
import { arenaDist } from '../src/shared/arena.js';

function freePlay() {
  const g = new Game({ freePlay: true });
  const car = g.addPlayer(1, { team: 0 });
  g.start();
  g.world.ball.reset(3500, 4500, 93); // apartar el balon
  return { g, car };
}
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(DT); };

test('el coche reposa a z=17 sobre las 4 ruedas', () => {
  const { g, car } = freePlay();
  car.placeAt(0, -3000, 30, Math.PI / 2);
  steps(g, 240);
  assert.ok(Math.abs(car.pos.z - 17) < 1.5, `z=${car.pos.z}`);
  assert.equal(car.numContacts, 4);
  assert.ok(car.vel.length() < 5);
});

test('velocidad maxima sin turbo ~1410 uu/s y con turbo 2300 uu/s', () => {
  const { g, car } = freePlay();
  car.placeAt(-3000, -4000, 17, Math.PI / 2);
  car.controls.throttle = 1;
  steps(g, 120 * 4);
  assert.ok(Math.abs(car.vel.length() - 1410) < 15, `sin turbo ${car.vel.length()}`);
  const t = freePlay();
  t.car.placeAt(-3000, -4000, 17, Math.PI / 2);
  t.car.boost = 100;
  t.car.controls.throttle = 1;
  t.car.controls.boost = true;
  let ticks = 0;
  while (t.car.vel.length() < 2299 && ticks < 600) { t.g.step(DT); ticks++; }
  assert.ok(ticks * DT < 2.2, `tarda ${ticks * DT}s en llegar a 2300`);
  assert.ok(t.car.isSupersonic);
});

test('alturas de salto: simple ~240 uu, doble ~490 uu', () => {
  const single = freePlay();
  single.car.placeAt(0, 0, 17, 0);
  steps(single.g, 60);
  let maxZ = 0;
  for (let i = 0; i < 240; i++) { single.car.controls.jump = i < 24; single.g.step(DT); maxZ = Math.max(maxZ, single.car.pos.z); }
  assert.ok(maxZ > 220 && maxZ < 265, `simple ${maxZ}`);
  const dbl = freePlay();
  dbl.car.placeAt(0, 0, 17, 0);
  steps(dbl.g, 60);
  maxZ = 0;
  for (let i = 0; i < 300; i++) { dbl.car.controls.jump = i < 24 || (i >= 30 && i < 33); dbl.g.step(DT); maxZ = Math.max(maxZ, dbl.car.pos.z); }
  assert.ok(maxZ > 450 && maxZ < 530, `doble ${maxZ}`);
});

test('el flip hacia delante gira el morro hacia abajo y empuja ~500 uu/s', () => {
  const { g, car } = freePlay();
  car.placeAt(0, -2000, 17, Math.PI / 2);
  steps(g, 30);
  for (let i = 0; i < 10; i++) { car.controls.jump = i < 4; g.step(DT); }
  car.controls.pitch = -1; car.controls.jump = true; g.step(DT);
  car.controls.jump = false;
  steps(g, 20);
  const f = car.forward(new V3());
  assert.ok(f.z < -0.3, `el morro deberia bajar (f.z=${f.z})`);
  assert.ok(car.vel.y > 400, `impulso hacia delante ${car.vel.y}`);
});

test('el balon rebota con restitucion 0.6', () => {
  const { g } = freePlay();
  const b = g.world.ball;
  b.reset(0, 0, 1000);
  let first = null;
  for (let i = 0; i < 600 && first == null; i++) { const vz = b.vel.z; g.step(DT); if (vz < 0 && b.vel.z > 0) first = { before: -vz, after: b.vel.z }; }
  assert.ok(first, 'no reboto');
  assert.ok(Math.abs(first.after / first.before - 0.6) < 0.06, `ratio ${first.after / first.before}`);
});

test('el coche sube por la pared lateral', () => {
  const { g, car } = freePlay();
  car.placeAt(2000, 0, 17, 0);
  car.controls.throttle = 1;
  let maxZ = 0;
  for (let i = 0; i < 400; i++) { g.step(DT); maxZ = Math.max(maxZ, car.pos.z); }
  assert.ok(maxZ > 700, `altura en la pared ${maxZ}`);
});

test('golpear el balon a 1410 uu/s lo lanza a mas de 1700 uu/s', () => {
  const { g, car } = freePlay();
  car.placeAt(0, -400, 17, Math.PI / 2);
  car.vel.set(0, 1410, 0);
  g.world.ball.reset(0, 0, BALL_RADIUS);
  car.controls.throttle = 1;
  let maxB = 0;
  for (let i = 0; i < 60; i++) { g.step(DT); maxB = Math.max(maxB, g.world.ball.vel.length()); }
  assert.ok(maxB > 1700 && maxB < 2600, `balon ${maxB}`);
});

test('demolicion a velocidad supersonica contra un rival', () => {
  const g = new Game({ freePlay: true });
  const a = g.addPlayer(1, { team: 0 });
  const b = g.addPlayer(2, { team: 1 });
  g.start();
  g.world.ball.reset(3000, 4000, 93);
  a.placeAt(0, -1500, 17, Math.PI / 2);
  a.vel.set(0, 2250, 0); a.isSupersonic = true; a.boost = 100;
  a.controls.throttle = 1; a.controls.boost = true;
  b.placeAt(0, 0, 17, 0);
  steps(g, 120);
  assert.ok(b.isDemoed);
});

test('gol: el balon que cruza la linea suma para el equipo correcto', () => {
  const g = new Game({ teamSize: 1 });
  g.addPlayer(1, { team: 0 });
  g.addPlayer(2, { team: 1 });
  g.start();
  g.phase = PHASE.PLAY;
  g.world.ball.reset(0, 4900, 200);
  g.world.ball.vel.set(0, 1500, 0);
  for (let i = 0; i < 120 && g.phase === PHASE.PLAY; i++) g.step(DT);
  assert.equal(g.phase, PHASE.GOAL);
  assert.deepEqual(g.score, [1, 0]);
});

test('serializar y deserializar reproduce exactamente la simulacion', () => {
  const mk = () => {
    const g = new Game({ teamSize: 2, seed: 42 });
    for (let i = 0; i < 4; i++) g.addPlayer(i + 1, { team: i % 2, carType: ['octane', 'dominus', 'breakout', 'merc'][i] });
    g.start();
    return g;
  };
  const a = mk();
  const bots = [1, 2, 3, 4].map((id) => new Bot(id, 'pro'));
  const drive = (g) => { for (const b of bots) copyControls(g.world.getCar(b.carId).controls, b.update(g, DT)); };
  for (let i = 0; i < 900; i++) { drive(a); a.step(DT); }
  const b = mk();
  b.deserialize(a.serialize([]));
  // mismos controles en ambos
  for (let i = 0; i < 240; i++) {
    for (const car of a.world.cars) { car.controls.throttle = 1; car.controls.steer = Math.sin(i / 30); }
    for (const car of b.world.cars) { car.controls.throttle = 1; car.controls.steer = Math.sin(i / 30); }
    a.step(DT); b.step(DT);
  }
  for (const car of a.world.cars) {
    const other = b.world.getCar(car.id);
    assert.ok(car.pos.distanceTo(other.pos) < 1e-6, `coche ${car.id} divergio`);
  }
  assert.ok(a.world.ball.pos.distanceTo(b.world.ball.pos) < 1e-6);
});

test('partido entre bots sin NaN, con goles y sin salir del estadio', () => {
  const g = new Game({ teamSize: 2, matchTime: 90 });
  const bots = [];
  for (let i = 0; i < 4; i++) { g.addPlayer(i, { team: i < 2 ? 0 : 1, isBot: true }); bots.push(new Bot(i, i < 2 ? 'allstar' : 'pro')); }
  g.start();
  let goals = 0;
  for (let t = 0; t < 120 * 200 && g.phase !== PHASE.ENDED; t++) {
    for (const b of bots) copyControls(g.world.getCar(b.carId).controls, b.update(g, DT));
    g.step(DT);
    for (const e of g.events) if (e.type === 'goal') goals++;
    g.events.length = 0;
    for (const c of g.world.cars) {
      assert.ok(c.pos.isFinite() && c.vel.isFinite(), 'NaN en coche');
      assert.ok(arenaDist(c.pos.x, c.pos.y, c.pos.z) > -60, `coche fuera del estadio en ${c.pos.x},${c.pos.y},${c.pos.z}`);
    }
    assert.ok(g.world.ball.pos.isFinite());
  }
  assert.ok(goals > 0, 'los bots deberian marcar algun gol');
});
