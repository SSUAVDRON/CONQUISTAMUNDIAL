// Tutorial guiado: una partida pequeña con pasos que avanzan solos cuando el
// jugador hace lo que se le pide. Cada paso puede resaltar un control.

import { AREA } from './config.js';

const $ = (id) => document.getElementById(id);

/**
 * Pasos: `text`, `check(s)` (¿cumplido?), `enter(s)` (al empezar el paso),
 * `highlight` (selector CSS) e `info` (solo se avanza con «Siguiente»).
 * `s` es el estado de main.js: { game, human, ratio }.
 */
const STEPS = [
  {
    text: 'Bienvenido a Trinchera. Haz clic en una zona de tierra libre para elegir dónde empieza tu nación.',
    check: (s) => s.human.spawned,
  },
  {
    text: 'Bien. Cuando termine la cuenta atrás empieza la partida. Tus tropas se regeneran solas (más rápido hacia el 42 % del techo) y ganas 100 de oro por turno: lo ves en el panel de abajo.',
    highlight: '#panel-jugador',
    check: (s) => s.game.phase === 'playing',
  },
  {
    text: 'Expándete: haz clic en tierra libre junto a tu territorio. Conquistarla cuesta pocas tropas.',
    enter: (s, step) => {
      step.startTiles = s.human.tiles;
    },
    check: (s, step) => s.human.tiles >= step.startTiles + 40 * AREA,
  },
  {
    text: 'La fuerza de ataque decide qué parte de tus tropas envías en cada clic. Pulsa la tecla 5 o mueve el control al 50 %.',
    highlight: '#panel-jugador .ratio',
    check: (s) => Math.abs(s.ratio - 0.2) > 0.04,
  },
  {
    text: 'Construye una ciudad: pulsa Q (o el botón Ciudad) y haz clic dentro de tu territorio. Te damos el oro.',
    highlight: '#construir [data-kind="city"]',
    enter: (s) => {
      s.human.gold = Math.max(s.human.gold, s.game.buildCost(s.human, 'city'));
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
    text: 'Construye un puerto en tu costa con la tecla E. Sus mercantes irán a puertos de otros países y os darán oro a los dos al llegar. Si no tienes costa, salta este paso.',
    highlight: '#construir [data-kind="port"]',
    enter: (s) => {
      s.human.gold = Math.max(s.human.gold, s.game.buildCost(s.human, 'port'));
    },
    check: (s) => s.human.buildings.port >= 1,
  },
  {
    text: 'Ya conoces lo básico. Sigue jugando esta partida o vuelve al menú cuando quieras. En la ayuda del inicio tienes misiles, buques y más.',
    info: true,
  },
];

export class Tutorial {
  /** `onFinish()` se llama al completar (no al saltar). */
  constructor({ onFinish }) {
    this.onFinish = onFinish;
    this.active = false;
    this.index = 0;
    this._lit = null;
    $('tut-saltar').addEventListener('click', () => this.stop());
    $('tut-paso-saltar').addEventListener('click', () => this._advance());
    $('tut-siguiente').addEventListener('click', () => this._advance());
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
    $('tutorial').hidden = true;
    document.body.classList.remove('con-tutorial');
    this._highlight(null);
  }

  _advance() {
    this.index++;
    if (this.index >= STEPS.length) {
      this.stop();
      this.onFinish?.();
      return;
    }
    const step = STEPS[this.index];
    step.enter?.(this.state, step);
    $('tut-paso').textContent = `Paso ${this.index + 1} de ${STEPS.length}`;
    $('tut-texto').textContent = step.text;
    $('tut-siguiente').hidden = !step.info;
    $('tut-siguiente').textContent = this.index === STEPS.length - 1 ? 'Terminar' : 'Siguiente';
    $('tut-paso-saltar').hidden = !!step.info;
    $('tut-puntos').replaceChildren(
      ...STEPS.map((_, i) => {
        const dot = document.createElement('span');
        if (i <= this.index) dot.className = 'hecho';
        return dot;
      }),
    );
    this._highlight(step.highlight || null);
  }

  _highlight(selector) {
    if (this._lit) this._lit.classList.remove('resalta');
    this._lit = selector ? document.querySelector(selector) : null;
    if (this._lit) this._lit.classList.add('resalta');
  }

  /** Llamar cada pocos frames con el estado actual. */
  update(state) {
    if (!this.active || !state.human) return;
    this.state = state;
    const step = STEPS[this.index];
    if (!step.info && step.check(state, step)) this._advance();
  }
}
