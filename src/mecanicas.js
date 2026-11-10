// Mecánicas de economía, tropas y expansión según la «Especificación técnica:
// economía, tropas y expansión territorial» (v1.0, 6-11-2026). Fórmulas y
// valores del documento, en un solo sitio y versionados. Lo marcado como
// PROPUESTA es diseño propio del documento o nuestro donde la fuente no da el
// dato exacto; se puede cambiar sin tocar la lógica.
//
// Todo es determinista: las potencias y exponenciales se calculan solo con
// sumas, productos y divisiones (Math.pow, Math.exp y Math.log pueden dar
// resultados distintos según el navegador, y el multijugador necesita que
// todos los equipos calculen exactamente lo mismo).

/**
 * Versión de las reglas (para saber qué fórmulas usa una partida). doc-1.1:
 * correcciones de la revisión (Industria, Milicia, victorias, pactos, cercos,
 * comercio por superficie). En multijugador, versiones distintas no juegan juntas.
 */
export const MECH_VERSION = 'doc-1.1';

/**
 * Perfiles de reglas versionados (el ritmo y los añadidos de Trinchera). El
 * id viaja con la partida y se comprueba al empezar una sala multijugador.
 *
 * - clasico: el de FrontWars/OpenFront. Regeneración con la fórmula base
 *   (paceRegen 1: cuadra punto a punto con el HUD de FrontWars a igual reserva
 *   y techo; ver docs/calibracion-clasico.md). paceNeutral y pacePvp son
 *   PROVISIONALES (barrido en herramientas/calibrar.js) hasta tener mediciones
 *   comparables de FrontWars. clasico-2: paceNeutral a la mitad (0,5 → 0,25),
 *   a petición, porque la expansión inicial iba demasiado rápida. Sin puntos estratégicos (ni bonos ni botín de
 *   capitales) y sin tecnologías ni especializaciones.
 * - trinchera: el ritmo lento pedido antes (×0,07 tierra libre, ×0,5 guerras,
 *   ×0,6 regeneración) con puntos estratégicos y tecnologías. Es también el
 *   valor histórico: las reglas guardadas sin perfil son de este.
 *
 * paceNeutral y pacePvp multiplican el presupuesto por tick de los ataques
 * (contra tierra libre y contra países); paceRegen, la regeneración.
 */
export const PROFILES = {
  clasico: { id: 'clasico-2', name: 'Clásico', paceNeutral: 0.25, pacePvp: 1, paceRegen: 1, points: false, techs: false, provisional: ['paceNeutral', 'pacePvp'] },
  trinchera: { id: 'trinchera-1', name: 'Trinchera', paceNeutral: 0.07, pacePvp: 0.5, paceRegen: 0.6, points: true, techs: true, provisional: [] },
};

/** Perfil de unas reglas (sin perfil válido, el histórico: trinchera). */
export function profileOf(rules) {
  return PROFILES[rules && rules.profile] || PROFILES.trinchera;
}

/** Identificador de las reglas con las que se simula: versión del motor + perfil. */
export function rulesetId(rules) {
  return `${MECH_VERSION}/${profileOf(rules).id}`;
}

