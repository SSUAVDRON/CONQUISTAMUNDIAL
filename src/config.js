// Parámetros de equilibrio del juego. Todo lo "ajustable" vive aquí para poder
// iterar sobre la jugabilidad sin tocar la lógica.

export const TICK_MS = 100; // 10 ticks por segundo de simulación

/**
 * Resolución del mapa: casillas por cada casilla de la rejilla original, en
 * cada eje. Los valores de abajo están pensados para la rejilla original y se
 * adaptan con estos factores: distancias y velocidades × RES, valores por
 * casilla ÷ AREA (así una misma superficie vale lo mismo en tropas y oro).
 */
export const RES = 4;
export const AREA = RES * RES;
const RES15 = RES * Math.sqrt(RES); // (AREA)^0,75: para fórmulas con casillas^0,75

export const TERRAIN = { WATER: 0, PLAINS: 1, HIGHLAND: 2, MOUNTAIN: 3 };
export const TERRAIN_NAMES = ['Agua', 'Llanura', 'Meseta', 'Montaña'];

export const CONFIG = {
  // Fase inicial: los jugadores eligen dónde aparecer
  spawnTicks: 150, // 15 s para elegir dónde empezar
  spawnRadius: 2.2 * RES, // radio medio de la zona inicial (pequeña e irregular)
  spawnJag: 0.4, // el radio varía ±40 % según la dirección
  startTroops: 3500, // población inicial (repartida entre soldados y trabajadores)
  minSpawnBodySize: 150 * AREA, // no se puede empezar en islotes minúsculos

  // Victoria: controlar esta fracción de toda la tierra
  winLandShare: 0.7,

  // Población: una sola cifra P con su capacidad máxima (base + territorio +
  // ciudades). Crece G = k × (10 + P^0,75 / 4) × (1 − P / Pmáx): lo más rápido
  // hacia el 43 % del máximo, cada vez menos al acercarse y, si te pasas (has
  // perdido territorio), decrece
  maxTroopsBase: 5000,
  maxTroopsPerTile: 36 / AREA,
  popGrowthBase: 10,
  popGrowthDiv: 4,
  popGrowthScale: 0.55,
  // Reparto de la población: soldados (atacan y defienden) y trabajadores
  // (producen oro). Lo elige cada jugador; al cambiarlo, la gente cambia de
  // oficio poco a poco (como mucho shareRate de la población por turno)
  soldierShare: 0.7,
  minSoldierShare: 0.05,
  shareRate: 0.02,

  // Ataques
  terrainCost: [Infinity, 1.0, 1.4, 2.0], // indexado por TERRAIN
  wildTileCost: 55 / AREA, // tropas por casilla de tierra libre (llanura): lo que te expandes va con las tropas que mandas
  playerTileBaseCost: 1 / AREA, // coste fijo por casilla enemiga
  defenseDensityMult: 0.75, // coste extra por cada tropa/casilla del defensor
  defenderLossMult: 0.8, // tropas que pierde el defensor por casilla perdida (× densidad)
  attackRateWild: 0.03 * RES, // casillas por tick por casilla de frente (tierra libre; el frente irregular es más largo)
  attackRatePlayer: 0.04 * RES, // ídem contra jugadores (se escala con la superioridad)
  // Cuantas más tropas por casilla de frente, más rápido avanza (hasta ×3,5)
  attackSpeedMax: 3.5,
  wildTroopsRef: 10, // tropas por casilla de frente a partir de las que la expansión acelera
  minAttackBudget: 0.25 * RES,
  // Forma de la expansión (solo cambia el orden, no la velocidad): retraso en
  // «pasos» de cada casilla del frente. Lóbulos de ruido, terreno difícil y
  // azar hacen que los países crezcan irregulares y no como círculos.
  growCell: 7 * RES, // tamaño de los lóbulos
  growNoise: 10, // retraso máximo por lóbulos grandes
  growNoiseFine: 4, // y por los pequeños
  growRandom: 2.5, // azar por casilla (poco: si no, quedan casillas sueltas)
  growTerrain: 10, // por cada punto de coste de terreno por encima de la llanura
  growSmooth: 3, // prioridad a las casillas ya rodeadas: rellena huecos y esquinas antes que alargar puntas (sin brazos finos)
  // Expansión dirigida: el lado del país que mira al clic avanza antes y el de
  // detrás se retrasa hasta 2 × growFocus pasos; con algo de ruido, para que
  // el frente no salga perfecto. Poco: si no, todo el avance se iba a la punta
  // y salían brazos finos; así crece en todas direcciones, algo más hacia el clic
  growFocus: 8,
  growFocusNoise: 0.7,
  growPlayerMult: 0.15, // contra naciones, casi como antes (un frente irregular es más largo y aceleraba las guerras)

  // Barcos de transporte
  maxBoats: 3, // barcos de transporte de tropas a la vez (los puertos no suman)
  boatSpeed: 0.55 * RES, // casillas por tick

  // Oro: ingreso fijo por tick × (1 + bonus de puertos y fábricas). No depende
  // del territorio ni se gana por expandirse: el oro grande sale de conquistar
  // (cada casilla quitada se lleva su parte del oro del rival) y de eliminar
  startGold: 0,
  goldBase: 0, // sin ingreso fijo: el oro de cada turno sale de los trabajadores
  // Oro por turno = goldPerWorker × trabajadores^0,75: casi proporcional al
  // principio y con rendimiento decreciente en los imperios enormes
  goldPerWorker: 0.12,
  // Recompensa por eliminar a una nación o a una colonia (además de su oro)
  // Órdenes militares: ataque rápido (más veloz, más bajas), normal o
  // preparado (espera unos segundos y luego cuesta menos); defensa
  // fortificada (cuesta más conquistarte, pero tus ataques rinden menos)
  attackModes: {
    rapido: { speed: 1.4, cost: 1.25, wait: 0 },
    normal: { speed: 1, cost: 1, wait: 0 },
    preparado: { speed: 1, cost: 0.8, wait: 30 },
  },
  fortifiedMods: { defense: 0.4, attackCost: 0.35, attackSpeed: -0.2 },
  stanceCooldownTicks: 100, // 10 s entre cambios de postura
  autoEveryTicks: 30, // avance continuo: refuerzo cada 3 s
  // Tecnologías: cada una encarece la siguiente (×techGrowth) y tarda más
  techBase: 150000,
  techGrowth: 1.6,
  techTicks: 300,
  techTicksPer: 100,
  specChangeCost: 300000, // cambiar de especialización (la primera es gratis)
  // Diplomacia ampliada
  pactTicks: 3000, // pacto de no agresión: 5 min
  peaceTicks: 1200, // paz firmada: 2 min sin ataques entre ambos
  offerTicks: 150, // las ofertas caducan a los 15 s
  offerCooldownTicks: 600, // tras un rechazo, 1 min para volver a ofrecer lo mismo
  helpCooldownTicks: 300, // pedir ayuda: cada 30 s como mucho
  // Victorias alternativas
  capitalShare: 0.4,
  capitalHoldTicks: 600,
  economyGoalPerMin: 900000,
  economyHoldTicks: 1200,
  survivalDefaultMin: 20,
  killGoldNation: 40000,
  killGoldColony: 12000,
  // Rendimiento decreciente de puertos y fábricas: bonus = % × n / (1 + 0,12 × n)
  bonusFalloff: 0.12,
  plunderShare: 1, // fracción del oro del eliminado que se lleva quien le quita la última casilla
  tileLootShare: 1, // al conquistar una casilla te llevas su parte del oro del país (oro ÷ casillas)

  // Colonias: bots débiles que no son naciones (presa fácil con oro que saquear)
  colonyStrength: 0.45, // tropas máximas y crecimiento respecto a una nación
  colonyDefenseMult: 0.55, // conquistarlas cuesta menos
  colonySpawnRadius: 1.5 * RES,
  colonyLandPer: 500 * AREA, // una colonia por cada tantas casillas de tierra…
  colonyMax: 300, // …hasta este máximo

  // Edificios
  buildingMinDist: 5 * RES, // casillas mínimas entre dos edificios
  portSnap: 6 * RES, // el puerto se coloca en la orilla propia más cercana al clic (hasta esta distancia)
  cityMaxTroops: 25000, // capacidad de población extra por nivel de ciudad
  portGoldBonus: 0.15, // +15% de oro por puerto
  factoryGoldBonus: 0.35, // +35% de oro por fábrica (y sus trenes)
  fortRadius: 12 * RES,
  fortDefenseMult: 3, // coste y tiempo de conquista dentro del radio
  // Precios, niveles y obras
  inflation: 0.25, // cada compra (edificio, mejora o buque) encarece un 25 % todo lo demás; no afecta a misiles, silos ni antimisiles
  maxLevel: 5,
  upgradeCostMult: 0.8, // subir al nivel n+1 cuesta: precio actual × 0,8 × n
  upgradeTimeMult: 0.8, // y tarda el 80 % de la obra nueva
  // Efecto de cada nivel por encima del 1: ciudad +15k tropas, puerto +15 % de
  // oro y un pesquero más, fábrica +35 % de oro y más alcance de raíles,
  // fortaleza +2 de radio y +0,4 de defensa, silo −15 % de recarga,
  // antimisiles +3 de radio y +7 % de acierto
  fortRadiusPerLevel: 2 * RES,
  fortMultPerLevel: 0.4,
  siloReloadPerLevel: 0.15,
  samRangePerLevel: 3 * RES,
  samHitPerLevel: 0.07,

  // Buques de guerra
  warshipHp: 100,
  warshipDamage: 1.5, // vida que quitan por tick a otro buque o a un puerto
  warshipRange: 9 * RES, // casillas de alcance de tiro
  warshipSpeed: 0.5 * RES, // casillas por tick
  warshipPatrol: 22 * RES, // radio de la zona que patrulla cada buque
  warshipGuard: 34 * RES, // persigue a los intrusos que entren hasta aquí (desde el centro de su zona)
  warshipsPerPort: 3,
  portHp: 80,
  portRegen: 0.1, // vida por tick que recupera un puerto que no recibe fuego

  // Economía naval: barcos automáticos de los puertos
  fishPerPort: 2, // pesqueros por puerto
  fishGold: 50, // oro por tick de cada pesquero
  fishRange: 14 * RES, // casillas alrededor del puerto donde faenan
  fishSpeed: 0.3 * RES,
  tradeEveryMin: 200, // ticks entre mercantes de un mismo puerto
  tradeEveryMax: 400,
  tradeGoldPerTile: 450 / RES, // oro por casilla de ruta, al llegar
  tradeReceiverShare: 0.5, // parte para el dueño del puerto de destino
  tradeSpeed: 0.42 * RES,

  // Raíles y trenes de las fábricas
  railRange: 38 * RES, // alcance de los raíles de una fábrica de nivel 1 (casillas)
  railRangePerLevel: 8 * RES, // y cuánto más por cada nivel extra
  railMaxPerFactory: 6, // estaciones (ciudades y puertos) como mucho por fábrica, las más cercanas
  railRefresh: 20, // ticks entre recálculos de la red
  trainEveryMin: 150, // ticks entre trenes de un mismo raíl
  trainEveryMax: 300,
  trainSpeed: 0.8 * RES, // casillas por tick
  trainGoldBase: 3000, // oro al llegar a cada extremo del raíl…
  trainGoldPerTile: 30 / RES, // …más esto por casilla de raíl
  trainLevelBonus: 0.25, // +25 % por nivel extra de la fábrica
  trainReceiverShare: 0.5, // si la estación es de otro jugador, se lleva esta parte

  // Misiles y antimisiles
  missileRadius: 8 * RES, // casillas arrasadas alrededor del impacto
  missileSpeed: 3 * RES, // casillas por tick
  missileRange: 220 * RES, // distancia máxima desde el silo
  siloReload: 150, // ticks entre lanzamientos de un mismo silo
  missileTroopLoss: 1.2, // × densidad del defensor por casilla arrasada
  samRange: 22 * RES, // radio de intercepción de una batería
  samReload: 200, // ticks (20 s) que tarda una batería en recargar tras disparar
  samReloadPerLevel: 0.12, // cada nivel recarga un 12 % más rápido
  samHitChance: 0.65, // probabilidad de derribar el misil al disparar

  // Diplomacia
  maxAllies: 3,
  allianceRequestTicks: 150, // 15 s para responder a una propuesta
  rejectCooldownTicks: 600, // 1 min sin poder volver a proponer a quien te rechazó
  traitorTicks: 600, // 1 min marcado como traidor tras romper una alianza
  traitorDefenseMult: 0.6, // conquistar a un traidor cuesta menos
  emojiTicks: 40, // cuánto dura una burbuja de emoji
  emojiCooldownTicks: 20,

  // Bots
  botThinkMin: 5,
  botThinkMax: 16,
  botDiplomacyStartTicks: 600, // empiezan a negociar al minuto de juego
};

