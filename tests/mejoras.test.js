// Tests de las mejoras estratégicas: puntos estratégicos, órdenes militares,
// tecnologías, especialización, diplomacia ampliada y victorias alternativas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES, cleanRules } from '../src/config.js';
import { POI, placePoints } from '../src/estrategia.js';
import { TECHS, techAvailable } from '../src/tecnologias.js';

/** Dos naciones pegadas (A humana y B bot sin cerebro activo), ya en juego. */
function twoNeighbors(seed = 11, rules = null) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed, rules });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  game.human = a;
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  assert.ok(game.spawnPlayer(a, ta));
  const tb = tiles.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return game.owner[t] === 0 && d2 > (9 * RES) ** 2 && d2 < (11 * RES) ** 2;
  });
  assert.ok(game.spawnPlayer(b, tb));
  while (game.phase === 'spawn') game.tick();
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 20000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  assert.ok(game.hasLandBorder(a, b.id), 'A y B deberían ser vecinos');
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  return { map, game, a, b };
}

test('puntos estratégicos: se colocan igual con la misma semilla, separados y en tierra', () => {
  const { map } = loadRealMap('europa');
  const p1 = placePoints(map, 5);
  const p2 = placePoints(map, 5);
  assert.deepEqual(p1, p2, 'deterministas');
  assert.ok(p1.length >= 8 && p1.length <= 36);
  for (const pt of p1) assert.ok(map.isLand(pt.tile));
  const kinds = new Set(p1.map((p) => p.kind));
  for (const k of ['industria', 'puerto', 'paso']) assert.ok(kinds.has(k), `hay ${k}`);
});

test('capitales al empezar y efectos de tomar puntos: oro, barcos, pasos y capital perdida', () => {
  const { game, a, b } = twoNeighbors();
  assert.ok(a.capitalTile >= 0 && game.pointAt.get(a.capitalTile)?.kind === 'capital');
  assert.ok(a.mods.gold > 0 && a.mods.growth > 0, 'su propia capital le da oro y crecimiento');
  // Un núcleo industrial y un puerto clave (los asignamos a mano)
  const ind = game.points.find((p) => p.kind === 'industria');
  const port = game.points.find((p) => p.kind === 'puerto');
  const gold0 = a.mods.gold;
  game.setOwner(ind.tile, a.id);
  assert.ok(a.mods.gold > gold0, 'el núcleo industrial da oro');
  const boats0 = a.maxBoats();
  game.setOwner(port.tile, a.id);
  assert.equal(a.maxBoats(), boats0 + 1, 'el puerto clave da un barco');
  // Capital de B tomada por A: botín y B crece menos
  const g0 = a.gold;
  game.setOwner(b.capitalTile, a.id);
  assert.ok(a.gold >= g0 + POI.capitalBounty, 'botín por la capital');
  assert.ok(b.mods.growth < 0, 'sin capital, B crece menos');
  // Paso de montaña de B: atacar a su alrededor cuesta más
  const pass = game.points.find((p) => p.kind === 'paso');
  if (pass) {
    game.setOwner(pass.tile, b.id);
    assert.equal(game.passMultiplier(b, pass.tile), POI.passDefense);
  }
});

test('órdenes: el ataque preparado espera y cuesta menos; el rápido avanza más deprisa', () => {
  const run = (mode) => {
    const { game, a, b } = twoNeighbors();
    a.attackMode = mode;
    a.troops = 30000;
    b.troops = 3000;
    game.launchAttack(a, b.id, 20000);
    const atk = a.attacks.get(b.id);
    const t0 = a.tiles;
    for (let i = 0; i < 20; i++) game.tick();
    return { atk, gained: a.tiles - t0 };
  };
  const prepared = run('preparado');
  assert.equal(prepared.atk.mode, 'preparado');
  assert.ok(prepared.gained <= 2, `el preparado aún no avanza a los 2 s (${prepared.gained})`);
  const fast = run('rapido');
  const normal = run('normal');
  assert.ok(fast.gained > normal.gained, `rápido ${fast.gained} > normal ${normal.gained}`);
});

test('defensa fortificada: cuesta más conquistarte y tiene espera para cambiar', () => {
  const { game, a, b } = twoNeighbors();
  const t = [...b.border][0];
  const before = game.tileCost(t, b).cost;
  assert.ok(game.setStance(b, true));
  assert.ok(game.tileCost(t, b).cost > before * 1.3);
  assert.equal(game.setStance(b, false), false, 'no se puede cambiar enseguida');
  game.ticks += CONFIG.stanceCooldownTicks;
  assert.ok(game.setStance(b, false));
  void a;
});

