// Perfil del jugador: identidad (nombre, color, emblema, patrón, título),
// experiencia y nivel, estadísticas, historial y logros. Se guarda en este
// navegador y, si la plataforma lo permite, también en la nube (cloud.js).

import { DEFAULT_RULES, migrateRules } from './config.js';
import { newRank, normalizeRank } from './rangos.js';
import { Rng, hashString } from './rng.js';

// (Las claves conservan el nombre de la primera versión para no perder perfiles.)
const KEY = 'dominia.perfil.v1';
const OLD_PREFS = 'dominia.prefs';
const HISTORY_MAX = 20;

// ------------------------------------------------------------- catálogo

/** `unlock`: null = libre; { level: n }, { ach: 'id-de-logro' } o { price: monedas } (tienda). */
export const SHAPES = [
  { id: 'escudo', name: 'Escudo', unlock: null },
  { id: 'circulo', name: 'Círculo', unlock: null },
  { id: 'rombo', name: 'Rombo', unlock: { level: 2 } },
  { id: 'hexagono', name: 'Hexágono', unlock: { level: 4 } },
  { id: 'estandarte', name: 'Estandarte', unlock: { level: 6 } },
  { id: 'octogono', name: 'Octógono', unlock: { level: 3 } },
  { id: 'cruzado', name: 'Cruz', unlock: { level: 8 } },
  { id: 'insignia', name: 'Insignia', unlock: { price: 250 } },
  { id: 'sello', name: 'Sello', unlock: { price: 300 } },
];

export const SYMBOLS = [
  { id: 'estrella', name: 'Estrella', unlock: null },
  { id: 'montana', name: 'Montaña', unlock: null },
  { id: 'ola', name: 'Ola', unlock: null },
  { id: 'arbol', name: 'Árbol', unlock: { ach: 'primera_partida' } },
  { id: 'corona', name: 'Corona', unlock: { ach: 'primera_victoria' } },
  { id: 'torre', name: 'Torre', unlock: { ach: 'arquitecto' } },
  { id: 'ancla', name: 'Ancla', unlock: { ach: 'marino' } },
  { id: 'espadas', name: 'Espadas', unlock: { ach: 'verdugo' } },
  { id: 'luna', name: 'Luna', unlock: { ach: 'traidor' } },
  { id: 'sol', name: 'Sol', unlock: { ach: 'en_compania' } },
  { id: 'rayo', name: 'Rayo', unlock: { ach: 'relampago' } },
  { id: 'llama', name: 'Llama', unlock: { ach: 'tesoro' } },
  { id: 'cruz', name: 'Cruz', unlock: null },
  { id: 'diana', name: 'Diana', unlock: null },
  { id: 'corazon', name: 'Corazón', unlock: null },
  { id: 'trebol', name: 'Trébol', unlock: { level: 2 } },
  { id: 'flecha', name: 'Flecha', unlock: { level: 3 } },
  { id: 'casco', name: 'Casco', unlock: { level: 4 } },
  { id: 'avion', name: 'Avión', unlock: { level: 6 } },
  { id: 'calavera', name: 'Calavera', unlock: { ach: 'superviviente' } },
  { id: 'aguila', name: 'Águila', unlock: { price: 350 } },
  { id: 'castillo', name: 'Castillo', unlock: { price: 300 } },
  { id: 'copo', name: 'Copo', unlock: { price: 250 } },
  { id: 'ojo', name: 'Ojo', unlock: { price: 300 } },
  { id: 'lis', name: 'Flor de lis', unlock: { price: 400 } },
  { id: 'brujula', name: 'Brújula', unlock: { ach: 'estratega' } },
  { id: 'engranaje', name: 'Engranaje', unlock: { ach: 'cientifico' } },
];

/** Estandartes: el fondo de tu tarjeta de perfil. */
export const BANNERS = [
  { id: 'noche', name: 'Noche', unlock: null },
  { id: 'oceano', name: 'Océano', unlock: null },
  { id: 'selva', name: 'Selva', unlock: { level: 2 } },
  { id: 'desierto', name: 'Desierto', unlock: { level: 3 } },
  { id: 'atardecer', name: 'Atardecer', unlock: { level: 4 } },
  { id: 'artico', name: 'Ártico', unlock: { level: 5 } },
  { id: 'volcan', name: 'Volcán', unlock: { ach: 'lluvia_fuego' } },
  { id: 'real', name: 'Real', unlock: { ach: 'primera_victoria' } },
  { id: 'aurora', name: 'Aurora boreal', unlock: { price: 400 } },
  { id: 'tormenta', name: 'Tormenta', unlock: { price: 350 } },
  { id: 'imperial', name: 'Imperial', unlock: { ach: 'emperador' } },
  { id: 'abismo', name: 'Abismo', unlock: { price: 300 } },
  { id: 'brasas', name: 'Brasas', unlock: { price: 450 } },
  { id: 'galaxia', name: 'Galaxia', unlock: { price: 600 } },
  { id: 'topografico', name: 'Topográfico', unlock: { price: 350 } },
  { id: 'neon', name: 'Neón', unlock: { price: 500 } },
  { id: 'camuflaje', name: 'Camuflaje', unlock: { price: 300 } },
  { id: 'cerezo', name: 'Cerezo', unlock: { price: 450 } },
  { id: 'oro_negro', name: 'Oro negro', unlock: { ach: 'millonario' } },
  { id: 'trinchera', name: 'Trinchera', unlock: { ach: 'diario' } },
];

