// Estado de una nación (humana o bot).
import { CONFIG, RES } from './config.js';
import { emptyMods } from './tecnologias.js';
import { MECH, maxTroopsFor, regenPerTick, territoryGold } from './mecanicas.js';

/** Casillas actuales por cada casilla del documento (mundo de 2000×1000, RES 2). */
const DOC_AREA = (RES / 2) * (RES / 2);

export class Player {
  constructor(id, name, color, isHuman) {
    this.id = id;
    this.name = name;
    this.color = color; // [r, g, b]
    this.isHuman = isHuman;
    /** Colonia: bot débil que no es una nación (ni construye ni firma alianzas). Es el «bot» del documento de mecánicas. */
    this.weak = false;
    /** Multiplicadores del techo de tropas y de la regeneración (bots: 1/3 y ×0,5; naciones según la dificultad). */
    this.capMult = 1;
    this.regenMult = 1;
    /** Ritmo de regeneración del perfil de reglas (lo fija la partida al añadirlo). */
    this.paceRegen = 1;
    /** Economía de la partida: 'fixed' (oro pasivo fijo) o 'workers' (población = tropas + trabajadores). */
    this.economy = MECH.economyMode;
    // Reglas de la partida: multiplicadores de crecimiento de tropas y de oro
    this.troopMult = 1;
    this.goldMult = 1;
    /** doc-1.6: el territorio produce oro (regla `taxes`). */
    this.taxes = true;
    /** Resumen de vecinos de la IA guardado (ver Game.neighborSummary). */
    this._nbSummary = null;
    /** Última casilla que perdió (donde sale el botín al ser eliminado). */
    this.lastTile = -1;

    // Desarrollo: tecnologías y especialización
    this.techs = new Set();
    this.research = null; // { id, end, start }
    this.spec = '';
    this.mods = emptyMods();
    this.capitalTile = -1;
    /** Su capital (doc-1.6): edificio único con murallas y mejoras de industria y población. */
    this.capital = null;
    /** Lugares de interés (doc-1.6): bonos que duran unos segundos ({ kind, until }) y mejoras para siempre. */
    this.buffs = [];
    this.permMods = null;
    this.passes = 0; // pasos de montaña que controla
    this.helpAt = -Infinity; // última vez que pidió ayuda a sus aliados
    /** Oro ganado por fuente y gastado, acumulado (el panel calcula el ritmo). */
    // Oro ganado por fuente (TR04): base pasiva, bonos (puntos estratégicos,
    // tecnologías, especialización), trabajadores, comercio, conquistas, botín y regalos
    this.income = { base: 0, tax: 0, villages: 0, bonus: 0, workers: 0, trade: 0, fishing: 0, conquest: 0, loot: 0, gifts: 0 };
    this.spent = { buildings: 0, research: 0 };
    /** Total ingresado cada 10 s (último minuto), para el ritmo de oro y la victoria económica. */
    this.incomeHist = [];

    /** Tropas: la reserva militar disponible (sin las desplegadas en ataques). */
    this.troops = 0;
    /** Trabajadores (solo con la economía de trabajadores): producen oro extra. */
    this.workers = 0;
    /** Economía de trabajadores: fracción de la población como soldados (el resto, trabajadores). */
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
    this.buildings = { city: 0, village: 0, capital: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0, warship: 0, missile: 0 };
    /** Edificios terminados por tipo y suma de sus niveles (los que están en obras no cuentan). */
    this.active = { city: 0, village: 0, capital: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0 };
    this.levels = { city: 0, village: 0, capital: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0 };
    /** Para los precios: niveles que tiene de cada edificio, contando los que están en obras o mejorándose. */
    this.owned = { city: 0, village: 0, capital: 0, port: 0, fort: 0, factory: 0, silo: 0, sam: 0, warship: 0 };
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
    this.stats = { built: 0, kills: 0, landings: 0, alliances: 0, maxGold: 0, maxCities: 0, sunk: 0, missiles: 0, maxFactories: 0, points: 0, capitals: 0, pacts: 0 };

    // Diplomacia
    this.allies = new Set();
    this.traitorUntil = 0; // tick hasta el que figura como traidor
    this.betrayals = 0;
    this.lastEmojiTick = -Infinity;
    /** id → tick a partir del cual se le puede volver a proponer alianza. */
    this.requestCooldown = new Map();
  }

  /** Población: con la economía fija, las tropas; con trabajadores, tropas + trabajadores. */
  population() {
    return this.troops + this.workers;
  }

  /**
   * Techo de tropas (documento, 03.1): 2 × (casillas^0,6 × 1000 + 50 000) +
   * 250 000 por nivel de ciudad terminado; los bots, un tercio; las naciones,
   * según la dificultad. No añade tropas: solo fija el límite.
   */
  maxTroops() {
    return (maxTroopsFor(this.tiles, this.levels.city) + MECH.village.cap * (this.levels.village || 0)) * this.capMult * (1 + this.mods.cap);
  }

  /**
   * Tropas (o población, con trabajadores) que se generan este turno
   * (documento, 03.2): (10 + T^0,73 / 4) × (1 − T / techo), nunca negativo.
   * Lo más rápido hacia el 42 % del techo y 0 al llegar a él.
   */
  growthPerTick() {
    const P = this.economy === 'workers' ? this.troops + this.workers : this.troops;
    // × paceRegen: ritmo del perfil de reglas (ver PROFILES en mecanicas.js)
    return regenPerTick(P, this.maxTroops()) * this.paceRegen * this.regenMult * this.troopMult * Math.max(0.1, 1 + this.mods.growth);
  }

  /** Oro pasivo base por turno: humano 100, nación 100, bot (colonia) 50. */
  baseGold() {
    return this.isHuman ? MECH.baseGoldPerTickHuman : this.weak ? MECH.baseGoldPerTickBot : MECH.baseGoldPerTickNation;
  }

  /**
   * Oro pasivo por turno (documento, 04.1): fijo, no depende del territorio
   * ni de las tropas. Con la economía de trabajadores (07.2): +1 por cada 100.
   */
  goldPerTick() {
    const b = this.goldBreakdown();
    return b.base + b.tax + b.villages + b.workers + b.bonus;
  }

  /**
   * El oro pasivo de un turno por fuente (TR04): base (100, o 50 una colonia,
   * × reglas), trabajadores (+1 cada 100, × reglas) y bonos (el % extra de
   * puntos estratégicos, tecnologías y especialización sobre lo anterior).
   */
  goldBreakdown() {
    if (!this.tiles) return { base: 0, tax: 0, villages: 0, workers: 0, bonus: 0 };
    const base = this.baseGold() * this.goldMult;
    // doc-1.6: el territorio produce (impuestos) y los pueblos también
    const tax = this.taxes ? territoryGold(this.tiles, DOC_AREA) * (this.weak ? MECH.tax.colonyShare : 1) * this.goldMult : 0;
    const villages = MECH.village.gold * (this.levels.village || 0) * this.goldMult;
    const workers = this.economy === 'workers' ? Math.floor(this.workers / MECH.workersPerGold) * this.goldMult : 0;
    // Bonos (industria de la capital, puntos, tecnologías…) sobre todo lo anterior
    return { base, tax, villages, workers, bonus: (base + tax + villages + workers) * this.mods.gold };
  }

  maxBoats() {
    return CONFIG.maxBoats + this.mods.boats;
  }

  troopsInAttacks() {
    let sum = 0;
    for (const atk of this.attacks.values()) sum += atk.troops;
    return sum;
  }
}