test('avance continuo: refuerza el ataque cada pocos segundos', () => {
  const { game, a, b } = twoNeighbors();
  a.troops = 40000;
  b.troops = 1e6; // que el ataque no acabe
  game.launchAttack(a, b.id, 1000);
  assert.ok(game.setAuto(a, b.id, true, 0.1));
  const before = a.troops;
  for (let i = 0; i < CONFIG.autoEveryTicks + 1; i++) game.tick();
  assert.ok(a.troops < before * 0.95, 'ha enviado refuerzos');
});

test('tecnologías: coste creciente, requisitos de rama y efecto al terminar', () => {
  const { game, a } = twoNeighbors();
  a.gold = 1e7;
  assert.equal(techAvailable(a, 'urbanismo').ok, false, 'el nivel 2 pide antes uno de nivel 1');
  const c1 = game.techCost(a);
  assert.ok(game.startResearch(a, 'agricultura'));
  assert.equal(game.startResearch(a, 'banca'), false, 'una a la vez');
  const growth0 = a.mods.growth;
  for (let i = 0; i <= game.techTime({ techs: new Set() }); i++) game.tick();
  assert.ok(a.techs.has('agricultura'));
  assert.ok(Math.abs(a.mods.growth - growth0 - TECHS.agricultura.mods.growth) < 1e-9);
  assert.ok(game.techCost(a) > c1, 'la siguiente cuesta más');
  assert.ok(techAvailable(a, 'urbanismo').ok, 'ya puede ir a nivel 2');
});

test('especialización: la primera gratis, cambiarla cuesta; afecta a los precios', () => {
  const { game, a } = twoNeighbors();
  a.gold = 0;
  const city0 = game.buildCost(a, 'city');
  assert.ok(game.setSpec(a, 'urbano'));
  assert.ok(game.buildCost(a, 'city') < city0, 'desarrollo urbano abarata las ciudades');
  assert.equal(game.setSpec(a, 'industria'), false, 'sin oro no se puede cambiar');
  a.gold = 1e6;
  assert.ok(game.setSpec(a, 'industria'));
  assert.ok(a.gold <= 1e6 - CONFIG.specChangeCost);
});

test('pacto de no agresión: impide atacarse hasta que vence; romperlo te hace traidor', () => {
  const { game, a, b } = twoNeighbors();
  assert.ok(game.makeOffer(a, b, 'pact'));
  assert.ok(game.respondOffer(b, a, 'pact', true));
  a.troops = 50000;
  assert.equal(game.launchAttack(a, b.id, 10000), false, 'con pacto no se ataca');
  game.ticks += CONFIG.pactTicks + 10;
  game._processOffers();
  assert.equal(game.pactBetween(a.id, b.id), null, 'vence');
  assert.ok(game.launchAttack(a, b.id, 10000));
  // Otro pacto y romperlo
  for (const atk of [...a.attacks.values()]) game._endAttack(atk);
  assert.ok(game.makeOffer(b, a, 'pact'));
  assert.ok(game.respondOffer(a, b, 'pact', true));
  assert.ok(game.breakPact(a, b));
  assert.ok(game.isTraitor(a));
});

test('paz con tributo: solo en guerra; para los ataques y paga el oro', () => {
  const { game, a, b } = twoNeighbors();
  assert.equal(game.canOffer(a, b, 'peace').ok, false, 'sin guerra no hay paz que ofrecer');
  a.troops = 50000;
  b.troops = 1e5;
  game.launchAttack(a, b.id, 10000);
  a.gold = 100000;
  assert.ok(game.makeOffer(a, b, 'peace', 0.25));
  const goldB = b.gold;
  assert.ok(game.respondOffer(b, a, 'peace', true));
  assert.equal(a.attacks.get(b.id)?.done ?? true, true, 'el ataque se detiene');
  assert.equal(b.gold - goldB, 25000);
  assert.equal(game.pactBetween(a.id, b.id).kind, 'peace');
});

test('victorias alternativas: capitales sostenidas y supervivencia por puntuación', () => {
  const caps = twoNeighbors(11, { victory: 'capitales' });
  const { game, a, b } = caps;
  assert.equal(game.rules.victory, 'capitales');
  game.setOwner(b.capitalTile, a.id);
  for (let i = 0; i < CONFIG.capitalHoldTicks + 5 && game.phase !== 'ended'; i++) game.tick();
  assert.equal(game.winner, a, 'controla todas las capitales el tiempo necesario');

  assert.equal(cleanRules({ victory: 'trampa' }).victory, 'dominio');
  const surv = twoNeighbors(11, { victory: 'supervivencia', timeLimitMin: 10 });
  const g2 = surv.game;
  surv.a.stats.kills = 50; // mejor puntuación
  g2.ticks = CONFIG.spawnTicks + 10 * 600 - 1;
  g2.tick();
  assert.equal(g2.phase, 'ended');
  assert.equal(g2.winner, surv.a);
});