/** Marcos alrededor del emblema. */
export const FRAMES = [
  { id: 'ninguno', name: 'Sin marco', unlock: null },
  { id: 'bronce', name: 'Bronce', unlock: { level: 2 } },
  { id: 'plata', name: 'Plata', unlock: { level: 4 } },
  { id: 'oro', name: 'Oro', unlock: { level: 7 } },
  { id: 'laurel', name: 'Laurel', unlock: { ach: 'primera_victoria' } },
  { id: 'esmeralda', name: 'Esmeralda', unlock: { price: 400 } },
  { id: 'rubi', name: 'Rubí', unlock: { price: 400 } },
  { id: 'zafiro', name: 'Zafiro', unlock: { price: 400 } },
  { id: 'hielo', name: 'Hielo', unlock: { price: 350 } },
  { id: 'llamas', name: 'Llamas', unlock: { price: 550 } },
  { id: 'corona', name: 'Corona', unlock: { ach: 'emperador' } },
  { id: 'diamante', name: 'Diamante', unlock: { price: 900 } },
];

/** Color de tu nombre en el mapa ('propio' = el color de tu territorio, más vivo). */
export const NAME_COLORS = [
  { id: 'oro', name: 'Oro', color: '#ffd23f', unlock: null },
  { id: 'blanco', name: 'Blanco', color: '#ffffff', unlock: null },
  { id: 'cian', name: 'Cian', color: '#5ce1ff', unlock: null },
  { id: 'naranja', name: 'Naranja', color: '#ffa23d', unlock: null },
  { id: 'propio', name: 'Tu color', color: null, unlock: null },
  { id: 'lima', name: 'Lima', color: '#b4ff4d', unlock: { level: 2 } },
  { id: 'rosa', name: 'Rosa', color: '#ff7ad9', unlock: { level: 3 } },
  { id: 'rojo', name: 'Rojo', color: '#ff5a5a', unlock: { ach: 'verdugo' } },
  { id: 'violeta', name: 'Violeta', color: '#b98bff', unlock: { price: 150 } },
  { id: 'turquesa', name: 'Turquesa', color: '#3fe0c5', unlock: { price: 150 } },
  { id: 'carmesi', name: 'Carmesí', color: '#ff3d6e', unlock: { price: 200 } },
  { id: 'menta', name: 'Menta', color: '#9dffc4', unlock: { price: 150 } },
  { id: 'salmon', name: 'Salmón', color: '#ff9e80', unlock: { price: 150 } },
  { id: 'celeste', name: 'Celeste', color: '#8fd3ff', unlock: { price: 150 } },
];

/** Color CSS del nombre del jugador según su perfil. */
export function nameColorOf(p) {
  const c = NAME_COLORS.find((x) => x.id === p.colorNombre) || NAME_COLORS[0];
  if (c.color) return c.color;
  // Su color, aclarado para que se lea sobre el mapa
  const n = parseInt((p.color || '#2f7dff').slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * 0.35));
  return `rgb(${ch.join(',')})`;
}

export const PATTERNS = [
  { id: 'liso', name: 'Liso', unlock: null },
  { id: 'rayas', name: 'Rayas', unlock: { ach: 'primera_victoria' } },
  { id: 'puntos', name: 'Puntos', unlock: { ach: 'diplomatico' } },
  { id: 'rejilla', name: 'Rejilla', unlock: { ach: 'arquitecto' } },
  { id: 'cuadros', name: 'Ajedrez', unlock: { ach: 'medio_mundo' } },
  { id: 'ondas', name: 'Ondas', unlock: { ach: 'alianza_victoriosa' } },
  { id: 'diamantes', name: 'Diamantes', unlock: { ach: 'gran_victoria' } },
  { id: 'espiga', name: 'Espiga', unlock: { level: 5 } },
  { id: 'mosaico', name: 'Mosaico', unlock: { level: 10 } },
  { id: 'estrellas', name: 'Estrellas', unlock: { price: 350 } },
  { id: 'zigzag', name: 'Zigzag', unlock: { price: 250 } },
  { id: 'escamas', name: 'Escamas', unlock: { price: 400 } },
  { id: 'camuflaje', name: 'Camuflaje', unlock: { price: 450 } },
  { id: 'circuito', name: 'Circuito', unlock: { ach: 'cientifico' } },
  { id: 'ladrillos', name: 'Ladrillos', unlock: { price: 300 } },
];

export const TITLES = [
  { id: '', name: 'Sin título', unlock: null },
  { id: 'conquistador', name: 'el Conquistador', unlock: { ach: 'primera_victoria' } },
  { id: 'senor', name: 'Señor del mundo', unlock: { ach: 'gran_victoria' } },
  { id: 'diplomatico', name: 'el Diplomático', unlock: { ach: 'diplomatico' } },
  { id: 'lobo', name: 'Lobo de mar', unlock: { ach: 'marino' } },
  { id: 'implacable', name: 'el Implacable', unlock: { ach: 'verdugo' } },
  { id: 'traicionero', name: 'el Traicionero', unlock: { ach: 'traidor' } },
  { id: 'veterano', name: 'Veterano', unlock: { ach: 'veterano' } },
  { id: 'magnate', name: 'el Magnate', unlock: { ach: 'industrial' } },
  { id: 'devastador', name: 'el Devastador', unlock: { ach: 'lluvia_fuego' } },
  { id: 'estratega', name: 'el Estratega', unlock: { ach: 'estratega' } },
  { id: 'emperador', name: 'Emperador', unlock: { ach: 'emperador' } },
  { id: 'sabio', name: 'el Sabio', unlock: { ach: 'cientifico' } },
  { id: 'pacificador', name: 'el Pacificador', unlock: { ach: 'pacificador' } },
  { id: 'almirante', name: 'Almirante', unlock: { ach: 'almirante' } },
  { id: 'temible', name: 'el Temible', unlock: { price: 400 } },
  { id: 'grande', name: 'el Grande', unlock: { price: 700 } },
  { id: 'inmortal', name: 'el Inmortal', unlock: { price: 1200 } },
];

