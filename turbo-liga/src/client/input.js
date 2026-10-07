// Teclado, raton y mando (Gamepad API, distribucion estandar tipo Xbox)
import { emptyControls } from '../shared/car.js';

const DEADZONE = 0.12;
const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.controls = emptyControls();
    this.enabled = true;
    this.listeners = {};
    this.padPrev = [];
    this.usingPad = false;
    this.touch = null;

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.emit('press', e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.emit('release', e.code);
    });
    // al perder el foco no llegan los keyup: soltar todo (pulsar para hablar, marcador...)
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.releaseAll(); });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, code) { for (const fn of this.listeners[ev] || []) fn(code); }

  k(...codes) { return codes.some((c) => this.keys.has(c)); }

  releaseAll() {
    const held = [...this.keys];
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
    for (const code of held) this.emit('release', code);
    this.emit('release', 'PadBack');
  }

  // Lee los mandos y emite los botones de una pulsacion (tambien con los menus abiertos).
  // Devuelve el mando que conduce, o null.
  _pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let drive = null;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const prev = this.padPrev[gp.index] || [];
      const pressed = gp.buttons.map((x) => x.pressed);
      this.padPrev[gp.index] = pressed;
      const edge = (i) => pressed[i] && !prev[i];
      if (edge(3)) this.emit('press', 'PadY');
      if (edge(9)) this.emit('press', 'PadStart');
      if (edge(8)) this.emit('press', 'PadBack');
      if (!pressed[8] && prev[8]) this.emit('release', 'PadBack');
      if (drive) continue;
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      const any = Math.abs(lx) + Math.abs(ly) + rt + lt > 0.05 || pressed.some(Boolean);
      if (any) this.usingPad = true;
      if (this.usingPad) drive = gp;
    }
    return drive;
  }

  poll() {
    const c = this.controls;
    const gp = this._pollPads();
    if (!this.enabled) {
      c.throttle = c.steer = c.pitch = c.yaw = c.roll = 0;
      c.jump = c.boost = c.handbrake = false;
      return c;
    }
    // --- Teclado ---
    const fwd = this.k('KeyW', 'ArrowUp') ? 1 : 0;
    const back = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    const left = this.k('KeyA', 'ArrowLeft') ? 1 : 0;
    const right = this.k('KeyD', 'ArrowRight') ? 1 : 0;
    const airRoll = this.k('ControlLeft', 'KeyX', 'ControlRight');
    c.throttle = fwd - back;
    c.steer = right - left;
    c.pitch = back - fwd; // S = morro arriba
    c.yaw = airRoll ? 0 : c.steer;
    c.roll = airRoll ? c.steer : 0;
    if (this.k('KeyQ')) c.roll = -1;
    if (this.k('KeyE')) c.roll = 1;
    c.jump = this.k('Space') || this.mouse.right;
    c.boost = this.k('ShiftLeft', 'ShiftRight') || this.mouse.left;
    c.handbrake = airRoll;

    // --- Tactil ---
    const t = this.touch;
    if (t && t.active) {
      c.throttle = t.throttle; c.steer = t.steer;
      c.pitch = -t.throttle; c.yaw = t.drift ? 0 : t.steer; c.roll = t.drift ? t.steer : 0;
      c.jump = t.jump; c.boost = t.boost; c.handbrake = t.drift;
    }

    // --- Mando ---
    if (gp) {
      const b = (i) => gp.buttons[i]?.pressed || (gp.buttons[i]?.value || 0) > 0.5;
      const bv = (i) => gp.buttons[i]?.value || 0;
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
      const rt = bv(7), lt = bv(6);
      const padAirRoll = b(2);
      c.throttle = rt - lt;
      c.steer = lx;
      c.pitch = ly; // stick hacia delante = morro abajo
      c.yaw = padAirRoll ? 0 : lx;
      c.roll = padAirRoll ? lx : 0;
      if (b(4)) c.roll = -1;
      if (b(5)) c.roll = 1;
      c.jump = b(0);
      c.boost = b(1);
      c.handbrake = padAirRoll;
    }
    return c;
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
