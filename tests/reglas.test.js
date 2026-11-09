// Tests de las reglas personalizables de la partida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES, cleanRules } from '../src/config.js';

/** Dos naciones vecinas ya en juego con las reglas dadas. */
function duel(rules = {}, seed = 11) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed, rules });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  game.addPlayer('C', [0, 0, 255], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  const tb = tiles.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return d2 > 18 ** 2 && d2 < 22 ** 2; // en casillas: el avance va por casillas (documento), no se escala con RES
  });
  assert.ok(game.spawnPlayer(a, ta) && game.spawnPlayer(b, tb));
  game.spawnPlayer(game.players[3], game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { map, game, a, b, ta, tb };
}

test('las reglas nuevas se validan', () => {
  const r = cleanRules({ troopMult: 2, goldMult: 0.5, priceMult: 2, truceMin: 3, timeLimitMin: 20, alliances: false, boats: false, factories: false });
  assert.deepEqual([r.troopMult, r.goldMult, r.priceMult, r.truceMin, r.timeLimitMin, r.alliances, r.boats, r.factories], [2, 0.5, 2, 3, 20, false, false, false]);
  const bad = cleanRules({ troopMult: 7, truceMin: 4, timeLimitMin: 15 });
  assert.deepEqual([bad.troopMult, bad.truceMin, bad.timeLimitMin], [1, 0, 0]);
  assert.equal(cleanRules({}).alliances, true);
});

test('multiplicadores de tropas, oro y precios', () => {
  const base = duel();
  const mod = duel({ troopMult: 2, goldMult: 0.5, priceMult: 2 });
  for (const g of [base, mod]) g.a.troops = 1000;
  assert.ok(Math.abs(mod.a.growthPerTick() - 2 * base.a.growthPerTick()) < 1e-9);
  assert.ok(Math.abs(mod.a.goldPerTick() - 0.5 * base.a.goldPerTick()) < 1e-9);
  assert.equal(mod.game.buildCost(mod.a, 'city'), 2 * base.game.buildCost(base.a, 'city'));
  assert.equal(mod.game.buildCost(mod.a, 'sam'), 2 * base.game.buildCost(base.a, 'sam'));
});

test('tregua inicial: no se puede atacar a otra nación, sí expandirse', () => {
  const { game, a, b } = duel({ truceMin: 1 });
  // A se expande hasta tocar a B (la tierra libre sí se puede)
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    a.troops = Math.max(a.troops, 20000);
    assert.ok(game.launchAttack(a, 0, 10000), 'expandirse está permitido en la tregua');
    for (let k = 0; k < 20; k++) game.tick();
  }
  assert.ok(game.hasLandBorder(a, b.id));
  assert.ok(game.inTruce());
  assert.equal(game.launchAttack(a, b.id, 5000), false, 'durante la tregua no se ataca a una nación');
  while (game.inTruce()) game.tick();
  a.troops = 20000;
  assert.ok(game.launchAttack(a, b.id, 5000), 'acabada la tregua, sí');
});

test('límite de tiempo: gana quien tenga más territorio', () => {
  const { game, a } = duel({ timeLimitMin: 10 });
  a.troops = 1e5;
  game.launchAttack(a, 0, 50000);
  for (let i = 0; i < 10 * 600 + 5 && game.phase !== 'ended'; i++) game.tick();
  assert.equal(game.phase, 'ended');
  const best = game.alivePlayers().sort((x, y) => y.tiles - x.tiles)[0];
  assert.equal(game.winner, best);
  assert.ok(game.ticks <= CONFIG.spawnTicks + 10 * 600 + 1);
});

test('alianzas, desembarcos y fábricas desactivables', () => {
  const { game, a, b, map } = duel({ alliances: false, boats: false, factories: false });
  assert.equal(game.proposeAlliance(a, b), false);
  assert.equal(game.canPropose(a, b).ok, false);
  a.troops = 20000;
  const coast = [...map.coastTiles].find((t) => game.owner[t] === 0);
  assert.equal(game.launchBoat(a, coast, 5000), false);
  a.gold = 1e8;
  assert.equal(game.canBuild(a, 'factory', a.spawnTile).ok, false);
});
