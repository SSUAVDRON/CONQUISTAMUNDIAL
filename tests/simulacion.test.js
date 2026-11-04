// Tests de la simulación (sin navegador): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';

function checksum(arr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619) >>> 0;
  return h;
}

function runBots(seed, bots, ticks) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed });
  game.addBots(bots);
  game.start();
  for (let i = 0; i < ticks && game.phase !== 'ended'; i++) game.tick();
  return game;
}

/** Comprueba que los datos derivados coinciden con el mapa de propietarios. */
function assertInvariants(game) {
  const { map, owner, players } = game;
  const counts = new Array(players.length).fill(0);
  for (let i = 0; i < map.size; i++) {
    const o = owner[i];
    if (!o) continue;
    assert.ok(map.isLand(i), `la casilla de agua ${i} tiene dueño`);
    counts[o]++;
  }
  for (const p of players) {
    if (!p) continue;
    assert.equal(p.tiles, counts[p.id], `recuento de casillas de ${p.name}`);
    assert.ok(Number.isFinite(p.troops) && p.troops >= 0, `tropas válidas de ${p.name}: ${p.troops}`);
    for (const t of p.border) assert.equal(owner[t], p.id, `frontera de ${p.name} con casilla ajena`);
    if (!p.alive) assert.equal(p.tiles, 0);
  }
  for (const b of game.boats) assert.ok(!map.isLand(b.path[b.pos]), 'barco en tierra');
}

test('el mapa es determinista y tiene tierra y agua', () => {
  const a = generateMap(200 * RES, 120 * RES, 7);
  const b = generateMap(200 * RES, 120 * RES, 7);
  const c = generateMap(200 * RES, 120 * RES, 8);
  assert.equal(checksum(a.terrain), checksum(b.terrain));
  assert.notEqual(checksum(a.terrain), checksum(c.terrain));
  const share = a.landCount / a.size;
  assert.ok(share > 0.3 && share < 0.55, `proporción de tierra ${share}`);
  // El borde del mapa siempre es agua
  for (let x = 0; x < a.width; x++) assert.ok(!a.isLand(x) && !a.isLand(a.index(x, a.height - 1)));
});

test('los bots se despliegan y la simulación mantiene los invariantes', () => {
  const game = runBots(42, 14, 0);
  const spawned = game.players.filter((p) => p && p.spawned).length;
  assert.equal(spawned, 14);
  for (let i = 0; i < 2500 && game.phase !== 'ended'; i++) {
    game.tick();
    if (i % 250 === 0) assertInvariants(game);
  }
  assertInvariants(game);
  const best = Math.max(...game.players.filter(Boolean).map((p) => p.maxTilesReached));
  assert.ok(best > 500, 'alguien debería haberse expandido');
});

test('misma semilla, misma partida', () => {
  const a = runBots(99, 10, 1500);
  const b = runBots(99, 10, 1500);
  assert.equal(checksum(a.owner), checksum(b.owner));
  assert.deepEqual(
    a.players.filter(Boolean).map((p) => Math.round(p.troops)),
    b.players.filter(Boolean).map((p) => Math.round(p.troops)),
  );
});

