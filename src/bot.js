// IA de las naciones controladas por el ordenador. Cada bot tiene una
// "personalidad" (agresividad, ritmo de expansión, diplomacia, lealtad) y
// piensa cada pocos ticks.
import { AREA, CONFIG, RES } from './config.js';
import { TECHS, TECH_IDS, techAvailable } from './tecnologias.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Las heurísticas se ajustaron con RES 2: medidas en casillas de entonces
const DOC_LEN = RES / 2;
const DOC_AREA = DOC_LEN * DOC_LEN;

const FRIENDLY = ['👍', '🤝', '❤️', '😂'];
const HOSTILE = ['😠', '⚔️', '👎', '🔥'];

export class BotBrain {
  constructor(game, player, difficulty = 'normal') {
    const r = game.rng;
    this.game = game;
    this.player = player;
    this.nextThink = 0;
    // Dificultad: cada cuánto piensan y cuánto les gusta atacar
    // (piensan cada x, agresividad, cuánto se defienden con contraataques)
    const level = { facil: [1.6, 0.65, 0.25], normal: [0.85, 1, 0.7], dificil: [0.6, 1.2, 1], imposible: [0.45, 1.35, 1] }[difficulty] || [0.85, 1, 0.7];
    this.thinkScale = level[0];
    this.aggression = Math.min(1, (0.4 + r.float() * 0.5) * level[1]);
    this.cunning = level[2];
    this.expandRatio = 0.3 + r.float() * 0.06;
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
    // Ni los aliados, ni quien tiene un pacto o la paz con ella, ni (durante
    // la tregua) las otras naciones cuentan como objetivos: si no, elegía uno
    // que no podía atacar y se quedaba sin atacar a nadie
    const truce = g.inTruce() && !p.weak;
    const counts = new Map(
      [...summary.counts].filter(([id]) => {
        if (p.allies.has(id) || g.pactBetween(p.id, id)) return false;
        const t = g.players[id];
        return !(truce && t && !t.weak);
      }),
    );

    // 0. Diplomacia y construcción (no gastan tropas propias de ataque)
    if (g.ticks >= this.nextDiplomacy) {
      this.nextDiplomacy = g.ticks + r.int(250, 600);
      this._diplomacyTurn(summary.counts);
    }
    // Solo con la economía de trabajadores hay reparto que elegir
    if (p.economy === 'workers') this._chooseShare(wild, counts, max);
    if (this._helpAllies(max)) return;
    this._develop();
    this._maybeBuild(counts, coastal);
    if (p.active.silo && r.chance(0.2 + this.aggression * 0.25)) this._fireMissile(counts);

    // 0. Defensa activa: si le atacan con fuerza, contraataca con lo justo para
    // anular la ofensiva (las tropas de dos ataques cruzados se anulan)
    if (this._counterAttack()) return;

    // 1. Expandirse por tierra libre mientras la haya
    // (si la ofensiva sigue pero le quedan pocas tropas, la refuerza: con pocas
    // tropas avanza muy despacio y el crecimiento iría a tirones)
    const wildAtk = p.attacks.get(0);
    const starving = wildAtk && !wildAtk.done && wildAtk.troops < Math.max(2000, max * 0.04);
    if (wild > 0 && (!wildAtk || wildAtk.done || starving) && p.population() > max * 0.15) {
      // En todas direcciones y con la misma parte de las tropas: todas las
      // naciones crecen parejas, en círculo, al empezar
      g.launchAttack(p, 0, Math.floor(p.troops * this.expandRatio));
      // Los agresivos no esperan a acabar: atacan a la vez a un vecino débil
      if (!(counts.size && r.chance(this.aggression - 0.35))) return;
    }

    // 2. Guerra: con lo que sobre por encima de ~la mitad del máximo, contra el
    // vecino que mejor se pueda ganar (o reforzando un ataque que se agota)
    if (this._attackTurn(counts, max)) return;

    // 3. Sin tierra libre a mano: probar suerte por mar
    // (sin vecinos por tierra, más a menudo y más lejos: si no, un líder
    // rodeado de mar se queda atascado sin poder cruzar el océano)
    const landlocked = counts.size === 0;
    if (wild === 0 && coastal && g.ticks >= (this.boatRetryAt || 0) && p.boatCount < (landlocked ? p.maxBoats() : 1) && p.troops > max * 0.3 && r.chance(landlocked ? 0.6 : 0.25)) {
      // Sin puerto no hay barcos: primero hay que construirlo
      if (!p.active.port) {
        if (!p.buildings.port) this.needPort = true;
        return;
      }
      const tile = this._pickBoatTarget(landlocked);
      // Si no hay ruta, espera 20 s antes de volver a buscar (cada búsqueda
      // fallida recorre mucho mar y daba tirones)
      if (tile >= 0 && !g.launchBoat(p, tile, Math.floor(p.troops * (landlocked ? 0.45 : 0.35)))) this.boatRetryAt = g.ticks + 200;
    }
  }

