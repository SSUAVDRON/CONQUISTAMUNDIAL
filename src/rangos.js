// Rangos (partidas clasificatorias): ligas con divisiones, puntos de liga
// (PL), un MMR oculto que mide tu nivel real, 5 partidas de colocación,
// escudo tras ascender y temporadas de dos meses con reinicio suave.
//
// Todo el rango cabe en un número, `puntos` (≥ 0):
//   Hierro…Diamante: 400 por liga, 100 por división (IV, III, II, I);
//   Maestro desde 2400, Gran Maestro desde 2600 y Leyenda desde 2900 (sin
//   divisiones: los PL siguen sumando).
// Así subir o bajar de división es solo sumar o restar.

export const LEAGUES = [
  { id: 'hierro', name: 'Hierro', base: 0, color: [138, 143, 152], dark: [62, 66, 74] },
  { id: 'bronce', name: 'Bronce', base: 400, color: [205, 133, 70], dark: [96, 54, 24] },
  { id: 'plata', name: 'Plata', base: 800, color: [208, 218, 230], dark: [92, 104, 122] },
  { id: 'oro', name: 'Oro', base: 1200, color: [244, 196, 78], dark: [130, 88, 16] },
  { id: 'platino', name: 'Platino', base: 1600, color: [86, 214, 196], dark: [20, 94, 98] },
  { id: 'diamante', name: 'Diamante', base: 2000, color: [128, 168, 255], dark: [40, 58, 150] },
  { id: 'maestro', name: 'Maestro', base: 2400, apex: true, color: [196, 126, 255], dark: [84, 30, 140] },
  { id: 'granmaestro', name: 'Gran Maestro', base: 2600, apex: true, color: [255, 98, 98], dark: [130, 20, 30] },
  { id: 'leyenda', name: 'Leyenda', base: 2900, apex: true, color: [255, 227, 161], dark: [150, 96, 20] },
];
export const DIVISIONS = ['IV', 'III', 'II', 'I'];
export const PLACEMENT_GAMES = 5;
export const SHIELD_GAMES = 3;
export const MMR_START = 1000;
export const MAX_POINTS = 5000;
const HISTORY = 40;

/** Nivel de la IA de cada dificultad (en la escala del MMR). */
export const AI_RATING = { facil: 800, normal: 1100, dificil: 1400, imposible: 1700 };

