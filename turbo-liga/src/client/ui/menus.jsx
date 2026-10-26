import { useEffect, useState } from 'react';
import { CAR_TYPES, getCarConfig } from '../../shared/cars.js';
import { TEAM_SHADES, ACCENTS } from '../render/scene.js';
import {
  useEngine, useGame, Seg, Field, Screen, StatsTable, DIFFICULTY_OPTIONS, TEAM_SIZE_OPTIONS, TIME_OPTIONS,
} from './common.jsx';

// ------------------------------------------------------------------ Principal
export function MainMenu() {
  const engine = useEngine();
  const name = useGame((s) => s.settings.name);
  return (
    <Screen name="main" className="main-screen">
      <div className="logo">
        <div className="logo-top">TURBO</div>
        <div className="logo-bottom">LIGA <span>3D</span></div>
        <div className="logo-sub">fútbol con coches · físicas de Rocket League</div>
      </div>
      <div className="main-buttons">
        <button className="btn big primary" id="btn-quick" onClick={() => engine.startBots({ teamSize: 1, difficulty: 'pro' })}>
          ⚡ Partido rápido 1 vs 1
        </button>
        <button className="btn big" onClick={() => engine.nav('bots')}>🤖 Jugar contra bots</button>
        <button className="btn big orange" onClick={() => engine.nav('online')}>🎙️ Online con amigos</button>
        <button className="btn big" id="btn-freeplay" onClick={() => engine.startFreePlay()}>⚽ Entrenamiento libre</button>
        <div className="row">
          <button className="btn" onClick={() => engine.nav('garage')}>🚗 Garaje</button>
          <button className="btn" onClick={() => engine.nav('controls')}>🎮 Controles</button>
          <button className="btn" onClick={() => engine.nav('settings')}>⚙️ Ajustes</button>
        </div>
      </div>
      <div className="footer-note">
        Piloto: <b>{name}</b> · Física basada en <a href="https://github.com/ZealanL/RocketSim" target="_blank" rel="noopener noreferrer">RocketSim</a> (MIT). Juego de fans, sin relación con Psyonix/Epic.
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Contra bots
export function BotsSetup() {
  const engine = useEngine();
  const [o, setO] = useState({ teamSize: 1, difficulty: 'pro', matchTime: 300, team: 0 });
  const set = (k) => (v) => setO((prev) => ({ ...prev, [k]: v }));
  return (
    <Screen name="bots">
      <h2>Partido contra bots</h2>
      <Field label="Modo"><Seg name="teamSize" value={o.teamSize} options={TEAM_SIZE_OPTIONS} onChange={set('teamSize')} /></Field>
      <Field label="Dificultad"><Seg name="difficulty" value={o.difficulty} options={DIFFICULTY_OPTIONS} onChange={set('difficulty')} /></Field>
      <Field label="Duración"><Seg name="matchTime" value={o.matchTime} options={TIME_OPTIONS} onChange={set('matchTime')} /></Field>
      <Field label="Tu equipo">
        <Seg name="team" value={o.team} onChange={set('team')} options={[{ value: 0, label: 'Azul', cls: 'blue' }, { value: 1, label: 'Naranja', cls: 'orange' }]} />
      </Field>
      <div className="actions">
        <button className="btn" onClick={() => engine.back()}>← Volver</button>
        <button className="btn primary" id="btn-start-bots" onClick={() => engine.startBots(o)}>¡Jugar!</button>
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Online
export function OnlineScreen() {
  const engine = useEngine();
  const settingsName = useGame((s) => s.settings.name);
  const online = useGame((s) => s.online);
  const invite = useGame((s) => s.invite);
  const [name, setName] = useState(settingsName);
  const [code, setCode] = useState(invite || '');
  const [room, setRoom] = useState({ teamSize: 2, bots: 1, difficulty: 'pro' });
  const saveName = () => {
    const n = name.trim().slice(0, 16);
    if (n && n !== settingsName) engine.updateSettings({ name: n });
  };
  const create = () => {
    saveName();
    engine.createRoom({ teamSize: room.teamSize, bots: !!room.bots, difficulty: room.difficulty });
  };
  const join = () => {
    saveName();
    engine.joinRoom(code);
  };
  return (
    <Screen name="online">
      <h2>Online con amigos</h2>
      <Field label="Tu nombre">
        <input id="input-name" maxLength={16} placeholder="Piloto" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <div className="two-col">
        <div className="card">
          <h3>Crear sala</h3>
          <Field label="Modo">
            <Seg name="roomTeamSize" value={room.teamSize} onChange={(v) => setRoom({ ...room, teamSize: v })} options={[{ value: 1, label: '1v1' }, { value: 2, label: '2v2' }, { value: 3, label: '3v3' }]} />
          </Field>
          <Field label="Rellenar con bots">
            <Seg name="roomBots" value={room.bots} onChange={(v) => setRoom({ ...room, bots: v })} options={[{ value: 1, label: 'Sí' }, { value: 0, label: 'No' }]} />
          </Field>
          <Field label="Bots">
            <Seg name="roomDifficulty" value={room.difficulty} onChange={(v) => setRoom({ ...room, difficulty: v })} options={DIFFICULTY_OPTIONS} />
          </Field>
          <button className="btn primary wide" id="btn-create-room" disabled={online.busy} onClick={create}>Crear sala</button>
        </div>
        <div className="card">
          <h3>Unirse a una sala</h3>
          <Field label="Código de sala">
            <input
              id="input-code" maxLength={6} placeholder="ABC123" className="code-input" value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') join(); }}
            />
          </Field>
          <button className="btn orange wide" id="btn-join-room" disabled={online.busy} onClick={join}>Unirse</button>
          <p className="hint">El micrófono se activa al entrar en la sala. Puedes silenciarlo con <kbd>M</kbd>.</p>
        </div>
      </div>
      <p className="hint" id="online-mode">{online.modeHint}</p>
      <div className="status" id="online-status">{online.status}</div>
      <div className="actions"><button className="btn" onClick={() => engine.nav('main', false)}>← Volver</button></div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Sala
function MemberItem({ m, selfId, host, speaking }) {
  return (
    <li className={`${m.id === selfId ? 'me' : ''} ${speaking ? 'speaking' : ''}`}>
      {m.mic ? '🎙️' : '🔇'} {m.name}{m.id === host ? ' 👑' : ''}
      <span className="tag">{m.id === selfId ? 'tú' : ''}</span>
    </li>
  );
}

function LobbyChat() {
  const engine = useEngine();
  const chat = useGame((s) => s.lobbyChat);
  const [text, setText] = useState('');
  useEffect(() => {
    const el = document.getElementById('lobby-chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);
  return (
    <div className="lobby-chat">
      <div id="lobby-chat-log">
        {chat.map((c) => (
          <div key={c.id}>
            {c.system
              ? <i style={{ color: '#ffd23f' }}>{c.text}</i>
              : <><b style={{ color: c.team === 0 ? '#9cc4ff' : c.team === 1 ? '#ffc08a' : '#d6dcf0' }}>{c.name}:</b> {c.text}</>}
          </div>
        ))}
      </div>
      <input
        id="lobby-chat-input" maxLength={140} placeholder="Chat de la sala…" autoComplete="off" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { engine.sendChat(text); setText(''); }
        }}
      />
    </div>
  );
}

function MicStatus() {
  const engine = useEngine();
  const voice = useGame((s) => s.voice);
  const level = useGame((s) => s.micLevel);
  let text = 'Micrófono desactivado';
  if (voice.active) {
    if (voice.error) text = voice.error;
    else if (!voice.hasTrack) text = 'Activando micrófono…';
    else if (voice.muted) text = 'Silenciado — pulsa M para hablar';
    else text = voice.ptt ? 'Pulsa V para hablar' : `Micrófono abierto · ${voice.connected} conectado(s) por voz`;
  }
  return (
    <>
      <div className="mic-meter">
        <div><div id="mic-level" style={{ width: `${Math.round(level * 100)}%` }} /></div>
        <span id="mic-status">{text}</span>
      </div>
      <button className="btn small" id="btn-mic" onClick={() => engine.toggleMute()}>
        {voice.muted || !voice.hasTrack ? '🔇 Activar micro' : '🎙️ Silenciar'}
      </button>
    </>
  );
}

export function Lobby() {
  const engine = useEngine();
  const room = useGame((s) => s.room);
  const selfId = useGame((s) => s.selfId);
  const speaking = useGame((s) => s.speaking);
  const isLocalHost = useGame((s) => s.isLocalHost);
  if (!room) {
    return <Screen name="lobby" className="panel wide-panel"><h2>Conectando…</h2></Screen>;
  }
  const isHost = room.host === selfId;
  const s = room.settings || {};
  const members = room.members || [];
  const column = (team) => {
    const list = members.filter((m) => m.team === team);
    const bots = team >= 0 && s.bots ? Math.max(0, s.teamSize - list.length) : 0;
    return (
      <ul id={team === 0 ? 'lobby-blue' : team === 1 ? 'lobby-orange' : 'lobby-spec'}>
        {list.map((m) => <MemberItem key={m.id} m={m} selfId={selfId} host={room.host} speaking={!!speaking[m.id]} />)}
        {Array.from({ length: bots }, (_, i) => <li key={`bot${i}`} className="bot">🤖 Bot<span className="tag">IA</span></li>)}
      </ul>
    );
  };
  const wait = room.inGame ? 'Partido en curso…'
    : isLocalHost ? 'Eres el anfitrión: no cierres ni minimices esta pestaña'
      : isHost ? 'Tú eres el anfitrión' : 'Esperando a que el anfitrión empiece…';
  return (
    <Screen name="lobby" className="panel wide-panel">
      <div className="lobby-head">
        <div>
          <div className="muted">Código de sala</div>
          <div className="room-code" id="lobby-code">{room.code}</div>
        </div>
        <div className="lobby-head-btns">
          <button className="btn small" id="btn-copy-link" onClick={() => engine.copyInvite()}>📋 Copiar invitación</button>
          <MicStatus />
        </div>
      </div>
      <div className="teams">
        <div className="team-col blue"><h3>Equipo Azul</h3>{column(0)}<button className="btn small blue" onClick={() => engine.setTeam(0)}>Unirse a Azul</button></div>
        <div className="team-col spec"><h3>Espectadores</h3>{column(-1)}<button className="btn small" onClick={() => engine.setTeam(-1)}>Ver partido</button></div>
        <div className="team-col orange"><h3>Equipo Naranja</h3>{column(1)}<button className="btn small orange" onClick={() => engine.setTeam(1)}>Unirse a Naranja</button></div>
      </div>
      <div className="host-settings">
        <Field label="Modo" inline>
          <Seg name="lobbyTeamSize" value={s.teamSize} disabled={!isHost} onChange={(v) => engine.updateRoomSettings({ teamSize: v })} options={[{ value: 1, label: '1v1' }, { value: 2, label: '2v2' }, { value: 3, label: '3v3' }]} />
        </Field>
        <Field label="Bots" inline>
          <Seg name="lobbyBots" value={s.bots ? 1 : 0} disabled={!isHost} onChange={(v) => engine.updateRoomSettings({ bots: !!v })} options={[{ value: 1, label: 'Sí' }, { value: 0, label: 'No' }]} />
        </Field>
        <Field label="Dificultad" inline>
          <Seg name="lobbyDifficulty" value={s.difficulty} disabled={!isHost} onChange={(v) => engine.updateRoomSettings({ difficulty: v })} options={[{ value: 'rookie', label: 'Princ.' }, { value: 'pro', label: 'Pro' }, { value: 'allstar', label: 'Leyenda' }]} />
        </Field>
        <Field label="Duración" inline>
          <Seg name="lobbyTime" value={s.matchTime} disabled={!isHost} onChange={(v) => engine.updateRoomSettings({ matchTime: v })} options={[{ value: 180, label: '3m' }, { value: 300, label: '5m' }, { value: 600, label: '10m' }]} />
        </Field>
      </div>
      <LobbyChat />
      <div className="actions">
        <button className="btn" id="btn-leave-room" onClick={() => engine.leaveToOnline()}>Salir</button>
        <span className="muted" id="lobby-wait">{wait}</span>
        {isHost && <button className="btn primary" id="btn-start-match" disabled={room.inGame} onClick={() => engine.startMatch()}>Empezar partido</button>}
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Garaje
export function Garage() {
  const engine = useEngine();
  const st = useGame((s) => s.settings);
  return (
    <Screen name="garage" className="panel garage">
      <h2>Garaje</h2>
      <Field label="Coche">
        <div className="car-grid" id="car-grid">
          {CAR_TYPES.map((type) => {
            const cfg = getCarConfig(type);
            return (
              <button key={type} className={st.carType === type ? 'on' : ''} onClick={() => engine.updateSettings({ carType: type })}>
                {cfg.name}<small>{Math.round(cfg.hitbox[0])}×{Math.round(cfg.hitbox[1])}×{Math.round(cfg.hitbox[2])}</small>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Color (equipo azul / naranja)">
        <div className="swatches">
          {TEAM_SHADES[0].map((blue, i) => (
            <div key={blue} className={`swatch ${st.colors.primary === i ? 'on' : ''}`} onClick={() => engine.updateSettings({ colors: { primary: i } })}>
              <div className="half" style={{ left: 0, background: blue }} />
              <div className="half r" style={{ background: TEAM_SHADES[1][i] }} />
            </div>
          ))}
        </div>
      </Field>
      <Field label="Color de acento">
        <div className="swatches">
          {ACCENTS.map((c) => (
            <div key={c} className={`swatch ${st.colors.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => engine.updateSettings({ colors: { accent: c } })} />
          ))}
        </div>
      </Field>
      <div className="actions"><button className="btn primary" onClick={() => engine.back()}>Guardar</button></div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Controles
const CONTROLS = [
  ['Acelerar / frenar', 'W / S', 'RT / LT'],
  ['Girar / guiñada', 'A D', 'Stick izq.'],
  ['Cabeceo (en el aire)', 'W S', 'Stick izq.'],
  ['Saltar / doble salto / flip', 'Espacio o clic der.', 'A'],
  ['Turbo', 'Shift o clic izq.', 'B'],
  ['Derrape / giro aéreo libre', 'Ctrl o X', 'X'],
  ['Giro aéreo izq. / der.', 'Q / E', 'LB / RB'],
  ['Cámara balón on/off', 'C', 'Y'],
  ['Marcador', 'Tab', 'View'],
  ['Silenciar micrófono', 'M', '—'],
  ['Pulsar para hablar (si está activado)', 'V', '—'],
  ['Chat', 'T / Enter', '—'],
  ['Entrenamiento: balón / coche', 'R / F', '—'],
  ['Pausa / menú', 'Esc', 'Start'],
];

export function Controls() {
  const engine = useEngine();
  return (
    <Screen name="controls">
      <h2>Controles</h2>
      <table className="controls-table">
        <thead><tr><th>Acción</th><th>Teclado / ratón</th><th>Mando</th></tr></thead>
        <tbody>
          {CONTROLS.map(([a, k, p]) => <tr key={a}><td>{a}</td><td>{k.split(' ').map((x, i) => (/^[A-Za-z]+$|^Espacio$|^Shift$|^Ctrl$|^Tab$|^Esc$|^Enter$/.test(x) ? <kbd key={i}>{x}</kbd> : <span key={i}> {x} </span>))}</td><td>{p}</td></tr>)}
        </tbody>
      </table>
      <div className="actions"><button className="btn" onClick={() => engine.back()}>← Volver</button></div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Ajustes
export function Settings() {
  const engine = useEngine();
  const st = useGame((s) => s.settings);
  const [mics, setMics] = useState([]);
  useEffect(() => { engine.listMicDevices().then(setMics); }, [engine]);
  const set = (patch) => engine.updateSettings(patch);
  return (
    <Screen name="settings">
      <h2>Ajustes</h2>
      <Field label="Cámara balón por defecto">
        <Seg setting name="ballCam" value={st.ballCam ? 1 : 0} onChange={(v) => set({ ballCam: !!v })} options={[{ value: 1, label: 'Sí' }, { value: 0, label: 'No' }]} />
      </Field>
      <Field label={<>Campo de visión: <b>{st.fov}</b>°</>}>
        <input type="range" min={70} max={110} step={1} value={st.fov} onChange={(e) => set({ fov: Number(e.target.value) })} />
      </Field>
      <Field label={<>Distancia de cámara: <b>{st.distance}</b></>}>
        <input type="range" min={200} max={400} step={5} value={st.distance} onChange={(e) => set({ distance: Number(e.target.value) })} />
      </Field>
      <Field label="Vibración de cámara">
        <Seg setting name="shake" value={st.shake ? 1 : 0} onChange={(v) => set({ shake: !!v })} options={[{ value: 1, label: 'Sí' }, { value: 0, label: 'No' }]} />
      </Field>
      <Field label="Calidad gráfica (requiere recargar)">
        <Seg setting name="quality" value={st.quality} onChange={(v) => { set({ quality: v }); engine.toast('Recarga la página para aplicar la calidad'); }} options={[{ value: 'low', label: 'Baja' }, { value: 'medium', label: 'Media' }, { value: 'high', label: 'Alta' }]} />
      </Field>
      <Field label={<>Volumen efectos: <b>{Math.round(st.volume * 100)}</b>%</>}>
        <input type="range" min={0} max={100} step={1} value={Math.round(st.volume * 100)} onChange={(e) => set({ volume: Number(e.target.value) / 100 })} />
      </Field>
      <Field label={<>Volumen voz: <b>{Math.round(st.voiceVolume * 100)}</b>%</>}>
        <input type="range" min={0} max={150} step={1} value={Math.round(st.voiceVolume * 100)} onChange={(e) => set({ voiceVolume: Number(e.target.value) / 100 })} />
      </Field>
      <Field label="Micrófono">
        <select value={st.micDeviceId || ''} onChange={(e) => set({ micDeviceId: e.target.value })}>
          <option value="">Predeterminado</option>
          {mics.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Modo de micrófono">
        <Seg setting name="micMode" value={st.micMode} onChange={(v) => set({ micMode: v })} options={[{ value: 'open', label: 'Siempre abierto' }, { value: 'ptt', label: 'Pulsar para hablar (V)' }]} />
      </Field>
      <div className="actions"><button className="btn primary" onClick={() => engine.back()}>Listo</button></div>
    </Screen>
  );
}

// ------------------------------------------------------------------ Pausa y final
export function Pause() {
  const engine = useEngine();
  const kind = useGame((s) => s.sessionKind);
  return (
    <Screen name="pause" className="panel small-panel">
      <h2>Pausa</h2>
      <div className="stack">
        <button className="btn primary wide" id="btn-resume" onClick={() => engine.resume()}>Continuar</button>
        {kind !== 'online' && <button className="btn wide" id="btn-restart" onClick={() => engine.restart()}>Reiniciar partido</button>}
        <button className="btn wide" onClick={() => engine.nav('settings')}>Ajustes</button>
        <button className="btn wide" onClick={() => engine.nav('controls')}>Controles</button>
        <button className="btn wide danger" id="btn-quit" onClick={() => engine.quit()}>Salir al menú</button>
      </div>
    </Screen>
  );
}

export function EndScreen() {
  const engine = useEngine();
  const end = useGame((s) => s.end);
  if (!end) return null;
  return (
    <Screen name="end" className="panel wide-panel">
      <h2 id="end-title">{end.title}</h2>
      <div id="end-score" className="end-score"><span className="b">{end.score[0]}</span> – <span className="o">{end.score[1]}</span></div>
      <div id="end-stats"><StatsTable players={end.players} localId={end.localId} /></div>
      <div className="actions">
        <button className="btn" id="btn-end-menu" onClick={() => engine.endMenu()}>
          {end.online ? (end.isHost ? 'Volver a la sala' : 'Salir de la sala') : 'Menú'}
        </button>
        {end.isHost && <button className="btn primary" id="btn-rematch" onClick={() => engine.rematch()}>Revancha</button>}
      </div>
    </Screen>
  );
}