/** Parámetros del documento (sección 06.1, GameRules, y tablas de 01 a 07). */
export const MECH = {
  tickMs: 100,
  initialHumanTroops: 25000,
  initialBotTroops: 10000, // los «bots» del documento son nuestras colonias
  initialNationTroops: 25000, // PROPUESTA: las naciones de la IA, como un humano
  startingRadius: 4,
  startingCenterOffset: -0.5,
  baseGoldPerTickHuman: 100,
  baseGoldPerTickBot: 50,
  baseGoldPerTickNation: 100, // PROPUESTA: el documento solo da humano y bot
  // Techo de tropas: 2 × (casillas^0,6 × 1000 + 50 000) + 250 000 × niveles de ciudad
  troopCapExponent: 0.6,
  troopCapPerTile: 1000,
  troopCapBase: 50000,
  troopCapMult: 2,
  cityCapBonus: 250000,
  // Regeneración: max(0, (10 + tropas^0,73 / 4) × (1 − tropas / techo)) por tick
  regenBase: 10,
  regenExponent: 0.73,
  regenDiv: 4,
  // Bots (colonias): un tercio del techo y la mitad de regeneración
  botCapShare: 1 / 3,
  botRegenMult: 0.5,
  // Naciones de la IA según la dificultad
  nationCapByDifficulty: { facil: 0.5, normal: 0.75, dificil: 1, imposible: 1.25 },
  nationRegenByDifficulty: { facil: 0.9, normal: 0.95, dificil: 1, imposible: 1.05 },
  defaultAttackRatio: 0.2,
  economyMode: 'fixed', // 'fixed' (oro pasivo fijo) | 'workers' (variante con trabajadores)
  // Variante con trabajadores (sección 07, PROPUESTA del documento): +1 oro por tick por cada 100 trabajadores
  workersPerGold: 100,

  // Terreno (sección 05.1): coste de tiempo y magnitud de combate, por tipo
  terrain: [null, { tileCost: 16.5, mag: 80 }, { tileCost: 20, mag: 100 }, { tileCost: 25, mag: 120 }],
  // Tierra sin dueño
  neutralTimeK: 2000,
  neutralTimeMin: 5,
  neutralTimeMax: 100,
  neutralBudgetPerFront: 2, // presupuesto por tick = 2 × longitud del frente
  neutralLossDiv: 5, // bajas por casilla = magnitud / 5
  // Guerra entre países (sección 05.2)
  pvp: {
    lossBase: 0.463,
    lossPerDensity: 0.0039,
    ratioMin: 0.6,
    ratioMax: 2,
    speedMin: 0.82,
    speedMax: 7.5,
    speedHighDiv: 20,
    speedHighMax: 50,
    speedDiv: 8.55,
    traitorDebuff: 0.5, // PROPUESTA: atacar a un traidor cuesta la mitad de bajas
  },
  // Retirada (sección 05.3): efectiva a los 20 ticks; contra otro jugador se pierde el 25 %
  retreatTicks: 20,
  retreatPenalty: 0.25,
  // Cerco: bolsas sin costa encerradas por el atacante (PROPUESTA: tamaño máximo de una bolsa)
  annexMaxTiles: 600,
  annexVisitsPerTick: 60000,

  // Precios (sección 04.2)
  prices: {
    city: { base: 125000, cap: 1000000 }, // min(1M, 125k × 2^nCiudad)
    portFactory: { base: 125000, cap: 1000000 }, // escalera compartida: min(1M, 125k × 2^(nPuerto + nFábrica))
    fort: { step: 50000, cap: 250000 }, // puesto defensivo: min(250k, 50k × (n + 1))
    warship: { step: 250000, cap: 1000000 }, // min(1M, 250k × (n + 1))
    sam: { step: 1500000, cap: 3000000 }, // min(3M, 1,5M × (n + 1))
    silo: 1000000,
    missile: 750000, // bomba atómica
    hbomb: 5000000, // bomba de hidrógeno
    mirv: 25000000, // MIRV (desde 25M; sin coste extra por lanzamientos globales: no está demostrado)
  },

  // Comercio marítimo (sección 04.3, guía 2026): oro = floor((75 000 / (1 + e^(−0,03 (d − 300))) + 50 d) × mult)
  trade: {
    sigmoidMax: 75000,
    sigmoidK: 0.03,
    sigmoidMid: 300,
    perTile: 50,
    checkEvery: 10, // cada puerto consulta si sale un mercante cada 10 ticks
    // PROPUESTA (la fórmula exacta de «boost» y «saturación» depende de la versión):
    // probabilidad = 1 / max(1, floor(100 / boost² / (rechazos + 1) / saturación))
    // con boost = nivel del puerto y saturación = max(0,05, 1 − mercantes / 150)
    probBase: 100,
    saturationShips: 150,
    saturationMin: 0.05,
  },
  // Comercio ferroviario (sección 04.4, wiki OpenFront Train): oro al llegar a cada estación según la relación
  trainRewards: { self: 10000, neutral: 10000, ally: 35000, enemy: 0 },
};

// ------------------------------------------------------- matemáticas deterministas

const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

/** e^x con sumas y productos (mismo resultado en todos los navegadores). */
export function detExp(x) {
  if (x > 700) return Infinity;
  if (x < -745) return 0;
  // x = k ln2 + r, |r| ≤ ln2 / 2
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  // Taylor hasta r^16 (sobra para |r| < 0,35)
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 16; i++) {
    term = (term * r) / i;
    sum += term;
  }
  // × 2^k multiplicando por 2 (exacto)
  if (k > 0) for (let i = 0; i < k; i++) sum *= 2;
  else for (let i = 0; i < -k; i++) sum /= 2;
  return sum;
}

/** ln(x) para x > 0, con sumas y productos. */
export function detLn(x) {
  if (!(x > 0)) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m × 2^e con m en [√½, √2)
  let e = 0;
  let m = x;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  if (m > SQRT2) {
    m /= 2;
    e++;
  }
  // ln(m) = 2 atanh(u), u = (m − 1) / (m + 1), |u| ≤ 0,172
  const u = (m - 1) / (m + 1);
  const u2 = u * u;
  let term = u;
  let sum = 0;
  for (let n = 1; n <= 27; n += 2) {
    sum += term / n;
    term *= u2;
  }
  return 2 * sum + e * LN2;
}

