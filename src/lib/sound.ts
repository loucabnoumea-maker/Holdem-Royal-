// Sons synthétisés avec WebAudio (aucun fichier audio à charger).
// Tout passe par un bus commun : compresseur + petite réverbération de salle,
// et chaque son varie légèrement à chaque lecture pour ne pas sonner « robot ».
export type SoundName =
  | 'card' // carte qui glisse sur le tapis
  | 'flip' // carte retournée
  | 'chip' // un jeton posé
  | 'chips' // une pile de jetons (paiement, ramassage)
  | 'shuffle' // mélange du sabot
  | 'check'
  | 'fold'
  | 'turn'
  | 'win'
  | 'bigwin'
  | 'blackjack'
  | 'push'
  | 'bust'
  | 'lose'
  | 'side' // pari annexe gagné
  | 'tap' // petit clic d'interface
  | 'message';

const KEY = 'poker.sound';
let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let wet: GainNode | null = null;
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

/** Réponse impulsionnelle synthétique : une petite pièce feutrée. */
function impulse(a: AudioContext, seconds = 0.9, decay = 3.2) {
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      comp.connect(master).connect(ctx.destination);
      bus = ctx.createGain();
      bus.connect(comp);
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx);
      wet = ctx.createGain();
      wet.gain.value = 0.22;
      wet.connect(verb).connect(comp);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const vary = (x: number, amount = 0.06) => x * (1 + (Math.random() * 2 - 1) * amount);

function out(a: AudioContext, node: AudioNode, reverb = 0.3) {
  node.connect(bus!);
  if (reverb > 0) {
    const g = a.createGain();
    g.gain.value = reverb;
    node.connect(g).connect(wet!);
  }
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Fréquence d'arrivée (glissando). */
  to?: number;
  reverb?: number;
  detune?: number;
}

function tone(freq: number, start: number, dur: number, o: ToneOpts = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const peak = o.gain ?? 0.15;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  out(a, g, o.reverb ?? 0.3);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  gain?: number;
  q?: number;
  type?: BiquadFilterType;
  /** Fréquence de filtre d'arrivée (balayage). */
  to?: number;
  attack?: number;
  reverb?: number;
}

function noise(start: number, dur: number, freq: number, o: NoiseOpts = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  f.Q.value = o.q ?? 1;
  const g = a.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  out(a, g, o.reverb ?? 0.15);
  src.start(t);
}

/** Choc de jeton en céramique : partiels inharmoniques très brefs + transitoire. */
function clack(start: number, level = 1) {
  const base = vary(2900, 0.1);
  [1, 1.47, 2.09, 2.76].forEach((r, i) => tone(base * r, start, vary(0.07 - i * 0.012, 0.15), { type: 'sine', gain: (0.09 / (i + 1)) * level, attack: 0.001, reverb: 0.25 }));
  noise(start, 0.025, vary(6500), { gain: 0.16 * level, q: 2, attack: 0.001 });
  tone(vary(420), start, 0.05, { type: 'sine', gain: 0.05 * level, attack: 0.001, reverb: 0 });
}

/** Glissé d'une carte puis contact avec le tapis. */
function slide(start: number, level = 1) {
  noise(start, vary(0.13), vary(5200), { to: 1800, gain: 0.18 * level, q: 0.7, attack: 0.015 });
  noise(start + 0.11, 0.05, 900, { type: 'lowpass', gain: 0.22 * level, attack: 0.002 });
  tone(vary(140), start + 0.11, 0.07, { gain: 0.09 * level, attack: 0.002, reverb: 0 });
}

function bell(freq: number, start: number, dur = 0.9, gain = 0.07) {
  tone(freq, start, dur, { type: 'sine', gain, attack: 0.004, reverb: 0.6 });
  tone(freq * 2.01, start, dur * 0.6, { type: 'sine', gain: gain * 0.35, attack: 0.004, reverb: 0.6 });
  tone(freq * 3.02, start, dur * 0.3, { type: 'triangle', gain: gain * 0.15, attack: 0.002, reverb: 0.6 });
}

