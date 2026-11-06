// Tests de los mapas reales (Natural Earth) y de los bots-país.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { AREA, REAL_MAPS, RES } from '../src/config.js';

test('todos los mapas reales se cargan con tierra, agua y países', () => {
  for (const id of Object.keys(REAL_MAPS)) {
    const { map, countries } = loadRealMap(id);
    const share = map.landCount / map.size;
    assert.ok(share > 0.2 && share < 0.7, `${id}: proporción de tierra ${share}`);
    assert.ok(countries.length >= 15, `${id}: países ${countries.length}`);
    for (const c of countries) {
      assert.ok(map.isLand(c.tile), `${id}: ${c.name} empieza en el agua`);
      assert.ok(c.name.length > 1 && c.name.length <= 24);
    }
  }
});

test('el mapa de Europa tiene a sus países donde toca', () => {
  const { map, countries } = loadRealMap('europa');
  const at = (name) => {
    const c = countries.find((x) => x.name === name);
    assert.ok(c, `falta ${name}`);
    return { x: map.x(c.tile) / map.width, y: map.y(c.tile) / map.height };
  };
  const es = at('España');
  const fr = at('Francia');
  const fi = at('Finlandia');
  assert.ok(es.x < fr.x && es.y > fr.y, 'España queda al suroeste de Francia');
  assert.ok(fi.y < fr.y && fi.x > fr.x, 'Finlandia queda al noreste de Francia');
});

test('los bots de un mapa real son países y aparecen en su ubicación', () => {
  const { map, countries } = loadRealMap('sudamerica');
  const game = new Game({ map, seed: 3 });
  game.addBots(10, 'normal', countries);
  game.start();
  assert.equal(game.bots.length, 10);
  for (const bot of game.bots) {
    const p = bot.player;
    const c = countries.find((x) => x.name === p.name);
    assert.ok(c, `${p.name} debería ser un país`);
    assert.ok(p.spawned, `${p.name} debería haber aparecido`);
    const d = Math.hypot(map.x(p.spawnTile) - map.x(c.tile), map.y(p.spawnTile) - map.y(c.tile));
    assert.ok(d <= 15 * RES, `${p.name} aparece a ${d.toFixed(1)} casillas de su país`);
  }
  // Y la partida avanza con normalidad (la expansión inicial es gradual: en
  // 50 s de juego algún bot ya pasa de 200 casillas de la rejilla original)
  for (let i = 0; i < 600; i++) game.tick();
  assert.ok(game.bots.some((b) => b.player.tiles > 200 * AREA));
});

test('pedir más bots que países añade naciones inventadas además de los países', () => {
  const { map, countries } = loadRealMap('norteamerica');
  const game = new Game({ map, seed: 1 });
  game.addBots(60, 'normal', countries);
  assert.equal(game.bots.length, 60);
  const players = game.bots.map((b) => b.player);
  // Primero todos los países reales (con bandera), luego las inventadas (sin bandera)
  players.slice(0, countries.length).forEach((p, i) => assert.equal(p.name, countries[i].name));
  assert.ok(players.slice(countries.length).every((p) => !p.flag && !countries.some((c) => c.name === p.name)));
  assert.equal(new Set(players.map((p) => p.name)).size, 60, 'sin nombres repetidos');
  game.start();
  assert.ok(players.every((p) => p.spawned), 'todas aparecen en el mapa');
});

test('ríos: solo sobre tierra, sin huecos en diagonal y iguales con la misma semilla', async () => {
  const { generateMap, loadRealMap, markRivers } = await import('../src/map.js');
  const { CONFIG } = await import('../src/config.js');
  const { Game } = await import('../src/game.js');
  // Una línea diagonal queda unida casilla a casilla (no se puede pasar entre dos)
  const w = 12;
  const h = 12;
  const terrain = new Uint8Array(w * h).fill(1);
  const r = markRivers(w, h, terrain, [[1, 1, 1, 9, 7]]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!r[y * w + x] || (x === 9 && y === 7)) continue;
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => r[(y + dy) * w + x + dx]).length;
      assert.ok(next >= 1, `casilla de río aislada en ${x},${y}`);
    }
  }
  // Mapas aleatorios: deterministas y nunca sobre el agua
  const a = generateMap(400, 240, 99);
  const b = generateMap(400, 240, 99);
  assert.deepEqual(a.river, b.river);
  let n = 0;
  for (let i = 0; i < a.size; i++) {
    if (!a.river[i]) continue;
    n++;
    assert.notEqual(a.terrain[i], 0);
  }
  assert.ok(n > 0, 'el mapa aleatorio debería tener algún río');
  // Mapas reales: hay ríos; son solo visuales (el documento de mecánicas no los tiene)
  const { map } = loadRealMap('europa');
  const t = map.river.findIndex((v, i) => v && map.terrain[i] === 1);
  assert.ok(t >= 0);
  const g = new Game({ map, seed: 1 });
  const plain = map.landTiles.find((i) => !map.river[i] && map.terrain[i] === 1);
  assert.deepEqual(g.conquestCost(t, null, 5000, 10), g.conquestCost(plain, null, 5000, 10));
  void CONFIG;
});