  /**
   * Reparto entre soldados y trabajadores según la fase: expansión inicial
   * 80 % soldados, guerra 85 %, fronteras tranquilas 60 % y, si ahorra para
   * un edificio sin amenazas cerca, economía 40 % (más trabajadores, más oro).
   */
  _chooseShare(wild, counts, max) {
    const g = this.game;
    const p = this.player;
    let war = false;
    for (const [id, atk] of p.attacks) if (id && !atk.done) war = true;
    for (const atk of g.attacks) {
      if (!war && !atk.done && atk.targetId === p.id && atk.troops > p.troops * 0.1) war = true;
    }
    let threat = false;
    for (const id of counts.keys()) {
      if (g.players[id].troops > p.troops * 0.8) threat = true;
    }
    let share;
    if (war) share = 0.85;
    else if (wild > 0) share = 0.8;
    else if (threat) share = 0.65;
    else if (this.saveFor || p.population() > max * 0.5) share = 0.4;
    else share = 0.6;
    // Los más agresivos tiran algo más a soldados
    g.setSoldierShare(p, share + (this.aggression - 0.6) * 0.1);
  }

  /** Valor de los puntos estratégicos de `t` como objetivo (capitales sobre todo). */
  _pointValue(t) {
    const g = this.game;
    let v = 0;
    for (const pt of g.points) {
      if (g.owner[pt.tile] !== t.id) continue;
      v += pt.kind === 'capital' ? 0.3 : 0.15;
    }
    return Math.min(0.9, v);
  }

  /**
   * Tecnologías y especialización según su carácter: los agresivos van a
   * ejército, los diplomáticos a infraestructura y el resto a economía o
   * defensa. Solo investiga con oro de sobra (no le quita los edificios).
   */
  _develop() {
    const g = this.game;
    const p = this.player;
    const r = g.rng;
    if (!g.profile.techs) return; // perfil sin tecnologías (Clásico)
    if (!p.spec && g.ticks > CONFIG.spawnTicks + 1200) {
      g.setSpec(p, this.aggression > 0.7 ? 'industria' : this.diplomacy > 0.6 ? 'infra' : 'urbano');
    }
    if (p.research || p.tiles < 120 * AREA || !r.chance(0.3)) return;
    const cost = g.techCost(p);
    if (p.gold < cost * 1.3) return;
    const order = this.aggression > 0.65 ? ['mil', 'def', 'eco'] : this.diplomacy > 0.5 ? ['eco', 'def', 'mil'] : ['def', 'eco', 'mil'];
    const options = TECH_IDS.filter((id) => techAvailable(p, id).ok);
    options.sort((a, b) => order.indexOf(TECHS[a].branch) - order.indexOf(TECHS[b].branch) || TECHS[a].tier - TECHS[b].tier);
    if (options.length) g.startResearch(p, options[r.chance(0.7) ? 0 : r.int(0, options.length - 1)]);
  }

  /** ¿Acepta un pacto de no agresión? Sí si le teme; no si `from` es su presa. */
  wantsPact(from) {
    const g = this.game;
    const p = this.player;
    if (this.grudges.has(from.id) || g.isTraitor(from)) return false;
    let score = 0.25 + this.diplomacy * 0.4 - this.aggression * 0.3;
    if (from.troops > p.troops * 1.2) score += 0.35;
    if (g.neighborSummary(p).counts.has(from.id) && from.troops < p.troops * 0.6) score -= 0.5;
    const leader = g.leader();
    if (from === leader && from.tiles / g.map.landCount > 0.3) score -= 0.5;
    return g.rng.float() < clamp(score, 0.05, 0.9);
  }

