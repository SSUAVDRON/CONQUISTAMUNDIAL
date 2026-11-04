// Perfil del jugador: identidad (nombre, color, emblema, patrón, título),
// experiencia y nivel, estadísticas, historial y logros. Se guarda en este
// navegador y, si la plataforma lo permite, también en la nube (cloud.js).

const KEY = 'dominia.perfil.v1';
const OLD_PREFS = 'dominia.prefs';
const HISTORY_MAX = 20;

// ------------------------------------------------------------- catálogo

/** `unlock`: null = libre; { level: n } o { ach: 'id-de-logro' }. */
export const SHAPES = [
  { id: 'escudo', name: 'Escudo', unlock: null },
  { id: 'circulo', name: 'Círculo', unlock: null },
  { id: 'rombo', name: 'Rombo', unlock: { level: 2 } },
  { id: 'hexagono', name: 'Hexágono', unlock: { level: 4 } },
  { id: 'estandarte', name: 'Estandarte', unlock: { level: 6 } },
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
];

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
];

/**
 * Logros. `check(r, profile)` recibe el resultado de la partida (ver
 * gameResult en main.js) y el perfil ya actualizado con ella.
 */
export const ACHIEVEMENTS = [
  { id: 'primera_partida', icon: '🌱', name: 'Primeros pasos', desc: 'Juega una partida', check: () => true },
  { id: 'primera_victoria', icon: '🏆', name: 'Conquistador', desc: 'Gana una partida', check: (r) => r.won || r.alliedWin },
  { id: 'gran_victoria', icon: '🌍', name: 'Señor del mundo', desc: 'Gana en el mapa del mundo o en uno grande', check: (r) => (r.won || r.alliedWin) && (r.mapSize === 'grande' || r.mapSize === 'mundo') },
  { id: 'relampago', icon: '⚡', name: 'Guerra relámpago', desc: 'Gana en menos de 12 minutos', check: (r) => r.won && r.seconds < 720 },
  { id: 'alianza_victoriosa', icon: '🤝', name: 'Juntos somos más', desc: 'Gana en alianza', check: (r) => r.alliedWin },
  { id: 'verdugo', icon: '⚔️', name: 'Verdugo', desc: 'Elimina a 5 naciones en una partida', check: (r) => r.kills >= 5 },
  { id: 'arquitecto', icon: '🏗️', name: 'Arquitecto', desc: 'Construye 10 edificios en una partida', check: (r) => r.built >= 10 },
  { id: 'metropolis', icon: '🏙️', name: 'Metrópolis', desc: 'Ten 5 ciudades a la vez', check: (r) => r.maxCities >= 5 },
  { id: 'marino', icon: '⚓', name: 'Lobo de mar', desc: 'Desembarca 5 veces en una partida', check: (r) => r.landings >= 5 },
  { id: 'diplomatico', icon: '🕊️', name: 'Diplomático', desc: 'Firma 3 alianzas en una partida', check: (r) => r.alliances >= 3 },
  { id: 'traidor', icon: '🗡️', name: 'Puñal en la espalda', desc: 'Rompe una alianza', check: (r) => r.betrayals >= 1 },
  { id: 'superviviente', icon: '🛡️', name: 'Superviviente', desc: 'Sigue en pie a los 15 minutos', check: (r) => r.survivedSeconds >= 900 },
  { id: 'medio_mundo', icon: '🗺️', name: 'Medio mundo', desc: 'Controla el 50 % de la tierra', check: (r) => r.maxShare >= 0.5 },
  { id: 'en_compania', icon: '👥', name: 'En compañía', desc: 'Juega una partida online', check: (r) => r.online },
  { id: 'veterano', icon: '🎖️', name: 'Veterano', desc: 'Juega 10 partidas', check: (r, p) => p.stats.partidas >= 10 },
  { id: 'tesoro', icon: '💰', name: 'Tesoro real', desc: 'Reúne 100.000 de oro', check: (r) => r.maxGold >= 100000 },
];

/** Qué desbloquea cada logro (para mostrarlo en la ficha del logro). */
export function rewardsOf(achId) {
  const out = [];
  for (const [list, kind] of [[SYMBOLS, 'Símbolo'], [PATTERNS, 'Patrón'], [TITLES, 'Título']]) {
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
    },
    logros: {}, // id → fecha (ms)
    historial: [], // { fecha, resultado, pct, duracion, mapa, rivales, online }
    ajustes: { bots: 25, mapa: 'mundo', dificultad: 'normal' },
    actualizado: 0,
  };
}

/** Rellena campos que falten (perfiles de versiones anteriores o de la nube). */
export function normalizeProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  return {
    ...d,
    ...p,
    emblema: { ...d.emblema, ...(p.emblema || {}) },
    stats: { ...d.stats, ...(p.stats || {}) },
    logros: Object.fromEntries(Object.entries(p.logros || {}).filter(([k, v]) => ACHIEVEMENTS.some((a) => a.id === k) && Number.isFinite(v))),
    historial: Array.isArray(p.historial) ? p.historial.slice(0, HISTORY_MAX) : [],
    ajustes: { ...d.ajustes, ...(p.ajustes || {}) },
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
  const seen = new Set();
  out.historial = [...a.historial, ...b.historial]
    .sort((x, y) => y.fecha - x.fecha)
    .filter((h) => (seen.has(h.fecha) ? false : seen.add(h.fecha)))
    .slice(0, HISTORY_MAX);
  return out;
}

/** ¿Tiene el logro? (Object.hasOwn: un id como "constructor" no debe colarse por el prototipo.) */
export function hasAchievement(profile, id) {
  return Object.hasOwn(profile.logros, id);
}

export function isUnlocked(profile, item) {
  if (!item || !item.unlock) return true;
  if (item.unlock.level) return levelInfo(profile.xp).level >= item.unlock.level;
  if (item.unlock.ach) return hasAchievement(profile, item.unlock.ach);
  return false;
}

export function unlockText(item) {
  if (!item.unlock) return '';
  if (item.unlock.level) return `Nivel ${item.unlock.level}`;
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
  if (r.online) s.online++;
  s.eliminaciones += r.kills;
  s.edificios += r.built;
  s.alianzas += r.alliances;
  s.mejorPct = Math.max(s.mejorPct, r.maxShare);
  s.tiempoJugado += Math.round(r.seconds);
  if (r.won && (s.mejorTiempo == null || r.seconds < s.mejorTiempo)) s.mejorTiempo = Math.round(r.seconds);

  const gained = xpForGame(r);
  profile.xp += gained;

  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (hasAchievement(profile, a.id)) continue;
    if (a.check(r, profile)) {
      profile.logros[a.id] = Date.now();
      fresh.push(a);
    }
  }

  profile.historial.unshift({
    fecha: Date.now(),
    resultado: r.won ? 'victoria' : r.alliedWin ? 'victoria en alianza' : r.alive ? 'abandonada' : 'derrota',
    pct: r.maxShare,
    duracion: Math.round(r.seconds),
    mapa: r.mapSize,
    rivales: r.rivals,
    online: r.online,
  });
  profile.historial.length = Math.min(profile.historial.length, HISTORY_MAX);
  saveProfile(profile);

  return { xp: gained, achievements: fresh, levelUp: levelInfo(profile.xp).level > before };
}
