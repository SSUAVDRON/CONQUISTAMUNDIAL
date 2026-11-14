// Tutorial guiado: una partida pequeña con pasos que avanzan solos cuando el
// jugador hace lo que se le pide. Cada paso puede resaltar un control.

import { AREA, CONFIG, TICK_MS } from './config.js';
import { fmtTroops, formatNumber } from './format.js';

const $ = (id) => document.getElementById(id);

/** Abre un grupo de la barra de edificios (en el móvil están plegados en una bandeja). */
const openGroup = (id) => $('construir')?.dispatchEvent(new CustomEvent('abrir-grupo', { detail: id }));

/** Por segundo, como en el panel (+178/s, +1,3k/s). */
const perSecond = 1000 / TICK_MS;
const troopsPerSecond = (h) => `${fmtTroops(Math.max(0, h.growthPerTick() * perSecond))}/s`;
const goldPerSecond = (h) => `${formatNumber(h.goldPerTick() * perSecond)}/s`;

/**
 * Pasos: `text` (o una función del estado), `check(s)` (¿cumplido?),
 * `enter(s)` (al empezar el paso), `highlight` (selector CSS), `info` (solo
 * se avanza con el botón, que dice `next`) y `pause` (la partida espera
 * mientras dura el paso: para leer o practicar sin que la IA avance, DEV02).
 * `s` es el estado de main.js: { game, human, ratio }.
 */
const STEPS = [
  {
    text: 'Bienvenido a Trinchera. Toca una zona de tierra libre para elegir dónde empieza tu nación, o pulsa «Elegir por mí». La cuenta atrás espera a que elijas.',
    pause: true,
    check: (s) => s.human.spawned,
  },
  {
    text: (s) =>
      `Bien. Tus tropas crecen solas (ahora +${troopsPerSecond(s.human)}; más rápido cuanto más cerca del 42 % de tu techo) y ganas oro cada segundo (+${goldPerSecond(s.human)}): lo ves en el panel de abajo. Pulsa «Empezar» cuando quieras: la IA no se mueve hasta entonces.`,
    highlight: '#panel-jugador',
    info: true,
    next: 'Empezar',
    pause: true,
    leave: (s, tut) => tut.onStartNow?.(),
  },
  {
    text: 'Expándete: haz clic en tierra libre junto a tu territorio. Conquistarla cuesta pocas tropas.',
    enter: (s, step) => {
      step.startTiles = s.human.tiles;
    },
    check: (s, step) => s.human.tiles >= step.startTiles + 40 * AREA,
  },
  {
    text: 'La fuerza de ataque decide qué parte de tus tropas envías en cada clic; el resto se queda defendiendo. Pulsa la tecla 5 o mueve el control al 50 %. La partida espera mientras lo pruebas.',
    highlight: '#panel-jugador .ratio',
    pause: true,
    check: (s) => Math.abs(s.ratio - 0.2) > 0.04,
  },
  {
    text: 'Construye una ciudad: pulsa Q (o Economía → Ciudad) y haz clic dentro de tu territorio. Te damos el oro.',
    highlight: '#hud [data-kind="city"]',
    enter: (s) => {
      s.human.gold = Math.max(s.human.gold, s.game.buildCost(s.human, 'city'));
      openGroup('economia');
    },
    check: (s) => s.human.buildings.city >= 1,
  },
  {
    text: 'Ataca a una nación vecina haciendo clic en su territorio. Verás sus tropas en el frente. Si aún no tocas a nadie, sigue expandiéndote.',
    check: (s) => [...s.human.attacks.keys()].some((id) => id !== 0),
  },
  {
    text: 'Diplomacia: haz clic derecho (o mantén pulsado) sobre otra nación y pulsa «Proponer alianza».',
    check: (s) => s.human.allies.size > 0 || s.game.requests.some((r) => r.from === s.human.id),
  },
  {
    text: 'Construye un puerto en tu costa (o en la orilla de un río que llegue al mar) con la tecla E, o Economía → Puerto. Sus mercantes irán a puertos de otros países y os darán oro a los dos al llegar. Si no tienes costa, salta este paso.',
    highlight: '#hud [data-kind="port"]',
    enter: (s) => {
      s.human.gold = Math.max(s.human.gold, s.game.buildCost(s.human, 'port'));
      openGroup('economia');
    },
    check: (s) => s.human.buildings.port >= 1,
  },
  {
    text: 'Ya conoces lo básico. Sigue jugando esta partida o vuelve al menú cuando quieras. En la guía del inicio tienes misiles, buques y más.',
    info: true,
    next: 'Terminar',
  },
];

