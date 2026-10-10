import { GameRenderer, TEAM_SHADES, ACCENTS } from './render/scene.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Hud, statsTable, esc } from './hud.js';
import { LocalSession } from './localSession.js';
import { NetClient, OnlineSession } from './net.js';
import { Voice } from './voice.js';
import { createLocalHost } from './localHost.js';
import { joinP2P } from './p2p.js';
import { loadSettings, saveSettings } from './settings.js';
import { CAR_TYPES, getCarConfig } from '../shared/cars.js';
import { PHASE } from '../shared/game.js';
import { TEAM_BLUE } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = loadSettings();
const params = new URLSearchParams(location.search);

let renderer;
try {
  renderer = new GameRenderer($('view'), params.get('calidad') || settings.quality);
} catch (e) {
  $('loading').textContent = 'Tu navegador no soporta WebGL. Prueba con Chrome, Edge o Firefox actualizados.';
  throw e;
}
const input = new Input($('view'));
const audio = new GameAudio();
audio.setVolume(settings.volume);
const hud = new Hud();
applyCameraSettings();

let session = null;
let net = null;
let room = null;
let voice = null;
let localHost = null; // anfitrion sin servidor ejecutandose en esta pagina
let screen = 'main';
let screenStack = [];
let lastRoster = -1;
let endTimer = null;
let chatOpen = false;

// Exponer estado para depuracion / pruebas automaticas
window.__turbo = { get session() { return session; }, get voice() { return voice; }, get room() { return room; }, get net() { return net; }, renderer };

// =============================================================== Pantallas
function showScreen(name, push = true) {
  if (push && screen && screen !== name) screenStack.push(screen);
  screen = name;
  $('menu').classList.remove('hidden');
  for (const s of $$('.screen')) s.classList.toggle('active', s.dataset.screen === name);
  if (name === 'garage') { buildGarage(); renderer.setPreview(settings.carType, settings.colors); } else renderer.clearPreview();
  if (name === 'settings') syncSettingsUI();
  if (name === 'online') {
    $('input-name').value = settings.name;
    hasServer().then((srv) => {
      $('online-mode').textContent = srv
        ? 'Conectado al servidor de salas.'
        : 'Modo sin servidor: quien crea la sala hace de anfitrión desde su navegador y los demás se conectan directamente (hace falta internet). Comparte el código con tus amigos.';
    });
  }
  input.enabled = false;
}

function hideMenu() {
  $('menu').classList.add('hidden');
  renderer.clearPreview();
  input.enabled = true;
}

function goBack() {
  const prev = screenStack.pop();
  if (prev === 'pause' && session) { showScreen('pause', false); return; }
  showScreen(prev || 'main', false);
}

for (const b of $$('[data-go]')) {
  b.addEventListener('click', () => {
    audio.ensure();
    const to = b.dataset.go;
    if (to === 'back') goBack();
    else if (to === 'main' && screen === 'garage') { saveSettings(settings); showScreen(session ? 'pause' : 'main', false); screenStack = []; }
    // con un partido en marcha no se vuelve al menu principal, sino a la pausa
    else if (to === 'main' && session) { showScreen('pause', false); screenStack = []; }
    else showScreen(to);
  });
}

function toast(text, ms = 2500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// Botones segmentados
const opts = {
  teamSize: 1, difficulty: 'pro', matchTime: 300, team: 0,
  roomTeamSize: 2, roomBots: 1, roomDifficulty: 'pro',
};
for (const seg of $$('.seg[data-opt]')) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of seg.children) b.classList.toggle('on', b === btn);
    const key = seg.dataset.opt;
    const v = isNaN(Number(btn.dataset.v)) ? btn.dataset.v : Number(btn.dataset.v);
    opts[key] = v;
    if (key.startsWith('lobby')) sendLobbySettings();
  });
}