/** Cada objeto sabe a qué catálogo pertenece (para comprarlo y guardarlo). */
for (const [list, cat] of [[SHAPES, 'forma'], [SYMBOLS, 'simbolo'], [BANNERS, 'estandarte'], [FRAMES, 'marco'], [NAME_COLORS, 'color'], [PATTERNS, 'patron'], [TITLES, 'titulo']]) {
  for (const item of list) item.cat = cat;
}
export const itemKey = (item) => `${item.cat}:${item.id}`;

/** Precio en monedas de cada objeto de la tienda, por su clave. */
const PRICE_BY_KEY = new Map(
  [SHAPES, SYMBOLS, BANNERS, FRAMES, NAME_COLORS, PATTERNS, TITLES].flatMap((list) => list.filter((it) => it.unlock && it.unlock.price).map((it) => [itemKey(it), it.unlock.price])),
);

/** Mejores puntos de la clasificatoria (esta temporada o las anteriores). */
function rankBest(p) {
  const r = p.rango;
  if (!r) return 0;
  const placed = r.colocacion >= 5 ? Math.max(r.mejor || 0, r.puntos || 0) : 0;
  return Math.max(placed, ...(r.anteriores || []).map((x) => x.mejor || x.puntos || 0));
}

/**
 * Logros. `check(r, profile)` recibe el resultado de la partida (ver
 * gameResult en main.js) y el perfil ya actualizado con ella. `meta`
 * (opcional): los que dependen de una cifra acumulada ({ stat, n }) muestran
 * su progreso («7/10»); ver achievementProgress.
 */
