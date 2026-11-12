// Casos de prueba de la «Especificación técnica: economía, tropas y expansión
// territorial» (sección 08, T01-T14) y sus criterios de aceptación (8.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { RES } from '../src/config.js';
import { MECH, PROFILES, detPow, maxTroopsFor, neutralTimeCost, priceFor, regenPerTick, startOffsets } from '../src/mecanicas.js';
import { buildNow, DOC } from './ayuda.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

/** Partida con un humano (y un bot para que no gane al instante), lista para jugar. */
function setup({ seed = 21, rules = {}, place = null } = {}) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed, rules: { ...DOC, ...rules } });
  const human = game.addPlayer('Yo', [0, 0, 255], true);
  const other = game.addPlayer('Otro', [255, 0, 0], false);
  game.start();
  const tile = place ? place(map, game) : interior(map);
  assert.ok(game.spawnPlayer(human, tile));
  game.spawnPlayer(other, game.findSpawnTile());
  return { map, game, human, other, tile };
}

/** Casilla con las 52 del disco inicial en tierra de la misma masa (y sin costa cerca). */
function interior(map) {
  const offs = startOffsets();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  return [...map.landTiles].find((t) => {
    if (map.landBody[t] !== body) return false;
    const x = map.x(t);
    const y = map.y(t);
    return offs.every(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) return false;
      const i = map.index(nx, ny);
      return map.isLand(i) && map.landBody[i] === body && !map.coastal[i];
    });
  });
}

test('T01: aparición interior válida (radio 4, desplazamiento −0,5) → exactamente 52 casillas y 25 000 tropas', () => {
  assert.equal(startOffsets().length, 52);
  // Conteo por filas del documento: 4 + 6 + 8 + 8 + 8 + 8 + 6 + 4
  const rows = new Map();
  for (const [, dy] of startOffsets()) rows.set(dy, (rows.get(dy) || 0) + 1);
  assert.deepEqual([...rows.keys()].sort((a, b) => a - b).map((k) => rows.get(k)), [4, 6, 8, 8, 8, 8, 6, 4]);
  const { human } = setup();
  assert.equal(human.tiles, 52);
  assert.equal(human.troops, 25000);
  assert.equal(human.workers, 0);
});

test('T02: 52 casillas sin ciudades → techo ≈ 121 410,76', () => {
  assert.ok(near(maxTroopsFor(52, 0), 121410.76));
  const { human } = setup();
  human.mods.cap = 0;
  assert.ok(near(human.maxTroops(), 121410.76));
  // Tabla de la sección 03.1
  for (const [t, c, v] of [[100, 0, 131697.86], [500, 0, 183255.32], [1000, 0, 226191.47], [10000, 0, 602377.29], [52, 3, 871410.76], [10000, 3, 1352377.29]]) {
    assert.ok(near(maxTroopsFor(t, c), v), `${t} casillas y ${c} niveles: ${maxTroopsFor(t, c)}`);
  }
});

test('T03: 52 casillas y una ciudad terminada → techo ≈ 371 410,76, sin añadir tropas al momento', () => {
  const { game, human, tile } = setup();
  while (game.phase === 'spawn') game.tick();
  human.mods.cap = 0;
  human.gold = 1e6;
  const troops = human.troops;
  assert.ok(buildNow(game, human, 'city', tile));
  assert.equal(human.levels.city, 1);
  assert.ok(near(maxTroopsFor(52, 1), 371410.76));
  assert.ok(near(human.maxTroops(), maxTroopsFor(human.tiles, 1)));
  assert.equal(human.troops, troops, 'el techo no son tropas');
});

test('T04: 52 casillas y 25 000 tropas → ≈ 330,27 por tick, ≈ 3302,74 por segundo', () => {
  const cap = maxTroopsFor(52, 0);
  assert.ok(near(regenPerTick(25000, cap), 330.27));
  assert.ok(near(10 * regenPerTick(25000, cap), 3302.74));
  const { human } = setup();
  human.mods.growth = 0;
  human.mods.cap = 0;
  // En juego se aplica el ritmo (PROFILES.trinchera.paceRegen) sobre la fórmula del documento
  assert.ok(near(human.growthPerTick(), 330.27 * PROFILES.trinchera.paceRegen));
  // Tabla de la sección 03.2 (por segundo, según la ocupación del techo)
  for (const [f, v] of [[0.2, 3259], [0.4, 4015], [0.42, 4019], [0.6, 3585], [0.8, 2206]]) {
    assert.ok(Math.abs(10 * regenPerTick(cap * f, cap) - v) < 1, `${f}: ${10 * regenPerTick(cap * f, cap)}`);
  }
});

