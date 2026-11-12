// Sonido del juego, todo sintetizado con Web Audio (sin ficheros):
// - música medieval y bélica que cambia con la partida (ver musica.js): una
//   procesión en el menú, laúd y flauta en calma, tambores y cuernos en guerra;
// - efectos del menú: madera al pulsar, roce al pasar por encima, pergamino al
//   cambiar de pestaña, diálogos que se despliegan, interruptores, equipar
//   (espada que se desenvaina), compras, «listo» y la cuenta atrás de la sala;
// - efectos de la batalla: choques de espadas y gritos en los frentes que se
//   ven (más flojos cuanto más lejos), cargas, retiradas, despliegue, obras
//   (martillo) y edificios terminados con su sonido (campana, yunque…),
//   cañonazos, misiles, explosiones, barcos, monedas, avisos y fanfarrias.
// Solo escucha: no cambia nada de la simulación.
import { CONFIG } from './config.js';
import { Instrumentos, Musica, midi } from './musica.js';

/** Sonido al terminar cada tipo de edificio. */
const BUILT_SFX = { city: 'campana', port: 'campanaPuerto', factory: 'yunque', fort: 'piedra', silo: 'mecanismo', sam: 'mecanismo' };

export class Sound {
  constructor() {
    this.ctx = null;
    this.opts = { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, muted: false };
    this._last = new Map(); // tipo → último momento (para no saturar)
    this._seenFx = new WeakSet();
    this._seenAtk = new WeakSet();
    this._seenRetreat = new WeakSet();
    this._seenMissile = new WeakSet();
    this._shots = new Map(); // buque → último disparo oído
    this._prev = null; // datos del humano del fotograma anterior
    this._ended = false;
    this._warUntil = 0;
    this._warCheck = 0;
    this._ambAt = 0;
  }

  /** Suelta lo que recordaba de la partida anterior (buques y datos del humano). */
  releaseGame() {
    this._shots.clear();
    this._prev = null;
    this._warUntil = 0;
  }

  /** Se llama en el primer gesto del usuario (los navegadores no dejan sonar antes). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this._build(new AC());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  /** Monta el grafo de audio sobre `ctx` (también sirve con un OfflineAudioContext). */
  _build(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // Eco (reverberación de sala de piedra) compartido: ruido que se apaga
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.5;
    this.reverb.connect(this.reverbOut).connect(this.master);
    this._noise = this._noiseBuffer();
    this.ins = new Instrumentos(ctx, this.reverb, this._noise);
    this.music = new Musica(ctx, this.musicBus, this.ins);
    this._applyVolumes();
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.opts;
    // La música, por debajo de los efectos; los efectos, bien audibles (el
    // compresor del final evita que se saturen cuando coinciden varios)
    this.master.gain.setTargetAtTime(o.muted ? 0 : 1, t, 0.08);
    this.musicBus.gain.setTargetAtTime(o.music ? 0.36 * o.musicVol : 0, t, 0.4);
    this.sfxBus.gain.setTargetAtTime(o.sfx ? 1.1 * o.sfxVol : 0, t, 0.05);
    this.music?.setEnabled(o.music && !o.muted);
  }

  /** Ambiente de la música: 'menu', 'calma' o 'guerra'. */
  setMood(m) {
    this.music?.setMood(m);
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
    if (!fn) return;
    fn(this, ctx.currentTime + 0.01, vol);
    // Las fanfarrias y avisos grandes se oyen por encima de la música
    if (DUCK[name]) this.music?.duck(0.3, DUCK[name]);
  }

  /** Tono con envolvente: forma, frecuencia inicial → final, duración, volumen. */
  _tone(t, type, f0, f1, dur, vol, { reverb = 0, attack = 0.005 } = {}) {
    this.ins._sine(this.sfxBus, t, f0, f1, dur, vol, { rev: reverb, attack, type });
  }

