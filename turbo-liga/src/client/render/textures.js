import * as THREE from 'three';
import { ARENA_EXTENT_X, ARENA_EXTENT_Y, GOAL_HALF_WIDTH } from '../../shared/constants.js';
import { planSD } from '../../shared/arena.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Cesped con franjas, lineas del campo y mitades tintadas por equipo
export function makeFieldTexture(maxAniso = 8) {
  const W = 2048, H = 2560; // 4 uu por pixel
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const sx = W / (ARENA_EXTENT_X * 2), sy = H / (ARENA_EXTENT_Y * 2);
  const toPx = (x, y) => [(x + ARENA_EXTENT_X) * sx, (ARENA_EXTENT_Y - y) * sy];

  // franjas
  const stripes = 20;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f7d32' : '#36893a';
    g.fillRect(0, (i * H) / stripes, W, H / stripes + 1);
  }
  // ruido de hierba
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  // tinte de equipo cerca de cada porteria
  let grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,120,20,0.20)');
  grad.addColorStop(0.35, 'rgba(255,120,20,0.0)');
  grad.addColorStop(0.65, 'rgba(30,110,255,0.0)');
  grad.addColorStop(1, 'rgba(30,110,255,0.22)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // lineas
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  // contorno del campo
  g.beginPath();
  const N = 400;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    // buscar el borde a lo largo de la direccion a (busqueda binaria sobre el SDF en planta)
    let lo = 0, hi = 7000;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (planSD(Math.cos(a) * m, Math.sin(a) * m) < -60) lo = m; else hi = m;
    }
    const [px, py] = toPx(Math.cos(a) * lo, Math.sin(a) * lo);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
  // linea central
  g.beginPath();
  let [x0, y0] = toPx(-ARENA_EXTENT_X + 60, 0);
  let [x1, y1] = toPx(ARENA_EXTENT_X - 60, 0);
  g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  // circulo central
  const [cx, cy] = toPx(0, 0);
  g.beginPath(); g.arc(cx, cy, 1000 * sx, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(cx, cy, 60 * sx, 0, Math.PI * 2); g.fill();
  // areas
  for (const s of [-1, 1]) {
    const yLine = s * (ARENA_EXTENT_Y - 60);
    const boxW = GOAL_HALF_WIDTH + 700, boxD = 1400;
    const [ax, ay] = toPx(-boxW, yLine - s * boxD);
    const [bx, by] = toPx(boxW, yLine);
    g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    const [cx2, cy2] = toPx(-GOAL_HALF_WIDTH - 150, yLine - s * 550);
    const [dx2, dy2] = toPx(GOAL_HALF_WIDTH + 150, yLine);
    g.strokeRect(Math.min(cx2, dx2), Math.min(cy2, dy2), Math.abs(dx2 - cx2), Math.abs(dy2 - cy2));
    // semicirculo
    const [sx2, sy2] = toPx(0, yLine - s * boxD);
    g.beginPath();
    if (s > 0) g.arc(sx2, sy2, 600 * sx, 0, Math.PI); else g.arc(sx2, sy2, 600 * sx, Math.PI, Math.PI * 2);
    g.stroke();
  }
  // logo central
  g.save();
  g.translate(cx, cy);
  g.font = 'bold 120px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.rotate(-Math.PI / 2);
  g.fillText('TURBO LIGA', 0, 0);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// Textura del balon: paneles hexagonales grises con nucleo brillante
export function makeBallTexture() {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#e8e8ec';
  g.fillRect(0, 0, W, H);
  const r = 46;
  const hexH = Math.sqrt(3) * r;
  for (let row = -1; row < H / hexH + 1; row++) {
    for (let col = -1; col < W / (r * 1.5) + 1; col++) {
      const x = col * r * 1.5;
      const y = row * hexH + (col % 2 ? hexH / 2 : 0);
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        const px = x + Math.cos(a) * (r - 4), py = y + Math.sin(a) * (r - 4);
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      const shade = (row + col) % 3 === 0 ? '#9aa0aa' : '#d9dbe0';
      g.fillStyle = shade;
      g.fill();
      g.strokeStyle = '#5a5e66';
      g.lineWidth = 3;
      g.stroke();
    }
  }
  // franja ecuatorial luminosa
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillRect(0, H / 2 - 6, W, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Red de porteria
export function makeNetTexture() {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, S / 2); g.lineTo(S / 2, 0); g.lineTo(S, S / 2); g.lineTo(S / 2, S); g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Paneles de los muros (rejilla hexagonal tenue)
export function makeWallTexture() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.0)';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  g.strokeRect(2, 2, S - 4, S - 4);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Publico en las gradas
export function makeCrowdTexture() {
  const W = 512, H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#15171f';
  g.fillRect(0, 0, W, H);
  const colors = ['#ff7a1a', '#1f6fff', '#ffffff', '#ffd23f', '#e94b4b', '#7fd1ff', '#333845', '#555b6b'];
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const x = Math.random() * W, y = Math.random() * H;
    g.fillRect(x, y, 3, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeSkyTexture() {
  const c = canvas(16, 512);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0b1030');
  grad.addColorStop(0.45, '#27306b');
  grad.addColorStop(0.62, '#e0735a');
  grad.addColorStop(0.7, '#ffb46b');
  grad.addColorStop(1, '#1a1a24');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

export function makeGlowTexture() {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function makeLabelTexture(text, color = '#ffffff') {
  const c = canvas(512, 96);
  const g = c.getContext('2d');
  g.font = 'bold 54px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 256, 48);
  g.fillStyle = color;
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
