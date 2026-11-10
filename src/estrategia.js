// Puntos estratégicos: no todo el territorio vale lo mismo. Capitales de las
// naciones, núcleos industriales, puertos clave y pasos de montaña, con
// efectos claros para quien los controle. Se colocan con la semilla de la
// partida (igual en todos los jugadores del multijugador).
import { AREA, RES } from './config.js';
import { Rng } from './rng.js';
import { PLACES } from './names.js';

export const POI_TYPES = {
  capital: {
    name: 'Capital',
    desc: 'Capital de una nación. Conquistarla da un gran botín y su dueño crece un 15 % menos hasta recuperarla. Cada capital que controles: +5 % de oro y de crecimiento',
  },
  industria: { name: 'Núcleo industrial', desc: '+15 % de oro pasivo para quien lo controle' },
  puerto: { name: 'Puerto clave', desc: '+1 barco de transporte y +25 % de oro de trenes y mercantes' },
  paso: { name: 'Paso de montaña', desc: 'Conquistar alrededor cuesta un 60 % más a quien ataque a su dueño' },
};

/** Efectos (los usa Game._refreshMods; el del paso se aplica en el coste de cada casilla). */
export const POI = {
  capitalGold: 0.05,
  capitalGrowth: 0.05,
  capitalLostGrowth: -0.15,
  industryGold: 0.15,
  portTrade: 0.25,
  passRadius: 9 * RES,
  passDefense: 1.6,
  capitalBounty: 30000, // oro al conquistar una capital ajena (además del saqueo normal)
};

/**
 * Coloca los puntos neutrales de un mapa: unos 1 por cada 75.000 casillas de
 * tierra con RES 2 (la misma superficie con más resolución: × AREA / 4),
 * entre 8 y 36, separados entre sí, en masas de tierra grandes.
 * Mezcla: ~45 % núcleos industriales, ~30 % puertos clave (en la costa) y
 * ~25 % pasos (en colinas o montañas que lindan con terreno más bajo).
 */
export function placePoints(map, seed) {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const total = Math.max(8, Math.min(36, Math.round(map.landCount / ((75000 * AREA) / 4))));
  const minBody = 150 * AREA;
  const bigLand = (t) => map.landBodySizes[map.landBody[t]] >= minBody;
  const minDist = Math.max(12 * RES, Math.sqrt(map.landCount / total) * 0.55);
  const points = [];
  const far = (t) => {
    const x = map.x(t);
    const y = map.y(t);
    for (const p of points) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  };
  const nb = new Int32Array(4);
  const isPass = (t) => {
    const tr = map.terrain[t];
    if (tr < 2) return false;
    const c = map.neighbors(t, nb);
    for (let k = 0; k < c; k++) if (map.terrain[nb[k]] !== 0 && map.terrain[nb[k]] < tr) return true;
    return false;
  };
  const want = [
    ['puerto', Math.round(total * 0.3), map.coastTiles],
    ['paso', Math.round(total * 0.25), map.landTiles, isPass],
    ['industria', total, map.landTiles],
  ];
  const names = [...PLACES];
  for (const [kind, n, pool, extra] of want) {
    let placed = 0;
    for (let i = 0; i < n * 60 && placed < n && points.length < total && pool.length; i++) {
      const t = pool[rng.int(0, pool.length - 1)];
      if (!map.isLand(t) || !bigLand(t) || (extra && !extra(t)) || !far(t)) continue;
      const name = names.length ? names.splice(rng.int(0, names.length - 1), 1)[0] : `${points.length + 1}`;
      points.push({ id: points.length + 1, kind, tile: t, x: map.x(t), y: map.y(t), name: `${POI_TYPES[kind].name} de ${name}`, nation: 0 });
      placed++;
    }
  }
  return points;
}
