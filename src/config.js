// Parámetros de equilibrio del juego. Todo lo "ajustable" vive aquí para poder
// iterar sobre la jugabilidad sin tocar la lógica.

export const TICK_MS = 100; // 10 ticks por segundo de simulación

/**
 * Resolución del mapa: casillas por cada casilla de la rejilla original, en
 * cada eje. Los valores de abajo están pensados para la rejilla original y se
 * adaptan con estos factores: distancias y velocidades × RES, valores por
 * casilla ÷ AREA (así una misma superficie vale lo mismo en tropas y oro).
 */
export const RES = 2;
export const AREA = RES * RES;
const RES15 = RES * Math.sqrt(RES); // (AREA)^0,75: para fórmulas con casillas^0,75

export const TERRAIN = { WATER: 0, PLAINS: 1, HIGHLAND: 2, MOUNTAIN: 3 };
export const TERRAIN_NAMES = ['Agua', 'Llanura', 'Meseta', 'Montaña'];

export const CONFIG = {
  // Fase inicial: los jugadores eligen dónde aparecer
  spawnTicks: 100, // 10 s
  spawnRadius: 4 * RES,
  startTroops: 1500,
  minSpawnBodySize: 150 * AREA, // no se puede empezar en islotes minúsculos

  // Victoria: controlar esta fracción de toda la tierra
  winLandShare: 0.7,

  // Tropas: máximo y crecimiento por tick (un 40 % menos que al principio:
  // menos tropas en el mapa y crecen más despacio)
  maxTroopsBase: 1200,
  maxTroopsPerTile: 36 / AREA,
  growthBase: 6,
  growthTileMult: 0.3 / RES15, // × casillas^0,75

  // Ataques
  terrainCost: [Infinity, 1.0, 1.4, 2.0], // indexado por TERRAIN
  wildTileCost: 2 / AREA, // tropas por casilla de tierra libre (llanura)
  playerTileBaseCost: 1 / AREA, // coste fijo por casilla enemiga
  defenseDensityMult: 0.75, // coste extra por cada tropa/casilla del defensor
  defenderLossMult: 0.8, // tropas que pierde el defensor por casilla perdida (× densidad)
  attackRateWild: 0.1 * RES, // casillas por tick por casilla de frente (tierra libre)
  attackRatePlayer: 0.04 * RES, // ídem contra jugadores (se escala con la superioridad)
  minAttackBudget: 0.25 * RES,

  // Barcos de transporte
  maxBoats: 3, // barcos de transporte de tropas a la vez (los puertos no suman)
  boatSpeed: 0.8 * RES, // casillas por tick

  // Oro: ingreso por tick = base + casillas^0,75 × mult (× bonus de puertos)
  startGold: 0,
  goldBase: 50,
  goldTileMult: 1.4 / RES15,
  plunderShare: 1, // fracción del oro del eliminado que se lleva quien le quita la última casilla
  tileLootShare: 1, // al conquistar una casilla te llevas su parte del oro del país (oro ÷ casillas)

  // Colonias: bots débiles que no son naciones (presa fácil con oro que saquear)
  colonyStrength: 0.45, // tropas máximas y crecimiento respecto a una nación
  colonyDefenseMult: 0.55, // conquistarlas cuesta menos
  colonySpawnRadius: 2 * RES,

  // Edificios
  buildingMinDist: 5 * RES, // casillas mínimas entre dos edificios
  portSnap: 6 * RES, // el puerto se coloca en la orilla propia más cercana al clic (hasta esta distancia)
  cityMaxTroops: 9000, // tropas máximas extra por nivel de ciudad
  portGoldBonus: 0.1, // +10% de oro por puerto
  factoryGoldBonus: 0.25, // +25% de oro por fábrica
  fortRadius: 10 * RES,
  fortDefenseMult: 2.5, // coste y tiempo de conquista dentro del radio
  // Precios, niveles y obras
  inflation: 0.12, // cada compra (edificio, mejora o buque) encarece un 12 % todo lo demás; no afecta a misiles, silos ni antimisiles
  maxLevel: 5,
  upgradeCostMult: 0.8, // subir al nivel n+1 cuesta: precio actual × 0,8 × n
  upgradeTimeMult: 0.8, // y tarda el 80 % de la obra nueva
  // Efecto de cada nivel por encima del 1: ciudad +15k tropas, puerto +10 % de
  // oro y un pesquero más, fábrica +25 % de oro, fortaleza +2 de radio y +0,4 de
  // defensa, silo −15 % de recarga, antimisiles +3 de radio y +7 % de acierto
  fortRadiusPerLevel: 2 * RES,
  fortMultPerLevel: 0.4,
  siloReloadPerLevel: 0.15,
  samRangePerLevel: 3 * RES,
  samHitPerLevel: 0.07,

  // Buques de guerra
  warshipHp: 100,
  warshipDamage: 1.5, // vida que quitan por tick a otro buque o a un puerto
  warshipRange: 9 * RES, // casillas
  warshipSpeed: 0.7 * RES, // casillas por tick
  warshipsPerPort: 3,
  portHp: 80,
  portRegen: 0.1, // vida por tick que recupera un puerto que no recibe fuego

  // Economía naval: barcos automáticos de los puertos
  fishPerPort: 2, // pesqueros por puerto
  fishGold: 37.5, // oro por tick de cada pesquero
  fishRange: 14 * RES, // casillas alrededor del puerto donde faenan
  fishSpeed: 0.4 * RES,
  tradeEveryMin: 200, // ticks entre mercantes de un mismo puerto
  tradeEveryMax: 400,
  tradeGoldPerTile: 450 / RES, // oro por casilla de ruta, al llegar
  tradeReceiverShare: 0.5, // parte para el dueño del puerto de destino
  tradeSpeed: 0.6 * RES,

  // Misiles y antimisiles
  missileRadius: 8 * RES, // casillas arrasadas alrededor del impacto
  missileSpeed: 3 * RES, // casillas por tick
  missileRange: 220 * RES, // distancia máxima desde el silo
  siloReload: 150, // ticks entre lanzamientos de un mismo silo
  missileTroopLoss: 1.2, // × densidad del defensor por casilla arrasada
  samRange: 22 * RES, // radio de intercepción de una batería
  samReload: 80, // ticks entre disparos de una batería
  samHitChance: 0.6, // probabilidad de derribar el misil al disparar

  // Diplomacia
  maxAllies: 3,
  allianceRequestTicks: 150, // 15 s para responder a una propuesta
  rejectCooldownTicks: 600, // 1 min sin poder volver a proponer a quien te rechazó
  traitorTicks: 600, // 1 min marcado como traidor tras romper una alianza
  traitorDefenseMult: 0.6, // conquistar a un traidor cuesta menos
  emojiTicks: 40, // cuánto dura una burbuja de emoji
  emojiCooldownTicks: 20,

  // Bots
  botThinkMin: 6,
  botThinkMax: 20,
  botDiplomacyStartTicks: 600, // empiezan a negociar al minuto de juego
};

