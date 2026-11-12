// Lugares de interés (doc-1.6): puntos repartidos por la tierra libre del
// mapa. Quien los conquista se lleva su premio al momento (oro, tropas), un
// bono durante unos segundos o una pequeña mejora para siempre. Después
// desaparecen y, al cabo de un rato, aparece otro en otro sitio.
//
// Todo pasa en la simulación con el azar de la partida: el mismo resultado en
// todos los navegadores de una partida en línea.

/**
 * Tipos. `weight`: lo frecuente que sale. `instant`: premio al momento;
 * `buff`: modificadores durante `ticks` turnos; `perm`: modificadores para
 * siempre (los mismos nombres que en tecnologias.js, emptyMods). `short`: lo
 * que da en pocas palabras (el rótulo del mapa y los bonos del panel).
 */
export const LUGARES = {
  tesoro: { name: 'Tesoro escondido', icon: '💰', weight: 3, instant: 'gold', desc: 'Oro al momento (más cuanto más ingresas)', short: 'Oro al momento' },
  mercenarios: { name: 'Campamento de mercenarios', icon: '⚔️', weight: 2, instant: 'troops', desc: '+20 % de tropas al momento (sin pasar del techo)', short: '+20 % tropas' },
  granero: { name: 'Granero', icon: '🌾', weight: 2, buff: { growth: 0.6 }, ticks: 600, desc: '+60 % de crecimiento de tropas durante 60 s', short: '+60 % crecimiento' },
  forja: { name: 'Forja antigua', icon: '🔥', weight: 2, buff: { attackCost: -0.3 }, ticks: 450, desc: 'Atacar cuesta un 30 % menos de tropas durante 45 s', short: 'Ataques −30 %' },
  ruinas: { name: 'Ruinas antiguas', icon: '🏛️', weight: 1, perm: { gold: 0.04 }, desc: '+4 % de oro para siempre', short: '+4 % oro siempre' },
  fortaleza: { name: 'Fortaleza olvidada', icon: '🛡️', weight: 1, perm: { cap: 0.05 }, desc: '+5 % de techo de tropas para siempre', short: '+5 % techo siempre' },
};
export const LUGAR_IDS = Object.keys(LUGARES);

/** Parámetros: cuántos hay (uno cada `landPer` casillas de tierra, entre min y max) y cada cuánto reaparecen. */
export const LUGAR_CFG = {
  landPer: 81000, // casillas de tierra por lugar (con RES 3: unos 16 en el mundo, 10 en el Mediterráneo)
  min: 6,
  max: 30,
  spacing: 25, // separación mínima entre lugares y con las salidas (casillas de la rejilla original, × RES)
  respawnMin: 600, // reaparecen entre 1 y 2 min después de tomarlos
  respawnMax: 1200,
  goldBase: 150000, // tesoro: esto más 30 s de sus ingresos pasivos
  goldIncomeTicks: 300,
  troopShare: 0.2,
};

/** Tipo al azar según su peso (una tirada de `rng`). */
export function pickLugar(rng) {
  let total = 0;
  for (const id of LUGAR_IDS) total += LUGARES[id].weight;
  let r = rng.float() * total;
  for (const id of LUGAR_IDS) {
    r -= LUGARES[id].weight;
    if (r < 0) return id;
  }
  return LUGAR_IDS[0];
}