export class Tutorial {
  /** `onFinish()` se llama al completar (no al saltar). */
  constructor({ onFinish, onStartNow, onAuto }) {
    this.onFinish = onFinish;
    this.onStartNow = onStartNow; // empezar ya la partida (fin del despliegue)
    this.onAuto = onAuto; // «Elegir por mí» durante el despliegue
    this.active = false;
    this.index = 0;
    this._lit = null;
    $('tut-saltar').addEventListener('click', () => this.stop());
    $('tut-paso-saltar').addEventListener('click', () => this._advance());
    $('tut-siguiente').addEventListener('click', () => this._advance());
    $('tut-auto')?.addEventListener('click', () => this.onAuto?.());
  }

  /** ¿Espera la partida? (pasos de lectura o de práctica: la IA no avanza) */
  holds() {
    if (!this.active || this.index < 0) return false;
    return !!STEPS[this.index]?.pause;
  }

  start(state) {
    this.active = true;
    this.index = -1;
    this.state = state;
    $('tutorial').hidden = false;
    document.body.classList.add('con-tutorial');
    this._advance();
  }

  stop() {
    this.active = false;
    $('tutorial').style.bottom = '';
    $('tutorial').style.maxHeight = '';
    $('tutorial').hidden = true;
    document.body.classList.remove('con-tutorial');
    this._highlight(null);
  }

  _advance() {
    const prev = STEPS[this.index];
    if (prev && this.state) prev.leave?.(this.state, this);
    this.index++;
    if (this.index >= STEPS.length) {
      this.stop();
      this.onFinish?.();
      return;
    }
    const step = STEPS[this.index];
    step.enter?.(this.state, step);
    $('tut-paso').textContent = `Paso ${this.index + 1} de ${STEPS.length}`;
    $('tut-texto').textContent = typeof step.text === 'function' ? step.text(this.state, step) : step.text;
    $('tut-siguiente').hidden = !step.info;
    $('tut-siguiente').textContent = step.next || (this.index === STEPS.length - 1 ? 'Terminar' : 'Siguiente');
    this._spawnRow();
    $('tut-paso-saltar').hidden = !!step.info;
    $('tut-puntos').replaceChildren(
      ...STEPS.map((_, i) => {
        const dot = document.createElement('span');
        if (i <= this.index) dot.className = 'hecho';
        return dot;
      }),
    );
    this._highlight(step.highlight || null);
    requestAnimationFrame(() => this._place());
  }

  _highlight(selector) {
    if (this._lit) this._lit.classList.remove('resalta');
    this._lit = selector ? document.querySelector(selector) : null;
    if (this._lit) this._lit.classList.add('resalta');
  }

  /**
   * Despliegue dentro de la tarjeta (DEV02): durante la cuenta atrás, el
   * aviso de «Elige dónde empezar» no sale aparte encima del tutorial; la
   * tarjeta muestra los segundos y «Elegir por mí» en una sola región.
   */
  _spawnRow() {
    const row = $('tut-despliegue');
    if (!row) return;
    const g = this.state?.game;
    const spawning = !!(this.active && g && g.phase === 'spawn');
    row.hidden = !spawning;
    if (!spawning) return;
    const left = Math.max(0, Math.ceil(((CONFIG.spawnTicks - g.ticks) * TICK_MS) / 1000));
    const chosen = !!this.state.human?.spawned;
    $('tut-reloj').textContent = this.holds() ? `Cuenta atrás en pausa · ${left} s` : `Quedan ${left} s`;
    $('tut-auto').hidden = chosen;
  }

  /**
   * Una sola región para la ayuda (DEV02): en pantallas estrechas la tarjeta
   * va justo encima de lo que haya abajo (el panel del jugador y, si está
   * abierta, la bandeja de edificios), recalculado al cambiar el panel, el
   * banco, la bandeja, el tamaño o la orientación; si no cabe entera, se
   * desplaza dentro.
   */
  _place() {
    const box = $('tutorial');
    if (!this.active || !box || box.hidden) return;
    if (window.innerWidth > 720) {
      box.style.bottom = '';
      box.style.maxHeight = '';
      return;
    }
    let top = window.innerHeight;
    for (const id of ['panel-jugador', 'bandeja-obras']) {
      const e = $(id);
      if (!e || e.hidden || (id === 'bandeja-obras' && !e.classList.contains('abierto'))) continue;
      const r = e.getBoundingClientRect();
      if (r.height) top = Math.min(top, r.top);
    }
    const bottom = Math.round(window.innerHeight - top + 10);
    box.style.bottom = `${bottom}px`;
    box.style.maxHeight = `${Math.max(120, window.innerHeight - bottom - 64)}px`;
  }

  /** Llamar cada pocos frames con el estado actual. */
  update(state) {
    if (!this.active || !state.human) return;
    this.state = state;
    this._spawnRow();
    this._place();
    const step = STEPS[this.index];
    if (!step.info && step.check(state, step)) this._advance();
  }
}
