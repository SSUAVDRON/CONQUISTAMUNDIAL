// Rutas por mar en el mapa del mundo: los estrechos estrechos (Ormuz, Bósforo
// y Dardanelos) dejan pasar a los barcos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { DEFAULT_RULES } from '../src/config.js';
import { REAL_MAP_DATA } from '../src/mapas-reales.js';

const { map } = loadRealMap('mundo');
const W = map.width;
const H = map.height;
const D = REAL_MAP_DATA.mundo;
const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((lat * Math.PI) / 180)));
const top = millerY(D.lat[1]);
const span = top - millerY(D.lat[0]);
/** Casilla del mapa para una longitud y latitud. */
const at = (lon, lat) => Math.floor(((top - millerY(lat)) / span) * H) * W + Math.floor(((lon - D.lon[0]) / (D.lon[1] - D.lon[0])) * W);
/** La casilla de costa más cercana. */
function coastNear(lon, lat) {
  const t0 = at(lon, lat);
  const x0 = t0 % W;
  const y0 = (t0 / W) | 0;
  for (let r = 0; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = (y0 + dy) * W + x0 + dx;
        if (map.terrain[t] && map.coastal[t]) return t;
      }
    }
  }
  return -1;
}

/** ¿Hay ruta de desembarco desde la costa de (lon, lat) hasta la de (lon2, lat2)? */
function route(from, to) {
  const game = new Game({ map, seed: 1, rules: { ...DEFAULT_RULES, profile: 'clasico' } });
  const a = game.addPlayer('A', [200, 0, 0], true);
  const b = game.addPlayer('B', [0, 0, 200], false);
  game.start();
  const s = coastNear(...from);
  const d = coastNear(...to);
  assert.ok(s >= 0 && d >= 0, 'costas encontradas');
  for (const dt of [0, 1, -1, W, -W]) if (map.terrain[s + dt]) game.setOwner(s + dt, a.id);
  game.setOwner(d, b.id);
  return game._findSeaPath(a.id, d);
}

test('Ormuz: desde el golfo Pérsico se llega al golfo de Omán y al mar Arábigo', () => {
  const kuwait = [47.9, 29.3];
  assert.ok(route(kuwait, [58.4, 23.6]), 'Kuwait → Mascate');
  assert.ok(route(kuwait, [67, 24.9]), 'Kuwait → Karachi');
});

test('el Bósforo y los Dardanelos están abiertos: el Mar Negro no es un lago', () => {
  const blackSea = at(34, 43.5);
  const aegean = at(25, 38.5);
  assert.equal(map.terrain[blackSea], 0);
  assert.equal(map.waterBody[blackSea], map.waterBody[aegean], 'Mar Negro y Egeo, el mismo mar');
  assert.ok(route([28.6, 44.2], [23.7, 37.9]), 'Constanza → Atenas');
  // El Caspio sigue siendo un lago (no tiene salida)
  assert.notEqual(map.waterBody[at(51, 42)], map.waterBody[blackSea]);
});