export const ACHIEVEMENTS = [
  { id: 'primera_partida', icon: '🌱', name: 'Primeros pasos', desc: 'Juega una partida', coins: 50, meta: { stat: 'partidas', n: 1 }, check: () => true },
  { id: 'primera_victoria', icon: '🏆', name: 'Conquistador', desc: 'Gana una partida', coins: 200, meta: { stat: 'victorias', n: 1 }, check: (r) => r.won || r.alliedWin },
  { id: 'gran_victoria', icon: '🌍', name: 'Señor del mundo', desc: 'Gana en el mapa del mundo o en uno grande', coins: 400, check: (r) => (r.won || r.alliedWin) && (r.mapSize === 'grande' || r.mapSize === 'mundo') },
  { id: 'relampago', icon: '⚡', name: 'Guerra relámpago', desc: 'Gana en menos de 12 minutos', coins: 300, check: (r) => r.won && r.seconds < 720 },
  { id: 'alianza_victoriosa', icon: '🤝', name: 'Juntos somos más', desc: 'Gana en alianza', coins: 250, check: (r) => r.alliedWin },
  { id: 'verdugo', icon: '⚔️', name: 'Verdugo', desc: 'Elimina a 5 naciones en una partida', coins: 150, check: (r) => r.kills >= 5 },
  { id: 'arquitecto', icon: '🏗️', name: 'Arquitecto', desc: 'Construye 10 edificios en una partida', coins: 150, check: (r) => r.built >= 10 },
  { id: 'metropolis', icon: '🏙️', name: 'Metrópolis', desc: 'Ten 5 ciudades a la vez', coins: 200, check: (r) => r.maxCities >= 5 },
  { id: 'marino', icon: '⚓', name: 'Lobo de mar', desc: 'Desembarca 5 veces en una partida', coins: 150, check: (r) => r.landings >= 5 },
  { id: 'diplomatico', icon: '🕊️', name: 'Diplomático', desc: 'Firma 3 alianzas en una partida', coins: 150, check: (r) => r.alliances >= 3 },
  { id: 'traidor', icon: '🗡️', name: 'Puñal en la espalda', desc: 'Rompe una alianza', coins: 100, check: (r) => r.betrayals >= 1 },
  { id: 'superviviente', icon: '🛡️', name: 'Superviviente', desc: 'Sigue en pie a los 15 minutos', coins: 150, check: (r) => r.survivedSeconds >= 900 },
  { id: 'medio_mundo', icon: '🗺️', name: 'Medio mundo', desc: 'Controla el 50 % de la tierra', coins: 300, check: (r) => r.maxShare >= 0.5 },
  { id: 'en_compania', icon: '👥', name: 'En compañía', desc: 'Juega una partida online', coins: 150, meta: { stat: 'online', n: 1 }, check: (r) => r.online },
  { id: 'veterano', icon: '🎖️', name: 'Veterano', desc: 'Juega 10 partidas', coins: 250, meta: { stat: 'partidas', n: 10 }, check: (r, p) => p.stats.partidas >= 10 },
  { id: 'tesoro', icon: '💰', name: 'Tesoro real', desc: 'Reúne 2,5 millones de oro', coins: 200, check: (r) => r.maxGold >= 2500000 },
  { id: 'recluta', icon: '🎓', name: 'Recluta', desc: 'Completa el tutorial', coins: 100, check: () => false },
  { id: 'industrial', icon: '🏭', name: 'Revolución industrial', desc: 'Ten 5 fábricas a la vez', coins: 250, check: (r) => (r.maxFactories || 0) >= 5 },
  { id: 'lluvia_fuego', icon: '🚀', name: 'Lluvia de fuego', desc: 'Lanza 5 misiles en una partida', coins: 250, check: (r) => (r.missiles || 0) >= 5 },
  // Nuevos: mecánicas estratégicas, modos de victoria y progreso a largo plazo
  { id: 'estratega', icon: '🧭', name: 'Estratega', desc: 'Toma 5 puntos estratégicos en una partida', coins: 200, check: (r) => (r.pointsTaken || 0) >= 5 },
  { id: 'capitalino', icon: '👑', name: 'Caza de capitales', desc: 'Conquista 3 capitales en una partida', coins: 250, check: (r) => (r.capitalsTaken || 0) >= 3 },
  { id: 'cientifico', icon: '🔬', name: 'Científico', desc: 'Investiga 5 tecnologías en una partida', coins: 200, check: (r) => (r.techs || 0) >= 5 },
  { id: 'pacificador', icon: '📜', name: 'Pacificador', desc: 'Firma 2 pactos o paces en una partida', coins: 150, check: (r) => (r.pacts || 0) >= 2 },
  { id: 'emperador', icon: '🏰', name: 'Emperador', desc: 'Gana por control de capitales', coins: 500, check: (r) => r.won && r.victory === 'capitales' },
  { id: 'magnate_mundial', icon: '📈', name: 'Supremacía económica', desc: 'Gana por economía', coins: 500, check: (r) => r.won && r.victory === 'economia' },
  { id: 'resistente', icon: '⏳', name: 'Hasta el final', desc: 'Gana en supervivencia', coins: 400, check: (r) => r.won && r.victory === 'supervivencia' },
  { id: 'cooperativo', icon: '🫱', name: 'Dos cabezas', desc: 'Juega una partida cooperativa', coins: 200, check: (r) => !!r.coop },
  { id: 'imperio', icon: '🌐', name: 'Imperio', desc: 'Controla el 70 % de la tierra', coins: 500, check: (r) => r.maxShare >= 0.7 },
  { id: 'urbanista', icon: '🌆', name: 'Urbanista', desc: 'Ten 10 ciudades a la vez', coins: 300, check: (r) => r.maxCities >= 10 },
  { id: 'saqueador', icon: '🏴‍☠️', name: 'Saqueador', desc: 'Consigue 500.000 de botín en una partida', coins: 250, check: (r) => (r.loot || 0) >= 500000 },
  { id: 'almirante', icon: '🚢', name: 'Almirante', desc: 'Hunde 5 barcos o buques en una partida', coins: 250, check: (r) => (r.sunk || 0) >= 5 },
  { id: 'millonario', icon: '💎', name: 'Millonario', desc: 'Reúne 10 millones de oro', coins: 400, check: (r) => r.maxGold >= 10000000 },
  { id: 'invicto', icon: '🥇', name: 'Invicto', desc: 'Gana 5 partidas', coins: 400, meta: { stat: 'victorias', n: 5 }, check: (r, p) => p.stats.victorias >= 5 },
  { id: 'centurion', icon: '💀', name: 'Centurión', desc: 'Elimina 100 naciones en total', coins: 400, meta: { stat: 'eliminaciones', n: 100 }, check: (r, p) => p.stats.eliminaciones >= 100 },
  { id: 'maraton', icon: '🏃', name: 'Maratón', desc: 'Juega 50 partidas', coins: 500, meta: { stat: 'partidas', n: 50 }, check: (r, p) => p.stats.partidas >= 50 },
  { id: 'nivel10', icon: '🔟', name: 'Curtido', desc: 'Llega al nivel 10', coins: 300, meta: { stat: 'nivel', n: 10 }, check: (r, p) => levelInfo(p.xp).level >= 10 },
  { id: 'diario', icon: '📅', name: 'Constante', desc: 'Completa 10 retos diarios', coins: 300, meta: { stat: 'retosDiarios', n: 10 }, check: (r, p) => (p.stats.retosDiarios || 0) >= 10 },
  // Fase 3: puesto, rangos, rachas, retos semanales y por enlace
  { id: 'top10', icon: '🔟', name: 'Entre los diez', desc: 'Termina una partida entre las 10 primeras naciones', coins: 100, check: (r) => r.place > 0 && r.place <= 10 && r.of >= 20 },
  { id: 'podio', icon: '🥉', name: 'Podio', desc: 'Termina una partida entre las 3 primeras naciones', coins: 200, check: (r) => r.place > 0 && r.place <= 3 && r.of >= 10 },
  { id: 'remontada', icon: '📈', name: 'Remontada', desc: 'Gana tras haber bajado del 1 % del mapa', coins: 400, check: (r) => r.won && Array.isArray(r.curve) && r.curve.some((v, i) => i >= 3 && v < 10) },
  { id: 'tormenta', icon: '🌪️', name: 'Tormenta', desc: 'Elimina a 15 naciones o colonias en una partida', coins: 300, check: (r) => r.kills >= 15 },
  { id: 'constructor', icon: '🧱', name: 'Constructor', desc: 'Construye 25 edificios en una partida', coins: 250, check: (r) => r.built >= 25 },
  { id: 'diplomatico_total', icon: '🌐', name: 'Gran diplomático', desc: 'Firma 5 alianzas en una partida', coins: 250, check: (r) => r.alliances >= 5 },
  { id: 'magnate_oro', icon: '🏦', name: 'Magnate', desc: 'Reúne 25 millones de oro', coins: 500, check: (r) => r.maxGold >= 25000000 },
  { id: 'aguante', icon: '⏱️', name: 'Aguante', desc: 'Sigue en pie a los 30 minutos', coins: 300, check: (r) => r.survivedSeconds >= 1800 },
  { id: 'clasificado', icon: '🎯', name: 'Clasificado', desc: 'Termina las partidas de colocación', coins: 200, check: (r, p) => (p.rango ? p.rango.colocacion >= 5 : false) },
  { id: 'liga_bronce', icon: '🥉', name: 'Liga de Bronce', desc: 'Llega a Bronce en la clasificatoria', coins: 100, check: (r, p) => rankBest(p) >= 400 },
  { id: 'liga_plata', icon: '🥈', name: 'Liga de Plata', desc: 'Llega a Plata en la clasificatoria', coins: 200, check: (r, p) => rankBest(p) >= 800 },
  { id: 'liga_oro', icon: '🥇', name: 'Liga de Oro', desc: 'Llega a Oro en la clasificatoria', coins: 300, check: (r, p) => rankBest(p) >= 1200 },
  { id: 'liga_platino', icon: '💠', name: 'Liga de Platino', desc: 'Llega a Platino en la clasificatoria', coins: 400, check: (r, p) => rankBest(p) >= 1600 },
  { id: 'liga_diamante', icon: '💎', name: 'Liga de Diamante', desc: 'Llega a Diamante en la clasificatoria', coins: 600, check: (r, p) => rankBest(p) >= 2000 },
  { id: 'liga_maestro', icon: '🏵️', name: 'Maestro', desc: 'Llega a Maestro en la clasificatoria', coins: 1000, check: (r, p) => rankBest(p) >= 2400 },
  { id: 'racha', icon: '🔥', name: 'En racha', desc: 'Gana 3 clasificatorias seguidas', coins: 400, check: (r, p) => !!p.rango && p.rango.historial.length >= 3 && p.rango.historial.slice(0, 3).every((h) => h.puesto === 1) },
  { id: 'semanal', icon: '🗓️', name: 'Semana a semana', desc: 'Completa 5 retos semanales', coins: 400, meta: { stat: 'retosSemanales', n: 5 }, check: (r, p) => (p.stats.retosSemanales || 0) >= 5 },
  { id: 'retador', icon: '🎯', name: 'Reto superado', desc: 'Supera el reto que te manda otro jugador por enlace', coins: 250, check: (r) => !!r.challengeBeaten },
  { id: 'leyenda_viva', icon: '🏛️', name: 'Leyenda viva', desc: 'Juega 100 partidas', coins: 800, meta: { stat: 'partidas', n: 100 }, check: (r, p) => p.stats.partidas >= 100 },
  { id: 'coleccionista', icon: '🛍️', name: 'Coleccionista', desc: 'Compra 5 objetos en la tienda', coins: 200, meta: { stat: 'comprados', n: 5 }, check: (r, p) => Object.keys(p.comprados || {}).length >= 5 },
];

