// Simulación de la partida. No toca el DOM: se puede ejecutar en Node (tests) o
// en el navegador. Es determinista: misma semilla + mismas acciones = misma partida.
import { CONFIG } from './config.js';
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
      this.bots.push(new BotBrain(this, p));
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
    }
    let np = null;
    if (newId) {
      np = this.players[newId];
      np.tiles++;
      if (np.tiles > np.maxTilesReached) np.maxTilesReached = np.tiles;
    }
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
      } else if (it.type === 'cancelAttack') {
        const atk = p.attacks.get(it.targetId);
        if (atk) this._endAttack(atk, 0.5); // retirarse cuesta la mitad de las tropas
      }
    }
  }

  _handleAttackIntent(p, tile, ratio) {
    const map = this.map;
    if (tile < 0 || tile >= map.size || !map.isLand(tile)) return;
    const targetId = this.owner[tile];
    if (targetId === p.id) return;
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
    if (target && !target.alive) return false;
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

  /** Coste en tropas de conquistar `t` y bajas que sufre el defensor. */
  tileCost(t, target) {
    const m = CONFIG.terrainCost[this.map.terrain[t]];
    if (!target) return { cost: CONFIG.wildTileCost * m, loss: 0 };
    const density = target.troops / Math.max(1, target.tiles);
    return {
      cost: (CONFIG.playerTileBaseCost + density * CONFIG.defenseDensityMult) * m,
      loss: Math.min(target.troops, density * CONFIG.defenderLossMult),
    };
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
    const terrain = this.map.terrain;
    const aid = A.id;
    while (atk.budget > 0 && atk.heap.size > 0) {
      const t = atk.heap.pop();
      atk.inFrontier.delete(t);
      if (owner[t] !== tid || this._countOwnedNeighbors(t, aid) === 0) continue;
      const { cost, loss } = this.tileCost(t, target);
      if (atk.troops < cost) {
        // El asalto se agota contra esta casilla
        if (target) target.troops = Math.max(0, target.troops - atk.troops * 0.5);
        atk.troops = 0;
        break;
      }
      atk.troops -= cost;
      atk.budget -= CONFIG.terrainCost[terrain[t]];
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

  // ------------------------------------------------------------------ barcos

  launchBoat(p, tile, troops, { deduct = true } = {}) {
    if (p.boatCount >= CONFIG.maxBoats) {
      this._notify(p, `Ya tienes ${CONFIG.maxBoats} barcos en el mar`, 'warn');
      return false;
    }
    if (deduct) troops = Math.min(troops, Math.floor(p.troops));
    if (troops < 1) return false;
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
    if (o === p.id) {
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
      if (p.alive) p.troops += p.growthPerTick();
    }

    for (let i = 0; i < this.attacks.length; i++) this._processAttack(this.attacks[i]);
    this.attacks = this.attacks.filter((a) => !a.done);

    this._updateBoats();

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
      for (const atk of [...p.attacks.values()]) this._endAttack(atk);
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
    }
  }

  // ----------------------------------------------------------------- eventos

  _emit(text, kind = 'info') {
    const evt = { tick: this.ticks, text, kind };
    this.eventLog.push(evt);
    if (this.eventLog.length > 200) this.eventLog.shift();
    if (this.onEvent) this.onEvent(evt);
  }

  /** Mensajes solo relevantes para el jugador humano. */
  _notify(p, text, kind) {
    if (p.isHuman) this._emit(text, kind);
  }
}
