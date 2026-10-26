// Matematica vectorial minima y sin dependencias (compartida cliente/servidor).

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() {
    const l = this.length();
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  clampLength(max) {
    const l2 = this.lengthSq();
    if (l2 > max * max) this.scale(max / Math.sqrt(l2));
    return this;
  }
  distanceTo(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  applyQuat(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  applyQuatInv(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  normalize() {
    let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l < 1e-12) { this.set(0, 0, 0, 1); return this; }
    l = 1 / l;
    this.x *= l; this.y *= l; this.z *= l; this.w *= l;
    return this;
  }
  setFromAxisAngle(ax, ay, az, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = ax * s; this.y = ay * s; this.z = az * s; this.w = Math.cos(h);
    return this;
  }
  // yaw (Z), pitch (Y local, positivo = morro arriba), roll (X local)
  setFromEuler(yaw, pitch = 0, roll = 0) {
    const qy = new Quat().setFromAxisAngle(0, 0, 1, yaw);
    const qp = new Quat().setFromAxisAngle(0, 1, 0, -pitch);
    const qr = new Quat().setFromAxisAngle(1, 0, 0, roll);
    return this.copy(qy).multiply(qp).multiply(qr);
  }
  multiply(b) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  // Integra una velocidad angular (mundo) durante dt
  integrate(w, dt) {
    const ang = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
    if (ang < 1e-9) return this;
    const a = ang * dt;
    const s = Math.sin(a / 2) / ang;
    const dx = w.x * s, dy = w.y * s, dz = w.z * s, dw = Math.cos(a / 2);
    // q = dq * q
    const x = this.x, y = this.y, z = this.z, qw = this.w;
    this.x = dw * x + dx * qw + dy * z - dz * y;
    this.y = dw * y + dy * qw + dz * x - dx * z;
    this.z = dw * z + dz * qw + dx * y - dy * x;
    this.w = dw * qw - dx * x - dy * y - dz * z;
    return this.normalize();
  }
  slerp(qb, t) {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    const x = this.x, y = this.y, z = this.z, w = this.w;
    let cos = w * qb.w + x * qb.x + y * qb.y + z * qb.z;
    let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cos > 0.9995) {
      this.x = x + (bx - x) * t; this.y = y + (by - y) * t;
      this.z = z + (bz - z) * t; this.w = w + (bw - w) * t;
      return this.normalize();
    }
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    const ra = Math.sin((1 - t) * theta) / sin, rb = Math.sin(t * theta) / sin;
    this.x = x * ra + bx * rb; this.y = y * ra + by * rb;
    this.z = z * ra + bz * rb; this.w = w * ra + bw * rb;
    return this;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const lerp = (a, b, t) => a + (b - a) * t;
