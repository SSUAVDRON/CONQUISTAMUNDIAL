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
  maxBoats: 3,
  boatSpeed: 1.5, // casillas por tick

  // Bots
  botThinkMin: 6,
  botThinkMax: 20,
};

export const MAP_SIZES = {
  pequeno: { w: 360, h: 210, label: 'Pequeño' },
  mediano: { w: 520, h: 300, label: 'Mediano' },
  grande: { w: 720, h: 420, label: 'Grande' },
};