/** Reglas que se eligen al crear la partida (también en las salas online). */
export const DEFAULT_RULES = {
  winShare: 0.7,
  startGold: 0,
  missiles: true,
  warships: true,
  colonies: null,
  troopMult: 1, // crecimiento de tropas
  goldMult: 1, // ingresos de oro
  priceMult: 1, // precios de edificios, buques y misiles
  truceMin: 0, // minutos de tregua inicial (sin ataques entre naciones)
  timeLimitMin: 0, // minutos de partida (0 = sin límite); al acabar gana quien tenga más territorio
  alliances: true,
  boats: true, // desembarcos
  factories: true, // fábricas y trenes
  victory: 'dominio', // dominio | capitales | economia | supervivencia
  coop: false, // multijugador: cada dos jugadores llevan una misma nación
  coopRoles: false, // con roles: uno el mando militar y otro la economía y la diplomacia
};
/**
 * Modos de victoria. Dominio: el territorio de winShare. Capitales: controlar
 * el 40 % de todas las capitales durante 60 s. Economía: ingresar
 * economyGoalPerMin de oro por minuto durante 2 min. Supervivencia: al acabar
 * el tiempo (20 min si no hay límite) gana la mejor puntuación entre los vivos.
 */
export const VICTORY_MODES = ['dominio', 'capitales', 'economia', 'supervivencia'];
/** Valores permitidos de las reglas con opciones fijas. */
export const RULE_MULTS = [0.5, 1, 2];
export const TRUCE_MINS = [0, 1, 3, 5];
export const TIME_LIMITS = [0, 10, 20, 30];
export const WIN_SHARES = [0.5, 0.7, 0.9];
/** Oro inicial que se puede elegir en las partidas personalizadas (deslizador). */
export const GOLD_STEPS = [0, 100000, 250000, 500000, 1000000, 2000000, 3000000, 5000000, 10000000];

