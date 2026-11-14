// Repetir una partida tal como fue (auditoría DEV01). Al empezar cada partida
// se guarda una instantánea de su configuración (modo, mapa, naciones y
// colonias de verdad, dificultad, reglas completas, perfil, semilla y versión
// de las reglas) y el historial la conserva copiada: cambiar después tus
// preferencias no cambia la partida guardada.
//
// Dos maneras de repetir:
//  - «Repetir configuración»: lo mismo con una semilla nueva (otro reparto).
//  - «Repetir escenario»: también la misma semilla (el mismo reparto inicial,
//    si las reglas no han cambiado de versión desde entonces).
import { DEFAULT_RULES, DIFFICULTIES, MAP_SIZES, REAL_MAPS, migrateRules } from './config.js';
import { MECH_VERSION } from './mecanicas.js';

/** Instantánea serializable de la configuración de una partida. */
export function configSnapshot({ mode = 'ia', mapSize, nations, colonies, difficulty, rules, seed }) {
  const src = migrateRules(rules) || {};
  const reglas = {};
  for (const k of Object.keys(DEFAULT_RULES)) {
    const v = k in src ? src[k] : DEFAULT_RULES[k];
    reglas[k] = v === undefined ? null : v;
  }
  // Las colonias que hubo de verdad (también 0): al repetir no se recalculan
  reglas.colonies = colonies;
  return {
    v: 1,
    modo: mode,
    mapa: mapSize,
    naciones: Math.max(0, Math.round(nations || 0)),
    colonias: Math.max(0, Math.round(colonies || 0)),
    dificultad: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    reglas,
    perfil: reglas.profile,
    semilla: seed >>> 0,
    version: MECH_VERSION,
  };
}

/** ¿Es una instantánea utilizable? (las de registros antiguos o dañados, no) */
export function validConfig(c) {
  return !!(c && c.v === 1 && (REAL_MAPS[c.mapa] || MAP_SIZES[c.mapa]) && Number.isFinite(c.naciones) && Number.isFinite(c.colonias) && c.reglas && typeof c.reglas === 'object');
}

/**
 * Qué hacer al repetir la entrada `entry` del historial:
 *  - { kind: 'jugar', opts, versionChanged } con las opciones de startGame;
 *  - { kind: 'tutorial' } o { kind: 'online' } (eso no se repite contra la IA);
 *  - { kind: 'revisar', prefill } si es un registro antiguo sin instantánea:
 *    se abre el configurador con lo que se pueda recuperar y un aviso.
 * `scenario`: también la misma semilla.
 */
export function replayPlan(entry, { scenario = false } = {}) {
  if (!entry) return null;
  const c = entry.config;
  if (c && c.modo === 'tutorial') return { kind: 'tutorial' };
  if (entry.online || (c && c.modo === 'online')) return { kind: 'online' };
  if (!validConfig(c)) {
    const map = REAL_MAPS[entry.mapa] || MAP_SIZES[entry.mapa] ? entry.mapa : null;
    return { kind: 'revisar', prefill: { mapSize: map } };
  }
  const opts = {
    mapSize: c.mapa,
    bots: c.naciones,
    difficulty: c.dificultad,
    seed: '',
    rules: { ...DEFAULT_RULES, ...c.reglas, colonies: c.colonias },
  };
  if (scenario) opts.seedNum = c.semilla >>> 0;
  return { kind: 'jugar', opts, versionChanged: c.version !== MECH_VERSION, version: c.version };
}

/** Resumen corto de una instantánea para la tarjeta («90 naciones · 299 colonias · Clásico · IA Normal»). */
export function configSummary(c, profileName = (id) => id, difficultyName = (id) => id) {
  if (!validConfig(c)) return '';
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  // En un mapa generado, la semilla (con ella sale el mismo mapa, DEV10)
  const seed = REAL_MAPS[c.mapa] ? null : `semilla ${c.semilla}`;
  return [n(c.naciones, 'nación', 'naciones'), n(c.colonias, 'colonia', 'colonias'), profileName(c.perfil), `IA ${difficultyName(c.dificultad)}`, seed].filter(Boolean).join(' · ');
}
