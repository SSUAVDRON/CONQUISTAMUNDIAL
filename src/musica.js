// Música de fondo medieval y bélica, compuesta y sintetizada con Web Audio (sin
// ficheros). Instrumentos:
// - laúd: cuerda pulsada de verdad (algoritmo de Karplus-Strong, calculado una
//   vez por registro y transportado);
// - cuerno de guerra (metal con el filtro que se abre al soplar y vibrato);
// - flauta (con soplo), coro de voces graves («ah», con formantes);
// - bordón de zanfona (re y la sostenidos, siempre de fondo);
// - tambores de guerra, tamboril, caja con redoble y gong.
// La música va en re menor (eólico, dórico y la cadencia andaluza) y tiene
// tres ambientes que se cruzan en el compás siguiente:
//   menú   → procesión majestuosa (laúd, cuerno con el tema, tambores lentos);
//   calma  → laúd y flauta, tambor como un latido;
//   guerra → más rápida: tambores de batalla, ostinato grave al galope,
//            coro y llamadas de cuerno.
// Cada frase (4 compases) elige progresión y arreglo, así que no suena igual
// dos veces seguidas. Solo escucha: no toca nada de la simulación.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'D4', 'Bb3', 'C#5' → número MIDI (C4 = 60). */
export function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
export const mtof = (n) => 440 * 2 ** ((n - 69) / 12);

/** Notas de cada acorde (clases de altura) con su fundamental. */
const CHORD = {
  Dm: ['D', 'F', 'A'],
  C: ['C', 'E', 'G'],
  Bb: ['Bb', 'D', 'F'],
  A: ['A', 'C#', 'E'],
  F: ['F', 'A', 'C'],
  G: ['G', 'B', 'D'],
  Gm: ['G', 'Bb', 'D'],
};
const pc = (n) => (midi(`${n}4`) % 12 + 12) % 12;

/**
 * Progresiones (un acorde por compás) con sus melodías: por compás, notas
 * [paso de semicorchea, nota, duración en pasos].
 */
