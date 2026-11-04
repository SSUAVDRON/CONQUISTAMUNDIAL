// Tests de fábricas, silos, misiles y antimisiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras } from './ayuda.js';
import { BUILDINGS, CONFIG, RES } from '../src/config.js';

/** Tres naciones en la masa de tierra mayor, ya en juego y con oro de sobra. */
function setup(seed = 11) {
  const map = generateMap(240 * RES, 140 * RES, seed);
  const game = new Game({ map, seed });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 0, 255], false);
  const c = game.addPlayer('C', [0, 255, 0], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = inland[Math.floor(inland.length * 0.2)];
  const tb = inland.find((t) => {
    const d = Math.hypot(map.x(t) - map.x(ta), map.y(t) - map.y(ta));
    return d > 40 * RES && d < 80 * RES && game.owner[t] === 0;
  });
  assert.ok(game.spawnPlayer(a, ta) && game.spawnPlayer(b, tb));
  game.spawnPlayer(c, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  // B crece para tener algo que arrasar
  for (let i = 0; i < 20; i++) {
    b.troops = 1e5;
    game.launchAttack(b, 0, 40000);
    for (let k = 0; k < 10; k++) game.tick();
  }
  a.gold = b.gold = 1e7;
  return { map, game, a, b, c, ta, tb };
}

test('la fábrica sube el oro un 25 %', () => {
  const { game, a, ta } = setup();
  const before = a.goldPerTick();
  assert.ok(buildNow(game, a, 'factory', ta));
  assert.ok(Math.abs(a.goldPerTick() - before * (1 + CONFIG.factoryGoldBonus)) < 1e-9);
  assert.equal(game.buildCost(a, 'factory'), Math.round(BUILDINGS.factory.base * (1 + CONFIG.inflation)));
  // Nivel 2: otro 25 %
  assert.ok(buildNow(game, a, 'factory', ta), 'clic sobre la fábrica = mejorarla');
  assert.ok(Math.abs(a.goldPerTick() - before * (1 + 2 * CONFIG.factoryGoldBonus)) < 1e-9);
  assert.equal(a.buildings.factory, 1, 'sigue siendo una fábrica');
});

test('sin silo no hay misiles; con silo, el misil arrasa la zona y quita tropas', () => {
  const { map, game, a, b, ta, tb } = setup();
  assert.equal(game.canBuild(a, 'missile', tb).ok, false, 'sin silo no se puede');
  assert.ok(buildNow(game, a, 'silo', ta));
  assert.equal(game.canBuild(a, 'missile', ta).ok, false, 'no se puede atacar territorio propio');

  // B deja de expandirse para medir solo el efecto del misil
  for (const atk of [...b.attacks.values()]) game._endAttack(atk);
  const tilesBefore = b.tiles;
  const troopsBefore = b.troops;
  const goldBefore = a.gold;
  assert.ok(buildNow(game, a, 'missile', tb));
  assert.equal(a.gold, goldBefore - BUILDINGS.missile.base);
  assert.equal(game.missiles.length, 1);
  assert.equal(game.canBuild(a, 'missile', tb).ok, false, 'el silo está recargando');
  for (let i = 0; i < 200 && game.missiles.length; i++) game.tick();
  assert.equal(game.missiles.length, 0, 'el misil debería haber llegado');
  assert.ok(b.tiles < tilesBefore - 100, `B debería perder muchas casillas: ${tilesBefore} → ${b.tiles}`);
  assert.ok(b.troops < troopsBefore, 'y tropas');
  assert.equal(game.owner[tb], 0, 'el centro del impacto queda libre');
  assert.ok(game.effects.some((e) => e.kind === 'boom'));
  // El silo vuelve a estar listo tras recargar
  for (let i = 0; i < CONFIG.siloReload; i++) game.tick();
  assert.ok(game.readySilo(a, [...b.border][0]));
});

test('los misiles no dañan a los aliados ni se pueden lanzar contra ellos', () => {
  const { game, a, b, ta, tb } = setup();
  buildNow(game, a, 'silo', ta);
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  assert.equal(game.canBuild(a, 'missile', tb).ok, false);
});

test('los antimisiles derriban misiles enemigos (a veces fallan) y recargan', () => {
  const { map, game, a, b, ta, tb } = setup();
  for (const atk of [...b.attacks.values()]) game._endAttack(atk);
  buildNow(game, a, 'silo', ta);
  const dist = (t, u) => Math.hypot(map.x(t) - map.x(u), map.y(t) - map.y(u));
  const samTile = [...map.landTiles].find((t) => game.owner[t] === b.id && dist(t, tb) < 6 && game.canBuild(b, 'sam', t).ok);
  assert.ok(samTile !== undefined && buildNow(game, b, 'sam', samTile), 'B construye antimisiles');
  const sam = game.buildings.find((x) => x.owner === b.id && x.kind === 'sam');
  const silo = game.buildings.find((x) => x.owner === a.id && x.kind === 'silo');
  let shots = 0;
  let hits = 0;
  for (let round = 0; round < 16; round++) {
    // Objetivo a tiro de la batería pero fuera del radio de la explosión
    const target = [...map.landTiles].find((t) => {
      const d = dist(t, samTile);
      return game.owner[t] === b.id && d > CONFIG.missileRadius + 2 && d < CONFIG.samRange - 4;
    });
    if (target === undefined) break;
    a.gold = 1e7;
    silo.readyAt = 0;
    sam.readyAt = 0;
    const t0 = game.ticks;
    assert.ok(buildNow(game, a, 'missile', target));
    for (let i = 0; i < 200 && game.missiles.length; i++) game.tick();
    const fired = game.effects.filter((e) => e.tick > t0 && (e.kind === 'intercept' || e.kind === 'miss'));
    shots += fired.length;
    hits += fired.filter((e) => e.kind === 'intercept').length;
  }
  assert.ok(game.buildings.includes(sam), 'la batería sigue en pie');
  assert.ok(shots >= 8, `la batería debería disparar a cada misil que pasa: ${shots}`);
  assert.ok(hits >= 2 && hits < shots, `derriba algunos y falla otros: ${hits}/${shots}`);
});