/**
 * Retos diarios: cada día, 3 de esta lista (los mismos para todo el día).
 * `need`: cuánto hay que acumular; `step(r)`: cuánto suma una partida.
 */
export const DAILY = [
  { id: 'jugar2', icon: '🎮', name: 'Juega 2 partidas', need: 2, coins: 80, step: () => 1 },
  { id: 'ganar', icon: '🏆', name: 'Gana una partida', need: 1, coins: 200, step: (r) => (r.won || r.alliedWin ? 1 : 0) },
  { id: 'eliminar6', icon: '⚔️', name: 'Elimina 6 naciones o colonias', need: 6, coins: 120, step: (r) => r.kills },
  { id: 'construir8', icon: '🏗️', name: 'Construye 8 edificios', need: 8, coins: 100, step: (r) => r.built },
  { id: 'territorio20', icon: '🗺️', name: 'Llega al 20 % de la tierra en una partida', need: 1, coins: 150, step: (r) => (r.maxShare >= 0.2 ? 1 : 0) },
  { id: 'investigar3', icon: '🔬', name: 'Investiga 3 tecnologías', need: 3, coins: 120, step: (r) => r.techs || 0 },
  { id: 'puntos3', icon: '🧭', name: 'Toma 3 puntos estratégicos', need: 3, coins: 120, step: (r) => r.pointsTaken || 0 },
  { id: 'capital', icon: '👑', name: 'Conquista una capital', need: 1, coins: 150, step: (r) => r.capitalsTaken || 0 },
  { id: 'pacto', icon: '📜', name: 'Firma un pacto o una paz', need: 1, coins: 100, step: (r) => r.pacts || 0 },
  { id: 'desembarcos2', icon: '⚓', name: 'Desembarca 2 veces', need: 2, coins: 100, step: (r) => r.landings },
  { id: 'misil', icon: '🚀', name: 'Lanza un misil', need: 1, coins: 120, step: (r) => r.missiles || 0 },
  { id: 'alianza', icon: '🤝', name: 'Firma una alianza', need: 1, coins: 80, step: (r) => r.alliances },
  { id: 'sobrevivir10', icon: '🛡️', name: 'Sigue en pie a los 10 minutos', need: 1, coins: 120, step: (r) => (r.survivedSeconds >= 600 ? 1 : 0) },
  { id: 'oro1m', icon: '💰', name: 'Reúne 1 millón de oro en una partida', need: 1, coins: 120, step: (r) => (r.maxGold >= 1000000 ? 1 : 0) },
];
export const DAILY_BONUS = 150; // por completar los tres del día

/** Retos semanales: 3 por semana (de lunes a domingo), más largos y mejor pagados. */
export const WEEKLY = [
  { id: 'w_partidas', icon: '🎮', name: 'Juega 10 partidas', need: 10, coins: 300, step: () => 1 },
  { id: 'w_victorias', icon: '🏆', name: 'Gana 3 partidas', need: 3, coins: 500, step: (r) => (r.won || r.alliedWin ? 1 : 0) },
  { id: 'w_eliminar', icon: '⚔️', name: 'Elimina 40 naciones o colonias', need: 40, coins: 350, step: (r) => r.kills },
  { id: 'w_construir', icon: '🏗️', name: 'Construye 60 edificios', need: 60, coins: 300, step: (r) => r.built },
  { id: 'w_clasif', icon: '🏅', name: 'Juega 5 clasificatorias', need: 5, coins: 400, step: (r) => (r.ranked ? 1 : 0) },
  { id: 'w_podio', icon: '🥉', name: 'Termina 3 veces entre los 3 primeros', need: 3, coins: 450, step: (r) => (r.place > 0 && r.place <= 3 && r.of >= 10 ? 1 : 0) },
  { id: 'w_online', icon: '👥', name: 'Juega 3 partidas online', need: 3, coins: 350, step: (r) => (r.online ? 1 : 0) },
  { id: 'w_territorio', icon: '🗺️', name: 'Llega al 30 % del mapa en una partida', need: 1, coins: 300, step: (r) => (r.maxShare >= 0.3 ? 1 : 0) },
];
export const WEEKLY_BONUS = 400; // por completar los tres de la semana