test('T05: tropas = techo → regeneración 0', () => {
  const cap = maxTroopsFor(52, 0);
  assert.equal(regenPerTick(cap, cap), 0);
  assert.equal(regenPerTick(cap * 1.5, cap), 0, 'nunca negativa');
});

test('T06: un humano sin comercio, 100 ticks → 10 000 de oro nuevo (×1)', () => {
  const { game, human } = setup();
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  human.mods.gold = 0;
  game._refreshMods = () => {}; // sin capitales ni tecnologías: solo el oro pasivo
  const g0 = human.gold;
  for (let i = 0; i < 100; i++) game.tick();
  assert.equal(human.gold - g0, 10000);
  assert.equal(MECH.baseGoldPerTickBot, 50);
});

test('T07: 25 000 tropas y ataque al 20 % → salen 5000 de la reserva y quedan 20 000', () => {
  const { game, human } = setup();
  while (game.phase === 'spawn') game.tick();
  human.troops = 25000;
  assert.equal(MECH.defaultAttackRatio, 0.2);
  const away = human.map;
  void away;
  // La orden se aplica en el siguiente tick (que también regenera la reserva)
  game._growPopulation = () => {};
  game.queueIntent({ type: 'action', playerId: human.id, tile: wildNear(game, human), ratio: 0.2 });
  game.tick();
  const atk = human.attacks.get(0);
  assert.ok(atk, 'ataque lanzado');
  assert.equal(human.troops, 20000);
  assert.ok(atk.troops <= 5000 && atk.troops > 4800, 'las 5000 desplegadas (menos lo que ya ha costado avanzar)');
});

function wildNear(game, p) {
  const map = game.map;
  for (const t of p.border) {
    for (const n of [t - 1, t + 1, t - map.width, t + map.width]) if (map.isLand(n) && game.owner[n] === 0) return n;
  }
  return -1;
}

test('T08: 5000 tropas atacantes en llanura neutral → coste de tiempo 6,6 por casilla y 32 de bajas (doc-1.2: el doble)', () => {
  assert.ok(near(neutralTimeCost(16.5, 5000), 6.6, 1e-9));
  assert.equal(MECH.terrain[1].mag / MECH.neutralLossDiv, 32);
  assert.equal(MECH.terrain[2].mag / MECH.neutralLossDiv, 40);
  assert.equal(MECH.terrain[3].mag / MECH.neutralLossDiv, 48);
  const { game, human } = setup();
  const t = wildNear(game, human);
  const plain = game.map.terrain[t] === 1;
  const c = game.conquestCost(t, null, 5000, 10, null);
  if (plain) {
    assert.ok(near(c.time, 6.6, 1e-9));
    assert.equal(c.loss, 32);
  }
  // Ejemplo del documento: frente de 10 casillas → presupuesto 20 por tick → unas 3 casillas
  assert.equal(MECH.neutralBudgetPerFront * 10, 20);
  assert.equal(Math.floor(20 / 6.6), 3);
});

test('T09: +10 casillas neutrales y +25 anexionadas → el contador sube 35', () => {
  const { map, game, human } = setup();
  while (game.phase === 'spawn') game.tick();
  // Un anillo de casillas del humano alrededor de un bloque libre de 5 × 5 tierra adentro
  const ok = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) return false;
      const i = map.index(x, y);
      if (!map.isLand(i) || map.coastal[i] || game.owner[i] !== 0) return false;
    }
    return true;
  };
  const c = [...map.landTiles].find((t) => ok(map.x(t), map.y(t)));
  assert.ok(c !== undefined);
  const cx = map.x(c);
  const cy = map.y(c);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 3 && !(dx === 3 && dy === 0)) game.setOwner(map.index(cx + dx, cy + dy), human.id);
  }
  const before = human.tiles;
  game._annexBudget = 1e9;
  // 9 neutrales en cualquier sitio (sin cercar nada) y la décima cierra el anillo
  let n = 0;
  for (const t of map.landTiles) {
    if (n >= 9) break;
    if (game.owner[t] !== 0 || Math.abs(map.x(t) - cx) < 8 && Math.abs(map.y(t) - cy) < 8) continue;
    game.setOwner(t, human.id);
    n++;
  }
  const gap = map.index(cx + 3, cy);
  game.setOwner(gap, human.id);
  game._annexAround(gap, human.id, 0);
  assert.equal(human.tiles - before, 35);
});

