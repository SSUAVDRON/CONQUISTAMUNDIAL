// Tests de las mejoras estratégicas: puntos estratégicos, órdenes militares,
// tecnologías, especialización, diplomacia ampliada y victorias alternativas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES, cleanRules } from '../src/config.js';
import { POI, placePoints } from '../src/estrategia.js';
import { TECHS, techAvailable } from '../src/tecnologias.js';
import { DOC } from './ayuda.js';

/** Dos naciones pegadas (A humana y B bot sin cerebro activo), ya en juego. */
function twoNeighbors(seed = 11, rules = null, { third = false } = {}) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed, rules: { ...DOC, ...rules } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  // Un tercero lejos, para que la partida no acabe si cae B
  const c = third ? game.addPlayer('C', [0, 0, 255], false) : null;
  game.human = a;
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  assert.ok(game.spawnPlayer(a, ta));
  const tb = tiles.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return game.owner[t] === 0 && d2 > 18 ** 2 && d2 < 22 ** 2; // en casillas: el avance va por casillas (documento), no se escala con RES
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

test('sin órdenes de ataque: ni modos, ni defensa fortificada, ni avance continuo', () => {
  const { game, a } = twoNeighbors();
  for (const it of ['mode', 'stance', 'auto']) game.queueIntent({ type: it, playerId: a.id, mode: 'rapido', on: true, targetId: 0 });
  game.tick();
  assert.equal(a.attackMode, undefined);
  assert.equal(a.fortified, undefined);
  assert.equal(game.setStance, undefined);
  assert.equal(game.setAuto, undefined);
});

test('retirada (documento, 05.3): a los 20 ticks y, contra otro país, se pierde el 25 %', () => {
  const { game, a, b } = twoNeighbors();
  a.troops = 30000;
  a.regenMult = 0; // sin regenerar, para medir exacto
  b.troops = 1e6; // que el ataque no acabe solo
  game.launchAttack(a, b.id, 10000);
  const atk = a.attacks.get(b.id);
  game.queueIntent({ type: 'cancelAttack', playerId: a.id, targetId: b.id });
  game.tick();
  assert.ok(atk.retreatAt > 0 && !atk.done, 'la retirada no es inmediata');
  const left = atk.troops;
  const home = a.troops;
  for (let i = 0; i < 25 && !atk.done; i++) game.tick();
  assert.ok(atk.done, 'a los ~2 s vuelven');
  assert.ok(Math.abs(a.troops - home - left * 0.75) < 1e-6, 'vuelve el 75 %');
  // Contra tierra libre, sin pérdida
  const solo = twoNeighbors();
  solo.a.troops = 20000;
  solo.a.regenMult = 0;
  if (solo.game.hasWildNeighbor(solo.a)) {
    solo.game.launchAttack(solo.a, 0, 5000);
    const w = solo.a.attacks.get(0);
    solo.game.retreat(w);
    const before = solo.a.troops + w.troops;
    for (let i = 0; i < 25 && !w.done; i++) solo.game.tick();
    assert.ok(w.done && Math.abs(solo.a.troops - before) < 1e-6, 'de tierra libre vuelven todas');
  }
});

test('retirada (TR01): 4000 en el frente → 3000 contra un país vivo, 4000 en tierra libre o si el rival cae; una sola vez', async () => {
  const { MECH } = await import('../src/mecanicas.js');
  /** Ataque de 4000 internas con la reserva congelada; devuelve lo que vuelve y en cuántos turnos. */
  const run = ({ neutral = false, killRival = false, twice = false } = {}) => {
    const { game, a, b } = twoNeighbors(11, null, { third: killRival });
    a.regenMult = 0;
    a.troops = 50000;
    b.troops = 1e6;
    const target = neutral ? 0 : b.id;
    if (neutral && !game.hasWildNeighbor(a)) return null;
    assert.ok(game.launchAttack(a, target, 4000));
    const atk = a.attacks.get(target);
    const home = a.troops;
    assert.equal(atk.troops, 4000);
    // El aviso, la tarjeta y el motor usan el mismo cálculo
    const o = game.retreatOutcome(atk);
    assert.equal(o.refund, neutral ? 4000 : 4000 * (1 - MECH.retreatPenalty));
    assert.ok(game.retreat(atk));
    if (twice) assert.equal(game.retreat(atk), false, 'la segunda orden no hace nada');
    let ticks = 0;
    while (!atk.done && ticks < 40) {
      if (killRival && ticks === 5) for (let t = 0; t < game.map.size; t++) if (game.owner[t] === b.id) game.setOwner(t, 0);
      game.tick();
      ticks++;
    }
    assert.ok(atk.done);
    return { back: a.troops - home, ticks };
  };
  const pvp = run();
  assert.equal(pvp.back, 3000, 'contra un país vivo vuelve el 75 %');
  assert.equal(pvp.ticks, MECH.retreatTicks, `a los ${MECH.retreatTicks} turnos`);
  const wild = run({ neutral: true });
  if (wild) assert.equal(wild.back, 4000, 'de tierra libre vuelven todas');
  assert.equal(run({ killRival: true }).back, 4000, 'si el rival cae durante la espera, vuelven todas');
  assert.equal(run({ twice: true }).back, 3000, 'dos órdenes, un solo reembolso');
  // Un refuerzo antes del plazo cancela la retirada y el frente sigue
  const { game, a, b } = twoNeighbors();
  a.regenMult = 0;
  a.troops = 50000;
  b.troops = 1e6;
  game.launchAttack(a, b.id, 4000);
  const atk = a.attacks.get(b.id);
  game.retreat(atk);
  for (let i = 0; i < 5; i++) game.tick();
  game.launchAttack(a, b.id, 1000);
  assert.equal(atk.retreatAt, 0, 'el refuerzo cancela la retirada');
  for (let i = 0; i < MECH.retreatTicks + 5; i++) game.tick();
  assert.ok(!atk.done || atk.troops < 1, 'sigue atacando (o se agotó luchando), no se retiró');
});

test('cerco (documento, 05.3): una bolsa sin costa rodeada por el atacante se anexiona al momento', () => {
  const { map, game, a, b } = twoNeighbors();
  // Un anillo de A rodeando un bloque de 5×5 de B tierra adentro
  const land = [...map.landTiles].filter((t) => !map.coastal[t]);
  const ok = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!map.inBounds(cx + dx, cy + dy) || !map.isLand(map.index(cx + dx, cy + dy)) || map.coastal[map.index(cx + dx, cy + dy)]) return false;
    }
    return true;
  };
  const c = land.find((t) => ok(map.x(t), map.y(t)));
  assert.ok(c !== undefined);
  const cx = map.x(c);
  const cy = map.y(c);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const t = map.index(cx + dx, cy + dy);
    game.setOwner(t, Math.max(Math.abs(dx), Math.abs(dy)) === 3 ? a.id : b.id);
  }
  // Abrimos un hueco en el anillo con una casilla de B y la conquistamos: el bloque queda cercado
  const gap = map.index(cx + 3, cy);
  game.setOwner(gap, b.id);
  const tilesA = a.tiles;
  game._annexBudget = 1e9;
  game.setOwner(gap, a.id);
  game._annexAround(gap, a.id, b.id);
  assert.equal(game.owner[c], a.id, 'el centro de la bolsa es de A');
  assert.equal(a.tiles, tilesA + 1 + 25, 'conquista 1 y anexiona las 25 de dentro');
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
