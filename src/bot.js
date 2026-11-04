// IA de las naciones controladas por el ordenador. Cada bot tiene una
// "personalidad" (agresividad, ritmo de expansión, diplomacia, lealtad) y
// piensa cada pocos ticks.
import { AREA, CONFIG, RES } from './config.js';

const FRIENDLY = ['👍', '🤝', '❤️', '😂'];
const HOSTILE = ['😠', '⚔️', '👎', '🔥'];

export class BotBrain {
  constructor(game, player, difficulty = 'normal') {
    const r = game.rng;
    this.game = game;
    this.player = player;
    this.nextThink = 0;
    // Dificultad: cada cuánto piensan y cuánto les gusta atacar
    const level = { facil: [1.7, 0.6], normal: [1, 1], dificil: [0.65, 1.25] }[difficulty] || [1, 1];
    this.thinkScale = level[0];
    this.aggression = Math.min(1, (0.2 + r.float() * 0.6) * level[1]);
    this.expandRatio = 0.2 + r.float() * 0.3;
    this.saveFor = null; // edificio caro para el que está ahorrando (no gasta en otra cosa)
    this.diplomacy = r.float(); // 0 = lobo solitario, 1 = diplomático
    this.loyalty = r.float(); // probabilidad de no traicionar por oportunismo
    this.nextDiplomacy = CONFIG.spawnTicks + CONFIG.botDiplomacyStartTicks + r.int(0, 300);
    /** Naciones que le traicionaron: no vuelve a aliarse y prefiere atacarlas. */
    this.grudges = new Set();
  }

  think() {
    const g = this.game;
    const p = this.player;
    const r = g.rng;
    const max = p.maxTroops();
    const summary = g.neighborSummary(p);
    const { wild, coastal } = summary;
    // Los aliados no cuentan como objetivos
    const counts = new Map([...summary.counts].filter(([id]) => !p.allies.has(id)));

    // 0. Diplomacia y construcción (no gastan tropas propias de ataque)
    if (g.ticks >= this.nextDiplomacy) {
      this.nextDiplomacy = g.ticks + r.int(250, 600);
      this._diplomacyTurn(summary.counts);
    }
    if (this._helpAllies(max)) return;
    this._maybeBuild(counts, coastal);
    if (p.active.silo && r.chance(0.15 + this.aggression * 0.2)) this._fireMissile(counts);

    // 1. Expandirse por tierra libre mientras la haya
    if (wild > 0 && !p.attacks.has(0) && p.troops > max * 0.1) {
      g.launchAttack(p, 0, Math.floor(p.troops * this.expandRatio));
      return;
    }

    // 2. Atacar al vecino más débil cuando haya reunido suficientes tropas
    if (counts.size > 0 && p.troops > max * (0.6 - this.aggression * 0.35)) {
      let best = null;
      let bestScore = Infinity;
      const leader = g.leader();
      const leaderShare = leader ? leader.tiles / g.map.landCount : 0;
      for (const [id, shared] of counts) {
        const t = g.players[id];
        // Preferimos objetivos débiles y con mucha frontera compartida
        let score = t.troops / Math.max(1, p.troops) - Math.min(shared, 200) * 0.001 + r.float() * 0.3;
        if (t === leader && leaderShare > 0.3) score -= 0.4; // todos contra el líder
        if (this.grudges.has(id)) score -= 0.3;
        if (g.isTraitor(t)) score -= 0.2;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best && !p.attacks.has(best.id) && best.troops < p.troops * (0.5 + this.aggression * 0.7)) {
        g.launchAttack(p, best.id, Math.floor(p.troops * (0.25 + this.aggression * 0.35)));
        return;
      }
    }

    // 3. Sin tierra libre a mano: probar suerte por mar
    if (wild === 0 && coastal && p.boatCount === 0 && p.troops > max * 0.4 && r.chance(0.25)) {
      const tile = this._pickBoatTarget();
      if (tile >= 0) g.launchBoat(p, tile, Math.floor(p.troops * 0.35));
    }
  }

