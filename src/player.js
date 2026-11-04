// Estado de una nación (humana o bot).
import { CONFIG } from './config.js';

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

    /** Casillas propias que tocan algo ajeno (otra nación, tierra libre o agua). */
    this.border = new Set();
    /** Ataques activos, por id de objetivo (0 = tierra libre). */
    this.attacks = new Map();
    this.boatCount = 0;
    /** Edificios por tipo (se actualiza al construir, capturar o perder). */
    this.buildings = { city: 0, port: 0, fort: 0 };
    /** Fortalezas propias (casillas), para calcular la defensa. */
    this.forts = new Set();

    this.maxTilesReached = 0;
    this.eliminatedTick = -1;
    this.lastConqueredBy = 0;

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
    const raw = CONFIG.growthBase + Math.pow(this.tiles, CONFIG.growthTileExp) * CONFIG.growthTileMult;
    return raw * (1 - this.troops / max);
  }

  goldPerTick() {
    if (!this.tiles) return 0;
    const base = CONFIG.goldBase + Math.pow(this.tiles, CONFIG.goldTileExp) * CONFIG.goldTileMult;
    return base * (1 + this.buildings.port * CONFIG.portGoldBonus);
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
