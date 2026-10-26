// Efectos de sonido sintetizados con Web Audio (sin ficheros externos)
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.engine = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // buffer de ruido blanco
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._setupEngine();
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _setupEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(this.master);
    osc.start(); osc2.start();
    // turbo: ruido filtrado
    const boostSrc = ctx.createBufferSource();
    boostSrc.buffer = this.noise; boostSrc.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1400; bf.Q.value = 0.7;
    const bg = ctx.createGain(); bg.gain.value = 0;
    boostSrc.connect(bf); bf.connect(bg); bg.connect(this.master);
    boostSrc.start();
    this.engine = { osc, osc2, filter, gain, bg, bf };
  }

  updateEngine(car, active) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    if (!active || !car || car.isDemoed) {
      e.gain.gain.setTargetAtTime(0, t, 0.1);
      e.bg.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const speed = car.vel.length();
    const thr = Math.abs(car.controls.throttle);
    const f = 45 + speed * 0.055 + thr * 12;
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.filter.frequency.setTargetAtTime(350 + speed * 0.6 + thr * 300, t, 0.08);
    e.gain.gain.setTargetAtTime(0.035 + thr * 0.03 + speed / 2300 * 0.03, t, 0.08);
    e.bg.gain.setTargetAtTime(car.isBoosting ? 0.12 : 0, t, 0.04);
    e.bf.frequency.setTargetAtTime(car.isSupersonic ? 2200 : 1300, t, 0.1);
  }

  _noiseBurst(dur, freq, q, vol, type = 'bandpass') {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, vol, type = 'sine', slideTo = null, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(event, listenerPos, game) {
    if (!this.ctx) return;
    let vol = 1;
    const at = (x, y, z) => {
      if (!listenerPos) return 1;
      const d = Math.hypot(x - listenerPos.x, y - listenerPos.y, z - listenerPos.z);
      return Math.max(0.12, 1 - d / 7000);
    };
    switch (event.type) {
      case 'hit': {
        const b = game.world.ball.pos;
        vol = at(b.x, b.y, b.z) * Math.min(1, 0.25 + event.strength / 2500);
        this._noiseBurst(0.12, 900 + event.strength * 0.3, 1.2, 0.5 * vol);
        this._tone(140, 0.15, 0.4 * vol, 'sine', 60);
        break;
      }
      case 'bounce': {
        const b = game.world.ball.pos;
        vol = at(b.x, b.y, b.z) * Math.min(1, event.strength / 1500);
        this._tone(90, 0.12, 0.3 * vol, 'sine', 50);
        this._noiseBurst(0.06, 500, 1, 0.12 * vol);
        break;
      }
      case 'goal': {
        this._noiseBurst(1.4, 300, 0.5, 0.6, 'lowpass');
        this._tone(220, 1.2, 0.18, 'sawtooth');
        this._tone(277, 1.2, 0.14, 'sawtooth');
        this._tone(330, 1.2, 0.14, 'sawtooth');
        // publico
        const ctx = this.ctx, t = ctx.currentTime;
        const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 3.3);
        break;
      }
      case 'demo': {
        vol = at(event.x, event.y, event.z);
        this._noiseBurst(0.8, 200, 0.6, 0.8 * vol, 'lowpass');
        this._tone(80, 0.6, 0.5 * vol, 'sawtooth', 30);
        break;
      }
      case 'pad':
        if (event.local) this._tone(event.big ? 700 : 900, 0.12, 0.12, 'triangle', event.big ? 1400 : 1200);
        break;
      case 'jump':
      case 'flip':
        if (event.local) this._noiseBurst(0.15, 1800, 1.5, 0.12);
        break;
      case 'bump':
        this._tone(110, 0.15, 0.3, 'square', 70);
        break;
      case 'countdown':
        this._tone(600, 0.15, 0.2, 'sine');
        this._tone(600, 0.15, 0.2, 'sine', null, 1);
        this._tone(600, 0.15, 0.2, 'sine', null, 2);
        break;
      case 'go':
        this._tone(900, 0.35, 0.25, 'sine');
        break;
      case 'end':
        this._tone(330, 0.5, 0.2, 'triangle');
        this._tone(440, 0.5, 0.2, 'triangle', null, 0.25);
        this._tone(660, 0.9, 0.2, 'triangle', null, 0.5);
        break;
      default: break;
    }
  }
}