  /**
   * Prioridades: fortaleza si un vecino le supera claramente, luego ciudades
   * (ahorra para ellas) y puertos si es costero y ya tiene alguna ciudad.
   */
  _maybeBuild(counts, coastal) {
    const g = this.game;
    const p = this.player;
    if (p.tiles < 120 * AREA) return false;

    let threat = null;
    for (const id of counts.keys()) {
      const t = g.players[id];
      if (p.allies.has(id)) continue;
      if (t.troops > p.troops * 1.3 && (!threat || t.troops > threat.troops)) threat = t;
    }

    // ¿Hay algún silo enemigo que nos alcance? Entonces conviene tener antimisiles
    const map = g.map;
    const reach = CONFIG.missileRange * CONFIG.missileRange;
    const enemySilos = p.spawnTile >= 0 && g.buildings.some((b) => {
      if (b.kind !== 'silo' || b.owner === p.id || p.allies.has(b.owner)) return false;
      const dx = map.x(b.tile) - map.x(p.spawnTile);
      const dy = map.y(b.tile) - map.y(p.spawnTile);
      return dx * dx + dy * dy <= reach;
    });

    // Ciudades: con tope (los precios se inflan con cada compra); pasado el tope, mejora
    let want = 'city';
    if (threat && p.buildings.fort < 1 + Math.floor(p.tiles / (2500 * AREA))) want = 'fort';
    else if (this.saveFor) want = this.saveFor;
    // La primera fábrica (y sus trenes) en cuanto tiene un par de ciudades
    else if (p.buildings.city >= 2 && p.buildings.factory < 1 && g.rng.chance(0.6)) want = 'factory';
    else if (enemySilos && p.buildings.sam < 1 + Math.floor(p.tiles / (6000 * AREA)) && p.buildings.city >= 1 && g.rng.chance(0.4)) want = 'sam';
    else if (coastal && p.buildings.city >= 1 && p.buildings.port < 1 + Math.floor(p.tiles / (5000 * AREA)) && g.rng.chance(0.4)) want = 'port';
    else if (p.buildings.city >= 1 && p.buildings.factory < 1 + Math.floor(p.tiles / (3000 * AREA)) && g.rng.chance(0.35)) want = 'factory';
    else if (p.tiles > 2000 * AREA && p.buildings.silo < 1 && p.buildings.city >= 2 && g.rng.chance(this.aggression * 0.4)) want = 'silo';
    else if (p.active.port > 0 && p.buildings.warship < p.active.port && p.buildings.city >= 2 && g.rng.chance(0.25 + this.aggression * 0.3)) want = 'warship';

    if (want === 'warship') {
      if (p.gold < g.buildCost(p, want)) return false;
      const port = g.buildings.find((b) => b.owner === p.id && b.kind === 'port' && b.level > 0);
      if (!port) return false;
      // La zona se elige al botarlo: después ya no se puede cambiar
      const zone = this._warshipZone(port);
      return g.build(p, 'warship', zone >= 0 ? zone : port.tile);
    }
    // A veces mejora uno que ya tiene en vez de levantar otro (sale más barato).
    // Si ya tiene todas las ciudades que quería, solo mejora.
    const capped = want === 'city' && p.buildings.city >= 2 + Math.floor(p.tiles / (1500 * AREA));
    if (want !== 'sam' && (capped || g.rng.chance(0.4))) {
      // Con el tope de ciudades, mejora la ciudad o fábrica de menor nivel
      const kinds = capped ? ['city', 'factory'] : [want];
      let own = null;
      for (const b of g.buildings) {
        if (b.owner !== p.id || !kinds.includes(b.kind) || !b.level || b.target || b.level >= CONFIG.maxLevel) continue;
        if (!own || b.level < own.level) own = b;
      }
      if (own) want = own.kind;
      if (own && g.canBuild(p, want, own.tile).ok) return g.build(p, want, own.tile);
      if (capped) return false;
    }
    if (p.gold < g.buildCost(p, want)) {
      // Fábricas y puertos son caros: ahorra para ellos en vez de gastar en otra cosa
      if (want === 'factory' || want === 'port') this.saveFor = want;
      return false;
    }
    const tile = this._pickBuildTile(want, threat);
    const ok = tile >= 0 && g.build(p, want, tile);
    if (ok || tile < 0) this.saveFor = null;
    return ok;
  }

  _pickBuildTile(kind, threat) {
    const g = this.game;
    const map = g.map;
    const p = this.player;
    const r = g.rng;

    if (kind === 'fort' && threat) {
      // Cerca del frente con el vecino peligroso, pero un poco hacia dentro
      const front = [];
      const nb = new Int32Array(4);
      for (const t of p.border) {
        const c = map.neighbors(t, nb);
        for (let k = 0; k < c; k++) if (g.owner[nb[k]] === threat.id) front.push(t);
        if (front.length > 200) break;
      }
      for (let i = 0; i < 20 && front.length; i++) {
        const t = front[r.int(0, front.length - 1)];
        const x = map.x(t) + r.int(-4 * RES, 4 * RES);
        const y = map.y(t) + r.int(-4 * RES, 4 * RES);
        if (!map.inBounds(x, y)) continue;
        const cand = map.index(x, y);
        if (!p.border.has(cand) && g.canBuild(p, kind, cand).ok) return cand;
      }
      return -1;
    }

    let pool = map.landTiles;
    if (kind === 'port') {
      // Solo su propia costa (elegir al azar entre toda la del mapa casi nunca acertaba)
      pool = map.coastTiles.filter((t) => g.owner[t] === p.id);
      if (!pool.length) return -1;
    }
    for (let i = 0; i < 150; i++) {
      const t = pool[r.int(0, pool.length - 1)];
      if (g.owner[t] !== p.id) continue;
      if (kind === 'city' && p.border.has(t)) continue;
      if (g.canBuild(p, kind, t).ok) return t;
    }
    return -1;
  }

