// Parámetros de equilibrio del juego. Todo lo "ajustable" vive aquí para poder
// iterar sobre la jugabilidad sin tocar la lógica.

export const TICK_MS = 100; // 10 ticks por segundo de simulación

/**
 * Resolución del mapa: casillas por cada casilla de la rejilla original, en
 * cada eje. Los valores de abajo están pensados para la rejilla original y se
 * adaptan con estos factores: distancias y velocidades × RES, valores por
 * casilla ÷ AREA (así una misma superficie vale lo mismo en tropas y oro).
 */
export const RES = 3;
export const AREA = RES * RES;

export const TERRAIN = { WATER: 0, PLAINS: 1, HIGHLAND: 2, MOUNTAIN: 3 };
export const TERRAIN_NAMES = ['Agua', 'Llanura', 'Meseta', 'Montaña'];

export const CONFIG = {
  // Fase inicial: los jugadores eligen dónde aparecer
  spawnTicks: 300, // 30 s para elegir dónde empezar (la cuenta atrás del despliegue)
  // La zona inicial (52 casillas), las tropas y el oro iniciales, el techo, la
  // regeneración, los precios, el comercio y el combate están en mecanicas.js
  minSpawnBodySize: 150 * AREA, // no se puede empezar en islotes minúsculos

  // Economía de trabajadores (regla opcional): fracción de la población como
  // soldados al empezar y mínimo del deslizador
  soldierShare: 0.7,
  minSoldierShare: 0.05,

  // Ataques: costes y velocidades en mecanicas.js (documento, sección 05).
  // Forma de la expansión (solo cambia el orden, no la velocidad): retraso en
  // «pasos» de cada casilla del frente. Lóbulos de ruido, terreno difícil y
  // azar hacen que los países crezcan irregulares y no como círculos.
  // Orden de conquista de la tierra libre: por distancia al centro del país
  // (en casillas), así crece parejo, en círculo, sin manchas ni brazos
  growRandom: 0.45, // azar por casilla: el borde sale algo irregular, no una regla (poco: crece parejo, sin dientes)
  growTerrain: (4 * RES) / 2, // retraso (en casillas de distancia) por cada punto de coste de terreno sobre la llanura: la misma superficie con más resolución
  growSmooth: 1.2, // las casillas con más vecinas propias antes: rellena huecos y esquinas
  // Hacia un clic, el lado que mira allí avanza antes: al de detrás le pesa la
  // distancia × (1 + 2 × growFocusStretch); contra países, growFocus pasos
  growFocusStretch: 0.2, // hacia el clic crece algo antes, pero sin estirarse: el territorio sigue redondo
  growFocus: (8 * RES) / 2,
  growPlayerMult: 0.15, // contra naciones, casi como antes (un frente irregular es más largo y aceleraba las guerras)

  // Barcos de transporte
  maxBoats: 3, // barcos de transporte de tropas a la vez (los puertos no suman)
  boatSpeed: 0.55 * RES, // casillas por tick

  // Oro: pasivo fijo por tick (mecanicas.js); al eliminar a un rival, todo su oro
  startGold: 0,
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

  // Colonias: los «bots» del documento (un tercio del techo, mitad de regeneración, 50 de oro)
  colonyLandPer: 500 * AREA, // una colonia por cada tantas casillas de tierra…
  colonyMax: 300, // …hasta este máximo

  // Edificios
  buildingMinDist: 5 * RES, // casillas mínimas entre dos edificios
  portSnap: 6 * RES, // el puerto se coloca en la orilla propia más cercana al clic (hasta esta distancia)
  fortRadius: 12 * RES,
  fortDefenseMult: 3, // efecto de defensa (× tiempo y bajas del atacante) dentro del radio del puesto
  // Niveles y obras (el precio de un nivel es el del siguiente edificio de su tipo: mecanicas.js)
  maxLevel: 5,
  upgradeTimeMult: 0.8, // subir de nivel tarda el 80 % de la obra nueva
  // Efecto de cada nivel por encima del 1: ciudad +250k de techo de tropas,
  // fábrica más alcance de vías, puesto defensivo +2 de radio y +0,4 de
  // defensa, silo −15 % de recarga, antimisiles +3 de radio y +7 % de acierto
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

  // Mercantes de los puertos (cuándo salen y cuánto pagan: mecanicas.js)
  tradeSpeed: 0.42 * RES,

  // Raíles y trenes de las fábricas
  railRange: 14 * RES, // alcance de las vías de una fábrica de nivel 1 (casillas de recorrido: en horizontal + en vertical)
  railRangePerLevel: 4 * RES, // y cuánto más por cada nivel extra
  railMaxPerFactory: 6, // estaciones (ciudades, puertos y otras fábricas) como mucho por fábrica, las más cercanas
  railMaxWater: 2 * RES, // casillas de agua que puede cruzar una vía (un puente corto); si no, no se tiende
  railRefresh: 20, // ticks entre recálculos de la red
  trainEveryMin: 150, // ticks entre trenes de un mismo raíl
  trainEveryMax: 300,
  trainSpeed: 0.8 * RES, // casillas por tick (el oro por estación: mecanicas.js)

  // Misiles y antimisiles
  missileRadius: 8 * RES, // casillas arrasadas alrededor del impacto (bomba atómica)
  hbombRadius: 2.2, // bomba H: radio × 2,2 (PROPUESTA)
  mirvWarheads: 24, // MIRV: cabezas (PROPUESTA)
  mirvRadius: 0.55, // y su radio, × el de la bomba atómica
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
  traitorTicks: 600, // 1 min marcado como traidor tras romper una alianza (atacarle cuesta la mitad de bajas)
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
  economy: 'fixed', // 'fixed': oro pasivo fijo (OpenFront moderno) | 'workers': tropas + trabajadores (variante FrontWars)
  profile: 'clasico', // perfil de reglas (src/mecanicas.js, PROFILES): 'clasico' | 'trinchera'
};
/** Perfiles de reglas (ver PROFILES en src/mecanicas.js). Sin perfil = 'trinchera' (valor histórico). */
export const PROFILE_IDS = ['clasico', 'trinchera'];