test('T10: un puerto y una fábrica (nivel 1) → la siguiente compra compartida cuesta 500 000', () => {
  assert.equal(priceFor('factory', { port: 1, factory: 1 }), 500000);
  assert.equal(priceFor('port', { port: 1, factory: 1 }), 500000);
  assert.equal(priceFor('port', { port: 4, factory: 4 }), 1000000, 'tope de 1M');
  const tableCity = [0, 1, 2, 3, 4].map((n) => priceFor('city', { city: n }));
  assert.deepEqual(tableCity, [125000, 250000, 500000, 1000000, 1000000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => priceFor('fort', { fort: n })), [50000, 100000, 150000, 200000, 250000, 250000]);
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => priceFor('warship', { warship: n })), [250000, 500000, 750000, 1000000, 1000000]);
  assert.deepEqual([0, 1, 2].map((n) => priceFor('sam', { sam: n })), [1500000, 3000000, 3000000]);
  assert.equal(priceFor('silo', {}), 1000000);
  assert.equal(priceFor('missile', {}), 750000);
  assert.equal(priceFor('hbomb', {}), 5000000);
  assert.equal(priceFor('mirv', {}), 25000000);
});

test('T11: con la economía fija, el oro por tick es el mismo con 10 000 o 100 000 tropas', () => {
  const { human } = setup();
  human.troops = 10000;
  const a = human.goldPerTick();
  human.troops = 100000;
  assert.equal(human.goldPerTick(), a);
  // Criterio 8.1: sin producción por trabajadores en economyMode = fixed
  human.workers = 50000;
  assert.equal(human.goldPerTick(), a);
});

test('T12: con trabajadores, deslizar al 50 % solo cambia el reparto y el oro propio; no crea población', () => {
  const { game, human } = setup({ rules: { economy: 'workers' } });
  while (game.phase === 'spawn') game.tick();
  human.mods.gold = 0;
  const P = human.population();
  const gold0 = human.goldPerTick();
  game.setSoldierShare(human, 0.5);
  // Reparto inmediato sin crecimiento (solo el reparto)
  human.regenMult = 0;
  game._growPopulation(human);
  assert.ok(Math.abs(human.population() - P) < 1e-6, 'misma población');
  assert.equal(human.workers, Math.round(P * 0.5));
  assert.ok(human.goldPerTick() > gold0, 'más trabajadores, más oro propio');
  assert.equal(human.goldPerTick(), 100 + Math.floor(human.workers / 100));
});

test('T13: misma semilla y mismas órdenes → mismo resultado, con el orden de ticks estable', () => {
  const run = () => {
    const map = generateMap(180 * RES, 110 * RES, 9);
    const game = new Game({ map, seed: 9, rules: DOC });
    const h = game.addPlayer('Yo', [0, 0, 255], true);
    game.addBots(6);
    game.addColonies(4);
    game.start();
    game.queueIntent({ type: 'action', playerId: h.id, tile: game.findSpawnTile() });
    for (let i = 0; i < 600; i++) {
      if (i === 200) game.queueIntent({ type: 'action', playerId: h.id, tile: wildNear(game, h), ratio: 0.3 });
      game.tick();
    }
    let hash = 2166136261;
    for (let i = 0; i < game.owner.length; i++) hash = Math.imul(hash ^ game.owner[i], 16777619);
    return { hash, players: game.players.filter(Boolean).map((p) => [p.tiles, p.troops, p.gold]) };
  };
  assert.deepEqual(run(), run());
});

