// Estado de una nación (humana o bot).
import { CONFIG } from './config.js';

/**
 * x^0,75 solo con raíces cuadradas: a diferencia de Math.pow, da el mismo
 * resultado en todos los navegadores, requisito del multijugador.
 */
export function pow34(x) {
  const s = Math.sqrt(x);
  return s * Math.sqrt(s);
}

/** Bonus de oro de `levels` niveles de puerto o fábrica, con rendimiento decreciente. */
export function goldBonus(levels, per) {
  return (per * levels) / (1 + CONFIG.bonusFalloff * levels);
}

export class Player {
  constructor(id, name, color, isHuman) {
    this.id = id;
    this.name = name;
    this.color = color; // [r, g, b]
    this.isHuman = isHuman;
    /** Colonia: bot débil que no es una nación (ni construye ni firma alianzas). */
    this.weak = false;
    this.strength = 1;
    // Reglas de la partida: multiplicadores de crecimiento de tropas y de oro
    this.troopMult = 1;
    this.goldMult = 1;
    /** Resumen de vecinos de la IA guardado (ver Game.neighborSummary). */
    this._nbSummary = null;
    /** Última casilla que perdió (donde sale el botín al ser eliminado). */
    this.lastTile = -1;

    /** Soldados: atacan y defienden (es la cifra de «tropas» de todo el juego). */
    this.troops = 0;
    /** Trabajadores: producen el oro de cada turno. */
    this.workers = 0;
    /** Fracción de la población que quiere como soldados (el resto, trabajadores). */
    this.soldierShare = CONFIG.soldierShare;
    this.gold = CONFIG.startGold;
    this.tiles = 0;
    this.alive = true;
    this.spawned = false;
    this.spawnTile = -1;
    this.homeTile = -1; // mapas reales: casilla de su país

    /** Casillas propias que tocan algo ajeno (otra nación, tierra libre o agua). */
    this.border = new Set();
    /** Ataques activos, por id de objetivo (0 = tierra libre). */
    this.attacks = new Map();
    this.boatCount = 0;
    /** Edificios por tipo (se actualiza al construir, capturar o perder). */
    // warship = buques a flote; missile no se usa (el misil no se acumula)
    this.buildings = { city: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0, warship: 0, missile: 0 };
    /** Edificios terminados por tipo y suma de sus niveles (los que están en obras no cuentan). */
    this.active = { city: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0 };
    this.levels = { city: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0 };
    /** Compras con inflación hechas en la partida (encarecen las siguientes). */
    this.purchases = 0;
    /** Fortalezas propias terminadas (casillas), para calcular la defensa. */
    this.forts = new Set();

    this.maxTilesReached = 0;
    this.eliminatedTick = -1;
    this.lastConqueredBy = 0;

    // Aspecto (perfil): emblema y patrón del territorio
    this.emblem = null; // { shape, symbol, bg, fg }
    this.flag = ''; // mapas reales: código ISO de su bandera
    this.pattern = 'liso';

    /** Contadores de la partida, para logros y estadísticas. */
    this.stats = { built: 0, kills: 0, landings: 0, alliances: 0, maxGold: 0, maxCities: 0, sunk: 0, missiles: 0, maxFactories: 0 };

    // Diplomacia
    this.allies = new Set();
    this.traitorUntil = 0; // tick hasta el que figura como traidor
    this.betrayals = 0;
    this.lastEmojiTick = -Infinity;
    /** id → tick a partir del cual se le puede volver a proponer alianza. */
    this.requestCooldown = new Map();
  }

  /** Población total: soldados + trabajadores. */
  population() {
    return this.troops + this.workers;
  }

  /** Capacidad máxima de población: base + territorio + ciudades. */
  maxTroops() {
    return (CONFIG.maxTroopsBase + this.tiles * CONFIG.maxTroopsPerTile + this.levels.city * CONFIG.cityMaxTroops) * this.strength;
  }

  /**
   * Crecimiento de la población por turno: k × (10 + P^0,75 / 4) × (1 − P / Pmáx).
   * Lo más rápido hacia el 43 % del máximo; 0 en el tope y negativo por
   * encima (al perder territorio, la población sobrante se va).
   */
  growthPerTick() {
    const max = this.maxTroops();
    const P = Math.max(0, this.troops + this.workers);
    const raw = CONFIG.popGrowthBase + pow34(P) / CONFIG.popGrowthDiv;
    return CONFIG.popGrowthScale * raw * (1 - P / max) * this.strength * this.troopMult;
  }

  /** Oro por turno: lo producen los trabajadores (más con puertos y fábricas). */
  goldPerTick() {
    if (!this.tiles) return 0;
    return (CONFIG.goldBase + pow34(Math.max(0, this.workers)) * CONFIG.goldPerWorker) * (1 + goldBonus(this.levels.port, CONFIG.portGoldBonus) + goldBonus(this.levels.factory, CONFIG.factoryGoldBonus)) * this.goldMult;
  }

  maxBoats() {
    return CONFIG.maxBoats;
  }

  troopsInAttacks() {
    let sum = 0;
    for (const atk of this.attacks.values()) sum += atk.troops;
    return sum;
  }
}