/** Partida clasificatoria contra la IA: siempre la misma (reglas bloqueadas). */
export const RANKED_AI = { mapSize: 'mundo', bots: 90, profile: 'clasico' };
/** Sala clasificatoria (multijugador): también fija; menos bots para que el lockstep vaya holgado. */
export const RANKED_ROOM = { mapSize: 'mundo', bots: 40, profile: 'clasico', difficulty: 'normal' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Liga, división y PL de unos puntos. */
export function rankOf(points) {
  const p = clamp(Math.floor(points || 0), 0, MAX_POINTS);
  let i = LEAGUES.length - 1;
  while (i > 0 && p < LEAGUES[i].base) i--;
  const L = LEAGUES[i];
  if (L.apex) return { league: L, index: i, div: 0, pl: p - L.base, label: L.name, points: p };
  const div = Math.floor((p - L.base) / 100); // 0 = IV … 3 = I
  return { league: L, index: i, div: 4 - div, pl: (p - L.base) % 100, label: `${L.name} ${DIVISIONS[div]}`, points: p };
}

/** Índice de división (para saber si se sube o se baja): 0 = Hierro IV … 23 = Diamante I, 24+ las ligas sin división. */
export function divisionIndex(points) {
  const r = rankOf(points);
  return r.league.apex ? 24 + (r.index - 6) : Math.floor(r.points / 100);
}

/** Primer punto de la división de `points` (lo que protege el escudo). */
export function divisionFloor(points) {
  const r = rankOf(points);
  return r.league.apex ? r.league.base : Math.floor(r.points / 100) * 100;
}

/** Puntos con los que se empieza tras la colocación, según el MMR. */
export function pointsFromMmr(mmr) {
  return clamp(Math.round((mmr - 700) * 2), 0, 2300);
}

/** MMR que corresponde a un rango (para ajustar los PL si tu MMR va por delante o por detrás). */
export function mmrFromPoints(points) {
  return points / 2 + 700;
}

/** Temporada de una fecha: dos meses (ene-feb = 1 … nov-dic = 6). */
export function seasonOf(date = new Date()) {
  const n = Math.floor(date.getMonth() / 2) + 1;
  return `${date.getFullYear()}-${n}`;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «Temporada 6 · noviembre y diciembre de 2026» */
export function seasonName(id) {
  const [y, n] = String(id).split('-').map(Number);
  if (!y || !n) return '';
  return `Temporada ${n} · ${MONTHS[(n - 1) * 2]} y ${MONTHS[(n - 1) * 2 + 1]} de ${y}`;
}

/** Cuándo acaba una temporada (primer día de la siguiente, a las 0:00). */
export function seasonEnd(id) {
  const [y, n] = String(id).split('-').map(Number);
  return new Date(y, n * 2, 1);
}

/**
 * Versión de las reglas de las clasificatorias (DEV07): va con cada rango y
 * cada partida, para saber con qué reglas se consiguió.
 */
export const RANKED_VERSION = 'clasico';
/** Colas con progresión propia (DEV07). */
export const QUEUES = { ia: 'Contra la IA', online: 'En línea' };
/** Partidas aplicadas que se recuerdan (para no aplicar dos veces el mismo final). */
const APPLIED = 40;

/** Rango vacío de un jugador nuevo, de la cola `modalidad` ('ia' u 'online'). */
export function newRank(date = new Date(), modalidad = 'ia') {
  return {
    modalidad,
    version: RANKED_VERSION,
    aplicadas: [], // identificadores de las partidas ya resueltas
    temporada: seasonOf(date),
    mmr: MMR_START,
    puntos: 0,
    colocacion: 0, // partidas de colocación jugadas (hasta PLACEMENT_GAMES)
    partidas: 0,
    victorias: 0,
    escudo: 0, // partidas que quedan con escudo tras ascender
    mejor: 0, // mejores puntos de la temporada
    pendiente: null, // partida clasificatoria empezada y sin terminar: { tipo, inicio }
    historial: [], // [{ fecha, puntos, delta, puesto, de, tipo }]
    anteriores: [], // [{ temporada, puntos, liga }]
  };
}

/** Rango guardado, limpio (o uno nuevo). */
export function normalizeRank(r, modalidad = 'ia') {
  const d = newRank(new Date(), modalidad);
  if (!r || typeof r !== 'object') return d;
  const num = (v, dflt, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
  return {
    ...d,
    temporada: typeof r.temporada === 'string' && /^\d{4}-[1-6]$/.test(r.temporada) ? r.temporada : d.temporada,
    mmr: num(r.mmr, MMR_START, 0, 4000),
    puntos: Math.floor(num(r.puntos, 0, 0, MAX_POINTS)),
    colocacion: Math.floor(num(r.colocacion, 0, 0, PLACEMENT_GAMES)),
    partidas: Math.floor(num(r.partidas, 0, 0, 1e6)),
    victorias: Math.floor(num(r.victorias, 0, 0, 1e6)),
    escudo: Math.floor(num(r.escudo, 0, 0, SHIELD_GAMES)),
    mejor: Math.floor(num(r.mejor, 0, 0, MAX_POINTS)),
    modalidad: r.modalidad === 'online' || r.modalidad === 'mixta' ? r.modalidad : modalidad,
    version: typeof r.version === 'string' ? r.version.slice(0, 24) : RANKED_VERSION,
    aplicadas: Array.isArray(r.aplicadas) ? r.aplicadas.filter((x) => typeof x === 'string').slice(0, APPLIED) : [],
    pendiente: r.pendiente && typeof r.pendiente === 'object' ? { tipo: r.pendiente.tipo === 'sala' ? 'sala' : 'ia', inicio: Number(r.pendiente.inicio) || 0, partida: typeof r.pendiente.partida === 'string' ? r.pendiente.partida.slice(0, 64) : '' } : null,
    historial: Array.isArray(r.historial) ? r.historial.filter((h) => h && Number.isFinite(h.puntos)).slice(0, HISTORY) : [],
    anteriores: Array.isArray(r.anteriores) ? r.anteriores.slice(0, 12) : [],
  };
}

/** ¿Está todavía en colocación (sin rango visible)? */
export function inPlacement(r) {
  return r.colocacion < PLACEMENT_GAMES;
}

/** Dificultad de la IA en la clasificatoria, según la liga (en colocación, Normal). */
export function aiDifficultyFor(r) {
  if (inPlacement(r)) return 'normal';
  const i = rankOf(r.puntos).index;
  return i === 0 ? 'facil' : i <= 2 ? 'normal' : i <= 4 ? 'dificil' : 'imposible';
}

/**
 * Lo que se espera de ti contra una IA de nivel `ai` (puntuación de puesto
 * de 0 a 1): con el mismo nivel, quedar en el primer cuarto; mucho mejor,
 * casi ganar; mucho peor, a media tabla.
 */
export function expectedPerf(mmr, ai) {
  return 0.75 + 0.2 * Math.tanh((mmr - ai) / 300);
}

/** Recompensa al cambiar de temporada, según los mejores puntos de la anterior. */
export function seasonReward(best) {
  const i = rankOf(best).index;
  return { coins: 150 + 100 * i, league: LEAGUES[i] };
}

/**
 * Cambio de temporada: reinicio suave (el MMR se acerca a la mitad al de
 * partida y se repiten 2 partidas de colocación). Devuelve la recompensa de
 * la temporada anterior o null si no hacía falta.
 */
export function ensureSeason(r, date = new Date()) {
  const now = seasonOf(date);
  if (r.temporada === now) return null;
  const played = r.partidas > 0;
  const reward = played ? seasonReward(Math.max(r.mejor, r.puntos)) : null;
  if (played) r.anteriores = [{ temporada: r.temporada, puntos: r.puntos, mejor: Math.max(r.mejor, r.puntos), liga: rankOf(Math.max(r.mejor, r.puntos)).label }, ...r.anteriores].slice(0, 12);
  r.temporada = now;
  r.mmr = MMR_START + (r.mmr - MMR_START) * 0.5;
  r.colocacion = played ? PLACEMENT_GAMES - 2 : 0;
  r.puntos = played ? Math.max(0, pointsFromMmr(r.mmr) - 200) : 0;
  r.mejor = r.puntos;
  r.partidas = 0;
  r.victorias = 0;
  r.escudo = 0;
  r.historial = [];
  return reward;
}

/**
 * Aplica un cambio de MMR y de PL. `perf`/`expected` en la escala de 0 a 1;
 * `pl` es el cambio de PL ya calculado (sin escudo ni límites).
 */
function applyChange(r, { mmrDelta, pl, won, info }) {
  const before = r.puntos;
  const placing = inPlacement(r);
  r.mmr = clamp(r.mmr + mmrDelta, 0, 4000);
  r.partidas++;
  if (won) r.victorias++;
  const out = { before, after: before, delta: 0, placing, placementDone: false, promoted: false, demoted: false, shieldUsed: false, mmrDelta };
  if (placing) {
    r.colocacion++;
    if (!inPlacement(r)) {
      r.puntos = Math.max(r.puntos, pointsFromMmr(r.mmr));
      out.placementDone = true;
      out.after = r.puntos;
      out.delta = r.puntos - before;
    }
  } else {
    let after = clamp(before + Math.round(pl), 0, MAX_POINTS);
    if (r.escudo > 0) {
      const floor = divisionFloor(before);
      if (after < floor) {
        after = floor;
        out.shieldUsed = true;
      }
      r.escudo--;
    }
    out.promoted = divisionIndex(after) > divisionIndex(before);
    out.demoted = divisionIndex(after) < divisionIndex(before);
    if (out.promoted) r.escudo = SHIELD_GAMES;
    r.puntos = after;
    out.after = after;
    out.delta = after - before;
  }
  r.mejor = Math.max(r.mejor, r.puntos);
  r.historial.unshift({ fecha: Date.now(), puntos: r.puntos, delta: out.delta, temporada: r.temporada, version: RANKED_VERSION, ...info });
  r.historial.length = Math.min(r.historial.length, HISTORY);
  remember(r, info.partida);
  return out;
}

/** Anota la partida como resuelta. */
function remember(r, id) {
  if (!id) return;
  r.aplicadas = [id, ...(r.aplicadas || []).filter((x) => x !== id)].slice(0, APPLIED);
}

/** ¿Ya se resolvió esta partida? (un final repetido o tras recargar, DEV07) */
export function alreadyApplied(r, id) {
  return !!id && Array.isArray(r.aplicadas) && r.aplicadas.includes(id);
}

/**
 * Partida anulada (en línea, si se pierde al anfitrión): no cuenta ni a favor
 * ni en contra, pero queda en el historial con su motivo. Una sola vez.
 */
export function voidResult(r, { partida = '', motivo = '' } = {}) {
  if (alreadyApplied(r, partida)) return null;
  r.historial.unshift({ fecha: Date.now(), puntos: r.puntos, delta: 0, tipo: r.modalidad === 'online' ? 'sala' : 'ia', anulada: true, motivo: String(motivo).slice(0, 120), partida: partida || undefined, temporada: r.temporada, version: RANKED_VERSION });
  r.historial.length = Math.min(r.historial.length, HISTORY);
  remember(r, partida);
  return { void: true, motivo, before: r.puntos, after: r.puntos, delta: 0 };
}

/**
 * Migración a colas separadas (DEV07). El rango mixto de antes se guarda
 * entero como histórico; las dos colas empiezan sus colocaciones con tu nivel
 * oculto (MMR) de entonces como punto de partida, y cada una se lleva sus
 * partidas del historial. Devuelve { ia, online, historico }.
 */
export function splitRanks(old, date = new Date()) {
  const mixed = normalizeRank(old, 'mixta');
  const played = mixed.partidas > 0 || mixed.colocacion > 0 || mixed.anteriores.length > 0;
  const seed = (modalidad, tipo) => {
    const r = newRank(date, modalidad);
    r.temporada = mixed.temporada;
    if (played) r.mmr = mixed.mmr;
    r.historial = mixed.historial.filter((h) => (h.tipo === 'sala' ? 'sala' : 'ia') === tipo).map((h) => ({ ...h, previa: true }));
    return r;
  };
  return { ia: seed('ia', 'ia'), online: seed('online', 'sala'), historico: played ? { ...mixed, modalidad: 'mixta', pendiente: null, cerrado: date.getTime() } : null };
}

/** PL de una partida: lo que mejoras lo esperado, ajustado si tu MMR va por delante o por detrás de tu rango. */
function plFor(r, gain, won) {
  const lag = clamp((r.mmr - mmrFromPoints(r.puntos)) / 50, -10, 10);
  let pl = gain + lag + (won ? 8 : 0);
  pl = clamp(pl, -35, 50);
  if (gain >= 0 && pl < 1) pl = 1; // hacerlo mejor de lo esperado nunca resta
  return Math.round(pl);
}

/**
 * Resultado de una clasificatoria contra la IA. `place`: { place, of } entre
 * las naciones; `abandon`: abandonarla cuenta como quedar el último.
 */
export function applyAiResult(r, place, { difficulty = aiDifficultyFor(r), abandon = false, partida = '' } = {}) {
  if (alreadyApplied(r, partida)) return null;
  const perf = abandon || !place ? 0 : place.of <= 1 ? 1 : 1 - (place.place - 1) / (place.of - 1);
  const ai = AI_RATING[difficulty] || AI_RATING.normal;
  // El MMR se mueve según lo esperado de tu nivel real; los PL, según lo
  // esperado de tu rango (y luego se ajustan si tu MMR va por delante o detrás)
  const expected = expectedPerf(r.mmr, ai);
  const expectedRank = expectedPerf(mmrFromPoints(r.puntos), ai);
  const won = !abandon && place && place.place === 1;
  const K = inPlacement(r) ? 120 : 60;
  return applyChange(r, {
    mmrDelta: K * (perf - expected),
    pl: plFor(r, 60 * (perf - expectedRank), won),
    won,
    info: { tipo: 'ia', puesto: abandon ? 0 : place.place, de: place ? place.of : 0, abandono: abandon || undefined, partida: partida || undefined },
  });
}

/**
 * Resultado de una sala clasificatoria: Elo entre las personas (cada pareja,
 * quién quedó por delante) y una parte pequeña según tu puesto entre todas
 * las naciones. `humans`: [{ mmr, place }] de los demás jugadores.
 */
export function applyRoomResult(r, place, humans, { abandon = false, partida = '' } = {}) {
  if (alreadyApplied(r, partida)) return null;
  const perf = abandon || !place ? 0 : place.of <= 1 ? 1 : 1 - (place.place - 1) / (place.of - 1);
  const mine = abandon ? Infinity : place.place;
  let s = 0;
  let e = 0;
  let eRank = 0;
  for (const h of humans) {
    const theirs = Number.isFinite(h.place) && h.place > 0 ? h.place : Infinity;
    s += mine < theirs ? 1 : mine === theirs ? 0.5 : 0;
    e += 1 / (1 + 10 ** (((Number(h.mmr) || MMR_START) - r.mmr) / 400));
    eRank += 1 / (1 + 10 ** (((Number(h.mmr) || MMR_START) - mmrFromPoints(r.puntos)) / 400));
  }
  const n = Math.max(1, humans.length);
  const elo = (s - e) / n; // de -1 a 1
  const eloRank = (s - eRank) / n;
  const nations = perf - 0.75;
  const won = !abandon && place && place.place === 1;
  const K = inPlacement(r) ? 96 : 48;
  return applyChange(r, {
    mmrDelta: K * elo + 20 * nations,
    pl: plFor(r, 45 * eloRank + 12 * nations, won),
    won,
    info: { tipo: 'sala', puesto: abandon ? 0 : place.place, de: place ? place.of : 0, rivales: humans.length, abandono: abandon || undefined, partida: partida || undefined },
  });
}

/** Texto corto del rango: «Plata II · 45 PL», «Colocación 2/5». */
export function rankText(r) {
  if (inPlacement(r)) return `Colocación ${r.colocacion}/${PLACEMENT_GAMES}`;
  const k = rankOf(r.puntos);
  return `${k.label} · ${k.pl} PL`;
}

// ---------------------------------------------------------------- insignia

const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (c, k) => c.map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));

/**
 * Dibuja la insignia de una liga en (cx, cy) con alto `size`: escudo
 * facetado con el metal de la liga, alas o laureles en las altas y la
 * división en números romanos. `league` null = sin rango (colocación).
 */
export function drawBadge(ctx, cx, cy, size, league, div = 0) {
  const s = size / 100;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const L = league || { color: [120, 130, 150], dark: [40, 46, 60], id: 'colocacion', base: -1 };
  const tier = Math.max(0, LEAGUES.indexOf(league));
  // Alas para Diamante y las ligas sin división; laureles desde Oro
  if (league && tier >= 5) {
    ctx.fillStyle = rgb(mix(L.color, -0.15));
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.beginPath();
      ctx.moveTo(18, -18);
      ctx.quadraticCurveTo(52, -40, 58, -6);
      ctx.quadraticCurveTo(46, -10, 40, 2);
      ctx.quadraticCurveTo(50, 6, 48, 22);
      ctx.quadraticCurveTo(36, 12, 22, 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (league && tier >= 3) {
    ctx.strokeStyle = rgb(mix(L.color, -0.2));
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const a = Math.PI * 0.55 + k * 0.28;
        const x = side * Math.cos(a) * -40;
        const y = Math.sin(a) * 40 - 6;
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 3.2, side * (a + Math.PI / 2), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // Escudo facetado
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(0, -44);
    ctx.lineTo(34, -30);
    ctx.lineTo(32, 8);
    ctx.quadraticCurveTo(26, 34, 0, 46);
    ctx.quadraticCurveTo(-26, 34, -32, 8);
    ctx.lineTo(-34, -30);
    ctx.closePath();
  };
  shield();
  const g = ctx.createLinearGradient(-34, -44, 34, 46);
  g.addColorStop(0, rgb(mix(L.color, 0.45)));
  g.addColorStop(0.45, rgb(L.color));
  g.addColorStop(1, rgb(L.dark));
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgb(mix(L.dark, -0.3));
  ctx.stroke();
  // Faceta de brillo
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.lineTo(34, -30);
  ctx.lineTo(0, -6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();
  // Interior: gema
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(16, -4);
  ctx.lineTo(0, 22);
  ctx.lineTo(-16, -4);
  ctx.closePath();
  ctx.fillStyle = rgb(mix(L.dark, -0.35), 0.85);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgb(mix(L.color, 0.5));
  ctx.stroke();
  // Corona en Gran Maestro y Leyenda
  if (league && tier >= 7) {
    ctx.beginPath();
    ctx.moveTo(-20, -46);
    ctx.lineTo(-20, -60);
    ctx.lineTo(-10, -52);
    ctx.lineTo(0, -64);
    ctx.lineTo(10, -52);
    ctx.lineTo(20, -60);
    ctx.lineTo(20, -46);
    ctx.closePath();
    ctx.fillStyle = rgb(mix(L.color, 0.25));
    ctx.fill();
    ctx.strokeStyle = rgb(L.dark);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // División o «?» en colocación
  const label = !league ? '?' : div ? DIVISIONS[4 - div] : '';
  if (label) {
    ctx.font = `900 ${label.length > 2 ? 18 : 22}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(label, 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, 0, 1);
  }
  ctx.restore();
}

/** Un lienzo con la insignia del rango `r` (o de unos puntos), a la densidad de la pantalla. */
export function badgeCanvas(r, px = 48, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = doc.createElement('canvas');
  c.width = c.height = Math.round(px * dpr * 1.3);
  c.style.width = c.style.height = `${Math.round(px * 1.3)}px`;
  c.className = 'insignia';
  c.setAttribute('aria-hidden', 'true');
  paintBadge(c, r);
  return c;
}

/** Repinta un lienzo de insignia con el rango `r` ({ puntos, colocacion } o un número de puntos). */
export function paintBadge(c, r) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const placing = typeof r === 'object' && r && inPlacement(r);
  const k = rankOf(typeof r === 'number' ? r : r ? r.puntos : 0);
  drawBadge(ctx, c.width / 2, c.height * 0.54, c.height * 0.72, placing ? null : k.league, placing ? 0 : k.div);
}