test('el jugador humano elige posición, se expande y puede recolocarse durante el despliegue', () => {
  const map = generateMap(220 * RES, 130 * RES, 5);
  const game = new Game({ map, seed: 5 });
  const human = game.addPlayer('Yo', [0, 0, 255], true);
  game.start();

  const first = game.findSpawnTile();
  const second = game.findSpawnTile();
  game.queueIntent({ type: 'action', playerId: human.id, tile: first, ratio: 0.2 });
  game.tick();
  assert.equal(game.owner[first], human.id);
  const tilesAfterFirst = human.tiles;

  // Recolocar libera las casillas anteriores
  if (game.owner[second] === 0) {
    game.queueIntent({ type: 'action', playerId: human.id, tile: second, ratio: 0.2 });
    game.tick();
    assert.equal(game.owner[second], human.id);
    assert.equal(game.owner[first], 0);
  }

  while (game.phase === 'spawn') game.tick();
  assert.ok(tilesAfterFirst > 20);

  // Atacar tierra libre adyacente
  let wild = -1;
  for (const t of human.border) {
    for (const n of [t - 1, t + 1, t - map.width, t + map.width]) {
      if (map.isLand(n) && game.owner[n] === 0) wild = n;
    }
  }
  assert.ok(wild >= 0, 'debería haber tierra libre al lado');
  const before = human.tiles;
  game.queueIntent({ type: 'action', playerId: human.id, tile: wild, ratio: 0.5 });
  for (let i = 0; i < 100; i++) game.tick();
  assert.ok(human.tiles > before + 50, `se esperaba expansión: ${before} → ${human.tiles}`);
  assertInvariants(game);
});

test('un ataque contra un vecino conquista casillas y el defensor pierde tropas', () => {
  const map = generateMap(220 * RES, 130 * RES, 11);
  const game = new Game({ map, seed: 11 });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  game.start();
  // Dos naciones pegadas en la mayor masa de tierra
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  assert.ok(game.spawnPlayer(a, ta));
  let tb = -1;
  for (const t of tiles) {
    const dx = map.x(t) - map.x(ta);
    const dy = map.y(t) - map.y(ta);
    if (game.owner[t] === 0 && dx * dx + dy * dy > 81 && dx * dx + dy * dy < 120) {
      tb = t;
      break;
    }
  }
  assert.ok(tb >= 0 && game.spawnPlayer(b, tb));
  while (game.phase === 'spawn') game.tick();
  // B deja de pensar como bot para que el test sea controlado
  game.bots.length = 0;

  // A se expande hasta tocar a B
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    game.launchAttack(a, 0, Math.floor(a.troops * 0.5));
    for (let k = 0; k < 20; k++) game.tick();
  }
  assert.ok(game.hasLandBorder(a, b.id), 'A y B deberían compartir frontera');

  a.troops = 200000;
  const bTilesBefore = b.tiles;
  const bTroopsBefore = b.troops;
  assert.ok(game.launchAttack(a, b.id, 150000));
  for (let i = 0; i < 60; i++) game.tick();
  assert.ok(b.tiles < bTilesBefore, 'B debería perder casillas');
  assert.ok(b.troops < bTroopsBefore + 60 * 200, 'B debería perder tropas');
  assertInvariants(game);
});

test('los barcos cruzan el agua y desembarcan', () => {
  // Buscamos una semilla con al menos dos masas de tierra grandes
  for (let seed = 1; seed < 40; seed++) {
    const map = generateMap(220 * RES, 130 * RES, seed);
    const big = map.landBodySizes.map((s, i) => [s, i]).filter(([s]) => s >= CONFIG.minSpawnBodySize);
    if (big.length < 2) continue;
    const game = new Game({ map, seed });
    const p = game.addPlayer('Marino', [0, 0, 255], true);
    game.start();
    const home = [...map.coastTiles].find((t) => map.landBody[t] === big[0][1]);
    const away = [...map.coastTiles].find((t) => map.landBody[t] === big[1][1] && map.waterBody.length);
    assert.ok(game.spawnPlayer(p, home));
    while (game.phase === 'spawn') game.tick();
    const sent = game.launchBoat(p, away, 1000);
    if (!sent) continue; // otra semilla si no hay ruta
    assert.equal(game.boats.length, 1);
    for (let i = 0; i < 2000 && game.boats.length; i++) game.tick();
    assert.equal(game.boats.length, 0, 'el barco debería haber llegado');
    assert.ok([...map.landTiles].some((t) => map.landBody[t] === big[1][1] && game.owner[t] === p.id), 'debería haber desembarcado');
    assertInvariants(game);
    return;
  }
  assert.fail('no se encontró una semilla con dos islas conectadas por mar');
});