const PROGS = {
  // Cadencia andaluza: re menor, do, si bemol, la
  andaluza: {
    chords: ['Dm', 'C', 'Bb', 'A'],
    horn: [
      [[0, 'D4', 3], [3, 'E4', 1], [4, 'F4', 4], [8, 'A4', 6], [14, 'G4', 2]],
      [[0, 'G4', 3], [3, 'F4', 1], [4, 'E4', 4], [8, 'C4', 4], [12, 'E4', 4]],
      [[0, 'F4', 3], [3, 'E4', 1], [4, 'D4', 4], [8, 'F4', 4], [12, 'Bb4', 4]],
      [[0, 'A4', 8], [8, 'E4', 4], [12, 'C#4', 4]],
    ],
    flute: [
      [[0, 'A5', 6], [6, 'F5', 2], [8, 'E5', 4], [12, 'D5', 4]],
      [[0, 'E5', 6], [6, 'G5', 2], [8, 'E5', 4], [12, 'C5', 4]],
      [[0, 'D5', 6], [6, 'F5', 2], [8, 'D5', 4], [12, 'Bb4', 4]],
      [[0, 'C#5', 8], [8, 'E5', 4], [12, 'A4', 4]],
    ],
  },
  // Eólica: re menor, fa, do, re menor
  eolia: {
    chords: ['Dm', 'F', 'C', 'Dm'],
    horn: [
      [[0, 'A4', 4], [4, 'A4', 2], [6, 'G4', 2], [8, 'F4', 4], [12, 'D4', 4]],
      [[0, 'C5', 6], [6, 'A4', 2], [8, 'F4', 8]],
      [[0, 'G4', 4], [4, 'E4', 2], [6, 'F4', 2], [8, 'G4', 4], [12, 'E4', 4]],
      [[0, 'D4', 12]],
    ],
    flute: [
      [[0, 'D5', 2], [2, 'E5', 2], [4, 'F5', 4], [8, 'A5', 8]],
      [[0, 'A5', 4], [4, 'G5', 2], [6, 'F5', 2], [8, 'C5', 8]],
      [[0, 'E5', 2], [2, 'F5', 2], [4, 'G5', 4], [8, 'E5', 4], [12, 'C5', 4]],
      [[0, 'D5', 12]],
    ],
  },
  // Dórica: re menor, sol mayor (la sexta alta), re menor, do
  dorica: {
    chords: ['Dm', 'G', 'Dm', 'C'],
    flute: [
      [[0, 'D5', 4], [4, 'F5', 4], [8, 'E5', 2], [10, 'D5', 2], [12, 'A4', 4]],
      [[0, 'B4', 4], [4, 'D5', 4], [8, 'G5', 6], [14, 'F5', 2]],
      [[0, 'E5', 4], [4, 'D5', 2], [6, 'C5', 2], [8, 'D5', 4], [12, 'F5', 4]],
      [[0, 'E5', 4], [4, 'G5', 4], [8, 'E5', 4], [12, 'C5', 4]],
    ],
  },
  // Batalla: re menor, si bemol, do, re menor (llamadas de cuerno)
  batalla: {
    chords: ['Dm', 'Bb', 'C', 'Dm'],
    horn: [
      [[0, 'D4', 2], [2, 'D4', 1], [3, 'D4', 1], [4, 'A4', 6], [10, 'G4', 2], [12, 'F4', 2], [14, 'E4', 2]],
      [[0, 'F4', 4], [4, 'D4', 4], [8, 'F4', 4], [12, 'D4', 4]],
      [[0, 'E4', 2], [2, 'E4', 1], [3, 'E4', 1], [4, 'G4', 6], [10, 'F4', 2], [12, 'E4', 2], [14, 'C4', 2]],
      [[0, 'D4', 4], [4, 'A3', 4], [8, 'D4', 8]],
    ],
  },
  // Asedio: re menor dos veces, si bemol, la (tensión que vuelve a empezar)
  asedio: {
    chords: ['Dm', 'Dm', 'Bb', 'A'],
    horn: [
      [[0, 'A4', 4], [4, 'F4', 2], [6, 'A4', 2], [8, 'D5', 8]],
      [[0, 'C5', 4], [4, 'A4', 2], [6, 'F4', 2], [8, 'A4', 8]],
      [[0, 'Bb4', 4], [4, 'A4', 2], [6, 'G4', 2], [8, 'F4', 8]],
      [[0, 'E4', 4], [4, 'C#4', 4], [8, 'A3', 8]],
    ],
  },
};

/** Ritmos de percusión por compás (16 semicorcheas): [paso, intensidad]. */
const DRUMS = {
  procesion: { grande: [[0, 0.8], [8, 0.7]], tambor: [[4, 0.45], [12, 0.45], [14, 0.25]], caja: [[6, 0.15], [10, 0.15]], redoble: 0.5 },
  latido: { grande: [[0, 0.5], [3, 0.3]], tambor: [[8, 0.25]], caja: [], redoble: 0 },
  guerra: {
    grande: [[0, 1], [3, 0.6], [6, 0.7], [8, 1], [10, 0.55], [11, 0.7]],
    tambor: [[4, 0.7], [12, 0.7]],
    caja: [[2, 0.2], [4, 0.65], [7, 0.2], [9, 0.2], [12, 0.65], [14, 0.25], [15, 0.3]],
    redoble: 0.8,
    gong: true,
  },
};

const MOODS = {
  menu: {
    bpm: 84,
    progs: ['andaluza', 'eolia'],
    drone: 1,
    arrange: (p) => ({ lute: 'arpegio', choir: p % 4 !== 1 ? 'quinta' : null, drums: p % 4 === 0 ? null : 'procesion', melody: p % 2 === 1 ? 'horn' : p % 4 === 2 ? 'flute' : null }),
  },
  calma: {
    bpm: 76,
    progs: ['eolia', 'dorica', 'andaluza'],
    drone: 1.1,
    arrange: (p) => ({ lute: p % 3 === 2 ? 'arpegio' : 'suelto', choir: p % 2 === 0 ? 'triada' : null, drums: p % 3 === 0 ? null : 'latido', melody: p % 2 === 1 ? 'flute' : null }),
  },
  guerra: {
    bpm: 100,
    progs: ['batalla', 'asedio'],
    drone: 0.7,
    arrange: (p) => ({ lute: null, bass: true, choir: 'quinta', drums: 'guerra', melody: p % 2 === 0 ? 'horn' : null }),
  },
};

