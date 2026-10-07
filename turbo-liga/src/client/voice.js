// Chat de voz entre los jugadores de la sala: malla WebRTC (audio P2P) con señalizacion por el servidor.
export class Voice {
  constructor({ send, iceServers, onChange, onDeviceFallback }) {
    this.send = send; // (to, data) => void
    this.iceServers = iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    this.onChange = onChange || (() => {});
    this.onDeviceFallback = onDeviceFallback || (() => {}); // el micro guardado no existe: se usa el predeterminado
    this.selfId = null;
    this.peers = new Map(); // id -> {pc, audio, src, gain, analyser, level, speaking}
    this.destroyed = false;
    this.localStream = null;
    this.localTrack = null;
    this.localSource = null;
    this.muted = false;
    this.pttMode = false;
    this.pttDown = false;
    this.volume = 1;
    this.ctx = null;
    this.localAnalyser = null;
    this.localLevel = 0;
    this.micError = null;
    this._raf = null;
    this._startMeter();
  }

  _audioCtx() {
    if (this.destroyed) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        // al arrancar el contexto ya se puede subir la voz por encima del 100 %
        this.ctx.onstatechange = () => { for (const p of this.peers.values()) this._applyVolume(p); };
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async enableMic(deviceId) {
    this.micError = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micError = 'Este navegador no permite usar el micrófono (¿sin HTTPS?)';
      this.onChange();
      return false;
    }
    const ask = (id) => navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      },
      video: false,
    });
    try {
      let stream, fellBack = false;
      try {
        stream = await ask(deviceId);
      } catch (e) {
        // micro guardado desconectado o con id renovado: probar con el predeterminado
        if (!deviceId || this.destroyed || (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError')) throw e;
        stream = await ask(null);
        fellBack = true;
      }
      // se cerro la voz (salida de la sala) mientras se pedia permiso: soltar el micro
      if (this.destroyed) { stream.getTracks().forEach((t) => t.stop()); return false; }
      if (fellBack) this.onDeviceFallback();
      if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = stream;
      this.localTrack = stream.getAudioTracks()[0];
      this._applyTrackEnabled();
      // analizador local (para el medidor)
      const ctx = this._audioCtx();
      if (ctx) {
        if (this.localSource) this.localSource.disconnect();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        this.localSource = src;
        this.localAnalyser = an;
      }
      for (const peer of this.peers.values()) this._attachLocalTrack(peer);
      this.onChange();
      return true;
    } catch (e) {
      if (this.destroyed) return false;
      this.micError = e && e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado' : 'No se pudo abrir el micrófono';
      this.onChange();
      return false;
    }
  }

  get micOn() { return !!this.localTrack && !this.muted; }

  setMuted(m) {
    this.muted = m;
    this._applyTrackEnabled();
    this.onChange();
  }

  setPtt(mode) { this.pttMode = mode; this._applyTrackEnabled(); }
  setPttDown(down) { this.pttDown = down; this._applyTrackEnabled(); }

  _applyTrackEnabled() {
    if (this.localTrack) this.localTrack.enabled = !this.muted && (!this.pttMode || this.pttDown);
  }

  setVolume(v) {
    this.volume = v;
    for (const p of this.peers.values()) this._applyVolume(p);
  }

  // Hasta el 100 % suena el <audio> (camino nativo, mejor cancelacion de eco). Por encima se silencia
  // y suena por la ganancia de WebAudio; el <audio> sigue conectado porque Chrome lo necesita para
  // que WebAudio reciba el audio remoto.
  _applyVolume(p) {
    const boost = this.volume > 1 && !!p.gain && this.ctx?.state === 'running';
    if (p.audio) {
      p.audio.volume = Math.min(1, this.volume);
      p.audio.muted = boost;
      if (boost && p.audio.paused) p.audio.play().catch(() => {});
    }
    if (p.gain) p.gain.gain.value = boost ? this.volume : 0;
  }

  // Sincroniza la malla con la lista de miembros de la sala
  setPeers(ids, selfId) {
    this.selfId = selfId;
    const want = new Set(ids.filter((id) => id !== selfId));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this._closePeer(id);
    for (const id of want) {
      if (!this.peers.has(id)) {
        const peer = this._createPeer(id);
        // el de id mayor inicia la conexion (evita ofertas cruzadas)
        if (selfId > id) this._makeOffer(peer);
      }
    }
    this.onChange();
  }

  _createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { id, pc, audio: null, analyser: null, level: 0, speaking: false, transceiver: null, state: 'new' };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { type: 'ice', candidate: e.candidate }); };
    pc.ontrack = (e) => this._onTrack(peer, e);
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'failed' && this.selfId > id) {
        // reintentar con reinicio de ICE
        this._makeOffer(peer, true);
      }
      this.onChange();
    };
    return peer;
  }

  _attachLocalTrack(peer) {
    const tr = peer.transceiver || peer.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
    if (!tr) return;
    peer.transceiver = tr;
    try { tr.direction = 'sendrecv'; } catch { /* */ }
    tr.sender.replaceTrack(this.localTrack || null).catch(() => {});
  }

  async _makeOffer(peer, iceRestart = false) {
    const pc = peer.pc;
    if (!peer.transceiver) {
      peer.transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.localTrack) peer.transceiver.sender.replaceTrack(this.localTrack).catch(() => {});
    }
    try {
      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);
      this.send(peer.id, { type: 'offer', sdp: pc.localDescription });
    } catch (e) { console.warn('offer', e); }
  }

  async handleSignal(from, data) {
    let peer = this.peers.get(from);
    if (!peer) peer = this._createPeer(from);
    const pc = peer.pc;
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(data.sdp);
        this._attachLocalTrack(peer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send(from, { type: 'answer', sdp: pc.localDescription });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(data.sdp);
      } else if (data.type === 'ice' && data.candidate) {
        await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) { console.warn('signal', e); }
  }

  _onTrack(peer, e) {
    const stream = e.streams[0] || new MediaStream([e.track]);
    if (!peer.audio) {
      peer.audio = document.createElement('audio');
      peer.audio.autoplay = true;
      peer.audio.playsInline = true;
      document.body.appendChild(peer.audio);
    }
    peer.audio.srcObject = stream;
    const ctx = this._audioCtx();
    if (ctx) {
      try {
        if (peer.src) peer.src.disconnect();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        if (!peer.gain) {
          peer.gain = ctx.createGain();
          peer.gain.gain.value = 0;
          peer.gain.connect(ctx.destination);
        }
        src.connect(peer.gain);
        peer.src = src;
        peer.analyser = an;
      } catch { /* */ }
    }
    this._applyVolume(peer);
    peer.audio.play().catch(() => { this.needsGesture = true; this.onChange(); });
  }

  resumeAudio() {
    this.needsGesture = false;
    this._audioCtx();
    for (const p of this.peers.values()) p.audio?.play().catch(() => {});
  }

  _closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    try { p.src?.disconnect(); p.gain?.disconnect(); } catch { /* */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(id);
  }

  _level(an) {
    if (!an) return 0;
    const buf = this._buf || (this._buf = new Uint8Array(512));
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < an.fftSize; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / an.fftSize);
  }

  _startMeter() {
    let last = 0;
    const loop = (t) => {
      this._raf = requestAnimationFrame(loop);
      if (t - last < 60) return;
      last = t;
      this.localLevel = this.micOn && this.localTrack?.enabled ? this._level(this.localAnalyser) : 0;
      let changed = false;
      for (const p of this.peers.values()) {
        p.level = this._level(p.analyser);
        const sp = p.level > 0.02;
        if (sp !== p.speaking) { p.speaking = sp; changed = true; }
      }
      const ls = this.localLevel > 0.02;
      if (ls !== this.localSpeaking) { this.localSpeaking = ls; changed = true; }
      if (changed) this.onChange();
    };
    this._raf = requestAnimationFrame(loop);
  }

  isSpeaking(id) {
    if (id === this.selfId) return !!this.localSpeaking;
    return !!this.peers.get(id)?.speaking;
  }

  connectedCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.state === 'connected') n++;
    return n;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this._raf);
    for (const id of [...this.peers.keys()]) this._closePeer(id);
    if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localTrack = null;
    this.localSource = null;
    this.localAnalyser = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