/** x^y (x ≥ 0) determinista. */
export function detPow(x, y) {
  if (x <= 0) return 0;
  if (y === 0) return 1;
  return detExp(y * detLn(x));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------ fórmulas del documento

/** Techo de tropas (sección 03.1): no añade tropas, solo fija el límite. */
export function maxTroopsFor(tiles, cityLevels) {
  return MECH.troopCapMult * (detPow(Math.max(0, tiles), MECH.troopCapExponent) * MECH.troopCapPerTile + MECH.troopCapBase) + MECH.cityCapBonus * cityLevels;
}

/** Tropas que se generan en un tick (sección 03.2), sobre la reserva (no las desplegadas). */
export function regenPerTick(troops, cap) {
  if (cap <= 0 || troops >= cap) return 0;
  return Math.max(0, (MECH.regenBase + detPow(Math.max(0, troops), MECH.regenExponent) / MECH.regenDiv) * (1 - troops / cap));
}

/**
 * Casillas iniciales (sección 02.2): el disco lógico de radio 4 desplazado
 * (−0,5, −0,5): (x + 0,5)² + (y + 0,5)² ≤ 16 con x, y en −4..3 → 52 casillas.
 * Devuelve los desplazamientos [dx, dy] respecto a la casilla elegida.
 */
export function startOffsets() {
  const R = MECH.startingRadius;
  const o = MECH.startingCenterOffset;
  const out = [];
  for (let dy = -R; dy < R; dy++) {
    for (let dx = -R; dx < R; dx++) {
      if ((dx - o) * (dx - o) + (dy - o) * (dy - o) <= R * R) out.push([dx, dy]);
    }
  }
  return out;
}

/** Coste de tiempo de una casilla sin dueño (sección 05.1). */
export function neutralTimeCost(tileCost, attackTroops) {
  return clamp((MECH.neutralTimeK * tileCost) / Math.max(1, attackTroops), MECH.neutralTimeMin, MECH.neutralTimeMax);
}

/**
 * Combate contra otro país (sección 05.2), por casilla. `def`: tropas del
 * defensor; `atk`: tropas del ataque; `defTiles`: casillas del defensor;
 * `front`: ancho del frente. Devuelve las bajas de cada lado y la fracción de
 * tick que cuesta la casilla (sin los multiplicadores de terreno y defensa).
 */
export function pvpTile(def, atk, defTiles, front, { traitor = false, bigAttacker = 1, bigDefender = 1 } = {}) {
  const P = MECH.pvp;
  const ratio = def / Math.max(1, atk);
  const density = def / Math.max(1, defTiles);
  const attackerLossPerMag = (traitor ? P.traitorDebuff : 1) * clamp(ratio, P.ratioMin, P.ratioMax) * (P.lossBase * bigAttacker * bigDefender + P.lossPerDensity * density);
  const speedCost = (clamp(ratio, P.speedMin, P.speedMax) * clamp(ratio / P.speedHighDiv, 1, P.speedHighMax)) / P.speedDiv;
  return { ratio, attackerLossPerMag, defenderLoss: density, speedCost, perFront: speedCost / Math.max(1, front) };
}

/**
 * Bonus de imperio grande (atacante o defensor). El documento los nombra
 * pero no da su función: PROPUESTA neutra (1) hasta tener el dato.
 */
export function bigEmpireBonus() {
  return 1;
}

/** Oro de un mercante para cada propietario (sección 04.3, guía 2026). */
export function tradeGold(distance, mult = 1) {
  const T = MECH.trade;
  return Math.floor((T.sigmoidMax / (1 + detExp(-T.sigmoidK * (distance - T.sigmoidMid))) + T.perTile * distance) * mult);
}

/** Probabilidad de que un puerto lance un mercante en esta consulta (PROPUESTA del documento). */
export function tradeSpawnChance(portLevel, rejections, globalShips) {
  const T = MECH.trade;
  const boost = Math.max(1, portLevel);
  const saturation = Math.max(T.saturationMin, 1 - globalShips / T.saturationShips);
  return 1 / Math.max(1, Math.floor(T.probBase / (boost * boost) / (rejections + 1) / saturation));
}

/**
 * Precio del siguiente edificio o unidad (sección 04.2). `n`: cuántos tiene
 * ya el jugador, contando los niveles subidos (city, port, factory, fort, sam,
 * warship).
 */
export function priceFor(kind, n) {
  const P = MECH.prices;
  const pow2 = (k) => {
    let v = 1;
    for (let i = 0; i < Math.min(k, 40); i++) v *= 2;
    return v;
  };
  switch (kind) {
    case 'city':
      return Math.min(P.city.cap, P.city.base * pow2(n.city || 0));
    case 'port':
    case 'factory':
      return Math.min(P.portFactory.cap, P.portFactory.base * pow2((n.port || 0) + (n.factory || 0)));
    case 'fort':
      return Math.min(P.fort.cap, P.fort.step * ((n.fort || 0) + 1));
    case 'warship':
      return Math.min(P.warship.cap, P.warship.step * ((n.warship || 0) + 1));
    case 'sam':
      return Math.min(P.sam.cap, P.sam.step * ((n.sam || 0) + 1));
    case 'silo':
      return P.silo;
    case 'missile':
      return P.missile;
    case 'hbomb':
      return P.hbomb;
    case 'mirv':
      return P.mirv;
    default:
      return Infinity;
  }
}