// ------------------------------------------------------------ instrumentos

/**
 * Instrumentos sintetizados, compartidos por la música y los efectos. Cada
 * nota crea sus nodos y los suelta al terminar.
 */
export class Instrumentos {
  constructor(ctx, reverb, noise) {
    this.ctx = ctx;
    this.reverb = reverb;
    this.noise = noise;
    this._ks = new Map();
  }

  _send(node, amount) {
    if (!amount || !this.reverb) return;
    const s = this.ctx.createGain();
    s.gain.value = amount;
    node.connect(s).connect(this.reverb);
  }

  /** Cuerda pulsada (Karplus-Strong) para la nota MIDI `base`, una sola vez. */
  _ksBuffer(base) {
    let e = this._ks.get(base);
    if (e) return e;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const seconds = 2.6;
    const n = Math.floor(sr * seconds);
    const N = Math.max(2, Math.round(sr / mtof(base) - 0.5));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    // Excitación: ruido suavizado (pulsar con la yema, no con púa de metal)
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp = lp * 0.45 + (Math.random() * 2 - 1) * 0.55;
      ring[i] = lp;
    }
    let idx = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const cur = ring[idx];
      const nxt = ring[idx + 1 === N ? 0 : idx + 1];
      ring[idx] = 0.4985 * (cur + nxt);
      d[i] = cur;
      if (Math.abs(cur) > peak) peak = Math.abs(cur);
      idx = idx + 1 === N ? 0 : idx + 1;
    }
    const k = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < n; i++) d[i] *= k;
    e = { buf, f: sr / (N + 0.5) };
    this._ks.set(base, e);
    return e;
  }

  /** Laúd / arpa: nota MIDI `m`. */
  pluck(dest, t, m, vol, { rev = 0.25, dur = 2.2, bright = 2600 } = {}) {
    const ctx = this.ctx;
    const base = [45, 50, 57, 62, 69, 74, 81].reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    const { buf, f } = this._ksBuffer(base);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = mtof(m) / f;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = bright;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + dur - 0.35, 0.1);
    src.connect(lpf).connect(g);
    g.connect(dest);
    this._send(g, rev);
    src.start(t);
    src.stop(t + dur);
  }

  /** Cuerno de guerra: metal con el filtro que se abre al soplar y vibrato si dura. */
  horn(dest, t, m, dur, vol, { rev = 0.35, bright = 1 } = {}) {
    const ctx = this.ctx;
    const f = mtof(m);
    const end = t + dur;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.Q.value = 1.4;
    lpf.frequency.setValueAtTime(f * 1.1, t);
    lpf.frequency.linearRampToValueAtTime(f * 6 * bright, t + 0.07);
    lpf.frequency.setTargetAtTime(f * 3.6 * bright, t + 0.08, 0.18);
    lpf.frequency.setTargetAtTime(f * 1.2, end - 0.05, 0.06);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.045);
    g.gain.setTargetAtTime(vol * 0.82, t + 0.06, 0.12);
    g.gain.setTargetAtTime(0, end - 0.04, 0.07);
    lpf.connect(g);
    g.connect(dest);
    this._send(g, rev);
    const oscs = [];
    for (const [type, det, lvl] of [['sawtooth', -5, 0.55], ['sawtooth', 6, 0.55], ['triangle', 0, 0.9]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lpf);
      oscs.push(o);
    }
    if (dur > 0.45) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + 0.25);
      depth.gain.linearRampToValueAtTime(9, t + 0.55); // centésimas de semitono
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
      oscs.push(lfo);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(end + 0.4);
    }
  }

  /**
   * Cuerno suave (sin el metal áspero del cuerno de guerra): triángulo y su
   * octava grave, filtro cerrado y entrada lenta. Para avisos que se repiten.
   */
  softHorn(dest, t, m, dur, vol, { rev = 0.4 } = {}) {
    const ctx = this.ctx;
    const f = mtof(m);
    const end = t + dur;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.Q.value = 0.7;
    lpf.frequency.setValueAtTime(f * 1.5, t);
    lpf.frequency.linearRampToValueAtTime(f * 3, t + 0.12);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.09);
    g.gain.setTargetAtTime(vol * 0.8, t + 0.12, 0.2);
    g.gain.setTargetAtTime(0, end - 0.06, 0.1);
    lpf.connect(g);
    g.connect(dest);
    this._send(g, rev);
    const nodes = [];
    for (const [type, mul, lvl] of [['triangle', 1, 1], ['sine', 0.5, 0.6], ['sine', 2, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * mul * 0.99, t);
      o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.08);
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lpf);
      nodes.push(o);
    }
    for (const o of nodes) {
      o.start(t);
      o.stop(end + 0.5);
    }
  }

  /** Flauta de madera con algo de soplo. */
  flute(dest, t, m, dur, vol, { rev = 0.45 } = {}) {
    const ctx = this.ctx;
    const f = mtof(m);
    const end = t + dur;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.07);
    g.gain.setTargetAtTime(vol * 0.85, t + 0.1, 0.3);
    g.gain.setTargetAtTime(0, end - 0.05, 0.08);
    g.connect(dest);
    this._send(g, rev);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.setValueAtTime(0, t + 0.18);
    depth.gain.linearRampToValueAtTime(11, t + 0.45);
    lfo.connect(depth);
    const nodes = [lfo];
    for (const [type, lvl, mul] of [['sine', 1, 1], ['triangle', 0.22, 1], ['sine', 0.12, 2]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      depth.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      nodes.push(o);
    }
    // Soplo: ruido en banda alrededor del segundo armónico, sobre todo al empezar
    if (this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 2;
      bp.Q.value = 1.6;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.5, t + 0.03);
      ng.gain.setTargetAtTime(0.12, t + 0.05, 0.08);
      ng.gain.setTargetAtTime(0, end - 0.05, 0.06);
      src.connect(bp).connect(ng).connect(g);
      src.start(t, Math.random() * 1.2);
      src.stop(end + 0.3);
    }
    for (const o of nodes) {
      o.start(t);
      o.stop(end + 0.3);
    }
  }

  /** Coro de voces graves cantando «ah» (formantes); `ms`: notas MIDI a la vez. */
  choir(dest, t, ms, dur, vol, { rev = 0.55, attack = 0.7 } = {}) {
    const ctx = this.ctx;
    const end = t + dur;
    const sum = ctx.createGain();
    sum.gain.value = 1 / Math.sqrt(ms.length * 3);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + attack);
    out.gain.setValueAtTime(vol, Math.max(t + attack, end - 0.2));
    out.gain.setTargetAtTime(0, Math.max(t + attack, end - 0.2), 0.35);
    out.connect(dest);
    this._send(out, rev);
    for (const [fq, q, lvl] of [[730, 6, 1], [1100, 7, 0.55], [2500, 8, 0.18]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = lvl * 4.5;
      sum.connect(bp).connect(fg).connect(out);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.6;
    const depth = ctx.createGain();
    depth.gain.value = 7;
    lfo.connect(depth);
    const nodes = [lfo];
    for (const m of ms) {
      for (const det of [-11, 0, 12]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        depth.connect(o.detune);
        o.connect(sum);
        nodes.push(o);
      }
    }
    for (const o of nodes) {
      o.start(t);
      o.stop(end + 1.6);
    }
  }

  /** Bajo grave al galope (cuerdas y metal graves). */
  bass(dest, t, m, dur, vol) {
    const ctx = this.ctx;
    const f = mtof(m);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.Q.value = 2;
    lpf.frequency.setValueAtTime(f * 7, t);
    lpf.frequency.exponentialRampToValueAtTime(f * 2, t + dur);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lpf.connect(g).connect(dest);
    for (const [type, mul, lvl] of [['sawtooth', 1, 0.6], ['triangle', 0.5, 0.8]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lpf);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  _noise(dest, t, type, f0, f1, dur, vol, { q = 1, attack = 0.002, rev = 0 } = {}) {
    if (!this.noise) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(dest);
    this._send(g, rev);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _sine(dest, t, f0, f1, dur, vol, { rev = 0, attack = 0.003, type = 'sine' } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(dest);
    this._send(g, rev);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Percusión: 'grande' (tambor de guerra), 'tambor', 'caja', 'gong' o 'madera'. */
  drum(dest, t, kind, vol) {
    if (kind === 'grande') {
      this._sine(dest, t, 92, 44, 0.55, 0.95 * vol, { rev: 0.18 });
      this._sine(dest, t, 140, 70, 0.12, 0.35 * vol);
      this._noise(dest, t, 'lowpass', 900, 160, 0.14, 0.45 * vol);
    } else if (kind === 'tambor') {
      this._sine(dest, t, 210, 128, 0.16, 0.5 * vol, { rev: 0.12 });
      this._noise(dest, t, 'bandpass', 1100, 700, 0.12, 0.55 * vol, { q: 1.1 });
    } else if (kind === 'caja') {
      this._noise(dest, t, 'bandpass', 2600, 1900, 0.13, 0.6 * vol, { q: 0.8, rev: 0.1 });
      this._sine(dest, t, 240, 180, 0.06, 0.25 * vol, { type: 'triangle' });
    } else if (kind === 'gong') {
      for (const [r, d, l] of [[1, 3.2, 0.3], [1.48, 2.6, 0.2], [2.12, 2, 0.16], [2.95, 1.5, 0.1], [4.1, 1.1, 0.07]]) this._sine(dest, t, 96 * r, 96 * r * 0.985, d, l * vol, { rev: 0.5, attack: 0.01 });
      this._noise(dest, t, 'highpass', 3000, 6000, 1.6, 0.12 * vol, { rev: 0.5, attack: 0.02 });
    } else if (kind === 'madera') {
      this._noise(dest, t, 'bandpass', 1500, 1300, 0.05, 0.6 * vol, { q: 3 });
      this._sine(dest, t, 620, 420, 0.06, 0.3 * vol);
    }
  }

  /** Campana de bronce (parciales inarmónicos que se apagan a distinto ritmo). */
  bell(dest, t, m, vol, { rev = 0.55, dur = 2.6 } = {}) {
    const f = mtof(m);
    for (const [r, d, l] of [[0.5, 1, 0.5], [1, 1, 1], [1.19, 0.8, 0.45], [1.5, 0.7, 0.4], [2, 0.6, 0.35], [2.74, 0.4, 0.25], [3.76, 0.3, 0.18]]) {
      this._sine(dest, t, f * r, f * r, dur * d, l * vol * 0.4, { rev, attack: 0.002 });
    }
  }

  /** Choque de espadas: metal agudo e inarmónico, muy corto. */
  clash(dest, t, vol, { rev = 0.25 } = {}) {
    const k = 0.92 + Math.random() * 0.16;
    for (const [fq, d, l] of [[2870, 0.42, 0.5], [3460, 0.36, 0.42], [4150, 0.3, 0.36], [5320, 0.22, 0.28], [6990, 0.16, 0.2]]) {
      this._sine(dest, t, fq * k, fq * k * 0.995, d, l * vol * 0.32, { rev, attack: 0.001 });
    }
    this._noise(dest, t, 'highpass', 3500, 5000, 0.07, 0.35 * vol, { attack: 0.001 });
  }

  /** Gritos de una tropa («¡aaah!»): voces que suben y bajan, con formantes. */
  shout(dest, t, vol, { voices = 6, dur = 0.9, rev = 0.35 } = {}) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.12);
    out.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.22);
    out.connect(dest);
    this._send(out, rev);
    const sum = ctx.createGain();
    sum.gain.value = 1 / Math.sqrt(voices);
    for (const [fq, q, lvl] of [[800, 3, 1], [1200, 4, 0.6], [2600, 5, 0.2]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = lvl * 3;
      sum.connect(bp).connect(fg).connect(out);
    }
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 150 + Math.random() * 110;
      const s = t + Math.random() * 0.12;
      o.frequency.setValueAtTime(f * 0.85, s);
      o.frequency.linearRampToValueAtTime(f * 1.12, s + dur * 0.3);
      o.frequency.linearRampToValueAtTime(f * 0.9, s + dur);
      o.connect(sum);
      o.start(s);
      o.stop(s + dur + 0.6);
    }
    this._noise(out, t, 'bandpass', 1400, 900, dur, 0.25, { q: 0.7, attack: 0.1 });
  }
}

// ----------------------------------------------------------------- música

export class Musica {
  constructor(ctx, dest, ins) {
    this.ctx = ctx;
    this.ins = ins;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.enabled = true;
    this.mood = 'menu';
    this.want = 'menu';
    this.step = 0;
    this.bar = 0;
    this.phrase = 0;
    this.next = ctx.currentTime + 0.4;
    this._lastProg = null;
    this._newPhrase();
    this._makeDrone();
    this._timer = setInterval(() => this._schedule(), 100);
  }

  /** 'menu', 'calma' o 'guerra': entra en el compás siguiente (la calma tras una guerra, al acabar la frase). */
  setMood(m) {
    if (MOODS[m]) this.want = m;
  }

  setEnabled(on) {
    this.enabled = on;
    this._droneLevel();
  }

  /** Baja la música un momento (fanfarrias y avisos importantes por encima). */
  duck(depth = 0.35, secs = 2.5) {
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.08);
    g.setTargetAtTime(1, t + secs, 0.6);
  }

  stop() {
    clearInterval(this._timer);
    for (const o of this._droneOscs || []) o.stop();
  }

  /** Bordón de zanfona: re y la graves sostenidos todo el rato, con el filtro que respira. */
  _makeDrone() {
    const ctx = this.ctx;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 560;
    lpf.Q.value = 2.2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    lpf.connect(this.droneGain).connect(this.out);
    this.ins._send(this.droneGain, 0.3);
    const oscs = [];
    for (const [m, type, lvl, det] of [[midi('D2'), 'sawtooth', 0.5, -4], [midi('A2'), 'sawtooth', 0.38, 3], [midi('D3'), 'square', 0.12, 0]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(lpf);
      oscs.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const depth = ctx.createGain();
    depth.gain.value = 170;
    lfo.connect(depth).connect(lpf.frequency);
    oscs.push(lfo);
    for (const o of oscs) o.start();
    this._droneOscs = oscs;
    this._droneLevel();
  }

  _droneLevel() {
    if (!this.droneGain) return;
    const lvl = this.enabled ? 0.11 * MOODS[this.mood].drone : 0;
    this.droneGain.gain.setTargetAtTime(lvl, this.ctx.currentTime, 1.2);
  }

  _newPhrase() {
    const M = MOODS[this.mood];
    // Otra progresión que la anterior (si hay donde elegir)
    const options = M.progs.filter((p) => p !== this._lastProg);
    const name = options[Math.floor(Math.random() * options.length)] || M.progs[0];
    this._lastProg = name;
    this.prog = PROGS[name];
    this.arr = M.arrange(this.phrase);
    // Si la progresión no tiene melodía para ese instrumento, se usa la otra
    if (this.arr.melody && !this.prog[this.arr.melody]) this.arr.melody = this.prog.horn ? 'horn' : this.prog.flute ? 'flute' : null;
  }

  _schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Tras una pausa (pestaña oculta), se sigue desde ahora, sin ráfaga de notas atrasadas
    if (this.next < now - 0.05) this.next = now + 0.05;
    while (this.next < now + 0.45) {
      if (this.enabled) this._playStep(this.next);
      this._advance();
    }
  }

  _advance() {
    this.next += 60 / MOODS[this.mood].bpm / 4;
    if (++this.step < 16) return;
    this.step = 0;
    this.bar++;
    const leavingWar = this.mood === 'guerra' && this.want === 'calma';
    if (this.want !== this.mood && (!leavingWar || this.bar >= 4)) {
      const fromWar = this.mood === 'guerra';
      this.mood = this.want;
      this.bar = 0;
      this.phrase = this.mood === 'guerra' ? 0 : 1; // al volver a la calma, ya con melodía
      this._newPhrase();
      this._droneLevel();
      if (this.mood === 'guerra' && this.enabled) this.ins.drum(this.out, this.next, 'gong', 0.8);
      else if (fromWar && this.enabled) this.ins.drum(this.out, this.next, 'grande', 0.6);
    } else if (this.bar >= 4) {
      this.bar = 0;
      this.phrase++;
      this._newPhrase();
    }
  }

  _playStep(t) {
    const ins = this.ins;
    const out = this.out;
    const M = MOODS[this.mood];
    const s = this.step;
    const bar = this.bar;
    const stepDur = 60 / M.bpm / 4;
    const chord = CHORD[this.prog.chords[bar]];
    const root = ((pc(chord[0]) - 48) % 12 + 12) % 12 + 48; // fundamental entre do3 y si3
    const tones = [root];
    for (const n of chord.slice(1)) {
      let m = pc(n) + 48;
      while (m <= tones[tones.length - 1]) m += 12;
      tones.push(m);
    }
    const [r, th, fi] = tones;
    const arr = this.arr;
    // Coro: al empezar cada compás, todo el compás
    if (s === 0 && arr.choir) {
      const voices = arr.choir === 'quinta' ? [r, r + 7, r + 12] : [r + 12, th + 12, fi + 12];
      ins.choir(out, t, voices, stepDur * 16 + 0.3, arr.choir === 'quinta' ? (this.mood === 'guerra' ? 0.16 : 0.13) : 0.09);
    }
    // Laúd
    if (arr.lute === 'arpegio' && s % 2 === 0) {
      const seq = [r, fi, r + 12, th + 12, fi + 12, th + 12, r + 12, fi];
      ins.pluck(out, t + (Math.random() - 0.5) * 0.012, seq[s / 2], s === 0 ? 0.34 : 0.22 + Math.random() * 0.05);
    } else if (arr.lute === 'suelto' && (s === 0 || s === 6 || s === 8 || s === 12)) {
      const seq = { 0: r, 6: fi, 8: r + 12, 12: th + 12 };
      ins.pluck(out, t, seq[s], s === 0 ? 0.3 : 0.2, { rev: 0.35 });
    }
    // Bajo al galope (guerra)
    if (arr.bass && [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].includes(s)) {
      // Fundamental grave (re2…), con un salto de octava en el tercer tiempo
      const m = s >= 8 && s < 12 ? r : r - 12;
      ins.bass(out, t, m, stepDur * (s % 4 === 0 ? 1.8 : 0.9), s % 4 === 0 ? 0.4 : 0.27);
    }
    // Percusión
    if (arr.drums) {
      const D = DRUMS[arr.drums];
      // Por debajo de la melodía: la percusión marca, no tapa
      const k = this.mood === 'guerra' ? 0.6 : 0.78;
      for (const [st, v] of D.grande) if (st === s) ins.drum(out, t, 'grande', v * 0.9 * k);
      for (const [st, v] of D.tambor) if (st === s) ins.drum(out, t, 'tambor', v * 0.8 * k);
      for (const [st, v] of D.caja) if (st === s) ins.drum(out, t, 'caja', v * 0.7 * k);
      // Redoble al final de la frase, cada vez más fuerte
      if (D.redoble && bar === 3 && s >= 12) {
        for (let j = 0; j < 2; j++) ins.drum(out, t + (j * stepDur) / 2, 'caja', k * D.redoble * (0.25 + ((s - 12) * 2 + j) * 0.06));
      }
      if (D.gong && bar === 0 && s === 0 && this.phrase % 2 === 0) ins.drum(out, t, 'gong', 0.5);
    }
    // Melodía (cuerno o flauta)
    if (arr.melody) {
      const notes = this.prog[arr.melody][bar];
      for (const [st, name, len] of notes) {
        if (st !== s) continue;
        const dur = len * stepDur;
        if (arr.melody === 'horn') ins.horn(out, t, midi(name), dur * 0.95, this.mood === 'guerra' ? 0.2 : 0.16);
        else ins.flute(out, t, midi(name), dur * 0.95, 0.14);
      }
    }
  }
}
