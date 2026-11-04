// Sonido del juego, todo sintetizado con Web Audio (sin ficheros):
// - música de fondo ambiental y generativa (acordes lentos, un bajo suave y
//   notas sueltas de una escala pentatónica con eco), a volumen bajo;
// - efectos discretos: clic, obras, edificio terminado, ataque, barco, misil,
//   explosión e intercepción (más flojos cuanto más lejos de la cámara),
//   cañonazos, monedas de los trenes, avisos y fin de partida.
// Solo escucha: no cambia nada de la simulación.

const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** Frecuencia de una nota como 'A4', 'C#3'… */
function freq(name) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const semis = NOTE[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

// Progresión lenta de la música (cada acorde ~9 s) y escala de las notas sueltas
const CHORDS = [
  { bass: 'A2', notes: ['C4', 'E4', 'A4'] },
  { bass: 'F2', notes: ['A3', 'C4', 'F4'] },
  { bass: 'C3', notes: ['E4', 'G4', 'C5'] },
  { bass: 'G2', notes: ['B3', 'D4', 'G4'] },
];
const SCALE = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'E5', 'D5'];
const CHORD_S = 9;

export class Sound {
  constructor() {
    this.ctx = null;
    this.opts = { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, muted: false };
    this._last = new Map(); // tipo → último momento (para no saturar)
    this._seenFx = new WeakSet();
    this._seenAtk = new WeakSet();
    this._seenMissile = new WeakSet();
    this._shots = new Map(); // buque → último disparo oído
    this._prev = null; // datos del humano del fotograma anterior
    this._ended = false;
    this._musicTimer = null;
  }