  /** ¿Acepta la paz? Sí si va perdiendo o el tributo compensa; no si va ganando. */
  wantsPeace(from, tribute = 0) {
    const g = this.game;
    const p = this.player;
    const mine = p.attacks.get(from.id);
    const theirs = from.attacks.get(p.id);
    const winning = mine && !mine.done && mine.troops > from.troops * 0.8;
    const losing = theirs && !theirs.done && theirs.troops > p.troops * 0.5;
    let score = 0.2 + this.diplomacy * 0.3 - this.aggression * 0.3 + tribute * 2;
    if (losing) score += 0.5;
    if (winning) score -= 0.5;
    if (this.grudges.has(from.id)) score -= 0.4;
    return g.rng.float() < clamp(score, 0.03, 0.95);
  }

  /** Un aliado pide ayuda contra `enemy`: le ataca si es vecino; si no, le manda tropas. */
  onHelpRequest(ally, enemy) {
    const g = this.game;
    const p = this.player;
    if (!g.rng.chance(0.4 + this.loyalty * 0.5)) return false;
    if (enemy && enemy.alive && !p.allies.has(enemy.id) && !g.pactBetween(p.id, enemy.id) && g.hasLandBorder(p, enemy.id) && p.troops > 200) {
      return g.launchAttack(p, enemy.id, Math.floor(p.troops * (0.25 + this.aggression * 0.2)));
    }
    if (p.population() < p.maxTroops() * 0.3) return false;
    return g.donate(p, ally, 'troops', 0.12);
  }

  /**
   * Contraataque: un ataque enemigo grande en curso se anula lanzando otro en
   * sentido contrario con algo más de tropas (si las tiene en casa).
   */
  _counterAttack() {
    const g = this.game;
    const p = this.player;
    if (!g.rng.chance(this.cunning)) return false;
    let worst = null;
    for (const atk of g.attacks) {
      if (atk.done || atk.targetId !== p.id || p.allies.has(atk.attacker.id)) continue;
      if (atk.troops < 150 || atk.troops < p.troops * 0.12) continue;
      if (!worst || atk.troops > worst.troops) worst = atk;
    }
    if (!worst || p.troops < worst.troops * 1.15) return false;
    const send = Math.floor(Math.min(p.troops * 0.7, worst.troops * (1.1 + this.aggression * 0.3)));
    return g.launchAttack(p, worst.attacker.id, send);
  }