  /** Ruido filtrado (soplos, explosiones): paso banda/bajo que se desliza de f0 a f1. */
  _noiseBurst(t, type, f0, f1, dur, vol, { q = 1, reverb = 0, attack = 0.005 } = {}) {
    this.ins._noise(this.sfxBus, t, type, f0, f1, dur, vol, { q, attack, rev: reverb });
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
      // Cada ataque contra ti avisa, pero el cuerno de guerra no se repite sin parar
      this.play(evt.sfx, 1, evt.sfx === 'war' ? 8000 : evt.sfx === 'fall' ? 3000 : 250);
      if (evt.sfx === 'war') this._warUntil = performance.now() + 30000;
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
    if (!this.ctx) return;
    if (!game || demo) {
      this.setMood('menu');
      return;
    }
    const now = performance.now();
    // Música: en guerra mientras luchas contra una nación (o te atacan), y
    // un rato después; si no, calma
    if (game.phase === 'spawn' || !human) this.setMood('calma');
    else {
      if (now > this._warCheck) {
        this._warCheck = now + 500;
        if (human.alive && atWar(game, human)) this._warUntil = Math.max(this._warUntil, now + 20000);
      }
      this.setMood(now < this._warUntil && game.phase !== 'ended' ? 'guerra' : 'calma');
    }
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
      if (e.kind === 'boom') this.play(e.r > CONFIG.missileRadius * 1.5 ? 'boomGrande' : 'boom', near(e.x, e.y), 120);
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
    this._battleAmbience(game, camera, human, near, now);
    if (human) {
      const builtNow = human.stats.built;
      const prev = this._prev;
      const same = prev && prev.game === game;
      if (same) {
        if (builtNow > prev.built) this.play('build', 0.8, 150);
        // Edificio terminado (o subido de nivel): el sonido de su tipo
        for (const k in BUILT_SFX) {
          const n = (human.active[k] || 0) + (human.levels[k] || 0);
          if (n > (prev.done[k] || 0)) this.play(BUILT_SFX[k], 0.75, 300);
        }
        if (human.boatCount > prev.boats) this.play('boat', 0.7, 300);
        if (human.spawned && !prev.spawned) this.play('despliegue', 0.9, 500);
        if (prev.alive && !human.alive) this.play('defeat', 1, 0);
      }
      let vsNation = false;
      let vsWild = false;
      for (const atk of human.attacks.values()) {
        if (atk.targetId) vsNation = true;
        else vsWild = true;
        if (atk.retreatAt && !this._seenRetreat.has(atk)) {
          this._seenRetreat.add(atk);
          this.play('retirada', 0.8, 600);
        }
        if (this._seenAtk.has(atk)) continue;
        this._seenAtk.add(atk);
        const target = atk.targetId ? game.players[atk.targetId] : null;
        if (!target) this.play('launch', 0.8, 250);
        else this.play(target.weak ? 'chargeColony' : 'charge', 0.8, 1500);
      }
      // Mientras avanzas: tambores de marcha contra naciones y un roce suave
      // al expandirte por tierra libre (con calma: no cada casilla)
      if (same && human.tiles > prev.tiles) {
        if (vsNation) this.play('march', 0.7, 650);
        else if (vsWild) this.play('expand', 0.6, 1100);
      }
      // Pierdes casillas a manos de otros: golpes sordos
      if (same && human.tiles < prev.tiles - 2) this.play('hit', 0.7, 700);
      const done = {};
      for (const k in BUILT_SFX) done[k] = (human.active[k] || 0) + (human.levels[k] || 0);
      this._prev = { game, built: builtNow, done, boats: human.boatCount, tiles: human.tiles, spawned: human.spawned, alive: human.alive };
      if (game.phase === 'ended' && !this._ended) {
        this._ended = true;
        const won = game.winner === human || !!(game.winningAlliance && game.winningAlliance.includes(human));
        if (human.alive || won) this.play(won ? 'victory' : 'defeat', 1, 0);
      } else if (game.phase !== 'ended') this._ended = false;
    }
  }

