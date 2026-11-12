// Tests de la economía naval (documento, 04.3): mercantes y capturas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras, DOC } from './ayuda.js';
import { CONFIG, RES } from '../src/config.js';
import { MECH, tradeGold, tradeSpawnChance } from '../src/mecanicas.js';

/** Dos naciones con puerto en el mismo mar y un tercero neutral. */
function setup() {
  for (let seed = 1; seed < 60; seed++) {
    const map = generateMap(220 * RES, 130 * RES, seed);
    const game = new Game({ map, seed, rules: DOC });
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

test('puertos (doc-1.6): pesqueros que faenan cerca y vuelven con oro; los mercantes salen con probabilidad', () => {
  const { game, a } = setup();
  // Pesqueros: tantos como el nivel del puerto (nivel 1: uno), del mismo mar
  let fish = null;
  for (let i = 0; i < 600 && !fish; i++) {
    game.tick();
    fish = game.merchants.find((m) => m.kind === 'fish' && m.owner === a.id);
  }
  assert.ok(fish, 'el puerto lanza un pesquero');
  assert.equal(game.merchants.filter((m) => m.kind === 'fish' && m.owner === a.id).length, 1, 'uno por nivel');
  // Va a su caladero, pesca un rato y vuelve: al llegar cobra su dueño
  const g0 = a.income.fishing;
  for (let i = 0; i < 3000 && !fish.done; i++) game.tick();
  assert.ok(fish.done, 'vuelve a puerto');
  const expected = Math.round((MECH.fishing.base + MECH.fishing.perTile * (fish.value / (RES / 2))) * a.goldMult * (1 + a.mods.trade));
  assert.equal(a.income.fishing - g0, expected, 'cobra su pesca');
  // Probabilidad de los mercantes (doc-1.6: base 30): 1 / max(1, floor(30 / boost² / (rechazos + 1) / saturación))
  assert.equal(tradeSpawnChance(1, 0, 0), 1 / 30);
  assert.equal(tradeSpawnChance(2, 0, 0), 1 / 7);
  assert.equal(tradeSpawnChance(1, 9, 0), 1 / 3);
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
      // d en casillas del documento (mundo de 2000×1000, RES 2)
      const v = tradeGold(trade.value / (RES / 2));
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

test('los barcos de tropas necesitan un puerto (doc-1.3), pero salen de cualquier costa', () => {
  const { map, game, a, tb } = setup();
  const own = game.buildings.filter((x) => x.owner === a.id);
  game.buildings = game.buildings.filter((x) => x.owner !== a.id);
  game._recount(a);
  a.troops = 20000;
  const target = [...game.players[2].border].find((t) => map.coastal[t]) ?? tb;
  assert.equal(game.launchBoat(a, target, 5000), false, 'sin puerto no hay barcos');
  assert.equal(game.boats.length, 0);
  // Con su puerto otra vez: el barco sale (de la costa más cercana al objetivo, no del puerto)
  game.buildings.push(...own);
  game._recount(a);
  assert.ok(a.active.port >= 1);
  assert.ok(game.launchBoat(a, target, 5000), 'con puerto, sí');
});