// =============================================================== Partidas
function startSession(s) {
  if (session) session.destroy();
  session = s;
  lastRoster = -1;
  clearTimeout(endTimer);
  renderer.cam.ballCam = settings.ballCam;
  renderer.cam.reset();
  hud.show(true);
  hideMenu();
  audio.ensure();
  screenStack = [];
  $('hud-hint').textContent = s.kind === 'freeplay' ? 'R: recolocar balón · F: recolocar coche · C: cámara balón · Esc: menú' : '';
  setTimeout(() => { if ($('hud-hint').textContent && session === s && s.kind !== 'freeplay') $('hud-hint').textContent = ''; }, 6000);
}

function endSession() {
  if (session) session.destroy();
  session = null;
  renderer.clearCars();
  hud.show(false);
  hud.showStats(false);
  clearTimeout(endTimer);
}

function playerProfile() {
  return { name: settings.name, carType: settings.carType, colors: settings.colors };
}

$('btn-start-bots').addEventListener('click', () => {
  startSession(new LocalSession({
    teamSize: opts.teamSize, difficulty: opts.difficulty, matchTime: opts.matchTime, team: opts.team, player: playerProfile(),
  }));
});
$('btn-freeplay').addEventListener('click', () => {
  startSession(new LocalSession({ freePlay: true, unlimitedBoost: true, player: playerProfile() }));
});

// Pausa
function openPause() {
  if (!session) return;
  if (!session.online) session.paused = true;
  $('btn-restart').classList.toggle('hidden', !!session.online);
  showScreen('pause', false);
  screenStack = [];
}
function resume() {
  if (!session) return;
  session.paused = false;
  hideMenu();
  screenStack = [];
}
// Reiniciar un partido local: la sesion es la misma, asi que hay que anular el final pendiente y la pausa
function restartLocal() {
  if (!session || session.online) return;
  clearTimeout(endTimer);
  session.restart();
  session.paused = false;
  lastRoster = -1;
  renderer.cam.reset();
  hud.showStats(false);
  hideMenu();
  screenStack = [];
}
$('btn-resume').addEventListener('click', resume);
$('btn-restart').addEventListener('click', restartLocal);
$('btn-quit').addEventListener('click', () => {
  const wasOnline = session?.online;
  endSession();
  if (wasOnline && room) { leaveRoom(); }
  showScreen('main', false);
  screenStack = [];
});

// Fin del partido
function showEnd(winner, score) {
  if (!session) return;
  const me = session.localCarId != null ? session.game.players.get(session.localCarId) : null;
  const won = me ? me.team === winner : null;
  $('end-title').textContent = won == null ? (winner === TEAM_BLUE ? 'Gana el equipo Azul' : 'Gana el equipo Naranja') : won ? '¡VICTORIA!' : 'Derrota';
  $('end-score').innerHTML = `<span class="b">${score[0]}</span> – <span class="o">${score[1]}</span>`;
  $('end-stats').innerHTML = statsTable(session.game.playerList(), session.localCarId);
  const isHost = !session.online || (room && net && room.host === net.id);
  $('btn-rematch').classList.toggle('hidden', !isHost);
  $('btn-rematch').textContent = session.online ? 'Revancha' : 'Revancha';
  $('btn-end-menu').textContent = session.online ? (isHost ? 'Volver a la sala' : 'Salir de la sala') : 'Menú';
  showScreen('end', false);
  screenStack = [];
}
$('btn-rematch').addEventListener('click', () => {
  if (!session) return;
  if (session.online) net.send({ t: 'rematch' });
  else restartLocal();
});
$('btn-end-menu').addEventListener('click', () => {
  if (session?.online) {
    if (room && net && room.host === net.id) net.send({ t: 'toLobby' });
    else { endSession(); leaveRoom(); showScreen('main', false); }
  } else {
    endSession();
    showScreen('main', false);
  }
});

