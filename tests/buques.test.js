// Tests de los buques de guerra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras } from './ayuda.js';
import { BUILDINGS, CONFIG, RES } from '../src/config.js';

/** Dos naciones con puerto en la misma costa (busca una semilla que sirva). */
function navalSetup() {
  for (let seed = 1; seed < 60; seed++) {
    const map = generateMap(220 * RES, 130 * RES, seed);
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
      return d > 25 * RES && d < 60 * RES && map.waterBody[water(t)] === sea;
    });
    if (tb === undefined || !game.spawnPlayer(a, ta) || !game.spawnPlayer(b, tb)) continue;
    const tc = game.findSpawnTile();
    if (tc < 0 || !game.spawnPlayer(c, tc)) continue;
    while (game.phase === 'spawn') game.tick();
    game.bots.length = 0;
    a.gold = b.gold = 1e7;
    if (!buildNow(game, a, 'port', ta) || !buildNow(game, b, 'port', tb)) continue;
    return { map, game, a, b, ta, tb, water };
  }
  throw new Error('sin semilla válida');
}

test('construir un buque exige puerto y oro, y su coste sube', () => {
  const map = generateMap(220 * RES, 130 * RES, 21);
  const game = new Game({ map, seed: 21 });
  const p = game.addPlayer('P', [0, 0, 0], true);
  game.start();
  game.spawnPlayer(p, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  p.gold = 1e6;
  assert.equal(game.canBuild(p, 'warship', p.spawnTile).ok, false, 'sin puerto no hay buques');

  const { game: g2, a, ta } = navalSetup();
  const before = a.gold;
  const cost = g2.buildCost(a, 'warship');
  // Documento (04.2): min(1M, 250k × (n + 1))
  assert.equal(cost, BUILDINGS.warship.base, 'el primero cuesta 250k');
  assert.ok(buildNow(g2, a, 'warship', ta));
  assert.equal(a.buildings.warship, 1);
  assert.equal(a.gold, before - cost);
  assert.equal(g2.buildCost(a, 'warship'), 500000, 'el segundo, 500k');
});

test('la zona de un buque se elige al botarlo, no cambia y la patrulla solo', () => {
  const { map, game, a, ta, tb, water } = navalSetup();
  // Clic en tu costa: patrulla junto a su puerto
  buildNow(game, a, 'warship', ta);
  assert.equal(game.warships[0].patrol, game.buildings.find((b) => b.kind === 'port' && b.owner === a.id).water, 'clic en tierra: junto a su puerto');
  // Clic en el mar: esa es su zona
  const dest = water(tb);
  assert.ok(buildNow(game, a, 'warship', dest));
  const ws = game.warships[1];
  assert.equal(ws.patrol, dest);
  // Ya no se puede mover: el clic en el mar no cambia nada
  game.queueIntent({ type: 'moveWarship', playerId: a.id, tile: water(ta) });
  game.tick();
  assert.equal(ws.patrol, dest, 'la zona es fija');
  assert.equal(game.moveWarship, undefined);
  const near = () => Math.hypot(map.x(ws.tile) - map.x(dest), map.y(ws.tile) - map.y(dest)) <= CONFIG.warshipPatrol * 1.3;
  for (let i = 0; i < 1500 && !near(); i++) game.tick();
  assert.ok(near(), 'debería llegar a su zona');
  // Y se queda en ella moviéndose por su cuenta
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    game.tick();
    seen.add(ws.tile);
    assert.equal(map.isLand(ws.tile), false);
  }
  assert.ok(near(), 'sigue en su zona');
  assert.ok(seen.size > 5, 'patrulla (se mueve) sin que nadie se lo mande');
});

test('un buque hunde transportes enemigos pero no ataca puertos', () => {
  const { game, a, b, ta, tb, water } = navalSetup();
  buildNow(game, a, 'warship', water(tb));
  const port = game.buildings.find((x) => x.kind === 'port' && x.owner === b.id);
  for (let i = 0; i < 300; i++) game.tick();
  // B manda un barco hacia la costa de A (sale de su costa, junto a la zona del buque)
  b.troops = 50000;
  const target = [...a.border].find((t) => game.map.coastal[t] && t !== ta);
  const sent = target !== undefined && game.launchBoat(b, target, 5000);
  let sunkBoat = false;
  for (let i = 0; i < 900; i++) {
    game.tick();
    if (sent && a.stats.sunk > 0) sunkBoat = true;
  }
  assert.equal(port.hp, CONFIG.portHp, 'el puerto enemigo no recibe daño');
  assert.ok(game.buildings.includes(port), 'el puerto sigue en pie');
  if (sent) assert.ok(sunkBoat || b.boatCount === 0, 'el transporte no debería seguir navegando');
});

test('dos buques enemigos se cañonean hasta que uno se hunde; los aliados no', () => {
  const { game, a, b, ta, tb, water } = navalSetup();
  // Aliados: nadie dispara
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  buildNow(game, a, 'warship', water(tb));
  buildNow(game, b, 'warship', tb);
  for (let i = 0; i < 400; i++) game.tick();
  assert.equal(game.warships.length, 2);
  assert.ok(game.warships.every((w) => w.hp === CONFIG.warshipHp), 'entre aliados no hay combate');
  // Rompen: combate
  game.breakAlliance(a, b);
  for (let i = 0; i < 400 && game.warships.length === 2; i++) game.tick();
  assert.equal(game.warships.length, 1, 'uno de los dos debería hundirse');
  assert.equal(a.buildings.warship + b.buildings.warship, 1);
});

test('un clic sobre tu puerto (o en el agua de al lado) lo sube de nivel', () => {
  const { game, a, ta, water } = navalSetup();
  const port = game.buildings.find((b) => b.kind === 'port' && b.owner === a.id);
  assert.equal(port.level, 1);
  // Antes, el ajuste a la costa buscaba otra orilla libre y nunca llegaba a mejorarlo
  for (const click of [port.tile, water(port.tile) ?? port.tile]) {
    assert.equal(game.snapBuildTile(a, 'port', click), port.tile);
    assert.ok(game.canBuild(a, 'port', game.snapBuildTile(a, 'port', click)).upgrade === port);
  }
  game.queueIntent({ type: 'build', playerId: a.id, tile: water(port.tile) ?? port.tile, kind: 'port' });
  game.tick();
  terminarObras(game);
  assert.equal(port.level, 2, 'el puerto sube a nivel 2');
  assert.equal(game.buildings.filter((b) => b.kind === 'port' && b.owner === a.id).length, 1, 'sin puerto nuevo');
  void ta;
});
