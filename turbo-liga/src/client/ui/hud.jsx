import { useEffect, useRef, useState } from 'react';
import { useEngine, useGame, StatsTable } from './common.jsx';

function Scoreboard() {
  const h = useGame((s) => ({ blue: s.hud.blue, orange: s.hud.orange, clock: s.hud.clock, ot: s.hud.ot }));
  return (
    <div id="scoreboard">
      <div className="sb-team blue"><span>AZUL</span><b id="score-blue">{h.blue}</b></div>
      <div id="clock" className={h.ot ? 'ot' : ''}>{h.clock}</div>
      <div className="sb-team orange"><b id="score-orange">{h.orange}</b><span>NARANJA</span></div>
    </div>
  );
}

function BoostMeter() {
  const h = useGame((s) => ({ boost: s.hud.boost, speed: s.hud.speed, meters: s.hud.meters }));
  if (!h.meters) return null;
  return (
    <>
      <div id="boost-meter">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" className="bm-bg" />
          <circle cx="60" cy="60" r="50" className="bm-fg" style={{ strokeDasharray: `${(h.boost / 100) * 235.6} 314.2` }} />
        </svg>
        <div className="bm-val"><b id="boost-value">{h.boost}</b></div>
      </div>
      <div id="speedo"><b>{h.speed}</b> km/h</div>
    </>
  );
}

function CenterMessage() {
  const m = useGame((s) => ({ msg: s.hud.msg, cls: s.hud.msgCls, sub: s.hud.msgSub, key: s.hud.msgKey }));
  return (
    <>
      <div id="center-msg" key={m.key} className={`${m.msg ? 'anim' : ''} ${m.cls}`}>{m.msg}</div>
      <div id="sub-msg">{m.msg ? m.sub : ''}</div>
    </>
  );
}

function Feed() {
  const feed = useGame((s) => s.feed);
  return (
    <div id="feed">
      {feed.map((f) => <div key={f.id} className={f.team === 0 ? 'b' : f.team === 1 ? 'o' : ''}>{f.text}</div>)}
    </div>
  );
}

function VoicePanel() {
  const list = useGame((s) => s.voiceList);
  return (
    <div id="voice-panel">
      {list.map((v) => (
        <div key={v.id} className={`vp ${v.team === 0 ? 'b' : v.team === 1 ? 'o' : ''} ${v.speaking ? 'speaking' : ''}`}>
          <span className="mic">{v.mic ? '🎙️' : '🔇'}</span>{v.name}
        </div>
      ))}
    </div>
  );
}

function GameChat() {
  const engine = useEngine();
  const chat = useGame((s) => s.gameChat);
  const open = useGame((s) => s.chatOpen);
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 0); }, [open]);
  return (
    <div id="chat">
      <div id="chat-log">
        {chat.map((c) => (
          <div key={c.id} className={c.old ? 'old' : ''}>
            {c.system
              ? <i style={{ color: '#ffd23f' }}>{c.text}</i>
              : <><b style={{ color: c.team === 0 ? '#9cc4ff' : c.team === 1 ? '#ffc08a' : '#d6dcf0' }}>{c.name}:</b> {c.text}</>}
          </div>
        ))}
      </div>
      {open && (
        <input
          id="chat-input" ref={ref} maxLength={140} placeholder="Escribe y pulsa Enter…" autoComplete="off" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { engine.sendChat(text); setText(''); e.currentTarget.blur(); }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          onBlur={() => engine.setChatOpen(false)}
        />
      )}
    </div>
  );
}

function StatsOverlay() {
  const open = useGame((s) => s.statsOpen);
  const players = useGame((s) => s.statsPlayers);
  const engine = useEngine();
  if (!open) return null;
  return <div id="stats-table"><StatsTable players={players} localId={engine.session?.localCarId} /></div>;
}

// Stick y botones en pantalla para moviles y tablets
function TouchControls() {
  const engine = useEngine();
  const stickRef = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const stickId = useRef(null);
  useEffect(() => {
    const move = (e) => {
      for (const t of e.changedTouches) if (t.identifier === stickId.current) update(t.clientX, t.clientY);
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId.current) {
          stickId.current = null;
          setKnob({ x: 0, y: 0 });
          engine.setTouch({ stick: false, steer: 0, throttle: 0 });
        }
      }
    };
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  });
  const update = (x, y) => {
    const r = stickRef.current.getBoundingClientRect();
    let dx = (x - (r.left + r.width / 2)) / (r.width / 2), dy = (y - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    setKnob({ x: dx, y: dy });
    engine.setTouch({ stick: true, steer: Math.abs(dx) < 0.15 ? 0 : dx, throttle: -dy });
  };
  const button = (key, label) => (
    <button
      data-tc={key}
      onTouchStart={(e) => { e.preventDefault(); engine.setTouch({ [key]: true }); }}
      onTouchEnd={(e) => { e.preventDefault(); engine.setTouch({ [key]: false }); }}
      onTouchCancel={() => engine.setTouch({ [key]: false })}
    >
      {label}
    </button>
  );
  return (
    <div id="touch-controls">
      <div
        id="tc-stick" ref={stickRef}
        onTouchStart={(e) => { e.preventDefault(); stickId.current = e.changedTouches[0].identifier; update(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }}
      >
        <div id="tc-knob" style={{ transform: `translate(${knob.x * 45}px, ${knob.y * 45}px)` }} />
      </div>
      {button('jump', 'SALTO')}
      {button('boost', 'TURBO')}
      {button('drift', 'DERRAPE')}
      <button id="tc-pause" onClick={() => engine.pause()} onTouchStart={(e) => { e.preventDefault(); engine.pause(); }}>⏸</button>
    </div>
  );
}

export function Hud() {
  const fps = useGame((s) => s.hud.fps);
  const hint = useGame((s) => s.hud.hint);
  const isTouch = useGame((s) => s.isTouch);
  const menuOpen = useGame((s) => s.screen !== null);
  return (
    <div id="hud">
      <Scoreboard />
      <div id="net-stats">{fps}</div>
      <Feed />
      <CenterMessage />
      <VoicePanel />
      <BoostMeter />
      <GameChat />
      <div id="hud-hint">{hint}</div>
      <StatsOverlay />
      {isTouch && !menuOpen && <TouchControls />}
    </div>
  );
}