export function play(name: SoundName) {
  if (!enabled) return;
  switch (name) {
    case 'card':
      slide(0);
      break;
    case 'flip':
      noise(0, 0.035, vary(3800), { gain: 0.2, q: 1.5, attack: 0.001 });
      noise(0.06, 0.05, vary(2200), { gain: 0.16, q: 1, attack: 0.002 });
      tone(vary(220), 0.06, 0.05, { gain: 0.06, reverb: 0 });
      break;
    case 'chip':
      clack(0);
      if (Math.random() < 0.6) clack(vary(0.045, 0.3), 0.55);
      break;
    case 'chips': {
      let t = 0;
      for (let i = 0; i < 7; i++) {
        clack(t, 1 - i * 0.1);
        t += vary(0.045, 0.4);
      }
      break;
    }
    case 'shuffle': {
      let t = 0;
      for (let i = 0; i < 38; i++) {
        noise(t, 0.012, vary(4200, 0.25), { gain: 0.09 + Math.random() * 0.05, q: 1.2, attack: 0.001, reverb: 0.1 });
        t += vary(0.022, 0.5);
      }
      noise(t, 0.12, 700, { type: 'lowpass', gain: 0.2, attack: 0.003 });
      break;
    }
    case 'check':
      tone(vary(170), 0, 0.07, { gain: 0.25, attack: 0.002, reverb: 0.1 });
      noise(0, 0.03, 600, { type: 'lowpass', gain: 0.18, attack: 0.001 });
      tone(vary(155), 0.12, 0.07, { gain: 0.2, attack: 0.002, reverb: 0.1 });
      noise(0.12, 0.03, 600, { type: 'lowpass', gain: 0.14, attack: 0.001 });
      break;
    case 'fold':
      noise(0, 0.22, 2600, { to: 700, gain: 0.16, q: 0.6, attack: 0.02 });
      break;
    case 'turn':
      bell(988, 0, 0.5, 0.06);
      bell(1319, 0.11, 0.7, 0.05);
      break;
    case 'tap':
      noise(0, 0.02, 3000, { gain: 0.08, q: 2, attack: 0.001, reverb: 0 });
      break;
    case 'message':
      bell(1568, 0, 0.35, 0.04);
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * 0.085, 1.1, 0.065));
      setTimeout(() => play('chips'), 380);
      break;
    case 'bigwin':
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(f, i * 0.07, 1.3, 0.07));
      [1046.5, 1318.5, 1568].forEach((f) => bell(f, 0.42, 1.6, 0.05));
      setTimeout(() => play('chips'), 300);
      setTimeout(() => play('chips'), 520);
      break;
    case 'blackjack': {
      // Fanfare : accord majeur montant + scintillement
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(f, i * 0.07, 0.9, { type: 'sawtooth', gain: 0.025, attack: 0.01, reverb: 0.5 });
        bell(f, i * 0.07, 1.2, 0.06);
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, 0.4, 1.2, { type: 'triangle', gain: 0.04, attack: 0.02, reverb: 0.6 }));
      for (let i = 0; i < 10; i++) bell(vary(2600, 0.3), 0.45 + i * 0.05, 0.3, 0.02);
      setTimeout(() => play('chips'), 500);
      break;
    }
    case 'side':
      for (let i = 0; i < 6; i++) bell(1568 * Math.pow(1.122, i), i * 0.05, 0.5, 0.045);
      break;
    case 'push':
      bell(587.33, 0, 0.6, 0.05);
      bell(587.33, 0.16, 0.6, 0.04);
      break;
    case 'bust':
      tone(vary(330), 0, 0.5, { type: 'triangle', to: 110, gain: 0.12, attack: 0.01, reverb: 0.3 });
      noise(0, 0.25, 500, { type: 'lowpass', gain: 0.14, attack: 0.005 });
      break;
    case 'lose':
      [392, 311.13, 261.63].forEach((f, i) => tone(f, i * 0.15, 0.45, { type: 'triangle', gain: 0.07, attack: 0.01, reverb: 0.4 }));
      break;
  }
}
