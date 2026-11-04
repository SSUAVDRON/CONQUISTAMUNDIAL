// Tests de los buques de guerra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { BUILDINGS, CONFIG } from '../src/config.js';

/** Dos naciones con puerto en la misma costa (busca una semilla que sirva). */
function navalSetup() {
  for (let seed = 1; seed < 60; seed++) {
    const map = generateMap(220, 130, seed);
    const game = new Game({ map, seed });
    const a = game.addPlayer('A', [255, 0, 0], true);
    const b = game.addPlayer('B', [0, 0, 255], false);
    // Un tercero neutral: con solo dos naciones aliadas la partida terminaría en victoria compartida
    const c = game.addPlayer('C', [0, 255, 0], false);
    game.start();
    // Dos costas del mismo mar, separadas
    const coast = [...map.coastTiles].filter((t) => map.landBodySizes[map.landBody[t]] >= CONFIG.minSpawnBodySize);
    const ta = coast[Math.floor(coast.length * 0.2)];
    const water = (t) => [t - 1, t + 1, t - map.width, t + map.width].find((n) => !map.isLand(n));
    const sea = map.waterBody[water(ta)];
    const tb = coast.find((t) => {
      const d = Math.hypot(map.x(t) - map.x(ta), map.y(t) - map.y(ta));
      return d > 25 && d < 60 && map.waterBody[water(t)] === sea;
    });
    if (tb === undefined || !game.spawnPlayer(a, ta) || !game.spawnPlayer(b, tb)) continue;
    const tc = game.findSpawnTile();
    if (tc < 0 || !game.spawnPlayer(c, tc)) continue;
    while (game.phase === 'spawn') game.tick();
    game.bots.length = 0;
    a.gold = b.gold = 1e6;
    if (!game.build(a, 'port', ta) || !game.build(b, 'port', tb)) continue;
    return { map, game, a, b, ta, tb, water };
  }
  throw new Error('sin semilla válida');
}

test('construir un buque exige puerto y oro, y su coste sube', () => {
  const map = generateMap(220, 130, 21);
  const game = new Game({ map, seed: 21 });
  const p = game.addPlayer('P', [0, 0, 0], true);
  game.start();
  game.spawnPlayer(p, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  p.gold = 1e6;
  assert.equal(game.canBuild(p, 'warship', p.spawnTile).ok, false, 'sin puerto no hay buques');

  const { game: g2, a, ta } = navalSetup();
  const before = a.gold;
  assert.ok(g2.build(a, 'warship', ta));
  assert.equal(a.buildings.warship, 1);
  assert.equal(a.gold, before - BUILDINGS.warship.base);
  assert.equal(g2.buildCost(a, 'warship'), BUILDINGS.warship.base + BUILDINGS.warship.step);
});

test('un buque navega hasta donde se le manda', () => {
  const { map, game, a, ta, tb, water } = navalSetup();
  game.build(a, 'warship', ta);
  const dest = water(tb);
  assert.ok(game.moveWarship(a, dest));
  for (let i = 0; i < 400 && game.warships[0].path; i++) game.tick();
  const ws = game.warships[0];
  assert.equal(ws.path, null, 'debería haber llegado');
  assert.equal(ws.tile, dest);
  assert.equal(map.isLand(ws.tile), false);
});

test('un buque hunde transportes enemigos y destruye puertos', () => {
  const { game, a, b, ta, tb, water } = navalSetup();
  game.build(a, 'warship', ta);
  game.moveWarship(a, water(tb));
  // B manda un barco hacia la costa de A (no a su puerto, que podría capturar)
  b.troops = 50000;
  const target = [...a.border].find((t) => game.map.coastal[t] && t !== ta);
  const sent = target !== undefined && game.launchBoat(b, target, 5000);
  const port = game.buildings.find((x) => x.kind === 'port' && x.owner === b.id);
  let sunkBoat = false;
  for (let i = 0; i < 1500 && port.hp > 0; i++) {
    game.tick();
    if (sent && a.stats.sunk > 0) sunkBoat = true;
  }
  assert.ok(port.hp <= 0, 'el puerto enemigo debería caer');
  assert.equal(game.buildings.includes(port), false, 'el puerto desaparece');
  assert.equal(b.buildings.port, game.buildings.filter((x) => x.kind === 'port' && x.owner === b.id).length);
  if (sent) assert.ok(sunkBoat || b.boatCount === 0, 'el transporte no debería seguir navegando');
});

test('dos buques enemigos se cañonean hasta que uno se hunde; los aliados no', () => {
  const { game, a, b, ta, tb, water } = navalSetup();
  game.build(a, 'warship', ta);
  game.build(b, 'warship', tb);
  // Aliados: nadie dispara
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  game.moveWarship(a, water(tb));
  for (let i = 0; i < 400; i++) game.tick();
  assert.equal(game.warships.length, 2);
  assert.ok(game.warships.every((w) => w.hp === CONFIG.warshipHp), 'entre aliados no hay combate');
  // Rompen: combate
  game.breakAlliance(a, b);
  for (let i = 0; i < 400 && game.warships.length === 2; i++) game.tick();
  assert.equal(game.warships.length, 1, 'uno de los dos debería hundirse');
  assert.equal(a.buildings.warship + b.buildings.warship, 1);
});
