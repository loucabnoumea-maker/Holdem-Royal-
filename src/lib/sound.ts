// Sons synthétisés avec WebAudio (aucun fichier audio à charger).
export type SoundName = 'card' | 'chip' | 'check' | 'fold' | 'turn' | 'win' | 'lose' | 'message';

const KEY = 'poker.sound';
let ctx: AudioContext | null = null;
let enabled = readPref();

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundOn() {
  return enabled;
}

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* stockage indisponible */
  }
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.15) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(start: number, dur: number, freq: number, gain = 0.2, q = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export function play(name: SoundName) {
  if (!enabled) return;
  switch (name) {
    case 'card':
      noise(0, 0.09, 3200, 0.25, 0.8);
      break;
    case 'chip':
      tone(2400, 0, 0.05, 'triangle', 0.08);
      tone(3100, 0.04, 0.05, 'triangle', 0.06);
      noise(0, 0.05, 5000, 0.12, 3);
      break;
    case 'check':
      tone(180, 0, 0.08, 'sine', 0.25);
      tone(160, 0.11, 0.08, 'sine', 0.2);
      break;
    case 'fold':
      noise(0, 0.18, 900, 0.18, 0.6);
      break;
    case 'turn':
      tone(880, 0, 0.18, 'sine', 0.12);
      tone(1320, 0.12, 0.25, 'sine', 0.1);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.1));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(f, i * 0.14, 0.35, 'sine', 0.1));
      break;
    case 'message':
      tone(1200, 0, 0.08, 'sine', 0.07);
      break;
  }
}
