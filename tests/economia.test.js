// Economía de doc-1.6: el territorio produce oro, la capital amurallada (con
// mejoras de industria y población, murallas, botín y traslado si cae), los
// pueblos y los lugares de interés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';
import { MECH, capitalPrice, territoryGold } from '../src/mecanicas.js';
import { LUGARES } from '../src/lugares.js';
import { buildNow } from './ayuda.js';

function play(rules = {}) {
  const map = generateMap(220 * RES, 130 * RES, 9);
  const game = new Game({ map, seed: 9, rules: { profile: 'clasico', ...rules } });
  const h = game.addPlayer('Yo', [0, 0, 255], true);
  const o = game.addPlayer('Otro', [255, 0, 0], false);
  game.addColonies(3);
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  game.spawnPlayer(o, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { game, h, o, map };
}

test('economía: el territorio produce oro (más cuanto más grande, con rendimiento decreciente); las colonias, la mitad', () => {
  assert.ok(Math.abs(territoryGold(1000) - 44.7) < 0.1);
  assert.ok(Math.abs(territoryGold(300000) - 1029) < 1);
  assert.ok(territoryGold(20000) / territoryGold(1000) < 20, 'decreciente');
  const { game, h } = play();
  const b = h.goldBreakdown();
  assert.ok(b.tax > 0);
  assert.ok(Math.abs(b.tax - territoryGold(h.tiles, (RES / 2) ** 2)) < 1e-9);
  const g0 = h.gold;
  game.tick();
  assert.ok(Math.abs(h.gold - g0 - h.goldPerTick()) < 1e-6, 'se cobra cada turno');
  const col = game.players.find((p) => p && p.weak && p.tiles);
  assert.ok(Math.abs(col.goldBreakdown().tax - territoryGold(col.tiles, (RES / 2) ** 2) * MECH.tax.colonyShare) < 1e-9);
  // Sin la regla, nada del territorio
  assert.equal(play({ taxes: false }).h.goldBreakdown().tax, 0);
});

test('capital: nace donde te despliegas (naciones y jugadores, no colonias) y no se construye', () => {
  const { game, h, o } = play();
  assert.ok(h.capital && o.capital, 'cada nación tiene la suya');
  assert.equal(h.capital.tile, h.spawnTile);
  assert.equal(game.buildingAt.get(h.spawnTile), h.capital);
  assert.ok(game.players.filter((p) => p && p.weak).every((p) => !p.capital), 'las colonias no');
  assert.equal(game.canBuild(h, 'capital', h.spawnTile).ok, false);
  assert.ok(!play({ capitals: false }).h.capital, 'sin la regla, sin capital');
});

test('capital: industria y población se mejoran sin elegir sitio, tardan, encarecen y tienen tope', () => {
  const { game, h } = play();
  h.gold = 1e9;
  const base = h.goldBreakdown();
  const cap0 = h.maxTroops();
  const grow0 = h.mods.growth;
  assert.equal(game.buildCost(h, 'capInd'), capitalPrice(0));
  game.queueIntent({ type: 'build', kind: 'capInd', playerId: h.id });
  game.tick();
  assert.equal(h.capital.work.track, 'ind', 'en obras');
  assert.equal(game.canBuild(h, 'capPop').ok, false, 'una obra a la vez');
  while (h.capital.work) game.tick();
  assert.equal(h.capital.ind, 1);
  const b = h.goldBreakdown();
  assert.ok(Math.abs(b.bonus - (b.base + b.tax + b.villages) * h.mods.gold) < 1e-9);
  assert.ok(b.bonus - base.bonus > (b.base + b.tax) * 0.24, '+25 % del oro pasivo');
  assert.equal(game.buildCost(h, 'capInd'), capitalPrice(1), 'el siguiente nivel cuesta más');
  assert.ok(game.build(h, 'capPop'));
  while (h.capital.work) game.tick();
  assert.ok(h.maxTroops() > cap0 * 1.09, '+10 % de techo');
  assert.ok(Math.abs(h.mods.growth - grow0 - MECH.capital.popGrowth) < 1e-9, '+8 % de crecimiento');
  h.capital.ind = MECH.capital.maxLevel;
  assert.equal(game.canBuild(h, 'capInd').ok, false, 'tope de nivel');
});

test('capital: las murallas defienden mucho y las bombas no arrasan lo que hay dentro', () => {
  const { game, h, o, map } = play();
  const c = h.capital.tile;
  const inside = game.wallMultiplier(h, c);
  assert.ok(inside >= MECH.capital.wallMult);
  assert.ok(game.fortMultiplier(h, c) >= inside, 'cuenta como defensa');
  const far = map.index(Math.min(map.width - 1, map.x(c) + CONFIG.capitalWallRadius + 3), map.y(c));
  assert.equal(game.wallMultiplier(h, far), 1);
  // Una bomba sobre la capital: las casillas de dentro de la muralla siguen siendo suyas
  const before = h.tiles;
  game._detonate({ owner: o.id, to: c, radius: CONFIG.missileRadius });
  assert.equal(game.owner[c], h.id, 'la capital aguanta');
  assert.ok(game.buildingAt.get(c) === h.capital);
  assert.ok(h.tiles > 0 && h.tiles <= before);
});

test('capital: si cae, quien la toma se lleva botín y la nación la refunda con la mitad de sus mejoras', () => {
  const { game, h, o } = play();
  h.gold = 1e9;
  // Con una ciudad: la capital se refundará en ella
  const city = findOwn(game, h);
  assert.ok(buildNow(game, h, 'city', city));
  h.capital.ind = 4;
  h.capital.pop = 3;
  h.gold = 1000000;
  const oGold = o.gold;
  const tile = h.capital.tile;
  game.setOwner(tile, o.id);
  assert.ok(!game.buildingAt.has(tile) || game.buildingAt.get(tile).kind !== 'capital', 'la capital cae');
  assert.equal(h.capital, null);
  const loot = 0.2 * 1000000 + MECH.capital.lootBase;
  assert.ok(Math.abs(o.gold - oGold - loot) < 1, 'botín: el 20 % de su oro y una recompensa');
  assert.ok(Math.abs(h.gold - 800000) < 1);
  game.tick();
  assert.ok(h.capital, 'refundada al final del turno');
  assert.equal(h.capital.ind, 2);
  assert.equal(h.capital.pop, 1);
  assert.equal(h.capital.tile, city, 'en su mejor ciudad');
  assert.equal(game.owner[h.capital.tile], h.id);
});

/** Una casilla propia libre para construir (lejos de la capital). */
function findOwn(game, p) {
  for (let t = 0; t < game.map.size; t++) if (game.owner[t] === p.id && game.canBuild(p, 'city', t).ok) return t;
  return -1;
}

test('pueblos: baratos, +oro y +techo por nivel; el precio sube poco a poco', () => {
  const { game, h } = play();
  h.gold = 1e9;
  assert.equal(game.buildCost(h, 'village'), MECH.village.step);
  const t = findOwn(game, h);
  const cap0 = h.maxTroops();
  const v0 = h.goldBreakdown().villages;
  assert.ok(buildNow(game, h, 'village', t));
  assert.equal(h.goldBreakdown().villages - v0, MECH.village.gold * h.goldMult);
  assert.ok(Math.abs(h.maxTroops() - cap0 - MECH.village.cap * h.capMult * (1 + h.mods.cap)) < 1e-6);
  assert.equal(game.buildCost(h, 'village'), MECH.village.step * 2);
});

test('lugares de interés: repartidos en tierra libre; al conquistarlos dan su premio y reaparecen en otro sitio', () => {
  const { game, h } = play();
  assert.ok(game.lugares.length >= 6);
  for (const l of game.lugares) assert.equal(game.owner[l.tile], 0, 'en tierra libre');
  // Un tesoro: oro al momento
  const lg = game.lugares[0];
  lg.kind = 'tesoro';
  const g0 = h.gold;
  game.setOwner(lg.tile, h.id);
  assert.ok(h.gold > g0 + 100000, 'tesoro: oro');
  assert.ok(!game.lugares.includes(lg), 'desaparece');
  assert.equal(game._lugarRespawns.length, 1, 'y otro aparecerá');
  // Un granero: bono durante su tiempo y luego se va
  const gr = game.lugares[0];
  gr.kind = 'granero';
  const grow0 = h.mods.growth;
  game.setOwner(gr.tile, h.id);
  assert.ok(Math.abs(h.mods.growth - grow0 - LUGARES.granero.buff.growth) < 1e-9);
  for (let i = 0; i < LUGARES.granero.ticks + 2; i++) game.tick();
  assert.ok(Math.abs(h.mods.growth - grow0) < 1e-9, 'el bono caduca');
  // Ruinas: para siempre
  const ru = game.lugares[0];
  ru.kind = 'ruinas';
  const gold0 = h.mods.gold;
  game.setOwner(ru.tile, h.id);
  for (let i = 0; i < 50; i++) game.tick();
  assert.ok(Math.abs(h.mods.gold - gold0 - LUGARES.ruinas.perm.gold) < 1e-9);
});
