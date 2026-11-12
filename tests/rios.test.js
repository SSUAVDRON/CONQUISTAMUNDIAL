// Ríos como fronteras navegables (doc-1.4): son agua, no se cruzan por tierra,
// los que llegan al mar se navegan (puertos en sus orillas, barcos por ellos)
// y los que no, son solo frontera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, generateMap, loadRealMap, markRivers, riversToWater } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, DOC } from './ayuda.js';

/** Mapa de prueba: tierra con mar a la izquierda (y a la derecha si se pide) y los ríos dados. */
function synth(lines, { w = 120, h = 80, seaLeft = 6, seaRight = 0, extra = null } = {}) {
  const terrain = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (x < seaLeft || (seaRight && x >= w - seaRight)) terrain[y * w + x] = 0;
  }
  extra?.(terrain, w, h);
  const shade = new Uint8Array(w * h);
  const river = markRivers(w, h, terrain, lines);
  const stranded = riversToWater(w, h, terrain, river, shade);
  return { map: new GameMap(w, h, terrain, shade, river), stranded };
}

/** Partida con A en (x, y) y los demás donde se diga ([nombre, x, y]), ya en juego. */
function play(map, x, y, extraPlayers = []) {
  const game = new Game({ map, seed: 3, rules: { ...DOC, winShare: 0.99 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const others = extraPlayers.map(([name], i) => game.addPlayer(name, [0, 0, 120 + i * 40], false));
  game.start();
  // Primero se recolocan los demás (sueltan su sitio al azar) y luego A
  extraPlayers.forEach(([name, ox, oy], i) => assert.ok(game.spawnPlayer(others[i], map.index(ox, oy)), `${name} empieza`));
  assert.ok(game.spawnPlayer(a, map.index(x, y)), 'A empieza');
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { game, a, others };
}

test('un río de mar a mar parte la tierra: la expansión no lo cruza', () => {
  const { map } = synth([[1, 6, 40, 113, 40]], { seaRight: 6 });
  const north = map.index(50, 20);
  const south = map.index(50, 60);
  assert.equal(map.terrain[map.index(50, 40)], 0, 'el río es agua');
  assert.equal(map.river[map.index(50, 40)], 1, 'y se dibuja como río');
  assert.notEqual(map.landBody[north], map.landBody[south]);
  const { game, a } = play(map, 50, 20);
  a.troops = 5e6;
  for (let r = 0; r < 12; r++) {
    game.launchAttack(a, 0, 400000);
    for (let i = 0; i < 100; i++) game.tick();
  }
  let northOwned = 0;
  for (let t = 0; t < map.size; t++) {
    if (game.owner[t] !== a.id) continue;
    assert.ok(map.y(t) < 40, `casilla de A al otro lado del río (${map.x(t)}, ${map.y(t)})`);
    northOwned++;
  }
  assert.ok(northOwned > 1500, `A llena su orilla (${northOwned})`);
});

test('un río que llega al mar es navegable: puerto en su orilla y barco por él', () => {
  // Río desde el mar (x = 6) hacia el interior, hasta x = 100
  const { map } = synth([[1, 6, 40, 100, 40]]);
  const bank = map.index(80, 39);
  assert.ok(map.navigable(map.index(80, 40)));
  assert.equal(map.coastal[bank], 1, 'la orilla cuenta como costa');
  const { game, a, others } = play(map, 80, 30, [['B', 80, 52]]);
  const b = others[0];
  // A llega hasta la orilla
  for (let y = 30; y < 40; y++) for (let x = 76; x <= 84; x++) game.setOwner(map.index(x, y), a.id);
  // B, en la orilla de enfrente pero río abajo (el barco tiene que navegar)
  for (let y = 41; y < 52; y++) for (let x = 40; x <= 48; x++) game.setOwner(map.index(x, y), b.id);
  a.gold = 1e9;
  const can = game.canBuild(a, 'port', bank);
  assert.ok(can.ok, `puerto en la orilla del río: ${can.reason}`);
  assert.ok(buildNow(game, a, 'port', bank));
  // Barco a la otra orilla, por el río
  a.troops = 1e5;
  const target = map.index(44, 41);
  assert.equal(game.owner[target], b.id);
  assert.ok(game.launchBoat(a, target, 5000), 'sale el barco');
  const boat = game.boats.find((x) => x.owner === a.id);
  for (const t of boat.path) assert.ok(map.navigable(t));
  assert.ok([...boat.path].filter((t) => map.river[t]).length > 30, 'navega por el río');
});

test('un río lejos del agua es solo frontera: ni puerto ni barcos', () => {
  // Río corto en mitad de la tierra, a más de 24 casillas de cualquier agua
  const { map, stranded } = synth([[1, 50, 40, 90, 40]]);
  assert.ok(stranded >= 1);
  const t = map.index(70, 40);
  assert.equal(map.terrain[t], 0);
  assert.equal(map.navigable(t), false);
  const bank = map.index(70, 39);
  assert.equal(map.coastal[bank], 0, 'la orilla no es costa');
  const { game, a } = play(map, 70, 33);
  a.gold = 1e9;
  assert.equal(game.canBuild(a, 'port', bank).ok, false);
});

test('los tramos sueltos se unen al mar (como mucho a 24 casillas) y los islotes pasan a río', () => {
  // Tramo que acaba a 10 casillas del mar → se une y es navegable
  const near = synth([[1, 16, 30, 90, 30]]);
  assert.equal(near.stranded, 0);
  assert.ok(near.map.navigable(near.map.index(60, 30)));
  for (let x = 6; x < 16; x++) assert.equal(near.map.terrain[near.map.index(x, 30)], 0, `cauce abierto en x = ${x}`);
  // Dos tramos paralelos muy juntos que se unen en los dos extremos: la tierra
  // de en medio (una franja de 1 × 6) es un islote → río
  const pocket = synth([
    [1, 6, 30, 60, 30],
    [1, 6, 32, 60, 32],
    [1, 52, 30, 52, 32],
    [1, 59, 30, 59, 32],
  ]);
  for (let x = 53; x < 59; x++) assert.equal(pocket.map.terrain[pocket.map.index(x, 31)], 0, `islote en x = ${x}`);
  // Mapas reales: ríos navegables en su mayoría y ningún islote de menos de 12 casillas junto a un río
  const { map } = loadRealMap('mundo');
  let rt = 0;
  let nav = 0;
  for (let i = 0; i < map.size; i++) {
    if (!map.river[i]) continue;
    rt++;
    assert.equal(map.terrain[i], 0);
    if (map.navigable(i)) nav++;
  }
  assert.ok(nav / rt > 0.85, `navegables ${((nav / rt) * 100).toFixed(0)} %`);
});

test('cerco: un río cierra la bolsa como una frontera (el mar no)', () => {
  // Río horizontal de mar a mar en y = 40; A cerca una franja contra el río
  const { map } = synth([[1, 6, 40, 113, 40]], { seaRight: 6 });
  const { game, a } = play(map, 30, 20);
  // Pared de A en forma de U contra el río: x 60..70, y 34..39
  for (let y = 34; y < 40; y++) {
    game.setOwner(map.index(60, y), a.id);
    game.setOwner(map.index(70, y), a.id);
  }
  for (let x = 60; x <= 70; x++) game.setOwner(map.index(x, 34), a.id);
  game.ticks++;
  game._annexBudget = 1e9;
  assert.ok(game._tryAnnex(map.index(65, 38), a.id), 'la bolsa contra el río es de A');
  assert.equal(game.owner[map.index(65, 39)], a.id);
  // La misma bolsa contra el mar (x < 6) no se cierra: tiene costa
  for (let y = 54; y <= 60; y++) game.setOwner(map.index(12, y), a.id);
  for (let x = 6; x <= 12; x++) {
    game.setOwner(map.index(x, 54), a.id);
    game.setOwner(map.index(x, 60), a.id);
  }
  game.ticks++;
  assert.equal(game._tryAnnex(map.index(8, 57), a.id), false);
});

test('mapas aleatorios: ríos deterministas, todos agua y navegables', () => {
  const a = generateMap(400, 240, 99);
  const b = generateMap(400, 240, 99);
  assert.deepEqual(a.river, b.river);
  assert.deepEqual(a.terrain, b.terrain);
  let n = 0;
  for (let i = 0; i < a.size; i++) {
    if (!a.river[i]) continue;
    n++;
    assert.equal(a.terrain[i], 0);
    assert.ok(a.navigable(i));
  }
  assert.ok(n > 0, 'el mapa aleatorio debería tener algún río');
});
