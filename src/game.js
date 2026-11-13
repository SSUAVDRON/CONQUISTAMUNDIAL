// Simulación de la partida. No toca el DOM: se puede ejecutar en Node (tests) o
// en el navegador. Es determinista: misma semilla + mismas acciones = misma partida.
import { AREA, BUILDINGS, CONFIG, EMOJIS, RES, STRUCTURE_KINDS, TICK_MS, cleanRules } from './config.js';
import { fmtTroops, formatNumber } from './format.js';
import { Rng } from './rng.js';
import { MinHeap } from './heap.js';
import { Player } from './player.js';
import { Attack } from './attack.js';
import { BotBrain, ColonyBrain } from './bot.js';
import { generateColonyNames, generateNames } from './names.js';
import { assignNationColors, botColor } from './colors.js';
import { POI, POI_TYPES, placePoints } from './estrategia.js';
import { LUGARES, LUGAR_CFG, pickLugar } from './lugares.js';
import { SPECS, TECHS, addMods, emptyMods, techAvailable } from './tecnologias.js';
import { bankShare, bigEmpireBonus, capitalPerks, capitalPrice, MECH, neutralTimeCost, priceFor, profileOf, pvpTile, regenPerTick, startOffsets, tradeGold, tradeSpawnChance } from './mecanicas.js';

/** Desplazamientos de la zona inicial: las 52 casillas del disco de radio 4 (documento, 02.2). */
const START_OFFSETS = startOffsets();

// Buffers de vecinos, uno por función para evitar reentradas
const NB_SET = new Int32Array(4);
const NB_BORDER = new Int32Array(4);
const NB_COUNT = new Int32Array(4);
const NB_SCAN = new Int32Array(4);
/** Casillas que puede explorar como mucho cada búsqueda por el mar. */
const SEARCH = {
  trade: 15000 * AREA, // el comercio es regional
  fish: 5000 * AREA, // los buques persiguen pesqueros cerca
  fishing: 1500 * AREA, // ruta de un pesquero a su caladero (está a menos de 20 casillas del documento)
  warship: 40000 * AREA,
  landing: 75000 * AREA, // alcance de un desembarco, como antes de subir la resolución
};

const NB_BFS = new Int32Array(4);
const NB_MISC = new Int32Array(4);

/**
 * Las cifras del documento en casillas se pensaron para el mundo de 2000×1000
 * (RES 2). Con más resolución, una misma superficie tiene más casillas:
 * DOC_AREA casillas actuales por cada casilla del documento, y DOC_LEN en
 * distancias.
 */
const DOC_LEN = RES / 2;
const DOC_AREA = DOC_LEN * DOC_LEN;
const ANNEX_MAX_TILES = Math.round(MECH.annexMaxTiles * DOC_AREA);
// Las colonias cercan bolsas más pequeñas (doc-1.9): no saltan cientos de casillas de golpe
const ANNEX_MAX_COLONY = Math.round(ANNEX_MAX_TILES * MECH.colonyAnnexShare);
const ANNEX_VISITS_PER_TICK = Math.round(MECH.annexVisitsPerTick * DOC_AREA);
// Casillas recorridas antes de probar la sonda del cerco (ver _annexProbe)
const ANNEX_PROBE_AT = MECH.annexProbeAt;
// Tope de casillas pendientes de repintar (solo dibujo, ver setOwner)
const DIRTY_MAX = 2_000_000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Tonos de las colonias: apagados (tierra, piedra, pizarra) y variados. */
const COLONY_TONES = [
  [150, 128, 104], [128, 132, 140], [146, 134, 116], [120, 128, 112], [150, 120, 120], [118, 116, 138],
  [104, 130, 128], [140, 142, 108], [164, 142, 118], [112, 104, 96], [134, 112, 134], [100, 116, 140],
];

export class Game {
  constructor({ map, seed = 1, rules = null }) {
    this.map = map;
    this.rules = cleanRules(rules);
    /** Perfil de reglas (ritmo, puntos estratégicos, tecnologías): src/mecanicas.js, PROFILES. */
    this.profile = profileOf(this.rules);
    this.seed = seed >>> 0;
    this.rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
    this.owner = new Uint16Array(map.size); // 0 = nadie
    this.players = [null]; // el índice coincide con el id; 0 está reservado
    this.bots = [];
    this.attacks = [];
    this.boats = [];
    this.warships = []; // { id, owner, tile, hp, path, pos, progress, fireTick, fireAt }
    this._nextWarshipId = 1;
    this.missiles = []; // { id, owner, from, to, dist, progress, targetId }
    this._nextMissileId = 1;
    /** Mercantes de los puertos: { id, owner, kind: 'trade', port, dest, tile, path, pos, progress, value (casillas de agua del viaje) } */
    this.merchants = [];
    this._nextMerchantId = 1;
    /** Efectos visuales recientes: explosiones e intercepciones (no afectan a la simulación). */
    this.effects = [];
    /** Edificios en obras (nuevos o mejorándose). */
    this.sites = [];
    /** Raíles fábrica→estación (ciudad o puerto) y los trenes que circulan por ellos. */
    this.rails = []; // { key, factory, station, len, nextTrain, train }
    this._railMap = new Map();
    this.trains = []; // { id, rail, pos, dir }
    this._nextTrainId = 1;
    this.buildings = []; // { id, kind, tile, owner }
    /** Capitales en pie (también están en `buildings`) y las que hay que trasladar al final del turno. */
    this.capitals = [];
    this._capitalMoves = [];
    /** Lugares de interés (doc-1.6): { id, kind, tile, x, y } y los que tienen que reaparecer (turnos). */
    this.lugares = [];
    this.lugarAt = new Map();
    this._lugarRespawns = [];
    this._nextLugarId = 1;
    /** Jugadores con algún bono temporal en marcha (para quitárselo a tiempo). */
    this._buffed = new Set();
    this.buildingAt = new Map(); // casilla → edificio
    this._nextBuildingId = 1;
    this.brains = new Map(); // id de jugador → BotBrain
    this.requests = []; // propuestas de alianza: { from, to, expires, decideAt }
    /** Ofertas de pacto de no agresión o de paz: { kind: 'pact'|'peace', from, to, tribute, expires, decideAt } */
    this.offers = [];
    /** Pactos en vigor (no agresión o paz): { a, b, until, kind } */
    this.pacts = [];
    /** Quién está cumpliendo el objetivo de victoria alternativo y desde cuándo. */
    this.goalHolder = null;
    this.emojis = []; // { from, to, emoji, tick }
    this.diploVersion = 0; // sube cada vez que cambia una alianza (el render repinta)
    this.winningAlliance = null;
    this.ticks = 0;
    this.phase = 'spawn'; // 'spawn' | 'playing' | 'ended'
    this.nationAvgTiles = 0; // casillas medias de las naciones (cada segundo; frena a las colonias)
    this.winner = null;
    // Por qué acabó: 'dominio', 'ultimo', 'alianza', 'capitales', 'economia', 'supervivencia' o 'tiempo'
    this.winReason = null;
    // Victorias de capitales y economía: quién cumple el objetivo y desde qué turno
    this.goalHolders = new Map();
    this._goalAnnounced = new Map();
    this.intents = [];

    // El renderizador activa esto para saber qué píxeles repintar
    this.trackDirty = false;
    this.dirty = [];
    /** Se pasó el tope de `dirty`: el dibujo debe repintarlo todo. */
    this.dirtyOverflow = false;
    /** Sube con cada casilla que cambia de dueño (invalida resúmenes guardados). */
    this.ownerVersion = 0;

    this.onEvent = null;
    this.eventLog = [];
    /** Diagnóstico (?diag=1, src/diagnostico.js): registro por turno y por evento; null = apagado. */
    this.trace = null;
    this._traceSeq = 0;

    /** Puntos estratégicos (capitales, industria, puertos clave, pasos): casilla → punto. */
    // (en el perfil Clásico no hay: ni bonos, ni capitales, ni botín de captura)
    this.points = this.profile.points ? placePoints(map, this.seed) : [];
    this.pointAt = new Map(this.points.map((pt) => [pt.tile, pt]));

    // Memoria reutilizable para búsquedas en anchura
    this._stampArr = new Uint32Array(map.size);
    this._stamp = 0;
    this._parent = new Int32Array(map.size);
    this._queue = new Int32Array(map.size);
    // Para A* por el mar
    this._closed = new Uint32Array(map.size);
    this._gcost = new Int32Array(map.size);
    this._pathHeap = new MinHeap(4096);
    /** Rutas marítimas ya calculadas (el terreno no cambia): from·size+to → camino. */
    this._pathCache = new Map();
    this._nextBoatId = 1;
    // Cerco: casillas ya vistas en este tick que no forman bolsa (tick en que se vio)
    this._annexFail = new Uint32Array(map.size);
    this._annexBudget = 0;
  }

  // ---------------------------------------------------------------- jugadores

  addPlayer(name, color, isHuman = false) {
    const id = this.players.length;
    if (id > 65000) throw new Error('Demasiados jugadores');
    const p = new Player(id, name, color, isHuman);
    p.troopMult = this.rules.troopMult;
    p.goldMult = this.rules.goldMult;
    p.taxes = this.rules.taxes; // doc-1.6: el territorio produce oro
    p.economy = this.rules.economy;
    p.paceRegen = this.profile.paceRegen;
    this.players.push(p);
    // El primer humano es el jugador local por defecto; en multijugador se fija aparte
    if (isHuman && !this.human) this.human = p;
    return p;
  }

  /**
   * `difficulty`: 'facil' | 'normal' | 'dificil'.
   * `countries` (mapas reales): [{ name, tile }] — los bots son esos países y
   * aparecen en su ubicación.
   */
  addBots(count, difficulty = 'normal', countries = null) {
    const existing = this.players.filter(Boolean).map((p) => p.name);
    // En los mapas reales, primero los países (con su bandera y su sitio);
    // si se piden más, el resto son naciones inventadas repartidas por el mapa
    const real = countries ? countries.slice(0, count) : [];
    const extra = generateNames(this.rng, Math.max(0, count - real.length), [...existing, ...real.map((c) => c.name)]);
    for (let i = 0; i < count; i++) {
      const c = real[i];
      const p = this.addPlayer(c ? c.name : extra[i - real.length], botColor(this.players.length, this.rng), false);
      if (c) {
        p.homeTile = c.tile;
        p.flag = c.iso || '';
      }
      // Naciones de la IA (documento, 03.1-03.2): techo y regeneración según la dificultad
      p.capMult = MECH.nationCapByDifficulty[difficulty] ?? MECH.nationCapByDifficulty.normal;
      p.regenMult = MECH.nationRegenByDifficulty[difficulty] ?? MECH.nationRegenByDifficulty.normal;
      const brain = new BotBrain(this, p, difficulty);
      this.bots.push(brain);
      this.brains.set(p.id, brain);
    }
  }

  /** Colonias: bots débiles con nombres como «Colonia de Valdeoro». */
  addColonies(count) {
    const existing = this.players.filter(Boolean).map((p) => p.name);
    const names = generateColonyNames(this.rng, count, existing);
    for (const name of names) {
      // Tonos apagados (tierra, piedra): se distinguen de las naciones. Doce,
      // para que dos colonias vecinas no salgan casi siempre iguales (la misma
      // tirada de `rng` que con seis: no cambia la partida)
      const base = this.rng.pick(COLONY_TONES);
      const v = this.rng.int(-14, 14);
      const p = this.addPlayer(name, base.map((c) => Math.max(0, Math.min(255, c + v))), false);
      p.weak = true;
      // Los «bots» del documento: un tercio del techo y la mitad de regeneración
      p.capMult = MECH.botCapShare;
      p.regenMult = MECH.botRegenMult;
      const brain = new ColonyBrain(this, p);
      this.bots.push(brain);
      this.brains.set(p.id, brain);
    }
  }

  alivePlayers() {
    return this.players.filter((p) => p && p.alive);
  }

  /** Arranca la fase de despliegue: los bots eligen ya su posición. */
  start() {
    this.ticks = 0;
    this.phase = 'spawn';
    for (const p of this.players) if (p) p.gold = this.rules.startGold;
    for (const bot of this.bots) {
      const p = bot.player;
      const home = p.homeTile;
      // Los países reales, cerca de donde están de verdad pero en un buen
      // sitio (tierra adentro, llano, con su zona inicial entera y algo de
      // espacio); si no hay ninguno así, el sitio libre más cercano
      if (home >= 0) {
        const good = this._goodSpawnNear(home, 10 * RES, 30 * AREA);
        const near = good >= 0 ? good : this._freeTileNear(home, 10 * RES, 30 * AREA);
        if (near >= 0 && this.spawnPlayer(p, near, 30 * AREA)) continue;
      }
      const t = this.findSpawnTile({ colony: !!p.weak });
      if (t >= 0) this.spawnPlayer(p, t);
    }
    this._colorNations();
    this._emit('Elige dónde empezar haciendo clic en el mapa', 'info');
  }

  /**
   * Ya en su sitio, cada nación de la IA toma el color que más se distingue
   * de sus vecinas y de los jugadores (antes iban por orden de llegada y dos
   * vecinas podían salir casi iguales). Solo es dibujo: no gasta `rng` ni
   * cambia la simulación, y sale igual en todos los navegadores.
   */
  _colorNations() {
    const map = this.map;
    const nations = [];
    for (const b of this.bots) {
      const p = b.player;
      if (p.weak || p.spawnTile < 0) continue;
      nations.push({ id: p.id, x: map.x(p.spawnTile), y: map.y(p.spawnTile) });
    }
    if (!nations.length) return;
    const fixed = this.players.filter((p) => p && p.isHuman).map((p) => p.color);
    // Vecinas: a menos de unas 2,5 veces la separación media entre naciones
    const radius = 2.5 * Math.sqrt(map.landCount / nations.length);
    const colors = assignNationColors(nations, fixed, radius);
    for (const [id, c] of colors) this.players[id].color = c;
  }

  /** Casillas de la zona inicial (52) que caben en `t`: tierra libre de la misma masa. */
  startFits(t) {
    return this._startZone(t).length;
  }

