const KEY = 'turboliga.settings.v1';

const DEFAULTS = {
  name: '',
  carType: 'octane',
  colors: { primary: 0, accent: '#ffffff' },
  ballCam: true,
  fov: 110,
  distance: 270,
  shake: true,
  quality: 'high',
  volume: 0.7,
  voiceVolume: 1,
  micDeviceId: '',
  micMode: 'open',
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  const merged = { ...DEFAULTS, ...s, colors: { ...DEFAULTS.colors, ...(s.colors || {}) } };
  if (!merged.name) merged.name = `Piloto${Math.floor(100 + Math.random() * 900)}`;
  return merged;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* modo privado */ }
}
