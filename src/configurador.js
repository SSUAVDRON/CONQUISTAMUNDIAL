// Configurador común (DEV10): lo que cambia entre dos configuraciones de
// partida (para el borrador del anfitrión y el aviso a los invitados), el
// resumen que distingue plazas humanas, naciones de la IA y colonias, y las
// configuraciones guardadas por separado para la IA y para las salas.
import { DEFAULT_RULES, colonyCount, migrateRules } from './config.js';
import { PROFILES } from './mecanicas.js';

const DIFFICULTY_NAMES = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' };
const VICTORY_NAMES = { dominio: 'Dominación', capitales: 'Capitales', economia: 'Economía', supervivencia: 'Supervivencia' };
const TOGGLES = { missiles: 'misiles', warships: 'buques de guerra', alliances: 'alianzas', boats: 'desembarcos', factories: 'fábricas y trenes' };
const pct = (v) => `${Math.round(v * 100)} %`;
const mult = (v) => `×${String(v).replace('.', ',')}`;
const mins = (v, none) => (v ? `${v} min` : none);

/**
 * Cambios de `b` respecto de `a` en texto corto («mapa: Europa → Mundo»,
 * «naciones de la IA: 20 → 40», «sin misiles»…). `mapName(id)` da el nombre
 * de un mapa. Vacío si las dos dicen lo mismo.
 */
export function settingsDiff(a, b, mapName = (id) => id) {
  if (!a || !b) return [];
  const out = [];
  const ra = { ...DEFAULT_RULES, ...(a.rules || {}) };
  const rb = { ...DEFAULT_RULES, ...(b.rules || {}) };
  const step = (label, x, y, fmt = String) => {
    if (x !== y) out.push(`${label}: ${fmt(x)} → ${fmt(y)}`);
  };
  step('mapa', a.mapSize, b.mapSize, mapName);
  step('naciones de la IA', a.bots, b.bots);
  step('dificultad', a.difficulty, b.difficulty, (v) => DIFFICULTY_NAMES[v] || v);
  step('perfil', ra.profile, rb.profile, (v) => (PROFILES[v] ? PROFILES[v].name : v));
  step('colonias', ra.colonies, rb.colonies, (v) => (v == null ? 'auto' : String(v)));
  step('victoria', ra.victory, rb.victory, (v) => VICTORY_NAMES[v] || v);
  step('dominación', ra.winShare, rb.winShare, pct);
  step('límite de tiempo', ra.timeLimitMin, rb.timeLimitMin, (v) => mins(v, 'sin límite'));
  step('tregua', ra.truceMin, rb.truceMin, (v) => mins(v, 'no'));
  step('economía', ra.economy, rb.economy, (v) => (v === 'workers' ? 'con trabajadores' : 'oro fijo'));
  step('oro inicial', ra.startGold, rb.startGold);
  step('tropas', ra.troopMult, rb.troopMult, mult);
  step('oro', ra.goldMult, rb.goldMult, mult);
  step('precios', ra.priceMult, rb.priceMult, mult);
  for (const [key, name] of Object.entries(TOGGLES)) if ((ra[key] !== false) !== (rb[key] !== false)) out.push(rb[key] !== false ? `con ${name}` : `sin ${name}`);
  if (!!ra.coop !== !!rb.coop) out.push(rb.coop ? 'cooperativo por parejas' : 'sin cooperativo');
  else if (rb.coop && !!ra.coopRoles !== !!rb.coopRoles) out.push(rb.coopRoles ? 'cooperativo con roles' : 'cooperativo sin roles');
  return out;
}

/**
 * Quién juega: «4 plazas humanas · 40 naciones de la IA · 25 colonias». Con
 * cooperativo, cuántas naciones llevan los humanos y quién va en solitario.
 * `landCount` (casillas de tierra del mapa) para las colonias automáticas.
 */
export function seatsSummary({ seats, humans = 0, bots = 0, rules = {}, landCount = 0 }) {
  const r = { ...DEFAULT_RULES, ...rules };
  const colonies = r.colonies ?? (landCount ? colonyCount(landCount, bots) : null);
  const parts = [`${seats} ${seats === 1 ? 'plaza humana' : 'plazas humanas'}`];
  if (r.coop) {
    const nations = Math.ceil(Math.max(humans, 1) / 2);
    parts.push(`${nations} ${nations === 1 ? 'nación humana' : 'naciones humanas'} por parejas`);
  }
  parts.push(`${bots} ${bots === 1 ? 'nación de la IA' : 'naciones de la IA'}`);
  if (colonies != null) parts.push(`${colonies} ${colonies === 1 ? 'colonia' : 'colonias'}${r.colonies == null ? ' (auto)' : ''}`);
  return parts.join(' · ');
}

/**
 * Pareja de cada jugador en el cooperativo, por orden de llegada: 1.º y 2.º,
 * 3.º y 4.º… Con un número impar, el último lleva su nación en solitario.
 * Devuelve, para cada índice, `{ pair, solo }` (o null sin cooperativo).
 */
export function coopSlots(count, coop) {
  if (!coop) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => ({ pair: Math.floor(i / 2) + 1, solo: i === count - 1 && count % 2 === 1 }));
}

/** Configuración guardada (de la IA o de las salas), con sus valores por defecto. */
export function normalizeConfig(c, fallback = {}) {
  const src = c && typeof c === 'object' ? c : {};
  const bots = Number(src.bots ?? fallback.bots);
  return {
    bots: Number.isFinite(bots) ? Math.max(0, Math.round(bots)) : 70,
    mapa: typeof (src.mapa ?? fallback.mapa) === 'string' ? src.mapa ?? fallback.mapa : 'mundo',
    dificultad: typeof (src.dificultad ?? fallback.dificultad) === 'string' ? src.dificultad ?? fallback.dificultad : 'normal',
    reglas: { ...DEFAULT_RULES, ...(migrateRules(src.reglas ?? fallback.reglas) || {}) },
  };
}
