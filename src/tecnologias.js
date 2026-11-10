// Desarrollo de cada nación: tecnologías (árbol compacto), especialización
// económica, puntos estratégicos que posee y su postura militar. Todo se
// resume en unos pocos modificadores (`mods`) que la simulación aplica en un
// solo sitio cada uno.

/** Modificadores de una nación: fracciones que se suman (0 = sin efecto). */
export function emptyMods() {
  return {
    growth: 0, // crecimiento de la población
    cap: 0, // población máxima
    gold: 0, // oro pasivo (base y trabajadores)
    factoryBonus: 0, // oro extra de los trenes de tus fábricas
    trade: 0, // oro de trenes y mercantes
    attackSpeed: 0, // velocidad de avance de tus ataques
    attackCost: 0, // tropas que cuesta cada casilla al atacar
    defense: 0, // coste para quien te ataca
    buildSpeed: 0, // obras más rápidas
    boatSpeed: 0,
    boats: 0, // barcos de transporte extra
    samHit: 0, // acierto de los antimisiles
    missileCost: 0,
    reload: 0, // recarga de los silos
    fortRadius: 0,
    militia: 0, // la población civil defiende (ver Game.defenders)
    railRange: 0,
    cityCost: 0,
    factoryCost: 0,
  };
}

/**
 * Árbol de tecnologías: tres ramas con dos niveles. Las de nivel 2 piden
 * antes una de nivel 1 de su rama. Cada investigación encarece la siguiente
 * (no se puede tener todo): hay que especializarse.
 */
export const TECHS = {
  agricultura: { branch: 'eco', tier: 1, name: 'Agricultura', desc: '+15 % de crecimiento de la población', mods: { growth: 0.15 } },
  banca: { branch: 'eco', tier: 1, name: 'Banca', desc: '+20 % de oro pasivo', mods: { gold: 0.2 } },
  urbanismo: { branch: 'eco', tier: 2, name: 'Urbanismo', desc: '+20 % de población máxima', mods: { cap: 0.2 } },
  comercio: { branch: 'eco', tier: 2, name: 'Comercio', desc: '+40 % de oro de trenes y mercantes', mods: { trade: 0.4 } },
  movilizacion: { branch: 'mil', tier: 1, name: 'Movilización', desc: 'Tus ataques avanzan un 25 % más rápido', mods: { attackSpeed: 0.25 } },
  logistica: { branch: 'mil', tier: 1, name: 'Logística', desc: 'Atacar te cuesta un 15 % menos de tropas', mods: { attackCost: -0.15 } },
  marina: { branch: 'mil', tier: 2, name: 'Marina', desc: '+1 barco de transporte y barcos un 40 % más rápidos', mods: { boats: 1, boatSpeed: 0.4 } },
  artilleria: { branch: 'mil', tier: 2, name: 'Artillería', desc: 'Misiles un 25 % más baratos y silos que recargan un 30 % antes', mods: { missileCost: -0.25, reload: -0.3 } },
  fortificacion: { branch: 'def', tier: 1, name: 'Fortificación', desc: 'Conquistarte cuesta un 20 % más', mods: { defense: 0.2 } },
  ingenieria: { branch: 'def', tier: 1, name: 'Ingeniería', desc: 'Obras un 40 % más rápidas y fortalezas con un 30 % más de radio', mods: { buildSpeed: 0.4, fortRadius: 0.3 } },
  radar: { branch: 'def', tier: 2, name: 'Radar', desc: '+20 % de acierto de los antimisiles', mods: { samHit: 0.2 } },
  milicia: { branch: 'def', tier: 2, name: 'Milicia', desc: 'Tu población civil defiende: +15 % de fuerza al defender (con trabajadores, un 25 % de ellos)', mods: { militia: 0.25 } },
};
export const TECH_IDS = Object.keys(TECHS);
export const BRANCHES = { eco: 'Economía', mil: 'Ejército', def: 'Defensa' };

/**
 * Especialización económica: una dirección reconocible. La primera elección
 * es gratis; cambiarla cuesta oro.
 */
export const SPECS = {
  industria: { name: 'Industria', desc: '+25 % de oro pasivo y los trenes de tus fábricas un 50 % más rentables, pero las fábricas cuestan un 25 % más', mods: { gold: 0.25, factoryBonus: 0.5, factoryCost: 0.25 } },
  infra: { name: 'Infraestructura', desc: 'Trenes y mercantes un 60 % más rentables, raíles con un 30 % más de alcance y +1 barco', mods: { trade: 0.6, railRange: 0.3, boats: 1 } },
  urbano: { name: 'Desarrollo urbano', desc: '+15 % de población máxima, +10 % de crecimiento y ciudades un 20 % más baratas', mods: { cap: 0.15, growth: 0.1, cityCost: -0.2 } },
};
export const SPEC_IDS = Object.keys(SPECS);

/** ¿Puede `p` empezar a investigar `id`? Devuelve el motivo si no. */
export function techAvailable(p, id) {
  const t = TECHS[id];
  if (!t) return { ok: false, reason: 'No existe' };
  if (p.techs.has(id)) return { ok: false, reason: 'Ya investigada' };
  if (p.research) return { ok: false, reason: 'Ya estás investigando otra' };
  if (t.tier > 1 && !TECH_IDS.some((o) => TECHS[o].branch === t.branch && TECHS[o].tier === 1 && p.techs.has(o))) {
    return { ok: false, reason: `Antes, una de nivel 1 de ${BRANCHES[t.branch]}` };
  }
  return { ok: true, reason: '' };
}

/** Suma de los modificadores de una lista de fuentes. */
export function addMods(into, mods, times = 1) {
  for (const k in mods) into[k] += mods[k] * times;
  return into;
}