  /**
   * Batallas a la vista: de vez en cuando, choques de espadas (y algún grito)
   * en el frente entre naciones más cercano a la cámara. Mira unos pocos
   * ataques por vez (hay cientos) y suena más flojo cuanto más alejada está.
   */
  _battleAmbience(game, camera, human, near, now) {
    if (now < this._ambAt || game.phase !== 'playing') return;
    this._ambAt = now + 300;
    const list = game.attacks;
    const n = list.length;
    if (!n) return;
    const W = game.map.width;
    let best = 0;
    let mineBest = false;
    const start = (Math.random() * n) | 0;
    for (let k = 0; k < Math.min(n, 48); k++) {
      const atk = list[(start + k) % n];
      if (atk.done || !atk.targetId || atk.troops < 1 || !atk.inFrontier.size) continue;
      const t = atk.inFrontier.values().next().value;
      let v = near((t % W) + 0.5, ((t / W) | 0) + 0.5);
      if (v <= 0) continue;
      const mine = !!human && (atk.attacker === human || atk.targetId === human.id);
      if (!mine) v *= 0.6;
      if (v > best) {
        best = v;
        mineBest = mine;
      }
    }
    if (!best) return;
    // Alejado se oye como algo lejano; de cerca, la batalla de verdad
    const zk = Math.max(0.18, Math.min(1, (camera.zoom - 0.25) / 1.6));
    const v = best * zk;
    this.play('clash', v * (0.5 + Math.random() * 0.4), 90);
    if (Math.random() < 0.35) setTimeout(() => this.play('clash', v * 0.4, 60), 90 + Math.random() * 120);
    if (Math.random() < (mineBest ? 0.1 : 0.05)) this.play('grito', v * 0.55, 3000);
    // Cuanto más lejos, más espaciados
    this._ambAt = now + 260 + (1 - v) * 900 + Math.random() * 350;
  }
}

/** ¿Lucha el humano contra una nación (no una colonia), atacando o atacado? */
function atWar(game, human) {
  for (const atk of human.attacks.values()) {
    if (atk.done || !atk.targetId) continue;
    const t = game.players[atk.targetId];
    if (t && !t.weak) return true;
  }
  for (const atk of game.attacks) {
    if (atk.done || atk.targetId !== human.id) continue;
    if (!atk.attacker.weak) return true;
  }
  return false;
}

/** Segundos que la música se aparta para estos efectos. */
const DUCK = { conquer: 2.2, war: 1.6, victory: 4.5, defeat: 4, start: 2, nivel: 2.5, alliance: 1.2, betray: 1.4 };

