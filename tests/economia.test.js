// Economía de doc-1.6 y doc-1.7: el territorio produce oro, la capital
// amurallada (una mejora, banco de tropas, murallas y afueras, escudo
// antimisiles, botín y traslado si cae), los pueblos y los lugares de interés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';
import { MECH, bankShare, capitalPerks, capitalPrice, territoryGold } from '../src/mecanicas.js';
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

test('capital: una sola mejora, sin elegir sitio; cuesta oro y tropas, tarda, encarece, llega al 12 y da oro y sitio en el banco', () => {
  const { game, h } = play();
  h.gold = 1e9;
  h.troops = h.maxTroops();
  const base = h.goldBreakdown();
  const bank0 = game.bankCap(h);
  assert.ok(Math.abs(bank0 - h.maxTroops() * MECH.capital.bankBase) < 1e-6, 'el banco nace con el 30 % del techo');
  assert.equal(game.buildCost(h, 'capUp'), capitalPrice(0));
  const troopCost = game.capitalTroopCost(h);
  assert.ok(Math.abs(troopCost - h.maxTroops() * MECH.capital.troopBase) < 1, 'tropas: el 6 % del techo');
  const t0 = h.troops;
  game.queueIntent({ type: 'build', kind: 'capUp', playerId: h.id });
  game.tick();
  assert.ok(h.capital.work, 'en obras');
  assert.ok(h.troops < t0 - troopCost * 0.9, 'se pagan las tropas');
  assert.equal(game.canBuild(h, 'capUp').ok, false, 'una obra a la vez');
  while (h.capital.work) game.tick();
  assert.equal(h.capital.up, 1);
  const b = h.goldBreakdown();
  assert.ok(Math.abs(b.bonus - (b.base + b.tax + b.villages) * h.mods.gold) < 1e-9);
  assert.ok(b.bonus - base.bonus > (b.base + b.tax) * 0.19, '+20 % del oro pasivo');
  assert.ok(Math.abs(game.bankCap(h) - h.maxTroops() * bankShare(1)) < 1e-6, 'más banco');
  assert.equal(game.buildCost(h, 'capUp'), capitalPrice(1), 'el siguiente nivel cuesta más oro');
  assert.ok(game.capitalTroopCost(h) > troopCost, 'y más tropas');
  // Sin tropas suficientes no se puede
  h.troops = 0;
  assert.equal(game.canBuild(h, 'capUp').ok, false, 'faltan tropas');
  h.troops = h.maxTroops();
  // Tope: nivel 12, con el banco de 3,5 techos
  assert.equal(MECH.capital.maxLevel, 12);
  assert.ok(bankShare(12) > 3.5 && bankShare(12) < 3.6);
  h.capital.up = MECH.capital.maxLevel;
  assert.equal(game.canBuild(h, 'capUp').ok, false, 'tope de nivel');
});

test('capital: banco de tropas; se guarda y se saca con órdenes, cabe lo que dice su nivel y recluta con el excedente', () => {
  const { game, h } = play();
  const cap = h.capital;
  h.troops = 10000;
  game.queueIntent({ type: 'bank', op: 'in', ratio: 0.4, playerId: h.id });
  game.tick();
  assert.equal(cap.bank, 4000, 'guarda el 40 % de sus soldados');
  assert.ok(h.troops < 6000 + 300 && h.troops >= 6000, 'que salen de los soldados (más lo que regeneran en el turno)');
  // No cabe más de lo que dice su nivel
  h.troops = game.bankCap(h) * 5;
  game.bankDeposit(h, 1);
  assert.ok(Math.abs(cap.bank - game.bankCap(h)) < 1, 'lleno');
  // Sacarlo todo
  const before = h.troops;
  const stored = cap.bank;
  game.queueIntent({ type: 'bank', op: 'out', playerId: h.id });
  game.tick();
  assert.ok(cap.bank < stored * 0.05, 'se vacía (salvo lo que la capital recluta en ese turno: sus tropas quedan al tope)');
  assert.ok(h.troops >= before + stored - 1, 'vuelven a los soldados');
  // Con las tropas al tope, la capital recluta hacia el banco
  h.troops = h.maxTroops();
  game.tick();
  assert.ok(cap.bank > 0, 'recluta con el excedente');
  // Cuantas más tropas guardadas, más fuertes las murallas (hasta un banco de 3 techos)
  cap.bank = 0;
  const empty = game.wallMultiplier(h, cap.tile);
  cap.bank = h.maxTroops();
  assert.ok(Math.abs(game.wallMultiplier(h, cap.tile) - empty * (1 + MECH.capital.bankDefense)) < 1e-9, 'un techo guardado: ×1,6');
  cap.bank = h.maxTroops() * 10;
  assert.ok(Math.abs(game.wallMultiplier(h, cap.tile) - empty * (1 + MECH.capital.bankDefense * MECH.capital.bankDefenseMax)) < 1e-9, 'con tope');
});