  // ------------------------------------------------------------- diplomacia

  /** Rompe alianzas que ya no le convienen y propone otras nuevas. */
  _diplomacyTurn(counts) {
    const g = this.game;
    const p = this.player;
    const r = g.rng;
    const leader = g.leader();
    const share = leader ? leader.tiles / g.map.landCount : 0;

    for (const id of [...p.allies]) {
      const ally = g.players[id];
      // Nadie quiere ayudar a que otro gane
      if (ally === leader && share > 0.35 && r.chance(0.5)) {
        g.breakAlliance(p, ally);
        return;
      }
      // Traición oportunista contra un aliado vecino muy debilitado
      if (counts.has(id) && ally.troops < p.troops * 0.35 && r.chance((1 - this.loyalty) * this.aggression * 0.3)) {
        g.breakAlliance(p, ally);
        return;
      }
    }

    if (p.allies.size >= CONFIG.maxAllies || !r.chance(0.2 + this.diplomacy * 0.6)) return;
    let best = null;
    let bestScore = -Infinity;
    const candidates = new Set(counts.keys());
    for (let i = 0; i < 4; i++) {
      const other = g.players[r.int(1, g.players.length - 1)];
      if (other.alive) candidates.add(other.id);
    }
    const leaderNeighbors = leader ? g.neighborSummary(leader).counts : new Map();
    for (const id of candidates) {
      const other = g.players[id];
      if (other === p || !g.canPropose(p, other).ok) continue;
      if (this.grudges.has(id) || g.isTraitor(other)) continue;
      if (other === leader && share > 0.25) continue;
      let score = r.float() * 0.5 - other.betrayals * 0.3;
      if (counts.has(id)) score += 0.4; // vecino: la paz da tranquilidad
      if (leaderNeighbors.has(p.id) && leaderNeighbors.has(id)) score += 0.6; // enemigo común
      const ratio = other.troops / Math.max(1, p.troops);
      if (ratio > 0.5 && ratio < 2) score += 0.3; // de su talla
      if (score > bestScore) {
        bestScore = score;
        best = other;
      }
    }
    if (best && bestScore > 0.3) g.proposeAlliance(p, best);
  }

  /** Decide si acepta la propuesta de alianza de `from`. */
  wantsAlliance(from) {
    const g = this.game;
    const p = this.player;
    if (p.allies.size >= CONFIG.maxAllies || this.grudges.has(from.id) || g.isTraitor(from)) return false;
    const leader = g.leader();
    const share = leader ? leader.tiles / g.map.landCount : 0;
    const neighbors = g.neighborSummary(p).counts;
    let score = 0.2 + this.diplomacy * 0.5 - from.betrayals * 0.25;
    if (from === leader && share > 0.3) score -= 0.5;
    if (neighbors.has(from.id) && from.troops > p.troops * 1.5) score += 0.3; // mejor tenerlo de amigo
    if (from.attacks.has(p.id) && from.troops > p.troops) score += 0.2; // pedir la paz si va perdiendo
    if (leader && leader !== from && leader !== p) {
      const ln = g.neighborSummary(leader).counts;
      if (ln.has(p.id) && ln.has(from.id)) score += 0.3;
    }
    return g.rng.float() < Math.min(0.95, Math.max(0.05, score));
  }

  /** Si un aliado está siendo atacado y le sobran tropas, le envía refuerzos. */
  _helpAllies(max) {
    const g = this.game;
    const p = this.player;
    if (!p.allies.size || p.troops < max * 0.75 || !g.rng.chance(0.15)) return false;
    for (const atk of g.attacks) {
      if (atk.done || !p.allies.has(atk.targetId) || p.allies.has(atk.attacker.id)) continue;
      return g.donate(p, g.players[atk.targetId], 'troops', 0.15);
    }
    return false;
  }

  onAllied(other) {
    if (this.game.rng.chance(0.5)) this.game.sendEmoji(this.player, other.id, '🤝');
  }

  onRejected(by) {
    if (this.game.rng.chance(0.3 * this.aggression)) this.game.sendEmoji(this.player, by.id, '👎');
  }

  onBetrayed(by) {
    this.grudges.add(by.id);
    this.game.sendEmoji(this.player, by.id, '😠');
  }