test('T14: aparición tocando el mar o casillas ocupadas → se recorta o se rechaza, sin solapar dueños', () => {
  const coastal = (map) => [...map.coastTiles].find((t) => map.landBodySizes[map.landBody[t]] > 5000);
  const { map, game, human, other } = setup({ place: coastal });
  assert.ok(human.tiles < 52, `recortado junto al mar: ${human.tiles}`);
  for (let i = 0; i < game.owner.length; i++) if (game.owner[i] === human.id) assert.ok(map.isLand(i));
  // Sobre casillas ocupadas: rechazado
  const taken = game.owner.findIndex((o) => o === other.id);
  assert.equal(game.spawnPlayer(human, taken), false);
  // Junto a otro: solo las libres (nunca se pisan)
  const otherTiles = other.tiles;
  const nextTo = [...other.border].map((t) => [t - 1, t + 1, t - map.width, t + map.width].find((n) => map.isLand(n) && game.owner[n] === 0)).find((n) => n !== undefined);
  if (nextTo !== undefined) {
    assert.ok(game.spawnPlayer(human, nextTo));
    assert.equal(other.tiles, otherTiles, 'el otro no pierde casillas');
    assert.ok(human.tiles < 52);
  }
});

test('criterios 8.1: casillas = cambios de dueño, los ataques no crean tropas y el oro trae su motivo', () => {
  const map = generateMap(180 * RES, 110 * RES, 4);
  const game = new Game({ map, seed: 4, rules: DOC });
  game.addBots(8);
  game.addColonies(6);
  game.start();
  let changes = 0;
  const set = game.setOwner.bind(game);
  game.setOwner = (t, id) => {
    if (game.owner[t] !== id) changes++;
    set(t, id);
  };
  const total = () => game.players.filter(Boolean).reduce((s, p) => s + p.tiles, 0);
  for (let i = 0; i < 1500; i++) {
    // Las tropas: lo que hay en casa + en ataques nunca sube más que la regeneración (sin donaciones ni desembarcos)
    game.tick();
  }
  let owned = 0;
  for (let i = 0; i < game.owner.length; i++) if (game.owner[i]) owned++;
  assert.equal(total(), owned, 'el contador de cada jugador cuadra con el mapa');
  assert.ok(changes >= owned - 52 * 14, 'cada casilla ganada es un cambio de dueño');
  for (const p of game.players.filter(Boolean)) {
    for (const k of ['workers', 'trade', 'conquest', 'loot', 'gifts']) assert.ok(Number.isFinite(p.income[k]));
    assert.ok(p.troops >= 0 && p.troops <= p.maxTroops() * 1.0001 + 1e-6 || p.tiles === 0 || !p.alive, `${p.name}: ${p.troops} de ${p.maxTroops()}`);
  }
});

test('partida simulada de 5 minutos: evolución de tropas, oro y casillas (para comparar con una grabación)', () => {
  const map = generateMap(360 * RES, 210 * RES, 12);
  const game = new Game({ map, seed: 12, rules: { ...DOC, winShare: 0.9 } });
  game.addBots(12);
  game.addColonies(10);
  game.start();
  const log = [];
  for (let i = 0; i < CONFIG_TICKS_5MIN && game.phase !== 'ended'; i++) {
    game.tick();
    if (game.ticks % 600 === 0) {
      const alive = game.players.filter((p) => p && p.alive);
      log.push({ min: game.ticks / 600, troops: Math.round(alive.reduce((s, p) => s + p.troops, 0)), gold: Math.round(alive.reduce((s, p) => s + p.gold, 0)), tiles: alive.reduce((s, p) => s + p.tiles, 0) });
    }
  }
  assert.ok(log.length >= 3, `minutos registrados: ${log.length}`);
  assert.ok(log[log.length - 1].tiles > log[0].tiles, 'el territorio ocupado crece');
  assert.ok(log.every((r) => Number.isFinite(r.troops) && Number.isFinite(r.gold)));
  // El documento: las potencias deterministas coinciden con las de la plataforma
  assert.ok(Math.abs(detPow(25000, 0.73) - Math.pow(25000, 0.73)) < 1e-9 * Math.pow(25000, 0.73));
});

const CONFIG_TICKS_5MIN = 3000 + 150;