test('capital: premios de nivel (escudo, afueras y murallas más amplias, crecimiento, barcos, techo, comercio y la ciudadela dorada)', () => {
  const { game, h } = play();
  const cap = h.capital;
  const r0 = game.capitalRadii(cap);
  const shots0 = game.samShots(cap);
  const boats0 = h.maxBoats();
  const growth0 = h.mods.growth;
  cap.up = 12;
  game._refreshMods(h);
  const pk = capitalPerks(12);
  assert.equal(game.samShots(cap), shots0 + 4, '+1 disparo en los niveles 3, 6, 9 y 12');
  const r12 = game.capitalRadii(cap);
  assert.equal(r12.outer, r0.outer + 3 * RES);
  assert.equal(r12.wall, r0.wall + 2 * RES);
  assert.equal(h.maxBoats(), boats0 + 1);
  assert.ok(Math.abs(h.mods.growth - growth0 - pk.growth) < 1e-9);
  assert.ok(Math.abs(game.wallDefense(h) - (MECH.capital.wallMult + MECH.capital.wallMultPerLevel * 12) * 1.25) < 1e-9, 'murallas ×1,25 a nivel 12');
});

test('capital: murallas fuertes, afueras reforzadas y las bombas no arrasan lo que hay dentro', () => {
  const { game, h, o, map } = play();
  const c = h.capital.tile;
  const inside = game.wallMultiplier(h, c);
  assert.ok(inside >= MECH.capital.wallMult);
  assert.equal(game.capitalZone(h, c), 2);
  assert.ok(game.fortMultiplier(h, c) >= inside, 'cuenta como defensa');
  const outer = map.index(Math.min(map.width - 1, map.x(c) + CONFIG.capitalWallRadius + 2), map.y(c));
  assert.equal(game.capitalZone(h, outer), 1, 'afueras');
  assert.equal(game.wallMultiplier(h, outer), MECH.capital.outerMult);
  const far = map.index(Math.min(map.width - 1, map.x(c) + CONFIG.capitalOuterRadius + 3), map.y(c));
  assert.equal(game.wallMultiplier(h, far), 1);
  // Una bomba sobre la capital: las casillas de dentro de la muralla siguen siendo suyas
  const before = h.tiles;
  game._detonate({ owner: o.id, to: c, radius: CONFIG.missileRadius });
  assert.equal(game.owner[c], h.id, 'la capital aguanta');
  assert.ok(game.buildingAt.get(c) === h.capital);
  assert.ok(h.tiles > 0 && h.tiles <= before);
});

test('capital: su escudo derriba los misiles que se le acercan', () => {
  const { game, h, o, map } = play();
  const c = h.capital.tile;
  let shots = 0;
  let hits = 0;
  for (let i = 0; i < 12; i++) {
    h.capital.readyAt = 0;
    h.capital.ammo = null;
    // Un misil enemigo que cae sobre la capital, lanzado desde fuera del alcance del escudo
    const from = map.index(Math.max(0, map.x(c) - CONFIG.capitalSamRange - 20), map.y(c));
    game.missiles.push({ owner: o.id, targetId: h.id, from, to: c, progress: 0, dist: CONFIG.capitalSamRange + 20, radius: CONFIG.missileRadius });
    const t0 = game.ticks;
    for (let k = 0; k < 60 && game.missiles.length; k++) game.tick();
    game.missiles.length = 0;
    const fired = game.effects.filter((e) => e.tick > t0 && e.from === c);
    shots += fired.length;
    hits += fired.filter((e) => e.kind === 'intercept').length;
  }
  assert.ok(hits >= 9, `derriba casi todos: ${hits}/12 (${shots} disparos)`);
});

test('capital: si cae, quien la toma se lleva botín (oro y tropas del banco) y la nación la refunda con la mitad de sus mejoras', () => {
  const { game, h, o } = play();
  h.gold = 1e9;
  // Con una ciudad: la capital se refundará en ella
  const city = findOwn(game, h);
  assert.ok(buildNow(game, h, 'city', city));
  h.capital.up = 5;
  h.capital.bank = 8000;
  h.gold = 1000000;
  const oGold = o.gold;
  const oTroops = o.troops;
  const tile = h.capital.tile;
  game.setOwner(tile, o.id);
  assert.ok(!game.buildingAt.has(tile) || game.buildingAt.get(tile).kind !== 'capital', 'la capital cae');
  assert.equal(h.capital, null);
  const loot = 0.2 * 1000000 + MECH.capital.lootBase;
  assert.ok(Math.abs(o.gold - oGold - loot) < 1, 'botín: el 20 % de su oro y una recompensa');
  assert.ok(Math.abs(o.troops - oTroops - 4000) < 1, 'y la mitad de su banco');
  assert.ok(Math.abs(h.gold - 800000) < 1);
  game.tick();
  assert.ok(h.capital, 'refundada al final del turno');
  assert.equal(h.capital.up, 2);
  assert.equal(h.capital.bank, 0, 'con el banco vacío');
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
