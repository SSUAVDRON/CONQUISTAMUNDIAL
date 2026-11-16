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

/**
 * Ajuste de PL por partida (de −10 a +10) cuando tu nivel oculto (MMR) va por
 * delante (+) o por detrás (−) de tu rango.
 */
export function mmrLag(r) {
  return Math.round(clamp((r.mmr - mmrFromPoints(r.puntos)) / 50, -10, 10));
}

/**
 * Lo que te daría la próxima partida según cómo quedes, calculado sobre una
 * copia de tu rango (el tuyo no se toca). En colocación, como si ya la
 * hubieras acabado con tu nivel de ahora (`estimate`: ese rango estimado).
 * kind 'ia': tu puesto entre las naciones; 'sala': entre 5 personas de tu nivel.
 */
export function previewResults(r, kind = 'ia') {
  const base = normalizeRank(JSON.parse(JSON.stringify(r)), r.modalidad);
  base.aplicadas = [];
  const placing = inPlacement(base);
  if (placing) {
    base.colocacion = PLACEMENT_GAMES;
    base.puntos = Math.max(base.puntos, pointsFromMmr(base.mmr));
  }
  const run = (fn) => {
    const c = JSON.parse(JSON.stringify(base));
    const out = fn(c);
    return out ? out.delta : 0;
  };
  let rows;
  if (kind === 'sala') {
    const total = RANKED_ROOM.bots + 5;
    // Tú y 4 personas de tu nivel; tu puesto entre ellas y, aproximado, entre todas las naciones
    const spots = [
      { human: 1, place: 1, label: '1.º de 5', sub: 'ganas la partida' },
      { human: 2, place: 4, label: '2.º de 5', sub: 'por delante de 3' },
      { human: 3, place: 9, label: '3.º de 5', sub: 'a media tabla' },
      { human: 5, place: 26, label: '5.º de 5', sub: 'el último de las personas' },
    ];
    rows = spots.map((sp) => ({
      label: sp.label,
      sub: sp.sub,
      delta: run((c) => applyRoomResult(c, { place: sp.place, of: total }, [1, 2, 3, 4, 5].filter((h) => h !== sp.human).map((h) => ({ mmr: base.mmr, place: h < sp.human ? h : h + 30 })))),
    }));
    rows.push({ label: 'Abandonar', sub: 'cuenta como quedar el último', delta: run((c) => applyRoomResult(c, { place: total, of: total }, [1, 2, 3, 4].map((h) => ({ mmr: base.mmr, place: h })), { abandon: true })) });
  } else {
    const total = RANKED_AI.bots + 1;
    const mid = Math.round(total / 2);
    const spots = [
      [1, '1.º', 'ganas la partida'],
      [5, '5.º', 'entre los mejores'],
      [15, '15.º', 'primer sexto'],
      [mid, `${mid}.º`, 'a media tabla'],
      [total, `${total}.º`, 'el último o abandonar'],
    ];
    rows = spots.map(([place, label, sub]) => ({ label, sub, delta: run((c) => applyAiResult(c, { place, of: total })) }));
  }
  return { rows, placing, estimate: placing ? rankOf(base.puntos).label : '', lag: mmrLag(base), shield: base.escudo };
}

/**
 * Tu próximo objetivo: la división o liga siguiente y los PL que faltan
 * (null en Leyenda: ya no hay más arriba).
 */
