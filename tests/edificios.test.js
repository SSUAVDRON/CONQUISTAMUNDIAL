// Tests de la fase 2: oro y edificios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildNow, terminarObras } from './ayuda.js';
import { BUILDINGS, CONFIG, RES } from '../src/config.js';
import { MECH, PROFILES, regenPerTick } from '../src/mecanicas.js';

/** Partida con un humano ya desplegado en la mayor masa de tierra. */
function setup(seed = 21) {
  const map = generateMap(220 * RES, 130 * RES, seed);
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

test('oro: pasivo fijo (100 por tick), nada por expandirse y todo el oro del eliminado', () => {
  const { map, game, human } = setup();
  assert.equal(human.gold, CONFIG.startGold);
  for (let i = 0; i < 50; i++) game.tick();
  assert.ok(human.gold > 0, 'debería haber ganado oro');
  // Documento (04.1): no depende del territorio ni de las tropas
  human.mods.gold = 0;
  assert.equal(human.goldPerTick(), 100);
  human.tiles *= 10;
  human.troops *= 10;
  assert.equal(human.goldPerTick(), 100, 'más territorio o tropas no dan más oro');
  human.tiles /= 10;
  human.troops /= 10;

  // Expandirse por tierra libre no da oro
  game._refreshMods(human);
  human.troops = 5000;
  game.launchAttack(human, 0, 3000);
  const tiles0 = human.tiles;
  let expected = human.gold;
  for (let i = 0; i < 20; i++) {
    expected += human.goldPerTick();
    game.tick();
  }
  assert.ok(human.tiles > tiles0, 'se ha expandido');
  assert.ok(Math.abs(human.gold - expected) < 1e-6, `expandirse no da oro extra (${human.gold.toFixed(0)} frente a ${expected.toFixed(0)})`);

  // Conquistar casillas de otro no da oro; eliminarlo, todo el suyo (y un efecto donde cayó)
  const colony = game.addPlayer('Colonia de prueba', [200, 200, 200], false);
  colony.weak = true;
  const t = map.landTiles.find((x) => game.owner[x] === 0);
  game.setOwner(t, colony.id);
  colony.alive = true;
  colony.gold = 5000;
  const g0 = human.gold;
  game.setOwner(t, human.id);
  assert.equal(human.gold, g0, 'la casilla no trae oro');
  game._checkEliminations();
  assert.equal(colony.alive, false);
  assert.ok(Math.abs(human.gold - g0 - 5000) < 1e-6, 'se queda con todo su oro y nada más');
  const fx = game.effects.find((e) => e.kind === 'loot');
  assert.ok(fx && fx.owner === human.id && fx.x === map.x(t) + 0.5, 'efecto de botín en su última casilla');
});

test('tropas: techo y regeneración del documento; con trabajadores, la población se reparte al momento', async () => {
  const { MECH, maxTroopsFor, regenPerTick } = await import('../src/mecanicas.js');
  const { game, human } = setup();
  human.mods.cap = 0;
  human.mods.growth = 0;
  assert.equal(human.maxTroops(), maxTroopsFor(human.tiles, 0));
  const max = human.maxTroops();
  const at = (x) => {
    human.troops = max * x;
    return human.growthPerTick();
  };
  assert.ok(Math.abs(at(0.3) - regenPerTick(max * 0.3, max) * PROFILES.trinchera.paceRegen) < 1e-9);
  const g20 = at(0.2);
  const g42 = at(0.42);
  const g70 = at(0.7);
  const g95 = at(0.95);
  assert.ok(g42 > g20 && g42 > g70 && g70 > g95, `pico hacia el 42 %: ${g20.toFixed(1)} ${g42.toFixed(1)} ${g70.toFixed(1)} ${g95.toFixed(1)}`);
  assert.equal(at(1), 0, 'en el techo no crece');
  assert.equal(at(1.2), 0, 'por encima del techo tampoco (nunca negativo)');

  // Variante con trabajadores (sección 07): P = soldados + trabajadores
  const map = generateMap(220 * RES, 130 * RES, 21);
  const g = new Game({ map, seed: 21, rules: { economy: 'workers' } });
  const w = g.addPlayer('W', [0, 0, 255], true);
  g.start();
  g.spawnPlayer(w, g.findSpawnTile());
  while (g.phase === 'spawn') g.tick();
  assert.ok(Math.abs(w.troops / w.population() - CONFIG.soldierShare) < 0.01);
  const P = w.population();
  // Cambiar el reparto no crea ni destruye población y se aplica al momento
  g.setSoldierShare(w, 0.5);
  g._growPopulation(w);
  const grown = w.growthPerTick();
  assert.ok(Math.abs(w.workers - Math.round(w.population() * 0.5)) < 1);
  assert.ok(w.population() >= P && w.population() <= P + grown + regenPerTick(P, w.maxTroops()) + 1);
  // Oro: 100 + 1 por cada 100 trabajadores
  w.mods.gold = 0;
  w.workers = 20000;
  assert.equal(w.goldPerTick(), 100 + 200);
  assert.equal(MECH.workersPerGold, 100);
  // Valores fuera de rango se recortan
  g.setSoldierShare(w, 2);
  assert.equal(w.soldierShare, 1);
  g.setSoldierShare(w, -1);
  assert.equal(w.soldierShare, CONFIG.minSoldierShare);
});

test('reparto con trabajadores (TR02): 70/30 → 30/70 conserva la población y el ataque sale solo de los soldados', async () => {
  const { TROOP_SCALE } = await import('../src/format.js');
  const map = generateMap(220 * RES, 130 * RES, 21);
  const g = new Game({ map, seed: 21, rules: { economy: 'workers' } });
  const w = g.addPlayer('W', [0, 0, 255], true);
  const o = g.addPlayer('O', [255, 0, 0], false);
  g.start();
  g.spawnPlayer(w, g.findSpawnTile());
  g.spawnPlayer(o, g.findSpawnTile());
  while (g.phase === 'spawn') g.tick();
  g.bots.length = 0;
  w.regenMult = 0; // crecimiento cero: solo cuenta el reparto
  g.setSoldierShare(w, 0.7);
  g.tick();
  const P = w.population();
  assert.ok(Math.abs(w.troops - P * 0.7) <= 1);
  // Se aplica en el turno siguiente, sin crear ni perder población
  g.setSoldierShare(w, 0.3);
  assert.ok(Math.abs(w.troops - P * 0.7) <= 1, 'hasta el turno siguiente no cambia');
  g.tick();
  assert.ok(Math.abs(w.population() - P) < 1e-6, 'misma población');
  assert.ok(Math.abs(w.troops - P * 0.3) <= 1 && Math.abs(w.workers - P * 0.7) <= 1);
  // Un ataque al 20 % sale de los soldados, no de toda la población (en el
  // turno siguiente el reparto se vuelve a aplicar sobre la población que queda)
  const soldiers = w.troops;
  const workers = w.workers;
  const wild = [...map.landTiles].find((t) => g.owner[t] === 0 && g.hasLandBorder(w, 0, map.landBody[t]));
  if (wild !== undefined) {
    g._handleAttackIntent(w, wild, 0.2);
    const atk = w.attacks.get(0);
    assert.ok(atk, 'sale la expansión');
    assert.equal(atk.troops, Math.floor(soldiers * 0.2), 'el 20 % de los soldados');
    assert.equal(w.workers, workers, 'los trabajadores no van al frente');
  }
  // Equivalencia visible del oro: cada trabajador en pantalla ≈ 1 de oro por segundo
  w.mods.gold = 0;
  w.workers = 20000; // 2000 en pantalla
  const extraPerSecond = (w.goldPerTick() - w.baseGold()) * 10;
  assert.equal(extraPerSecond, w.workers / TROOP_SCALE);
});

test('reglas de construcción: territorio propio, oro, distancia y precios del documento', () => {
  const { map, game, human } = setup();
  const mine = ownTiles(game, human);
  const center = human.spawnTile;

  human.gold = 0;
  assert.equal(game.canBuild(human, 'city', center).ok, false, 'sin oro no se construye');

  human.gold = 1e7;
  const enemyOrWild = map.landTiles.find((t) => game.owner[t] !== human.id);
  assert.equal(game.canBuild(human, 'city', enemyOrWild).ok, false, 'fuera del territorio no');
  assert.equal(game.canBuild(human, 'port', center).ok, false, 'puerto tierra adentro no');

  human.mods.cityCost = 0;
  const goldBefore = human.gold;
  assert.equal(game.buildCost(human, 'city'), 125000);
  assert.ok(buildNow(game, human, 'city', center));
  assert.equal(human.gold, goldBefore - 125000);
  assert.equal(human.buildings.city, 1);
  assert.equal(game.buildCost(human, 'city'), 250000, 'la siguiente ciudad, el doble');
  assert.equal(game.buildCost(human, 'fort'), 50000, 'las demás familias no cambian');
  assert.equal(game.buildCost(human, 'sam'), 1500000);
  assert.equal(game.buildCost(human, 'missile'), 750000);
  assert.equal(game.buildCost(human, 'hbomb'), 5000000);
  assert.equal(game.buildCost(human, 'mirv'), 25000000);
  assert.equal(game.buildCost(human, 'silo'), 1000000);

  const neighbor = mine.find((t) => t !== center && Math.abs(map.x(t) - map.x(center)) + Math.abs(map.y(t) - map.y(center)) <= 2);
  assert.equal(game.canBuild(human, 'fort', neighbor).ok, false, 'demasiado cerca de otro edificio');
});

test('la ciudad sube el techo de tropas 250 000; el puerto no da oro por turno', () => {
  const { map, game, human } = setup();
  human.gold = 1e7;
  const maxBefore = human.maxTroops();
  assert.ok(buildNow(game, human, 'city', human.spawnTile));
  assert.ok(Math.abs(human.maxTroops() - maxBefore - 250000 * (1 + human.mods.cap)) < 1e-6);

  // Expandimos hasta tener costa y construimos un puerto
  for (let i = 0; i < 60 && !ownTiles(game, human).some((t) => map.coastal[t] && game.canBuild(human, 'port', t).ok); i++) {
    human.troops = 1e5;
    game.launchAttack(human, 0, 50000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  const coast = ownTiles(game, human).find((t) => map.coastal[t] && game.canBuild(human, 'port', t).ok);
  assert.ok(coast !== undefined, 'debería tener costa libre');
  const boatsBefore = human.maxBoats();
  const goldRate = human.goldPerTick();
  assert.ok(buildNow(game, human, 'port', coast));
  assert.equal(human.maxBoats(), boatsBefore, 'el límite de transportes es fijo');
  assert.equal(human.maxBoats(), CONFIG.maxBoats);
  assert.equal(human.goldPerTick(), goldRate, 'el puerto da oro con sus mercantes, no por turno');
});

test('el puerto se ajusta a la orilla propia más cercana al clic', () => {
  const { map, game, human } = setup();
  human.gold = 1e7;
  for (let i = 0; i < 60 && !ownTiles(game, human).some((t) => map.coastal[t] && game.canBuild(human, 'port', t).ok); i++) {
    human.troops = 1e5;
    game.launchAttack(human, 0, 50000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  const coast = ownTiles(game, human).find((t) => map.coastal[t] && game.canBuild(human, 'port', t).ok);
  assert.ok(coast !== undefined);
  // Clic en el agua junto a la costa
  const nb = [coast - 1, coast + 1, coast - map.width, coast + map.width];
  const water = nb.find((t) => !map.isLand(t));
  assert.equal(game.canBuild(human, 'port', water).ok, false, 'el agua no vale por sí sola');
  const snapped = game.snapBuildTile(human, 'port', water);
  assert.ok(map.coastal[snapped] && game.owner[snapped] === human.id);
  assert.ok(game.canBuild(human, 'port', snapped).ok);
  game.queueIntent({ type: 'build', playerId: human.id, kind: 'port', tile: water });
  game.tick();
  assert.equal(human.buildings.port, 1, 'el clic en el agua construye en la orilla');
  // Otros edificios no se mueven
  assert.equal(game.snapBuildTile(human, 'city', water), water);
});

test('el puesto defensivo multiplica el tiempo y las bajas de quien ataca alrededor', () => {
  const { map, game, human } = setup();
  const rival = game.addPlayer('Rival', [255, 0, 0], false);
  const t = human.spawnTile;
  const near = map.index(map.x(t) + 2, map.y(t));
  human.troops = 30000;
  const plain = game.conquestCost(near, human, 10000, 10, rival);
  human.gold = 1e6;
  assert.ok(buildNow(game, human, 'fort', t));
  const fort = game.conquestCost(near, human, 10000, 10, rival);
  assert.ok(Math.abs(fort.time - plain.time * CONFIG.fortDefenseMult) < 1e-9);
  assert.ok(Math.abs(fort.loss - plain.loss * CONFIG.fortDefenseMult) < 1e-9);
  const far = map.landTiles.find((x) => Math.hypot(map.x(x) - map.x(t), map.y(x) - map.y(t)) > CONFIG.fortRadius + 2);
  assert.equal(game.fortMultiplier(human, far), 1);
});

test('los edificios cambian de dueño con su casilla y el eliminado deja botín', () => {
  const { game, human } = setup();
  const rival = game.addPlayer('Rival', [255, 0, 0], false);
  human.gold = 1e6;
  assert.ok(buildNow(game, human, 'fort', human.spawnTile));
  human.gold = 777;
  const rivalGold = rival.gold;

  // El rival se queda con todas las casillas del humano (y su oro, casilla a casilla)
  for (const t of ownTiles(game, human)) game.setOwner(t, rival.id);
  assert.equal(human.buildings.fort, 0);
  assert.equal(rival.buildings.fort, 1);
  assert.ok(rival.forts.has(human.spawnTile));
  assert.equal(game.buildingAt.get(human.spawnTile).owner, rival.id);

  game.tick();
  assert.equal(human.alive, false);
  assert.ok(rival.gold >= rivalGold + 777 - 1e-6, 'el botín pasa al conquistador');
});

test('los bots construyen durante la partida', () => {
  const map = generateMap(220 * RES, 130 * RES, 3);
  // Con oro inicial: el ingreso fijo solo no da para un edificio en 4 min (sin
  // colonias que eliminar en este mapa de prueba)
  const game = new Game({ map, seed: 3, rules: { startGold: 500000 } });
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
  const map = generateMap(220 * RES, 130 * RES, 21);
  const game = new Game({ map, seed: 21, rules: { startGold: 600000, winShare: 0.5, missiles: false, warships: false } });
  const p = game.addPlayer('P', [0, 0, 0], true);
  game.addBots(3);
  game.start();
  assert.equal(p.gold, 600000);
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

test('las obras tardan: sin efecto hasta terminar; los antimisiles son lo que más tarda', () => {
  const { game, human } = setup();
  human.gold = 1e7;
  const maxBefore = human.maxTroops();
  assert.ok(game.build(human, 'city', human.spawnTile));
  assert.equal(human.buildings.city, 1, 'la obra ya cuenta como edificio');
  assert.equal(human.maxTroops(), maxBefore, 'pero aún no sube el techo');
  assert.equal(game.buildCost(human, 'city'), 250000, 'aunque ya cuenta para el precio');
  assert.ok(game.isBuilding(game.buildingAt.get(human.spawnTile)));
  for (let i = 0; i < BUILDINGS.city.build - 1; i++) game.tick();
  assert.equal(human.levels.city, 0, 'todavía en obras');
  game.tick();
  game.tick();
  assert.equal(human.levels.city, 1);
  assert.ok(Math.abs(human.maxTroops() - maxBefore - 250000 * (1 + human.mods.cap)) < 1e-6);
  const slowest = Math.max(...['city', 'port', 'fort', 'factory', 'silo', 'sam'].map((k) => BUILDINGS[k].build));
  assert.equal(BUILDINGS.sam.build, slowest);
});

test('subir de nivel: cuesta lo mismo que el siguiente de su tipo, tarda y suma su efecto; tope de nivel', () => {
  const { game, human } = setup();
  human.gold = 1e9;
  human.mods.cityCost = 0;
  const t = human.spawnTile;
  assert.ok(buildNow(game, human, 'city', t));
  const b = game.buildingAt.get(t);
  assert.equal(b.level, 1);
  const base = human.maxTroops();
  const check = game.canBuild(human, 'city', t);
  assert.ok(check.ok && check.upgrade === b, 'clic sobre la ciudad = mejora');
  assert.equal(game.upgradeCost(human, b), 250000, 'el nivel 2 cuesta como la segunda ciudad');
  assert.ok(game.build(human, 'city', t));
  assert.equal(b.target, 2);
  assert.equal(game.canBuild(human, 'city', t).ok, false, 'no se mejora dos veces a la vez');
  terminarObras(game);
  assert.equal(b.level, 2);
  assert.ok(Math.abs(human.maxTroops() - base - 250000 * (1 + human.mods.cap)) < 1e-6);
  assert.equal(game.upgradeCost(human, b), 500000, 'el nivel 3, como la tercera');
  while (b.level < CONFIG.maxLevel) assert.ok(buildNow(game, human, 'city', t));
  assert.equal(game.canBuild(human, 'city', t).ok, false, 'nivel máximo');
  assert.equal(human.levels.city, CONFIG.maxLevel);
  assert.equal(game.buildCost(human, 'city'), 1000000, 'tope de 1M');
});

test('colonias (los bots del documento): un tercio del techo, mitad de regeneración, 50 de oro y sin oro por casilla', () => {
  const map = generateMap(220 * RES, 130 * RES, 21);
  const game = new Game({ map, seed: 21 });
  const a = game.addPlayer('A', [255, 0, 0], true);
  game.addColonies(4);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const inland = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t] && game.owner[t] === 0);
  assert.ok(game.spawnPlayer(a, inland[Math.floor(inland.length / 3)]));
  while (game.phase === 'spawn') game.tick();
  const colonies = game.players.filter((p) => p && p.weak);
  assert.equal(colonies.length, 4);
  for (const c of colonies) {
    assert.match(c.name, /^(Colonia|Aldea|Asentamiento|Misión|Feudo|Puesto|Caserío|Factoría) de /);
    assert.ok(c.spawned, 'la colonia aparece en el mapa');
  }
  const c = colonies[0];
  c.tiles = a.tiles;
  c.mods.cap = a.mods.cap = 0;
  c.mods.gold = 0;
  assert.ok(Math.abs(c.maxTroops() - a.maxTroops() / 3) < 1e-6, 'un tercio del techo');
  c.troops = a.troops = 20000;
  c.mods.growth = a.mods.growth = 0;
  assert.ok(Math.abs(c.growthPerTick() - regenPerTick(20000, c.maxTroops()) * 0.5 * PROFILES.trinchera.paceRegen) < 1e-9, 'la mitad de regeneración');
  assert.equal(c.goldPerTick(), 50);
  assert.equal(game.canPropose(a, c).ok, false, 'las colonias no firman alianzas');
  // Conquistar una casilla de la colonia no trae oro
  c.gold = 1000;
  const t = game.owner.findIndex((o) => o === c.id);
  const before = a.gold;
  game.setOwner(t, a.id);
  assert.equal(a.gold, before);
  assert.equal(c.gold, 1000);
});

test('reglas personalizadas: cualquier oro inicial y número de colonias', async () => {
  const { cleanRules, GOLD_STEPS, CONFIG: C } = await import('../src/config.js');
  const r = cleanRules({ startGold: 1234567, colonies: 12 });
  assert.equal(r.startGold, 1234567);
  assert.equal(r.colonies, 12);
  assert.equal(cleanRules({}).colonies, null, 'por defecto, colonias automáticas');
  assert.equal(cleanRules({ startGold: -5 }).startGold, 0);
  assert.equal(cleanRules({ startGold: 1e12 }).startGold, GOLD_STEPS[GOLD_STEPS.length - 1]);
  assert.equal(cleanRules({ colonies: 9999 }).colonies, C.colonyMax);
  // La partida usa el oro inicial elegido
  const map = generateMap(160 * RES, 100 * RES, 3);
  const game = new Game({ map, seed: 3, rules: { startGold: 5000000 } });
  const p = game.addPlayer('P', [0, 0, 0], true);
  game.start();
  assert.equal(p.gold, 5000000);
});