  /**
   * Casillas de la zona inicial en `t`: tierra libre de la misma masa y unida
   * a `t` por tierra dentro de la zona (un río la corta: no se empieza en las
   * dos orillas).
   */
  _startZone(t) {
    const map = this.map;
    const cx = map.x(t);
    const cy = map.y(t);
    const body = map.landBody[t];
    const cand = (this._zoneSet ??= new Set());
    cand.clear();
    for (const [dx, dy] of START_OFFSETS) {
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) continue;
      const i = map.index(x, y);
      if (map.isLand(i) && this.owner[i] === 0 && map.landBody[i] === body) cand.add(i);
    }
    if (!cand.has(t)) return [];
    const out = [t];
    cand.delete(t);
    const nb = (this._zoneNb ??= new Int32Array(4));
    for (let q = 0; q < out.length; q++) {
      const c = map.neighbors(out[q], nb);
      for (let k = 0; k < c; k++) {
        if (!cand.has(nb[k])) continue;
        cand.delete(nb[k]);
        out.push(nb[k]);
      }
    }
    return out;
  }

  /**
   * El mejor sitio para empezar a menos de `radius` casillas de `anchor` (el
   * punto real de un país): con la zona inicial entera, tierra adentro, en
   * terreno llano y separado de las naciones ya colocadas; alejarse del punto
   * real penaliza un poco. -1 si no hay ninguno con la zona entera.
   */
  _goodSpawnNear(anchor, radius, minBody) {
    const map = this.map;
    const ax = map.x(anchor);
    const ay = map.y(anchor);
    const full = START_OFFSETS.length;
    const others = [];
    for (const p of this.players) if (p && p.spawned && !p.weak) others.push(p.spawnTile);
    const room = 12 * RES; // separación cómoda con otra nación
    const look = 2 * RES; // a esta distancia se mira si hay agua cerca
    const plain = MECH.terrain[1].tileCost;
    let best = -1;
    let bestScore = Infinity;
    for (let dy = -radius; dy <= radius; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const x = ax + dx;
        const y = ay + dy;
        if (!map.inBounds(x, y)) continue;
        const t = map.index(x, y);
        if (!map.isLand(t) || this.owner[t] !== 0 || map.landBodySizes[map.landBody[t]] < minBody) continue;
        if (this.startFits(t) < full) continue;
        // Terreno medio de la zona (llanura 0; montaña ~1)
        let cost = 0;
        for (const [ox, oy] of START_OFFSETS) cost += MECH.terrain[map.terrain[map.index(x + ox, y + oy)]].tileCost;
        let score = Math.sqrt(d2) / radius + (cost / full / plain - 1) * 2;
        // Agua cerca (costa): ocho direcciones a `look` casillas
        let wet = 0;
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const xx = x + ux * look;
          const yy = y + uy * look;
          if (!map.inBounds(xx, yy) || !map.isLand(map.index(xx, yy))) wet++;
        }
        score += wet * 0.12;
        // Demasiado cerca de otra nación
        for (const s of others) {
          const ex = map.x(s) - x;
          const ey = map.y(s) - y;
          const e = Math.sqrt(ex * ex + ey * ey);
          if (e < room) score += (1 - e / room) * 1.5;
        }
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    return best;
  }

  /**
   * Busca una casilla libre lejos del resto. `colony`: para una colonia, que
   * puede quedar más cerca de las naciones (con 90 países reales, sus zonas
   * tapaban casi toda África). En los mapas reales se reparte por superficie
   * de verdad (`map.rowWeight`: el mapa estira el norte) y se prefiere un sitio
   * con la zona inicial entera.
   */
  findSpawnTile({ colony = false } = {}) {
    const map = this.map;
    const spawns = [];
    for (const p of this.players) if (p && p.spawned) spawns.push(p.spawnTile, p.weak ? 1 : 0);
    let minDist = Math.sqrt(map.landCount / Math.max(1, this.players.length - 1)) * 0.9;
    const rows = map.rowWeight || null;
    const full = START_OFFSETS.length;
    for (let attempt = 0; attempt < 3000; attempt++) {
      if (attempt % 250 === 249) minDist *= 0.8;
      const t = map.landTiles[this.rng.int(0, map.landTiles.length - 1)];
      if (this.owner[t] !== 0) continue;
      if (map.landBodySizes[map.landBody[t]] < CONFIG.minSpawnBodySize) continue;
      const tx = map.x(t);
      const ty = map.y(t);
      if (rows && this.rng.float() > rows[ty]) continue;
      if (attempt < 1500 && this.startFits(t) < full) continue;
      const nationDist = colony ? Math.min(minDist, 8 * RES) : minDist;
      let ok = true;
      for (let k = 0; k < spawns.length; k += 2) {
        const s = spawns[k];
        const lim = spawns[k + 1] ? minDist : nationDist;
        const dx = map.x(s) - tx;
        const dy = map.y(s) - ty;
        if (dx * dx + dy * dy < lim * lim) {
          ok = false;
          break;
        }
      }
      if (ok) return t;
    }
    return -1;
  }

  /** Casilla de tierra libre más cercana a `tile` (en espiral, hasta `radius`). */
  _freeTileNear(tile, radius, minBody) {
    const map = this.map;
    const cx = map.x(tile);
    const cy = map.y(tile);
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!map.inBounds(x, y)) continue;
          const t = map.index(x, y);
          if (map.isLand(t) && this.owner[t] === 0 && map.landBodySizes[map.landBody[t]] >= minBody) return t;
        }
      }
    }
    return -1;
  }

  /** Coloca (o recoloca, durante el despliegue) a un jugador en `tile`. */
  /** ¿Puede `p` empezar en `tile`? Devuelve el motivo si no (para explicárselo). */
  spawnCheck(p, tile, minBody = CONFIG.minSpawnBodySize) {
    const map = this.map;
    if (this.phase !== 'spawn' || !p.alive) return { ok: false, reason: 'El despliegue ya ha terminado' };
    if (tile < 0 || tile >= map.size) return { ok: false, reason: 'Fuera del mapa' };
    if (!map.isLand(tile)) return { ok: false, reason: 'No puedes empezar en el agua' };
    if (this.owner[tile] !== 0) return { ok: false, reason: 'Esa tierra ya tiene dueño' };
    if (map.landBodySizes[map.landBody[tile]] < minBody) return { ok: false, reason: 'Esa isla es demasiado pequeña para empezar' };
    return { ok: true, reason: '' };
  }

  spawnPlayer(p, tile, minBody = CONFIG.minSpawnBodySize) {
    const map = this.map;
    if (!this.spawnCheck(p, tile, minBody).ok) return false;
    if (p.spawned) this._releaseAll(p);

    // Zona inicial (documento, 02.2): el disco lógico de radio 4 desplazado
    // (−0,5, −0,5) → 52 casillas. Si toca mar, un río, otra masa de tierra o
    // casillas ya ocupadas, se recorta (nunca se solapan propietarios)
    for (const i of this._startZone(tile)) this.setOwner(i, p.id);
    p.spawned = true;
    p.spawnTile = tile;
    // Tropas iniciales: humano 25 000, bot 10 000 (naciones, como un humano)
    const start = p.isHuman ? MECH.initialHumanTroops : p.weak ? MECH.initialBotTroops : MECH.initialNationTroops;
    if (p.economy === 'workers') {
      p.workers = Math.round(start * (1 - p.soldierShare));
      p.troops = start - p.workers;
    } else {
      p.troops = start;
      p.workers = 0;
    }
    return true;
  }

  /**
   * Regeneración del turno (documento, 03.2 y 07.2). Economía fija: las
   * tropas crecen con su fórmula (acumulador decimal, sin redondear). Con
   * trabajadores: crece la población P y se reparte al momento según el
   * deslizador (sin crear ni destruir población: lo que se pierde en combate
   * sale de los soldados, y los trabajadores no atacan ni defienden).
   */
  _growPopulation(p) {
    const g = p.growthPerTick();
    if (p.economy !== 'workers') {
      p.troops += g;
      return;
    }
    const P = Math.max(0, p.troops + p.workers + g);
    p.workers = Math.round(P * (1 - p.soldierShare));
    p.troops = P - p.workers;
  }

  // ------------------------------------------------- desarrollo y órdenes

  /** Recalcula los modificadores de `p`: tecnologías, especialización, postura y puntos. */
  _refreshMods(p) {
    if (!p) return;
    const m = emptyMods();
    for (const id of p.techs) addMods(m, TECHS[id].mods);
    if (p.spec && SPECS[p.spec]) addMods(m, SPECS[p.spec].mods);
    let industry = 0;
    let ports = 0;
    let capitals = 0;
    let passes = 0;
    for (const pt of this.points) {
      if (this.owner[pt.tile] !== p.id) continue;
      if (pt.kind === 'industria') industry++;
      else if (pt.kind === 'puerto') ports++;
      else if (pt.kind === 'capital') capitals++;
      else if (pt.kind === 'paso') passes++;
    }
    // Rendimiento decreciente: el quinto núcleo industrial rinde menos que el primero
    m.gold += (POI.industryGold * industry) / (1 + 0.15 * industry);
    m.boats += ports;
    m.trade += POI.portTrade * ports;
    m.gold += POI.capitalGold * capitals;
    m.growth += POI.capitalGrowth * capitals;
    if (p.capitalTile >= 0 && this.owner[p.capitalTile] !== p.id) m.growth += POI.capitalLostGrowth;
    // Lugares de interés: mejoras para siempre y bonos que aún duran (doc-1.6)
    if (p.permMods) addMods(m, p.permMods);
    for (const b of p.buffs) if (b.until > this.ticks) addMods(m, LUGARES[b.kind].buff);
    // Mejoras de la capital (doc-1.7: una sola, que sube el oro; el banco va
    // aparte) y los premios de sus niveles (doc-1.8)
    const cap = p.capital;
    if (cap && this.buildingAt.get(cap.tile) === cap) {
      const pk = capitalPerks(cap.up);
      m.gold += MECH.capital.gold * cap.up + pk.gold;
      m.growth += pk.growth;
      m.cap += pk.cap;
      m.boats += pk.boats;
      m.trade += pk.trade;
    }
    p.passes = passes;
    p.mods = m;
  }

  /** Una casilla con punto estratégico cambia de dueño. */
  _pointChanged(pt, oldId, newId) {
    const op = oldId ? this.players[oldId] : null;
    const np = newId ? this.players[newId] : null;
    // Para logros y retos: puntos y capitales tomados durante la partida
    if (np && this.phase === 'playing') {
      np.stats.points++;
      if (pt.kind === 'capital' && pt.nation && newId !== pt.nation) np.stats.capitals++;
    }
    // Al conquistar la capital de otro: botín extra
    if (pt.kind === 'capital' && np && pt.nation && newId !== pt.nation) {
      const bounty = POI.capitalBounty * np.goldMult;
      np.gold += bounty;
      np.income.loot += bounty;
    }
    this._refreshMods(op);
    this._refreshMods(np);
    // Su antigua dueña (si no es la que la pierde ahora) también nota que vuelve o no
    if (pt.kind === 'capital' && pt.nation && pt.nation !== oldId && pt.nation !== newId) this._refreshMods(this.players[pt.nation]);
    if (this.phase !== 'playing') return;
    const h = this.human;
    if (!h) return;
    const what = pt.name;
    if (np === h) {
      const extra = pt.kind === 'capital' && pt.nation !== h.id ? ` (+${formatNumber(POI.capitalBounty * h.goldMult)} de oro)` : '';
      this._emit(`⭐ Has tomado ${what}${extra}`, 'good', { sfx: pt.kind === 'capital' ? 'conquerColony' : 'capture', point: pt.id });
    } else if (op === h) {
      this._emit(`Has perdido ${what} a manos de ${np ? np.name : 'nadie'}`, 'danger', { point: pt.id });
    }
  }

  /** Al empezar: cada nación (no las colonias) tiene su capital donde se desplegó. */
  _placeCapitals() {
    if (!this.profile.points) return; // Clásico: sin capitales
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || p.weak || p.spawnTile < 0) continue;
      let t = p.spawnTile;
      if (this.pointAt.has(t)) continue;
      p.capitalTile = t;
      const pt = { id: this.points.length + 1, kind: 'capital', tile: t, x: this.map.x(t), y: this.map.y(t), name: `Capital de ${p.name}`, nation: p.id };
      this.points.push(pt);
      this.pointAt.set(t, pt);
    }
    for (let i = 1; i < this.players.length; i++) this._refreshMods(this.players[i]);
  }

  // ------------------------------------------------------------- capital

  /**
   * Al empezar la partida, cada nación (también los jugadores; no las
   * colonias) funda su capital donde se desplegó (doc-1.6).
   */
  _foundCapitals() {
    if (!this.rules.capitals) return;
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || p.weak || p.spawnTile < 0 || p.capital) continue;
      if (this.buildingAt.has(p.spawnTile)) continue;
      this._newCapital(p, p.spawnTile, 0);
    }
  }

  /** `up`: nivel de la mejora (0-10); `bank`: tropas guardadas; `ammo`/`readyAt`: su escudo antimisiles. */
  _newCapital(p, tile, up) {
    const b = { id: this._nextBuildingId++, kind: 'capital', tile, owner: p.id, level: 1, target: 0, up, bank: 0, work: null, ammo: null, readyAt: 0 };
    this.buildings.push(b);
    this.buildingAt.set(tile, b);
    this.capitals.push(b);
    p.capital = b;
    this._recount(p);
    this._refreshMods(p);
    return b;
  }

  /** Radios de las murallas y de las afueras de una capital (los premios de nivel los amplían). */
  capitalRadii(cap) {
    const pk = capitalPerks(cap ? cap.up || 0 : 0);
    return { wall: CONFIG.capitalWallRadius + pk.wall * RES, outer: CONFIG.capitalOuterRadius + pk.outer * RES };
  }

  /** Zona de la capital de `p` en la casilla `t`: 2 = dentro de las murallas, 1 = afueras, 0 = fuera. */
  capitalZone(p, t) {
    const cap = p && p.capital;
    if (!cap) return 0;
    const map = this.map;
    const dx = map.x(cap.tile) - map.x(t);
    const dy = map.y(cap.tile) - map.y(t);
    const d2 = dx * dx + dy * dy;
    const { wall: R, outer: O } = this.capitalRadii(cap);
    if (d2 <= R * R) return 2;
    return d2 <= O * O ? 1 : 0;
  }

  /** Lo que el banco suma a las murallas: ×(1 + 0,6 × banco / techo), hasta un banco de 3 techos (doc-1.8). */
  bankDefense(p) {
    const cap = p && p.capital;
    if (!cap) return 1;
    const C = MECH.capital;
    return 1 + C.bankDefense * Math.min(C.bankDefenseMax, (cap.bank || 0) / Math.max(1, p.maxTroops()));
  }

  /**
   * Defensa de la capital de `p` en la casilla `t` (1 = fuera): murallas
   * ×6 (+0,4 por nivel) × lo que suma el banco (cuantas más tropas
   * guardadas, más) y afueras ×2,5 (+0,1 por nivel) (doc-1.7 y doc-1.8).
   */
  wallMultiplier(p, t) {
    const zone = this.capitalZone(p, t);
    if (!zone) return 1;
    return zone === 1 ? this.outerDefense(p) : this.wallDefense(p);
  }

  /** Defensa dentro de las murallas de la capital de `p`. */
  wallDefense(p) {
    const cap = p && p.capital;
    if (!cap) return 1;
    const C = MECH.capital;
    return (C.wallMult + C.wallMultPerLevel * cap.up) * capitalPerks(cap.up).wallX * this.bankDefense(p);
  }

  /** Defensa en las afueras de la capital de `p`. */
  outerDefense(p) {
    const cap = p && p.capital;
    if (!cap) return 1;
    return MECH.capital.outerMult + MECH.capital.outerMultPerLevel * cap.up;
  }

  /** Precio en oro del siguiente nivel de la capital. */
  capitalCost(p) {
    const lvl = p.capital ? p.capital.up || 0 : 0;
    return Math.round(capitalPrice(lvl) * this.rules.priceMult);
  }

  /** Tropas que cuesta el siguiente nivel de la capital: (6 % + 3 % × nivel) del techo (doc-1.8). */
  capitalTroopCost(p) {
    const lvl = p.capital ? p.capital.up || 0 : 0;
    const C = MECH.capital;
    return Math.round(p.maxTroops() * (C.troopBase + C.troopPerLevel * lvl));
  }

  _canUpgradeCapital(p) {
    const b = p.capital;
    if (!b || this.buildingAt.get(b.tile) !== b) return { ok: false, reason: 'No tienes capital' };
    if (b.work) return { ok: false, reason: 'Tu capital ya tiene una obra en marcha' };
    if ((b.up || 0) >= MECH.capital.maxLevel) return { ok: false, reason: 'Tu capital ya está al máximo' };
    const cost = this.capitalCost(p);
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: la mejora cuesta ${formatNumber(cost)}` };
    const troops = this.capitalTroopCost(p);
    if (p.troops < troops) return { ok: false, reason: `Te faltan tropas: la mejora pide ${fmtTroops(troops)} soldados` };
    return { ok: true, reason: '', cost, troops, capital: b };
  }

  _startCapitalWork(p) {
    const b = p.capital;
    const cost = this.capitalCost(p);
    const troops = this.capitalTroopCost(p);
    p.gold -= cost;
    p.troops = Math.max(0, p.troops - troops);
    p.spent.buildings += cost;
    p.stats.built++;
    const C = MECH.capital;
    const time = Math.max(1, Math.round((C.buildTicks + C.buildTicksPerLevel * (b.up || 0)) * (1 - p.mods.buildSpeed)));
    b.work = { track: 'up', end: this.ticks + time, time };
    if (p === this.human) this._emit(`🏰 Obras en la capital: nivel ${(b.up || 0) + 1} (${Math.round(time / 10)} s; ${formatNumber(cost)} de oro y ${fmtTroops(troops)} tropas)`, 'info');
    return true;
  }

  _finishCapitalWork(b) {
    b.work = null;
    b.up = (b.up || 0) + 1;
    const p = this.players[b.owner];
    if (!p) return;
    this._refreshMods(p);
    p.stats.finished = (p.stats.finished || 0) + 1;
    p.stats.lastFinished = 'city';
    if (p === this.human) {
      const C = MECH.capital;
      const perk = C.perks.find((x) => x.level === b.up);
      this._emit(`🏰 Capital a nivel ${b.up}: +${Math.round(C.gold * b.up * 100)} % de oro pasivo y banco para ${fmtTroops(this.bankCap(p))}${perk ? ` · Premio: ${perk.text}` : ''}`, 'good', perk ? { sfx: 'logro' } : null);
    }
  }

  // ------------------------------------------------- banco de tropas (doc-1.7)

  /** Tropas que caben en el banco de la capital de `p`. */
  bankCap(p) {
    const cap = p && p.capital;
    if (!cap) return 0;
    return p.maxTroops() * bankShare(cap.up || 0);
  }

  /** Guarda en la capital la parte `ratio` de sus soldados (lo que quepa). Devuelve cuántos. */
  bankDeposit(p, ratio = 1) {
    const cap = p.capital;
    if (!cap || this.buildingAt.get(cap.tile) !== cap) return 0;
    const room = Math.max(0, this.bankCap(p) - cap.bank);
    const amount = Math.min(room, Math.floor(p.troops * clamp(ratio, 0, 1)));
    if (amount < 1) {
      if (room < 1) this._notify(p, 'El banco de la capital está lleno: mejórala para que quepan más', 'warn');
      return 0;
    }
    p.troops -= amount;
    cap.bank += amount;
    return amount;
  }

  /** Saca del banco la parte `ratio` de lo guardado (vuelven a sus soldados). Devuelve cuántos. */
  bankWithdraw(p, ratio = 1) {
    const cap = p.capital;
    if (!cap) return 0;
    const amount = Math.floor(cap.bank * clamp(ratio, 0, 1));
    if (amount < 1) return 0;
    cap.bank -= amount;
    p.troops += amount;
    return amount;
  }

  /** Con sus tropas al tope, la capital sigue reclutando hacia el banco (a la mitad del ritmo máximo). */
  _bankRecruit(p) {
    const cap = p.capital;
    if (!cap || cap.owner !== p.id) return;
    const C = MECH.capital;
    const max = p.maxTroops();
    const P = p.economy === 'workers' ? p.troops + p.workers : p.troops;
    if (P < max * C.bankFull) return;
    const room = this.bankCap(p) - cap.bank;
    if (room <= 0) return;
    const peak = regenPerTick(max * 0.42, max) * p.paceRegen * p.regenMult * p.troopMult * Math.max(0.1, 1 + p.mods.growth);
    cap.bank += Math.min(room, peak * C.bankRecruit);
  }

  /** Obra en marcha de la capital, de 0 a 1 (o null). */
  capitalProgress(b) {
    if (!b || !b.work) return null;
    return Math.max(0, Math.min(1, 1 - (b.work.end - this.ticks) / Math.max(1, b.work.time)));
  }

  /**
   * La casilla de una capital cambia de dueño: la capital cae. Quien la toma
   * se lleva botín (una parte del oro del dueño y una recompensa); la nación
   * que la pierde la refunda al final del turno con la mitad de sus mejoras.
   */
  _capitalFalls(b, oldId, newId) {
    this.buildings = this.buildings.filter((x) => x !== b);
    this.buildingAt.delete(b.tile);
    this.capitals = this.capitals.filter((x) => x !== b);
    const victim = oldId ? this.players[oldId] : null;
    const winner = newId ? this.players[newId] : null;
    if (victim && victim.capital === b) victim.capital = null;
    if (victim) {
      this._recount(victim);
      this._refreshMods(victim);
      this._capitalMoves.push({ id: victim.id, from: b.tile, up: b.up || 0 });
    }
    const map = this.map;
    this.effects.push({ kind: 'capitalFall', x: map.x(b.tile) + 0.5, y: map.y(b.tile) + 0.5, owner: newId, tick: this.ticks });
    if (!winner || !victim) return;
    const share = Math.floor(victim.gold * MECH.capital.lootShare);
    victim.gold -= share;
    const loot = share + Math.round(MECH.capital.lootBase * winner.goldMult);
    winner.gold += loot;
    winner.income.loot += loot;
    // Y la mitad de las tropas de su banco (el resto se pierde)
    const troops = Math.floor((b.bank || 0) * MECH.capital.bankLoot);
    winner.troops += troops;
    b.bank = 0;
    winner.stats.capitals = (winner.stats.capitals || 0) + 1;
    const extra = troops >= 1 ? ` y ${fmtTroops(troops)} tropas de su banco` : '';
    if (winner === this.human) this._emit(`🏰 Has tomado la capital de ${victim.name}: +${formatNumber(loot)} de oro${extra}`, 'good', { sfx: 'conquerColony' });
    else if (victim === this.human) this._emit(`🏰 ${winner.name} ha tomado tu capital y se lleva ${formatNumber(share)} de oro${extra}: la corte se traslada`, 'danger', { sfx: 'fall' });
  }

  /** Refunda las capitales caídas (al final del turno, con la mitad de sus mejoras). */
  _relocateCapitals() {
    const moves = this._capitalMoves;
    this._capitalMoves = [];
    const C = MECH.capital;
    for (const mv of moves) {
      const p = this.players[mv.id];
      if (!p || !p.alive || p.tiles <= 0 || p.capital) continue;
      const t = this._capitalSite(p, mv.from);
      if (t < 0) continue;
      // Si hay un edificio propio allí (su mejor ciudad), la capital lo absorbe
      const old = this.buildingAt.get(t);
      if (old) {
        this.buildings = this.buildings.filter((x) => x !== old);
        this.buildingAt.delete(t);
      }
      const b = this._newCapital(p, t, Math.floor(mv.up * C.keepShare));
      if (p === this.human) this._emit(`🏰 Nueva capital a nivel ${b.up} (la mitad de las mejoras) y con el banco vacío`, 'info', { tile: t });
    }
  }

  /**
   * Dónde refundar la capital: su ciudad de más nivel (o su pueblo); si no
   * tiene, la casilla propia libre más cercana al centro de su territorio.
   */
  _capitalSite(p, from) {
    let best = null;
    for (const b of this.buildings) {
      if (b.owner !== p.id || (b.kind !== 'city' && b.kind !== 'village') || !b.level) continue;
      const score = (b.kind === 'city' ? 100 : 0) + b.level;
      if (!best || score > best.score || (score === best.score && b.id < best.b.id)) best = { b, score };
    }
    if (best) return best.b.tile;
    const map = this.map;
    const owner = this.owner;
    const W = map.width;
    const H = map.height;
    // Centro de su territorio (muestreado: una casilla de cada 4 × 4)
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < H; y += 4) {
      for (let x = 0; x < W; x += 4) {
        if (owner[y * W + x] !== p.id) continue;
        sx += x;
        sy += y;
        n++;
      }
    }
    const cx = n ? Math.round(sx / n) : map.x(from);
    const cy = n ? Math.round(sy / n) : map.y(from);
    // La casilla propia libre más cercana a ese centro, en anillos que crecen
    // (antes, dos pasadas por el mapa entero: un tirón al caer cada capital)
    const ok = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const t = y * W + x;
      return owner[t] === p.id && !this.buildingNear(t, CONFIG.capitalClearance);
    };
    // Como mucho 60 casillas alrededor del centro; si no (territorio muy
    // repartido), la casilla de su frontera más cercana a él
    for (let r = 0; r <= 60; r++) {
      for (let dx = -r; dx <= r; dx++) {
        if (ok(cx + dx, cy - r)) return (cy - r) * W + cx + dx;
        if (ok(cx + dx, cy + r)) return (cy + r) * W + cx + dx;
      }
      for (let dy = -r + 1; dy < r; dy++) {
        if (ok(cx - r, cy + dy)) return (cy + dy) * W + cx - r;
        if (ok(cx + r, cy + dy)) return (cy + dy) * W + cx + r;
      }
    }
    // (de la más cercana a la más lejana; mirar los edificios solo de esas)
    const cand = [];
    for (const t of p.border) {
      const dx = map.x(t) - cx;
      const dy = map.y(t) - cy;
      cand.push([dx * dx + dy * dy, t]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, t] of cand) if (!this.buildingNear(t, CONFIG.capitalClearance)) return t;
    return cand.length ? cand[0][1] : -1;
  }

  // ------------------------------------------------- lugares de interés

  /** Al empezar: unos cuantos lugares repartidos por la tierra libre. */
  _placeLugares() {
    const C = LUGAR_CFG;
    const n = Math.max(C.min, Math.min(C.max, Math.round(this.map.landCount / C.landPer)));
    for (let i = 0; i < n; i++) this._spawnLugar();
  }

  /**
   * Un lugar nuevo en tierra libre, lejos de las salidas y de los demás
   * lugares (con el azar de la partida). Si no queda sitio, nada.
   */
  _spawnLugar() {
    const map = this.map;
    const C = LUGAR_CFG;
    const sep = C.spacing * RES;
    const land = map.landTiles;
    // Primero en tierra libre; si ya casi no queda, dentro de algún país
    // (lo gana quien se la quite a su dueño: un objetivo por el que pelear)
    for (let k = 0; k < 60; k++) {
      const t = land[this.rng.int(0, land.length - 1)];
      if ((k < 40 && this.owner[t]) || this.buildingAt.has(t) || this.pointAt.has(t) || this.wallMultiplier(this.players[this.owner[t]], t) > 1) continue;
      const x = map.x(t);
      const y = map.y(t);
      const near = (tt) => {
        const dx = map.x(tt) - x;
        const dy = map.y(tt) - y;
        return dx * dx + dy * dy < sep * sep;
      };
      if (this.lugares.some((l) => near(l.tile))) continue;
      if (this.players.some((p) => p && p.alive && p.spawnTile >= 0 && near(p.spawnTile))) continue;
      const kind = pickLugar(this.rng);
      const lg = { id: this._nextLugarId++, kind, tile: t, x, y, born: this.ticks };
      this.lugares.push(lg);
      this.lugarAt.set(t, lg);
      return lg;
    }
    return null;
  }

  /** Apunta que tiene que aparecer un lugar en el turno `at` (lista ordenada). */
  _queueLugar(at) {
    let i = this._lugarRespawns.length;
    while (i > 0 && this._lugarRespawns[i - 1] > at) i--;
    this._lugarRespawns.splice(i, 0, at);
  }

  /** Alguien conquista la casilla de un lugar: se lleva el premio (las colonias no). */
  _claimLugar(lg, newId) {
    const p = this.players[newId];
    if (!p || p.weak) return;
    this.lugares = this.lugares.filter((l) => l !== lg);
    this.lugarAt.delete(lg.tile);
    // Otro aparecerá dentro de un rato (lista ordenada por turno)
    this._queueLugar(this.ticks + this.rng.int(LUGAR_CFG.respawnMin, LUGAR_CFG.respawnMax));
    const def = LUGARES[lg.kind];
    let detail = def.desc;
    if (def.instant === 'gold') {
      const gold = Math.round(LUGAR_CFG.goldBase * p.goldMult + LUGAR_CFG.goldIncomeTicks * p.goldPerTick());
      p.gold += gold;
      p.income.conquest += gold;
      detail = `+${formatNumber(gold)} de oro`;
    } else if (def.instant === 'troops') {
      const before = p.troops;
      p.troops = Math.min(Math.max(p.troops, p.maxTroops()), p.troops * (1 + LUGAR_CFG.troopShare));
      detail = `+${fmtTroops(p.troops - before)} tropas`;
    } else if (def.buff) {
      p.buffs.push({ kind: lg.kind, until: this.ticks + def.ticks });
      this._buffed.add(p.id);
      this._refreshMods(p);
    } else if (def.perm) {
      p.permMods ??= {};
      for (const [k, v] of Object.entries(def.perm)) p.permMods[k] = (p.permMods[k] || 0) + v;
      this._refreshMods(p);
    }
    p.stats.lugares = (p.stats.lugares || 0) + 1;
    this.effects.push({ kind: 'lugar', x: lg.x + 0.5, y: lg.y + 0.5, lugar: lg.kind, owner: p.id, tick: this.ticks });
    if (p === this.human) this._emit(`${def.icon} ${def.name}: ${detail}`, 'good', { sfx: 'logro' });
  }

  /** Quita los bonos temporales que han caducado. */
  _expireBuffs() {
    for (const id of this._buffed) {
      const p = this.players[id];
      if (!p) {
        this._buffed.delete(id);
        continue;
      }
      if (!p.buffs.some((b) => b.until <= this.ticks)) continue;
      p.buffs = p.buffs.filter((b) => b.until > this.ticks);
      if (!p.buffs.length) this._buffed.delete(id);
      this._refreshMods(p);
    }
  }

  /** Lugar de interés a menos de `r` casillas de `t` (el más cercano), o null. */
  lugarNear(t, r = 3 * RES) {
    const map = this.map;
    const x = map.x(t);
    const y = map.y(t);
    let best = null;
    let bd = r * r;
    for (const l of this.lugares) {
      const d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d <= bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  /** Precio de la próxima tecnología de `p` (cada una encarece la siguiente). */
  techCost(p) {
    return Math.round(CONFIG.techBase * CONFIG.techGrowth ** p.techs.size * this.rules.priceMult);
  }

  techTime(p) {
    return CONFIG.techTicks + CONFIG.techTicksPer * p.techs.size;
  }

  startResearch(p, id) {
    if (!this.profile.techs) return false; // perfil sin tecnologías (Clásico)
    const check = techAvailable(p, id);
    if (!check.ok) {
      this._notify(p, check.reason, 'warn');
      return false;
    }
    const cost = this.techCost(p);
    if (p.gold < cost) {
      this._notify(p, `Te faltan ${formatNumber(cost - p.gold)} de oro`, 'warn');
      return false;
    }
    p.gold -= cost;
    p.spent.research += cost;
    p.research = { id, start: this.ticks, end: this.ticks + this.techTime(p) };
    if (p === this.human) this._emit(`🔬 Investigando ${TECHS[id].name} (${Math.round(this.techTime(p) / 10)} s)`, 'info', { feedback: true });
    return true;
  }

  _finishResearch(p) {
    const id = p.research.id;
    p.research = null;
    p.techs.add(id);
    this._refreshMods(p);
    if (p === this.human) this._emit(`🔬 ${TECHS[id].name} investigada: ${TECHS[id].desc}`, 'good', { sfx: 'built' });
  }

  /** Especialización económica: la primera es gratis; cambiarla cuesta oro. */
  setSpec(p, id) {
    if (!this.profile.techs || !SPECS[id] || p.spec === id) return false;
    if (p.spec) {
      const cost = Math.round(CONFIG.specChangeCost * this.rules.priceMult);
      if (p.gold < cost) {
        this._notify(p, `Cambiar de especialización cuesta ${formatNumber(cost)} de oro`, 'warn');
        return false;
      }
      p.gold -= cost;
      p.spent.research += cost;
    }
    p.spec = id;
    this._refreshMods(p);
    if (p === this.human) this._emit(`Especialización: ${SPECS[id].name}`, 'good', { feedback: true });
    return true;
  }

  /** Cambia el reparto entre soldados y trabajadores (de minSoldierShare a 1). */
  setSoldierShare(p, share) {
    if (!Number.isFinite(share)) return;
    p.soldierShare = Math.round(Math.min(1, Math.max(CONFIG.minSoldierShare, share)) * 100) / 100;
  }

  _releaseAll(p) {
    const owner = this.owner;
    for (let i = 0; i < owner.length; i++) if (owner[i] === p.id) this.setOwner(i, 0);
  }

  // -------------------------------------------------------------- propiedad

  /**
   * Cambia el dueño de una casilla y mantiene coherentes: recuento de casillas,
   * fronteras, píxeles a repintar y frentes de los ataques activos.
   */
  setOwner(t, newId) {
    const owner = this.owner;
    const oldId = owner[t];
    if (oldId === newId) return;
    const map = this.map;
    owner[t] = newId;
    this.ownerVersion++;
    if (oldId) {
      // Conquistar casillas no da oro (documento, 04.1): solo eliminar a un rival entero
      const op = this.players[oldId];
      op.tiles--;
      if (op.tiles === 0) op.lastTile = t;
      op.border.delete(t);
      if (newId) op.lastConqueredBy = newId;
    }
    let np = null;
    if (newId) {
      np = this.players[newId];
      np.tiles++;
      if (np.tiles > np.maxTilesReached) np.maxTilesReached = np.tiles;
    }
    const building = this.buildingAt.get(t);
    if (building) this._transferBuilding(building, oldId, newId);
    const point = this.pointAt.get(t);
    if (point) this._pointChanged(point, oldId, newId);
    if (newId && this.lugarAt.size) {
      const lg = this.lugarAt.get(t);
      if (lg) this._claimLugar(lg, newId);
    }
    // Casillas para repintar (solo dibujo). Con tope: con la pestaña oculta
    // nadie las recoge (sala multijugador en segundo plano) y crecían sin fin;
    // pasado el tope, el dibujo lo repinta todo al volver
    const track = this.trackDirty && (this.dirty.length < DIRTY_MAX || ((this.dirtyOverflow = true), false));
    if (track) this.dirty.push(t);
    this._updateBorder(t);

    const nb = NB_SET;
    const c = map.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      // Solo puede cambiar la frontera de las vecinas del antiguo o del nuevo
      // dueño (para un tercero, `t` era y sigue siendo ajena)
      const on = owner[n];
      if (on && (on === oldId || on === newId)) this._updateBorder(n);
      if (track) this.dirty.push(n);
    }

    // Las casillas vecinas pueden entrar en el frente de algún ataque del nuevo dueño
    if (np && np.attacks.size) {
      const terrain = map.terrain;
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (terrain[n] === 0) continue;
        const o = owner[n];
        if (o === newId) continue;
        const atk = np.attacks.get(o);
        if (atk && !atk.done) this._addCandidate(atk, n);
      }
    }
  }

  _updateBorder(t) {
    const o = this.owner[t];
    if (!o) return;
    const p = this.players[o];
    const nb = NB_BORDER;
    const c = this.map.neighbors(t, nb);
    let border = c < 4;
    for (let k = 0; k < c && !border; k++) if (this.owner[nb[k]] !== o) border = true;
    if (border) p.border.add(t);
    else p.border.delete(t);
  }

  _countOwnedNeighbors(t, id) {
    const nb = NB_COUNT;
    const c = this.map.neighbors(t, nb);
    let n = 0;
    for (let k = 0; k < c; k++) if (this.owner[nb[k]] === id) n++;
    return n;
  }

  /** ¿Comparte `p` frontera terrestre con `targetId` (opcionalmente en una masa de tierra)? */
  hasLandBorder(p, targetId, body = -1) {
    const map = this.map;
    const nb = NB_SCAN;
    for (const t of p.border) {
      if (body >= 0 && map.landBody[t] !== body) continue;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (map.terrain[n] !== 0 && this.owner[n] === targetId) return true;
      }
    }
    return false;
  }

  /**
   * Resumen de vecinos para la IA: casillas de tierra libre y por nación.
   * Se guarda mientras no cambie ninguna casilla (varios bots preguntan por el
   * mismo líder en el mismo turno); el resultado es idéntico al de recalcularlo.
   */
  neighborSummary(p, maxAge = 0) {
    const v = this.ownerVersion;
    const hit = p._nbSummary;
    // `maxAge` (los bots): vale un resumen de hace unos turnos. Con decenas de
    // naciones en guerra el dueño de alguna casilla cambia en cada turno y la
    // caché estricta casi nunca servía (era una séptima parte de la simulación)
    if (hit && ((hit.version === v && hit.tick === this.ticks) || (maxAge > 0 && this.ticks - hit.tick <= maxAge))) return hit.value;
    const value = this._neighborSummary(p);
    p._nbSummary = { version: v, tick: this.ticks, value };
    return value;
  }

  /**
   * Lo mismo para la interfaz, con su propia caché: lo que mira la pantalla
   * (en momentos distintos en cada navegador) no debe cambiar lo que deciden
   * los bots, o una partida en línea se desincronizaría.
   */
  neighborSummaryView(p) {
    const v = this.ownerVersion;
    const hit = p._nbView;
    if (hit && hit.version === v && hit.tick === this.ticks) return hit.value;
    const value = this._neighborSummary(p);
    p._nbView = { version: v, tick: this.ticks, value };
    return value;
  }

  /** ¿Toca `p` alguna casilla de tierra libre? (sale en cuanto encuentra una) */
  hasWildNeighbor(p) {
    const map = this.map;
    const nb = NB_SCAN;
    for (const t of p.border) {
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (map.terrain[n] !== 0 && this.owner[n] === 0) return true;
      }
    }
    return false;
  }

  _neighborSummary(p) {
    const map = this.map;
    const nb = NB_SCAN;
    const counts = new Map();
    let wild = 0;
    let coastal = false;
    for (const t of p.border) {
      if (map.coastal[t]) coastal = true;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (map.terrain[n] === 0) continue;
        const o = this.owner[n];
        if (o === p.id) continue;
        if (o === 0) wild++;
        else counts.set(o, (counts.get(o) || 0) + 1);
      }
    }
    return { wild, counts, coastal };
  }

  // ---------------------------------------------------------------- acciones

  /** Las acciones de los jugadores se encolan y se aplican al inicio del tick. */
  queueIntent(intent) {
    this.intents.push(intent);
  }

  _applyIntents() {
    const intents = this.intents;
    this.intents = [];
    for (const it of intents) {
      const p = this.players[it.playerId];
      if (!p || !p.alive) continue;
      // Cooperativo: marca en el mapa lo que ordena cada jugador de la nación
      if (it.by !== undefined && (it.type === 'action' || it.type === 'build') && it.tile >= 0 && it.tile < this.map.size) {
        this.effects.push({ kind: 'order', x: this.map.x(it.tile) + 0.5, y: this.map.y(it.tile) + 0.5, by: it.by, owner: p.id, what: it.type === 'build' ? it.kind : 'action', tick: this.ticks });
      }
      if (it.type === 'action') {
        if (this.phase === 'spawn') {
          const check = this.spawnCheck(p, it.tile);
          if (!check.ok || !this.spawnPlayer(p, it.tile)) this._notify(p, `No puedes empezar ahí: ${check.reason || 'prueba en otro sitio'}`, 'warn');
        } else if (this.phase === 'playing') {
          this._handleAttackIntent(p, it.tile, it.ratio);
        }
      } else if (it.type === 'share') {
        this.setSoldierShare(p, it.share);
      } else if (it.type === 'bank') {
        // Banco de tropas de la capital (doc-1.7): guardar o sacar
        if (this.phase !== 'playing') continue;
        if (it.op === 'out') this.bankWithdraw(p, it.ratio ?? 1);
        else this.bankDeposit(p, it.ratio ?? 1);
      } else if (it.type === 'build') {
        if (this.phase !== 'playing') continue;
        const tile = this.snapBuildTile(p, it.kind, it.tile);
        const check = this.canBuild(p, it.kind, tile);
        if (check.ok) this.build(p, it.kind, tile);
        else this._notify(p, check.reason, 'warn');
      } else if (it.type === 'cancelAttack') {
        const atk = p.attacks.get(it.targetId);
        if (atk) this.retreat(atk);
      } else if (this.phase !== 'playing') {
        // Durante el despliegue no se investiga, ni se especializa, ni hay diplomacia
        if (it.type !== 'emoji') this._notify(p, 'Espera a que empiece la partida', 'warn');
        continue;
      } else if (it.type === 'research') {
        this.startResearch(p, it.tech);
      } else if (it.type === 'spec') {
        this.setSpec(p, it.spec);
      } else if (it.type === 'proposePact') {
        if (it.on === false) this.breakPact(p, this.players[it.targetId]);
        else this.makeOffer(p, this.players[it.targetId], 'pact');
      } else if (it.type === 'offerPeace') {
        this.makeOffer(p, this.players[it.targetId], 'peace', it.tribute);
      } else if (it.type === 'respondPact' || it.type === 'respondPeace') {
        this.respondOffer(p, this.players[it.fromId], it.type === 'respondPact' ? 'pact' : 'peace', !!it.accept);
      } else if (it.type === 'askHelp') {
        this.askHelp(p);
      } else if (it.type === 'proposeAlliance') {
        this.proposeAlliance(p, this.players[it.targetId]);
      } else if (it.type === 'respondAlliance') {
        this.respondAlliance(p, this.players[it.fromId], it.accept);
      } else if (it.type === 'breakAlliance') {
        this.breakAlliance(p, this.players[it.targetId]);
      } else if (it.type === 'donate') {
        this.donate(p, this.players[it.targetId], it.resource, it.ratio);
      } else if (it.type === 'emoji') {
        this.sendEmoji(p, it.targetId, it.emoji);
      }
    }
  }

  _handleAttackIntent(p, tile, ratio) {
    const map = this.map;
    if (tile < 0 || tile >= map.size || !map.isLand(tile)) return;
    const targetId = this.owner[tile];
    if (targetId === p.id) return;
    if (this.isAllied(p.id, targetId)) {
      this._notify(p, `${this.players[targetId].name} es tu aliado. Rompe la alianza si quieres atacarle`, 'warn');
      return;
    }
    const troops = Math.floor(p.troops * clamp(ratio, 0, 1));
    if (troops < 1) {
      this._notify(p, 'No tienes tropas suficientes', 'warn');
      return;
    }
    if (this.hasLandBorder(p, targetId, map.landBody[tile])) {
      this.launchAttack(p, targetId, troops, { focus: tile });
    } else {
      this.launchBoat(p, tile, troops);
    }
  }

  /**
   * Lanza (o refuerza) un ataque terrestre. Si el objetivo nos está atacando a
   * la vez, las tropas de ambos ataques se anulan primero.
   */
  launchAttack(p, targetId, troops, { deduct = true, focus = -1 } = {}) {
    if (!p.alive || targetId === p.id) return false;
    const target = targetId ? this.players[targetId] : null;
    if (target && (!target.alive || this.isAllied(p.id, targetId))) return false;
    if (this._truceBlocks(p, target)) return false;
    if (deduct) troops = Math.min(troops, Math.floor(p.troops));
    if (troops < 1) return false;

    let atk = p.attacks.get(targetId);
    if (atk && !atk.done && focus >= 0 && focus !== atk.focus) this._refocus(atk, focus);
    // Reforzar un ataque que se estaba retirando lo devuelve al frente
    if (atk && !atk.done) atk.retreatAt = 0;
    if (!atk || atk.done) {
      atk = new Attack(p, targetId, 0);
      atk.annexPhase = (this._attackSeq = (this._attackSeq || 0) + 1) % MECH.annexEvery;
      this._aim(atk, focus);
      this._initFrontier(atk);
      if (atk.inFrontier.size === 0) return false;
      p.attacks.set(targetId, atk);
      this.attacks.push(atk);
      if (target && target === this.human) this._emit(`⚔ ${p.name} te ataca con ${fmtTroops(troops)} tropas`, 'danger', { sfx: 'war' });
      else if (p === this.human && target) this._emit(`⚔ Atacas a ${target.name} con ${fmtTroops(troops)} tropas`, 'info');
    }
    if (deduct) p.troops -= troops;

    if (target) {
      const opp = target.attacks.get(p.id);
      if (opp && !opp.done) {
        const c = Math.min(opp.troops, troops);
        opp.troops -= c;
        troops -= c;
      }
    }
    atk.troops += troops;
    if (this.trace && this.trace.wants(p)) {
      if (!atk.traceId) atk.traceId = ++this._traceSeq;
      this.trace.push({ t: 'envio', tick: this.ticks, jugador: p.id, idFrente: atk.traceId, objetivo: targetId, enviadas: troops, restantes: atk.troops });
    }
    return true;
  }

  _initFrontier(atk) {
    const map = this.map;
    const nb = NB_SCAN;
    const tid = atk.targetId;
    for (const t of atk.attacker.border) {
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (map.terrain[n] !== 0 && this.owner[n] === tid) this._addCandidate(atk, n);
      }
    }
  }

  /**
   * Apunta el ataque hacia `tile` (el clic): guarda el centro de la frontera
   * del atacante (el origen del crecimiento) y la dirección hacia el clic.
   * Sin clic (bots), en todas direcciones.
   */
  _aim(atk, tile) {
    atk.focus = tile;
    const map = this.map;
    const W = map.width;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const t of atk.attacker.border) {
      sx += t % W;
      sy += (t / W) | 0;
      n++;
    }
    if (!n) {
      atk.focus = -1;
      return;
    }
    atk.cx = sx / n;
    atk.cy = sy / n;
    if (tile < 0) return;
    const vx = (tile % W) - atk.cx;
    const vy = ((tile / W) | 0) - atk.cy;
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len < 1) {
      atk.focus = -1; // clic encima: en todas direcciones
      return;
    }
    atk.dx = vx / len;
    atk.dy = vy / len;
  }

  /** Un nuevo clic sobre el mismo objetivo: el frente se reordena hacia ese punto. */
  _refocus(atk, tile) {
    this._aim(atk, tile);
    const old = [...atk.inFrontier];
    atk.inFrontier.clear();
    atk.heap = new MinHeap();
    for (const t of old) this._addCandidate(atk, t);
  }

  _addCandidate(atk, t) {
    if (atk.inFrontier.has(t)) return;
    atk.inFrontier.add(t);
    const map = this.map;
    const n = this._countOwnedNeighbors(t, atk.attacker.id);
    // Una casilla ya casi rodeada (3 o 4 vecinas propias) va la primera: así no
    // quedan casillas sueltas sin conquistar dentro o en el borde del país
    if (n >= 3) {
      atk.heap.push(-1e9 + atk.step, t);
      return;
    }
    const x = t % map.width;
    const y = (t / map.width) | 0;
    // Terreno más caro (documento: coste 16,5 / 20 / 25), algo más tarde
    const terr = (MECH.terrain[map.terrain[t]].tileCost / MECH.terrain[1].tileCost - 1) * CONFIG.growTerrain;
    let key;
    if (!atk.targetId && atk.cx !== undefined) {
      // Tierra libre: en orden de distancia al centro del país (crece parejo
      // por todos lados) con un poco de azar para que el borde no sea una
      // regla. La distancia mezcla la normal y la «de casillas» (la mayor de
      // las dos): sale un cuadrado de esquinas redondeadas, no un círculo.
      // Hacia un clic, ese lado avanza antes.
      const vx = x - atk.cx;
      const vy = y - atk.cy;
      const round = Math.sqrt(vx * vx + vy * vy);
      const d = round + (Math.max(Math.abs(vx), Math.abs(vy)) - round) * CONFIG.growSquare;
      let stretch = 1;
      if (atk.focus >= 0 && round > 0) stretch = 1 + (1 - (vx * atk.dx + vy * atk.dy) / round) * CONFIG.growFocusStretch;
      // Las colonias, cada una con su forma (más o menos irregular)
      key = d * stretch + this.rng.float() * (atk.attacker.growNoise ?? CONFIG.growRandom) + terr - n * CONFIG.growSmooth;
    } else {
      // Contra otro país: el frente entero avanza a la vez (por turnos de
      // llegada), casi sin azar; hacia el clic, ese lado algo antes
      let focus = 0;
      if (atk.focus >= 0) {
        const vx = x - atk.cx;
        const vy = y - atk.cy;
        const len = Math.sqrt(vx * vx + vy * vy);
        const cos = len > 0 ? (vx * atk.dx + vy * atk.dy) / len : 1;
        focus = (1 - cos) * CONFIG.growFocus * 0.6;
      }
      key = atk.step + (this.rng.float() * CONFIG.growRandom + terr) * CONFIG.growPlayerMult - n * CONFIG.growSmooth + focus;
    }
    atk.heap.push(key, t);
  }

  /** Centro aproximado del frente de un ataque (casillas, con decimales). */
  attackFront(atk) {
    const W = this.map.width;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const t of atk.inFrontier) {
      sx += t % W;
      sy += (t / W) | 0;
      if (++n >= 48) break;
    }
    if (n) return [sx / n + 0.5, sy / n + 0.5];
    const t = atk.attacker.spawnTile;
    return [(t % W) + 0.5, Math.floor(t / W) + 0.5];
  }

  /**
   * Efectos de defensa de una casilla del defensor (multiplican el tiempo y
   * las bajas del atacante): puestos defensivos, pasos de montaña y mejoras.
   */
  defenseMult(target, t) {
    return this.fortMultiplier(target, t) * this.passMultiplier(target, t) * Math.max(0.2, 1 + target.mods.defense);
  }

  /**
   * Fuerza con la que defiende un país. Milicia: con trabajadores, una parte
   * de ellos (militia) también defiende; con oro fijo (sin trabajadores), un
   * +60 % de militia sobre sus tropas (+15 % con Milicia).
   */
  defenders(target) {
    const m = target.mods.militia;
    if (!m) return target.troops;
    return target.economy === 'workers' ? target.troops + target.workers * m : target.troops * (1 + 0.6 * m);
  }

  /**
   * Lo que cuesta conquistar la casilla `t` (documento, sección 05) con un
   * ataque de `troops` tropas y un frente de `front` casillas:
   * - tierra sin dueño: tiempo clamp(2000 × coste / tropas, 5, 100) y bajas
   *   magnitud / 5 (16, 20 o 24 según el terreno);
   * - otro país: fracción de tick speedCost × coste × multiplicadores / frente,
   *   bajas del atacante magnitud × … y del defensor sus tropas / casillas.
   * `time` se descuenta del presupuesto del ataque.
   */
  /** Ritmo de una colonia que ya es mayor que el 80 % de la nación media: (80 % media / casillas)², mínimo 0,15. */
  _colonyBrake(p) {
    const ref = this.nationAvgTiles * MECH.colonyBrakeAt;
    if (!ref || p.tiles <= ref) return 1;
    const r = ref / p.tiles;
    return Math.max(MECH.colonyBrakeMin, r * r);
  }

  conquestCost(t, target, troops, front, attacker = null) {
    const T = MECH.terrain[this.map.terrain[t]];
    const speed = Math.max(0.2, 1 + (attacker ? attacker.mods.attackSpeed : 0));
    const lossMul = Math.max(0.3, 1 + (attacker ? attacker.mods.attackCost : 0));
    if (!target) {
      // Las colonias ocupan tierra libre más rápido y con menos bajas
      // Las colonias, a su ritmo propio y sin depender de cuántas tropas mandan
      // (como una nación con un envío normal, × su ritmo de 0,8 a 1,3)
      // (doc-1.9) y frenan al pasar del 80 % de la nación media, para que no
      // encabecen la clasificación
      const colony = attacker && attacker.weak;
      const time = colony
        ? neutralTimeCost(T.tileCost, Math.max(troops, MECH.colonyRefTroops)) / speed / MECH.colonyNeutralSpeed / (attacker.pace || 1) / this._colonyBrake(attacker)
        : neutralTimeCost(T.tileCost, troops) / speed;
      return { time, loss: (T.mag / MECH.neutralLossDiv) * lossMul * (colony ? MECH.colonyNeutralLoss : 1), defLoss: 0 };
    }
    const mult = this.defenseMult(target, t);
    const c = pvpTile(this.defenders(target), troops, target.tiles, front, {
      traitor: this.isTraitor(target),
      bigAttacker: bigEmpireBonus(attacker, this),
      bigDefender: bigEmpireBonus(target, this),
    });
    return { time: (c.perFront * T.tileCost * mult) / speed, loss: T.mag * c.attackerLossPerMag * mult * lossMul, defLoss: c.defenderLoss };
  }

  /** Multiplicador defensivo si `t` está en el radio de una fortaleza del defensor. */
  fortMultiplier(defender, t) {
    // Murallas de la capital (doc-1.6)
    let best = this.wallMultiplier(defender, t);
    if (!defender.forts.size) return best;
    const map = this.map;
    const x = map.x(t);
    const y = map.y(t);
    for (const f of defender.forts) {
      const lvl = this.buildingAt.get(f)?.level || 1;
      const r = this.fortRadius(lvl) * (1 + defender.mods.fortRadius);
      const dx = map.x(f) - x;
      const dy = map.y(f) - y;
      if (dx * dx + dy * dy <= r * r) best = Math.max(best, CONFIG.fortDefenseMult + CONFIG.fortMultPerLevel * (lvl - 1));
    }
    return best;
  }

  /** Punto estratégico a menos de `r` casillas de `t` (el más cercano), o null. */
  pointNear(t, r = 3 * RES) {
    const map = this.map;
    const x = map.x(t);
    const y = map.y(t);
    let best = null;
    let bd = r * r;
    for (const pt of this.points) {
      const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (d <= bd) {
        bd = d;
        best = pt;
      }
    }
    return best;
  }

  /**
   * Estimación (aproximada) de un ataque de `p` con `troops` contra `targetId`:
   * casillas que puede ganar (en llanura, con las bajas del documento) y
   * riesgo. No cuenta puestos defensivos ni pasos (por eso se avisa de que es
   * incierta si los tiene).
   */
  estimateAttack(p, targetId, troops) {
    const target = targetId ? this.players[targetId] : null;
    const lossMul = Math.max(0.3, 1 + p.mods.attackCost);
    const plain = MECH.terrain[1];
    let perTile;
    if (!target) perTile = (plain.mag / MECH.neutralLossDiv) * lossMul * (p.weak ? MECH.colonyNeutralLoss : 1);
    else {
      const c = pvpTile(this.defenders(target), troops, target.tiles, 1, { traitor: this.isTraitor(target) });
      perTile = plain.mag * c.attackerLossPerMag * Math.max(0.2, 1 + target.mods.defense) * lossMul;
    }
    let tiles = Math.floor(troops / Math.max(0.01, perTile));
    if (target) tiles = Math.min(tiles, target.tiles);
    const ratio = target ? troops / Math.max(1, target.troops) : Infinity;
    const risk = !target || ratio > 1.5 ? 'bajo' : ratio > 0.7 ? 'medio' : 'alto';
    return { tiles, risk, uncertain: !!(target && (target.forts.size || target.passes)) };
  }

  /** Pasos de montaña de `defender`: cuesta más conquistar a su alrededor. */
  passMultiplier(defender, t) {
    if (!defender.passes) return 1;
    const map = this.map;
    const x = map.x(t);
    const y = map.y(t);
    const R = POI.passRadius;
    for (const pt of this.points) {
      if (pt.kind !== 'paso' || this.owner[pt.tile] !== defender.id) continue;
      const dx = pt.x - x;
      const dy = pt.y - y;
      if (dx * dx + dy * dy <= R * R) return POI.passDefense;
    }
    return 1;
  }

  /** Radio de una fortaleza de nivel `lvl`. */
  fortRadius(lvl = 1) {
    return CONFIG.fortRadius + CONFIG.fortRadiusPerLevel * (lvl - 1);
  }

  /** Alcance de los raíles de una fábrica de nivel `lvl`. */
  railRange(lvl = 1) {
    return CONFIG.railRange + CONFIG.railRangePerLevel * (lvl - 1);
  }

  /**
   * Red de vías: cada fábrica terminada se une con las ciudades, puertos y
   * otras fábricas terminados a su alcance en la misma masa de tierra, sean de
   * quien sean (también enemigos), como mucho CONFIG.railMaxPerFactory, las
   * más cercanas. Las vías van en ángulo recto (un tramo en horizontal y otro
   * en vertical, por donde cruzan menos agua) y el alcance se mide en ese
   * recorrido. Las vías que siguen existiendo conservan su tren.
   */
  _updateRailNetwork() {
    const map = this.map;
    const keep = new Map();
    const list = [];
    for (const f of this.buildings) {
      if (f.kind !== 'factory' || !f.level) continue;
      const R = this.railRange(f.level) * (1 + (this.players[f.owner]?.mods.railRange || 0));
      const fx = map.x(f.tile);
      const fy = map.y(f.tile);
      const body = map.landBody[f.tile];
      const cands = [];
      for (const s of this.buildings) {
        if (s === f || (s.kind !== 'city' && s.kind !== 'port' && s.kind !== 'factory') || !s.level || map.landBody[s.tile] !== body) continue;
        const d = Math.abs(map.x(s.tile) - fx) + Math.abs(map.y(s.tile) - fy);
        if (d <= R) cands.push([d, s]);
      }
      cands.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
      let made = 0;
      for (let k = 0; k < cands.length && made < CONFIG.railMaxPerFactory; k++) {
        const [d, s] = cands[k];
        // Entre dos fábricas, una sola vía (la clave no depende del orden)
        const key = s.kind === 'factory' ? `${Math.min(f.id, s.id)}:${Math.max(f.id, s.id)}` : `${f.id}:${s.id}`;
        if (keep.has(key)) {
          made++;
          continue;
        }
        let r = this._railMap.get(key);
        if (!r) {
          const corner = this._railCorner(f.tile, s.tile);
          if (!corner) continue; // demasiada agua en medio
          r = {
            key,
            factory: f,
            station: s,
            cx: corner[0],
            cy: corner[1],
            len: Math.max(1, d),
            nextTrain: this.ticks + this.rng.int(CONFIG.trainEveryMin, CONFIG.trainEveryMax),
            train: null,
          };
        }
        keep.set(key, r);
        list.push(r);
        made++;
      }
    }
    if (this.trains.length) this.trains = this.trains.filter((t) => keep.has(t.rail.key));
    this._railMap = keep;
    this.rails = list;
  }

  /**
   * Esquina de una vía en ángulo recto de `a` a `b`: primero en horizontal
   * ([xb, ya]) o primero en vertical ([xa, yb]), la que cruce menos agua.
   * null si las dos cruzan más de CONFIG.railMaxWater casillas de agua.
   */
  _railCorner(a, b) {
    const map = this.map;
    const W = map.width;
    const t = map.terrain;
    const xa = map.x(a);
    const ya = map.y(a);
    const xb = map.x(b);
    const yb = map.y(b);
    const wetRow = (y, x0, x1) => {
      let n = 0;
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (t[y * W + x] === 0) n++;
      return n;
    };
    const wetCol = (x, y0, y1) => {
      let n = 0;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (t[y * W + x] === 0) n++;
      return n;
    };
    const h = wetRow(ya, xa, xb) + wetCol(xb, ya, yb);
    const v = wetCol(xa, ya, yb) + wetRow(yb, xa, xb);
    if (Math.min(h, v) > CONFIG.railMaxWater) return null;
    return h <= v ? [xb, ya] : [xa, yb];
  }

  /** Punto de la vía `r` a `pos` casillas de la fábrica: [x, y, ángulo] (centros de casilla). */
  railPoint(r, pos) {
    const map = this.map;
    const fx = map.x(r.factory.tile);
    const fy = map.y(r.factory.tile);
    const sx = map.x(r.station.tile);
    const sy = map.y(r.station.tile);
    const first = Math.abs(r.cx - fx) + Math.abs(r.cy - fy);
    if (pos <= first) {
      const k = first ? pos / first : 0;
      return [fx + (r.cx - fx) * k + 0.5, fy + (r.cy - fy) * k + 0.5, Math.atan2(r.cy - fy, r.cx - fx)];
    }
    const second = Math.abs(sx - r.cx) + Math.abs(sy - r.cy);
    const k = second ? Math.min(1, (pos - first) / second) : 1;
    return [r.cx + (sx - r.cx) * k + 0.5, r.cy + (sy - r.cy) * k + 0.5, Math.atan2(sy - r.cy, sx - r.cx)];
  }

  /** Salen trenes, avanzan y pagan al llegar a cada extremo (ida a la estación y vuelta). */
  _updateTrains() {
    if (this.ticks % CONFIG.railRefresh === 0) this._updateRailNetwork();
    for (const r of this.rails) {
      if (r.train || this.ticks < r.nextTrain) continue;
      r.train = { id: this._nextTrainId++, rail: r, pos: 0, dir: 1 };
      this.trains.push(r.train);
    }
    if (!this.trains.length) return;
    let done = false;
    for (const t of this.trains) {
      const r = t.rail;
      t.pos += CONFIG.trainSpeed * t.dir;
      if (t.dir > 0 && t.pos >= r.len) {
        t.pos = r.len;
        t.dir = -1;
        this._trainArrive(r, r.station);
      } else if (t.dir < 0 && t.pos <= 0) {
        t.pos = 0;
        t.done = true;
        done = true;
        r.train = null;
        r.nextTrain = this.ticks + this.rng.int(CONFIG.trainEveryMin, CONFIG.trainEveryMax);
        this._trainArrive(r, r.factory);
      }
    }
    if (done) this.trains = this.trains.filter((t) => !t.done);
  }

  /** Oro de un tren que llega a `at`: para el dueño de la fábrica y una parte para el de la estación. */
  _trainArrive(r, at) {
    const f = r.factory;
    const s = r.station;
    // Si alguno de los dos edificios ya no existe, el raíl caerá en el próximo recálculo
    if (this.buildingAt.get(f.tile) !== f || this.buildingAt.get(s.tile) !== s) return;
    // Documento (04.4): oro al llegar a cada estación según la relación entre
    // el dueño del tren y el de la estación (propia 10k, neutral 10k, aliada
    // 35k, enemiga 0)
    const owner = this.players[f.owner];
    if (!owner || !owner.alive) return;
    const stationOwner = this.players[at.owner];
    const rel = at.owner === f.owner ? 'self' : this.isAllied(f.owner, at.owner) ? 'ally' : stationOwner && this.atWar(owner, stationOwner) ? 'enemy' : 'neutral';
    const value = MECH.trainRewards[rel];
    if (!value) return;
    // Comercio (tecnología, puertos clave, infraestructura) y, al ser el tren
    // de una fábrica, también la especialización Industria
    const earned = value * owner.goldMult * (1 + owner.mods.trade + owner.mods.factoryBonus);
    owner.gold += earned;
    owner.income.trade += earned;
    owner.stats.trainGold = (owner.stats.trainGold || 0) + earned;
    const map = this.map;
    this.effects.push({ kind: 'train', x: map.x(at.tile) + 0.5, y: map.y(at.tile) + 0.5, gold: earned, owner: f.owner, other: s.owner, tick: this.ticks });
  }

  /** Radio de intercepción de unos antimisiles de nivel `lvl`. */
  /** Interceptores por salva de una batería (o del escudo de una capital). */
  samShots(b) {
    if (b.kind === 'capital') return CONFIG.capitalSamShots + capitalPerks(b.up || 0).shield;
    return CONFIG.samShots + CONFIG.samShotsPerLevel * (b.level - 1);
  }

  /** Probabilidad de derribar un misil con cada disparo. */
  samHitChance(b, owner) {
    const base = b.kind === 'capital' ? CONFIG.capitalSamHit : CONFIG.samHitChance + CONFIG.samHitPerLevel * (b.level - 1);
    return Math.min(CONFIG.samHitMax, base + (owner?.mods.samHit || 0));
  }

  samRange(lvl = 1) {
    return CONFIG.samRange + CONFIG.samRangePerLevel * (lvl - 1);
  }

  /**
   * Un tick de un ataque (documento, 05). El presupuesto del tick es 2 ×
   * longitud del frente contra tierra libre y 1 tick contra otro país; cada
   * casilla del frente (en el orden del montículo) se conquista si el
   * presupuesto acumulado alcanza su coste de tiempo, pagando sus bajas.
   */
  _processAttack(atk) {
    if (atk.done) return;
    const A = atk.attacker;
    const tid = atk.targetId;
    const target = tid ? this.players[tid] : null;
    // Retirada: las tropas no avanzan y vuelven a los 20 ticks
    if (atk.retreatAt) {
      if (this.ticks >= atk.retreatAt || !A.alive) this._endAttack(atk, this.retreatOutcome(atk).ratio);
      return;
    }
    if (!A.alive || (target && !target.alive) || atk.troops < 1 || atk.inFrontier.size === 0) {
      this._endAttack(atk);
      return;
    }
    atk.step++;
    const front = atk.inFrontier.size;
    const traced = this.trace && atk.traceId ? { troops: atk.troops, tiles: A.tiles } : null;
    // Ritmo del perfil de reglas: × paceNeutral / × pacePvp (ver PROFILES)
    atk.budget += target ? this.profile.pacePvp : MECH.neutralBudgetPerFront * front * this.profile.paceNeutral;

    const owner = this.owner;
    const aid = A.id;
    const heap = atk.heap;
    while (heap.size > 0) {
      const t = heap.peek();
      if (owner[t] !== tid || this._countOwnedNeighbors(t, aid) === 0) {
        heap.pop();
        atk.inFrontier.delete(t);
        continue;
      }
      const c = this.conquestCost(t, target, atk.troops, front, A);
      if (atk.budget < c.time) break;
      if (atk.troops < c.loss) {
        // La ofensiva se agota contra esta casilla
        atk.troops = 0;
        break;
      }
      heap.pop();
      atk.inFrontier.delete(t);
      atk.budget -= c.time;
      atk.troops -= c.loss;
      if (target) target.troops = Math.max(0, target.troops - c.defLoss);
      this.setOwner(t, aid);
      atk.annexQ.push(t);
    }
    // Cercos: cada MECH.annexEvery turnos (en su turno) o al acabar el ataque
    if ((this.ticks + atk.annexPhase) % MECH.annexEvery === 0) this._flushAnnex(atk);
    if (traced) {
      this.trace.push({ t: 'frente', tick: this.ticks, jugador: aid, idFrente: atk.traceId, objetivo: tid, ancho: front, presupuesto: atk.budget, ganadas: A.tiles - traced.tiles, bajas: traced.troops - atk.troops, restantes: atk.troops });
    }
    if (atk.inFrontier.size === 0 || atk.troops < 1) this._endAttack(atk);
  }

  /**
   * Lo que devuelve una retirada si se completara ahora (documento, 05.3): a
   * los retreatTicks turnos vuelven las tropas que siguen en el frente; contra
   * un país vivo se pierde retreatPenalty, contra tierra libre (o un rival ya
   * eliminado) no se pierde nada. Lo usan el motor, el aviso y la tarjeta.
   */
  retreatOutcome(atk) {
    const target = atk.targetId ? this.players[atk.targetId] : null;
    const ratio = target && target.alive ? 1 - MECH.retreatPenalty : 1;
    const troops = Math.max(0, atk.troops);
    const ticksLeft = atk.retreatAt ? Math.max(0, atk.retreatAt - this.ticks) : MECH.retreatTicks;
    return { ratio, troops, refund: troops * ratio, lost: troops * (1 - ratio), ticksLeft, seconds: (ticksLeft * TICK_MS) / 1000 };
  }

  /**
   * Retirada: se hace efectiva a los retreatTicks turnos. Una segunda orden
   * mientras se resuelve no hace nada (un solo reembolso); un refuerzo antes
   * del plazo la cancela y el frente sigue (launchAttack).
   */
  retreat(atk) {
    if (atk.done || atk.retreatAt) return false;
    atk.retreatAt = this.ticks + MECH.retreatTicks;
    const A = atk.attacker;
    if (A === this.human) {
      const o = this.retreatOutcome(atk);
      const secs = o.seconds.toLocaleString('es-ES', { maximumFractionDigits: 1 });
      this._emit(
        o.ratio < 1
          ? `Retirada en ${secs} s: vuelven ~${fmtTroops(o.refund)} de ${fmtTroops(o.troops)} (se pierde el ${Math.round(MECH.retreatPenalty * 100)} %)`
          : `Retirada en ${secs} s: vuelven las ${fmtTroops(o.troops)} tropas`,
        'info',
        { feedback: true },
      );
    }
    return true;
  }

  /**
   * Comprueba los cercos de lo que conquistó `atk` desde la última vez. Las
   * casillas interiores del frente no tienen vecinas libres: en la práctica
   * solo se mira el borde exterior, una vez, en vez de capa a capa.
   */
  _flushAnnex(atk) {
    const q = atk.annexQ;
    if (!q || !q.length) return;
    const aid = atk.attacker.id;
    const owner = this.owner;
    for (let i = 0; i < q.length; i++) {
      if (owner[q[i]] === aid) this._annexAround(q[i], aid, atk.targetId);
    }
    q.length = 0;
  }

  /**
   * Cerco (documento, 05.3): tras conquistar `t`, las bolsas vecinas de
   * tierra sin dueño o del defensor que han quedado rodeadas por el atacante,
   * sin costa (y no muy grandes), pasan a ser suyas al momento y sin bajas.
   */
  _annexAround(t, aid, tid) {
    if (this._annexBudget <= 0) return;
    const map = this.map;
    const nb = (this._annexNb ??= new Int32Array(4));
    const c = map.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      const o = this.owner[n];
      if (o === aid || map.terrain[n] === 0 || (o !== tid && o !== 0)) continue;
      if (this._annexFail[n] === this.ticks) continue;
      this._tryAnnex(n, aid);
      if (this._annexBudget <= 0) return;
    }
  }

  /** ¿Es la bolsa de `start` una zona cercada por `aid`? Si lo es, la anexiona. */
  _tryAnnex(start, aid) {
    const map = this.map;
    const owner = this.owner;
    const terrain = map.terrain;
    const river = map.river;
    const o = owner[start];
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const queue = this._queue;
    const fail = this._annexFail;
    const nb = (this._annexNb2 ??= new Int32Array(4));
    const max = this.players[aid].weak ? ANNEX_MAX_COLONY : ANNEX_MAX_TILES;
    let tooBig = false;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = stamp;
    let ok = true;
    let probed = false;
    let probeSteps = 0;
    while (ok && head < tail) {
      // Bolsa que ya pasa de unas decenas de casillas: casi siempre es tierra
      // abierta que acaba escapando tras recorrer cientos. Una sonda en línea
      // recta lo demuestra mucho antes (mismo resultado, mucho menos trabajo)
      if (!probed && tail >= ANNEX_PROBE_AT) {
        probed = true;
        const escapes = this._annexProbe(start, o, aid);
        probeSteps = this._probeSteps;
        if (escapes) {
          ok = false;
          break;
        }
      }
      const u = queue[head++];
      const cnt = map.neighbors(u, nb);
      if (cnt < 4) {
        ok = false; // toca el borde del mapa
        break;
      }
      for (let k = 0; k < cnt; k++) {
        const v = nb[k];
        if (terrain[v] === 0) {
          if (river[v]) continue; // un río cierra la bolsa como una frontera
          ok = false; // tiene costa: no es un cerco
          break;
        }
        const ov = owner[v];
        if (ov === aid) continue;
        if (ov !== o || fail[v] === this.ticks) {
          ok = false; // toca a otro o ya se vio que escapa
          break;
        }
        if (seen[v] !== stamp && tail >= max) {
          ok = false; // demasiado grande para este jugador
          tooBig = max < ANNEX_MAX_TILES;
          break;
        }
        if (seen[v] !== stamp) {
          seen[v] = stamp;
          queue[tail++] = v;
        }
      }
    }
    this._annexBudget -= tail + probeSteps;
    if (!ok) {
      // (si solo era grande para una colonia, una nación aún puede cercarla)
      if (!tooBig) for (let i = 0; i < tail; i++) fail[queue[i]] = this.ticks;
      return false;
    }
    const tiles = Array.from(queue.subarray(0, tail));
    for (const u of tiles) this.setOwner(u, aid);
    return true;
  }

  /**
   * Sonda del cerco: desde `start` (de `o`) avanza en línea recta en las
   * cuatro direcciones a la vez, solo por casillas de `o`. Si alguna llega al
   * borde del mapa, al agua, a otro dueño o a una casilla que ya escapó en
   * este turno, o si entre todas pasan del tamaño máximo de una bolsa, la
   * bolsa no está cercada: el recorrido completo fallaría igual (todas esas
   * casillas son de la bolsa). Si las cuatro chocan con `aid`, no se sabe.
   * Devuelve si escapa; los pasos dados quedan en `_probeSteps`.
   */
  _annexProbe(start, o, aid) {
    const map = this.map;
    const W = map.width;
    const owner = this.owner;
    const terrain = map.terrain;
    const fail = this._annexFail;
    const ticks = this.ticks;
    const cur = (this._probeCur ??= new Int32Array(4));
    const dirs = (this._probeDirs ??= Int32Array.of(-1, 1, -W, W));
    const room = (this._probeRoom ??= new Int32Array(4));
    // Pasos hasta el borde del mapa en cada dirección (la de salida no está
    // en el borde: el recorrido ya la ha visto con sus cuatro vecinas)
    const x = start % W;
    const y = (start / W) | 0;
    room[0] = x;
    room[1] = W - 1 - x;
    room[2] = y;
    room[3] = map.height - 1 - y;
    cur.fill(start);
    this._probeStart = start;
    let alive = 15; // direcciones aún abiertas (bits)
    let steps = 0;
    while (alive) {
      for (let d = 0; d < 4; d++) {
        if (!(alive & (1 << d))) continue;
        // En el borde: la bolsa toca el límite del mapa
        if (--room[d] < 0) return this._probeEnd(steps, true);
        const v = cur[d] + dirs[d];
        if (terrain[v] === 0 && !map.river[v]) return this._probeEnd(steps, true);
        const ov = owner[v];
        // El cerco propio o un río cierran este rayo
        if (ov === aid || terrain[v] === 0) {
          alive &= ~(1 << d);
          continue;
        }
        if (ov !== o || fail[v] === ticks) return this._probeEnd(steps, true);
        cur[d] = v;
        // Casillas distintas de la bolsa: la de salida y las de cada rayo
        if (++steps + 1 > ANNEX_MAX_TILES) return this._probeEnd(steps, true);
      }
    }
    return this._probeEnd(steps, false);
  }

  _probeEnd(steps, escapes) {
    this._probeSteps = steps;
    if (escapes) {
      // Los rayos también son de la bolsa que escapa: las búsquedas que los
      // toquen en este turno fallan al momento
      const fail = this._annexFail;
      const cur = this._probeCur;
      const dirs = this._probeDirs;
      const start = this._probeStart;
      for (let d = 0; d < 4; d++) for (let u = start; u !== cur[d]; ) fail[(u += dirs[d])] = this.ticks;
    }
    return escapes;
  }

  /** Termina un ataque; las tropas sobrantes (× refund) vuelven a casa. */
  _endAttack(atk, refund = 1) {
    if (atk.done) return;
    // Los cercos que quedaban por comprobar, antes de cerrar el frente
    this._flushAnnex(atk);
    atk.done = true;
    const A = atk.attacker;
    if (this.trace && atk.traceId) {
      this.trace.push({ t: 'fin', tick: this.ticks, jugador: A.id, idFrente: atk.traceId, objetivo: atk.targetId, reembolso: A.alive ? atk.troops * refund : 0, bajas: atk.troops * (1 - refund), retirada: atk.retreatAt > 0 });
    }
    if (A.alive) A.troops += atk.troops * refund;
    atk.troops = 0;
    if (A.attacks.get(atk.targetId) === atk) A.attacks.delete(atk.targetId);
    atk.heap = null;
    atk.inFrontier.clear();
  }

  // --------------------------------------------------------------- edificios

  /** ¿Permiten las reglas de esta partida este edificio o unidad? */
  isAllowed(kind) {
    if (!this.rules.missiles && (kind === 'silo' || kind === 'sam' || (BUILDINGS[kind] && BUILDINGS[kind].unit === 'missile'))) return false;
    if (!this.rules.warships && kind === 'warship') return false;
    if (!this.rules.factories && kind === 'factory') return false;
    return true;
  }

  /** Tregua inicial (regla): hasta este tick no se puede atacar a otras naciones. */
  truceUntil() {
    return CONFIG.spawnTicks + this.rules.truceMin * 600;
  }

  inTruce() {
    return this.rules.truceMin > 0 && this.ticks < this.truceUntil();
  }

  /** ¿La tregua impide que `p` ataque a `target`? (las colonias y la tierra libre, siempre se pueden) */
  _truceBlocks(p, target) {
    if (target) {
      const pact = this.pactBetween(p.id, target.id);
      if (pact) {
        this._notify(p, `Tenéis un ${pact.kind === 'peace' ? 'acuerdo de paz' : 'pacto de no agresión'} (quedan ${Math.ceil((pact.until - this.ticks) / 10)} s)`, 'warn');
        return true;
      }
    }
    if (!target || target.weak || p.weak || !this.inTruce()) return false;
    const s = Math.ceil((this.truceUntil() - this.ticks) / 10);
    this._notify(p, `Tregua: aún no puedes atacar a otras naciones (quedan ${s} s)`, 'warn');
    return true;
  }

  /**
   * Precio del siguiente (documento, 04.2): ciudades min(1M, 125k × 2^n);
   * puertos y fábricas comparten escalera min(1M, 125k × 2^(nPuerto + nFábrica));
   * puesto defensivo min(250k, 50k × (n + 1)); buque min(1M, 250k × (n + 1));
   * antimisiles min(3M, 1,5M × (n + 1)); silo 1M; bomba atómica 750k; bomba
   * H 5M; MIRV 25M. `n` cuenta también los niveles subidos con mejoras.
   */
  buildCost(p, kind) {
    const def = BUILDINGS[kind];
    if (def && def.unit === 'capital') return this.capitalCost(p);
    const n = p.owned;
    n.warship = 0;
    for (const ws of this.warships) if (ws.owner === p.id && !ws.dead) n.warship++;
    let price = priceFor(kind, n) * this.rules.priceMult;
    if (kind === 'city') price *= 1 + p.mods.cityCost;
    else if (kind === 'factory') price *= 1 + p.mods.factoryCost;
    else if (BUILDINGS[kind] && BUILDINGS[kind].unit === 'missile') price *= 1 + p.mods.missileCost;
    return Math.round(price);
  }

  /** Subir `b` un nivel cuesta lo mismo que uno nuevo de su tipo (el nivel cuenta en la escalera). */
  upgradeCost(p, b) {
    return this.buildCost(p, b.kind);
  }

  /** Edificio propio del tipo `kind` en el clic (o a 2 casillas): se mejoraría. */
  upgradeTarget(p, kind, tile) {
    if (tile < 0 || tile >= this.map.size) return null;
    const b = this.buildingAt.get(tile) || this.buildingNear(tile, 3 * RES);
    return b && b.owner === p.id && b.kind === kind ? b : null;
  }

  /** ¿Está en obras (nuevo o mejorándose)? */
  isBuilding(b) {
    return b.target > 0;
  }

  /** Avance de la obra, de 0 a 1. */
  buildProgress(b) {
    if (!b.target) return 1;
    return Math.max(0, Math.min(1, 1 - (b.buildEnd - this.ticks) / Math.max(1, b.buildTime)));
  }

  /** Comprueba si `p` puede construir `kind` en `tile`; si no, explica por qué. */
  canBuild(p, kind, tile) {
    const map = this.map;
    const def = BUILDINGS[kind];
    if (!def) return { ok: false, reason: 'Edificio desconocido' };
    if (!this.isAllowed(kind)) return { ok: false, reason: 'Desactivado en esta partida' };
    if (def.unique) return { ok: false, reason: `${def.name}: no se construye` };
    if (def.unit === 'capital') return this._canUpgradeCapital(p);
    if (def.unit === 'ship') return this._canBuildWarship(p, tile);
    if (def.unit === 'missile') return this._canLaunchMissile(p, tile, kind);
    if (tile < 0 || tile >= map.size || this.owner[tile] !== p.id) {
      return { ok: false, reason: 'Solo puedes construir en tu territorio' };
    }
    // Sobre un edificio propio del mismo tipo: se sube de nivel
    const up = this.upgradeTarget(p, kind, tile);
    if (up) {
      if (up.target) return { ok: false, reason: `${def.name}: ya está en obras`, upgrade: up };
      if (up.level >= CONFIG.maxLevel) return { ok: false, reason: `${def.name}: ya está al nivel máximo`, upgrade: up };
      const cost = this.upgradeCost(p, up);
      if (p.gold < cost) return { ok: false, reason: `Te falta oro: subir de nivel cuesta ${formatNumber(cost)}`, upgrade: up };
      return { ok: true, reason: '', upgrade: up, cost };
    }
    if (def.coastal && !map.coastal[tile]) return { ok: false, reason: 'El puerto tiene que estar en la costa' };
    const near = this.buildingNear(tile, CONFIG.buildingMinDist);
    if (near) return { ok: false, reason: `Demasiado cerca de otro edificio (${BUILDINGS[near.kind].name})` };
    const cost = this.buildCost(p, kind);
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: ${def.name} cuesta ${formatNumber(cost)}` };
    return { ok: true, reason: '', cost };
  }

  /**
   * Los puertos no exigen atinar en la orilla: si el clic no es una casilla
   * costera propia y libre, se usa la más cercana (hasta CONFIG.portSnap
   * casillas, también si se hace clic en el agua). Determinista.
   */
  snapBuildTile(p, kind, tile) {
    const def = BUILDINGS[kind];
    const map = this.map;
    if (!def || !def.coastal || tile < 0 || tile >= map.size) return tile;
    // Clic sobre (o junto a) un puerto propio: se sube de nivel ese puerto
    const up = this.upgradeTarget(p, kind, tile);
    if (up) return up.tile;
    const free = (t) => map.coastal[t] && this.owner[t] === p.id && !this.buildingNear(t, CONFIG.buildingMinDist);
    if (free(tile)) return tile;
    const R = CONFIG.portSnap;
    const x0 = map.x(tile);
    const y0 = map.y(tile);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dy * dy;
        if (d > R * R || d >= bestD || !map.inBounds(x0 + dx, y0 + dy)) continue;
        const t = map.index(x0 + dx, y0 + dy);
        if (!free(t)) continue;
        best = t;
        bestD = d;
      }
    }
    return best >= 0 ? best : tile;
  }

  build(p, kind, tile) {
    const check = this.canBuild(p, kind, tile);
    if (!check.ok) return false;
    const def = BUILDINGS[kind];
    if (def.unit === 'capital') return this._startCapitalWork(p);
    if (check.upgrade) return this._startUpgrade(p, check.upgrade);
    const price = this.buildCost(p, kind);
    p.gold -= price;
    p.spent.buildings += price;
    if (def.unit === 'ship') return this._launchWarship(p, check.water, check.zone);
    if (def.unit === 'missile') return this._launchMissile(p, check.silo, tile, kind);
    p.stats.built++;
    // Empieza la obra: nivel 0 (sin efecto) hasta que termine
    const time = Math.max(1, Math.round(def.build * (1 - p.mods.buildSpeed)));
    const b = { id: this._nextBuildingId++, kind, tile, owner: 0, level: 0, target: 1, buildEnd: this.ticks + time, buildTime: time };
    this.sites.push(b);
    if (kind === 'port') {
      b.water = this._waterNextTo(tile);
      b.rejections = 0;
    }
    if (kind === 'silo' || kind === 'sam') b.readyAt = this.ticks; // listo desde ya
    this.buildings.push(b);
    this.buildingAt.set(tile, b);
    this._transferBuilding(b, 0, p.id, true);
    return true;
  }

  _startUpgrade(p, b) {
    const def = BUILDINGS[b.kind];
    const price = this.upgradeCost(p, b);
    p.gold -= price;
    p.spent.buildings += price;
    p.stats.built++;
    const time = Math.max(1, Math.round(def.build * CONFIG.upgradeTimeMult * (1 - p.mods.buildSpeed)));
    b.target = b.level + 1;
    b.buildEnd = this.ticks + time;
    b.buildTime = time;
    this.sites.push(b);
    this._recount(p); // el nivel en obras ya cuenta para los precios
    if (p === this.human) this._emit(`Mejorando ${def.name.toLowerCase()} a nivel ${b.target} (${Math.round(time / 10)} s)`, 'info');
    return true;
  }

  /** Termina las obras cuyo plazo ha vencido. */
  _updateSites() {
    for (const c of this.capitals) if (c.work && this.ticks >= c.work.end) this._finishCapitalWork(c);
    if (!this.sites.length) return;
    let changed = false;
    for (const b of this.sites) {
      if (!b.target || this.buildingAt.get(b.tile) !== b) {
        changed = true;
        continue;
      }
      if (this.ticks < b.buildEnd) continue;
      const upgraded = b.level > 0;
      b.level = b.target;
      b.target = 0;
      changed = true;
      const p = this.players[b.owner];
      this._recount(p);
      p.stats.finished = (p.stats.finished || 0) + 1;
      p.stats.lastFinished = b.kind;
      if (p === this.human) {
        const def = BUILDINGS[b.kind];
        this._emit(upgraded ? `${def.name} mejorad${def.fem ? 'a' : 'o'} a nivel ${b.level}` : `${def.name} terminad${def.fem ? 'a' : 'o'}`, 'good');
      }
    }
    if (changed) this.sites = this.sites.filter((b) => b.target && this.buildingAt.get(b.tile) === b);
  }

  /** Recalcula los contadores de edificios de `p` (totales, terminados, niveles, fortalezas). */
  _recount(p) {
    if (!p) return;
    for (const k of STRUCTURE_KINDS) {
      p.buildings[k] = 0;
      p.active[k] = 0;
      p.levels[k] = 0;
      p.owned[k] = 0;
    }
    p.forts.clear();
    for (const b of this.buildings) {
      if (b.owner !== p.id) continue;
      p.buildings[b.kind]++;
      p.owned[b.kind] += Math.max(b.level, b.target || 0);
      if (b.level > 0) {
        p.active[b.kind]++;
        p.levels[b.kind] += b.level;
        if (b.kind === 'fort') p.forts.add(b.tile);
      }
    }
  }

  /**
   * Primer edificio a menos de `dist` casillas de `tile` (o null). La
   * capital solo aparta lo justo (CONFIG.capitalClearance): alrededor de ella
   * es donde se construye.
   */
  buildingNear(tile, dist) {
    const map = this.map;
    const x = map.x(tile);
    const y = map.y(tile);
    const capD = Math.min(dist, CONFIG.capitalClearance);
    for (const b of this.buildings) {
      const dx = map.x(b.tile) - x;
      const dy = map.y(b.tile) - y;
      const d = b.kind === 'capital' ? capD : dist;
      if (dx * dx + dy * dy < d * d) return b;
    }
    return null;
  }

  /** Los edificios cambian de manos con su casilla; sin dueño, se destruyen. */
  _transferBuilding(b, oldId, newId, built = false) {
    if (b.kind === 'capital') return this._capitalFalls(b, oldId, newId);
    const def = BUILDINGS[b.kind];
    const name = def.name;
    const some = `${def.fem ? 'una' : 'un'} ${name.toLowerCase()}`; // "una ciudad", "un puerto"
    if (!newId) {
      this.buildings = this.buildings.filter((x) => x !== b);
      this.buildingAt.delete(b.tile);
      if (oldId) this._recount(this.players[oldId]);
      return;
    }
    b.owner = newId;
    if (oldId) {
      const op = this.players[oldId];
      this._recount(op);
      if (op === this.human) this._buildingNews('lost', b, this.players[newId].name);
    }
    const np = this.players[newId];
    this._recount(np);
    if (np.buildings.city > np.stats.maxCities) np.stats.maxCities = np.buildings.city;
    if (np.buildings.factory > np.stats.maxFactories) np.stats.maxFactories = np.buildings.factory;
    if (np === this.human) {
      if (built) this._emit(`Obras: ${name.toLowerCase()} lista en ${Math.round(b.buildTime / 10)} s`, 'info');
      else this._buildingNews('got', b);
    }
  }

  /**
   * Edificios tuyos capturados o perdidos: se juntan y se avisa una vez por
   * turno (con un solo sonido). Al conquistar un país entero caían decenas a
   * la vez y cada uno sonaba y avisaba por su cuenta.
   */
  _buildingNews(kind, b, by = '') {
    const n = (this._bNews ??= { got: [], lost: [], by: new Set() });
    n[kind].push(b);
    if (by) n.by.add(by);
  }

  _flushBuildingNews() {
    const n = this._bNews;
    if (!n || (!n.got.length && !n.lost.length)) return;
    const describe = (list) => {
      if (list.length === 1) {
        const b = list[0];
        const def = BUILDINGS[b.kind];
        return `${def.fem ? 'una' : 'un'} ${def.name.toLowerCase()}${b.level > 1 ? ` de nivel ${b.level}` : ''}`;
      }
      return `${list.length} edificios`;
    };
    if (n.got.length) this._emit(`Has capturado ${describe(n.got)}`, 'good', { sfx: 'capture', count: n.got.length });
    if (n.lost.length) {
      const who = [...n.by];
      this._emit(`Has perdido ${describe(n.lost)} a manos de ${who.length === 1 ? who[0] : `${who.length} naciones`}`, 'danger');
    }
    n.got.length = 0;
    n.lost.length = 0;
    n.by.clear();
  }

  // ------------------------------------------------------- economía naval

  _waterNextTo(tile) {
    const nb = NB_MISC;
    const c = this.map.neighbors(tile, nb);
    for (let k = 0; k < c; k++) if (this.map.navigable(nb[k])) return nb[k];
    return -1;
  }

  /**
   * Mercantes (documento, 04.3): cada puerto consulta cada 10 ticks si sale
   * uno, con probabilidad 1 / max(1, floor(100 / boost² / (rechazos + 1) /
   * saturación)) (PROPUESTA: boost = nivel del puerto; saturación según los
   * mercantes que ya navegan). Va a un puerto de otro jugador del mismo mar
   * con el que no esté en guerra y, al llegar, los dos dueños reciben
   * floor((75 000 / (1 + e^(−0,03 (d − 300))) + 50 d) × multiplicador), con
   * d = casillas de agua recorridas.
   */
  _updateMerchants() {
    const map = this.map;
    // Cada puerto consulta cada checkEvery turnos, en su turno (repartidos: antes
    // todos a la vez, y el turno de la consulta daba un tirón). Como mucho una
    // ruta nueva (sin calcular aún) por turno: la primera búsqueda entre dos
    // puertos lejanos puede llevar decenas de ms; las demás esperan su turno
    {
      const every = MECH.trade.checkEvery;
      const phase = this.ticks % every;
      const ports = this.buildings.filter((b) => b.kind === 'port' && b.water >= 0 && b.level > 0);
      let afloat = 0;
      for (const m of this.merchants) if (m.kind === 'trade') afloat++;
      let fresh = 1;
      for (const b of ports) {
        if (b.id % every !== phase) continue;
        const chance = tradeSpawnChance(b.level, b.rejections || 0, afloat);
        if (this.rng.float() >= chance) {
          b.rejections = (b.rejections || 0) + 1;
          continue;
        }
        const owner = this.players[b.owner];
        let options = ports.filter((o) => o.owner !== b.owner && map.waterBody[o.water] === map.waterBody[b.water] && !this.atWar(owner, this.players[o.owner]));
        // doc-1.6: sin puertos de otros a mano, a uno propio del mismo mar
        if (!options.length) options = ports.filter((o) => o !== b && o.owner === b.owner && map.waterBody[o.water] === map.waterBody[b.water]);
        if (!options.length) {
          b.rejections = (b.rejections || 0) + 1;
          continue;
        }
        const dest = options[this.rng.int(0, options.length - 1)];
        if (!this._pathCache.has(`${b.water},${dest.water},${SEARCH.trade}`)) {
          if (fresh <= 0) continue; // ruta nueva: en otro turno
          fresh--;
        }
        const path = this._waterPath(b.water, dest.water, SEARCH.trade);
        if (!path) {
          b.rejections = (b.rejections || 0) + 1;
          continue;
        }
        b.rejections = 0;
        this._spawnMerchant(b, 'trade', dest, path.length - 1, path);
        afloat++;
      }
      this._launchFishing(ports);
    }
    for (const m of this.merchants) {
      const owner = this.players[m.owner];
      if (!owner.alive) {
        m.done = true;
        continue;
      }
      if (m.path) {
        m.progress += CONFIG.tradeSpeed;
        while (m.progress >= 1 && m.pos < m.path.length - 1) {
          m.pos++;
          m.progress -= 1;
        }
        m.tile = m.path[m.pos];
        if (m.pos < m.path.length - 1) continue;
        m.path = null;
      }
      if (m.kind === 'trade') this._arriveTrade(m);
      else if (m.kind === 'fish') this._fishStep(m);
    }
    if (this.merchants.some((m) => m.done)) this.merchants = this.merchants.filter((m) => !m.done);
  }

  _spawnMerchant(port, kind, dest, value, path = null) {
    this.merchants.push({
      out: kind === 'fish' ? path : null,
      id: this._nextMerchantId++,
      owner: port.owner,
      kind,
      port: port.id,
      dest: dest ? dest.id : 0,
      tile: port.water,
      path,
      pos: 0,
      progress: 0,
      value,
      done: false,
    });
  }

  /** Llega un mercante: los dos dueños cobran según la distancia recorrida por el agua (`m.value`). */
  _arriveTrade(m) {
    m.done = true;
    const dest = this.buildings.find((b) => b.id === m.dest);
    if (!dest) return; // el puerto de destino ya no existe
    const owner = this.players[m.owner];
    // La fórmula cuenta la distancia en casillas del documento (mundo de
    // 2000×1000): con más resolución, la misma ruta tiene más casillas
    const d = m.value / DOC_LEN;
    const own = dest.owner === m.owner;
    const earned = tradeGold(d, owner.goldMult) * (1 + owner.mods.trade) * (own ? MECH.trade.ownPortShare : 1);
    owner.gold += earned;
    owner.income.trade += earned;
    const partner = this.players[dest.owner];
    if (partner && partner.alive && partner !== owner) {
      const share = tradeGold(d, partner.goldMult) * (1 + partner.mods.trade);
      partner.gold += share;
      partner.income.trade += share;
      if (partner === this.human) this._emit(`⚓ Un mercante de ${owner.name} llega a tu puerto: +${formatNumber(share)} de oro`, 'good', { sfx: 'coin' });
    }
    if (owner === this.human) this._emit(`⚓ Tu mercante llega a su destino: +${formatNumber(earned)} de oro`, 'good', { sfx: 'coin' });
  }

  // ---------------------------------------------------------------- pesca

  /**
   * Pesqueros (doc-1.6): cada puerto consulta cada fishing.checkEvery turnos
   * (repartidos) si le falta alguno faenando (tantos como su nivel, hasta 3)
   * y lo manda a un caladero cercano del mismo mar. Como mucho una ruta nueva
   * por turno (las búsquedas por el mar cuestan).
   */
  _launchFishing(ports) {
    const F = MECH.fishing;
    const every = F.checkEvery;
    const phase = this.ticks % every;
    const map = this.map;
    let budget = 1;
    let afloat = null;
    for (const b of ports) {
      if (budget <= 0) break;
      if (b.id % every !== phase) continue;
      // Pesqueros de cada puerto faenando ahora (se cuentan aquí: así un
      // pesquero hundido, capturado o de un dueño eliminado no deja la cuenta mal)
      if (!afloat) {
        afloat = new Map();
        for (const m of this.merchants) if (m.kind === 'fish' && !m.done) afloat.set(m.port, (afloat.get(m.port) || 0) + 1);
      }
      const want = Math.min(F.maxPerPort, b.level);
      if ((afloat.get(b.id) || 0) >= want) continue;
      // Caladeros del puerto: hasta 4, elegidos la primera vez (agua del mismo
      // mar, ni muy cerca ni muy lejos, con el azar de la partida). Sus rutas
      // se guardan: antes cada salida buscaba un camino nuevo por el mar
      if (!b.spots) {
        b.spots = [];
        const R = Math.round(F.maxDist * DOC_LEN);
        const min = F.minDist * DOC_LEN;
        const x0 = map.x(b.water);
        const y0 = map.y(b.water);
        for (let k = 0; k < 24 && b.spots.length < 4; k++) {
          const x = x0 + this.rng.int(-R, R);
          const y = y0 + this.rng.int(-R, R);
          if (!map.inBounds(x, y)) continue;
          const t = map.index(x, y);
          const d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
          if (d2 < min * min || d2 > R * R || !map.navigable(t) || map.waterBody[t] !== map.waterBody[b.water]) continue;
          b.spots.push(t);
        }
      }
      if (!b.spots.length) continue;
      const spot = b.spots[this.rng.int(0, b.spots.length - 1)];
      if (!this._pathCache.has(`${b.water},${spot},${SEARCH.fishing}`)) budget--;
      const path = this._waterPath(b.water, spot, SEARCH.fishing);
      if (!path || path.length < 3) continue;
      this._spawnMerchant(b, 'fish', null, path.length - 1, path);
      const m = this.merchants[this.merchants.length - 1];
      m.phase = 'out';
      m.level = b.level;
      afloat.set(b.id, (afloat.get(b.id) || 0) + 1);
    }
  }

  /** Un pesquero al final de su tramo: se pone a pescar, vuelve o cobra al llegar. */
  _fishStep(m) {
    const F = MECH.fishing;
    if (m.phase === 'out') {
      m.phase = 'fishing';
      m.until = this.ticks + F.fishTicks;
      return;
    }
    if (m.phase === 'fishing') {
      if (this.ticks < m.until) return;
      // De vuelta por el mismo camino
      m.phase = 'back';
      m.path = m.out.slice().reverse();
      m.pos = 0;
      m.progress = 0;
      return;
    }
    // De vuelta en puerto: cobra su dueño (el de ahora: puede haber sido capturado)
    m.done = true;
    const owner = this.players[m.owner];
    if (!owner || !owner.alive) return;
    const earned = Math.round((F.base + F.perTile * (m.value / DOC_LEN)) * (1 + F.levelBonus * Math.max(0, (m.level || 1) - 1)) * owner.goldMult * (1 + owner.mods.trade));
    owner.gold += earned;
    owner.income.fishing += earned;
    owner.stats.fishGold = (owner.stats.fishGold || 0) + earned;
    const map = this.map;
    this.effects.push({ kind: 'fish', x: map.x(m.tile) + 0.5, y: map.y(m.tile) + 0.5, gold: earned, owner: m.owner, tick: this.ticks });
  }

  /** Un buque se queda con un barco automático enemigo: ahora produce para su nuevo dueño. */
  _captureMerchant(ws, m) {
    const victim = this.players[m.owner];
    const thief = this.players[ws.owner];
    m.owner = ws.owner;
    thief.stats.captured = (thief.stats.captured || 0) + 1;
    if (thief === this.human) this._emit(`🏴 Has capturado un mercante de ${victim.name}`, 'good');
    else if (victim === this.human) this._emit(`🏴 ${thief.name} te ha robado un mercante`, 'danger');
  }

  // ---------------------------------------------------- misiles y antimisiles

  /** Silo propio listo y a tiro de `tile` (el más cercano), o null. */
  readySilo(p, tile) {
    const map = this.map;
    const r2 = CONFIG.missileRange * CONFIG.missileRange;
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== p.id || b.kind !== 'silo' || !b.level || b.readyAt > this.ticks) continue;
      const dx = map.x(b.tile) - map.x(tile);
      const dy = map.y(b.tile) - map.y(tile);
      const d = dx * dx + dy * dy;
      if (d <= r2 && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  _canLaunchMissile(p, tile, kind = 'missile') {
    const map = this.map;
    if (this.inTruce()) return { ok: false, reason: `Tregua: aún no se pueden lanzar misiles (quedan ${Math.ceil((this.truceUntil() - this.ticks) / 10)} s)` };
    if (!p.active.silo) return { ok: false, reason: p.buildings.silo ? 'Tu silo aún está en obras' : 'Necesitas un silo para lanzar misiles' };
    if (tile < 0 || tile >= map.size || !map.isLand(tile)) return { ok: false, reason: 'Apunta a territorio enemigo' };
    const o = this.owner[tile];
    if (!o) return { ok: false, reason: 'Ahí no hay nadie: apunta a territorio enemigo' };
    if (o === p.id || this.isAllied(p.id, o)) return { ok: false, reason: 'No puedes atacar tu territorio ni el de tus aliados' };
    if (this.pactBetween(p.id, o)) return { ok: false, reason: 'Tenéis un pacto: no puedes lanzarle misiles' };
    const cost = this.buildCost(p, kind);
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: ${BUILDINGS[kind].name.toLowerCase()} cuesta ${formatNumber(cost)}` };
    const silo = this.readySilo(p, tile);
    if (!silo) {
      const any = this.buildings.some((b) => b.owner === p.id && b.kind === 'silo' && b.level > 0 && b.readyAt <= this.ticks);
      return { ok: false, reason: any ? 'Fuera del alcance de tus silos' : 'Tus silos están recargando' };
    }
    return { ok: true, reason: '', silo };
  }

  /**
   * Lanza desde `silo`: bomba atómica (un impacto), bomba H (un impacto mucho
   * mayor) o MIRV (se divide en muchas cabezas que caen repartidas por el
   * territorio del país atacado; cada una se puede derribar).
   */
  _launchMissile(p, silo, tile, kind = 'missile') {
    const map = this.map;
    silo.readyAt = this.ticks + Math.round(CONFIG.siloReload * (1 - CONFIG.siloReloadPerLevel * (silo.level - 1)) * (1 + (this.players[silo.owner]?.mods.reload || 0)));
    silo.reloadFrom = this.ticks;
    const targetId = this.owner[tile];
    const shoot = (to, radius) => {
      const dx = map.x(to) - map.x(silo.tile);
      const dy = map.y(to) - map.y(silo.tile);
      this.missiles.push({ id: this._nextMissileId++, owner: p.id, kind, radius, from: silo.tile, to, dist: Math.max(1, Math.sqrt(dx * dx + dy * dy)), progress: 0, targetId });
    };
    if (kind === 'mirv') {
      // Casillas del objetivo, elegidas al azar (con la semilla) entre todas las suyas
      const mine = [];
      const owner = this.owner;
      for (let i = 0; i < owner.length; i++) if (owner[i] === targetId) mine.push(i);
      for (let k = 0; k < CONFIG.mirvWarheads && mine.length; k++) shoot(mine[this.rng.int(0, mine.length - 1)], Math.max(2, Math.round(CONFIG.missileRadius * CONFIG.mirvRadius)));
    } else {
      shoot(tile, Math.round(CONFIG.missileRadius * (kind === 'hbomb' ? CONFIG.hbombRadius : 1)));
    }
    p.stats.missiles++;
    const target = this.players[targetId];
    const what = BUILDINGS[kind].name;
    if (target === this.human) this._emit(`🚀 ¡${p.name} ha lanzado ${kind === 'missile' ? 'una bomba atómica' : kind === 'hbomb' ? 'una bomba H' : 'un MIRV'} contra ti!`, 'danger');
    else if (p === this.human) this._emit(`🚀 ${what} lanzad${kind === 'mirv' ? 'o' : 'a'} contra ${target.name}`, 'info');
    return true;
  }

  /** Posición actual (en casillas, con decimales) de un misil en vuelo. */
  missilePos(m) {
    const W = this.map.width;
    const fx = (m.from % W) + 0.5;
    const fy = Math.floor(m.from / W) + 0.5;
    const tx = (m.to % W) + 0.5;
    const ty = Math.floor(m.to / W) + 0.5;
    return [fx + (tx - fx) * m.progress, fy + (ty - fy) * m.progress];
  }

  _updateMissiles() {
    if (!this.missiles.length) return;
    const W = this.map.width;
    for (const m of this.missiles) {
      m.progress = Math.min(1, m.progress + CONFIG.missileSpeed / m.dist);
      const [mx, my] = this.missilePos(m);
      // Baterías antimisiles (y escudos de las capitales) enemigas del
      // lanzador que estén listas y a tiro (doc-1.7: salvas de varios
      // interceptores; si uno falla, el siguiente vuelve a intentarlo)
      for (const b of this.buildings) {
        const shield = b.kind === 'capital';
        if ((b.kind !== 'sam' && !shield) || !b.level || b.readyAt > this.ticks || !this._isEnemy(m.owner, b.owner)) continue;
        const dx = (b.tile % W) + 0.5 - mx;
        const dy = Math.floor(b.tile / W) + 0.5 - my;
        const range = shield ? CONFIG.capitalSamRange : this.samRange(b.level);
        if (dx * dx + dy * dy > range * range) continue;
        const shooter = this.players[b.owner];
        const shots = this.samShots(b);
        if (!(b.ammo > 0)) b.ammo = shots; // salva recargada
        b.ammo--;
        // Entre dos disparos de la salva, una pausa corta; al vaciarla, la recarga entera
        const reload = Math.round(CONFIG.samReload * (1 - CONFIG.samReloadPerLevel * (Math.min(b.level, CONFIG.maxLevel) - 1)));
        b.readyAt = this.ticks + (b.ammo > 0 ? CONFIG.samGap : Math.max(CONFIG.samGap, reload));
        b.reloadFrom = this.ticks;
        const hit = this.rng.float() < this.samHitChance(b, shooter);
        this.effects.push({ kind: hit ? 'intercept' : 'miss', x: mx, y: my, from: b.tile, tick: this.ticks });
        if (!hit) continue;
        m.dead = true;
        const launcher = this.players[m.owner];
        const what = shield ? 'el escudo de tu capital' : 'tu antimisiles';
        if (shooter === this.human) this._emit(`🛡 ${what[0].toUpperCase()}${what.slice(1)} ha derribado un misil de ${launcher.name}`, 'good');
        else if (launcher === this.human) this._emit(`Tu misil ha sido derribado por ${shooter.name}`, 'warn');
        else if (this.players[m.targetId] === this.human) this._emit(`🛡 ${shooter.name} ha derribado un misil que iba hacia ti`, 'good');
        break;
      }
      if (!m.dead && m.progress >= 1) {
        m.dead = true;
        this._detonate(m);
      }
    }
    this.missiles = this.missiles.filter((m) => !m.dead);
  }

  /** Impacto: las casillas enemigas del radio quedan libres y sus defensores pierden tropas. */
  _detonate(m) {
    const map = this.map;
    const R = m.radius || CONFIG.missileRadius;
    const cx = map.x(m.to);
    const cy = map.y(m.to);
    const before = new Map(); // id → { tiles, troops } antes del impacto
    const lost = new Map();
    let walled = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        const t = map.index(x, y);
        const o = this.owner[t];
        if (!o || !this._isEnemy(m.owner, o)) continue;
        if (!before.has(o)) before.set(o, { tiles: this.players[o].tiles, troops: this.players[o].troops });
        lost.set(o, (lost.get(o) || 0) + 1);
        // Dentro de las murallas de su capital: mueren tropas, pero la casilla
        // y lo que hay en ella aguantan (doc-1.6)
        if (this.capitalZone(this.players[o], t) === 2) {
          walled++;
          continue;
        }
        this.setOwner(t, 0); // los edificios de esas casillas se destruyen
      }
    }
    for (const [o, n] of lost) {
      const v = this.players[o];
      const b = before.get(o);
      const density = b.troops / Math.max(1, b.tiles);
      v.troops = Math.max(0, v.troops - density * n * CONFIG.missileTroopLoss);
      v.lastConqueredBy = m.owner; // si muere por esto, el botín es del lanzador
    }
    // Barcos y buques enemigos alcanzados
    const W = map.width;
    const inBlast = (t) => {
      const dx = (t % W) - cx;
      const dy = ((t / W) | 0) - cy;
      return dx * dx + dy * dy <= (R + 1) * (R + 1);
    };
    for (const boat of this.boats) {
      if (!boat.done && this._isEnemy(m.owner, boat.owner) && inBlast(boat.path[boat.pos])) {
        boat.done = true;
        this.players[boat.owner].boatCount--;
      }
    }
    this.boats = this.boats.filter((b) => !b.done);
    for (const ws of this.warships) {
      if (!ws.dead && this._isEnemy(m.owner, ws.owner) && inBlast(ws.tile)) ws.hp -= 60;
      if (ws.hp <= 0) ws.dead = true;
    }
    this.effects.push({ kind: 'boom', x: cx + 0.5, y: cy + 0.5, r: R, tick: this.ticks });

    const attacker = this.players[m.owner];
    const total = [...lost.values()].reduce((a, b) => a + b, 0) - walled;
    if (attacker === this.human) this._emit(`💥 Impacto: ${total} casillas enemigas arrasadas${walled ? ` (las murallas de una capital aguantan ${walled})` : ''}`, 'good');
    const mine = this.human ? lost.get(this.human.id) : 0;
    if (mine) this._emit(`💥 Un misil de ${attacker.name} ha arrasado ${mine} casillas tuyas`, 'danger');
  }

  // -------------------------------------------------------- buques de guerra

  /** Puerto propio más cercano a `tile` (o null). */
  nearestPort(p, tile) {
    const map = this.map;
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== p.id || b.kind !== 'port' || !b.level) continue;
      const dx = map.x(b.tile) - map.x(tile);
      const dy = map.y(b.tile) - map.y(tile);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  _canBuildWarship(p, tile) {
    if (!p.active.port) return { ok: false, reason: p.buildings.port ? 'Tu puerto aún está en obras' : 'Necesitas un puerto para botar buques' };
    // 3 por puerto y 1 más por cada nivel extra de los puertos
    const cap = p.active.port * CONFIG.warshipsPerPort + (p.levels.port - p.active.port);
    if (p.buildings.warship >= cap) {
      return { ok: false, reason: `Máximo ${cap} buques: mejora o construye puertos` };
    }
    const cost = this.buildCost(p, 'warship');
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: un buque cuesta ${formatNumber(cost)}` };
    const map = this.map;
    const inMap = tile >= 0 && tile < map.size;
    // Clic en el mar: esa es su zona para siempre; sale del puerto propio más
    // cercano que dé a ese mismo mar. Clic en tierra: patrulla junto al puerto.
    const sea = inMap && map.terrain[tile] === 0 ? map.waterBody[tile] : -1;
    let port = null;
    if (sea >= 0) {
      let bestD = Infinity;
      for (const b of this.buildings) {
        if (b.owner !== p.id || b.kind !== 'port' || !b.level || b.water < 0 || map.waterBody[b.water] !== sea) continue;
        const d = (map.x(b.tile) - map.x(tile)) ** 2 + (map.y(b.tile) - map.y(tile)) ** 2;
        if (d < bestD) {
          bestD = d;
          port = b;
        }
      }
      if (!port) return { ok: false, reason: 'Ningún puerto tuyo da a ese mar' };
    } else port = this.nearestPort(p, inMap ? tile : p.spawnTile);
    const nb = NB_MISC;
    const c = map.neighbors(port.tile, nb);
    for (let k = 0; k < c; k++) {
      if (map.navigable(nb[k])) return { ok: true, reason: '', water: nb[k], zone: sea >= 0 ? tile : nb[k] };
    }
    return { ok: false, reason: 'Ese puerto no tiene agua al lado' };
  }

  /**
   * Bota un buque en `water` (junto a un puerto) con su zona de patrulla
   * `zone`: navega hasta allí y la vigila solo. La zona no se puede cambiar.
   */
  _launchWarship(p, water, zone = water) {
    p.buildings.warship++;
    p.stats.built++;
    const ws = {
      id: this._nextWarshipId++,
      owner: p.id,
      tile: water,
      hp: CONFIG.warshipHp,
      path: null,
      pos: 0,
      progress: 0,
      fireTick: -Infinity,
      fireAt: -1,
      patrol: water,
      nextPatrol: this.ticks + 10,
    };
    this.warships.push(ws);
    if (zone !== water) {
      const path = this._waterPath(water, zone);
      if (path) {
        ws.patrol = zone;
        ws.path = path;
      } else {
        this._notify(p, 'Tu buque no llega a esa zona: patrullará junto a su puerto', 'warn');
        return true;
      }
    }
    this._notify(p, zone !== water ? 'Buque botado: va a su zona y la patrullará siempre' : 'Buque botado: patrullará junto a su puerto', 'good');
    return true;
  }

  /** Ruta por el agua de `from` a `to` (búsqueda en anchura desde el destino). */
  /**
   * Camino por el agua de `from` a `to` (o null). A* con distancia Manhattan
   * algo inflada (×1,25): casi óptimo y explora muy pocas casillas. Las rutas
   * se guardan porque las de comercio entre puertos se repiten mucho.
   */
  _waterPath(from, to, maxNodes = SEARCH.warship, cache = true) {
    if (from === to) return null;
    const map = this.map;
    // Mares distintos: no hace falta buscar
    if (map.waterBody[from] !== map.waterBody[to]) return null;
    // El tope de búsqueda forma parte de la clave: «no hay ruta» con un tope
    // corto (comercio) no vale para una búsqueda más larga (buques), ni al revés
    const key = `${from},${to},${maxNodes}`;
    if (cache) {
      const cached = this._pathCache.get(key);
      if (cached !== undefined) return cached;
    }
    // Con tope de casillas exploradas: una ruta que da media vuelta al mundo
    // no merece congelar la partida (se da por imposible)
    // Primero la ruta gruesa (rejilla original) y luego la fina solo por su pasillo
    // (si la gruesa no llega, la fina tampoco: el agua gruesa incluye toda la fina)
    let path = null;
    if (this._coarseCorridor([from], (cell) => cell === this._cellOf(to), maxNodes / AREA)) {
      path = this._astarWater(from, to, maxNodes, true);
      // El pasillo es demasiado estrecho: uno más ancho y, si no, búsqueda fina acotada
      if (!path) {
        this._markCorridor(4);
        path = this._astarWater(from, to, maxNodes, true);
      }
      if (!path) path = this._astarWater(from, to, Math.min(maxNodes, 150000));
    }
    if (cache) {
      if (this._pathCache.size >= 3000) this._pathCache.clear();
      this._pathCache.set(key, path);
    }
    return path;
  }

  _astarWater(from, to, maxNodes, corridor = false) {
    const cg = this._cg;
    const W0 = this.map.width;
    const inCorridor = (t) => cg.mark[(((t / W0) | 0) / cg.k | 0) * cg.cw + (((t % W0) / cg.k) | 0)] === cg.markStamp;
    const map = this.map;
    const W = map.width;
    const terrain = map.terrain;
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const closed = this._closed;
    const parent = this._parent;
    const g = this._gcost;
    const heap = this._pathHeap;
    const nb = NB_BFS;
    const fx = from % W;
    const fy = (from / W) | 0;
    const h = (t) => (Math.abs((t % W) - fx) + Math.abs(((t / W) | 0) - fy)) * 1.25;
    // Se busca de `to` hacia `from` para que el camino salga ya en orden from → to
    heap.clear();
    seen[to] = stamp;
    parent[to] = -1;
    g[to] = 0;
    heap.push(h(to), to);
    let found = false;
    let expanded = 0;
    while (heap.size > 0 && expanded < maxNodes) {
      const t = heap.pop();
      if (closed[t] === stamp) continue;
      closed[t] = stamp;
      expanded++;
      if (t === from) {
        found = true;
        break;
      }
      const ng = g[t] + 1;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (terrain[n] !== 0 || closed[n] === stamp) continue;
        if (corridor && !inCorridor(n)) continue;
        if (seen[n] === stamp && g[n] <= ng) continue;
        seen[n] = stamp;
        g[n] = ng;
        parent[n] = t;
        heap.push(ng + h(n), n);
      }
    }
    if (!found) return null;
    const path = [];
    for (let t = from; t !== -1; t = parent[t]) path.push(t);
    return Int32Array.from(path);
  }

  /**
   * Rejilla gruesa del agua (una celda = RES×RES casillas, como la rejilla
   * original): con ella se buscan las rutas largas muy deprisa.
   */
  _coarse() {
    if (this._cg) return this._cg;
    const map = this.map;
    const W = map.width;
    const H = map.height;
    const k = RES;
    const cw = Math.ceil(W / k);
    const ch = Math.ceil(H / k);
    const n = cw * ch;
    const water = new Uint8Array(n);
    // Enlaces con la celda de la derecha (east) y la de abajo (south): solo si
    // el agua se toca de verdad en el borde entre las dos. Antes bastaba con
    // que las dos celdas tuvieran algo de agua, y con los ríos la ruta gruesa
    // saltaba de un río a otro por tierra (el Rin y el Danubio, por ejemplo):
    // la búsqueda fina fallaba y caía en la completa, la cara (tirones)
    const east = new Uint8Array(n);
    const south = new Uint8Array(n);
    const terrain = map.terrain;
    for (let y = 0; y < H; y++) {
      const cy = (y / k) | 0;
      const row = cy * cw;
      const lastRow = y % k === k - 1 && y < H - 1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (terrain[i] !== 0) continue;
        const c = row + ((x / k) | 0);
        water[c] = 1;
        if (x % k === k - 1 && x < W - 1 && terrain[i + 1] === 0) east[c] = 1;
        if (lastRow && terrain[i + W] === 0) south[c] = 1;
      }
    }
    this._cg = {
      k, cw, ch, water, east, south,
      seen: new Uint32Array(n), parent: new Int32Array(n), queue: new Int32Array(n), stamp: 0,
      mark: new Uint32Array(n), markStamp: 0, goal: new Uint32Array(n), goalStamp: 0,
    };
    return this._cg;
  }

  _cellOf(t) {
    const cg = this._coarse();
    const W = this.map.width;
    return (((t / W) | 0) / cg.k | 0) * cg.cw + (((t % W) / cg.k) | 0);
  }

  /**
   * Busca en la rejilla gruesa desde las casillas `starts` hasta una celda que
   * cumpla `isGoal`, y marca como pasillo esa ruta y su contorno. Devuelve si
   * la encontró (si no, o se pasó del tope o el mar no conecta).
   */
  _coarseCorridor(starts, isGoal, maxCells) {
    const cg = this._coarse();
    const { cw, ch, east, south, seen, parent, queue } = cg;
    cg.stamp = cg.stamp >= 0xfffffff0 ? (seen.fill(0), 1) : cg.stamp + 1;
    const st = cg.stamp;
    let head = 0;
    let tail = 0;
    for (const t of starts) {
      const c = this._cellOf(t);
      if (seen[c] === st) continue;
      seen[c] = st;
      parent[c] = -1;
      queue[tail++] = c;
    }
    let found = -1;
    while (head < tail) {
      if (tail > maxCells) return false;
      const c = queue[head++];
      if (isGoal(c)) {
        found = c;
        break;
      }
      const x = c % cw;
      const y = (c / cw) | 0;
      if (x > 0 && east[c - 1] && seen[c - 1] !== st) { seen[c - 1] = st; parent[c - 1] = c; queue[tail++] = c - 1; }
      if (x < cw - 1 && east[c] && seen[c + 1] !== st) { seen[c + 1] = st; parent[c + 1] = c; queue[tail++] = c + 1; }
      if (y > 0 && south[c - cw] && seen[c - cw] !== st) { seen[c - cw] = st; parent[c - cw] = c; queue[tail++] = c - cw; }
      if (y < ch - 1 && south[c] && seen[c + cw] !== st) { seen[c + cw] = st; parent[c + cw] = c; queue[tail++] = c + cw; }
    }
    if (found < 0) return false;
    // Pasillo: la ruta y sus 8 vecinas (la ruta se guarda para ensancharlo)
    const route = (cg.route ??= []);
    route.length = 0;
    for (let c = found; c !== -1; c = parent[c]) route.push(c);
    this._markCorridor(1);
    return true;
  }

  /**
   * Marca como pasillo la última ruta gruesa y las celdas a `r` de ella. Si
   * la búsqueda fina no cabe en el de radio 1, se prueba uno de radio 4 antes
   * de recorrer el mar entero (eso daba tirones de decenas de ms).
   */
  _markCorridor(r) {
    const cg = this._cg;
    const { cw, ch, mark } = cg;
    cg.markStamp = cg.markStamp >= 0xfffffff0 ? (mark.fill(0), 1) : cg.markStamp + 1;
    const ms = cg.markStamp;
    for (const c of cg.route) {
      const x = c % cw;
      const y = (c / cw) | 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ch) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < cw) mark[yy * cw + xx] = ms;
        }
      }
    }
  }

  /** ¿Son enemigos? (ni la misma nación, ni aliados, ni con un pacto o paz en vigor) */
  _isEnemy(a, b) {
    return a !== b && !this.isAllied(a, b) && !this.pactBetween(a, b);
  }

  /**
   * Buques de guerra autónomos. Cada uno patrulla una zona (al botarlo, la de
   * su puerto; el jugador puede asignarle otra). Por sí solo: dispara a los
   * buques enemigos, hunde los transportes de tropas y captura pesqueros y
   * mercantes; persigue a los intrusos que entren en su zona y, si no hay
   * nadie, navega de un punto a otro de ella. No ataca puertos.
   */
  _updateWarships() {
    if (!this.warships.length) return;
    const map = this.map;
    const r2 = CONFIG.warshipRange * CONFIG.warshipRange;
    const guard2 = CONFIG.warshipGuard * CONFIG.warshipGuard;
    const W = map.width;
    for (const ws of this.warships) {
      if (ws.dead) continue;
      if (!this.players[ws.owner].alive) {
        ws.dead = true;
        continue;
      }
      // Movimiento
      if (ws.path) {
        ws.progress += CONFIG.warshipSpeed;
        while (ws.progress >= 1 && ws.pos < ws.path.length - 1) {
          ws.pos++;
          ws.progress -= 1;
        }
        ws.tile = ws.path[ws.pos];
        if (ws.pos >= ws.path.length - 1) ws.path = null;
      }
      const x = ws.tile % W;
      const y = (ws.tile / W) | 0;
      const dist2 = (t) => {
        const dx = (t % W) - x;
        const dy = ((t / W) | 0) - y;
        return dx * dx + dy * dy;
      };
      // Objetivo a tiro: buques enemigos, luego transportes, luego barcos civiles
      let target = null;
      let kind = '';
      let best = r2 + 1;
      for (const other of this.warships) {
        if (other.dead || !this._isEnemy(ws.owner, other.owner)) continue;
        const d = dist2(other.tile);
        if (d < best) [best, target, kind] = [d, other, 'warship'];
      }
      if (!target) {
        for (const b of this.boats) {
          if (b.done || !this._isEnemy(ws.owner, b.owner)) continue;
          const d = dist2(b.path[b.pos]);
          if (d < best) [best, target, kind] = [d, b, 'boat'];
        }
      }
      if (!target) {
        // Barcos automáticos: se capturan, no se hunden
        for (const m of this.merchants) {
          if (m.done || !this._isEnemy(ws.owner, m.owner)) continue;
          const d = dist2(m.tile);
          if (d < best) [best, target, kind] = [d, m, 'merchant'];
        }
      }
      if (!target) {
        this._patrolWarship(ws, guard2);
        continue;
      }
      if (kind === 'merchant') {
        this._captureMerchant(ws, target);
        continue;
      }
      ws.fireTick = this.ticks;
      ws.fireAt = kind === 'boat' ? target.path[target.pos] : target.tile;
      const me = this.players[ws.owner];
      if (kind === 'warship') {
        target.hp -= CONFIG.warshipDamage;
        if (target.hp <= 0) {
          target.dead = true;
          me.stats.sunk++;
          const victim = this.players[target.owner];
          if (me === this.human) this._emit(`Has hundido un buque de ${victim.name}`, 'good', { sfx: 'sink' });
          else if (victim === this.human) this._emit(`${me.name} ha hundido uno de tus buques`, 'danger');
        }
      } else {
        target.done = true;
        const victim = this.players[target.owner];
        victim.boatCount--;
        me.stats.sunk++;
        if (me === this.human) this._emit(`Has hundido un barco de ${victim.name} con ${fmtTroops(target.troops)} tropas`, 'good', { sfx: 'sink' });
        else if (victim === this.human) this._emit(`${me.name} ha hundido tu barco (${fmtTroops(target.troops)} tropas)`, 'danger');
      }
    }
    // Hundidos y buques de naciones eliminadas
    if (this.warships.some((w) => w.dead)) {
      for (const w of this.warships) if (w.dead) this.players[w.owner].buildings.warship--;
      this.warships = this.warships.filter((w) => !w.dead);
    }
    this.boats = this.boats.filter((b) => !b.done);
  }

  /** Sin nadie a tiro: persigue intrusos de su zona o la recorre. */
  _patrolWarship(ws, guard2) {
    if (this.ticks < (ws.nextPatrol || 0)) return;
    const map = this.map;
    const W = map.width;
    const cx = map.x(ws.patrol);
    const cy = map.y(ws.patrol);
    // ¿Algún intruso (buque, transporte o barco civil enemigo) dentro de su zona?
    let prey = -1;
    let best = guard2;
    const consider = (t, owner) => {
      if (!this._isEnemy(ws.owner, owner) || map.waterBody[t] !== map.waterBody[ws.tile]) return;
      const dx = (t % W) - cx;
      const dy = ((t / W) | 0) - cy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        prey = t;
      }
    };
    for (const o of this.warships) if (!o.dead) consider(o.tile, o.owner);
    for (const b of this.boats) if (!b.done) consider(b.path[b.pos], b.owner);
    for (const m of this.merchants) if (!m.done) consider(m.tile, m.owner);
    if (prey >= 0) {
      ws.nextPatrol = this.ticks + 15; // vuelve a apuntar a menudo: el intruso se mueve
      const path = this._waterPath(ws.tile, prey, SEARCH.fish, false);
      if (path) {
        ws.path = path;
        ws.pos = 0;
        ws.progress = 0;
      }
      return;
    }
    if (ws.path) return;
    ws.nextPatrol = this.ticks + this.rng.int(20, 60);
    // Fuera de su zona: vuelve; dentro: va a otro punto de ella
    const dx = map.x(ws.tile) - cx;
    const dy = map.y(ws.tile) - cy;
    const R = CONFIG.warshipPatrol;
    let path = null;
    if (dx * dx + dy * dy > R * R) path = this._waterPath(ws.tile, ws.patrol, SEARCH.warship, false);
    else path = this._wanderPath(ws.tile, cx, cy, R);
    if (path) {
      ws.path = path;
      ws.pos = 0;
      ws.progress = 0;
    }
  }

  /**
   * Camino corto por el agua desde `from` hasta un punto al azar a menos de
   * R casillas de (cx, cy); si no lo hay, al que más se acerque. Búsqueda en
   * anchura acotada: barata y nunca se pierde.
   */
  _wanderPath(from, cx, cy, R) {
    const map = this.map;
    const W = map.width;
    const terrain = map.terrain;
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const parent = this._parent;
    const depth = this._gcost;
    const queue = this._queue;
    const nb = NB_BFS;
    let head = 0;
    let tail = 0;
    queue[tail++] = from;
    seen[from] = stamp;
    parent[from] = -1;
    depth[from] = 0;
    const near = [];
    let closest = -1;
    let closestD = Infinity;
    while (head < tail) {
      const t = queue[head++];
      const d = depth[t];
      if (d >= R / 3) {
        const dx = (t % W) - cx;
        const dy = ((t / W) | 0) - cy;
        const dh = dx * dx + dy * dy;
        if (dh <= R * R) near.push(t);
        if (dh < closestD) {
          closestD = dh;
          closest = t;
        }
      }
      if (d >= R) continue;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (terrain[n] !== 0 || seen[n] === stamp) continue;
        seen[n] = stamp;
        parent[n] = t;
        depth[n] = d + 1;
        queue[tail++] = n;
      }
    }
    const goal = near.length ? near[this.rng.int(0, near.length - 1)] : closest;
    if (goal < 0) return null;
    const back = [];
    for (let t = goal; t !== -1; t = parent[t]) back.push(t);
    back.reverse();
    return back.length >= 2 ? Int32Array.from(back) : null;
  }

  // ------------------------------------------------------------------ barcos

  launchBoat(p, tile, troops, { deduct = true } = {}) {
    if (!this.rules.boats) {
      this._notify(p, 'Los desembarcos están desactivados en esta partida', 'warn');
      return false;
    }
    // Sin un puerto terminado no hay barcos (salen de cualquier costa tuya)
    if (!p.active.port) {
      this._notify(p, 'Necesitas un puerto para mandar barcos', 'warn');
      return false;
    }
    if (tile >= 0 && tile < this.map.size && this._truceBlocks(p, this.players[this.owner[tile]])) return false;
    if (p.boatCount >= p.maxBoats()) {
      this._notify(p, `Ya tienes ${p.maxBoats()} barcos en el mar`, 'warn');
      return false;
    }
    if (deduct) troops = Math.min(troops, Math.floor(p.troops));
    if (troops < 1) return false;
    if (this.isAllied(p.id, this.owner[tile])) return false;
    const dest = this._findLandingTile(tile);
    if (dest < 0) {
      this._notify(p, 'No hay frontera ni costa a la que llegar', 'warn');
      return false;
    }
    const path = this._findSeaPath(p.id, dest);
    if (!path) {
      this._notify(p, 'No hay frontera ni ruta marítima hasta allí', 'warn');
      return false;
    }
    if (deduct) p.troops -= troops;
    p.boatCount++;
    const targetId = this.owner[dest];
    this.boats.push({
      id: this._nextBoatId++,
      owner: p.id,
      troops,
      path,
      pos: 0,
      progress: 0,
      dest,
      targetId,
      done: false,
    });
    const target = targetId ? this.players[targetId] : null;
    if (target && target === this.human) this._emit(`🚢 ${p.name} envía un barco con ${fmtTroops(troops)} tropas contra ti`, 'danger');
    else if (p === this.human) this._emit(`🚢 Barco en camino con ${fmtTroops(troops)} tropas`, 'info');
    return true;
  }

  _nextStamp() {
    if (this._stamp >= 0xfffffff0) {
      this._stampArr.fill(0);
      this._closed.fill(0);
      this._stamp = 0;
    }
    return ++this._stamp;
  }

  /** Casilla costera del mismo dueño más cercana a `tile` (por tierra). */
  _findLandingTile(tile) {
    const map = this.map;
    if (map.coastal[tile]) return tile;
    const o = this.owner[tile];
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const queue = this._queue;
    const nb = NB_BFS;
    let head = 0;
    let tail = 0;
    queue[tail++] = tile;
    seen[tile] = stamp;
    while (head < tail && head < 20000 * AREA) {
      const t = queue[head++];
      if (map.coastal[t]) return t;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (seen[n] === stamp || !map.isLand(n) || this.owner[n] !== o) continue;
        seen[n] = stamp;
        queue[tail++] = n;
      }
    }
    return -1;
  }

  /**
   * Búsqueda en anchura por el agua desde la costa de destino hasta cualquier
   * casilla de agua que toque tierra del jugador. Devuelve la ruta en orden de
   * navegación (origen → destino).
   */
  _findSeaPath(pid, dest) {
    const map = this.map;
    const terrain = map.terrain;
    // Celdas gruesas con agua junto a la costa propia = meta de la ruta gruesa
    const cg = this._coarse();
    cg.goalStamp = cg.goalStamp >= 0xfffffff0 ? (cg.goal.fill(0), 1) : cg.goalStamp + 1;
    const gs = cg.goalStamp;
    const p = this.players[pid];
    const nb0 = NB_MISC;
    for (const t of p.border) {
      if (!map.coastal[t]) continue;
      const c0 = map.neighbors(t, nb0);
      for (let k = 0; k < c0; k++) if (map.navigable(nb0[k])) cg.goal[this._cellOf(nb0[k])] = gs;
    }
    // Solo por agua navegable: un río que no llega al mar no se navega
    const starts = [];
    const c1 = map.neighbors(dest, nb0);
    for (let k = 0; k < c1; k++) if (map.navigable(nb0[k])) starts.push(nb0[k]);
    if (!starts.length) return null;
    if (!this._coarseCorridor(starts, (cell) => cg.goal[cell] === gs, SEARCH.landing / AREA)) return null;
    const W0 = map.width;
    const inCorridor = (t) => cg.mark[(((t / W0) | 0) / cg.k | 0) * cg.cw + (((t % W0) / cg.k) | 0)] === cg.markStamp;
    const seen = this._stampArr;
    const parent = this._parent;
    const queue = this._queue;
    const nb = NB_BFS;
    // Tope de búsqueda: un desembarco no cruza medio planeta (y no congela la partida)
    const cap = SEARCH.landing;
    let found = -1;
    // Primero solo por el pasillo de la ruta gruesa. Si no llega (un estrecho
    // como Ormuz: la ruta gruesa cruza la península por celdas con algo de
    // agua y el pasillo no incluye el canal de verdad), otra vez sin pasillo
    // Pasillo de radio 1, luego de radio 4 y, solo si tampoco, sin pasillo
    for (const widen of [1, 4, 0]) {
      const restrict = widen > 0;
      if (widen > 1) this._markCorridor(widen);
      const stamp = this._nextStamp();
      let head = 0;
      let tail = 0;
      let c = map.neighbors(dest, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (!map.navigable(n) || seen[n] === stamp) continue;
        seen[n] = stamp;
        parent[n] = -1;
        queue[tail++] = n;
      }
      while (head < tail && tail < (restrict ? cap : cap / 3)) {
        const w = queue[head++];
        c = map.neighbors(w, nb);
        for (let k = 0; k < c; k++) {
          const n = nb[k];
          if (terrain[n] !== 0 && this.owner[n] === pid) {
            found = w;
            break;
          }
        }
        if (found >= 0) break;
        for (let k = 0; k < c; k++) {
          const n = nb[k];
          if (terrain[n] !== 0 || seen[n] === stamp || (restrict && !inCorridor(n))) continue;
          seen[n] = stamp;
          parent[n] = w;
          queue[tail++] = n;
        }
      }
      if (found >= 0) break;
    }
    if (found < 0) return null;
    const path = [];
    for (let t = found; t !== -1; t = parent[t]) path.push(t);
    return Int32Array.from(path);
  }

  _updateBoats() {
    if (!this.boats.length) return;
    for (const boat of this.boats) {
      const p = this.players[boat.owner];
      if (!p.alive) {
        boat.done = true;
        continue;
      }
      boat.progress += CONFIG.boatSpeed * (1 + p.mods.boatSpeed);
      while (boat.progress >= 1 && boat.pos < boat.path.length - 1) {
        boat.pos++;
        boat.progress -= 1;
      }
      if (boat.pos >= boat.path.length - 1) this._landBoat(boat, p);
    }
    this.boats = this.boats.filter((b) => !b.done);
  }

  _landBoat(boat, p) {
    boat.done = true;
    p.boatCount--;
    const dest = boat.dest;
    const o = this.owner[dest];
    if (o === p.id || this.isAllied(p.id, o)) {
      // Llega a casa o a un aliado (la alianza se firmó durante el viaje)
      p.troops += boat.troops;
      return;
    }
    const target = o ? this.players[o] : null;
    // Un pacto o la tregua firmados durante el viaje: no desembarca y las tropas vuelven
    if (target && this._truceBlocks(p, target)) {
      p.troops += boat.troops;
      return;
    }
    // La casilla de desembarco se toma como cualquier otra (documento, 05)
    const c = this.conquestCost(dest, target, boat.troops, 1, p);
    if (boat.troops <= c.loss) {
      if (target) target.troops = Math.max(0, target.troops - boat.troops * 0.5);
      this._notify(p, 'Desembarco rechazado', 'warn');
      return;
    }
    boat.troops -= c.loss;
    if (target) target.troops = Math.max(0, target.troops - c.defLoss);
    this.setOwner(dest, p.id);
    p.stats.landings++;
    if (!this.launchAttack(p, o, boat.troops, { deduct: false })) p.troops += boat.troops;
    if (p === this.human) this._emit('Desembarco con éxito', 'good', { sfx: 'land' });
  }

  // -------------------------------------------------------------------- tick

  /** Casillas medias de las naciones vivas (para frenar a las colonias), cada segundo. */
  _updateNationAverage() {
    let n = 0;
    let sum = 0;
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || p.weak) continue;
      n++;
      sum += p.tiles;
    }
    this.nationAvgTiles = n ? sum / n : 0;
  }

  tick() {
    if (this.phase === 'ended') return;
    this.ticks++;
    this._applyIntents();

    if (this.phase === 'spawn') {
      if (this.ticks >= CONFIG.spawnTicks) this._beginPlaying();
      return;
    }

    // Orden del tick (documento, 06.3): 1) órdenes (arriba); 2) oro pasivo;
    // 3) límites (el techo se calcula al momento con el territorio y las
    // ciudades terminadas); 4) tropas, con acumulador decimal; 5) ataques en
    // orden estable con su presupuesto y costes; 6) cercos y eliminaciones;
    // después, obras, barcos, comercio, misiles y trenes (oro de eventos)
    if (this.ticks % 10 === 0) this._updateNationAverage();
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      const gb = p.goldBreakdown();
      p.gold += gb.base + gb.tax + gb.villages + gb.workers + gb.bonus;
      p.income.base += gb.base;
      p.income.tax += gb.tax;
      p.income.villages += gb.villages;
      p.income.workers += gb.workers;
      p.income.bonus += gb.bonus;
      this._growPopulation(p);
      if (p.capital) this._bankRecruit(p);
      if (p.research && this.ticks >= p.research.end) this._finishResearch(p);
      if (p.gold > p.stats.maxGold) p.stats.maxGold = p.gold;
    }

    // Cupo de cercos del turno, repartido en turno rotatorio: si siempre
    // empezaba el mismo ataque, las bolsas de los demás podían no
    // comprobarse nunca
    this._annexBudget = ANNEX_VISITS_PER_TICK;
    const na = this.attacks.length;
    const first = na ? this.ticks % na : 0;
    for (let k = 0; k < na; k++) this._processAttack(this.attacks[(first + k) % na]);
    this.attacks = this.attacks.filter((a) => !a.done);

    this._updateSites();
    this._updateBoats();
    this._updateMerchants();
    this._updateWarships();
    this._updateMissiles();
    this._updateTrains();
    if (this.effects.length && this.effects[0].tick < this.ticks - 30) {
      this.effects = this.effects.filter((e) => e.tick >= this.ticks - 30);
    }
    this._processRequests();
    if (this.emojis.length && this.emojis[0].tick < this.ticks - CONFIG.emojiTicks) {
      this.emojis = this.emojis.filter((e) => e.tick >= this.ticks - CONFIG.emojiTicks);
    }

    for (const bot of this.bots) {
      if (!bot.player.alive || this.ticks < bot.nextThink) continue;
      bot.think();
      bot.nextThink = this.ticks + Math.round(this.rng.int(CONFIG.botThinkMin, CONFIG.botThinkMax) * bot.thinkScale);
    }

    this._checkEliminations();
    if (this._capitalMoves.length) this._relocateCapitals();
    if (this._buffed.size) this._expireBuffs();
    if (this._lugarRespawns.length && this._lugarRespawns[0] <= this.ticks) {
      this._lugarRespawns.shift();
      // Sin sitio ahora: se vuelve a probar dentro de 30 s
      if (!this._spawnLugar()) this._queueLugar(this.ticks + 300);
    }
    this._checkVictory();
    this._flushBuildingNews();
    if (this.trace) this.trace.onTick(this);
  }

  _beginPlaying() {
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.spawned) continue;
      const t = this.findSpawnTile();
      if (t >= 0) this.spawnPlayer(p, t);
      else p.alive = false;
    }
    this.phase = 'playing';
    this._foundCapitals();
    this._placeCapitals();
    this._placeLugares();
    for (const bot of this.bots) bot.nextThink = this.ticks + this.rng.int(1, CONFIG.botThinkMax);
    this._emit('¡Comienza la conquista!', 'good', { sfx: 'start' });
  }

  _checkEliminations() {
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || p.tiles > 0) continue;
      p.alive = false;
      p.eliminatedTick = this.ticks;
      p.troops = 0;
      p.workers = 0;
      // Botín: el oro del eliminado y una recompensa pasan a quien le quitó la
      // última casilla (con su lluvia de monedas allí donde cayó)
      const killer = this.players[p.lastConqueredBy];
      let loot = 0;
      const lt = p.lastTile;
      const lx = lt >= 0 ? this.map.x(lt) + 0.5 : 0;
      const ly = lt >= 0 ? this.map.y(lt) + 0.5 : 0;
      if (killer && killer.alive) {
        killer.stats.kills++;
        // Documento (04.1, 05.3): quien conquista por completo a un rival se queda con todo su oro
        loot = Math.max(0, p.gold);
        killer.gold += loot;
        killer.income.loot += loot;
        if (lt >= 0) this.effects.push({ kind: 'loot', x: lx, y: ly, gold: loot, owner: killer.id, weak: p.weak, tick: this.ticks });
      }
      p.gold = 0;
      for (const atk of [...p.attacks.values()]) this._endAttack(atk);
      for (const id of p.allies) this.players[id].allies.delete(p.id);
      if (p.allies.size) this.diploVersion++;
      p.allies.clear();
      this.requests = this.requests.filter((r) => r.from !== p.id && r.to !== p.id);
      for (const b of this.boats) if (b.owner === p.id) b.done = true;
      this.boats = this.boats.filter((b) => !b.done);
      p.boatCount = 0;
      if (p === this.human) this._emit('Has sido derrotado', 'danger');
      else if (killer && killer === this.human) {
        this._emit(`🏆 Has conquistado ${p.name}: +${formatNumber(loot)} de oro`, 'good', { sfx: p.weak ? 'conquerColony' : 'conquer', loot, x: lx, y: ly, weak: p.weak });
      } else {
        // `bot`: la muerte de un bot no va al recuadro de avisos (solo la de jugadores)
        this._emit(`${p.name} ha sido eliminado`, 'info', { bot: !p.isHuman, ...(p.weak ? null : { sfx: 'fall' }) });
      }
    }
  }

  /** Oro ingresado por minuto (todas las fuentes), medido sobre el último minuto. */
  incomePerMin(p) {
    const h = p.incomeHist;
    if (!h || h.length < 2) return 0;
    return ((h[h.length - 1] - h[0]) * 6) / (h.length - 1);
  }

  _totalIncome(p) {
    const i = p.income;
    return i.base + i.bonus + i.workers + i.trade + i.conquest + i.loot + i.gifts;
  }

  /** Puntuación de supervivencia: territorio, eliminaciones y oro ganado. */
  survivalScore(p) {
    if (!p.alive) return 0;
    return Math.round((p.tiles / this.map.landCount) * 1000 + p.stats.kills * 20 + this._totalIncome(p) / 20000);
  }

  /** Minutos de partida de la regla de tiempo (supervivencia sin límite: 20). */
  _timeLimitMin() {
    if (this.rules.timeLimitMin > 0) return this.rules.timeLimitMin;
    return this.rules.victory === 'supervivencia' ? CONFIG.survivalDefaultMin : 0;
  }

  /** Estado del objetivo de la partida, para la barra superior. */
  victoryStatus() {
    const mode = this.rules.victory;
    const alive = this.alivePlayers();
    if (mode === 'capitales') {
      const caps = this.points.filter((pt) => pt.kind === 'capital');
      const need = Math.max(1, Math.ceil(caps.length * CONFIG.capitalShare));
      let best = null;
      let bestN = -1;
      for (const p of alive) {
        const n = caps.filter((pt) => this.owner[pt.tile] === p.id).length;
        if (n > bestN) {
          bestN = n;
          best = p;
        }
      }
      return { mode, leader: best, value: bestN, goal: need };
    }
    if (mode === 'economia') {
      let best = null;
      let bestV = -1;
      for (const p of alive) {
        const v = this.incomePerMin(p);
        if (v > bestV) {
          bestV = v;
          best = p;
        }
      }
      return { mode, leader: best, value: bestV, goal: CONFIG.economyGoalPerMin };
    }
    if (mode === 'supervivencia') {
      let best = null;
      let bestV = -1;
      for (const p of alive) {
        const v = this.survivalScore(p);
        if (v > bestV) {
          bestV = v;
          best = p;
        }
      }
      return { mode, leader: best, value: bestV, goal: 0 };
    }
    const leader = this.leader();
    return { mode: 'dominio', leader, value: leader ? leader.tiles / this.map.landCount : 0, goal: this.rules.winShare };
  }

  _win(p, text, reason) {
    this.winner = p;
    this.winReason = reason;
    this.phase = 'ended';
    this._emit(p === this.human ? `¡Victoria! ${text}` : `${p.name}: ${text.toLowerCase()}`, p === this.human ? 'good' : 'danger');
  }

  /** Capitales que controla cada nación (id → número) y cuántas hacen falta. */
  _capitalCounts() {
    const counts = new Map();
    let total = 0;
    for (const pt of this.points) {
      if (pt.kind !== 'capital') continue;
      total++;
      const o = this.owner[pt.tile];
      if (o) counts.set(o, (counts.get(o) || 0) + 1);
    }
    return { counts, need: Math.max(1, Math.ceil(total * CONFIG.capitalShare)) };
  }

  /**
   * Victorias de capitales y de economía: hay que sostener el objetivo un
   * tiempo. Cada nación que lo cumple lleva su propio plazo (si dos se turnan
   * el primer puesto, ninguna pierde lo aguantado); gana la que antes llegue
   * al final. `goalHolder` es la más cercana a ganar (para la barra superior).
   */
  _checkAltVictory() {
    const mode = this.rules.victory;
    if (mode !== 'capitales' && mode !== 'economia') return false;
    const hold = mode === 'capitales' ? CONFIG.capitalHoldTicks : CONFIG.economyHoldTicks;
    const caps = mode === 'capitales' ? this._capitalCounts() : null;
    const goal = caps ? caps.need : CONFIG.economyGoalPerMin;
    const holders = this.goalHolders;
    let best = null;
    for (const p of this.alivePlayers()) {
      const value = caps ? caps.counts.get(p.id) || 0 : this.incomePerMin(p);
      if (value < goal) {
        holders.delete(p.id);
        continue;
      }
      if (!holders.has(p.id)) {
        holders.set(p.id, this.ticks);
        // Un aviso por nación como mucho cada minuto (aunque entre y salga del objetivo)
        const last = this._goalAnnounced.get(p.id);
        if (last === undefined || this.ticks - last >= 600) {
          this._goalAnnounced.set(p.id, this.ticks);
          if (p === this.human) this._emit(caps ? `⭐ Controlas ${value} capitales: aguanta ${hold / 10} s para ganar` : `💰 Tus ingresos alcanzan el objetivo: aguanta ${hold / 600} min para ganar`, 'good');
          else this._emit(caps ? `⭐ ${p.name} controla ${value} capitales: si aguanta ${hold / 10} s, gana` : `💰 ${p.name} alcanza la supremacía económica: si la mantiene ${hold / 600} min, gana`, 'danger');
        }
      }
      const since = holders.get(p.id);
      if (!best || since < best.since) best = { id: p.id, since };
    }
    // Quien ya no está vivo deja de contar
    for (const id of [...holders.keys()]) if (!this.players[id] || !this.players[id].alive) holders.delete(id);
    this.goalHolder = best;
    if (best && this.ticks - best.since >= hold) {
      this._win(this.players[best.id], caps ? 'Controlas las capitales del mundo' : 'Supremacía económica', mode);
      return true;
    }
    return false;
  }

  /**
   * Quién va en cabeza al acabar el tiempo, según el objetivo de la partida:
   * capitales, ingresos o territorio (y, a igualdad, territorio y luego id).
   */
  _timeLimitWinner() {
    const mode = this.rules.victory;
    const caps = mode === 'capitales' ? this._capitalCounts().counts : null;
    const key = (p) => (caps ? caps.get(p.id) || 0 : mode === 'economia' ? this.incomePerMin(p) : p.tiles);
    return this.alivePlayers().sort((a, b) => key(b) - key(a) || b.tiles - a.tiles || a.id - b.id)[0] || null;
  }

  _checkVictory() {
    // Ingresos del último minuto (cada 10 s se guarda el total acumulado)
    if (this.ticks % 100 === 0) {
      for (let i = 1; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.alive) continue;
        p.incomeHist.push(this._totalIncome(p));
        if (p.incomeHist.length > 7) p.incomeHist.shift();
      }
    }
    if (this._checkAltVictory()) return;
    // Supervivencia: al acabar el tiempo gana la mejor puntuación entre los vivos
    const limit = this._timeLimitMin();
    if (this.rules.victory === 'supervivencia' && this.ticks >= CONFIG.spawnTicks + limit * 600) {
      const st = this.victoryStatus();
      if (st.leader) {
        this._win(st.leader, `Has sobrevivido con la mejor puntuación (${st.value})`, 'supervivencia');
        return;
      }
    }
    // Límite de tiempo (regla): al acabar, gana quien vaya en cabeza según el
    // objetivo de la partida (territorio, capitales o ingresos)
    if (this.rules.victory !== 'supervivencia' && this.rules.timeLimitMin > 0 && this.ticks >= CONFIG.spawnTicks + this.rules.timeLimitMin * 600) {
      const best = this._timeLimitWinner();
      if (best) {
        this.winner = best;
        this.winReason = 'tiempo';
        this.phase = 'ended';
        this._emit(best === this.human ? '¡Se acabó el tiempo y vas en cabeza: victoria!' : `Se acabó el tiempo: ${best.name} va en cabeza`, best === this.human ? 'good' : 'danger');
        return;
      }
    }
    const need = this.map.landCount * this.rules.winShare;
    let alive = 0;
    let last = null;
    let winner = null;
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      alive++;
      last = p;
      if (p.tiles >= need) winner = p;
    }
    if (!winner && alive === 1 && this.players.length > 2) winner = last;
    if (winner) {
      this.winner = winner;
      this.winReason = winner.tiles >= need ? 'dominio' : 'ultimo';
      this.phase = 'ended';
      this._emit(winner === this.human ? '¡Victoria! Dominas el mundo' : `${winner.name} domina el mundo`, winner === this.human ? 'good' : 'danger');
      return;
    }
    // Si solo quedan naciones aliadas entre sí, gana la alianza
    if (alive > 1) {
      const rest = this.alivePlayers();
      const allAllied = rest.every((a) => rest.every((b) => a === b || a.allies.has(b.id)));
      if (allAllied) {
        rest.sort((a, b) => b.tiles - a.tiles);
        this.winner = rest[0];
        this.winningAlliance = rest;
        this.winReason = 'alianza';
        this.phase = 'ended';
        const human = rest.find((p) => p === this.human);
        this._emit(
          human ? '¡Victoria en alianza!' : `La alianza de ${rest.map((p) => p.name).join(', ')} domina el mundo`,
          human ? 'good' : 'danger',
        );
      }
    }
  }

  // -------------------------------------------------------------- diplomacia

  isAllied(a, b) {
    if (!a || !b || a === b) return false;
    const p = this.players[a];
    return !!p && p.allies.has(b);
  }

  isTraitor(p) {
    return p.traitorUntil > this.ticks;
  }

  /** Nación con más territorio. */
  leader() {
    let best = null;
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.alive && (!best || p.tiles > best.tiles)) best = p;
    }
    return best;
  }

  pendingRequest(fromId, toId) {
    return this.requests.find((r) => r.from === fromId && r.to === toId) || null;
  }

  /** ¿Puede `p` proponer alianza a `target` ahora mismo? Si no, explica por qué. */
  canPropose(p, target) {
    if (!this.rules.alliances) return { ok: false, reason: 'Las alianzas están desactivadas en esta partida' };
    if (!target || target === p || !target.alive) return { ok: false, reason: 'No disponible' };
    if (target.weak || p.weak) return { ok: false, reason: 'Las colonias no firman alianzas' };
    if (p.allies.has(target.id)) return { ok: false, reason: 'Ya sois aliados' };
    if (this.pendingRequest(p.id, target.id)) return { ok: false, reason: 'Propuesta enviada' };
    if (p.allies.size >= CONFIG.maxAllies) return { ok: false, reason: `Máximo ${CONFIG.maxAllies} aliados` };
    if (target.allies.size >= CONFIG.maxAllies) return { ok: false, reason: `${target.name} ya tiene ${CONFIG.maxAllies} aliados` };
    const wait = (p.requestCooldown.get(target.id) || 0) - this.ticks;
    if (wait > 0) return { ok: false, reason: `Rechazada hace poco (espera ${Math.ceil(wait / 10)} s)` };
    return { ok: true, reason: '' };
  }

  proposeAlliance(p, target) {
    const check = this.canPropose(p, target);
    if (!check.ok) {
      this._notify(p, check.reason, 'warn');
      return false;
    }
    // Si el otro ya nos lo había propuesto, se firma directamente
    if (this.pendingRequest(target.id, p.id)) return this._formAlliance(p, target);
    const req = {
      from: p.id,
      to: target.id,
      expires: this.ticks + CONFIG.allianceRequestTicks,
      decideAt: target.isHuman ? Infinity : this.ticks + this.rng.int(10, 40),
    };
    this.requests.push(req);
    if (target === this.human) {
      this._emit(`🤝 ${p.name} te propone una alianza`, 'request', { fromId: p.id });
    } else if (p === this.human) {
      this._emit(`Propuesta de alianza enviada a ${target.name}`, 'info');
    }
    return true;
  }

  respondAlliance(p, from, accept) {
    if (!from) return false;
    const req = this.pendingRequest(from.id, p.id);
    if (!req) return false;
    this.requests = this.requests.filter((r) => r !== req);
    if (accept && from.alive && p.alive && p.allies.size < CONFIG.maxAllies && from.allies.size < CONFIG.maxAllies) {
      return this._formAlliance(p, from);
    }
    from.requestCooldown.set(p.id, this.ticks + CONFIG.rejectCooldownTicks);
    if (from === this.human) this._emit(`${p.name} rechaza tu alianza`, 'warn');
    this.brains.get(from.id)?.onRejected(p);
    return false;
  }

  _formAlliance(a, b) {
    a.allies.add(b.id);
    b.allies.add(a.id);
    a.stats.alliances++;
    b.stats.alliances++;
    this.requests = this.requests.filter((r) => !((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)));
    // La paz detiene los ataques entre ambos y devuelve las tropas
    const ab = a.attacks.get(b.id);
    if (ab) this._endAttack(ab);
    const ba = b.attacks.get(a.id);
    if (ba) this._endAttack(ba);
    this.diploVersion++;
    const human = a === this.human ? a : b === this.human ? b : null;
    if (human) {
      const other = human === a ? b : a;
      this._emit(`🤝 Alianza firmada con ${other.name}`, 'good', { sfx: 'alliance' });
    } else if (this._isNotable(a) || this._isNotable(b)) {
      this._emit(`🤝 ${a.name} y ${b.name} forman una alianza`, 'info');
    }
    this.brains.get(a.id)?.onAllied(b);
    this.brains.get(b.id)?.onAllied(a);
    return true;
  }

  breakAlliance(p, other) {
    if (!other || !p.allies.has(other.id)) return false;
    p.allies.delete(other.id);
    other.allies.delete(p.id);
    p.traitorUntil = this.ticks + CONFIG.traitorTicks;
    p.betrayals++;
    this.diploVersion++;
    if (p === this.human) this._emit(`Has roto la alianza con ${other.name}. Eres traidor durante ${CONFIG.traitorTicks / 10} s`, 'warn');
    else if (other === this.human) this._emit(`💔 ${p.name} ha roto vuestra alianza`, 'danger', { sfx: 'betray' });
    else this._emit(`💔 ${p.name} traiciona a ${other.name}`, 'info');
    this.brains.get(other.id)?.onBetrayed(p);
    return true;
  }

  /** Envía una fracción de tropas u oro a un aliado. */
  donate(p, target, resource, ratio) {
    if (!target || !p.allies.has(target.id) || !target.alive) {
      this._notify(p, 'Solo puedes enviar ayuda a tus aliados', 'warn');
      return false;
    }
    const key = resource === 'gold' ? 'gold' : 'troops';
    const amount = Math.floor(p[key] * clamp(ratio, 0, 1));
    if (amount < 1) return false;
    p[key] -= amount;
    target[key] += amount;
    if (key === 'gold') target.income.gifts += amount;
    const what = key === 'gold' ? `${formatNumber(amount)} de oro` : `${fmtTroops(amount)} tropas`;
    if (p === this.human) this._emit(`Has enviado ${what} a ${target.name}`, 'info');
    if (target === this.human) this._emit(`${p.name} te envía ${what}`, 'good', { sfx: 'coin' });
    return true;
  }

  sendEmoji(p, targetId, emoji) {
    if (!EMOJIS.includes(emoji) || this.ticks - p.lastEmojiTick < CONFIG.emojiCooldownTicks) return false;
    p.lastEmojiTick = this.ticks;
    this.emojis.push({ from: p.id, to: targetId || 0, emoji, tick: this.ticks });
    const target = this.players[targetId];
    if (target && target === this.human) this._emit(`${p.name} te envía ${emoji}`, 'info');
    if (target) this.brains.get(target.id)?.onEmoji(p, emoji);
    return true;
  }

  // ------------------------------------------ pactos, paz y ayuda

  pactBetween(a, b) {
    for (const pc of this.pacts) if ((pc.a === a && pc.b === b) || (pc.a === b && pc.b === a)) return pc;
    return null;
  }

  pendingOffer(fromId, toId, kind) {
    return this.offers.find((o) => o.from === fromId && o.to === toId && o.kind === kind) || null;
  }

  /** ¿Están `a` y `b` en guerra (algún ataque activo entre ambos)? */
  atWar(a, b) {
    const x = a.attacks.get(b.id);
    const y = b.attacks.get(a.id);
    return !!((x && !x.done) || (y && !y.done));
  }

  /** ¿Puede `p` ofrecer `kind` ('pact' | 'peace') a `target`? */
  canOffer(p, target, kind) {
    if (!target || target === p || !target.alive || !p.alive) return { ok: false, reason: 'No disponible' };
    if (target.weak || p.weak) return { ok: false, reason: 'Las colonias no firman acuerdos' };
    if (p.allies.has(target.id)) return { ok: false, reason: 'Ya sois aliados' };
    if (this.pactBetween(p.id, target.id)) return { ok: false, reason: 'Ya tenéis un acuerdo en vigor' };
    if (this.pendingOffer(p.id, target.id, kind)) return { ok: false, reason: 'Oferta enviada' };
    if (kind === 'peace' && !this.atWar(p, target)) return { ok: false, reason: 'No estáis en guerra' };
    const wait = (p.requestCooldown.get(`${kind}:${target.id}`) || 0) - this.ticks;
    if (wait > 0) return { ok: false, reason: `Rechazada hace poco (espera ${Math.ceil(wait / 10)} s)` };
    return { ok: true, reason: '' };
  }

  /** Ofrece un pacto de no agresión (5 min) o la paz (2 min, con tributo opcional en oro). */
  makeOffer(p, target, kind, tribute = 0) {
    const check = this.canOffer(p, target, kind);
    if (!check.ok) {
      this._notify(p, check.reason, 'warn');
      return false;
    }
    // Si el otro ya nos ofreció lo mismo, se firma directamente
    if (this.pendingOffer(target.id, p.id, kind)) return this.respondOffer(p, target, kind, true);
    const t = kind === 'peace' ? clamp(Number(tribute) || 0, 0, 0.5) : 0;
    this.offers.push({ kind, from: p.id, to: target.id, tribute: t, expires: this.ticks + CONFIG.offerTicks, decideAt: target.isHuman ? Infinity : this.ticks + this.rng.int(10, 40) });
    if (target === this.human) {
      const gold = t ? ` y ${formatNumber(Math.floor(p.gold * t))} de oro` : '';
      const text = kind === 'pact' ? `📜 ${p.name} te propone un pacto de no agresión (${CONFIG.pactTicks / 600} min)` : `🕊 ${p.name} te ofrece la paz${gold}`;
      this._emit(text, 'request', { fromId: p.id, offer: kind });
    } else if (p === this.human) {
      this._emit(kind === 'pact' ? `Pacto de no agresión propuesto a ${target.name}` : `Oferta de paz enviada a ${target.name}`, 'info', { feedback: true });
    }
    return true;
  }

  /** `p` responde a la oferta `kind` de `from`. */
  respondOffer(p, from, kind, accept) {
    if (!from) return false;
    const offer = this.pendingOffer(from.id, p.id, kind);
    if (!offer) return false;
    this.offers = this.offers.filter((o) => o !== offer && !(o.from === p.id && o.to === from.id && o.kind === kind));
    if (!accept || !from.alive || !p.alive || this.pactBetween(p.id, from.id)) {
      from.requestCooldown.set(`${kind}:${p.id}`, this.ticks + CONFIG.offerCooldownTicks);
      if (from === this.human) this._emit(`${p.name} rechaza tu ${kind === 'pact' ? 'pacto' : 'oferta de paz'}`, 'warn');
      return false;
    }
    // Firmado: se acaban los ataques entre ambos (las tropas vuelven)
    const ab = from.attacks.get(p.id);
    if (ab && !ab.done) this._endAttack(ab);
    const ba = p.attacks.get(from.id);
    if (ba && !ba.done) this._endAttack(ba);
    this.pacts.push({ a: from.id, b: p.id, kind, until: this.ticks + (kind === 'pact' ? CONFIG.pactTicks : CONFIG.peaceTicks) });
    from.stats.pacts++;
    p.stats.pacts++;
    let paid = 0;
    if (kind === 'peace' && offer.tribute > 0) {
      paid = Math.floor(from.gold * offer.tribute);
      from.gold -= paid;
      p.gold += paid;
      p.income.gifts += paid;
    }
    this.diploVersion++;
    const human = from === this.human ? from : p === this.human ? p : null;
    if (human) {
      const other = human === from ? p : from;
      const gold = paid ? (human === p ? ` (+${formatNumber(paid)} de oro)` : ` (pagas ${formatNumber(paid)} de oro)`) : '';
      this._emit(kind === 'pact' ? `📜 Pacto de no agresión con ${other.name} (${CONFIG.pactTicks / 600} min)` : `🕊 Paz firmada con ${other.name}${gold}`, 'good', { sfx: 'alliance' });
    }
    return true;
  }

  /** Rompe un pacto antes de tiempo: quien lo rompe queda marcado como traidor. */
  breakPact(p, other) {
    const pc = other && this.pactBetween(p.id, other.id);
    if (!pc) return false;
    this.pacts = this.pacts.filter((x) => x !== pc);
    p.traitorUntil = this.ticks + CONFIG.traitorTicks;
    p.betrayals++;
    this.diploVersion++;
    if (p === this.human) this._emit(`Has roto el pacto con ${other.name}. Eres traidor durante ${CONFIG.traitorTicks / 10} s`, 'warn');
    else if (other === this.human) this._emit(`💔 ${p.name} ha roto vuestro pacto`, 'danger', { sfx: 'betray' });
    this.brains.get(other.id)?.onBetrayed(p);
    return true;
  }

  /** Pide ayuda a los aliados contra quien más fuerte le está atacando. */
  askHelp(p) {
    if (!p.allies.size) {
      this._notify(p, 'No tienes aliados a quien pedir ayuda', 'warn');
      return false;
    }
    const wait = (p.helpAt || -Infinity) + CONFIG.helpCooldownTicks - this.ticks;
    if (wait > 0) {
      this._notify(p, `Acabas de pedir ayuda (espera ${Math.ceil(wait / 10)} s)`, 'warn');
      return false;
    }
    let worst = null;
    for (const atk of this.attacks) {
      if (!atk.done && atk.targetId === p.id && (!worst || atk.troops > worst.troops)) worst = atk;
    }
    const enemy = worst ? worst.attacker : null;
    p.helpAt = this.ticks;
    let answered = 0;
    for (const id of p.allies) {
      const ally = this.players[id];
      if (!ally.alive) continue;
      if (ally === this.human) {
        this._emit(`🆘 ${p.name} te pide ayuda${enemy ? ` contra ${enemy.name}` : ''}`, 'warn', { sfx: 'war' });
        continue;
      }
      if (this.brains.get(id)?.onHelpRequest?.(p, enemy)) answered++;
    }
    if (p === this.human) this._emit(answered ? `🆘 ${answered} aliado${answered > 1 ? 's acuden' : ' acude'} en tu ayuda` : '🆘 Tus aliados no pueden ayudarte ahora', answered ? 'good' : 'warn', { feedback: true });
    return true;
  }

  _processOffers() {
    if (this.pacts.length && this.ticks % 10 === 0) {
      const now = this.ticks;
      const ended = this.pacts.filter((pc) => pc.until <= now || !this.players[pc.a].alive || !this.players[pc.b].alive);
      if (ended.length) {
        this.pacts = this.pacts.filter((pc) => !ended.includes(pc));
        this.diploVersion++;
        for (const pc of ended) {
          const h = this.human;
          if (h && (pc.a === h.id || pc.b === h.id)) {
            const other = this.players[pc.a === h.id ? pc.b : pc.a];
            if (other.alive) this._emit(`El ${pc.kind === 'peace' ? 'acuerdo de paz' : 'pacto'} con ${other.name} ha vencido`, 'warn');
          }
        }
      }
    }
    if (!this.offers.length) return;
    for (const o of [...this.offers]) {
      if (!this.offers.includes(o)) continue;
      const from = this.players[o.from];
      const to = this.players[o.to];
      if (!from.alive || !to.alive) this.offers = this.offers.filter((x) => x !== o);
      else if (this.ticks >= o.decideAt) {
        const brain = this.brains.get(to.id);
        const yes = o.kind === 'pact' ? brain?.wantsPact?.(from) : brain?.wantsPeace?.(from, o.tribute);
        this.respondOffer(to, from, o.kind, !!yes);
      } else if (this.ticks >= o.expires) this.respondOffer(to, from, o.kind, false);
    }
  }

  _processRequests() {
    this._processOffers();
    if (!this.requests.length) return;
    for (const req of [...this.requests]) {
      if (!this.requests.includes(req)) continue;
      const from = this.players[req.from];
      const to = this.players[req.to];
      if (!from.alive || !to.alive) {
        this.requests = this.requests.filter((r) => r !== req);
      } else if (this.ticks >= req.decideAt) {
        this.respondAlliance(to, from, this.brains.get(to.id).wantsAlliance(from));
      } else if (this.ticks >= req.expires) {
        // Sin respuesta: cuenta como rechazo
        this.respondAlliance(to, from, false);
      }
    }
  }

  /** Solo se anuncian las alianzas entre bots si afectan a alguien relevante. */
  _isNotable(p) {
    const ranked = this.alivePlayers().sort((a, b) => b.tiles - a.tiles);
    return ranked.indexOf(p) < 3 || (this.human && this.human.alive && this.neighborSummary(this.human).counts.has(p.id));
  }

  // ----------------------------------------------------------------- eventos

  _emit(text, kind = 'info', extra = null) {
    const evt = { tick: this.ticks, text, kind, ...extra };
    this.eventLog.push(evt);
    if (this.eventLog.length > 200) this.eventLog.shift();
    if (this.onEvent) this.onEvent(evt);
  }

  /** Respuesta a una acción del jugador humano («Te falta oro», «Buque botado»…). */
  _notify(p, text, kind) {
    if (p === this.human) this._emit(text, kind, { feedback: true });
  }
}