export function nextGoal(r) {
  const k = rankOf(r.puntos);
  if (k.league.id === 'leyenda') return null;
  if (k.league.apex) {
    const L = LEAGUES[k.index + 1];
    return { label: L.name, need: L.base - k.points, league: L };
  }
  const nextPts = Math.floor(k.points / 100) * 100 + 100;
  const n = rankOf(nextPts);
  return { label: n.label, need: nextPts - k.points, league: n.league, promotion: n.index > k.index };
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
const TAU = Math.PI * 2;

/**
 * Dibuja la insignia de una liga en (cx, cy) con alto `size`. Cada liga tiene
 * su forma y sus adornos, que crecen con ella: medallón remachado (Hierro) o
 * con un sol de ocho puntas (Bronce); escudo con laureles (Plata, Oro); alas por capas desde
 * Platino, más grandes en Diamante; rayos, tiara o corona en las ligas sin
 * división (Maestro, Gran Maestro, Leyenda). En el centro, una gema facetada
 * que crece con la liga; abajo, una cinta con la división. `league` null =
 * sin rango (colocación: medallón gris con «?»). `opts.shine` (0-1): una
 * franja de luz que cruza el escudo (para animarla, se repinta).
 */
export function drawBadge(ctx, cx, cy, size, league, div = 0, opts = {}) {
  const s = size / 100;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const L = league || { color: [150, 158, 174], dark: [52, 58, 72], id: 'colocacion', base: -1 };
  const tier = league ? Math.max(0, LEAGUES.indexOf(league)) : -1;
  const C = L.color;
  const D = L.dark;
  const lite = mix(C, 0.55);
  const deep = mix(D, -0.35);
  const medal = tier <= 1; // Hierro, Bronce y colocación: medallón
  const apex = !!(league && league.apex);

  // ---- Detrás: halo y rayos
  if (tier >= 4) {
    const g = ctx.createRadialGradient(0, -2, 8, 0, -2, 70);
    g.addColorStop(0, rgb(C, tier >= 6 ? 0.55 : 0.35));
    g.addColorStop(1, rgb(C, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -2, 70, 0, TAU);
    ctx.fill();
  }
  if (apex) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      const len = i % 2 ? 54 : 66;
      const w = 0.09;
      const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      g.addColorStop(0, rgb(lite, 0.5));
      g.addColorStop(1, rgb(lite, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - w) * 18, Math.sin(a - w) * 18 - 2);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len - 2);
      ctx.lineTo(Math.cos(a + w) * 18, Math.sin(a + w) * 18 - 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- Alas (desde Platino): un abanico de plumas largas que sale del hombro
  // del escudo y lo rebasa por arriba y por los lados; más plumas y más
  // largas cuanto más alta la liga
  if (tier >= 4) {
    const feathers = tier >= 7 ? 7 : tier >= 5 ? 6 : 5;
    const reach = 40 + Math.min(4, tier - 4) * 2.5;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      for (let i = 0; i < feathers; i++) {
        const t = i / (feathers - 1);
        const rx = 22;
        const ry = -12 + t * 6;
        const a = -1.3 + t * 1.6;
        const len = reach - t * 14;
        const tx = rx + Math.cos(a) * len;
        const ty = ry + Math.sin(a) * len;
        const nx = -Math.sin(a);
        const ny = Math.cos(a);
        const w = 6.5;
        const g = ctx.createLinearGradient(rx, ry, tx, ty);
        g.addColorStop(0, rgb(deep));
        g.addColorStop(0.45, rgb(C));
        g.addColorStop(1, rgb(lite));
        ctx.fillStyle = g;
        ctx.strokeStyle = rgb(mix(D, -0.6), 0.95);
        ctx.lineWidth = 1.3;
        // Pluma: hoja larga con la punta redondeada
        const mx = rx + (tx - rx) * 0.62;
        const my = ry + (ty - ry) * 0.62;
        ctx.beginPath();
        ctx.moveTo(rx - nx * 3, ry - ny * 3);
        ctx.quadraticCurveTo(mx - nx * w * 1.2, my - ny * w * 1.2, tx - nx * 1.5, ty - ny * 1.5);
        ctx.quadraticCurveTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 4, tx + nx * 2, ty + ny * 2);
        ctx.quadraticCurveTo(mx + nx * w, my + ny * w, rx + nx * 3, ry + ny * 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Raquis
        ctx.strokeStyle = rgb(lite, 0.55);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(rx + Math.cos(a) * 6, ry + Math.sin(a) * 6);
        ctx.lineTo(tx - Math.cos(a) * 4, ty - Math.sin(a) * 4);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (tier === 2 || tier === 3) {
    // Laureles (Plata y Oro): ramas que abrazan el escudo
    const leaves = tier === 3 ? 7 : 6;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.strokeStyle = rgb(deep);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -4, 44, Math.PI * 0.42, Math.PI * 0.92);
      ctx.stroke();
      for (let k = 0; k < leaves; k++) {
        const a = Math.PI * 0.44 + (k / (leaves - 1)) * Math.PI * 0.5;
        const x = Math.cos(a) * 44;
        const y = Math.sin(a) * 44 - 4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI * 0.62);
        const g = ctx.createLinearGradient(-8, 0, 8, 0);
        g.addColorStop(0, rgb(C));
        g.addColorStop(1, rgb(lite));
        ctx.fillStyle = g;
        ctx.strokeStyle = rgb(deep);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8.5, 3.6, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  } else if (tier === 1) {
    // Bronce: un sol de ocho puntas detrás del medallón
    ctx.strokeStyle = rgb(deep);
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 8; k++) {
      ctx.save();
      ctx.rotate((k * Math.PI) / 4);
      const g = ctx.createLinearGradient(0, -30, 0, -48);
      g.addColorStop(0, rgb(mix(C, -0.25)));
      g.addColorStop(1, rgb(lite));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-7, -31);
      ctx.lineTo(0, k % 2 ? -44 : -49);
      ctx.lineTo(7, -31);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Cuerpo: medallón o escudo, metal con bisel
  const body = () => {
    ctx.beginPath();
    if (medal) ctx.arc(0, 0, 37, 0, TAU);
    else {
      ctx.moveTo(0, -46);
      ctx.bezierCurveTo(13, -46, 26, -42, 36, -36);
      ctx.lineTo(36, -6);
      ctx.bezierCurveTo(36, 18, 22, 36, 0, 48);
      ctx.bezierCurveTo(-22, 36, -36, 18, -36, -6);
      ctx.lineTo(-36, -36);
      ctx.bezierCurveTo(-26, -42, -13, -46, 0, -46);
      ctx.closePath();
    }
  };
  const inset = (k, dy = 0) => {
    ctx.save();
    ctx.translate(0, dy);
    ctx.scale(k, k);
    body();
    ctx.restore();
  };
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  body();
  const metal = ctx.createLinearGradient(-30, -46, 30, 48);
  metal.addColorStop(0, rgb(lite));
  metal.addColorStop(0.38, rgb(C));
  metal.addColorStop(0.72, rgb(D));
  metal.addColorStop(1, rgb(deep));
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = rgb(mix(D, -0.6));
  body();
  ctx.stroke();
  // Bisel: borde claro por dentro
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rgb(lite, 0.75);
  inset(0.9, medal ? 0 : -1);
  ctx.stroke();
  // Placa interior más oscura
  inset(0.72, medal ? 0 : -2);
  const plate = ctx.createLinearGradient(0, -34, 0, 34);
  plate.addColorStop(0, rgb(mix(D, -0.15)));
  plate.addColorStop(1, rgb(mix(D, -0.6)));
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = rgb(mix(C, 0.2), 0.55);
  ctx.stroke();
  // Remaches del medallón
  if (medal) {
    ctx.fillStyle = rgb(lite);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 32.5, Math.sin(a) * 32.5, 1.7, 0, TAU);
      ctx.fill();
    }
  } else {
    // Grabado: dos galones bajo la gema
    ctx.strokeStyle = rgb(mix(C, 0.35), 0.4);
    ctx.lineWidth = 1.6;
    for (const y of [16, 22]) {
      ctx.beginPath();
      ctx.moveTo(-13, y - 5);
      ctx.lineTo(0, y + 2);
      ctx.lineTo(13, y - 5);
      ctx.stroke();
    }
  }

  // ---- Gema facetada (o «?» en colocación)
  if (!league) {
    ctx.font = '900 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText('?', 0, 2);
    ctx.fillStyle = '#f2f4f8';
    ctx.fillText('?', 0, 2);
  } else {
    const gy = medal ? 0 : -6;
    const sides = tier >= 6 ? 8 : tier >= 4 ? 6 : 4;
    const R = 11 + tier * 1.25;
    const pts = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU - Math.PI / 2;
      const rr = sides === 8 && k % 2 ? R * 0.62 : R;
      pts.push([Math.cos(a) * rr, gy + Math.sin(a) * rr * (sides === 4 ? 1.25 : 1)]);
    }
    const gLite = mix(C, 0.75);
    const gDark = mix(D, -0.25);
    ctx.save();
    ctx.shadowColor = rgb(C, 0.9);
    ctx.shadowBlur = tier >= 4 ? 14 : 6;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = rgb(C);
    ctx.fill();
    ctx.restore();
    for (let k = 0; k < sides; k++) {
      const [x1, y1] = pts[k];
      const [x2, y2] = pts[(k + 1) % sides];
      const mid = Math.atan2((y1 + y2) / 2 - gy, (x1 + x2) / 2);
      const light = (Math.cos(mid - (-Math.PI * 0.75)) + 1) / 2; // arriba a la izquierda, más claro
      const col = gDark.map((v, i) => Math.round(v + (gLite[i] - v) * light));
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fillStyle = rgb(col);
      ctx.fill();
    }
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgb(mix(C, 0.85), 0.9);
    ctx.stroke();
    // Destello
    const sx = -R * 0.35;
    const sy = gy - R * 0.45;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 5);
    ctx.quadraticCurveTo(sx + 0.8, sy - 0.8, sx + 5, sy);
    ctx.quadraticCurveTo(sx + 0.8, sy + 0.8, sx, sy + 5);
    ctx.quadraticCurveTo(sx - 0.8, sy + 0.8, sx - 5, sy);
    ctx.quadraticCurveTo(sx - 0.8, sy - 0.8, sx, sy - 5);
    ctx.fill();
  }

  // ---- Tiara (Maestro) o corona (Gran Maestro y Leyenda)
  if (tier === 6) {
    ctx.fillStyle = rgb(lite);
    ctx.strokeStyle = rgb(deep);
    ctx.lineWidth = 1.4;
    for (const [x, h] of [[-12, 9], [0, 15], [12, 9]]) {
      ctx.beginPath();
      ctx.moveTo(x - 5, -44);
      ctx.lineTo(x, -44 - h);
      ctx.lineTo(x + 5, -44);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (tier >= 7) {
    const gold = tier === 8 ? [255, 236, 170] : [255, 200, 110];
    const g = ctx.createLinearGradient(0, -66, 0, -44);
    g.addColorStop(0, rgb(mix(gold, 0.5)));
    g.addColorStop(1, rgb(mix(gold, -0.35)));
    ctx.fillStyle = g;
    ctx.strokeStyle = rgb(mix(gold, -0.65));
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-22, -44);
    ctx.lineTo(-24, -60);
    ctx.lineTo(-12, -51);
    ctx.lineTo(0, -66);
    ctx.lineTo(12, -51);
    ctx.lineTo(24, -60);
    ctx.lineTo(22, -44);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgb(C);
    for (const [x, y] of [[-24, -61], [0, -67], [24, -61]]) {
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
    }
  }

  // ---- Franja de luz (animada desde fuera)
  const shine = Number(opts.shine);
  if (shine >= 0 && shine <= 1) {
    ctx.save();
    body();
    ctx.clip();
    const x = -90 + shine * 180;
    const g = ctx.createLinearGradient(x - 22, -50, x + 22, 50);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 0.42)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-60, -60, 120, 120);
    ctx.restore();
  }

  // ---- Cinta con la división
  const label = league && div ? DIVISIONS[4 - div] : '';
  if (label) {
    const y = medal ? 30 : 34;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    const tail = (dir) => {
      ctx.beginPath();
      ctx.moveTo(dir * 18, y + 2);
      ctx.lineTo(dir * 32, y + 2);
      ctx.lineTo(dir * 27, y + 8);
      ctx.lineTo(dir * 32, y + 14);
      ctx.lineTo(dir * 18, y + 14);
      ctx.closePath();
      ctx.fillStyle = rgb(mix(D, -0.55));
      ctx.fill();
    };
    tail(-1);
    tail(1);
    ctx.beginPath();
    ctx.moveTo(-22, y - 1);
    ctx.lineTo(22, y - 1);
    ctx.lineTo(24, y + 6);
    ctx.lineTo(22, y + 13);
    ctx.lineTo(-22, y + 13);
    ctx.lineTo(-24, y + 6);
    ctx.closePath();
    const rib = ctx.createLinearGradient(0, y - 1, 0, y + 13);
    rib.addColorStop(0, rgb(mix(D, -0.1)));
    rib.addColorStop(1, rgb(mix(D, -0.5)));
    ctx.fillStyle = rib;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = rgb(lite, 0.9);
    ctx.stroke();
    ctx.font = '900 12px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6dc';
    ctx.fillText(label, 0, y + 6.5);
  }

  // ---- Destellos de Leyenda
  if (tier === 8) {
    ctx.fillStyle = 'rgba(255, 250, 230, 0.95)';
    for (const [x, y, r] of [[-46, -34, 5], [48, -22, 4], [-40, 30, 3.5], [44, 34, 4.5]]) {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x + r * 0.15, y - r * 0.15, x + r, y);
      ctx.quadraticCurveTo(x + r * 0.15, y + r * 0.15, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.15, y + r * 0.15, x - r, y);
      ctx.quadraticCurveTo(x - r * 0.15, y - r * 0.15, x, y - r);
      ctx.fill();
    }
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