/** Normaliza reglas venidas de fuera (perfil, red). */
export function cleanRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    winShare: WIN_SHARES.includes(r.winShare) ? r.winShare : DEFAULT_RULES.winShare,
    // Cualquier cantidad entre 0 y el máximo del deslizador
    startGold: Number.isFinite(r.startGold) ? Math.max(0, Math.min(GOLD_STEPS[GOLD_STEPS.length - 1], Math.round(r.startGold))) : DEFAULT_RULES.startGold,
    missiles: r.missiles !== false,
    warships: r.warships !== false,
    // Colonias (bots débiles): null = automático según el mapa; si no, cuántas
    colonies: Number.isFinite(r.colonies) ? Math.max(0, Math.min(CONFIG.colonyMax, Math.round(r.colonies))) : null,
    troopMult: RULE_MULTS.includes(r.troopMult) ? r.troopMult : 1,
    goldMult: RULE_MULTS.includes(r.goldMult) ? r.goldMult : 1,
    priceMult: RULE_MULTS.includes(r.priceMult) ? r.priceMult : 1,
    truceMin: TRUCE_MINS.includes(r.truceMin) ? r.truceMin : 0,
    timeLimitMin: TIME_LIMITS.includes(r.timeLimitMin) ? r.timeLimitMin : 0,
    alliances: r.alliances !== false,
    boats: r.boats !== false,
    factories: r.factories !== false,
    victory: VICTORY_MODES.includes(r.victory) ? r.victory : 'dominio',
    coop: r.coop === true,
    coopRoles: r.coop === true && r.coopRoles === true,
  };
}

