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
