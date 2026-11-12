// doc-1.2: tierra libre al doble de bajas, más tropas = más rápido (también
// contra países), colonias rápidas y baratas y crecimiento algo más cuadrado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';
import { MECH, neutralTimeCost, pvpSpeedRatio, pvpTile } from '../src/mecanicas.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** Una nación en el interior de la mayor masa de tierra (con sitio libre alrededor), ya en juego. */
function solo(seed = 5, R = 18 * RES) {
  const map = generateMap(240 * RES, 140 * RES, seed);
  const game = new Game({ map, seed, rules: { winShare: 0.9 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  game.addPlayer('B', [0, 0, 255], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const open = (t) => {
    const x = map.x(t);
    const y = map.y(t);
    for (let dy = -R; dy <= R; dy += 3) {
      for (let dx = -R; dx <= R; dx += 3) {
        if (!map.inBounds(x + dx, y + dy)) return false;
        const u = map.index(x + dx, y + dy);
        if (!map.isLand(u) || map.landBody[u] !== body || map.coastal[u]) return false;
      }
    }
    return true;
  };
  const ta = [...map.landTiles].filter((t) => map.landBody[t] === body).find(open);
  assert.ok(ta !== undefined && game.spawnPlayer(a, ta), 'sitio para empezar');
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { map, game, a, ta };
}

test('tierra libre: por encima de ~6.600 tropas más tropas siguen acelerando (raíz, hasta un suelo)', () => {
  // Por debajo, como el documento (2000 × coste ÷ tropas)
  assert.ok(near(neutralTimeCost(16.5, 5000), 6.6));
  assert.ok(near(neutralTimeCost(16.5, 6600), 5));
  // Por encima: 4 veces las tropas → el doble de rápido; suelo en 1,25 (×4)
  assert.ok(near(neutralTimeCost(16.5, 26400), 2.5));
  assert.equal(neutralTimeCost(16.5, 105600), MECH.neutralTimeFloor);
  assert.equal(neutralTimeCost(16.5, 1e7), MECH.neutralTimeFloor);
  let prev = Infinity;
  for (const troops of [200, 1000, 5000, 6600, 10000, 30000, 80000, 200000]) {
    const t = neutralTimeCost(16.5, troops);
    assert.ok(t <= prev, `${troops} tropas no van más lentas que menos tropas`);
    prev = t;
  }
});

test('tierra libre: un ejército grande gana más casillas por turno que uno de 6.600', () => {
  const run = (troops) => {
    const { map, game, a } = solo(5);
    const before = a.tiles;
    a.troops = troops * 2;
    game.launchAttack(a, 0, troops);
    for (let i = 0; i < 25; i++) game.tick();
    return a.tiles - before;
  };
  const mid = run(6600);
  const big = run(40000);
  assert.ok(big > mid * 1.6, `${mid} casillas con 6.600 frente a ${big} con 40.000 en 2,5 s`);
});

test('tierra libre al doble de bajas; las colonias pagan menos y su ritmo no depende de su población', () => {
  const { map, game, a } = solo(5);
  const colony = game.addPlayer('Colonia', [0, 200, 0], false);
  colony.weak = true;
  const plain = [...map.landTiles].find((t) => map.terrain[t] === 1 && game.owner[t] === 0);
  const nation = game.conquestCost(plain, null, 5000, 10, a);
  const col = game.conquestCost(plain, null, 5000, 10, colony);
  assert.equal(nation.loss, 32);
  assert.ok(near(col.loss, 32 * MECH.colonyNeutralLoss));
  // Con pocas tropas, la colonia avanza como una nación con un envío normal
  const poor = game.conquestCost(plain, null, 800, 10, colony);
  const ref = game.conquestCost(plain, null, MECH.colonyRefTroops, 10, a);
  assert.ok(near(poor.time, ref.time / MECH.colonyNeutralSpeed));
  assert.ok(near(col.time, ref.time / MECH.colonyNeutralSpeed));
  assert.ok(col.time < nation.time);
  // Cada colonia lleva su ritmo propio
  colony.pace = 1.25;
  assert.ok(near(game.conquestCost(plain, null, 800, 10, colony).time, poor.time / 1.25));
  // La estimación del aviso usa las mismas bajas
  assert.equal(game.estimateAttack(a, 0, 3200).tiles, 100);
  assert.equal(game.estimateAttack(colony, 0, 3200).tiles, Math.floor(3200 / (32 * MECH.colonyNeutralLoss)));
});

test('cada colonia es algo distinta (ritmo y forma), sin gastar el azar de la partida', async () => {
  const { ColonyBrain } = await import('../src/bot.js');
  const { game } = solo(7);
  const twin = solo(7).game;
  const paces = new Set();
  for (let i = 0; i < 6; i++) {
    const c = game.addPlayer(`C${i}`, [0, 120, 0], false);
    c.weak = true;
    new ColonyBrain(game, c);
    assert.ok(c.pace >= 0.8 && c.pace <= 1.3, `ritmo ${c.pace}`);
    assert.ok(c.growNoise > 0);
    paces.add(c.pace.toFixed(3));
  }
  assert.ok(paces.size >= 5, 'ritmos distintos');
  // El azar de la partida sigue igual que en una gemela sin colonias nuevas
  assert.equal(game.rng.float(), twin.rng.float());
});

test('contra países: más de 1,22× las tropas del defensor sigue acelerando, hasta ×3', () => {
  const P = MECH.pvp;
  assert.equal(pvpSpeedRatio(P.speedMin), P.speedMin);
  assert.equal(pvpSpeedRatio(2), 2);
  assert.equal(pvpSpeedRatio(100), P.speedMax);
  assert.ok(near(pvpSpeedRatio(0.25), P.speedMin * Math.sqrt(0.25 / P.speedMin)));
  assert.equal(pvpSpeedRatio(0.001), P.speedMin / P.speedBoostMax);
  // Mismo defensor: 1,5× sus tropas frente a 4× y 20×
  const t15 = pvpTile(10000, 15000, 500, 10).perFront;
  const t4 = pvpTile(10000, 40000, 500, 10).perFront;
  const t20 = pvpTile(10000, 200000, 500, 10).perFront;
  assert.ok(t4 < t15 && t20 < t4, `${t15} > ${t4} > ${t20}`);
  assert.ok(near(pvpTile(10000, 1e9, 500, 10).perFront * P.speedBoostMax, pvpTile(10000, 10000 / P.speedMin, 500, 10).perFront, 1e-12));
  // Las bajas por casilla no cambian por mandar más (mismo tope de ratio)
  assert.equal(pvpTile(10000, 40000, 500, 10).attackerLossPerMag, pvpTile(10000, 200000, 500, 10).attackerLossPerMag);
});

test('el crecimiento en tierra libre es algo más cuadrado que un círculo', () => {
  const fill = (square) => {
    const keep = CONFIG.growSquare;
    CONFIG.growSquare = square;
    try {
      const { map, game, a } = solo(11);
      for (let i = 0; i < 2; i++) {
        a.troops = 1e5;
        game.launchAttack(a, 0, 15000);
        for (let k = 0; k < 150; k++) game.tick();
      }
      const mine = [...map.landTiles].filter((t) => game.owner[t] === a.id);
      const xs = mine.map((t) => map.x(t));
      const ys = mine.map((t) => map.y(t));
      return mine.length / ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1));
    } finally {
      CONFIG.growSquare = keep;
    }
  };
  const circle = fill(0);
  const now = fill(CONFIG.growSquare);
  // Un círculo llena ~78 % de su caja; un cuadrado, el 100 %
  assert.ok(now > circle + 0.04, `relleno de la caja: ${circle.toFixed(3)} (círculo) frente a ${now.toFixed(3)}`);
  assert.ok(now < 0.95, `sigue con las esquinas redondeadas: ${now.toFixed(3)}`);
});