export const EMOJIS = ['👍', '👎', '🤝', '😠', '😂', '😢', '🔥', '⚔️', '🏳️', '❤️'];

/**
 * Tipos de edificio. `base`: precio sin inflación; `build`: ticks de obra
 * (100 ms cada uno); `fixed`: precio fijo, sin inflación.
 */
export const BUILDINGS = {
  city: { name: 'Ciudad', fem: true, base: 300000, build: 50, key: 'KeyQ', desc: '+25k de población máxima por nivel' },
  port: { name: 'Puerto', fem: false, base: 250000, build: 60, key: 'KeyE', coastal: true, desc: 'Pesqueros, mercantes y +15% de oro' },
  fort: { name: 'Fortaleza', fem: true, base: 200000, build: 40, key: 'KeyR', desc: 'Defensa ×3 alrededor' },
  factory: { name: 'Fábrica', fem: true, base: 400000, build: 60, key: 'KeyF', desc: '+35% de oro por nivel; une con raíles las ciudades y puertos cercanos (también enemigos) y sus trenes dan oro al llegar' },
  silo: { name: 'Silo', fem: false, base: 2000000, build: 90, key: 'KeyG', fixed: true, desc: 'Permite lanzar misiles' },
  sam: { name: 'Antimisiles', fem: false, base: 3000000, build: 160, key: 'KeyH', fixed: true, desc: 'Derriba misiles enemigos cercanos; recarga 20 s tras cada disparo' },
  // No son edificios: el buque se bota desde un puerto y el misil sale de un silo
  warship: { name: 'Buque', fem: false, base: 300000, build: 0, key: 'KeyT', unit: 'ship', desc: 'Clic en el mar: patrulla esa zona para siempre; hunde buques y transportes y captura barcos civiles' },
  missile: { name: 'Misil', fem: false, base: 750000, build: 0, key: 'KeyM', unit: 'missile', fixed: true, desc: 'Arrasa una zona enemiga' },
};
/** Edificios de verdad (no unidades). */
export const STRUCTURE_KINDS = ['city', 'port', 'fort', 'factory', 'silo', 'sam'];
export const BUILDING_KINDS = Object.keys(BUILDINGS);

/** Mapas aleatorios (generados con la semilla). */
/**
 * Colonias de una partida: muchas, según la tierra del mapa (una cada
 * CONFIG.colonyLandPer casillas, hasta CONFIG.colonyMax); con pocos rivales
 * (p. ej. el tutorial), proporcionalmente menos.
 */
export function colonyCount(landCount, bots) {
  const n = Math.round((landCount / CONFIG.colonyLandPer) * Math.min(1, bots / 20));
  return Math.max(3, Math.min(CONFIG.colonyMax, n));
}

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