// =============================================================== Teclas
input.on('press', (code) => {
  if (chatOpen) return;
  switch (code) {
    case 'Escape':
    case 'PadStart':
      if (!session) { if (screen !== 'main' && screen !== 'lobby') goBack(); return; }
      if ($('menu').classList.contains('hidden')) openPause();
      else if (screen === 'pause') resume();
      else if (screen !== 'end') goBack();
      break;
    case 'KeyC':
    case 'PadY':
      if (!session) return;
      renderer.cam.ballCam = !renderer.cam.ballCam;
      toast(renderer.cam.ballCam ? 'Cámara balón: ON' : 'Cámara balón: OFF', 1000);
      break;
    case 'Tab':
    case 'PadBack':
      if (session) hud.showStats(true, session);
      break;
    case 'KeyM':
      if (voice) toggleMute();
      break;
    case 'KeyV':
      if (voice) voice.setPttDown(true);
      break;
    case 'KeyR':
      if (session?.kind === 'freeplay') session.resetBall();
      break;
    case 'KeyF':
      if (session?.kind === 'freeplay') session.resetCar();
      break;
    case 'KeyT':
    case 'Enter':
      if (session?.online && $('menu').classList.contains('hidden')) openChat();
      break;
    default: break;
  }
});
input.on('release', (code) => {
  if (code === 'Tab' || code === 'PadBack') hud.showStats(false);
  if (code === 'KeyV' && voice) voice.setPttDown(false);
});

function openChat() {
  chatOpen = true;
  input.enabled = false;
  const el = $('chat-input');
  el.classList.remove('hidden');
  setTimeout(() => el.focus(), 0);
}
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (text && net) net.send({ t: 'chat', text });
    e.target.value = '';
  }
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.target.blur();
  }
  e.stopPropagation();
});
$('chat-input').addEventListener('blur', () => {
  chatOpen = false;
  $('chat-input').classList.add('hidden');
  if ($('menu').classList.contains('hidden')) input.enabled = true;
});

// =============================================================== Bucle principal
let lastT = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  const controls = input.poll();
  if (session) {
    session.update(dt, controls);
    if (session.rosterVersion !== lastRoster) {
      lastRoster = session.rosterVersion;
      renderer.setRoster(session.players, session.localCarId);
    }
    const events = session.drainEvents();
    if (events.length) {
      renderer.handleEvents(events, session.game);
      const me = session.localCarId != null ? session.game.world.getCar(session.localCarId) : null;
      for (const e of events) {
        audio.play(e, me ? me.pos : renderer.camera.position, session.game);
        hud.onEvent(e, session);
        if (e.type === 'end') {
          const s = session;
          endTimer = setTimeout(() => { if (session === s) showEnd(e.winner, e.score); }, 2500);
        }
      }
    }
    hud.update(session, dt);
    const me = session.localCarId != null ? session.game.world.getCar(session.localCarId) : null;
    audio.updateEngine(me, !session.paused && session.game.phase !== PHASE.ENDED);
    const ping = session.online && net ? ` · ping ${Math.round(net.rtt)} ms` : '';
    $('net-stats').textContent = `${fps} fps${ping}`;
  } else {
    audio.updateEngine(null, false);
  }
  renderer.update(dt, session);
  renderer.render();
  if (voice) updateVoiceHud();
}

// =============================================================== Garaje
function buildGarage() {
  const grid = $('car-grid');
  grid.innerHTML = '';
  for (const type of CAR_TYPES) {
    const cfg = getCarConfig(type);
    const b = document.createElement('button');
    b.innerHTML = `${cfg.name}<small>${Math.round(cfg.hitbox[0])}×${Math.round(cfg.hitbox[1])}×${Math.round(cfg.hitbox[2])}</small>`;
    b.classList.toggle('on', settings.carType === type);
    b.addEventListener('click', () => {
      settings.carType = type;
      saveSettings(settings);
      buildGarage();
      renderer.setPreview(type, settings.colors);
      sendProfile();
    });
    grid.appendChild(b);
  }
  const ps = $('primary-swatches');
  ps.innerHTML = '';
  TEAM_SHADES[0].forEach((blue, i) => {
    const sw = document.createElement('div');
    sw.className = `swatch ${settings.colors.primary === i ? 'on' : ''}`;
    sw.innerHTML = `<div class="half" style="left:0;background:${blue}"></div><div class="half r" style="background:${TEAM_SHADES[1][i]}"></div>`;
    sw.addEventListener('click', () => { settings.colors.primary = i; saveSettings(settings); buildGarage(); renderer.setPreview(settings.carType, settings.colors); sendProfile(); });
    ps.appendChild(sw);
  });
  const as = $('accent-swatches');
  as.innerHTML = '';
  for (const c of ACCENTS) {
    const sw = document.createElement('div');
    sw.className = `swatch ${settings.colors.accent === c ? 'on' : ''}`;
    sw.style.background = c;
    sw.addEventListener('click', () => { settings.colors.accent = c; saveSettings(settings); buildGarage(); renderer.setPreview(settings.carType, settings.colors); sendProfile(); });
    as.appendChild(sw);
  }
}

