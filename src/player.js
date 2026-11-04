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

export class Player {
  constructor(id, name, color, isHuman) {
    this.id = id;
    this.name = name;
    this.color = color; // [r, g, b]
    this.isHuman = isHuman;

    this.troops = 0;
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
    /** Fortalezas propias (casillas), para calcular la defensa. */
    this.forts = new Set();

    this.maxTilesReached = 0;
    this.eliminatedTick = -1;
    this.lastConqueredBy = 0;

    // Aspecto (perfil): emblema y patrón del territorio
    this.emblem = null; // { shape, symbol, bg, fg }
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

  maxTroops() {
    return CONFIG.maxTroopsBase + this.tiles * CONFIG.maxTroopsPerTile + this.buildings.city * CONFIG.cityMaxTroops;
  }

  /** Crecimiento por tick: rápido con pocas tropas, se frena al acercarse al máximo. */
  growthPerTick() {
    const max = this.maxTroops();
    if (this.troops >= max) return 0;
    const raw = CONFIG.growthBase + pow34(this.tiles) * CONFIG.growthTileMult;
    return raw * (1 - this.troops / max);
  }

  goldPerTick() {
    if (!this.tiles) return 0;
    const base = CONFIG.goldBase + pow34(this.tiles) * CONFIG.goldTileMult;
    return base * (1 + this.buildings.port * CONFIG.portGoldBonus + this.buildings.factory * CONFIG.factoryGoldBonus);
  }

  maxBoats() {
    return CONFIG.maxBoats + this.buildings.port;
  }

  troopsInAttacks() {
    let sum = 0;
    for (const atk of this.attacks.values()) sum += atk.troops;
    return sum;
  }
}