  onEmoji(from, emoji) {
    const g = this.game;
    if (!g.rng.chance(0.3)) return;
    const pool = HOSTILE.includes(emoji) || this.grudges.has(from.id) ? HOSTILE : FRIENDLY;
    g.sendEmoji(this.player, from.id, g.rng.pick(pool));
  }

  /**
   * Lanza un misil contra el líder (si se escapa) o contra el vecino más
   * fuerte o rencoroso. Apunta primero a sus antimisiles, ciudades y fortalezas.
   */
  _fireMissile(counts) {
    const g = this.game;
    const p = this.player;
    if (p.gold < g.buildCost(p, 'missile') * 1.2) return false;
    const leader = g.leader();
    const share = leader ? leader.tiles / g.map.landCount : 0;
    let enemy = null;
    if (leader && leader !== p && share > 0.25 && !p.allies.has(leader.id)) enemy = leader;
    if (!enemy) {
      let best = -Infinity;
      for (const id of counts.keys()) {
        const t = g.players[id];
        const score = t.troops + (this.grudges.has(id) ? 1e6 : 0);
        if (score > best) {
          best = score;
          enemy = t;
        }
      }
    }
    if (!enemy) return false;
    const priority = { sam: 0, city: 1, fort: 2, silo: 3, factory: 4, port: 5 };
    const targets = g.buildings
      .filter((b) => b.owner === enemy.id && b.kind in priority)
      .sort((a, b) => priority[a.kind] - priority[b.kind]);
    for (const b of targets) {
      if (g.canBuild(p, 'missile', b.tile).ok) return g.build(p, 'missile', b.tile);
    }
    // Sin edificios a tiro: el centro de su territorio
    if (enemy.spawnTile >= 0 && g.canBuild(p, 'missile', enemy.spawnTile).ok) return g.build(p, 'missile', enemy.spawnTile);
    return false;
  }

  /**
   * Zona para un buque nuevo (no se podrá cambiar): casi siempre junto a un
   * puerto propio (defensa) y, si es agresivo, junto a un puerto enemigo
   * cercano para quedarse sus pesqueros y mercantes.
   */
  _warshipZone(port) {
    const g = this.game;
    const p = this.player;
    const map = g.map;
    const r = g.rng;
    if (!port || port.water < 0) return -1;
    const sea = map.waterBody[port.water];
    const d2 = (a, b) => (map.x(a) - map.x(b)) ** 2 + (map.y(a) - map.y(b)) ** 2;
    const ports = g.buildings.filter((b) => b.kind === 'port' && b.level > 0 && b.water >= 0 && map.waterBody[b.water] === sea);
    const own = ports.filter((b) => b.owner === p.id);
    const enemy = ports.filter((b) => b.owner !== p.id && !p.allies.has(b.owner) && d2(b.water, port.water) < (140 * RES) ** 2);
    const pick = enemy.length && r.chance(0.3 + this.aggression * 0.3) ? r.pick(enemy) : own.length ? r.pick(own) : null;
    return pick ? pick.water : port.water;
  }

  /** Elige una costa ajena débil, preferiblemente cercana. */
  _pickBoatTarget() {
    const g = this.game;
    const map = g.map;
    const coast = map.coastTiles;
    const p = this.player;
    if (!coast.length) return -1;
    const ox = map.x(p.spawnTile);
    const oy = map.y(p.spawnTile);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < 16; i++) {
      const t = coast[g.rng.int(0, coast.length - 1)];
      const o = g.owner[t];
      if (o === p.id || p.allies.has(o)) continue;
      const strength = o === 0 ? 0 : g.players[o].troops / Math.max(1, p.troops);
      if (strength > 0.6) continue;
      const dx = map.x(t) - ox;
      const dy = map.y(t) - oy;
      // Solo costas al alcance de un desembarco (las lejanas casi nunca tienen ruta)
      if (dx * dx + dy * dy > (110 * RES) ** 2) continue;
      const dist = Math.sqrt(dx * dx + dy * dy) / map.width;
      const score = strength + dist;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}

/**
 * Cerebro de una colonia: solo se expande por tierra libre. No ataca a las
 * naciones, no construye y no firma alianzas: es una presa fácil con oro.
 */
export class ColonyBrain {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.nextThink = 0;
    this.thinkScale = 1.6;
    this.grudges = new Set();
  }

  think() {
    const g = this.game;
    const p = this.player;
    // Lo barato primero: solo se mira la frontera si de verdad puede expandirse
    if (!p.attacks.has(0) && p.troops > p.maxTroops() * 0.25 && g.hasWildNeighbor(p)) {
      g.launchAttack(p, 0, Math.floor(p.troops * 0.2));
    }
  }

  wantsAlliance() {
    return false;
  }

  onRejected() {}
  onAllied() {}
  onBetrayed() {}
  onEmoji() {}
}