/** Recetas de efectos: (sonido, momento, volumen). */
const SFX = {
  // ---- menú
  // Madera: un golpe seco y corto (botones)
  click: (s, t, v) => s.ins.drum(s.sfxBus, t, 'madera', 0.32 * v),
  // Pasar el ratón por encima: un roce casi inaudible
  hover: (s, t, v) => s._noiseBurst(t, 'bandpass', 2400, 2900, 0.035, 0.05 * v, { q: 3 }),
  // Pestañas: pergamino que se pasa
  pagina: (s, t, v) => {
    s._noiseBurst(t, 'bandpass', 1100, 3800, 0.2, 0.16 * v, { q: 0.8, attack: 0.05 });
    s._noiseBurst(t + 0.13, 'highpass', 5000, 4000, 0.04, 0.05 * v);
  },
  // Diálogo: se despliega (soplo que sube y golpe suave); al cerrar, al revés
  abrir: (s, t, v) => {
    s._noiseBurst(t, 'bandpass', 700, 2600, 0.24, 0.12 * v, { q: 0.9, attack: 0.08 });
    s._tone(t + 0.18, 'sine', 180, 120, 0.12, 0.12 * v);
  },
  cerrar: (s, t, v) => s._noiseBurst(t, 'bandpass', 2400, 700, 0.18, 0.1 * v, { q: 0.9, attack: 0.03 }),
  // Interruptor: pestillo de metal
  interruptorOn: (s, t, v) => {
    s._noiseBurst(t, 'highpass', 4000, 3500, 0.02, 0.12 * v);
    s._tone(t + 0.01, 'triangle', 1500, 1700, 0.05, 0.08 * v);
  },
  interruptorOff: (s, t, v) => {
    s._noiseBurst(t, 'highpass', 3500, 3000, 0.02, 0.1 * v);
    s._tone(t + 0.01, 'triangle', 1300, 1050, 0.05, 0.07 * v);
  },
  // Elegir un modo de juego: tambor de guerra y un acorde de laúd
  elegir: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.35 * v);
    [midi('D3'), midi('A3'), midi('D4'), midi('F4')].forEach((m, i) => s.ins.pluck(s.sfxBus, t + 0.02 + i * 0.035, m, 0.22 * v, { rev: 0.4 }));
  },
  // Equipar: espada que se desenvaina
  equipar: (s, t, v) => {
    s._noiseBurst(t, 'bandpass', 1800, 6500, 0.32, 0.14 * v, { q: 5, attack: 0.04 });
    s.ins.clash(s.sfxBus, t + 0.3, 0.45 * v, { rev: 0.45 });
  },
  // «Estoy listo»: tambor y nota de cuerno
  listo: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.6 * v);
    s.ins.horn(s.sfxBus, t + 0.05, midi('A3'), 0.45, 0.16 * v);
  },
  // Cuenta atrás de la sala: un tambor por segundo
  cuenta: (s, t, v) => s.ins.drum(s.sfxBus, t, 'tambor', 0.9 * v),
  // Subes de nivel: fanfarria de cuernos con campana
  nivel: (s, t, v) => {
    [['D4', 0, 0.16], ['A4', 0.16, 0.16], ['D5', 0.32, 0.9]].forEach(([n, d, l]) => s.ins.horn(s.sfxBus, t + d, midi(n), l, 0.2 * v, { rev: 0.45 }));
    s.ins.bell(s.sfxBus, t + 0.32, midi('D5'), 0.35 * v);
    s.ins.drum(s.sfxBus, t + 0.32, 'grande', 0.6 * v);
  },
  logro: (s, t, v) => {
    s.ins.bell(s.sfxBus, t, midi('A5'), 0.3 * v);
    [midi('D4'), midi('F4'), midi('A4'), midi('D5')].forEach((m, i) => s.ins.pluck(s.sfxBus, t + 0.05 + i * 0.06, m, 0.3 * v, { rev: 0.45 }));
  },
  error: (s, t, v) => {
    s._tone(t, 'triangle', 220, 200, 0.12, 0.12 * v);
    s._tone(t + 0.1, 'triangle', 185, 170, 0.16, 0.1 * v);
  },

  // ---- construcción
  // Obras: martillo sobre madera, dos golpes
  build: (s, t, v) => {
    for (const [d, l] of [[0, 1], [0.16, 0.8]]) {
      s._tone(t + d, 'sine', 300, 160, 0.08, 0.3 * l * v);
      s._noiseBurst(t + d, 'bandpass', 1800, 1200, 0.05, 0.25 * l * v, { q: 2 });
    }
  },
  built: (s, t, v) => {
    s._tone(t, 'sine', 660, 660, 0.7, 0.13 * v, { reverb: 0.5 });
    s._tone(t + 0.09, 'sine', 990, 990, 0.8, 0.1 * v, { reverb: 0.5 });
  },
  // Ciudad: campana de iglesia; puerto: campana de barco (más aguda y corta)
  campana: (s, t, v) => s.ins.bell(s.sfxBus, t, midi('G4'), 0.4 * v, { dur: 3 }),
  campanaPuerto: (s, t, v) => {
    s.ins.bell(s.sfxBus, t, midi('E6'), 0.32 * v, { dur: 1.2 });
    s.ins.bell(s.sfxBus, t + 0.22, midi('E6'), 0.26 * v, { dur: 1.4 });
  },
  // Fábrica: yunque (metal con eco)
  yunque: (s, t, v) => {
    for (const d of [0, 0.22]) {
      s.ins.clash(s.sfxBus, t + d, 0.6 * v, { rev: 0.3 });
      s._tone(t + d, 'sine', 1050, 1040, 0.5, 0.08 * v, { reverb: 0.3 });
    }
  },
  // Puesto defensivo: piedra que encaja
  piedra: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 900, 200, 0.22, 0.35 * v);
    s._tone(t, 'sine', 110, 60, 0.25, 0.4 * v);
    s._noiseBurst(t + 0.08, 'bandpass', 2500, 1500, 0.1, 0.08 * v, { q: 1.5 });
  },
  // Silo y antimisiles: mecanismo que se cierra
  mecanismo: (s, t, v) => {
    [0, 0.07, 0.14].forEach((d, i) => s._noiseBurst(t + d, 'bandpass', 3000 - i * 400, 2500, 0.03, 0.2 * v, { q: 4 }));
    s._tone(t + 0.2, 'sine', 180, 70, 0.35, 0.3 * v);
    s._noiseBurst(t + 0.2, 'lowpass', 1200, 200, 0.3, 0.2 * v);
  },

  // ---- batalla
  launch: (s, t, v) => s._noiseBurst(t, 'bandpass', 350, 1300, 0.38, 0.22 * v, { q: 0.9, attack: 0.08 }),
  // Atacas a una nación: tambor, cuerno de carga y la tropa que grita
  charge: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.7 * v);
    s.ins.horn(s.sfxBus, t + 0.05, midi('D4'), 0.18, 0.16 * v);
    s.ins.horn(s.sfxBus, t + 0.24, midi('A4'), 0.55, 0.18 * v);
    s.ins.shout(s.sfxBus, t + 0.35, 0.22 * v, { voices: 7, dur: 1 });
  },
  // A por una colonia: tambor y un grito corto
  chargeColony: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.55 * v);
    s.ins.shout(s.sfxBus, t + 0.08, 0.14 * v, { voices: 4, dur: 0.7 });
  },
  // Retirada: el cuerno baja
  retirada: (s, t, v) => {
    s.ins.horn(s.sfxBus, t, midi('A3'), 0.3, 0.15 * v);
    s.ins.horn(s.sfxBus, t + 0.3, midi('E3'), 0.7, 0.14 * v);
  },
  // Despliegue: estandarte clavado en la tierra (golpe y tela)
  despliegue: (s, t, v) => {
    s._tone(t, 'sine', 140, 55, 0.3, 0.5 * v);
    s._noiseBurst(t, 'lowpass', 700, 150, 0.2, 0.3 * v);
    for (let i = 0; i < 4; i++) s._noiseBurst(t + 0.14 + i * 0.07, 'bandpass', 900 + i * 150, 700, 0.07, 0.07 * v, { q: 0.8 });
    s.ins.horn(s.sfxBus, t + 0.18, midi('D4'), 0.6, 0.12 * v);
  },
  // Choque de espadas en un frente
  clash: (s, t, v) => s.ins.clash(s.sfxBus, t, 0.4 * v),
  // Gritos de batalla lejanos
  grito: (s, t, v) => s.ins.shout(s.sfxBus, t, 0.2 * v, { voices: 5, dur: 1.1, rev: 0.5 }),
  boat: (s, t, v) => {
    s._tone(t, 'sawtooth', 98, 96, 0.7, 0.05 * v, { attack: 0.08, reverb: 0.3 });
    s._tone(t, 'sine', 196, 194, 0.7, 0.07 * v, { attack: 0.08 });
    // Remos en el agua
    [0.15, 0.55].forEach((d) => s._noiseBurst(t + d, 'bandpass', 900, 400, 0.25, 0.1 * v, { q: 0.7, attack: 0.04 }));
  },
  missile: (s, t, v) => s._noiseBurst(t, 'bandpass', 300, 2600, 0.9, 0.2 * v, { q: 1.4, attack: 0.15, reverb: 0.3 }),
  boom: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1100, 90, 1.5, 0.55 * v, { reverb: 0.4 });
    s._tone(t, 'sine', 70, 38, 1.1, 0.45 * v);
  },
  boomGrande: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1400, 60, 2.6, 0.7 * v, { reverb: 0.5 });
    s._tone(t, 'sine', 60, 28, 2, 0.55 * v);
    s._noiseBurst(t + 0.4, 'lowpass', 500, 80, 2, 0.3 * v, { reverb: 0.4, attack: 0.3 });
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
  // Has conquistado una nación: fanfarria de cuernos, timbales, gong y coro
  conquer: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.9 * v);
    [['D4', 0, 0.13], ['D4', 0.14, 0.13], ['A4', 0.28, 0.26], ['F4', 0.56, 0.13], ['A4', 0.7, 0.13]].forEach(([n, d, l]) => s.ins.horn(s.sfxBus, t + d, midi(n), l, 0.2 * v));
    s.ins.horn(s.sfxBus, t + 0.84, midi('D5'), 1.3, 0.22 * v, { rev: 0.5 });
    s.ins.horn(s.sfxBus, t + 0.84, midi('A4'), 1.3, 0.14 * v, { rev: 0.5 });
    s.ins.drum(s.sfxBus, t + 0.84, 'gong', 0.7 * v);
    s.ins.choir(s.sfxBus, t + 0.84, [midi('D3'), midi('A3'), midi('D4')], 1.8, 0.22 * v, { attack: 0.25 });
  },
  // Has conquistado una colonia: fanfarria corta
  conquerColony: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.6 * v);
    s.ins.horn(s.sfxBus, t, midi('A4'), 0.14, 0.16 * v);
    s.ins.horn(s.sfxBus, t + 0.15, midi('D5'), 0.6, 0.17 * v, { rev: 0.45 });
  },
  // Una nación cae a lo lejos (no por ti): tambor apagado y campana lejana
  fall: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.45 * v);
    s.ins.bell(s.sfxBus, t + 0.1, midi('D4'), 0.25 * v, { rev: 0.7, dur: 2.4 });
  },
  // Te declaran la guerra / te atacan: tambores y el cuerno de alarma
  war: (s, t, v) => {
    [0, 0.16, 0.42].forEach((d, i) => s.ins.drum(s.sfxBus, t + d, 'grande', (i === 2 ? 1 : 0.75) * v));
    s.ins.horn(s.sfxBus, t + 0.5, midi('A3'), 0.35, 0.18 * v);
    s.ins.horn(s.sfxBus, t + 0.88, midi('A3'), 0.9, 0.2 * v, { rev: 0.5 });
    s.ins.horn(s.sfxBus, t + 0.88, midi('E4'), 0.9, 0.12 * v);
  },
  march: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'tambor', 0.6 * v);
    s._noiseBurst(t, 'highpass', 3000, 2500, 0.04, 0.05 * v);
  },
  expand: (s, t, v) => s._noiseBurst(t, 'bandpass', 900, 1700, 0.18, 0.08 * v, { q: 1.2, attack: 0.04 }),
  hit: (s, t, v) => {
    s._tone(t, 'sine', 80, 40, 0.25, 0.32 * v);
    s._noiseBurst(t, 'lowpass', 500, 100, 0.2, 0.15 * v);
    s.ins.clash(s.sfxBus, t + 0.02, 0.25 * v);
  },
  capture: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.5 * v);
    s.ins.horn(s.sfxBus, t + 0.05, midi('E4'), 0.15, 0.13 * v);
    s.ins.horn(s.sfxBus, t + 0.2, midi('A4'), 0.5, 0.14 * v, { rev: 0.4 });
  },
  sink: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1200, 150, 1.0, 0.35 * v, { reverb: 0.4 });
    s._tone(t + 0.1, 'sine', 160, 50, 1.0, 0.2 * v);
    s._noiseBurst(t + 0.35, 'bandpass', 600, 250, 0.8, 0.15 * v, { q: 0.6, attack: 0.2 });
  },
  land: (s, t, v) => {
    s._noiseBurst(t, 'lowpass', 1500, 300, 0.4, 0.25 * v);
    s.ins.drum(s.sfxBus, t + 0.1, 'grande', 0.5 * v);
    s.ins.shout(s.sfxBus, t + 0.2, 0.14 * v, { voices: 5, dur: 0.8 });
  },
  // Empieza la conquista (fin del despliegue): llamada de cuernos con tambores
  start: (s, t, v) => {
    [0, 0.2, 0.4].forEach((d) => s.ins.drum(s.sfxBus, t + d, 'grande', 0.7 * v));
    s.ins.horn(s.sfxBus, t + 0.4, midi('D4'), 0.25, 0.18 * v);
    s.ins.horn(s.sfxBus, t + 0.66, midi('A4'), 0.25, 0.18 * v);
    s.ins.horn(s.sfxBus, t + 0.92, midi('D5'), 1.1, 0.2 * v, { rev: 0.5 });
    s.ins.drum(s.sfxBus, t + 0.92, 'gong', 0.6 * v);
  },
  // Alianza: arpa que sube y campana
  alliance: (s, t, v) => {
    [midi('D4'), midi('F4'), midi('A4'), midi('C5'), midi('D5'), midi('F5')].forEach((m, i) => s.ins.pluck(s.sfxBus, t + i * 0.06, m, 0.3 * v, { rev: 0.5 }));
    s.ins.bell(s.sfxBus, t + 0.36, midi('A5'), 0.22 * v);
  },
  // Traición: cuernos disonantes que caen
  betray: (s, t, v) => {
    s.ins.horn(s.sfxBus, t, midi('E3'), 0.9, 0.15 * v);
    s.ins.horn(s.sfxBus, t, midi('F3'), 0.9, 0.13 * v);
    s.ins.drum(s.sfxBus, t, 'grande', 0.7 * v);
  },
  ding: (s, t, v) => s.ins.bell(s.sfxBus, t, midi('A5'), 0.22 * v, { dur: 1.6 }),
  // Últimos segundos del despliegue
  tick: (s, t, v) => s.ins.drum(s.sfxBus, t, 'tambor', 0.75 * v),
  chime: (s, t, v) => {
    s.ins.pluck(s.sfxBus, t, midi('A4'), 0.3 * v, { rev: 0.45 });
    s.ins.pluck(s.sfxBus, t + 0.1, midi('D5'), 0.28 * v, { rev: 0.45 });
  },
  // Alarma: cuerno grave y disonante
  alert: (s, t, v) => {
    s.ins.horn(s.sfxBus, t, midi('A2'), 0.5, 0.18 * v);
    s.ins.horn(s.sfxBus, t, midi('Bb2'), 0.5, 0.1 * v);
  },
  // Victoria: fanfarria completa con coro, campanas y gong
  victory: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.9 * v);
    [['D4', 0, 0.2], ['F4', 0.22, 0.2], ['A4', 0.44, 0.2], ['D5', 0.66, 0.42], ['C5', 1.1, 0.2], ['D5', 1.32, 1.6]].forEach(([n, d, l]) => s.ins.horn(s.sfxBus, t + d, midi(n), l, 0.2 * v, { rev: 0.5 }));
    s.ins.horn(s.sfxBus, t + 1.32, midi('A4'), 1.6, 0.14 * v, { rev: 0.5 });
    s.ins.drum(s.sfxBus, t + 1.32, 'gong', 0.8 * v);
    s.ins.choir(s.sfxBus, t + 1.32, [midi('D3'), midi('A3'), midi('D4'), midi('F#4')], 2.6, 0.24 * v, { attack: 0.3 });
    s.ins.bell(s.sfxBus, t + 1.32, midi('D5'), 0.3 * v, { dur: 3 });
  },
  // Derrota: lamento del coro y un cuerno que cae
  defeat: (s, t, v) => {
    s.ins.drum(s.sfxBus, t, 'grande', 0.7 * v);
    s.ins.choir(s.sfxBus, t, [midi('D3'), midi('F3'), midi('A3')], 2.8, 0.2 * v, { attack: 0.5 });
    [['A3', 0.2, 0.5], ['F3', 0.75, 0.5], ['D3', 1.3, 1.5]].forEach(([n, d, l]) => s.ins.horn(s.sfxBus, t + d, midi(n), l, 0.15 * v, { rev: 0.55 }));
    s.ins.bell(s.sfxBus, t + 1.3, midi('D4'), 0.28 * v, { rev: 0.7, dur: 3 });
  },
};