// =============================================================== Ajustes
function applyCameraSettings() {
  renderer.cam.settings.fov = settings.fov;
  renderer.cam.settings.distance = settings.distance;
  renderer.cam.settings.shake = settings.shake;
  renderer.resize();
}

function syncSettingsUI() {
  for (const seg of $$('.seg[data-setting]')) {
    const key = seg.dataset.setting;
    let v = settings[key];
    if (typeof v === 'boolean') v = v ? '1' : '0';
    for (const b of seg.children) b.classList.toggle('on', b.dataset.v === String(v));
  }
  $('set-fov').value = settings.fov; $('fov-val').textContent = settings.fov;
  $('set-dist').value = settings.distance; $('dist-val').textContent = settings.distance;
  $('set-volume').value = Math.round(settings.volume * 100); $('vol-val').textContent = Math.round(settings.volume * 100);
  $('set-voice-volume').value = Math.round(settings.voiceVolume * 100); $('vvol-val').textContent = Math.round(settings.voiceVolume * 100);
  refreshMicDevices();
}

for (const seg of $$('.seg[data-setting]')) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const key = seg.dataset.setting;
    const v = btn.dataset.v;
    if (key === 'ballCam' || key === 'shake') settings[key] = v === '1';
    else settings[key] = v;
    saveSettings(settings);
    syncSettingsUI();
    applyCameraSettings();
    if (key === 'ballCam' && session) renderer.cam.ballCam = settings.ballCam;
    if (key === 'micMode' && voice) voice.setPtt(settings.micMode === 'ptt');
    if (key === 'quality') toast('Recarga la página para aplicar la calidad');
  });
}
$('set-fov').addEventListener('input', (e) => { settings.fov = Number(e.target.value); $('fov-val').textContent = settings.fov; applyCameraSettings(); saveSettings(settings); });
$('set-dist').addEventListener('input', (e) => { settings.distance = Number(e.target.value); $('dist-val').textContent = settings.distance; applyCameraSettings(); saveSettings(settings); });
$('set-volume').addEventListener('input', (e) => { settings.volume = Number(e.target.value) / 100; $('vol-val').textContent = e.target.value; audio.setVolume(settings.volume); saveSettings(settings); });
$('set-voice-volume').addEventListener('input', (e) => { settings.voiceVolume = Number(e.target.value) / 100; $('vvol-val').textContent = e.target.value; voice?.setVolume(settings.voiceVolume); saveSettings(settings); });
$('set-mic-device').addEventListener('change', async (e) => {
  settings.micDeviceId = e.target.value;
  saveSettings(settings);
  if (voice) { await voice.enableMic(settings.micDeviceId); sendMicState(); }
});

async function refreshMicDevices() {
  const sel = $('set-mic-device');
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    // micro guardado que ya no existe (solo se sabe si el navegador da los ids, tras el permiso)
    if (settings.micDeviceId && devs.some((d) => d.deviceId) && !devs.some((d) => d.deviceId === settings.micDeviceId)) {
      settings.micDeviceId = '';
      saveSettings(settings);
    }
    sel.innerHTML = '<option value="">Predeterminado</option>' + devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Micrófono ${i + 1}`)}</option>`).join('');
    sel.value = settings.micDeviceId || '';
  } catch { /* */ }
}

