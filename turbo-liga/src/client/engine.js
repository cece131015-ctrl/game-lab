// Motor del juego sin interfaz: renderizado 3D, sesiones (bots, entrenamiento, online), salas,
// voz y teclado. La interfaz React lee `engine.store` y llama a sus acciones.
import { GameRenderer } from './render/scene.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { LocalSession } from './localSession.js';
import { NetClient, OnlineSession } from './net.js';
import { Voice } from './voice.js';
import { createLocalHost } from './localHost.js';
import { joinP2P } from './p2p.js';
import { loadSettings, saveSettings } from './settings.js';
import { createStore } from './store.js';
import { PHASE } from '../shared/game.js';
import { TEAM_BLUE } from '../shared/constants.js';

const P2P_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];

export function formatClock(t, overtime) {
  const s = Math.max(0, overtime ? Math.floor(t) : Math.ceil(t));
  const m = Math.floor(s / 60);
  return `${overtime ? '+' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

let uid = 1;

export class Engine {
  constructor(viewEl) {
    this.params = new URLSearchParams(location.search);
    this.settings = loadSettings();
    this.renderer = new GameRenderer(viewEl, this.params.get('calidad') || this.settings.quality);
    this.input = new Input(viewEl);
    this.audio = new GameAudio();
    this.audio.setVolume(this.settings.volume);
    this.session = null;
    this.net = null;
    this.room = null;
    this.voice = null;
    this.localHost = null;
    this.screenStack = [];
    this.lastRoster = -1;
    this.endTimer = null;
    this.msgTimer = 0;
    this.lastCountdown = -1;
    this.fps = 0;
    this.serverCheck = null;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (this.isTouch) this.input.touch = { active: false, steer: 0, throttle: 0, jump: false, boost: false, drift: false };

    this.store = createStore({
      screen: 'main',
      settings: this.snapshotSettings(),
      inGame: false,
      sessionKind: null,
      online: { status: '', modeHint: '', busy: false },
      invite: this.params.get('sala') ? this.params.get('sala').toUpperCase().slice(0, 6) : '',
      room: null,
      selfId: null,
      isLocalHost: false,
      voice: { active: false, micOn: false, muted: false, ptt: false, error: '', connected: 0, hasTrack: false },
      speaking: {},
      micLevel: 0,
      lobbyChat: [],
      hud: this.emptyHud(),
      feed: [],
      gameChat: [],
      chatOpen: false,
      statsOpen: false,
      statsPlayers: [],
      voiceList: [],
      end: null,
      toast: null,
      isTouch: this.isTouch,
    });

    this.applyCameraSettings();
    this.bindKeys();
    window.__turbo = this.debugApi();
    this.lastT = performance.now();
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.slowTimer = 0;
    requestAnimationFrame((t) => this.frame(t));
    if (this.store.get().invite) {
      this.nav('online');
      this.setStatus('Te han invitado a una sala: pulsa "Unirse"');
    }
  }

  debugApi() {
    const e = this;
    return {
      get session() { return e.session; }, get voice() { return e.voice; }, get room() { return e.room; },
      get net() { return e.net; }, renderer: e.renderer, engine: e,
    };
  }

  snapshotSettings() {
    return { ...this.settings, colors: { ...this.settings.colors } };
  }

  emptyHud() {
    return { blue: 0, orange: 0, clock: '5:00', ot: false, boost: 0, speed: 0, meters: false, fps: '', msg: '', msgCls: '', msgSub: '', msgKey: 0, hint: '' };
  }

  // =========================================================== Navegacion
  nav(screen, push = true) {
    const s = this.store.get();
    if (push && s.screen && s.screen !== screen) this.screenStack.push(s.screen);
    this.store.set({ screen });
    if (screen === 'garage') this.renderer.setPreview(this.settings.carType, this.settings.colors);
    else this.renderer.clearPreview();
    if (screen === 'online') {
      this.hasServer().then((srv) => {
        this.patch('online', {
          modeHint: srv
            ? 'Conectado al servidor de salas.'
            : 'Modo sin servidor: quien crea la sala hace de anfitrión desde su navegador y los demás se conectan directamente (hace falta internet).',
        });
      });
    }
    this.input.enabled = false;
  }

  back() {
    const prev = this.screenStack.pop();
    if (prev === 'pause' && this.session) { this.nav('pause', false); return; }
    if (!prev && this.session) { this.nav('pause', false); return; }
    this.nav(prev || 'main', false);
  }

  hideMenu() {
    this.store.set({ screen: null });
    this.renderer.clearPreview();
    this.input.enabled = !this.store.get().chatOpen;
  }

  patch(key, obj) {
    this.store.set({ [key]: { ...this.store.get()[key], ...obj } });
  }

  toast(text, ms = 2500) {
    const id = uid++;
    this.store.set({ toast: { text, id } });
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { if (this.store.get().toast?.id === id) this.store.set({ toast: null }); }, ms);
  }

  // =========================================================== Ajustes
  updateSettings(patch) {
    Object.assign(this.settings, patch);
    if (patch.colors) this.settings.colors = { ...this.settings.colors, ...patch.colors };
    saveSettings(this.settings);
    this.store.set({ settings: this.snapshotSettings() });
    this.applyCameraSettings();
    if ('volume' in patch) this.audio.setVolume(this.settings.volume);
    if ('voiceVolume' in patch) this.voice?.setVolume(this.settings.voiceVolume);
    if ('micMode' in patch) this.voice?.setPtt(this.settings.micMode === 'ptt');
    if ('ballCam' in patch && this.session) this.renderer.cam.ballCam = this.settings.ballCam;
    if ('micDeviceId' in patch && this.voice) this.voice.enableMic(this.settings.micDeviceId).then(() => this.sendMicState());
    if ('carType' in patch || 'colors' in patch) {
      if (this.store.get().screen === 'garage') this.renderer.setPreview(this.settings.carType, this.settings.colors);
      this.sendProfile();
    }
    if ('name' in patch) this.sendProfile();
  }

  applyCameraSettings() {
    const cs = this.renderer.cam.settings;
    cs.fov = this.settings.fov;
    cs.distance = this.settings.distance;
    cs.shake = this.settings.shake;
    this.renderer.resize();
  }

  async listMicDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      if (this.settings.micDeviceId && devs.some((d) => d.deviceId) && !devs.some((d) => d.deviceId === this.settings.micDeviceId)) {
        this.updateSettings({ micDeviceId: '' });
      }
      return devs.map((d, i) => ({ id: d.deviceId, label: d.label || `Micrófono ${i + 1}` }));
    } catch { return []; }
  }

  playerProfile() {
    return { name: this.settings.name, carType: this.settings.carType, colors: this.settings.colors };
  }

  // =========================================================== Partidas
  startSession(s) {
    if (this.session) this.session.destroy();
    this.session = s;
    this.lastRoster = -1;
    clearTimeout(this.endTimer);
    this.renderer.cam.ballCam = this.settings.ballCam;
    this.renderer.cam.reset();
    this.audio.ensure();
    this.screenStack = [];
    this.lastCountdown = -1;
    this.store.set({
      inGame: true, sessionKind: s.kind, end: null, statsOpen: false, feed: [], gameChat: [],
      hud: { ...this.emptyHud(), hint: s.kind === 'freeplay' ? 'R: recolocar balón · F: recolocar coche · C: cámara balón · Esc: menú' : '' },
    });
    this.hideMenu();
  }

  endSession() {
    if (this.session) this.session.destroy();
    this.session = null;
    this.renderer.clearCars();
    clearTimeout(this.endTimer);
    this.store.set({ inGame: false, sessionKind: null, statsOpen: false, chatOpen: false, voiceList: [] });
  }

  startBots({ teamSize = 1, difficulty = 'pro', matchTime = 300, team = 0 } = {}) {
    this.startSession(new LocalSession({ teamSize, difficulty, matchTime, team, player: this.playerProfile() }));
  }

  startFreePlay() {
    this.startSession(new LocalSession({ freePlay: true, unlimitedBoost: true, player: this.playerProfile() }));
  }

  pause() {
    if (!this.session) return;
    if (!this.session.online) this.session.paused = true;
    this.nav('pause', false);
    this.screenStack = [];
  }

  resume() {
    if (!this.session) return;
    this.session.paused = false;
    this.hideMenu();
    this.screenStack = [];
  }

  restart() {
    if (!this.session || this.session.online) return;
    clearTimeout(this.endTimer);
    this.session.restart();
    this.session.paused = false;
    this.lastRoster = -1;
    this.lastCountdown = -1;
    this.renderer.cam.reset();
    this.store.set({ statsOpen: false, end: null, feed: [] });
    this.hideMenu();
    this.screenStack = [];
  }

  quit() {
    const wasOnline = this.session?.online;
    this.endSession();
    if (wasOnline && this.room) this.leaveRoom();
    this.nav('main', false);
    this.screenStack = [];
  }

  showEnd(winner, score) {
    const s = this.session;
    if (!s) return;
    const me = s.localCarId != null ? s.game.players.get(s.localCarId) : null;
    const won = me ? me.team === winner : null;
    const isHost = !s.online || (this.room && this.net && this.room.host === this.net.id);
    this.store.set({
      end: {
        title: won == null ? (winner === TEAM_BLUE ? 'Gana el equipo Azul' : 'Gana el equipo Naranja') : won ? '¡VICTORIA!' : 'Derrota',
        won, score: [...score], players: this.statsSnapshot(), localId: s.localCarId, isHost, online: !!s.online,
      },
    });
    this.nav('end', false);
    this.screenStack = [];
  }

  rematch() {
    if (!this.session) return;
    if (this.session.online) this.net?.send({ t: 'rematch' });
    else this.restart();
  }

  endMenu() {
    if (this.session?.online) {
      if (this.room && this.net && this.room.host === this.net.id) this.net.send({ t: 'toLobby' });
      else { this.endSession(); this.leaveRoom(); this.nav('main', false); }
    } else {
      this.endSession();
      this.nav('main', false);
    }
  }

  statsSnapshot() {
    if (!this.session) return [];
    return this.session.game.playerList().map((p) => ({
      id: p.id, name: p.name, team: p.team, points: p.points, goals: p.goals, assists: p.assists, saves: p.saves, shots: p.shots, demos: p.demos,
    }));
  }

  toggleBallCam() {
    if (!this.session) return;
    this.renderer.cam.ballCam = !this.renderer.cam.ballCam;
    this.toast(this.renderer.cam.ballCam ? 'Cámara balón: ON' : 'Cámara balón: OFF', 1000);
  }

  // =========================================================== Teclas
  bindKeys() {
    this.input.on('press', (code) => {
      if (this.store.get().chatOpen) return;
      const screen = this.store.get().screen;
      switch (code) {
        case 'Escape':
        case 'PadStart':
          if (!this.session) { if (screen !== 'main' && screen !== 'lobby') this.back(); return; }
          if (screen === null) this.pause();
          else if (screen === 'pause') this.resume();
          else if (screen !== 'end') this.back();
          break;
        case 'KeyC':
        case 'PadY':
          this.toggleBallCam();
          break;
        case 'Tab':
        case 'PadBack':
          if (this.session) this.store.set({ statsOpen: true, statsPlayers: this.statsSnapshot() });
          break;
        case 'KeyM':
          if (this.voice) this.toggleMute();
          break;
        case 'KeyV':
          if (this.voice) this.voice.setPttDown(true);
          break;
        case 'KeyR':
          if (this.session?.kind === 'freeplay') this.session.resetBall();
          break;
        case 'KeyF':
          if (this.session?.kind === 'freeplay') this.session.resetCar();
          break;
        case 'KeyT':
        case 'Enter':
          if (this.session?.online && screen === null) this.setChatOpen(true);
          break;
        default: break;
      }
    });
    this.input.on('release', (code) => {
      if (code === 'Tab' || code === 'PadBack') this.store.set({ statsOpen: false });
      if (code === 'KeyV' && this.voice) this.voice.setPttDown(false);
    });
  }

  setChatOpen(open) {
    this.store.set({ chatOpen: open });
    this.input.enabled = !open && this.store.get().screen === null;
  }

  sendChat(text) {
    const t = String(text || '').trim();
    if (t && this.net) this.net.send({ t: 'chat', text: t });
  }

  // =========================================================== Bucle principal
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsAcc); this.fpsAcc = 0; this.fpsFrames = 0; }

    const controls = this.input.poll();
    const s = this.session;
    if (s) {
      s.update(dt, controls);
      if (s.rosterVersion !== this.lastRoster) {
        this.lastRoster = s.rosterVersion;
        this.renderer.setRoster(s.players, s.localCarId);
      }
      const events = s.drainEvents();
      if (events.length) {
        this.renderer.handleEvents(events, s.game);
        const me = s.localCarId != null ? s.game.world.getCar(s.localCarId) : null;
        for (const e of events) {
          this.audio.play(e, me ? me.pos : this.renderer.camera.position, s.game);
          this.onGameEvent(e);
          if (e.type === 'end') {
            this.endTimer = setTimeout(() => { if (this.session === s) this.showEnd(e.winner, e.score); }, 2500);
          }
        }
      }
      this.updateHud(dt);
      const me = s.localCarId != null ? s.game.world.getCar(s.localCarId) : null;
      this.audio.updateEngine(me, !s.paused && s.game.phase !== PHASE.ENDED);
    } else {
      this.audio.updateEngine(null, false);
    }
    this.renderer.update(dt, s);
    this.renderer.render();

    // actualizaciones de interfaz menos frecuentes (voz, marcador abierto, chat)
    this.slowTimer += dt;
    if (this.slowTimer > 0.1) {
      this.slowTimer = 0;
      this.slowUpdate();
    }
  }

  slowUpdate() {
    const st = this.store.get();
    if (this.voice) {
      const level = Math.round(Math.min(1, this.voice.localLevel * 6) * 20) / 20;
      if (level !== st.micLevel) this.store.set({ micLevel: level });
      if (this.session && this.room) {
        const list = this.room.members.map((m) => ({
          id: m.id, name: m.name, team: m.team,
          mic: m.id === this.net?.id ? this.voice.micOn : m.mic,
          speaking: this.voice.isSpeaking(m.id),
        }));
        if (JSON.stringify(list) !== JSON.stringify(st.voiceList)) this.store.set({ voiceList: list });
      }
    }
    if (st.statsOpen && this.session) this.store.set({ statsPlayers: this.statsSnapshot() });
    const now = performance.now();
    // el feed caduca a los 5 s y el chat del partido se desvanece a los 9 s
    if (st.feed.length && st.feed.some((f) => now - f.t > 5000)) this.store.set({ feed: st.feed.filter((f) => now - f.t <= 5000) });
    if (st.gameChat.some((c) => !c.old && now - c.t > 9000)) {
      this.store.set({ gameChat: st.gameChat.map((c) => (!c.old && now - c.t > 9000 ? { ...c, old: true } : c)) });
    }
  }

  flash(text, cls = '', sub = '', time = 1.2) {
    this.msgTimer = time;
    this._msg = { msg: text, msgCls: cls, msgSub: sub, msgKey: uid++ };
  }

  updateHud(dt) {
    const s = this.session;
    const game = s.game;
    if (game.phase === PHASE.COUNTDOWN) {
      const n = Math.ceil(game.phaseTimer);
      if (n !== this.lastCountdown && n > 0 && n <= 3) {
        this.lastCountdown = n;
        this.flash(String(n), '', game.overtime ? 'PRÓRROGA · el próximo gol gana' : '', 1.1);
      }
    } else {
      this.lastCountdown = -1;
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this._msg = { msg: '', msgCls: '', msgSub: '', msgKey: this._msg?.msgKey || 0 };
    }
    const me = s.localCarId != null ? game.world.getCar(s.localCarId) : null;
    const old = this.store.get().hud;
    const ping = s.online && this.net ? ` · ping ${Math.round(this.net.rtt)} ms` : '';
    const next = {
      blue: game.score[0],
      orange: game.score[1],
      clock: game.opts.freePlay ? 'LIBRE' : formatClock(game.timeLeft, game.overtime),
      ot: !!game.overtime,
      boost: me ? Math.round(me.boost) : 0,
      speed: me ? Math.round(me.vel.length() * 0.036) : 0,
      meters: !!me && !me.isDemoed,
      fps: `${this.fps} fps${ping}`,
      msg: this._msg?.msg ?? old.msg,
      msgCls: this._msg?.msgCls ?? old.msgCls,
      msgSub: this._msg?.msgSub ?? old.msgSub,
      msgKey: this._msg?.msgKey ?? old.msgKey,
      hint: old.hint,
    };
    let changed = false;
    for (const k in next) if (next[k] !== old[k]) { changed = true; break; }
    if (changed) this.store.set({ hud: next });
  }

  playerName(id) {
    const p = this.session?.game.players.get(id);
    return p ? p.name : '?';
  }

  teamOf(id) {
    const p = this.session?.game.players.get(id);
    return p ? p.team : -1;
  }

  addFeed(text, team) {
    const feed = [...this.store.get().feed, { id: uid++, text, team, t: performance.now() }].slice(-5);
    this.store.set({ feed });
  }

  onGameEvent(e) {
    switch (e.type) {
      case 'go': this.flash('¡YA!', '', '', 0.8); break;
      case 'overtime': this.flash('PRÓRROGA', '', 'El próximo gol gana', 2); break;
      case 'goal': {
        const scorer = e.scorer >= 0 ? this.playerName(e.scorer) : '';
        const assist = e.assist >= 0 ? ` · asist. ${this.playerName(e.assist)}` : '';
        const kmh = Math.round(e.speed * 0.036);
        this.flash('¡GOL!', e.team === TEAM_BLUE ? 'blue' : 'orange', `${scorer}${assist} · ${kmh} km/h`, 2.6);
        if (scorer) this.addFeed(`⚽ ${scorer} marcó${assist}`, e.team);
        break;
      }
      case 'demo':
        this.addFeed(`💥 ${this.playerName(e.by)} demolió a ${this.playerName(e.car)}`, this.teamOf(e.by));
        break;
      case 'save':
        this.addFeed(`🧤 ¡Parada de ${this.playerName(e.car)}!`, this.teamOf(e.car));
        break;
      default: break;
    }
  }

  // =========================================================== Online
  setStatus(text) { this.patch('online', { status: text || '' }); }

  wsUrl() {
    const custom = this.params.get('server');
    if (custom) return custom.replace(/^http/, 'ws').replace(/\/?$/, '') + (custom.endsWith('/ws') ? '' : '/ws');
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  // ¿Hay un servidor de salas Node detras de esta pagina? Si no (por ejemplo, el HTML abierto con
  // doble clic), las salas funcionan sin servidor: el navegador del anfitrion hace de servidor.
  hasServer() {
    const p = this.params;
    if (p.get('server')) return Promise.resolve(true);
    if (p.has('p2p') || location.protocol === 'file:') return Promise.resolve(false);
    if (!this.serverCheck) {
      this.serverCheck = (async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const r = await fetch('healthz', { signal: ctrl.signal, cache: 'no-store' });
          clearTimeout(t);
          const j = await r.json();
          return !!j.ok;
        } catch { return false; }
      })();
    }
    return this.serverCheck;
  }

  closeNet() {
    if (this.net) { const n = this.net; this.net = null; n.close(); }
    if (this.localHost) { this.localHost.destroy(); this.localHost = null; }
    this.store.set({ isLocalHost: false, selfId: null });
  }

  async ensureNet(mode, code) {
    const server = await this.hasServer();
    if (server && this.net && this.net.connected && this.net.kind === 'server') return true;
    this.closeNet();
    let n;
    if (server) {
      this.setStatus('Conectando con el servidor…');
      n = new NetClient(this.wsUrl());
      n.kind = 'server';
    } else if (mode === 'create') {
      this.setStatus('Creando sala sin servidor (tu navegador será el anfitrión)…');
      n = new NetClient(async () => {
        this.localHost = await createLocalHost(P2P_ICE);
        return this.localHost.socket;
      });
      n.kind = 'host';
    } else {
      this.setStatus('Buscando la sala del anfitrión…');
      n = new NetClient(() => joinP2P(code, P2P_ICE));
      n.kind = 'guest';
    }
    this.net = n;
    this.bindNet(n);
    this.patch('online', { busy: true });
    try {
      await n.connect(this.playerProfile());
      this.setStatus('');
      this.store.set({ selfId: n.id, isLocalHost: n.kind === 'host' });
      return true;
    } catch (e) {
      if (this.net === n) this.net = null;
      if (this.localHost && n.kind === 'host') { this.localHost.destroy(); this.localHost = null; }
      if (server) this.setStatus('No se pudo conectar con el servidor de salas. ¿Está arrancado "npm start"?');
      else if (n.kind === 'guest') this.setStatus('No se encontró la sala. Revisa el código y que el anfitrión siga en la sala (hace falta internet).');
      else this.setStatus('No se pudo crear la sala sin servidor. Comprueba tu conexión a internet.');
      console.warn('conexion', e);
      return false;
    } finally {
      this.patch('online', { busy: false });
    }
  }

  replaceUrl(code) {
    const srv = this.params.get('server');
    const q = [];
    if (code) q.push(`sala=${code}`);
    if (srv) q.push(`server=${encodeURIComponent(srv)}`);
    try { history.replaceState(null, '', location.pathname + (q.length ? `?${q.join('&')}` : '')); } catch { /* file:// */ }
  }

  bindNet(n) {
    n.on('joined', (msg) => {
      this.room = { code: msg.code, members: [], settings: {} };
      this.store.set({ room: this.room, lobbyChat: [], selfId: n.id });
      this.replaceUrl(msg.code);
      this.nav('lobby');
      this.screenStack = ['online'];
      this.startVoice();
    });
    n.on('room', (msg) => {
      this.room = msg;
      this.store.set({ room: msg });
      if (this.voice) this.voice.setPeers(msg.members.map((m) => m.id), n.id);
    });
    n.on('error', (msg) => { this.setStatus(msg.msg); this.toast(msg.msg); });
    n.on('chat', (msg) => {
      const entry = { id: uid++, name: msg.name, team: msg.team, text: msg.text, system: !!msg.system, t: performance.now(), old: false };
      this.store.set({ lobbyChat: [...this.store.get().lobbyChat, entry].slice(-60) });
      if (this.session) this.store.set({ gameChat: [...this.store.get().gameChat, entry].slice(-8) });
    });
    n.on('rtc', (msg) => { if (this.voice) this.voice.handleSignal(msg.from, msg.data); });
    n.on('start', (msg) => {
      // cerrar la sesion anterior antes de crear la nueva (no debe quitarle sus manejadores)
      if (this.session) { this.session.destroy(); this.session = null; }
      this.startSession(new OnlineSession(n, msg));
      if (msg.you == null) this.toast('Estás viendo el partido como espectador');
    });
    n.on('roster', (msg) => { if (this.session?.online) this.session.updateRoster(msg.players, msg.you); });
    n.on('ev', (msg) => { if (this.session?.online) this.session.pushServerEvents(msg.list); });
    n.on('stats', (msg) => { if (this.session?.online) this.session.applyStats(msg.players); });
    n.on('lobby', () => {
      this.endSession();
      this.nav('lobby', false);
      this.screenStack = ['online'];
    });
    n.on('close', () => {
      if (this.net !== n) return;
      this.toast(n.kind === 'guest' ? 'El anfitrión ha cerrado la sala o se perdió la conexión' : 'Se perdió la conexión con el servidor', 4000);
      if (this.localHost && n.kind === 'host') { this.localHost.destroy(); this.localHost = null; }
      const wasInRoom = !!this.room;
      if (this.session?.online) this.endSession();
      this.stopVoice();
      this.room = null;
      this.net = null;
      this.store.set({ room: null, isLocalHost: false, selfId: null });
      if (wasInRoom) this.nav('online', false);
    });
  }

  sendProfile() { if (this.net) this.net.send({ t: 'profile', ...this.playerProfile() }); }

  async createRoom({ teamSize = 2, bots = true, difficulty = 'pro', matchTime = 300 } = {}) {
    this.audio.ensure();
    if (!(await this.ensureNet('create'))) return false;
    this.sendProfile();
    this.net.send({ t: 'create', settings: { teamSize, bots: !!bots, difficulty, matchTime } });
    return true;
  }

  async joinRoom(code) {
    this.audio.ensure();
    code = String(code || '').trim().toUpperCase();
    if (code.length < 4) { this.setStatus('Escribe el código de la sala'); return false; }
    if (!(await this.ensureNet('join', code))) return false;
    this.sendProfile();
    this.net.send({ t: 'join', code });
    return true;
  }

  leaveRoom() {
    if (this.net) this.net.send({ t: 'leave' });
    this.stopVoice();
    this.room = null;
    this.store.set({ room: null, lobbyChat: [] });
    // sin servidor: al salir se cierra la conexion (y, si eras el anfitrion, la sala)
    if (this.net && this.net.kind !== 'server') this.closeNet();
    this.replaceUrl(null);
  }

  leaveToOnline() {
    this.leaveRoom();
    this.nav('online', false);
    this.screenStack = ['main'];
  }

  setTeam(team) { this.net?.send({ t: 'team', team: Number(team) }); }

  startMatch() { this.audio.ensure(); this.net?.send({ t: 'start' }); }

  updateRoomSettings(patch) {
    if (!this.net || !this.room || this.room.host !== this.net.id) return;
    this.net.send({ t: 'settings', settings: { ...this.room.settings, ...patch } });
  }

  inviteText() {
    const code = this.room?.code || '';
    const srv = this.params.get('server');
    return location.protocol === 'file:'
      ? `¡Juega conmigo a Turbo Liga! Abre turbo-liga.html, entra en "Online con amigos" y únete con el código ${code}`
      : `${location.origin}${location.pathname}?sala=${code}${srv ? `&server=${encodeURIComponent(srv)}` : ''}`;
  }

  async copyInvite() {
    const text = this.inviteText();
    try {
      await navigator.clipboard.writeText(text);
      this.toast(location.protocol === 'file:' ? 'Código copiado. ¡Pásaselo a tus amigos!' : 'Enlace copiado. ¡Pásaselo a tus amigos!');
    } catch {
      window.prompt('Copia esto:', text);
    }
  }

  // =========================================================== Voz
  syncVoice() {
    const v = this.voice;
    if (!v) {
      this.store.set({ voice: { active: false, micOn: false, muted: false, ptt: false, error: '', connected: 0, hasTrack: false }, speaking: {}, micLevel: 0 });
      return;
    }
    const speaking = {};
    for (const m of this.room?.members || []) if (v.isSpeaking(m.id)) speaking[m.id] = true;
    const st = this.store.get();
    const voice = { active: true, micOn: v.micOn, muted: v.muted, ptt: v.pttMode, error: v.micError || '', connected: v.connectedCount(), hasTrack: !!v.localTrack };
    const patch = {};
    if (JSON.stringify(voice) !== JSON.stringify(st.voice)) patch.voice = voice;
    if (JSON.stringify(speaking) !== JSON.stringify(st.speaking)) patch.speaking = speaking;
    if (Object.keys(patch).length) this.store.set(patch);
  }

  async startVoice() {
    if (this.voice || !this.net) return;
    const v = this.voice = new Voice({
      send: (to, data) => this.net && this.net.send({ t: 'rtc', to, data }),
      iceServers: this.net.ice,
      onChange: () => this.syncVoice(),
      onDeviceFallback: () => {
        this.updateSettings({ micDeviceId: '' });
        this.toast('No se encontró el micrófono elegido: se usa el predeterminado', 3000);
      },
    });
    v.setVolume(this.settings.voiceVolume);
    v.setPtt(this.settings.micMode === 'ptt');
    if (this.room?.members?.length) v.setPeers(this.room.members.map((m) => m.id), this.net.id);
    this.syncVoice();
    const ok = await v.enableMic(this.settings.micDeviceId);
    if (this.voice !== v) return; // se salio de la sala mientras se pedia el micro
    if (!ok) this.toast(v.micError || 'Micrófono no disponible: podrás escuchar pero no hablar', 4000);
    this.sendMicState();
    this.syncVoice();
  }

  stopVoice() {
    if (this.voice) this.voice.destroy();
    this.voice = null;
    this.syncVoice();
  }

  sendMicState() { if (this.net && this.voice) this.net.send({ t: 'mic', on: this.voice.micOn }); }

  toggleMute() {
    const v = this.voice;
    if (!v) return;
    if (v.needsGesture) v.resumeAudio();
    if (!v.localTrack) {
      v.enableMic(this.settings.micDeviceId).then(() => { this.sendMicState(); this.syncVoice(); });
      return;
    }
    v.setMuted(!v.muted);
    this.sendMicState();
    this.syncVoice();
    this.toast(v.muted ? 'Micrófono silenciado (M)' : 'Micrófono activado', 1200);
  }

  setPttDown(down) { this.voice?.setPttDown(down); }

  // Controles tactiles (los pinta React y escriben aqui)
  setTouch(patch) {
    const t = this.input.touch;
    if (!t) return;
    Object.assign(t, patch);
    t.active = !!(t.stick || t.jump || t.boost || t.drift);
  }
}