/** Reglas que se eligen al crear la partida (también en las salas online). */
export const DEFAULT_RULES = { winShare: 0.7, startGold: 0, missiles: true, warships: true };
export const WIN_SHARES = [0.5, 0.7, 0.9];
export const START_GOLDS = [0, 250000, 1250000];

/** Normaliza reglas venidas de fuera (perfil, red). */
export function cleanRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    winShare: WIN_SHARES.includes(r.winShare) ? r.winShare : DEFAULT_RULES.winShare,
    startGold: START_GOLDS.includes(r.startGold) ? r.startGold : DEFAULT_RULES.startGold,
    missiles: r.missiles !== false,
    warships: r.warships !== false,
  };
}

export const EMOJIS = ['👍', '👎', '🤝', '😠', '😂', '😢', '🔥', '⚔️', '🏳️', '❤️'];

/**
 * Tipos de edificio. `base`: precio sin inflación; `build`: ticks de obra
 * (100 ms cada uno); `fixed`: precio fijo, sin inflación.
 */
export const BUILDINGS = {
  city: { name: 'Ciudad', fem: true, base: 125000, build: 50, key: 'KeyQ', desc: '+9k tropas máximas por nivel' },
  port: { name: 'Puerto', fem: false, base: 100000, build: 60, key: 'KeyE', coastal: true, desc: 'Pesqueros, mercantes y +10% de oro' },
  fort: { name: 'Fortaleza', fem: true, base: 75000, build: 40, key: 'KeyR', desc: 'Defensa ×2,5 alrededor' },
  factory: { name: 'Fábrica', fem: true, base: 150000, build: 60, key: 'KeyF', desc: '+25% de oro por nivel' },
  silo: { name: 'Silo', fem: false, base: 1000000, build: 90, key: 'KeyG', fixed: true, desc: 'Permite lanzar misiles' },
  sam: { name: 'Antimisiles', fem: false, base: 1500000, build: 160, key: 'KeyH', fixed: true, desc: 'Derriba misiles enemigos cercanos' },
  // No son edificios: el buque se bota desde un puerto y el misil sale de un silo
  warship: { name: 'Buque', fem: false, base: 150000, build: 0, key: 'KeyT', unit: 'ship', desc: 'Hunde barcos y bombardea puertos' },
  missile: { name: 'Misil', fem: false, base: 500000, build: 0, key: 'KeyM', unit: 'missile', fixed: true, desc: 'Arrasa una zona enemiga' },
};
/** Edificios de verdad (no unidades). */
export const STRUCTURE_KINDS = ['city', 'port', 'fort', 'factory', 'silo', 'sam'];
export const BUILDING_KINDS = Object.keys(BUILDINGS);

/** Mapas aleatorios (generados con la semilla). */
export const MAP_SIZES = {
  pequeno: { w: 360 * RES, h: 210 * RES, label: 'Pequeño' },
  mediano: { w: 520 * RES, h: 300 * RES, label: 'Mediano' },
  grande: { w: 720 * RES, h: 420 * RES, label: 'Grande' },
};

/** Mapas del mundo real (datos en mapas-reales.js); los bots son países. */
export const REAL_MAPS = {
  mundo: 'Mundo',
  europa: 'Europa',
  norteamerica: 'Norteamérica',
  sudamerica: 'Sudamérica',
  africa: 'África',
  asia: 'Asia',
};

export const MAP_IDS = [...Object.keys(REAL_MAPS), ...Object.keys(MAP_SIZES)];

export function mapLabel(id) {
  return REAL_MAPS[id] || (MAP_SIZES[id] && MAP_SIZES[id].label) || '—';
}