// =============================================================== Online
function wsUrl() {
  const custom = params.get('server');
  if (custom) return custom.replace(/^http/, 'ws').replace(/\/?$/, '') + (custom.endsWith('/ws') ? '' : '/ws');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function setStatus(text) { $('online-status').textContent = text || ''; }

const P2P_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];

// ¿Hay un servidor de salas Node detras de esta pagina? Si no (por ejemplo, el HTML abierto con
// doble clic), las salas funcionan sin servidor: el navegador del anfitrion hace de servidor.
let serverCheck = null;
function hasServer() {
  if (params.get('server')) return Promise.resolve(true);
  if (params.has('p2p') || location.protocol === 'file:') return Promise.resolve(false);
  if (!serverCheck) {
    serverCheck = (async () => {
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
  return serverCheck;
}

function closeNet() {
  if (net) { const n = net; net = null; n.close(); }
  if (localHost) { localHost.destroy(); localHost = null; }
}

// mode: 'create' o 'join' (code)
async function ensureNet(mode, code) {
  const server = await hasServer();
  if (server && net && net.connected && net.kind === 'server') return true;
  closeNet();
  let n;
  if (server) {
    setStatus('Conectando con el servidor…');
    n = new NetClient(wsUrl());
    n.kind = 'server';
  } else if (mode === 'create') {
    setStatus('Creando sala sin servidor (tu navegador será el anfitrión)…');
    n = new NetClient(async () => {
      localHost = await createLocalHost(P2P_ICE);
      return localHost.socket;
    });
    n.kind = 'host';
  } else {
    setStatus('Buscando la sala del anfitrión…');
    n = new NetClient(() => joinP2P(code, P2P_ICE));
    n.kind = 'guest';
  }
  net = n;
  bindNet(n);
  try {
    await n.connect(playerProfile());
    setStatus('');
    return true;
  } catch (e) {
    if (net === n) net = null;
    if (localHost && n.kind === 'host') { localHost.destroy(); localHost = null; }
    if (server) setStatus('No se pudo conectar con el servidor de salas. ¿Está arrancado "npm start"?');
    else if (n.kind === 'guest') setStatus('No se encontró la sala. Revisa el código y que el anfitrión siga en la sala (hace falta internet).');
    else setStatus('No se pudo crear la sala sin servidor. Comprueba tu conexión a internet.');
    console.warn('conexion', e);
    return false;
  }
}

function bindNet(n) {
  n.on('joined', (msg) => {
    room = { code: msg.code, members: [], settings: {} };
    $('lobby-code').textContent = msg.code;
    history.replaceState(null, '', `${location.pathname}?sala=${msg.code}${params.get('server') ? `&server=${encodeURIComponent(params.get('server'))}` : ''}`);
    $('lobby-chat-log').innerHTML = '';
    showScreen('lobby');
    screenStack = ['online'];
    startVoice();
  });
  n.on('room', (msg) => {
    room = msg;
    renderLobby();
    if (voice) voice.setPeers(msg.members.map((m) => m.id), n.id);
  });
  n.on('error', (msg) => { setStatus(msg.msg); toast(msg.msg); });
  n.on('chat', (msg) => {
    addLobbyChat(msg);
    if (session) hud.addChat(msg.name, msg.text, msg.team, msg.system);
  });
  n.on('rtc', (msg) => { if (voice) voice.handleSignal(msg.from, msg.data); });
  n.on('start', (msg) => {
    // cerrar la sesion anterior antes de crear la nueva (no debe quitarle sus manejadores)
    if (session) { session.destroy(); session = null; }
    startSession(new OnlineSession(n, msg));
    if (msg.you == null) toast('Estás viendo el partido como espectador');
  });
  n.on('roster', (msg) => { if (session?.online) session.updateRoster(msg.players, msg.you); });
  n.on('ev', (msg) => { if (session?.online) session.pushServerEvents(msg.list); });
  n.on('stats', (msg) => { if (session?.online) session.applyStats(msg.players); });
  n.on('lobby', () => {
    endSession();
    showScreen('lobby', false);
    screenStack = ['online'];
  });
  n.on('close', () => {
    if (net !== n) return;
    toast(n.kind === 'guest' ? 'El anfitrión ha cerrado la sala o se perdió la conexión' : 'Se perdió la conexión con el servidor', 4000);
    if (localHost && n.kind === 'host') { localHost.destroy(); localHost = null; }
    const wasInRoom = !!room;
    if (session?.online) endSession();
    stopVoice();
    room = null;
    net = null;
    if (wasInRoom) showScreen('online', false);
  });
}

function sendProfile() { if (net) net.send({ t: 'profile', ...playerProfile() }); }

$('input-name').addEventListener('change', (e) => {
  settings.name = e.target.value.trim().slice(0, 16) || settings.name;
  saveSettings(settings);
  sendProfile();
});

$('btn-create-room').addEventListener('click', async () => {
  audio.ensure();
  settings.name = $('input-name').value.trim().slice(0, 16) || settings.name;
  saveSettings(settings);
  if (!(await ensureNet('create'))) return;
  sendProfile();
  net.send({ t: 'create', settings: { teamSize: opts.roomTeamSize, bots: !!opts.roomBots, difficulty: opts.roomDifficulty, matchTime: 300 } });
});

$('btn-join-room').addEventListener('click', async () => {
  audio.ensure();
  const code = $('input-code').value.trim().toUpperCase();
  if (code.length < 4) { setStatus('Escribe el código de la sala'); return; }
  settings.name = $('input-name').value.trim().slice(0, 16) || settings.name;
  saveSettings(settings);
  if (!(await ensureNet('join', code))) return;
  sendProfile();
  net.send({ t: 'join', code });
});
$('input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-room').click(); e.stopPropagation(); });

function leaveRoom() {
  if (net) net.send({ t: 'leave' });
  stopVoice();
  room = null;
  // sin servidor: al salir se cierra la conexion (y, si eras el anfitrion, la sala)
  if (net && net.kind !== 'server') closeNet();
  history.replaceState(null, '', location.pathname + (params.get('server') ? `?server=${encodeURIComponent(params.get('server'))}` : ''));
}
$('btn-leave-room').addEventListener('click', () => { leaveRoom(); showScreen('online', false); screenStack = ['main']; });

$('btn-copy-link').addEventListener('click', async () => {
  const code = room?.code || '';
  // con el HTML abierto como archivo no hay enlace que compartir: se copia el codigo
  const text = location.protocol === 'file:'
    ? `¡Juega conmigo a Turbo Liga! Abre turbo-liga.html, entra en "Online con amigos" y únete con el código ${code}`
    : `${location.origin}${location.pathname}?sala=${code}${params.get('server') ? `&server=${encodeURIComponent(params.get('server'))}` : ''}`;
  try { await navigator.clipboard.writeText(text); toast(location.protocol === 'file:' ? 'Código copiado. ¡Pásaselo a tus amigos!' : 'Enlace copiado. ¡Pásaselo a tus amigos!'); } catch { prompt('Copia esto:', text); }
});

for (const b of $$('[data-team]')) {
  b.addEventListener('click', () => { if (net) net.send({ t: 'team', team: Number(b.dataset.team) }); });
}

$('btn-start-match').addEventListener('click', () => { audio.ensure(); if (net) net.send({ t: 'start' }); });

function sendLobbySettings() {
  if (!net || !room || room.host !== net.id) return;
  net.send({ t: 'settings', settings: { teamSize: opts.lobbyTeamSize, bots: !!opts.lobbyBots, difficulty: opts.lobbyDifficulty, matchTime: opts.lobbyTime } });
}

function renderLobby() {
  if (!room || !net) return;
  const isHost = room.host === net.id;
  const s = room.settings;
  opts.lobbyTeamSize = s.teamSize; opts.lobbyBots = s.bots ? 1 : 0; opts.lobbyDifficulty = s.difficulty; opts.lobbyTime = s.matchTime;
  const setSeg = (key, v) => {
    const seg = document.querySelector(`.seg[data-opt="${key}"]`);
    for (const b of seg.children) b.classList.toggle('on', b.dataset.v === String(v));
    for (const b of seg.children) b.disabled = !isHost;
  };
  setSeg('lobbyTeamSize', s.teamSize); setSeg('lobbyBots', s.bots ? 1 : 0); setSeg('lobbyDifficulty', s.difficulty); setSeg('lobbyTime', s.matchTime);
  const li = (m) => `<li class="${m.id === net.id ? 'me' : ''} ${voice?.isSpeaking(m.id) ? 'speaking' : ''}" data-id="${Number(m.id) | 0}">${m.mic ? '🎙️' : '🔇'} ${esc(m.name)}${m.id === room.host ? ' 👑' : ''}<span class="tag">${m.id === net.id ? 'tú' : ''}</span></li>`;
  for (const [team, el] of [[0, 'lobby-blue'], [1, 'lobby-orange'], [-1, 'lobby-spec']]) {
    const members = room.members.filter((m) => m.team === team);
    let html = members.map(li).join('');
    if (team >= 0 && s.bots) for (let i = members.length; i < s.teamSize; i++) html += '<li class="bot">🤖 Bot<span class="tag">IA</span></li>';
    $(el).innerHTML = html;
  }
  $('btn-start-match').classList.toggle('hidden', !isHost);
  $('lobby-wait').textContent = room.inGame ? 'Partido en curso…'
    : localHost ? 'Eres el anfitrión: no cierres ni minimices esta pestaña'
      : isHost ? 'Tú eres el anfitrión' : 'Esperando a que el anfitrión empiece…';
  $('btn-start-match').disabled = room.inGame;
}

function addLobbyChat(msg) {
  const log = $('lobby-chat-log');
  const d = document.createElement('div');
  const color = msg.team === 0 ? '#9cc4ff' : msg.team === 1 ? '#ffc08a' : '#d6dcf0';
  d.innerHTML = msg.system ? `<i style="color:#ffd23f">${esc(msg.text)}</i>` : `<b style="color:${color}">${esc(msg.name)}:</b> ${esc(msg.text)}`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
$('lobby-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (text && net) net.send({ t: 'chat', text });
    e.target.value = '';
  }
  e.stopPropagation();
});

