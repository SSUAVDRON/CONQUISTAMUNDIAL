// IA de las naciones controladas por el ordenador. Cada bot tiene una
// "personalidad" (agresividad, ritmo de expansión) y piensa cada pocos ticks.

export class BotBrain {
  constructor(game, player) {
    const r = game.rng;
    this.game = game;
    this.player = player;
    this.nextThink = 0;
    this.aggression = 0.2 + r.float() * 0.6;
    this.expandRatio = 0.2 + r.float() * 0.3;
  }

  think() {
    const g = this.game;
    const p = this.player;
    const r = g.rng;
    const max = p.maxTroops();
    const { wild, counts, coastal } = g.neighborSummary(p);

    // 0. Construir si hay oro (no gasta tropas, así que sigue pensando después)
    this._maybeBuild(counts, coastal);

    // 1. Expandirse por tierra libre mientras la haya
    if (wild > 0 && !p.attacks.has(0) && p.troops > max * 0.1) {
      g.launchAttack(p, 0, Math.floor(p.troops * this.expandRatio));
      return;
    }

    // 2. Atacar al vecino más débil cuando haya reunido suficientes tropas
    if (counts.size > 0 && p.troops > max * (0.6 - this.aggression * 0.35)) {
      let best = null;
      let bestScore = Infinity;
      for (const [id, shared] of counts) {
        const t = g.players[id];
        // Preferimos objetivos débiles y con mucha frontera compartida
        const score = t.troops / Math.max(1, p.troops) - Math.min(shared, 200) * 0.001 + r.float() * 0.3;
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
    if (p.tiles < 120) return false;

    let threat = null;
    for (const id of counts.keys()) {
      const t = g.players[id];
      if (t.troops > p.troops * 1.3 && (!threat || t.troops > threat.troops)) threat = t;
    }

    let want = 'city';
    if (threat && p.buildings.fort < 1 + Math.floor(p.tiles / 2500)) want = 'fort';
    else if (coastal && p.buildings.city >= 1 && p.buildings.port < 1 + Math.floor(p.tiles / 5000) && g.rng.chance(0.4)) want = 'port';

    if (p.gold < g.buildCost(p, want)) return false;
    const tile = this._pickBuildTile(want, threat);
    return tile >= 0 && g.build(p, want, tile);
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
        const x = map.x(t) + r.int(-4, 4);
        const y = map.y(t) + r.int(-4, 4);
        if (!map.inBounds(x, y)) continue;
        const cand = map.index(x, y);
        if (!p.border.has(cand) && g.canBuild(p, kind, cand).ok) return cand;
      }
      return -1;
    }

    const pool = kind === 'port' ? map.coastTiles : map.landTiles;
    for (let i = 0; i < 150; i++) {
      const t = pool[r.int(0, pool.length - 1)];
      if (g.owner[t] !== p.id) continue;
      if (kind === 'city' && p.border.has(t)) continue;
      if (g.canBuild(p, kind, t).ok) return t;
    }
    return -1;
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
      if (o === p.id) continue;
      const strength = o === 0 ? 0 : g.players[o].troops / Math.max(1, p.troops);
      if (strength > 0.6) continue;
      const dist = Math.hypot(map.x(t) - ox, map.y(t) - oy) / map.width;
      const score = strength + dist;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}
