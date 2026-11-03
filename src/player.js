// Estado de una nación (humana o bot).
import { CONFIG } from './config.js';

export class Player {
  constructor(id, name, color, isHuman) {
    this.id = id;
    this.name = name;
    this.color = color; // [r, g, b]
    this.isHuman = isHuman;

    this.troops = 0;
    this.tiles = 0;
    this.alive = true;
    this.spawned = false;
    this.spawnTile = -1;

    /** Casillas propias que tocan algo ajeno (otra nación, tierra libre o agua). */
    this.border = new Set();
    /** Ataques activos, por id de objetivo (0 = tierra libre). */
    this.attacks = new Map();
    this.boatCount = 0;

    this.maxTilesReached = 0;
    this.eliminatedTick = -1;
  }

  maxTroops() {
    return CONFIG.maxTroopsBase + this.tiles * CONFIG.maxTroopsPerTile;
  }

  /** Crecimiento por tick: rápido con pocas tropas, se frena al acercarse al máximo. */
  growthPerTick() {
    const max = this.maxTroops();
    if (this.troops >= max) return 0;
    const raw = CONFIG.growthBase + Math.pow(this.tiles, CONFIG.growthTileExp) * CONFIG.growthTileMult;
    return raw * (1 - this.troops / max);
  }

  troopsInAttacks() {
    let sum = 0;
    for (const atk of this.attacks.values()) sum += atk.troops;
    return sum;
  }
}