// =============================================================== Voz
async function startVoice() {
  if (voice) return;
  const v = voice = new Voice({
    send: (to, data) => net && net.send({ t: 'rtc', to, data }),
    iceServers: net.ice,
    onChange: () => { renderLobby(); updateMicUI(); },
    onDeviceFallback: () => {
      settings.micDeviceId = '';
      saveSettings(settings);
      $('set-mic-device').value = '';
      toast('No se encontró el micrófono elegido: se usa el predeterminado', 3000);
    },
  });
  voice.setVolume(settings.voiceVolume);
  voice.setPtt(settings.micMode === 'ptt');
  if (room?.members?.length) voice.setPeers(room.members.map((m) => m.id), net.id);
  const ok = await v.enableMic(settings.micDeviceId);
  if (voice !== v) return; // se salio de la sala mientras se pedia el micro
  if (!ok) toast(voice.micError || 'Micrófono no disponible: podrás escuchar pero no hablar', 4000);
  sendMicState();
  updateMicUI();
}

function stopVoice() {
  if (voice) voice.destroy();
  voice = null;
  hud.setVoice([]);
  updateMicUI();
}

function sendMicState() { if (net && voice) net.send({ t: 'mic', on: voice.micOn }); }

function toggleMute() {
  if (!voice) return;
  if (!voice.localTrack) { voice.enableMic(settings.micDeviceId).then(() => { sendMicState(); updateMicUI(); }); return; }
  voice.setMuted(!voice.muted);
  sendMicState();
  toast(voice.muted ? 'Micrófono silenciado (M)' : 'Micrófono activado', 1200);
}
$('btn-mic').addEventListener('click', () => { if (voice?.needsGesture) voice.resumeAudio(); toggleMute(); });

