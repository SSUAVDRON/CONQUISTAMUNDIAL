// Tests de la economía naval: pesqueros, mercantes y capturas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras } from './ayuda.js';
import { CONFIG, RES } from '../src/config.js';

/** Dos naciones con puerto en el mismo mar y un tercero neutral. */
function setup() {
  for (let seed = 1; seed < 60; seed++) {
    const map = generateMap(220 * RES, 130 * RES, seed);
    const game = new Game({ map, seed });
    const a = game.addPlayer('A', [255, 0, 0], true);
    const b = game.addPlayer('B', [0, 0, 255], false);
    const c = game.addPlayer('C', [0, 255, 0], false);
    game.start();
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
    a.gold = b.gold = 1e6;
    if (!buildNow(game, a, 'port', ta) || !buildNow(game, b, 'port', tb)) continue;
    return { map, game, a, b, ta, tb, water };
  }
  throw new Error('sin semilla válida');
}

test('cada puerto saca pesqueros que faenan cerca y dan oro', () => {
  const { map, game, a } = setup();
  const port = game.buildings.find((x) => x.kind === 'port' && x.owner === a.id);
  for (let i = 0; i < 300; i++) game.tick();
  const fleet = game.merchants.filter((m) => m.kind === 'fish' && m.owner === a.id);
  assert.equal(fleet.length, CONFIG.fishPerPort);
  for (const m of fleet) {
    assert.equal(map.isLand(m.tile), false, 'los barcos van por el agua');
    const d = Math.hypot(map.x(m.tile) - map.x(port.water), map.y(m.tile) - map.y(port.water));
    assert.ok(d <= CONFIG.fishRange * 1.5, `faena cerca del puerto (${d.toFixed(1)})`);
  }
  // El oro sube lo del territorio más lo que pescan
  const territory = a.goldPerTick();
  const g0 = a.gold;
  game.tick();
  assert.ok(a.gold - g0 >= territory + CONFIG.fishPerPort * CONFIG.fishGold - 1e-6);
});

test('los mercantes viajan a otro puerto y pagan a los dos dueños', () => {
  const { game, a, b } = setup();
  let paid = false;
  for (let i = 0; i < 4000 && !paid; i++) {
    const before = [a.gold, b.gold];
    const trades = game.merchants.filter((m) => m.kind === 'trade' && m.owner === a.id && m.path);
    game.tick();
    const trade = trades.find((m) => m.done);
    if (trade) {
      assert.ok(a.gold - before[0] >= trade.value, 'el dueño cobra el viaje');
      assert.ok(b.gold - before[1] >= trade.value * CONFIG.tradeReceiverShare, 'el puerto de destino cobra su parte');
      paid = true;
    }
  }
  assert.ok(paid, 'algún mercante de A debería haber llegado a B');
});

test('un buque de guerra captura los barcos automáticos enemigos', () => {
  const { game, a, b, ta, tb, water } = setup();
  for (let i = 0; i < 200; i++) game.tick(); // B ya tiene pesqueros
  assert.ok(game.merchants.some((m) => m.owner === b.id && m.kind === 'fish'));
  buildNow(game, a, 'warship', water(tb)); // su zona: el mar junto al puerto de B
  for (let i = 0; i < 1500 && !game.merchants.some((m) => m.kind === 'fish' && m.owner === a.id && m.port !== game.buildings.find((x) => x.owner === a.id && x.kind === 'port')?.id); i++) game.tick();
  assert.ok(a.stats.captured >= 1, 'A debería haber capturado algún barco');
  assert.ok(game.merchants.filter((m) => m.owner === a.id).length > 0);
  void tb;
});

test('los barcos de tropas salen de cualquier costa, sin necesidad de puerto', () => {
  const { map, game, a, tb } = setup();
  game.buildings = game.buildings.filter((x) => x.owner !== a.id);
  a.buildings.port = 0;
  a.troops = 20000;
  const target = [...game.players[2].border].find((t) => map.coastal[t]) ?? tb;
  assert.ok(game.launchBoat(a, target, 5000), 'sin puerto también se puede desembarcar');
});
