import { PHASE } from '../shared/game.js';
import { TEAM_BLUE } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatClock(t, overtime) {
  const s = Math.max(0, overtime ? Math.floor(t) : Math.ceil(t));
  const m = Math.floor(s / 60);
  return `${overtime ? '+' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.centerMsg = $('center-msg');
    this.subMsg = $('sub-msg');
    this.msgTimer = 0;
    this.lastCountdown = -1;
    this.feed = $('feed');
    this.chatLog = $('chat-log');
    this.voicePanel = $('voice-panel');
    this.statsEl = $('stats-table');
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  flash(text, cls = '', sub = '', time = 1.2) {
    this.centerMsg.textContent = text;
    this.centerMsg.className = `anim ${cls}`;
    void this.centerMsg.offsetWidth;
    this.subMsg.textContent = sub;
    this.msgTimer = time;
  }

  update(session, dt) {
    const game = session.game;
    $('score-blue').textContent = game.score[0];
    $('score-orange').textContent = game.score[1];
    const clock = $('clock');
    if (game.opts.freePlay) clock.textContent = 'LIBRE';
    else clock.textContent = formatClock(game.timeLeft, game.overtime);
    clock.classList.toggle('ot', !!game.overtime);

    const me = session.localCarId != null ? game.world.getCar(session.localCarId) : null;
    $('boost-meter').classList.toggle('hidden', !me);
    $('speedo').classList.toggle('hidden', !me);
    if (me) {
      const b = Math.round(me.boost);
      $('boost-value').textContent = b;
      $('boost-ring').style.strokeDasharray = `${(b / 100) * 235.6} 314.2`;
      $('speed-value').textContent = Math.round(me.vel.length() * 0.036);
    }

    // mensajes centrales
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
      if (this.msgTimer <= 0) { this.centerMsg.textContent = ''; this.subMsg.textContent = ''; }
    }
  }

  playerName(session, id) {
    const p = session.game.players.get(id);
    return p ? p.name : '?';
  }

  teamClass(session, id) {
    const p = session.game.players.get(id);
    return p && p.team === TEAM_BLUE ? 'b' : 'o';
  }

  onEvent(e, session) {
    switch (e.type) {
      case 'go': this.flash('¡YA!', '', '', 0.8); break;
      case 'overtime': this.flash('PRÓRROGA', '', 'El próximo gol gana', 2); break;
      case 'goal': {
        const scorer = e.scorer >= 0 ? this.playerName(session, e.scorer) : '';
        const kmh = Math.round(e.speed * 0.036);
        const cls = e.team === TEAM_BLUE ? 'blue' : 'orange';
        const assist = e.assist >= 0 ? ` · asist. ${this.playerName(session, e.assist)}` : '';
        this.flash('¡GOL!', cls, `${scorer}${assist} · ${kmh} km/h`, 2.6);
        if (scorer) this.addFeed(`⚽ ${esc(scorer)} marcó${esc(assist)}`, e.team === TEAM_BLUE ? 'b' : 'o');
        break;
      }
      case 'demo':
        this.addFeed(`💥 ${esc(this.playerName(session, e.by))} demolió a ${esc(this.playerName(session, e.car))}`, this.teamClass(session, e.by));
        break;
      case 'save':
        this.addFeed(`🧤 ¡Parada de ${esc(this.playerName(session, e.car))}!`, this.teamClass(session, e.car));
        break;
      default: break;
    }
  }

  addFeed(html, cls) {
    const d = document.createElement('div');
    d.className = cls || '';
    d.innerHTML = html;
    this.feed.appendChild(d);
    setTimeout(() => d.remove(), 5000);
    while (this.feed.children.length > 5) this.feed.firstChild.remove();
  }

  addChat(name, text, team, system = false) {
    const d = document.createElement('div');
    const color = team === 0 ? '#9cc4ff' : team === 1 ? '#ffc08a' : '#d6dcf0';
    d.innerHTML = system ? `<i style="color:#ffd23f">${esc(text)}</i>` : `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}`;
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  // list: [{id, name, team, mic, speaking}]
  setVoice(list) {
    if (!list || !list.length) { this.voicePanel.innerHTML = ''; return; }
    const html = list.map((v) => `<div class="vp ${v.team === 0 ? 'b' : v.team === 1 ? 'o' : ''} ${v.speaking ? 'speaking' : ''}"><span class="mic">${v.mic ? '🎙️' : '🔇'}</span>${esc(v.name)}</div>`).join('');
    if (html !== this._lastVoice) { this.voicePanel.innerHTML = html; this._lastVoice = html; }
  }

  showStats(v, session) {
    this.statsEl.classList.toggle('hidden', !v);
    if (v) this.statsEl.innerHTML = statsTable(session.game.playerList(), session.localCarId);
  }
}

export function statsTable(players, localId) {
  const row = (p) => `<tr class="${p.team === 0 ? 'b' : 'o'} ${p.id === localId ? 'me' : ''}"><td>${esc(p.name)}</td><td>${p.points}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.saves}</td><td>${p.shots}</td><td>${p.demos}</td></tr>`;
  const blue = players.filter((p) => p.team === 0).sort((a, b) => b.points - a.points);
  const orange = players.filter((p) => p.team === 1).sort((a, b) => b.points - a.points);
  return `<table class="stats"><tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Paradas</th><th>Tiros</th><th>Demos</th></tr>
    ${blue.map(row).join('')}<tr class="sep"><td colspan="7"></td></tr>${orange.map(row).join('')}</table>`;
}

export { esc };
