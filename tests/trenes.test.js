// Tests de los raíles y trenes de las fábricas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow } from './ayuda.js';
import { CONFIG, RES } from '../src/config.js';

/** A con fábrica y ciudad; B (enemigo) con una ciudad al alcance de la fábrica de A. */
function setup(seed = 7) {
  const map = generateMap(240 * RES, 140 * RES, seed);
  const game = new Game({ map, seed, rules: { winShare: 0.9 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 0, 255], false);
  const c = game.addPlayer('C', [0, 255, 0], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const d = (t, u) => Math.hypot(map.x(t) - map.x(u), map.y(t) - map.y(u));
  const ta = inland[Math.floor(inland.length * 0.4)];
  const tb = inland.find((t) => d(t, ta) > 25 * RES && d(t, ta) < 30 * RES);
  assert.ok(tb !== undefined && game.spawnPlayer(a, ta) && game.spawnPlayer(b, tb));
  game.spawnPlayer(c, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  // A crece un poco para tener sitio para dos edificios
  for (let i = 0; i < 6; i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 3000);
    for (let k = 0; k < 10; k++) game.tick();
  }
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  a.gold = b.gold = 1e8;
  assert.ok(buildNow(game, a, 'factory', ta), 'fábrica de A');
  const cityTile = [...map.landTiles].find((t) => game.owner[t] === a.id && d(t, ta) > CONFIG.buildingMinDist + 2 && d(t, tb) > CONFIG.buildingMinDist + 2 && game.canBuild(a, 'city', t).ok);
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
  assert.ok(rails.every((r) => r.len <= game.railRange(factory.level) + 1e-9));
});

test('los trenes dan oro al llegar: al dueño de la fábrica y una parte al de la estación', () => {
  const { game, a, b } = setup();
  let bShare = 0;
  for (let i = 0; i < 1200 && !bShare; i++) {
    const before = b.gold;
    const income = b.goldPerTick();
    const t0 = game.ticks;
    game.tick();
    const arrivals = game.effects.filter((e) => e.kind === 'train' && e.tick === t0 + 1 && e.other === b.id);
    if (arrivals.length) bShare = b.gold - before - income;
  }
  assert.ok(a.stats.trainGold > 0, 'A cobra sus trenes');
  assert.ok(bShare > 0, 'B cobra una parte cuando el tren de A pasa por su ciudad');
  assert.ok(game.trains.length <= game.rails.length, 'como mucho un tren por raíl');
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