/** Semana «AAAA-Snn» (lunes a domingo, numeración ISO). */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-S${String(week).padStart(2, '0')}`;
}

/** Los 3 retos de una semana: siempre los mismos esa semana. */
export function weeklyFor(week) {
  const rng = new Rng(hashString(`trinchera-semana-${week}`));
  const pool = WEEKLY.map((d) => d.id);
  const out = [];
  while (out.length < 3) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  return out;
}

/** Los retos de esta semana en el perfil (si cambió la semana, empiezan de cero). */
export function ensureWeekly(profile, week = weekKey()) {
  const w = profile.semanales;
  if (!w || w.semana !== week) profile.semanales = { semana: week, retos: weeklyFor(week), progreso: {}, hechos: {}, bonus: false };
  return profile.semanales;
}

/** Día local «AAAA-MM-DD» (los retos cambian a medianoche). */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Los 3 retos de un día: siempre los mismos ese día. */
export function dailyFor(day) {
  const rng = new Rng(hashString(`trinchera-${day}`));
  const pool = DAILY.map((d) => d.id);
  const out = [];
  while (out.length < 3) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  return out;
}

/** Los retos de hoy en el perfil (si cambió el día, empiezan de cero). */
export function ensureDaily(profile, day = dayKey()) {
  const d = profile.diarios;
  if (!d || d.dia !== day) profile.diarios = { dia: day, retos: dailyFor(day), progreso: {}, hechos: {}, bonus: false };
  return profile.diarios;
}

/** Compra un objeto de la tienda con monedas. Devuelve true si se compró. */
export function buyItem(profile, item) {
  if (!item || !item.unlock || !item.unlock.price || isUnlocked(profile, item)) return false;
  if ((profile.monedas || 0) < item.unlock.price) return false;
  profile.monedas -= item.unlock.price;
  profile.stats.monedasGastadas = (profile.stats.monedasGastadas || 0) + item.unlock.price;
  profile.comprados[itemKey(item)] = Date.now();
  saveProfile(profile);
  return true;
}

/** Qué desbloquea cada logro (para mostrarlo en la ficha del logro). */
export function rewardsOf(achId) {
  const out = [];
  const ach = ACHIEVEMENTS.find((a) => a.id === achId);
  if (ach && ach.coins) out.push(`🪙 ${ach.coins}`);
  for (const [list, kind] of [[SYMBOLS, 'Símbolo'], [PATTERNS, 'Patrón'], [TITLES, 'Título'], [BANNERS, 'Estandarte'], [FRAMES, 'Marco'], [NAME_COLORS, 'Color de nombre']]) {
    for (const item of list) if (item.unlock && item.unlock.ach === achId) out.push(`${kind}: ${item.name}`);
  }
  return out;
}

// --------------------------------------------------------- nivel y XP

/** Nivel n a partir de 60·(n-1)² de experiencia. */
export function levelInfo(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
  const start = 60 * (level - 1) ** 2;
  const next = 60 * level ** 2;
  return { level, xp, start, next, progress: (xp - start) / (next - start) };
}

export function xpForGame(r) {
  let xp = 20;
  xp += Math.round(r.maxShare * 200);
  xp += r.kills * 15 + r.built * 2 + r.alliances * 5;
  xp += Math.min(30, Math.floor(r.survivedSeconds / 60)) * 2;
  if (r.won) xp += 150;
  if (r.alliedWin) xp += 100;
  if (r.online) xp += 20;
  return xp;
}

// ------------------------------------------------------------- perfil

export function defaultProfile() {
  return {
    version: 1,
    nombre: '',
    color: '#2f7dff',
    emblema: { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff' },
    patron: 'liso',
    titulo: '',
    estandarte: 'noche',
    marco: 'ninguno',
    colorNombre: 'oro',
    xp: 0,
    stats: {
      partidas: 0,
      victorias: 0,
      eliminaciones: 0,
      edificios: 0,
      alianzas: 0,
      online: 0,
      mejorPct: 0, // fracción 0..1
      mejorTiempo: null, // segundos de la victoria más rápida
      tiempoJugado: 0, // segundos
      retosDiarios: 0,
      retosSemanales: 0,
      clasificatorias: 0, // partidas clasificatorias jugadas (todas las temporadas)
      monedasGanadas: 0,
      monedasGastadas: 0, // en la tienda (las monedas son ganadas − gastadas)
    },
    logros: {}, // id → fecha (ms)
    monedas: 0, // se ganan con logros, retos diarios y partidas; se gastan en la tienda
    comprados: {}, // «catálogo:id» → fecha de compra
    diarios: null, // { dia, retos: [ids], progreso: {id: n}, hechos: {id: true}, bonus }
    semanales: null, // lo mismo por semana: { semana, retos, progreso, hechos, bonus }
    historial: [], // { fecha, resultado, pct, duracion, mapa, rivales, online }
    ajustes: {
      bots: 70,
      mapa: 'mundo',
      dificultad: 'normal',
      reglas: { ...DEFAULT_RULES },
      alerta: true, // borde rojo al ser atacado
      puntero: true, // marca «TÚ» y flecha hacia tu nación
      marcadores: true, // tropas de los ataques sobre el mapa
      emojis: true,
      animaciones: true,
      musica: true, // música de fondo
      efectos: true, // efectos de sonido
      volMusica: 0.5,
      volEfectos: 0.8,
      silencio: false, // botón de la barra superior
    },
    tutorial: false,
    rango: newRank(), // partidas clasificatorias (ver rangos.js)
    actualizado: 0,
  };
}

/** Emblema válido: la bandera, solo si es un código de país (2-3 letras). */
function cleanEmblem(e) {
  e.flag = typeof e.flag === 'string' && /^[a-z]{2,3}$/.test(e.flag) ? e.flag : '';
  return e;
}

/** Rellena campos que falten (perfiles de versiones anteriores o de la nube). */
export function normalizeProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  const pick = (list, v, dflt) => (list.some((x) => x.id === v) ? v : dflt);
  const out = normalizeFields(p, d, pick);
  // Monedas: ganadas − gastadas (así dos dispositivos se unen sin perder ni
  // duplicar). Perfiles de antes: lo gastado sale de lo comprado y lo ganado
  // se ajusta para que cuadre con las monedas que tenían
  const st = out.stats;
  if (!Number.isFinite(p.stats && p.stats.monedasGastadas)) {
    st.monedasGastadas = Object.keys(out.comprados).reduce((sum, k) => sum + (PRICE_BY_KEY.get(k) || 0), 0);
    st.monedasGanadas = out.monedas + st.monedasGastadas;
  }
  st.monedasGanadas = Math.max(0, Math.floor(Number(st.monedasGanadas) || 0));
  st.monedasGastadas = Math.max(0, Math.floor(Number(st.monedasGastadas) || 0));
  return out;
}

function normalizeFields(p, d, pick) {
  return {
    ...d,
    ...p,
    estandarte: pick(BANNERS, p.estandarte, d.estandarte),
    marco: pick(FRAMES, p.marco, d.marco),
    colorNombre: pick(NAME_COLORS, p.colorNombre, d.colorNombre),
    emblema: cleanEmblem({ ...d.emblema, ...(p.emblema || {}) }),
    stats: { ...d.stats, ...(p.stats || {}) },
    logros: Object.fromEntries(Object.entries(p.logros || {}).filter(([k, v]) => ACHIEVEMENTS.some((a) => a.id === k) && Number.isFinite(v))),
    historial: Array.isArray(p.historial) ? p.historial.slice(0, HISTORY_MAX) : [],
    monedas: Number.isFinite(p.monedas) ? Math.max(0, Math.floor(p.monedas)) : 0,
    comprados: p.comprados && typeof p.comprados === 'object' ? { ...p.comprados } : {},
    diarios: p.diarios && typeof p.diarios === 'object' && Array.isArray(p.diarios.retos) ? p.diarios : null,
    semanales: p.semanales && typeof p.semanales === 'object' && Array.isArray(p.semanales.retos) ? p.semanales : null,
    rango: normalizeRank(p.rango),
    // Reglas guardadas antes de los perfiles: se migran (perfil histórico) ANTES de combinarlas con los valores por defecto
    ajustes: { ...d.ajustes, ...(p.ajustes || {}), reglas: { ...d.ajustes.reglas, ...(migrateRules(p.ajustes && p.ajustes.reglas) || {}) } },
  };
}

export function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(KEY));
    if (!p) {
      // Migración desde las preferencias de la versión anterior
      const old = JSON.parse(localStorage.getItem(OLD_PREFS));
      if (old) {
        p = defaultProfile();
        p.nombre = old.name || '';
        if (old.color) p.color = p.emblema.bg = old.color;
        if (old.bots) p.ajustes.bots = old.bots;
        if (old.map) p.ajustes.mapa = old.map;
      }
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return normalizeProfile(p);
}

export function saveProfile(p) {
  p.actualizado = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el perfil dura lo que la pestaña */
  }
}

/** Une dos perfiles (local y nube) sin perder progreso: máximos y uniones. */
export function mergeProfiles(a, b) {
  a = normalizeProfile(a);
  b = normalizeProfile(b);
  const newer = (b.actualizado || 0) > (a.actualizado || 0) ? b : a;
  const older = newer === a ? b : a;
  const out = normalizeProfile(newer);
  out.xp = Math.max(a.xp, b.xp);
  for (const k of Object.keys(out.stats)) {
    const x = a.stats[k];
    const y = b.stats[k];
    if (k === 'mejorTiempo') out.stats[k] = x == null ? y : y == null ? x : Math.min(x, y);
    else out.stats[k] = Math.max(x || 0, y || 0);
  }
  out.logros = { ...older.logros, ...newer.logros };
  // Rango: el de la temporada más reciente; en la misma, el que tiene más partidas
  const ra = a.rango;
  const rb = b.rango;
  out.rango = normalizeRank(ra.temporada !== rb.temporada ? (ra.temporada > rb.temporada ? ra : rb) : ra.partidas + ra.colocacion >= rb.partidas + rb.colocacion ? ra : rb);
  out.comprados = { ...older.comprados, ...newer.comprados };
  // Monedas: lo ganado menos lo gastado (los dos, máximos de cada copia)
  out.monedas = Math.max(0, out.stats.monedasGanadas - out.stats.monedasGastadas);
  const seen = new Set();
  out.historial = [...a.historial, ...b.historial]
    .sort((x, y) => y.fecha - x.fecha)
    .filter((h) => (seen.has(h.fecha) ? false : seen.add(h.fecha)))
    .slice(0, HISTORY_MAX);
  return out;
}

/** ¿Tiene el logro? (Object.hasOwn: un id como "constructor" no debe colarse por el prototipo.) */
/**
 * Progreso de un logro medible: { have, need } (have como mucho need), o
 * null si el logro no tiene `meta`. Estadísticas especiales: 'nivel' (el
 * nivel actual) y 'comprados' (objetos de la tienda).
 */
export function achievementProgress(profile, a) {
  if (!a || !a.meta) return null;
  const { stat, n } = a.meta;
  let have;
  if (stat === 'nivel') have = levelInfo(profile.xp || 0).level;
  else if (stat === 'comprados') have = Object.keys(profile.comprados || {}).length;
  else have = Number((profile.stats || {})[stat]) || 0;
  if (hasAchievement(profile, a.id)) have = n;
  return { have: Math.min(n, Math.max(0, Math.floor(have))), need: n };
}

export function hasAchievement(profile, id) {
  return Object.hasOwn(profile.logros, id);
}

/** Concede un logro fuera de una partida (p. ej. el tutorial). Devuelve el logro si es nuevo. */
export function grantAchievement(profile, id) {
  if (hasAchievement(profile, id)) return null;
  const ach = ACHIEVEMENTS.find((a) => a.id === id);
  if (!ach) return null;
  profile.logros[id] = Date.now();
  profile.monedas = (profile.monedas || 0) + (ach.coins || 0);
  profile.stats.monedasGanadas = (profile.stats.monedasGanadas || 0) + (ach.coins || 0);
  saveProfile(profile);
  return ach;
}

export function isUnlocked(profile, item) {
  if (!item || !item.unlock) return true;
  if (item.unlock.level) return levelInfo(profile.xp).level >= item.unlock.level;
  if (item.unlock.ach) return hasAchievement(profile, item.unlock.ach);
  if (item.unlock.price) return Object.hasOwn(profile.comprados || {}, itemKey(item));
  return false;
}

export function unlockText(item) {
  if (!item.unlock) return '';
  if (item.unlock.level) return `Nivel ${item.unlock.level}`;
  if (item.unlock.price) return `🪙 ${item.unlock.price}`;
  const ach = ACHIEVEMENTS.find((a) => a.id === item.unlock.ach);
  return `Logro: ${ach ? ach.name : item.unlock.ach}`;
}

export function titleName(profile) {
  const t = TITLES.find((x) => x.id === profile.titulo);
  return t && t.id ? t.name : '';
}

/**
 * Anota una partida terminada en el perfil. Devuelve la experiencia ganada,
 * los logros nuevos y si se ha subido de nivel.
 */
export function recordGame(profile, r) {
  const before = levelInfo(profile.xp).level;
  const s = profile.stats;
  s.partidas++;
  if (r.won || r.alliedWin) s.victorias++;
  if (r.ranked) s.clasificatorias = (s.clasificatorias || 0) + 1;
  if (r.online) s.online++;
  s.eliminaciones += r.kills;
  s.edificios += r.built;
  s.alianzas += r.alliances;
  s.mejorPct = Math.max(s.mejorPct, r.maxShare);
  s.tiempoJugado += Math.round(r.seconds);
  if (r.won && (s.mejorTiempo == null || r.seconds < s.mejorTiempo)) s.mejorTiempo = Math.round(r.seconds);

  const gained = xpForGame(r);
  profile.xp += gained;
  // Monedas: un poco por jugar (según la partida), más por logros y retos diarios
  let coins = 10 + Math.floor(gained / 6);

  // Retos de hoy: suman lo de esta partida
  const daily = ensureDaily(profile);
  const doneDaily = [];
  for (const id of daily.retos) {
    const d = DAILY.find((x) => x.id === id);
    if (!d || daily.hechos[id]) continue;
    daily.progreso[id] = Math.min(d.need, (daily.progreso[id] || 0) + Math.max(0, d.step(r) || 0));
    if (daily.progreso[id] >= d.need) {
      daily.hechos[id] = true;
      coins += d.coins;
      s.retosDiarios = (s.retosDiarios || 0) + 1;
      doneDaily.push(d);
    }
  }
  let dailyBonus = 0;
  if (!daily.bonus && daily.retos.every((id) => daily.hechos[id])) {
    daily.bonus = true;
    dailyBonus = DAILY_BONUS;
    coins += DAILY_BONUS;
  }

  // Retos de la semana
  const weekly = ensureWeekly(profile);
  const doneWeekly = [];
  for (const id of weekly.retos) {
    const w = WEEKLY.find((x) => x.id === id);
    if (!w || weekly.hechos[id]) continue;
    weekly.progreso[id] = Math.min(w.need, (weekly.progreso[id] || 0) + Math.max(0, w.step(r) || 0));
    if (weekly.progreso[id] >= w.need) {
      weekly.hechos[id] = true;
      coins += w.coins;
      s.retosSemanales = (s.retosSemanales || 0) + 1;
      doneWeekly.push(w);
    }
  }
  if (!weekly.bonus && weekly.retos.every((id) => weekly.hechos[id])) {
    weekly.bonus = true;
    coins += WEEKLY_BONUS;
    doneWeekly.push({ icon: '🗓️', name: '¡Los tres de la semana!', coins: WEEKLY_BONUS });
  }

  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (hasAchievement(profile, a.id)) continue;
    if (a.check(r, profile)) {
      profile.logros[a.id] = Date.now();
      coins += a.coins || 0;
      fresh.push(a);
    }
  }
  profile.monedas = (profile.monedas || 0) + coins;
  s.monedasGanadas = (s.monedasGanadas || 0) + coins;

  profile.historial.unshift({
    fecha: Date.now(),
    resultado: r.won ? 'victoria' : r.alliedWin ? 'victoria en alianza' : r.alive ? 'abandonada' : 'derrota',
    pct: r.maxShare,
    duracion: Math.round(r.seconds),
    mapa: r.mapSize,
    rivales: r.rivals,
    online: r.online,
    // Resumen compacto: puesto entre las naciones, cifras y la curva de tu territorio (~30 puntos, 0-1000)
    puesto: r.place || 0,
    de: r.of || 0,
    elim: r.kills || 0,
    edif: r.built || 0,
    curva: Array.isArray(r.curve) ? r.curve.slice(0, 40) : [],
    clasif: r.ranked || undefined,
    reto: r.challenge ? { de: String(r.challenge.n || '').slice(0, 18), meta: r.challenge.p, superado: !!r.challengeBeaten } : undefined,
  });
  profile.historial.length = Math.min(profile.historial.length, HISTORY_MAX);
  saveProfile(profile);

  return { xp: gained, coins, daily: doneDaily, dailyBonus, weekly: doneWeekly, achievements: fresh, levelUp: levelInfo(profile.xp).level > before };
}