/**
 * Reglas guardadas antes de existir los perfiles: se marcan con el perfil
 * histórico ('trinchera') ANTES de combinarlas con DEFAULT_RULES, para que una
 * configuración antigua no cambie de perfil al cargar.
 */
export function migrateRules(r) {
  if (!r || typeof r !== 'object') return r;
  return r.profile === undefined ? { ...r, profile: 'trinchera' } : r;
}
/** Economías: fija (la del documento) o con trabajadores (variante opcional del documento, sección 07). */
export const ECONOMY_MODES = ['fixed', 'workers'];
/** Dificultades de las naciones de la IA (documento: ×0,5 / 0,75 / 1 / 1,25 de techo). */
export const DIFFICULTIES = ['facil', 'normal', 'dificil', 'imposible'];
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
    // En Clásico no hay capitales: esa victoria sería inalcanzable
    victory: VICTORY_MODES.includes(r.victory) && !(r.victory === 'capitales' && r.profile === 'clasico') ? r.victory : 'dominio',
    coop: r.coop === true,
    coopRoles: r.coop === true && r.coopRoles === true,
    economy: ECONOMY_MODES.includes(r.economy) ? r.economy : 'fixed',
    profile: PROFILE_IDS.includes(r.profile) ? r.profile : 'trinchera',
  };
}

export const EMOJIS = ['👍', '👎', '🤝', '😠', '😂', '😢', '🔥', '⚔️', '🏳️', '❤️'];

/**
 * Tipos de edificio. `base`: precio sin inflación; `build`: ticks de obra
 * (100 ms cada uno); `fixed`: precio fijo, sin inflación.
 */
export const BUILDINGS = {
  city: { name: 'Ciudad', fem: true, base: 125000, build: 50, key: 'KeyQ', desc: '+25.000 de techo de tropas por nivel' },
  port: { name: 'Puerto', fem: false, base: 125000, build: 60, key: 'KeyE', coastal: true, desc: 'Lanza mercantes a puertos de otros jugadores: los dos cobráis al llegar (comparte precio con las fábricas)' },
  fort: { name: 'Puesto defensivo', fem: false, base: 50000, build: 40, key: 'KeyR', desc: 'Defensa ×3 alrededor (tiempo y bajas del atacante)' },
  factory: { name: 'Fábrica', fem: true, base: 125000, build: 60, key: 'KeyF', desc: 'Tiende vías a las estaciones cercanas; sus trenes dan oro al llegar (10k propia o neutral, 35k aliada). Comparte precio con los puertos' },
  silo: { name: 'Silo', fem: false, base: 1000000, build: 90, key: 'KeyG', fixed: true, desc: 'Permite lanzar bombas' },
  sam: { name: 'Antimisiles', fem: false, base: 1500000, build: 160, key: 'KeyH', desc: 'Derriba bombas enemigas cercanas; recarga 20 s tras cada disparo' },
  // No son edificios: el buque se bota desde un puerto y las bombas salen de un silo
  warship: { name: 'Buque', fem: false, base: 250000, build: 0, key: 'KeyT', unit: 'ship', desc: 'Clic en el mar: patrulla esa zona para siempre; hunde buques y transportes y captura mercantes' },
  missile: { name: 'Bomba atómica', fem: true, base: 750000, build: 0, key: 'KeyM', unit: 'missile', fixed: true, desc: 'Arrasa una zona enemiga' },
  hbomb: { name: 'Bomba H', fem: true, base: 5000000, build: 0, key: 'KeyJ', unit: 'missile', fixed: true, desc: 'Bomba de hidrógeno: arrasa una zona mucho mayor' },
  mirv: { name: 'MIRV', fem: false, base: 25000000, build: 0, key: 'KeyK', unit: 'missile', fixed: true, desc: 'Se divide en muchas cabezas que caen por todo el país enemigo' },
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