  /** Se llama en el primer gesto del usuario (los navegadores no dejan sonar antes). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // Eco (reverberación) compartido: respuesta generada con ruido que se apaga
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut).connect(this.master);
    this._noise = this._noiseBuffer();
    this._applyVolumes();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
    this._startMusic();
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.opts;
    // La música de fondo, baja; los efectos, bien audibles (el compresor del
    // final evita que se saturen cuando coinciden varios)
    this.master.gain.setTargetAtTime(o.muted ? 0 : 1, t, 0.08);
    this.musicBus.gain.setTargetAtTime(o.music ? 0.16 * o.musicVol : 0, t, 0.4);
    this.sfxBus.gain.setTargetAtTime(o.sfx ? 1.1 * o.sfxVol : 0, t, 0.05);
  }

  // --------------------------------------------------------------- música

  _startMusic() {
    this._chord = 0;
    this._nextChord = this.ctx.currentTime + 0.5;
    this._nextPluck = this.ctx.currentTime + 3;
    // Programador con margen: cada 0,3 s deja preparado lo del siguiente segundo
    this._musicTimer = setInterval(() => this._scheduleMusic(), 300);
  }

  _scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 1.2;
    while (this._nextChord < ahead) {
      const c = CHORDS[this._chord % CHORDS.length];
      const t = this._nextChord;
      for (const n of c.notes) this._pad(freq(n), t, CHORD_S + 3);
      this._bass(freq(c.bass), t, CHORD_S + 1);
      this._chord++;
      this._nextChord += CHORD_S;
    }
    while (this._nextPluck < ahead) {
      // Notas sueltas, a veces en pareja, con silencios largos
      const t = this._nextPluck;
      if (Math.random() < 0.75) {
        const n = SCALE[(Math.random() * SCALE.length) | 0];
        this._pluck(freq(n), t, 0.16 + Math.random() * 0.1);
        if (Math.random() < 0.3) this._pluck(freq(SCALE[(Math.random() * SCALE.length) | 0]), t + 0.45, 0.12);
      }
      this._nextPluck += 1.6 + Math.random() * 3.2;
    }
  }

  /** Acorde de fondo: dos osciladores suaves y algo desafinados por nota, filtrados. */
  _pad(f, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 3);
    g.gain.setValueAtTime(0.09, t + dur - 4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    for (const d of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  _bass(f, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 2);
    g.gain.setValueAtTime(0.14, t + dur - 3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** Nota suelta tipo campanilla, con eco. */
  _pluck(f, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.2);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + 2.3);
  }

  // -------------------------------------------------------------- efectos

  /** Reproduce el efecto `name` con volumen `vol` (0-1). `gap`: ms mínimos entre dos iguales. */
  play(name, vol = 1, gap = 60) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.opts.sfx || this.opts.muted || vol <= 0.02) return;
    const now = performance.now();
    if (now - (this._last.get(name) || 0) < gap) return;
    this._last.set(name, now);
    const fn = SFX[name];
    if (fn) fn(this, ctx.currentTime + 0.01, vol);
  }

  /** Tono con envolvente: forma, frecuencia inicial → final, duración, volumen. */
  _tone(t, type, f0, f1, dur, vol, { reverb = 0, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfxBus);
    if (reverb) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      g.connect(r).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Ruido filtrado (soplos, explosiones): paso banda/bajo que se desliza de f0 a f1. */
  _noiseBurst(t, type, f0, f1, dur, vol, { q = 1, reverb = 0, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    if (reverb) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      g.connect(r).connect(this.reverb);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _noiseBuffer() {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _impulse(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    return b;
  }

  // ------------------------------------------------- escucha de la partida

  /** Aviso de la partida (el mismo que va al recuadro de avisos). */
  onEvent(evt) {
    if (!this.ctx) return;
    // Avisos con sonido propio (conquista, guerra, alianza, desembarco…)
    if (evt.sfx) {
      this.play(evt.sfx, 1, 250);
      return;
    }
    if (evt.kind === 'request') this.play('ding', 0.6, 400);
    else if (evt.feedback && evt.kind === 'warn') this.play('error', 0.7, 300);
    else if (evt.feedback) return;
    else if (evt.kind === 'danger') this.play('alert', 0.8, 1500);
    else if (evt.kind === 'good') this.play('chime', 0.7, 500);
  }

  /**
   * Cada fotograma: mira qué ha pasado en la partida y suena lo que toca.
   * Lo lejano suena flojo y lo que queda muy fuera de la vista, nada.
   */
  update(game, camera, human, demo) {
    if (!this.ctx || !game || demo) return;
    const map = game.map;
    const cx = camera.x + camera.viewW / camera.zoom / 2;
    const cy = camera.y + camera.viewH / camera.zoom / 2;
    const span = Math.max(camera.viewW, camera.viewH) / camera.zoom;
    const near = (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / span;
      return d > 1.2 ? 0 : Math.min(1, 1.25 - d) * (camera.zoom > 0.5 ? 1 : 0.7);
    };
    for (const e of game.effects) {
      if (this._seenFx.has(e)) continue;
      this._seenFx.add(e);
      if (game.ticks - e.tick > 5) continue;
      if (e.kind === 'boom') this.play('boom', near(e.x, e.y), 120);
      else if (e.kind === 'intercept' || e.kind === 'miss') this.play('intercept', near(e.x, e.y), 120);
      else if (e.kind === 'train' && human && (e.owner === human.id || e.other === human.id)) this.play('coin', 0.5 * near(e.x, e.y), 700);
    }
    for (const m of game.missiles) {
      if (this._seenMissile.has(m)) continue;
      this._seenMissile.add(m);
      const mine = human && m.owner === human.id;
      const [x, y] = [map.x(m.from) + 0.5, map.y(m.from) + 0.5];
      this.play('missile', mine ? 0.9 : near(x, y) * 0.8, 200);
    }
    for (const ws of game.warships) {
      if (this._shots.get(ws) === ws.fireTick || ws.fireTick < game.ticks - 3) continue;
      this._shots.set(ws, ws.fireTick);
      this.play('cannon', near(map.x(ws.tile), map.y(ws.tile)) * 0.7, 150);
    }
    if (human) {
      const builtNow = human.stats.built;
      const active = Object.values(human.active).reduce((a, b) => a + b, 0) + Object.values(human.levels).reduce((a, b) => a + b, 0);
      const prev = this._prev;
      if (prev && prev.game === game) {
        if (builtNow > prev.built) this.play('build', 0.8, 150);
        if (active > prev.active) this.play('built', 0.7, 300);
        if (human.boatCount > prev.boats) this.play('boat', 0.7, 300);
      }
      let vsNation = false;
      let vsWild = false;
      for (const atk of human.attacks.values()) {
        if (atk.targetId) vsNation = true;
        else vsWild = true;
        if (this._seenAtk.has(atk)) continue;
        this._seenAtk.add(atk);
        this.play(atk.targetId ? 'charge' : 'launch', 0.8, 250);
      }
      // Mientras avanzas: tambores de marcha contra naciones y un roce suave
      // al expandirte por tierra libre (con calma: no cada casilla)
      if (prev && prev.game === game && human.tiles > prev.tiles) {
        if (vsNation) this.play('march', 0.7, 650);
        else if (vsWild) this.play('expand', 0.6, 1100);
      }
      // Pierdes casillas a manos de otros: golpes sordos
      if (prev && prev.game === game && human.tiles < prev.tiles - 2) this.play('hit', 0.7, 700);
      this._prev = { game, built: builtNow, active, boats: human.boatCount, tiles: human.tiles };
      if (game.phase === 'ended' && !this._ended) {
        this._ended = true;
        this.play(game.winner === human ? 'victory' : 'defeat', 1, 0);
      } else if (game.phase !== 'ended') this._ended = false;
    }
  }
}

/** Recetas de efectos: (sonido, momento, volumen). Todos cortos y suaves. */
const SFX = {
  click: (s, t, v) => s._tone(t, 'sine', 1250, 850, 0.05, 0.12 * v),
  error: (s, t, v) => {
    s._tone(t, 'triangle', 220, 200, 0.12, 0.12 * v);
    s._tone(t + 0.1, 'triangle', 185, 170, 0.16, 0.1 * v);
  },
  build: (s, t, v) => {
    s._tone(t, 'sine', 150, 70, 0.16, 0.35 * v);
    s._noiseBurst(t, 'highpass', 2500, 1800, 0.05, 0.12 * v);
  },
  built: (s, t, v) => {
    s._tone(t, 'sine', 660, 660, 0.7, 0.13 * v, { reverb: 0.5 });
    s._tone(t + 0.09, 'sine', 990, 990, 0.8, 0.1 * v, { reverb: 0.5 });
  },
  launch: (s, t, v) => s._noiseBurst(t, 'bandpass', 350, 1300, 0.38, 0.22 * v, { q: 0.9, attack: 0.08 }),
  boat: (s, t, v) => {
    s._tone(t, 'sawtooth', 98, 96, 0.7, 0.05 * v, { attack: 0.08, reverb: 0.3 });
    s._tone(t, 'sine', 196, 194, 0.7, 0.07 * v, { attack: 0.08 });
  },
  missile: (s, t, v) => s._noiseBurst(t, 'bandpass', 300, 2600, 0.9, 0.2 * v, { q: 1.4, attack: 0.15, reverb: 0.3 }),
  boom: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1100, 90, 1.5, 0.55 * v, { reverb: 0.4 });
    s._tone(t, 'sine', 70, 38, 1.1, 0.45 * v);
  },
  intercept: (s, t, v) => {
    s._tone(t, 'sawtooth', 1700, 420, 0.16, 0.06 * v);
    s._noiseBurst(t + 0.12, 'bandpass', 1800, 600, 0.25, 0.18 * v, { reverb: 0.3 });
  },
  cannon: (s, t, v) => {
    s._tone(t, 'sine', 95, 45, 0.22, 0.3 * v);
    s._noiseBurst(t, 'lowpass', 900, 200, 0.12, 0.15 * v);
  },
  coin: (s, t, v) => {
    s._tone(t, 'sine', 1568, 1568, 0.18, 0.08 * v);
    s._tone(t + 0.07, 'sine', 2093, 2093, 0.3, 0.07 * v, { reverb: 0.3 });
  },
  // Lluvia de monedas (botín)
  coins: (s, t, v) => {
    const notes = [1568, 1760, 2093, 2349, 2637, 2093, 3136, 2637];
    notes.forEach((f, i) => s._tone(t + i * 0.055 + Math.random() * 0.02, 'sine', f, f, 0.22, 0.09 * v, { reverb: 0.25 }));
  },
  // Has conquistado una nación: fanfarria de metales y timbales
  conquer: (s, t, v) => {
    s._tone(t, 'sine', 110, 55, 0.6, 0.5 * v);
    s._noiseBurst(t, 'lowpass', 600, 120, 0.4, 0.25 * v);
    [['G4', 0], ['C5', 0.14], ['E5', 0.28], ['G5', 0.42]].forEach(([n, d]) => {
      s._tone(t + d, 'sawtooth', freq(n), freq(n), 0.32, 0.05 * v, { attack: 0.02 });
      s._tone(t + d, 'triangle', freq(n), freq(n), 0.36, 0.13 * v, { attack: 0.02, reverb: 0.3 });
    });
    ['C5', 'E5', 'G5', 'C6'].forEach((n) => {
      s._tone(t + 0.58, 'triangle', freq(n), freq(n), 1.4, 0.09 * v, { attack: 0.03, reverb: 0.6 });
      s._tone(t + 0.58, 'sawtooth', freq(n), freq(n), 1.0, 0.025 * v, { attack: 0.03 });
    });
    s._tone(t + 0.58, 'sine', 98, 49, 0.9, 0.5 * v);
    s._noiseBurst(t + 0.58, 'highpass', 5000, 3000, 1.2, 0.12 * v, { reverb: 0.5 });
  },
  // Has conquistado una colonia: fanfarria corta
  conquerColony: (s, t, v) => {
    s._tone(t, 'sine', 130, 65, 0.35, 0.4 * v);
    s._tone(t, 'triangle', freq('C5'), freq('C5'), 0.22, 0.12 * v, { attack: 0.015 });
    s._tone(t + 0.12, 'triangle', freq('G5'), freq('G5'), 0.7, 0.12 * v, { attack: 0.015, reverb: 0.45 });
    s._tone(t + 0.12, 'sawtooth', freq('G5'), freq('G5'), 0.4, 0.03 * v, { attack: 0.015 });
  },
  // Una nación cae a lo lejos (no por ti): timbal apagado
  fall: (s, t, v) => {
    s._tone(t, 'sine', 90, 45, 0.9, 0.28 * v, { reverb: 0.5 });
    s._noiseBurst(t, 'lowpass', 400, 80, 0.6, 0.12 * v, { reverb: 0.4 });
  },
  // Te declaran la guerra: tambores y cuerno
  war: (s, t, v) => {
    [0, 0.16, 0.42].forEach((d, i) => s._tone(t + d, 'sine', 95, 42, 0.32, (i === 2 ? 0.55 : 0.42) * v));
    s._noiseBurst(t, 'lowpass', 700, 150, 0.2, 0.15 * v);
    s._tone(t + 0.5, 'sawtooth', freq('A3'), freq('A3') * 0.97, 0.8, 0.06 * v, { attack: 0.06, reverb: 0.4 });
    s._tone(t + 0.5, 'triangle', freq('A3'), freq('A3') * 0.97, 0.8, 0.14 * v, { attack: 0.06 });
  },
  // Atacas a una nación: carga (tambor y metal)
  charge: (s, t, v) => {
    s._tone(t, 'sine', 120, 55, 0.25, 0.4 * v);
    s._noiseBurst(t, 'bandpass', 400, 1600, 0.35, 0.2 * v, { q: 0.8, attack: 0.05 });
    s._tone(t + 0.08, 'triangle', freq('D4'), freq('A4'), 0.25, 0.08 * v);
  },
  march: (s, t, v) => {
    s._tone(t, 'sine', 105, 60, 0.16, 0.32 * v);
    s._noiseBurst(t, 'highpass', 3000, 2500, 0.04, 0.06 * v);
  },
  expand: (s, t, v) => s._noiseBurst(t, 'bandpass', 900, 1700, 0.18, 0.08 * v, { q: 1.2, attack: 0.04 }),
  hit: (s, t, v) => {
    s._tone(t, 'sine', 80, 40, 0.25, 0.32 * v);
    s._noiseBurst(t, 'lowpass', 500, 100, 0.2, 0.15 * v);
  },
  capture: (s, t, v) => {
    s._tone(t, 'sine', 140, 70, 0.25, 0.35 * v);
    s._tone(t + 0.05, 'triangle', freq('E5'), freq('E5'), 0.2, 0.1 * v);
    s._tone(t + 0.15, 'triangle', freq('A5'), freq('A5'), 0.5, 0.1 * v, { reverb: 0.4 });
  },
  sink: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1200, 150, 1.0, 0.35 * v, { reverb: 0.4 });
    s._tone(t + 0.1, 'sine', 160, 50, 1.0, 0.2 * v);
  },
  land: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1500, 300, 0.4, 0.25 * v);
    s._tone(t + 0.1, 'sine', 110, 60, 0.3, 0.35 * v);
    s._tone(t + 0.2, 'triangle', freq('D5'), freq('D5'), 0.4, 0.08 * v, { reverb: 0.4 });
  },
  start: (s, t, v) => {
    [['G3', 0], ['C4', 0.22], ['G4', 0.44]].forEach(([n, d], i) => {
      s._tone(t + d, 'triangle', freq(n), freq(n), i === 2 ? 1.2 : 0.3, 0.14 * v, { attack: 0.03, reverb: 0.5 });
      s._tone(t + d, 'sawtooth', freq(n), freq(n), i === 2 ? 0.9 : 0.25, 0.035 * v, { attack: 0.03 });
    });
    s._tone(t + 0.44, 'sine', 98, 49, 0.7, 0.35 * v);
  },
  alliance: (s, t, v) => {
    ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => s._tone(t + i * 0.07, 'sine', freq(n), freq(n), 1.4, 0.09 * v, { attack: 0.05, reverb: 0.6 }));
  },
  betray: (s, t, v) => {
    s._tone(t, 'sawtooth', freq('E3'), freq('E3') * 0.94, 0.9, 0.06 * v, { attack: 0.03, reverb: 0.4 });
    s._tone(t, 'sawtooth', freq('F3'), freq('F3') * 0.94, 0.9, 0.06 * v, { attack: 0.03 });
    s._tone(t, 'sine', 90, 40, 0.6, 0.35 * v);
  },
  ding: (s, t, v) => s._tone(t, 'sine', 880, 880, 0.6, 0.1 * v, { reverb: 0.4 }),
  chime: (s, t, v) => {
    s._tone(t, 'sine', freq('C5'), freq('C5'), 0.8, 0.09 * v, { reverb: 0.5 });
    s._tone(t + 0.12, 'sine', freq('E5'), freq('E5'), 0.9, 0.08 * v, { reverb: 0.5 });
  },
  alert: (s, t, v) => {
    s._tone(t, 'triangle', freq('A2'), freq('A2'), 0.5, 0.16 * v, { attack: 0.03 });
    s._tone(t, 'triangle', freq('A#2'), freq('A#2'), 0.5, 0.1 * v, { attack: 0.03 });
  },
  victory: (s, t, v) => {
    ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => s._tone(t + i * 0.16, 'triangle', freq(n), freq(n), 0.9, 0.12 * v, { reverb: 0.5 }));
  },
  defeat: (s, t, v) => {
    ['A4', 'F4', 'D4', 'A3'].forEach((n, i) => s._tone(t + i * 0.22, 'triangle', freq(n), freq(n), 1, 0.1 * v, { reverb: 0.5 }));
  },
};
