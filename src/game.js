// Simulación de la partida. No toca el DOM: se puede ejecutar en Node (tests) o
// en el navegador. Es determinista: misma semilla + mismas acciones = misma partida.
import { BUILDINGS, CONFIG, EMOJIS } from './config.js';
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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Game {
  constructor({ map, seed = 1 }) {
    this.map = map;
    this.rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
    this.owner = new Uint16Array(map.size); // 0 = nadie
    this.players = [null]; // el índice coincide con el id; 0 está reservado
    this.bots = [];
    this.attacks = [];
    this.boats = [];
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
    if (isHuman) this.human = p;
    return p;
  }

  addBots(count) {
    const existing = this.players.filter(Boolean).map((p) => p.name);
    const names = generateNames(this.rng, count, existing);
    for (let i = 0; i < count; i++) {
      const p = this.addPlayer(names[i], botColor(this.players.length, this.rng), false);
      const brain = new BotBrain(this, p);
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
    for (const bot of this.bots) {
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

  /** Coloca (o recoloca, durante el despliegue) a un jugador en `tile`. */
  spawnPlayer(p, tile) {
    const map = this.map;
    if (this.phase !== 'spawn' || !p.alive) return false;
    if (tile < 0 || tile >= map.size || !map.isLand(tile) || this.owner[tile] !== 0) return false;
    const body = map.landBody[tile];
    if (map.landBodySizes[body] < CONFIG.minSpawnBodySize) return false;
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
      if (target && target.isHuman) this._emit(`⚔ ${p.name} te está atacando`, 'danger');
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

  buildCost(p, kind) {
    const def = BUILDINGS[kind];
    return def.base + def.step * p.buildings[kind];
  }

  /** Comprueba si `p` puede construir `kind` en `tile`; si no, explica por qué. */
  canBuild(p, kind, tile) {
    const map = this.map;
    const def = BUILDINGS[kind];
    if (!def) return { ok: false, reason: 'Edificio desconocido' };
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
    if (!this.canBuild(p, kind, tile).ok) return false;
    p.gold -= this.buildCost(p, kind);
    const b = { id: this._nextBuildingId++, kind, tile, owner: 0 };
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
    const name = BUILDINGS[b.kind].name;
    if (oldId) {
      const op = this.players[oldId];
      op.buildings[b.kind]--;
      if (b.kind === 'fort') op.forts.delete(b.tile);
      if (op.isHuman && newId) this._emit(`Has perdido una ${name} a manos de ${this.players[newId].name}`, 'danger');
    }
    if (!newId) {
      this.buildings = this.buildings.filter((x) => x !== b);
      this.buildingAt.delete(b.tile);
      return;
    }
    b.owner = newId;
    const np = this.players[newId];
    np.buildings[b.kind]++;
    if (b.kind === 'fort') np.forts.add(b.tile);
    if (np.isHuman) this._emit(built ? `${name} construida` : `Has capturado una ${name}`, 'good');
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
    if (target && target.isHuman) this._emit(`🚢 ${p.name} envía un barco contra ti`, 'danger');
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
    if (!this.launchAttack(p, o, boat.troops, { deduct: false })) p.troops += boat.troops;
    if (p.isHuman) this._emit('Desembarco con éxito', 'good');
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
    }

    for (let i = 0; i < this.attacks.length; i++) this._processAttack(this.attacks[i]);
    this.attacks = this.attacks.filter((a) => !a.done);

    this._updateBoats();
    this._processRequests();
    if (this.emojis.length && this.emojis[0].tick < this.ticks - CONFIG.emojiTicks) {
      this.emojis = this.emojis.filter((e) => e.tick >= this.ticks - CONFIG.emojiTicks);
    }

    for (const bot of this.bots) {
      if (!bot.player.alive || this.ticks < bot.nextThink) continue;
      bot.think();
      bot.nextThink = this.ticks + this.rng.int(CONFIG.botThinkMin, CONFIG.botThinkMax);
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
      if (killer && killer.alive && p.gold > 0) {
        const loot = p.gold * CONFIG.plunderShare;
        killer.gold += loot;
        if (killer.isHuman) this._emit(`Botín: +${Math.floor(loot)} de oro de ${p.name}`, 'good');
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
      this._emit(p.isHuman ? 'Has sido derrotado' : `${p.name} ha sido eliminado`, p.isHuman ? 'danger' : 'info');
    }
  }

  _checkVictory() {
    const need = this.map.landCount * CONFIG.winLandShare;
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
      this._emit(winner.isHuman ? '¡Victoria! Dominas el mundo' : `${winner.name} domina el mundo`, winner.isHuman ? 'good' : 'danger');
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
        const human = rest.find((p) => p.isHuman);
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
    if (target.isHuman) {
      this._emit(`🤝 ${p.name} te propone una alianza`, 'request', { fromId: p.id });
    } else if (p.isHuman) {
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
    if (from.isHuman) this._emit(`${p.name} rechaza tu alianza`, 'warn');
    this.brains.get(from.id)?.onRejected(p);
    return false;
  }

  _formAlliance(a, b) {
    a.allies.add(b.id);
    b.allies.add(a.id);
    this.requests = this.requests.filter((r) => !((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)));
    // La paz detiene los ataques entre ambos y devuelve las tropas
    const ab = a.attacks.get(b.id);
    if (ab) this._endAttack(ab);
    const ba = b.attacks.get(a.id);
    if (ba) this._endAttack(ba);
    this.diploVersion++;
    const human = a.isHuman ? a : b.isHuman ? b : null;
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
    if (p.isHuman) this._emit(`Has roto la alianza con ${other.name}. Eres traidor durante ${CONFIG.traitorTicks / 10} s`, 'warn');
    else if (other.isHuman) this._emit(`💔 ${p.name} ha roto vuestra alianza`, 'danger');
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
    if (p.isHuman) this._emit(`Has enviado ${amount} ${what} a ${target.name}`, 'info');
    if (target.isHuman) this._emit(`${p.name} te envía ${amount} ${what}`, 'good');
    return true;
  }

  sendEmoji(p, targetId, emoji) {
    if (!EMOJIS.includes(emoji) || this.ticks - p.lastEmojiTick < CONFIG.emojiCooldownTicks) return false;
    p.lastEmojiTick = this.ticks;
    this.emojis.push({ from: p.id, to: targetId || 0, emoji, tick: this.ticks });
    const target = this.players[targetId];
    if (target && target.isHuman) this._emit(`${p.name} te envía ${emoji}`, 'info');
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
    if (p.isHuman) this._emit(text, kind);
  }
}
