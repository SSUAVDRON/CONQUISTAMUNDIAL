// Tests de la fase 2: oro y edificios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { BUILDINGS, CONFIG } from '../src/config.js';

/** Partida con un humano ya desplegado en la mayor masa de tierra. */
function setup(seed = 21) {
  const map = generateMap(220, 130, seed);
  const game = new Game({ map, seed });
  const human = game.addPlayer('Yo', [0, 0, 255], true);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  assert.ok(game.spawnPlayer(human, inland[Math.floor(inland.length / 2)]));
  while (game.phase === 'spawn') game.tick();
  return { map, game, human, body };
}

function ownTiles(game, p) {
  const out = [];
  for (let i = 0; i < game.owner.length; i++) if (game.owner[i] === p.id) out.push(i);
  return out;
}

test('el oro crece con el territorio', () => {
  const { game, human } = setup();
  assert.equal(human.gold, CONFIG.startGold);
  for (let i = 0; i < 50; i++) game.tick();
  assert.ok(human.gold > 0, 'debería haber ganado oro');
  const small = human.goldPerTick();
  human.tiles *= 10;
  assert.ok(human.goldPerTick() > small);
  human.tiles /= 10;
});

test('reglas de construcción: territorio propio, oro, distancia y coste creciente', () => {
  const { map, game, human } = setup();
  const mine = ownTiles(game, human);
  const center = human.spawnTile;

  human.gold = 0;
  assert.equal(game.canBuild(human, 'city', center).ok, false, 'sin oro no se construye');

  human.gold = 1e6;
  const enemyOrWild = map.landTiles.find((t) => game.owner[t] !== human.id);
  assert.equal(game.canBuild(human, 'city', enemyOrWild).ok, false, 'fuera del territorio no');
  assert.equal(game.canBuild(human, 'port', center).ok, false, 'puerto tierra adentro no');

  const goldBefore = human.gold;
  assert.ok(game.build(human, 'city', center));
  assert.equal(human.gold, goldBefore - BUILDINGS.city.base);
  assert.equal(human.buildings.city, 1);
  assert.equal(game.buildCost(human, 'city'), BUILDINGS.city.base + BUILDINGS.city.step);

  const neighbor = mine.find((t) => t !== center && Math.abs(map.x(t) - map.x(center)) + Math.abs(map.y(t) - map.y(center)) <= 2);
  assert.equal(game.canBuild(human, 'fort', neighbor).ok, false, 'demasiado cerca de otro edificio');
});

test('la ciudad sube el máximo de tropas; el puerto, los barcos y el oro', () => {
  const { map, game, human } = setup();
  human.gold = 1e6;
  const maxBefore = human.maxTroops();
  assert.ok(game.build(human, 'city', human.spawnTile));
  assert.equal(human.maxTroops(), maxBefore + CONFIG.cityMaxTroops);

  // Expandimos hasta tener costa y construimos un puerto
  for (let i = 0; i < 60 && !ownTiles(game, human).some((t) => map.coastal[t]); i++) {
    human.troops = 1e5;
    game.launchAttack(human, 0, 50000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  const coast = ownTiles(game, human).find((t) => map.coastal[t] && game.canBuild(human, 'port', t).ok);
  assert.ok(coast !== undefined, 'debería tener costa libre');
  const boatsBefore = human.maxBoats();
  const goldRate = human.goldPerTick();
  assert.ok(game.build(human, 'port', coast));
  assert.equal(human.maxBoats(), boatsBefore + 1);
  assert.ok(human.goldPerTick() > goldRate);
});

test('la fortaleza encarece conquistar las casillas de alrededor', () => {
  const { map, game, human } = setup();
  const t = human.spawnTile;
  const near = map.index(map.x(t) + 2, map.y(t));
  const plainCost = game.tileCost(near, human).cost;
  human.gold = 1e6;
  assert.ok(game.build(human, 'fort', t));
  const fortCost = game.tileCost(near, human).cost;
  assert.ok(Math.abs(fortCost - plainCost * CONFIG.fortDefenseMult) < 1e-6);
  const far = map.landTiles.find((x) => Math.hypot(map.x(x) - map.x(t), map.y(x) - map.y(t)) > CONFIG.fortRadius + 2);
  assert.equal(game.fortMultiplier(human, far), 1);
});

test('los edificios cambian de dueño con su casilla y el eliminado deja botín', () => {
  const { game, human } = setup();
  const rival = game.addPlayer('Rival', [255, 0, 0], false);
  human.gold = 1e6;
  assert.ok(game.build(human, 'fort', human.spawnTile));
  human.gold = 777;

  // El rival se queda con todas las casillas del humano
  for (const t of ownTiles(game, human)) game.setOwner(t, rival.id);
  assert.equal(human.buildings.fort, 0);
  assert.equal(rival.buildings.fort, 1);
  assert.ok(rival.forts.has(human.spawnTile));
  assert.equal(game.buildingAt.get(human.spawnTile).owner, rival.id);

  const rivalGold = rival.gold;
  game.tick();
  assert.equal(human.alive, false);
  assert.ok(rival.gold >= rivalGold + 777, 'el botín pasa al conquistador');
});

test('los bots construyen durante la partida', () => {
  const map = generateMap(220, 130, 3);
  const game = new Game({ map, seed: 3 });
  game.addBots(10);
  game.start();
  for (let i = 0; i < 2500 && game.phase !== 'ended'; i++) game.tick();
  assert.ok(game.buildings.length > 0, 'algún bot debería haber construido');
  for (const b of game.buildings) {
    assert.equal(game.owner[b.tile], b.owner, 'cada edificio pertenece al dueño de su casilla');
  }
  // Todos los tipos de edificio (los buques y misiles no son edificios)
  const kinds = Object.keys(BUILDINGS).filter((k) => !BUILDINGS[k].unit);
  const counted = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const p of game.players) if (p) for (const k of kinds) counted[k] += p.buildings[k];
  const real = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const b of game.buildings) real[b.kind]++;
  assert.deepEqual(counted, real, 'los recuentos por jugador cuadran con la lista de edificios');
});

test('las reglas de la partida: oro inicial, victoria y armas desactivadas', () => {
  const map = generateMap(220, 130, 21);
  const game = new Game({ map, seed: 21, rules: { startGold: 250000, winShare: 0.5, missiles: false, warships: false } });
  const p = game.addPlayer('P', [0, 0, 0], true);
  game.addBots(3);
  game.start();
  assert.equal(p.gold, 250000);
  assert.equal(game.isAllowed('silo'), false);
  assert.equal(game.isAllowed('warship'), false);
  assert.equal(game.isAllowed('city'), true);
  p.gold = 1e6;
  game.spawnPlayer(p, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  assert.equal(game.canBuild(p, 'silo', p.spawnTile).ok, false);
  // Victoria al 50 %
  p.tiles = Math.ceil(map.landCount * 0.5);
  game._checkVictory();
  assert.equal(game.winner, p);
});