function updateMicUI() {
  const st = $('mic-status');
  if (!voice) { st.textContent = 'Micrófono desactivado'; $('btn-mic').textContent = '🎙️ Micrófono'; return; }
  if (voice.micError) st.textContent = voice.micError;
  else if (!voice.localTrack) st.textContent = 'Activando micrófono…';
  else if (voice.muted) st.textContent = 'Silenciado — pulsa M para hablar';
  else st.textContent = voice.pttMode ? 'Pulsa V para hablar' : `Micrófono abierto · ${voice.connectedCount()} conectado(s) por voz`;
  $('btn-mic').textContent = voice.muted || !voice.localTrack ? '🔇 Activar micro' : '🎙️ Silenciar';
}

function updateVoiceHud() {
  $('mic-level').style.width = `${Math.min(100, voice.localLevel * 600)}%`;
  if (!session || !room) return;
  const list = room.members.map((m) => ({
    id: m.id, name: m.name, team: m.team,
    mic: m.id === net?.id ? voice.micOn : m.mic,
    speaking: voice.isSpeaking(m.id),
  }));
  hud.setVoice(list);
}

// =============================================================== Tactil
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  const tc = $('touch-controls');
  tc.classList.remove('hidden');
  const t = (input.touch = { active: false, steer: 0, throttle: 0, jump: false, boost: false, drift: false });
  const stick = $('tc-stick'), knob = $('tc-knob');
  let stickId = null;
  // el tactil solo sustituye al teclado mientras hay un dedo en el stick o en un boton
  const refresh = () => { t.active = stickId !== null || t.jump || t.boost || t.drift; };
  const setStick = (x, y) => {
    const r = stick.getBoundingClientRect();
    let dx = (x - (r.left + r.width / 2)) / (r.width / 2), dy = (y - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    t.steer = Math.abs(dx) < 0.15 ? 0 : dx;
    t.throttle = -dy;
    knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
  };
  stick.addEventListener('touchstart', (e) => { stickId = e.changedTouches[0].identifier; refresh(); setStick(e.changedTouches[0].clientX, e.changedTouches[0].clientY); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => { for (const tt of e.changedTouches) if (tt.identifier === stickId) setStick(tt.clientX, tt.clientY); }, { passive: true });
  const endStick = (e) => {
    for (const tt of e.changedTouches) if (tt.identifier === stickId) { stickId = null; t.steer = 0; t.throttle = 0; knob.style.transform = ''; }
    refresh();
  };
  window.addEventListener('touchend', endStick);
  window.addEventListener('touchcancel', endStick);
  for (const b of tc.querySelectorAll('button[data-tc]')) {
    const key = b.dataset.tc;
    const set = (v) => { t[key] = v; refresh(); };
    b.addEventListener('touchstart', (e) => { set(true); e.preventDefault(); }, { passive: false });
    b.addEventListener('touchend', (e) => { set(false); e.preventDefault(); }, { passive: false });
    b.addEventListener('touchcancel', () => set(false));
  }
  // boton de pausa (sin teclado ni mando no habria forma de abrir el menu)
  const pauseBtn = $('tc-pause');
  pauseBtn.addEventListener('touchstart', (e) => { e.preventDefault(); openPause(); }, { passive: false });
  pauseBtn.addEventListener('click', openPause);
}

// =============================================================== Arranque
$('loading').classList.add('hidden');
showScreen('main', false);
const salaParam = params.get('sala');
if (salaParam) {
  showScreen('online');
  $('input-code').value = salaParam.toUpperCase().slice(0, 6);
  setStatus('Te han invitado a una sala: pulsa "Unirse"');
}
requestAnimationFrame(frame);
