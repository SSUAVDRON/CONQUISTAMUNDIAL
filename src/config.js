// Parámetros de equilibrio del juego. Todo lo "ajustable" vive aquí para poder
// iterar sobre la jugabilidad sin tocar la lógica.

export const TICK_MS = 100; // 10 ticks por segundo de simulación

export const TERRAIN = { WATER: 0, PLAINS: 1, HIGHLAND: 2, MOUNTAIN: 3 };
export const TERRAIN_NAMES = ['Agua', 'Llanura', 'Meseta', 'Montaña'];

export const CONFIG = {
  // Fase inicial: los jugadores eligen dónde aparecer
  spawnTicks: 100, // 10 s
  spawnRadius: 4,
  startTroops: 2500,
  minSpawnBodySize: 150, // no se puede empezar en islotes minúsculos

  // Victoria: controlar esta fracción de toda la tierra
  winLandShare: 0.7,

  // Tropas: máximo y crecimiento por tick
  maxTroopsBase: 2000,
  maxTroopsPerTile: 60,
  growthBase: 10,
  growthTileMult: 0.5,
  growthTileExp: 0.75,

  // Ataques
  terrainCost: [Infinity, 1.0, 1.4, 2.0], // indexado por TERRAIN
  wildTileCost: 3, // tropas por casilla de tierra libre (llanura)
  playerTileBaseCost: 1.5, // coste fijo por casilla enemiga
  defenseDensityMult: 1.0, // coste extra por cada tropa/casilla del defensor
  defenderLossMult: 0.8, // tropas que pierde el defensor por casilla perdida (× densidad)
  attackRateWild: 0.1, // casillas por tick por casilla de frente (tierra libre)
  attackRatePlayer: 0.04, // ídem contra jugadores (se escala con la superioridad)
  minAttackBudget: 0.25,

  // Barcos de transporte
  maxBoats: 3, // sin puertos; cada puerto suma uno
  boatSpeed: 1.5, // casillas por tick

  // Oro: ingreso por tick = base + casillas^exp × mult (× bonus de puertos)
  startGold: 0,
  goldBase: 2,
  goldTileMult: 0.08,
  goldTileExp: 0.7,
  plunderShare: 1, // fracción del oro del eliminado que se lleva quien le quita la última casilla

  // Edificios
  buildingMinDist: 5, // casillas mínimas entre dos edificios
  cityMaxTroops: 15000, // tropas máximas extra por ciudad
  portGoldBonus: 0.1, // +10% de oro por puerto
  fortRadius: 10,
  fortDefenseMult: 2.5, // coste y tiempo de conquista dentro del radio

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

export const EMOJIS = ['👍', '👎', '🤝', '😠', '😂', '😢', '🔥', '⚔️', '🏳️', '❤️'];

/** Tipos de edificio. El coste sube con cada edificio del mismo tipo que ya tengas. */
export const BUILDINGS = {
  city: { name: 'Ciudad', base: 5000, step: 5000, key: 'KeyQ', desc: '+15k tropas máximas' },
  port: { name: 'Puerto', base: 4000, step: 4000, key: 'KeyE', coastal: true, desc: '+1 barco y +10% de oro' },
  fort: { name: 'Fortaleza', base: 3000, step: 3000, key: 'KeyR', desc: 'Defensa ×2,5 alrededor' },
};
export const BUILDING_KINDS = Object.keys(BUILDINGS);

export const MAP_SIZES = {
  pequeno: { w: 360, h: 210, label: 'Pequeño' },
  mediano: { w: 520, h: 300, label: 'Mediano' },
  grande: { w: 720, h: 420, label: 'Grande' },
};
