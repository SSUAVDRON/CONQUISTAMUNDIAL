// Tests de los fallos de lógica corregidos en la revisión de la fase 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';
import { MECH } from '../src/mecanicas.js';
import { buildNow, casillaPara } from './ayuda.js';

/** Dos naciones pegadas (A humana, B bot), ya en juego; un tercero opcional. */
function duelo(seed = 11, rules = null, { third = false } = {}) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed, rules });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  const c = third ? game.addPlayer('C', [0, 0, 255], false) : null;
  game.human = a;
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  assert.ok(game.spawnPlayer(a, ta));
  const tb = tiles.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return game.owner[t] === 0 && d2 > 18 ** 2 && d2 < 22 ** 2;
  });
  assert.ok(game.spawnPlayer(b, tb));
  if (c) assert.ok(game.spawnPlayer(c, game.findSpawnTile()));
  while (game.phase === 'spawn') game.tick();
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 20000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  assert.ok(game.hasLandBorder(a, b.id), 'A y B deberían ser vecinos');
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  return { map, game, a, b, c };
}

test('Industria: los trenes de tus fábricas rinden un 50 % más', () => {
  const { game, a } = duelo();
  a.gold = 1e8;
  const ft = casillaPara(game, a, 'factory');
  assert.ok(ft >= 0 && buildNow(game, a, 'factory', ft));
  const ct = casillaPara(game, a, 'city');
  assert.ok(ct >= 0 && buildNow(game, a, 'city', ct));
  const factory = game.buildingAt.get(ft);
  const city = game.buildingAt.get(ct);
  const ride = () => {
    const g0 = a.gold;
    game._trainArrive({ factory, station: city }, city);
    return a.gold - g0;
  };
  const plain = ride();
  assert.equal(plain, MECH.trainRewards.self * a.goldMult);
  assert.ok(game.setSpec(a, 'industria'));
  assert.ok(Math.abs(ride() - plain * 1.5) < 1e-6, 'con Industria, +50 %');
});

test('Milicia también defiende con oro fijo (sin trabajadores)', () => {
  const { game, a } = duelo();
  assert.equal(a.economy, 'fixed');
  a.troops = 10000;
  assert.equal(game.defenders(a), 10000);
  a.techs.add('milicia');
  game._refreshMods(a);
  assert.ok(Math.abs(game.defenders(a) - 11500) < 1e-6, '+15 % de fuerza al defender');
});

test('victoria económica: dos que se turnan el primer puesto no reinician su plazo', () => {
  const { game, a, b } = duelo(11, { victory: 'economia' }, { third: true });
  const goal = CONFIG.economyGoalPerMin;
  // Los dos por encima del objetivo; el primero cambia cada turno
  game.incomePerMin = (p) => (p === a ? goal + (game.ticks % 2 ? 10 : 0) : p === b ? goal + (game.ticks % 2 ? 0 : 10) : 0);
  for (let i = 0; i < CONFIG.economyHoldTicks + 5 && game.phase !== 'ended'; i++) game.tick();
  assert.equal(game.phase, 'ended', 'alguien gana pese a turnarse');
  assert.equal(game.winReason, 'economia');
  assert.ok(game.winner === a || game.winner === b);
});

test('límite de tiempo: en modo capitales gana quien tenga más capitales, no más territorio', () => {
  const { game, a, b } = duelo(11, { victory: 'capitales', timeLimitMin: 10 }, { third: true });
  // B se queda con la capital de A, pero A tiene más territorio
  game.setOwner(a.capitalTile, b.id);
  a.troops = 1e6;
  assert.ok(a.tiles > b.tiles);
  game.goalHolders.clear();
  game.ticks = CONFIG.spawnTicks + 10 * 600 - 1;
  game.tick();
  assert.equal(game.phase, 'ended');
  assert.equal(game.winner, b);
  assert.equal(game.winReason, 'tiempo');
});

test('bomba H y MIRV desactivadas con los misiles', () => {
  const { game } = duelo(11, { missiles: false });
  for (const kind of ['silo', 'sam', 'missile', 'hbomb', 'mirv']) assert.equal(game.isAllowed(kind), false, kind);
  assert.equal(game.isAllowed('city'), true);
});

test('un pacto firmado durante el viaje: el barco no desembarca y la bomba no le alcanza', () => {
  const { game, a, b } = duelo();
  assert.ok(game.makeOffer(a, b, 'pact'));
  assert.ok(game.respondOffer(b, a, 'pact', true));
  const dest = [...b.border][0];
  const troops0 = a.troops;
  a.boatCount = 1;
  game._landBoat({ dest, troops: 5000, done: false }, a);
  assert.equal(game.owner[dest], b.id, 'la casilla sigue siendo de B');
  assert.equal(a.troops, troops0 + 5000, 'las tropas vuelven');
  const tilesB = b.tiles;
  game._detonate({ to: dest, owner: a.id, radius: 3 });
  assert.equal(b.tiles, tilesB, 'la bomba no arrasa al socio del pacto');
});

test('durante el despliegue no se investiga ni se especializa, y se explica por qué no puedes empezar', () => {
  const map = generateMap(160 * RES, 100 * RES, 3);
  const game = new Game({ map, seed: 3 });
  const a = game.addPlayer('A', [255, 0, 0], true);
  game.human = a;
  game.start();
  assert.equal(game.phase, 'spawn');
  a.gold = 1e7;
  game.queueIntent({ type: 'research', tech: 'agricultura', playerId: a.id });
  game.queueIntent({ type: 'spec', spec: 'urbano', playerId: a.id });
  game.tick();
  assert.equal(a.research, null);
  assert.equal(a.spec, '');
  const water = map.terrain.indexOf(0);
  assert.match(game.spawnCheck(a, water).reason, /agua/);
});

test('cercos: los ataques se procesan en turno rotatorio', () => {
  const { game } = duelo();
  const order = [];
  const fake = [0, 1, 2].map((k) => ({ k, done: false }));
  game.attacks = fake;
  const orig = game._processAttack;
  game._processAttack = (atk) => order.push(atk.k);
  game.tick();
  const first = order.slice();
  order.length = 0;
  game.tick();
  game._processAttack = orig;
  game.attacks = [];
  assert.equal(first.length, 3);
  assert.notEqual(first[0], order[0], 'cada turno empieza un ataque distinto');
});