  /**
   * Elige a quién atacar y con cuánto. Guarda en casa cerca de la mitad del
   * máximo (donde más rápido crecen las tropas) y lanza el resto. Prefiere
   * vecinos con pocas tropas por casilla (se conquistan barato), colonias (dan
   * oro), naciones ya en guerra con otros, traidores, rencores y, si se
   * escapa, al líder. Remata: refuerza un ataque propio que se queda corto.
   */
  _attackTurn(counts, max) {
    const g = this.game;
    const p = this.player;
    const r = g.rng;
    if (!counts.size) return false;
    // Mantiene la población hacia el 43 % del máximo (donde más crece) y
    // ataca con los soldados que sobren por encima
    const keep = max * (0.45 - this.aggression * 0.15);
    const spare = Math.min(p.troops * 0.92, p.population() - keep);
    if (spare < max * 0.05) return false;
    // Pocas guerras a la vez (los agresivos, alguna más)
    let wars = 0;
    for (const [id, atk] of p.attacks) if (id && !atk.done) wars++;
    const leader = g.leader();
    const leaderShare = leader ? leader.tiles / g.map.landCount : 0;
    // Quién está ya bajo ataque de otros (más débil de lo que parece)
    const pressed = new Map();
    for (const atk of g.attacks) {
      if (!atk.done && atk.targetId && atk.attacker !== p) pressed.set(atk.targetId, (pressed.get(atk.targetId) || 0) + atk.troops);
    }
    let best = null;
    let bestScore = -Infinity;
    for (const [id, shared] of counts) {
      const t = g.players[id];
      if (!t || !t.alive) continue;
      const mine = p.attacks.get(id);
      const ongoing = mine && !mine.done;
      if (!ongoing && wars >= 1 + Math.round(this.aggression * 1.5)) continue;
      const defense = Math.max(1, t.troops - (pressed.get(id) || 0) * 0.5);
      const odds = spare / defense;
      // Tropas por casilla de RES 2 (la misma superficie)
      const density = t.troops / Math.max(1, t.tiles / DOC_AREA);
      // Mucha tropa por casilla = cada casilla cuesta más bajas (documento, 05.2)
      let score = Math.min(odds, 4) * 0.6 - Math.min(density / 600, 1) * 0.4;
      score += Math.min(shared / DOC_LEN, 300) / 600;
      if (t.weak) score += 0.45; // colonias: presa fácil y con oro
      if (pressed.has(id)) score += 0.3;
      if (this.grudges.has(id)) score += 0.5;
      if (g.isTraitor(t)) score += 0.3;
      if (t === leader && leaderShare > 0.3) score += 0.8; // todos contra el que se escapa
      score += this._pointValue(t); // puntos estratégicos (capitales, industria…)
      if (ongoing) score += mine.troops < t.troops * 0.6 ? 0.5 : -0.6; // rematar, no amontonar
      score += r.float() * 0.25;
      // Solo si hay opciones: los agresivos se atreven con menos ventaja
      if (odds < 1.15 - this.aggression * 0.5 && !(t.weak && odds > 0.6)) continue;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (!best) return false;
    const send = Math.floor(Math.min(spare, Math.max(spare * (0.55 + this.aggression * 0.4), best.troops * 1.4)));
    return send >= 1 && g.launchAttack(p, best.id, send);
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

    // Ciudades: con tope (cada una cuesta el doble que la anterior); pasado el tope, mejora
    let want = 'city';
    // Quiere cruzar el mar y no tiene puerto: el puerto va primero (aunque no tenga ciudades)
    if (this.needPort && (p.buildings.port || !coastal)) this.needPort = false;
    if (threat && p.buildings.fort < 1 + Math.floor(p.tiles / (2500 * AREA))) want = 'fort';
    else if (this.needPort) want = 'port';
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

    // Paz si va perdiendo una guerra (a veces con tributo) y ayuda de sus aliados
    for (const atk of g.attacks) {
      if (atk.done || atk.targetId !== p.id || atk.attacker.weak) continue;
      if (atk.troops > p.troops * 0.6 && r.chance(0.35 + this.diplomacy * 0.3)) {
        if (p.allies.size && r.chance(0.5)) g.askHelp(p);
        else g.makeOffer(p, atk.attacker, 'peace', r.pick([0, 0.1, 0.25]));
        return;
      }
    }
    // Pacto de no agresión con un vecino mucho más fuerte
    for (const id of counts.keys()) {
      const t = g.players[id];
      if (t.weak || p.allies.has(id) || g.pactBetween(p.id, id)) continue;
      if (t.troops > p.troops * 1.6 && r.chance(0.2 + this.diplomacy * 0.4) && g.canOffer(p, t, 'pact').ok) {
        g.makeOffer(p, t, 'pact');
        return;
      }
    }

    if (p.allies.size >= CONFIG.maxAllies || !r.chance(0.2 + this.diplomacy * 0.6)) return;
    let best = null;
    let bestScore = -Infinity;
    // Vecinos (sin colonias) y unas cuantas naciones al azar: las colonias
    // no firman alianzas, así que proponérselas era perder el turno
    const candidates = new Set([...counts.keys()].filter((id) => g.players[id] && !g.players[id].weak));
    for (let i = 0; i < 6; i++) {
      const other = g.players[r.int(1, g.players.length - 1)];
      if (other.alive && !other.weak) candidates.add(other.id);
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
    if (!p.allies.size || p.population() < max * 0.6 || !g.rng.chance(0.15)) return false;
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
    if (leader && leader !== p && share > 0.25 && !p.allies.has(leader.id) && !g.pactBetween(p.id, leader.id)) enemy = leader;
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
    // En la fase final, con oro de sobra: MIRV contra el líder que se escapa
    // y bomba H contra un rival grande; si no, la bomba atómica
    const kinds = [];
    if (enemy === leader && share > 0.3 && p.gold >= g.buildCost(p, 'mirv') * 1.1) kinds.push('mirv');
    if (enemy.tiles > p.tiles * 0.5 && p.gold >= g.buildCost(p, 'hbomb') * 1.2) kinds.push('hbomb');
    kinds.push('missile');
    const priority = { sam: 0, city: 1, fort: 2, silo: 3, factory: 4, port: 5 };
    const targets = g.buildings
      .filter((b) => b.owner === enemy.id && b.kind in priority)
      .sort((a, b) => priority[a.kind] - priority[b.kind])
      .map((b) => b.tile);
    // Sin edificios a tiro: el centro de su territorio
    if (enemy.spawnTile >= 0) targets.push(enemy.spawnTile);
    for (const kind of kinds) {
      for (const tile of targets) {
        if (g.canBuild(p, kind, tile).ok) return g.build(p, kind, tile);
      }
    }
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
  _pickBoatTarget(far = false) {
    const g = this.game;
    const map = g.map;
    const coast = map.coastTiles;
    const p = this.player;
    if (!coast.length) return -1;
    // Desde dónde zarpa: unas cuantas casillas de su costa actual (no desde
    // donde empezó, que en un imperio grande queda tierra adentro)
    const from = [];
    const stride = Math.max(1, Math.floor(p.border.size / 400));
    let k = 0;
    for (const t of p.border) {
      if (k++ % stride || !map.coastal[t]) continue;
      from.push(t);
      if (from.length >= 12) break;
    }
    if (!from.length && p.spawnTile >= 0) from.push(p.spawnTile);
    if (!from.length) return -1;
    let best = -1;
    let bestScore = Infinity;
    const reach = (far ? 900 : 110) * RES;
    for (let i = 0; i < (far ? 40 : 16); i++) {
      const t = coast[g.rng.int(0, coast.length - 1)];
      const o = g.owner[t];
      if (o === p.id || p.allies.has(o)) continue;
      const strength = o === 0 ? 0 : g.players[o].troops / Math.max(1, p.troops);
      if (strength > 0.6) continue;
      let d2 = Infinity;
      for (const f of from) {
        const dx = map.x(t) - map.x(f);
        const dy = map.y(t) - map.y(f);
        d2 = Math.min(d2, dx * dx + dy * dy);
      }
      // Solo costas al alcance de un desembarco (las lejanas casi nunca tienen ruta)
      if (d2 > reach * reach) continue;
      const dist = Math.sqrt(d2) / map.width;
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
 * Rasgo propio de una colonia (0-1), igual en todos los equipos y sin gastar
 * el azar de la partida (así no cambia nada más de lo que pasa).
 */
function colonyTrait(game, id, k) {
  let h = (Math.imul(game.seed ^ 0x9e3779b9, 31) ^ Math.imul(id + 1, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Cerebro de una colonia: solo se expande por tierra libre. No ataca a las
 * naciones, no construye y no firma alianzas: es una presa fácil con oro.
 * Se expande casi como una nación y sin esperar a llenar su población; cada
 * una a su manera (cuánto manda, cada cuánto piensa, su ritmo y su forma).
 */
export class ColonyBrain {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.nextThink = 0;
    this.grudges = new Set();
    const t = (k) => colonyTrait(game, player.id, k);
    this.sendShare = 0.3 + t(0) * 0.15; // 30-45 % de sus tropas
    this.thinkScale = 0.75 + t(1) * 0.5; // como una nación (0,85), con variación
    player.pace = 0.8 + t(2) * 0.5; // ritmo propio en tierra libre (0,8-1,3)
    player.growNoise = CONFIG.growRandom * (0.6 + t(3) * 2.4); // de pareja a irregular
  }

  think() {
    const g = this.game;
    const p = this.player;
    // Manda tropas en cuanto no tiene expansión o la que tiene se queda sin
    // tropas (antes esperaba a tener el 30 % de su máximo y a que acabara la anterior)
    const atk = p.attacks.get(0);
    const starving = atk && atk.troops < Math.max(600, p.maxTroops() * 0.03);
    if ((!atk || starving) && p.troops > 500 && g.hasWildNeighbor(p)) {
      g.launchAttack(p, 0, Math.floor(p.troops * this.sendShare));
    }
  }

  wantsAlliance() {
    return false;
  }

  wantsPact() {
    return false;
  }

  wantsPeace() {
    return false;
  }

  onHelpRequest() {
    return false;
  }

  onRejected() {}
  onAllied() {}
  onBetrayed() {}
  onEmoji() {}
}
