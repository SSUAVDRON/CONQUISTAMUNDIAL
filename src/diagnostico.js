// Diagnóstico local (auditoría técnica): con ?diag=1 en la dirección, la
// partida registra por turno y por evento lo necesario para comparar reglas
// (reserva, techo, regeneración, oro, frentes, envíos, bajas y reembolsos).
// Todo en unidades internas; al exportar se añaden las visibles (÷ 10).
// Exportar: __trinchera.diag.exportar() o Ctrl+Mayús+D (descarga un JSON).
// Sin ?diag=1, game.trace es null y el motor no hace nada de esto.
import { TROOP_SCALE } from './format.js';

/** Máximo de registros guardados (unos 25 min de partida a 10 turnos/s con un frente). */
const MAX_EVENTS = 40000;
/** Campos con tropas internas: al exportar se añade su cifra visible (`campo_vis`). */
const TROOP_FIELDS = ['reserva', 'techo', 'trabajadores', 'regeneracion', 'enviadas', 'bajas', 'restantes', 'reembolso'];

export class Diagnostico {
  /** `info`: { build, mechVersion, ruleset } de esta versión del juego. */
  constructor(game, info = {}) {
    this.game = game;
    this.events = [];
    this.dropped = 0;
    /** Jugadores que se registran turno a turno (por defecto, el humano local). */
    this.players = new Set(game.human ? [game.human.id] : []);
    this.lastIncome = new Map();
    this.header = { ...info, seed: game.seed, rules: game.rules, perfil: game.profile.id, mapa: game.map.width + '×' + game.map.height, inicio: new Date().toISOString() };
    game.trace = this;
  }

  push(e) {
    if (this.events.length < MAX_EVENTS) this.events.push(e);
    else this.dropped++;
  }

  /** Lo llama el motor al final de cada turno de juego. */
  onTick(game) {
    for (const id of this.players) {
      const p = game.players[id];
      if (!p || !p.alive) continue;
      const gb = p.goldBreakdown();
      const i = p.income;
      const events = i.trade + i.conquest + i.loot + i.gifts;
      const before = this.lastIncome.get(id) ?? events;
      this.lastIncome.set(id, events);
      this.push({
        t: 'turno',
        tick: game.ticks,
        jugador: id,
        casillas: p.tiles,
        reserva: p.troops,
        techo: p.maxTroops(),
        trabajadores: p.workers,
        regeneracion: p.growthPerTick(),
        oroPasivo: gb.base + gb.workers + gb.bonus,
        oroEvento: events - before,
        oro: p.gold,
      });
    }
  }

  /** ¿Se registra este jugador? */
  wants(p) {
    return p && this.players.has(p.id);
  }

  exportar(descargar = true) {
    const events = this.events.map((e) => {
      const o = { ...e };
      for (const k of TROOP_FIELDS) if (typeof o[k] === 'number') o[`${k}_vis`] = Math.round((o[k] / TROOP_SCALE) * 10) / 10;
      return o;
    });
    const data = { ...this.header, fin: new Date().toISOString(), turnos: this.game.ticks, descartados: this.dropped, eventos: events };
    if (descargar && typeof document !== 'undefined') {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trinchera-diag-${this.header.perfil}-${this.game.seed}-t${this.game.ticks}.json`;
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    }
    return data;
  }
}
