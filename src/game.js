// Simulación de la partida. No toca el DOM: se puede ejecutar en Node (tests) o
// en el navegador. Es determinista: misma semilla + mismas acciones = misma partida.
import { BUILDINGS, CONFIG, EMOJIS, cleanRules } from './config.js';
import { formatNumber } from './format.js';
import { Rng } from './rng.js';
import { Player } from './player.js';
import { Attack } from './attack.js';
import { BotBrain } from './bot.js';
import { generateNames } from './names.js';
import { botColor } from './colors.js';

// Buffers de vecinos, uno por función para evitar reentradas
const NB_SET = new Int32Array(4);
const NB_BORDER = new Int32Array(4);
const NB_COUNT = new Int32Array(4);
const NB_SCAN = new Int32Array(4);
const NB_BFS = new Int32Array(4);
const NB_MISC = new Int32Array(4);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Game {
  constructor({ map, seed = 1, rules = null }) {
    this.map = map;
    this.rules = cleanRules(rules);
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
    /** Barcos automáticos de los puertos: { id, owner, kind: 'fish'|'trade', port, dest, tile, path, pos, progress, value } */
    this.merchants = [];
    this._nextMerchantId = 1;
    /** Efectos visuales recientes: explosiones e intercepciones (no afectan a la simulación). */
    this.effects = [];
    this.buildings = []; // { id, kind, tile, owner }
    this.buildingAt = new Map(); // casilla → edificio
    this._nextBuildingId = 1;
    this.brains = new Map(); // id de jugador → BotBrain
    this.requests = []; // propuestas de alianza: { from, to, expires, decideAt }
    this.emojis = []; // { from, to, emoji, tick }
    this.diploVersion = 0; // sube cada vez que cambia una alianza (el render repinta)
    this.winningAlliance = null;
    this.ticks = 0;
    this.phase = 'spawn'; // 'spawn' | 'playing' | 'ended'
    this.winner = null;
    this.intents = [];

    // El renderizador activa esto para saber qué píxeles repintar
    this.trackDirty = false;
    this.dirty = [];

    this.onEvent = null;
    this.eventLog = [];

    // Memoria reutilizable para búsquedas en anchura
    this._stampArr = new Uint32Array(map.size);
    this._stamp = 0;
    this._parent = new Int32Array(map.size);
    this._queue = new Int32Array(map.size);
    this._nextBoatId = 1;
  }

  // ---------------------------------------------------------------- jugadores

  addPlayer(name, color, isHuman = false) {
    const id = this.players.length;
    if (id > 65000) throw new Error('Demasiados jugadores');
    const p = new Player(id, name, color, isHuman);
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
    const names = countries ? countries.slice(0, count).map((c) => c.name) : generateNames(this.rng, count, existing);
    count = Math.min(count, names.length);
    for (let i = 0; i < count; i++) {
      const p = this.addPlayer(names[i], botColor(this.players.length, this.rng), false);
      if (countries) {
        p.homeTile = countries[i].tile;
        p.flag = countries[i].iso || '';
      }
      const brain = new BotBrain(this, p, difficulty);
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
      const home = bot.player.homeTile;
      const near = home >= 0 ? this._freeTileNear(home, 10, 30) : -1;
      if (near >= 0 && this.spawnPlayer(bot.player, near, 30)) continue;
      const t = this.findSpawnTile();
      if (t >= 0) this.spawnPlayer(bot.player, t);
    }
    this._emit('Elige dónde empezar haciendo clic en el mapa', 'info');
  }

  /** Busca una casilla libre lejos del resto de naciones. */
  findSpawnTile() {
    const map = this.map;
    const spawns = [];
    for (const p of this.players) if (p && p.spawned) spawns.push(p.spawnTile);
    let minDist = Math.sqrt(map.landCount / Math.max(1, this.players.length - 1)) * 0.9;
    for (let attempt = 0; attempt < 3000; attempt++) {
      if (attempt % 250 === 249) minDist *= 0.8;
      const t = map.landTiles[this.rng.int(0, map.landTiles.length - 1)];
      if (this.owner[t] !== 0) continue;
      if (map.landBodySizes[map.landBody[t]] < CONFIG.minSpawnBodySize) continue;
      const tx = map.x(t);
      const ty = map.y(t);
      let ok = true;
      for (const s of spawns) {
        const dx = map.x(s) - tx;
        const dy = map.y(s) - ty;
        if (dx * dx + dy * dy < minDist * minDist) {
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
  spawnPlayer(p, tile, minBody = CONFIG.minSpawnBodySize) {
    const map = this.map;
    if (this.phase !== 'spawn' || !p.alive) return false;
    if (tile < 0 || tile >= map.size || !map.isLand(tile) || this.owner[tile] !== 0) return false;
    const body = map.landBody[tile];
    if (map.landBodySizes[body] < minBody) return false;
    if (p.spawned) this._releaseAll(p);

    const r = CONFIG.spawnRadius;
    const cx = map.x(tile);
    const cy = map.y(tile);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        const i = map.index(x, y);
        if (map.isLand(i) && this.owner[i] === 0 && map.landBody[i] === body) this.setOwner(i, p.id);
      }
    }
    p.spawned = true;
    p.spawnTile = tile;
    p.troops = CONFIG.startTroops;
    return true;
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
    if (oldId) {
      const op = this.players[oldId];
      op.tiles--;
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
    if (this.trackDirty) this.dirty.push(t);
    this._updateBorder(t);

    const nb = NB_SET;
    const c = map.neighbors(t, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      this._updateBorder(n);
      if (this.trackDirty) this.dirty.push(n);
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

  /** Resumen de vecinos para la IA: casillas de tierra libre y por nación. */
  neighborSummary(p) {
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
      if (it.type === 'action') {
        if (this.phase === 'spawn') {
          if (!this.spawnPlayer(p, it.tile)) this._notify(p, 'No puedes empezar ahí', 'warn');
        } else if (this.phase === 'playing') {
          this._handleAttackIntent(p, it.tile, it.ratio);
        }
      } else if (it.type === 'build') {
        if (this.phase !== 'playing') continue;
        const check = this.canBuild(p, it.kind, it.tile);
        if (check.ok) this.build(p, it.kind, it.tile);
        else this._notify(p, check.reason, 'warn');
      } else if (it.type === 'moveWarship') {
        if (this.phase === 'playing') this.moveWarship(p, it.tile);
      } else if (it.type === 'cancelAttack') {
        const atk = p.attacks.get(it.targetId);
        if (atk) this._endAttack(atk, 0.5); // retirarse cuesta la mitad de las tropas
      } else if (this.phase !== 'playing') {
        continue;
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
      this.launchAttack(p, targetId, troops);
    } else {
      this.launchBoat(p, tile, troops);
    }
  }

  /**
   * Lanza (o refuerza) un ataque terrestre. Si el objetivo nos está atacando a
   * la vez, las tropas de ambos ataques se anulan primero.
   */
  launchAttack(p, targetId, troops, { deduct = true } = {}) {
    if (!p.alive || targetId === p.id) return false;
    const target = targetId ? this.players[targetId] : null;
    if (target && (!target.alive || this.isAllied(p.id, targetId))) return false;
    if (deduct) troops = Math.min(troops, Math.floor(p.troops));
    if (troops < 1) return false;

    let atk = p.attacks.get(targetId);
    if (!atk || atk.done) {
      atk = new Attack(p, targetId, 0);
      this._initFrontier(atk);
      if (atk.inFrontier.size === 0) return false;
      p.attacks.set(targetId, atk);
      this.attacks.push(atk);
      if (target && target === this.human) this._emit(`⚔ ${p.name} te ataca con ${formatNumber(troops)} tropas`, 'danger');
      else if (p === this.human && target) this._emit(`⚔ Atacas a ${target.name} con ${formatNumber(troops)} tropas`, 'info');
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

  _addCandidate(atk, t) {
    if (atk.inFrontier.has(t)) return;
    atk.inFrontier.add(t);
    // Primero las casillas más rodeadas por el atacante: frontera más suave
    const n = this._countOwnedNeighbors(t, atk.attacker.id);
    const key = atk.step + this.rng.float() * 2.5 - n * 1.25;
    atk.heap.push(key, t);
  }

  /**
   * Coste en tropas de conquistar `t`, bajas que sufre el defensor y
   * multiplicador de tiempo (terreno × fortalezas).
   */
  tileCost(t, target) {
    const m = CONFIG.terrainCost[this.map.terrain[t]];
    if (!target) return { cost: CONFIG.wildTileCost * m, loss: 0, slow: m };
    let fort = this.fortMultiplier(target, t);
    if (this.isTraitor(target)) fort *= CONFIG.traitorDefenseMult;
    const density = target.troops / Math.max(1, target.tiles);
    return {
      cost: (CONFIG.playerTileBaseCost + density * CONFIG.defenseDensityMult) * m * fort,
      loss: Math.min(target.troops, density * CONFIG.defenderLossMult),
      slow: m * fort,
    };
  }

  /** Multiplicador defensivo si `t` está en el radio de una fortaleza del defensor. */
  fortMultiplier(defender, t) {
    if (!defender.forts.size) return 1;
    const map = this.map;
    const x = map.x(t);
    const y = map.y(t);
    const r2 = CONFIG.fortRadius * CONFIG.fortRadius;
    for (const f of defender.forts) {
      const dx = map.x(f) - x;
      const dy = map.y(f) - y;
      if (dx * dx + dy * dy <= r2) return CONFIG.fortDefenseMult;
    }
    return 1;
  }

  _processAttack(atk) {
    if (atk.done) return;
    const A = atk.attacker;
    const tid = atk.targetId;
    const target = tid ? this.players[tid] : null;
    if (!A.alive || (target && !target.alive) || atk.troops < 1 || atk.inFrontier.size === 0) {
      this._endAttack(atk);
      return;
    }
    atk.step++;

    let rate;
    if (!target) {
      rate = CONFIG.attackRateWild;
    } else {
      // Cuanto mayor la superioridad local, más rápido avanza el frente
      const density = target.troops / Math.max(1, target.tiles);
      const ratio = atk.troops / (density * atk.inFrontier.size + 1);
      rate = CONFIG.attackRatePlayer * clamp(Math.sqrt(ratio), 0.2, 1.5);
    }
    atk.budget += Math.max(CONFIG.minAttackBudget, atk.inFrontier.size * rate);

    const owner = this.owner;
    const aid = A.id;
    while (atk.budget > 0 && atk.heap.size > 0) {
      const t = atk.heap.pop();
      atk.inFrontier.delete(t);
      if (owner[t] !== tid || this._countOwnedNeighbors(t, aid) === 0) continue;
      const { cost, loss, slow } = this.tileCost(t, target);
      if (atk.troops < cost) {
        // El asalto se agota contra esta casilla
        if (target) target.troops = Math.max(0, target.troops - atk.troops * 0.5);
        atk.troops = 0;
        break;
      }
      atk.troops -= cost;
      atk.budget -= slow;
      if (target) target.troops -= loss;
      this.setOwner(t, aid);
    }
    if (atk.inFrontier.size === 0 || atk.troops < 1) this._endAttack(atk);
  }

  /** Termina un ataque; las tropas sobrantes (× refund) vuelven a casa. */
  _endAttack(atk, refund = 1) {
    if (atk.done) return;
    atk.done = true;
    const A = atk.attacker;
    if (A.alive) A.troops += atk.troops * refund;
    atk.troops = 0;
    if (A.attacks.get(atk.targetId) === atk) A.attacks.delete(atk.targetId);
    atk.heap = null;
    atk.inFrontier.clear();
  }

  // --------------------------------------------------------------- edificios

  /** ¿Permiten las reglas de esta partida este edificio o unidad? */
  isAllowed(kind) {
    if (!this.rules.missiles && (kind === 'silo' || kind === 'sam' || kind === 'missile')) return false;
    if (!this.rules.warships && kind === 'warship') return false;
    return true;
  }

  buildCost(p, kind) {
    const def = BUILDINGS[kind];
    return def.base + def.step * (p.buildings[kind] || 0);
  }

  /** Comprueba si `p` puede construir `kind` en `tile`; si no, explica por qué. */
  canBuild(p, kind, tile) {
    const map = this.map;
    const def = BUILDINGS[kind];
    if (!def) return { ok: false, reason: 'Edificio desconocido' };
    if (!this.isAllowed(kind)) return { ok: false, reason: 'Desactivado en esta partida' };
    if (def.unit === 'ship') return this._canBuildWarship(p, tile);
    if (def.unit === 'missile') return this._canLaunchMissile(p, tile);
    if (tile < 0 || tile >= map.size || this.owner[tile] !== p.id) {
      return { ok: false, reason: 'Solo puedes construir en tu territorio' };
    }
    if (def.coastal && !map.coastal[tile]) return { ok: false, reason: 'El puerto tiene que estar en la costa' };
    const near = this.buildingNear(tile, CONFIG.buildingMinDist);
    if (near) return { ok: false, reason: `Demasiado cerca de otro edificio (${BUILDINGS[near.kind].name})` };
    const cost = this.buildCost(p, kind);
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: ${def.name} cuesta ${Math.ceil(cost)}` };
    return { ok: true, reason: '' };
  }

  build(p, kind, tile) {
    const check = this.canBuild(p, kind, tile);
    if (!check.ok) return false;
    p.gold -= this.buildCost(p, kind);
    if (BUILDINGS[kind].unit === 'ship') return this._launchWarship(p, check.water);
    if (BUILDINGS[kind].unit === 'missile') return this._launchMissile(p, check.silo, tile);
    p.stats.built++;
    const b = { id: this._nextBuildingId++, kind, tile, owner: 0 };
    if (kind === 'port') {
      b.hp = CONFIG.portHp;
      b.hitTick = -Infinity;
      b.water = this._waterNextTo(tile);
      b.nextFish = this.ticks + 30;
      b.nextTrade = this.ticks + this.rng.int(CONFIG.tradeEveryMin, CONFIG.tradeEveryMax);
    }
    if (kind === 'silo' || kind === 'sam') b.readyAt = this.ticks; // listo desde ya
    this.buildings.push(b);
    this.buildingAt.set(tile, b);
    this._transferBuilding(b, 0, p.id, true);
    return true;
  }

  /** Primer edificio a menos de `dist` casillas de `tile` (o null). */
  buildingNear(tile, dist) {
    const map = this.map;
    const x = map.x(tile);
    const y = map.y(tile);
    for (const b of this.buildings) {
      const dx = map.x(b.tile) - x;
      const dy = map.y(b.tile) - y;
      if (dx * dx + dy * dy < dist * dist) return b;
    }
    return null;
  }

  /** Los edificios cambian de manos con su casilla; sin dueño, se destruyen. */
  _transferBuilding(b, oldId, newId, built = false) {
    const def = BUILDINGS[b.kind];
    const name = def.name;
    const some = `${def.fem ? 'una' : 'un'} ${name.toLowerCase()}`; // "una ciudad", "un puerto"
    if (oldId) {
      const op = this.players[oldId];
      op.buildings[b.kind]--;
      if (b.kind === 'fort') op.forts.delete(b.tile);
      if (op === this.human && newId) this._emit(`Has perdido ${some} a manos de ${this.players[newId].name}`, 'danger');
    }
    if (!newId) {
      this.buildings = this.buildings.filter((x) => x !== b);
      this.buildingAt.delete(b.tile);
      return;
    }
    b.owner = newId;
    const np = this.players[newId];
    np.buildings[b.kind]++;
    if (np.buildings.city > np.stats.maxCities) np.stats.maxCities = np.buildings.city;
    if (np.buildings.factory > np.stats.maxFactories) np.stats.maxFactories = np.buildings.factory;
    if (b.kind === 'fort') np.forts.add(b.tile);
    if (np === this.human) this._emit(built ? `${name} ${def.fem ? 'construida' : 'construido'}` : `Has capturado ${some}`, 'good');
  }

  // ------------------------------------------------------- economía naval

  _waterNextTo(tile) {
    const nb = NB_MISC;
    const c = this.map.neighbors(tile, nb);
    for (let k = 0; k < c; k++) if (this.map.terrain[nb[k]] === 0) return nb[k];
    return -1;
  }

  /** Lanza pesqueros y mercantes desde los puertos y los mueve. */
  _updateMerchants() {
    const map = this.map;
    // Nuevos barcos (cada 10 ticks basta)
    if (this.ticks % 10 === 0) {
      const ports = this.buildings.filter((b) => b.kind === 'port' && b.water >= 0);
      for (const b of ports) {
        if (this.ticks >= b.nextFish) {
          b.nextFish = this.ticks + 100;
          const fleet = this.merchants.filter((m) => m.kind === 'fish' && m.port === b.id).length;
          if (fleet < CONFIG.fishPerPort) this._spawnMerchant(b, 'fish', null, 0);
        }
        if (this.ticks >= b.nextTrade) {
          b.nextTrade = this.ticks + this.rng.int(CONFIG.tradeEveryMin, CONFIG.tradeEveryMax);
          const owner = this.players[b.owner];
          // Destino: un puerto de otra nación del mismo mar con la que no esté en guerra
          const options = ports.filter((o) => {
            if (o.owner === b.owner || map.waterBody[o.water] !== map.waterBody[b.water]) return false;
            const other = this.players[o.owner];
            return !owner.attacks.has(o.owner) && !other.attacks.has(b.owner);
          });
          if (options.length) {
            const dest = options[this.rng.int(0, options.length - 1)];
            const path = this._waterPath(b.water, dest.water);
            if (path) this._spawnMerchant(b, 'trade', dest, path.length * CONFIG.tradeGoldPerTile, path);
          }
        }
      }
    }
    for (const m of this.merchants) {
      const owner = this.players[m.owner];
      if (!owner.alive) {
        m.done = true;
        continue;
      }
      if (m.kind === 'fish') owner.gold += CONFIG.fishGold;
      if (m.path) {
        m.progress += m.kind === 'fish' ? CONFIG.fishSpeed : CONFIG.tradeSpeed;
        while (m.progress >= 1 && m.pos < m.path.length - 1) {
          m.pos++;
          m.progress -= 1;
        }
        m.tile = m.path[m.pos];
        if (m.pos < m.path.length - 1) continue;
        m.path = null;
      }
      if (m.kind === 'trade') this._arriveTrade(m);
      else this._nextFishingSpot(m);
    }
    if (this.merchants.some((m) => m.done)) this.merchants = this.merchants.filter((m) => !m.done);
  }

  _spawnMerchant(port, kind, dest, value, path = null) {
    this.merchants.push({
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

  /** El pesquero busca otro caladero cerca de su puerto (o de un puerto de su dueño). */
  _nextFishingSpot(m) {
    const map = this.map;
    let home = this.buildings.find((b) => b.id === m.port && b.owner === m.owner);
    if (!home) {
      // Su puerto ya no es de su dueño: se busca otro del mismo mar
      home = this.buildings.find((b) => b.kind === 'port' && b.owner === m.owner && b.water >= 0 &&
        map.waterBody[b.water] === map.waterBody[m.tile]);
      if (home) m.port = home.id;
    }
    const cx = map.x(home ? home.water : m.tile);
    const cy = map.y(home ? home.water : m.tile);
    const R = CONFIG.fishRange;
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = cx + this.rng.int(-R, R);
      const y = cy + this.rng.int(-R, R);
      if (!map.inBounds(x, y)) continue;
      const t = map.index(x, y);
      if (map.terrain[t] !== 0 || map.waterBody[t] !== map.waterBody[m.tile]) continue;
      const path = this._waterPath(m.tile, t);
      if (path) {
        m.path = path;
        m.pos = 0;
        m.progress = 0;
        return;
      }
    }
  }

  _arriveTrade(m) {
    m.done = true;
    const dest = this.buildings.find((b) => b.id === m.dest);
    if (!dest) return; // el puerto de destino ya no existe
    const owner = this.players[m.owner];
    owner.gold += m.value;
    const partner = this.players[dest.owner];
    if (partner && partner.alive && partner !== owner) partner.gold += m.value * CONFIG.tradeReceiverShare;
    if (owner === this.human) this._emit(`⚓ Un mercante vuelve con ${formatNumber(m.value)} de oro`, 'good');
  }

  /** Un buque se queda con un barco automático enemigo: ahora produce para su nuevo dueño. */
  _captureMerchant(ws, m) {
    const victim = this.players[m.owner];
    const thief = this.players[ws.owner];
    m.owner = ws.owner;
    if (m.kind === 'fish') {
      const port = this.buildings.find((b) => b.kind === 'port' && b.owner === thief.id && b.water >= 0 &&
        this.map.waterBody[b.water] === this.map.waterBody[m.tile]);
      m.port = port ? port.id : 0;
      m.path = null;
    }
    thief.stats.captured = (thief.stats.captured || 0) + 1;
    const what = m.kind === 'fish' ? 'un pesquero' : 'un mercante';
    if (thief === this.human) this._emit(`🏴 Has capturado ${what} de ${victim.name}`, 'good');
    else if (victim === this.human) this._emit(`🏴 ${thief.name} te ha robado ${what}`, 'danger');
  }

  // ---------------------------------------------------- misiles y antimisiles

  /** Silo propio listo y a tiro de `tile` (el más cercano), o null. */
  readySilo(p, tile) {
    const map = this.map;
    const r2 = CONFIG.missileRange * CONFIG.missileRange;
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== p.id || b.kind !== 'silo' || b.readyAt > this.ticks) continue;
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

  _canLaunchMissile(p, tile) {
    const map = this.map;
    if (!p.buildings.silo) return { ok: false, reason: 'Necesitas un silo para lanzar misiles' };
    if (tile < 0 || tile >= map.size || !map.isLand(tile)) return { ok: false, reason: 'Apunta a territorio enemigo' };
    const o = this.owner[tile];
    if (!o) return { ok: false, reason: 'Ahí no hay nadie: apunta a territorio enemigo' };
    if (o === p.id || this.isAllied(p.id, o)) return { ok: false, reason: 'No puedes atacar tu territorio ni el de tus aliados' };
    const cost = this.buildCost(p, 'missile');
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: un misil cuesta ${Math.ceil(cost)}` };
    const silo = this.readySilo(p, tile);
    if (!silo) {
      const any = this.buildings.some((b) => b.owner === p.id && b.kind === 'silo' && b.readyAt <= this.ticks);
      return { ok: false, reason: any ? `Fuera de alcance (máx. ${CONFIG.missileRange} casillas desde un silo)` : 'Tus silos están recargando' };
    }
    return { ok: true, reason: '', silo };
  }

  _launchMissile(p, silo, tile) {
    const map = this.map;
    silo.readyAt = this.ticks + CONFIG.siloReload;
    const dx = map.x(tile) - map.x(silo.tile);
    const dy = map.y(tile) - map.y(silo.tile);
    const targetId = this.owner[tile];
    this.missiles.push({
      id: this._nextMissileId++,
      owner: p.id,
      from: silo.tile,
      to: tile,
      dist: Math.max(1, Math.sqrt(dx * dx + dy * dy)),
      progress: 0,
      targetId,
    });
    p.stats.missiles++;
    const target = this.players[targetId];
    if (target === this.human) this._emit(`🚀 ¡${p.name} ha lanzado un misil contra ti!`, 'danger');
    else if (p === this.human) this._emit(`🚀 Misil lanzado contra ${target.name}`, 'info');
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
    const r2 = CONFIG.samRange * CONFIG.samRange;
    for (const m of this.missiles) {
      m.progress = Math.min(1, m.progress + CONFIG.missileSpeed / m.dist);
      const [mx, my] = this.missilePos(m);
      // Baterías antimisiles enemigas del lanzador que estén listas y a tiro
      for (const b of this.buildings) {
        if (b.kind !== 'sam' || b.readyAt > this.ticks || !this._isEnemy(m.owner, b.owner)) continue;
        const dx = (b.tile % W) + 0.5 - mx;
        const dy = Math.floor(b.tile / W) + 0.5 - my;
        if (dx * dx + dy * dy > r2) continue;
        // La batería dispara (y recarga) acierte o no
        b.readyAt = this.ticks + CONFIG.samReload;
        const hit = this.rng.float() < CONFIG.samHitChance;
        this.effects.push({ kind: hit ? 'intercept' : 'miss', x: mx, y: my, from: b.tile, tick: this.ticks });
        if (!hit) continue;
        m.dead = true;
        const shooter = this.players[b.owner];
        const launcher = this.players[m.owner];
        if (shooter === this.human) this._emit(`🛡 Tu antimisiles ha derribado un misil de ${launcher.name}`, 'good');
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
    const R = CONFIG.missileRadius;
    const cx = map.x(m.to);
    const cy = map.y(m.to);
    const before = new Map(); // id → { tiles, troops } antes del impacto
    const lost = new Map();
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
    this.effects.push({ kind: 'boom', x: cx + 0.5, y: cy + 0.5, tick: this.ticks });

    const attacker = this.players[m.owner];
    const total = [...lost.values()].reduce((a, b) => a + b, 0);
    if (attacker === this.human) this._emit(`💥 Impacto: ${total} casillas enemigas arrasadas`, 'good');
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
      if (b.owner !== p.id || b.kind !== 'port') continue;
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
    if (!p.buildings.port) return { ok: false, reason: 'Necesitas un puerto para botar buques' };
    if (p.buildings.warship >= p.buildings.port * CONFIG.warshipsPerPort) {
      return { ok: false, reason: `Máximo ${CONFIG.warshipsPerPort} buques por puerto` };
    }
    const cost = this.buildCost(p, 'warship');
    if (p.gold < cost) return { ok: false, reason: `Te falta oro: un buque cuesta ${Math.ceil(cost)}` };
    const port = this.nearestPort(p, tile >= 0 && tile < this.map.size ? tile : p.spawnTile);
    const nb = NB_MISC;
    const c = this.map.neighbors(port.tile, nb);
    for (let k = 0; k < c; k++) if (this.map.terrain[nb[k]] === 0) return { ok: true, reason: '', water: nb[k] };
    return { ok: false, reason: 'Ese puerto no tiene agua al lado' };
  }

  _launchWarship(p, water) {
    p.buildings.warship++;
    p.stats.built++;
    this.warships.push({
      id: this._nextWarshipId++,
      owner: p.id,
      tile: water,
      hp: CONFIG.warshipHp,
      path: null,
      pos: 0,
      progress: 0,
      fireTick: -Infinity,
      fireAt: -1,
    });
    this._notify(p, 'Buque botado. Haz clic en el mar para moverlo', 'good');
    return true;
  }

  /** Envía el buque propio más cercano (o el indicado) a una casilla de agua. */
  moveWarship(p, tile, ws = null) {
    const map = this.map;
    if (tile < 0 || tile >= map.size || map.terrain[tile] !== 0) return false;
    if (!ws) {
      let bestD = Infinity;
      for (const w of this.warships) {
        if (w.owner !== p.id || w.dead) continue;
        const dx = map.x(w.tile) - map.x(tile);
        const dy = map.y(w.tile) - map.y(tile);
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          ws = w;
        }
      }
    }
    if (!ws) {
      this._notify(p, 'No tienes buques. Constrúyelos en un puerto', 'warn');
      return false;
    }
    const path = this._waterPath(ws.tile, tile);
    if (!path) {
      this._notify(p, 'Tu buque no puede llegar a ese mar', 'warn');
      return false;
    }
    ws.path = path;
    ws.pos = 0;
    ws.progress = 0;
    return true;
  }

  /** Ruta por el agua de `from` a `to` (búsqueda en anchura desde el destino). */
  _waterPath(from, to) {
    if (from === to) return null;
    const map = this.map;
    // Mares distintos: no hace falta buscar
    if (map.waterBody[from] !== map.waterBody[to]) return null;
    const terrain = map.terrain;
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const parent = this._parent;
    const queue = this._queue;
    const nb = NB_BFS;
    let head = 0;
    let tail = 0;
    queue[tail++] = to;
    seen[to] = stamp;
    parent[to] = -1;
    while (head < tail) {
      const t = queue[head++];
      if (t === from) break;
      const c = map.neighbors(t, nb);
      for (let k = 0; k < c; k++) {
        const n = nb[k];
        if (terrain[n] !== 0 || seen[n] === stamp) continue;
        seen[n] = stamp;
        parent[n] = t;
        queue[tail++] = n;
      }
    }
    if (seen[from] !== stamp) return null;
    const path = [];
    for (let t = from; t !== -1; t = parent[t]) path.push(t);
    return Int32Array.from(path);
  }

  _isEnemy(a, b) {
    return a !== b && !this.isAllied(a, b);
  }

  _updateWarships() {
    if (!this.warships.length) return;
    const map = this.map;
    const r2 = CONFIG.warshipRange * CONFIG.warshipRange;
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
      // Combate: buques enemigos, luego transportes, luego puertos
      const x = ws.tile % W;
      const y = (ws.tile / W) | 0;
      const dist2 = (t) => {
        const dx = (t % W) - x;
        const dy = ((t / W) | 0) - y;
        return dx * dx + dy * dy;
      };
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
        for (const b of this.buildings) {
          if (b.kind !== 'port' || !this._isEnemy(ws.owner, b.owner)) continue;
          const d = dist2(b.tile);
          if (d < best) [best, target, kind] = [d, b, 'port'];
        }
      }
      if (!target) continue;
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
          if (me === this.human) this._emit(`Has hundido un buque de ${victim.name}`, 'good');
          else if (victim === this.human) this._emit(`${me.name} ha hundido uno de tus buques`, 'danger');
        }
      } else if (kind === 'boat') {
        target.done = true;
        const victim = this.players[target.owner];
        victim.boatCount--;
        me.stats.sunk++;
        if (me === this.human) this._emit(`Has hundido un barco de ${victim.name} con ${formatNumber(target.troops)} tropas`, 'good');
        else if (victim === this.human) this._emit(`${me.name} ha hundido tu barco (${formatNumber(target.troops)} tropas)`, 'danger');
      } else {
        target.hp -= CONFIG.warshipDamage;
        target.hitTick = this.ticks;
        if (target.hp <= 0) {
          const victim = this.players[target.owner];
          this._transferBuilding(target, target.owner, 0);
          if (me === this.human) this._emit(`Has destruido un puerto de ${victim.name}`, 'good');
          else if (victim === this.human) this._emit(`${me.name} ha destruido uno de tus puertos`, 'danger');
        }
      }
    }
    // Hundidos y buques de naciones eliminadas
    if (this.warships.some((w) => w.dead)) {
      for (const w of this.warships) if (w.dead) this.players[w.owner].buildings.warship--;
      this.warships = this.warships.filter((w) => !w.dead);
    }
    this.boats = this.boats.filter((b) => !b.done);
    // Los puertos que no reciben fuego se reparan
    for (const b of this.buildings) {
      if (b.kind === 'port' && b.hp < CONFIG.portHp && this.ticks - b.hitTick > 50) {
        b.hp = Math.min(CONFIG.portHp, b.hp + CONFIG.portRegen);
      }
    }
  }

  // ------------------------------------------------------------------ barcos

  launchBoat(p, tile, troops, { deduct = true } = {}) {
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
    if (target && target === this.human) this._emit(`🚢 ${p.name} envía un barco con ${formatNumber(troops)} tropas contra ti`, 'danger');
    else if (p === this.human) this._emit(`🚢 Barco en camino con ${formatNumber(troops)} tropas`, 'info');
    return true;
  }

  _nextStamp() {
    if (this._stamp >= 0xfffffff0) {
      this._stampArr.fill(0);
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
    while (head < tail && head < 20000) {
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
    const stamp = this._nextStamp();
    const seen = this._stampArr;
    const parent = this._parent;
    const queue = this._queue;
    const nb = NB_BFS;
    let head = 0;
    let tail = 0;

    let c = map.neighbors(dest, nb);
    for (let k = 0; k < c; k++) {
      const n = nb[k];
      if (terrain[n] !== 0 || seen[n] === stamp) continue;
      seen[n] = stamp;
      parent[n] = -1;
      queue[tail++] = n;
    }

    let found = -1;
    while (head < tail) {
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
        if (terrain[n] !== 0 || seen[n] === stamp) continue;
        seen[n] = stamp;
        parent[n] = w;
        queue[tail++] = n;
      }
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
      boat.progress += CONFIG.boatSpeed;
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
    const { cost, loss } = this.tileCost(dest, target);
    if (boat.troops <= cost) {
      if (target) target.troops = Math.max(0, target.troops - boat.troops * 0.5);
      this._notify(p, 'Desembarco rechazado', 'warn');
      return;
    }
    boat.troops -= cost;
    if (target) target.troops -= loss;
    this.setOwner(dest, p.id);
    p.stats.landings++;
    if (!this.launchAttack(p, o, boat.troops, { deduct: false })) p.troops += boat.troops;
    if (p === this.human) this._emit('Desembarco con éxito', 'good');
  }

  // -------------------------------------------------------------------- tick

  tick() {
    if (this.phase === 'ended') return;
    this.ticks++;
    this._applyIntents();

    if (this.phase === 'spawn') {
      if (this.ticks >= CONFIG.spawnTicks) this._beginPlaying();
      return;
    }

    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      p.troops += p.growthPerTick();
      p.gold += p.goldPerTick();
      if (p.gold > p.stats.maxGold) p.stats.maxGold = p.gold;
    }

    for (let i = 0; i < this.attacks.length; i++) this._processAttack(this.attacks[i]);
    this.attacks = this.attacks.filter((a) => !a.done);

    this._updateBoats();
    this._updateMerchants();
    this._updateWarships();
    this._updateMissiles();
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
    this._checkVictory();
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
    for (const bot of this.bots) bot.nextThink = this.ticks + this.rng.int(1, CONFIG.botThinkMax);
    this._emit('¡Comienza la conquista!', 'good');
  }

  _checkEliminations() {
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || p.tiles > 0) continue;
      p.alive = false;
      p.eliminatedTick = this.ticks;
      p.troops = 0;
      // Botín: el oro del eliminado pasa a quien le quitó la última casilla
      const killer = this.players[p.lastConqueredBy];
      if (killer && killer.alive) killer.stats.kills++;
      if (killer && killer.alive && p.gold > 0) {
        const loot = p.gold * CONFIG.plunderShare;
        killer.gold += loot;
        if (killer === this.human) this._emit(`Botín: +${Math.floor(loot)} de oro de ${p.name}`, 'good');
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
      this._emit(p === this.human ? 'Has sido derrotado' : `${p.name} ha sido eliminado`, p === this.human ? 'danger' : 'info');
    }
  }

  _checkVictory() {
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
    if (!target || target === p || !target.alive) return { ok: false, reason: 'No disponible' };
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
      this._emit(`🤝 Alianza firmada con ${other.name}`, 'good');
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
    else if (other === this.human) this._emit(`💔 ${p.name} ha roto vuestra alianza`, 'danger');
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
    const what = key === 'gold' ? 'de oro' : 'tropas';
    if (p === this.human) this._emit(`Has enviado ${amount} ${what} a ${target.name}`, 'info');
    if (target === this.human) this._emit(`${p.name} te envía ${amount} ${what}`, 'good');
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

  _processRequests() {
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

  /** Mensajes solo relevantes para el jugador humano. */
  _notify(p, text, kind) {
    if (p === this.human) this._emit(text, kind);
  }
}
