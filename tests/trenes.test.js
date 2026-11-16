// Tests de los raíles y trenes de las fábricas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, DOC } from './ayuda.js';
import { CONFIG, RES } from '../src/config.js';

/** A con fábrica y ciudad; B (enemigo) con una ciudad al alcance de la fábrica de A. */
function setup(seed = 7) {
  const map = generateMap(240 * RES, 140 * RES, seed);
  const game = new Game({ map, seed, rules: { ...DOC, winShare: 0.9 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 0, 255], false);
  const c = game.addPlayer('C', [0, 255, 0], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const d = (t, u) => Math.hypot(map.x(t) - map.x(u), map.y(t) - map.y(u));
  const ta = inland[Math.floor(inland.length * 0.4)];
  // Recorrido de las vías: en horizontal + en vertical
  const m = (t, u) => Math.abs(map.x(t) - map.x(u)) + Math.abs(map.y(t) - map.y(u));
  const tb = inland.find((t) => m(t, ta) > 9 * RES && m(t, ta) < 12 * RES && d(t, ta) > 8 * RES);
  assert.ok(tb !== undefined && game.spawnPlayer(a, ta) && game.spawnPlayer(b, tb));
  game.spawnPlayer(c, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  // A crece un poco para tener sitio para dos edificios
  for (let i = 0; i < 6; i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 6000);
    // (la expansión va al ritmo del juego: × paceNeutral del perfil; desde
    // doc-1.2 la tierra libre cuesta el doble de tropas)
    for (let k = 0; k < 100; k++) game.tick();
  }
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  a.gold = b.gold = 1e8;
  assert.ok(buildNow(game, a, 'factory', ta), 'fábrica de A');
  const cityTile = [...map.landTiles].find((t) => game.owner[t] === a.id && d(t, ta) > CONFIG.buildingMinDist + 2 && m(t, ta) < CONFIG.railRange - 4 && d(t, tb) > CONFIG.buildingMinDist + 2 && game.canBuild(a, 'city', t).ok);
  assert.ok(cityTile !== undefined && buildNow(game, a, 'city', cityTile), 'ciudad de A');
  assert.ok(buildNow(game, b, 'city', tb), 'ciudad de B');
  return { map, game, a, b, ta, tb, cityTile };
}

test('la fábrica une con raíles las ciudades cercanas, también las enemigas', () => {
  const { game, a, b } = setup();
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  const factory = game.buildings.find((x) => x.kind === 'factory' && x.owner === a.id);
  const rails = game.rails.filter((r) => r.factory === factory);
  assert.ok(rails.some((r) => r.station.owner === a.id), 'raíl a su propia ciudad');
  assert.ok(rails.some((r) => r.station.owner === b.id), 'raíl a la ciudad enemiga dentro del alcance');
  assert.ok(rails.filter((r) => !r.join).every((r) => r.len <= game.railRange(factory.level) + 1e-9));
});

test('los trenes dan oro al llegar según la relación (10k propia o neutral, 35k aliada)', async () => {
  const { MECH } = await import('../src/mecanicas.js');
  const { game, a, b } = setup();
  assert.deepEqual(MECH.trainRewards, { self: 10000, neutral: 10000, ally: 35000, enemy: 0 });
  let neutral = 0;
  for (let i = 0; i < 1500 && !neutral; i++) {
    const before = a.gold;
    const income = a.goldPerTick();
    const t0 = game.ticks;
    game.tick();
    const arrivals = game.effects.filter((e) => e.kind === 'train' && e.tick === t0 + 1 && e.owner === a.id);
    if (arrivals.length === 1 && arrivals[0].other === b.id && game.owner[game.rails.find((r) => r.station.owner === b.id)?.station.tile] === b.id) {
      const gained = a.gold - before - income;
      if (Math.abs(gained - 10000 * a.goldMult * (1 + a.mods.trade)) < 1e-6 || Math.abs(gained - 10000 * (1 + a.mods.trade)) < 1e-6) neutral = gained;
    }
  }
  assert.ok(a.stats.trainGold > 0, 'A cobra sus trenes');
  assert.ok(neutral > 0, 'un tren de A llega a una ciudad neutral de B: 10 000');
  assert.ok(game.trains.length <= game.rails.length, 'como mucho un tren por vía');
});

test('si la estación desaparece, su raíl también', () => {
  const { game, b, tb } = setup();
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  assert.ok(game.rails.some((r) => r.station.owner === b.id));
  // La ciudad de B queda sin dueño (se destruye)
  game.setOwner(tb, 0);
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  assert.ok(!game.rails.some((r) => r.station.tile === tb), 'el raíl a la ciudad destruida ya no está');
  assert.ok(game.trains.every((t) => game.rails.includes(t.rail)));
});

test('las vías van en ángulo recto, dentro del alcance, y unen también fábricas entre sí (una sola vía por pareja)', () => {
  const { game, a, map, ta } = setup();
  const d = (t, u) => Math.hypot(map.x(t) - map.x(u), map.y(t) - map.y(u));
  const m = (t, u) => Math.abs(map.x(t) - map.x(u)) + Math.abs(map.y(t) - map.y(u));
  const other = [...map.landTiles].find((t) => game.owner[t] === a.id && m(t, ta) < CONFIG.railRange - 4 && game.buildings.every((b) => d(t, b.tile) > CONFIG.buildingMinDist + 2) && game.canBuild(a, 'factory', t).ok);
  assert.ok(other !== undefined && buildNow(game, a, 'factory', other), 'segunda fábrica');
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  const between = game.rails.filter((r) => r.factory.kind === 'factory' && r.station.kind === 'factory');
  assert.equal(between.length, 1, 'una vía entre las dos fábricas');
  for (const r of game.rails) {
    if (r.join) continue; // las que se enganchan a otra vía siguen su trazado (test aparte)
    const fx = map.x(r.factory.tile);
    const fy = map.y(r.factory.tile);
    const sx = map.x(r.station.tile);
    const sy = map.y(r.station.tile);
    // La esquina comparte una coordenada con cada extremo
    assert.ok((r.cx === sx && r.cy === fy) || (r.cx === fx && r.cy === sy), 'esquina en ángulo recto');
    assert.equal(r.len, Math.max(1, Math.abs(sx - fx) + Math.abs(sy - fy)));
    assert.ok(r.len <= game.railRange(r.factory.level) * (1 + a.mods.railRange) + 1e-9);
    const [x0, y0] = game.railPoint(r, 0);
    const [x1, y1] = game.railPoint(r, r.len);
    assert.deepEqual([x0, y0], [fx + 0.5, fy + 0.5]);
    assert.deepEqual([x1, y1], [sx + 0.5, sy + 0.5]);
  }
});

test('la fábrica tiende a la vez vías a todas las estaciones a su alcance, también pueblos', () => {
  const { game, a, map, ta } = setup();
  const d = (t, u) => Math.hypot(map.x(t) - map.x(u), map.y(t) - map.y(u));
  const m = (t, u) => Math.abs(map.x(t) - map.x(u)) + Math.abs(map.y(t) - map.y(u));
  // Dos pueblos más al alcance
  for (let k = 0; k < 2; k++) {
    const t = [...map.landTiles].find((x) => game.owner[x] === a.id && m(x, ta) < CONFIG.railRange - 4 && game.buildings.every((b) => d(x, b.tile) > CONFIG.buildingMinDist + 2) && game.canBuild(a, 'village', x).ok);
    if (t !== undefined) buildNow(game, a, 'village', t);
  }
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  const factory = game.buildings.find((x) => x.kind === 'factory' && x.owner === a.id);
  const rails = game.rails.filter((r) => r.factory === factory || r.station === factory);
  assert.ok(rails.length >= 3, `varias vías a la vez (${rails.length})`);
  assert.ok(rails.some((r) => r.station.kind === 'village'), 'los pueblos también son estaciones');
  // Las vías nuevas sacan su primer tren enseguida
  const before = game._nextTrainId;
  for (let i = 0; i < 45; i++) game.tick();
  assert.ok(game._nextTrainId - before + game.trains.length >= Math.min(2, rails.length), 'varios trenes salen a la vez');
});

test('una fábrica puesta encima de una vía se engancha a ella y llega a sus dos extremos', () => {
  const { game, a, map } = setup();
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  // La vía más larga de A
  const r = [...game.rails].filter((x) => x.len > 10).sort((x, y) => y.len - x.len)[0];
  assert.ok(r, 'hay una vía');
  // Una casilla del recorrido, lejos de los extremos (a mitad del tramo más largo)
  let spot = -1;
  for (const k of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const [x, y] = game.railPoint(r, r.len * k);
    const t = map.index(Math.floor(x), Math.floor(y));
    if (map.isLand(t)) {
      game.owner[t] = a.id; // (la casilla es de A para poder construir)
      spot = t;
      break;
    }
  }
  assert.ok(spot >= 0);
  const f2 = { id: -1, tile: spot, level: 1, owner: a.id };
  const links = game.railLinks(f2);
  const joins = links.filter((l) => l.join);
  assert.ok(joins.some((l) => l.station === r.factory) && joins.some((l) => l.station === r.station), 'enganche a los dos extremos de la vía');
  // El enganche sigue el trazado: su recorrido no es más largo que el de la vía original
  for (const l of joins) assert.ok(l.len <= r.len + 2 * CONFIG.railJoinDist + 2, `recorrido ${l.len} frente a ${r.len}`);
});

test('más fábricas, más trenes (y más oro)', () => {
  const { game, a } = setup();
  for (let i = 0; i < CONFIG.railRefresh + 1; i++) game.tick();
  const r = game.rails.find((x) => x.factory.owner === a.id);
  const gaps = (n) => {
    a.active.factory = n;
    let sum = 0;
    for (let k = 0; k < 200; k++) sum += game._trainGap(r);
    return sum / 200;
  };
  const one = gaps(1);
  const four = gaps(4);
  assert.ok(four < one * 0.7, `con cuatro fábricas salen más trenes: ${Math.round(four)} frente a ${Math.round(one)} ticks`);
  assert.ok(gaps(50) >= CONFIG.trainEveryFloor, 'con un mínimo entre trenes');
});
