import * as THREE from 'three';

// Sistema de particulas en GPU (un solo draw call)
const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor * (1.0 + a), a);
  }
`;

export class Particles {
  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.geo = geo;
  }

  setViewport(height, fov) {
    this.mat.uniforms.uScale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.grow[i] = opts.grow ?? 1;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.gravity ?? 0;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; } continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp; this.vel[i3 + 1] *= damp; this.vel[i3 + 2] = this.vel[i3 + 2] * damp + this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * t;
      this.size[i] *= 1 + (this.grow[i] - 1) * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  burst(x, y, z, color, count, speed, size, life, opts = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.3 + Math.random() * 0.7);
      dx = (dx / l) * s; dy = (dy / l) * s; dz = (dz / l) * s + (opts.up || 0);
      const v = 0.75 + Math.random() * 0.5;
      this.spawn(x, y, z, dx, dy, dz, c.r * v, c.g * v, c.b * v, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), opts);
    }
  }
}

// Onda expansiva (anillo) para goles y demoliciones
export class Shockwaves {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.SphereGeometry(1, 32, 16);
  }

  add(x, y, z, color, maxR, duration) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.geo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(1);
    this.scene.add(m);
    this.list.push({ m, t: 0, maxR, duration });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      const k = s.t / s.duration;
      if (k >= 1) {
        this.scene.remove(s.m);
        s.m.material.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      s.m.scale.setScalar(10 + e * s.maxR);
      s.m.material.opacity = 0.7 * (1 - k);
    }
  }
}
