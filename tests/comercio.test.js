// Tests de la economía naval (documento, 04.3): mercantes y capturas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras } from './ayuda.js';
import { CONFIG, RES } from '../src/config.js';
import { tradeGold, tradeSpawnChance } from '../src/mecanicas.js';

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

test('los puertos solo dan oro con mercantes: sin pesqueros, y la salida es probabilística', () => {
  const { game, a } = setup();
  for (let i = 0; i < 300; i++) game.tick();
  assert.equal(game.merchants.filter((m) => m.kind === 'fish').length, 0, 'no hay pesqueros');
  // El oro de cada turno es el pasivo (100) y nada más por tener puerto
  const g0 = a.gold;
  const m0 = game.merchants.length;
  game.tick();
  assert.equal(a.baseGold(), 100);
  if (game.merchants.length === m0 && !game.merchants.some((m) => m.done)) assert.ok(Math.abs(a.gold - g0 - a.goldPerTick()) < 1e-6);
  // Probabilidad (PROPUESTA del documento): 1 / max(1, floor(100 / boost² / (rechazos + 1) / saturación))
  assert.equal(tradeSpawnChance(1, 0, 0), 1 / 100);
  assert.equal(tradeSpawnChance(2, 0, 0), 1 / 25);
  assert.equal(tradeSpawnChance(1, 9, 0), 1 / 10);
  assert.ok(tradeSpawnChance(1, 0, 140) < tradeSpawnChance(1, 0, 0), 'con muchos mercantes navegando salen menos');
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
      // Los dos cobran floor((75 000 / (1 + e^(−0,03 (d − 300))) + 50 d) × mult), d = casillas de agua recorridas
      const v = tradeGold(trade.value);
      assert.ok(v > 0);
      assert.ok(a.gold - before[0] >= v - 1e-6, 'el dueño cobra el viaje');
      assert.ok(b.gold - before[1] >= v - 1e-6, 'el puerto de destino cobra lo mismo');
      paid = true;
    }
  }
  assert.ok(paid, 'algún mercante de A debería haber llegado a B');
});

test('un buque de guerra captura los mercantes enemigos', () => {
  const { game, a, b, tb, water } = setup();
  buildNow(game, a, 'warship', water(tb)); // su zona: el mar junto al puerto de B
  // Un mercante de B que sale de su puerto hacia el de A (creado a mano: la salida es al azar)
  const port = game.buildings.find((x) => x.kind === 'port' && x.owner === b.id);
  const dest = game.buildings.find((x) => x.kind === 'port' && x.owner === a.id);
  const path = game._waterPath(port.water, dest.water, 1e9);
  game._spawnMerchant(port, 'trade', dest, path.length - 1, path);
  for (let i = 0; i < 1500 && !(a.stats.captured >= 1); i++) game.tick();
  assert.ok(a.stats.captured >= 1, 'A debería haber capturado el mercante');
});

test('los barcos de tropas salen de cualquier costa, sin necesidad de puerto', () => {
  const { map, game, a, tb } = setup();
  game.buildings = game.buildings.filter((x) => x.owner !== a.id);
  a.buildings.port = 0;
  a.troops = 20000;
  const target = [...game.players[2].border].find((t) => map.coastal[t]) ?? tb;
  assert.ok(game.launchBoat(a, target, 5000), 'sin puerto también se puede desembarcar');
});
