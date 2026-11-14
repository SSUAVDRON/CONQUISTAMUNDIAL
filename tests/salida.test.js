// DEV03: salidas informadas. La zona inicial efectiva y sus recortes (costa,
// río, ocupación), el terreno, el sitio libre y el rival cercano; y una
// recomendación que se repite con la misma semilla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES } from '../src/config.js';
import { generateMap, loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { describeSpawn } from '../src/salida.js';

function makeGame(seed, real = false) {
  const map = real ? loadRealMap('europa').map : generateMap(220 * RES, 140 * RES, seed);
  const game = new Game({ map, seed });
  const human = game.addPlayer('Tú', [40, 120, 255], true);
  game.addBots(8);
  game.addColonies(10);
  game.start();
  return { game, human };
}

/** Primera casilla de tierra libre que cumpla `fn(tile)`. */
function findTile(game, fn) {
  const m = game.map;
  for (const t of m.landTiles) if (game.owner[t] === 0 && game.spawnCheck(game.human, t).ok && fn(t)) return t;
  return -1;
}

test('salida: la misma semilla da la misma recomendación, con la zona inicial entera', () => {
  const a = makeGame(4242);
  const b = makeGame(4242);
  const ra = a.game.recommendSpawn(a.human);
  const rb = b.game.recommendSpawn(b.human);
  assert.ok(ra.tile >= 0);
  assert.equal(ra.tile, rb.tile, 'determinista');
  assert.equal(ra.info.zone.length, ra.info.full, 'prioriza una zona inicial completa');
  // No gasta el azar de la partida: las dos siguen igual después
  for (let i = 0; i < 50; i++) {
    a.game.tick();
    b.game.tick();
  }
  assert.equal(a.game.rng.float(), b.game.rng.float());
  // Otra semilla, otra recomendación (casi siempre)
  const c = makeGame(777);
  assert.ok(c.game.recommendSpawn(c.human).tile >= 0);
});

test('salida: recortes por costa, ocupación y río, terreno y rival cercano', () => {
  const { game, human } = makeGame(99);
  const m = game.map;
  const near = (t, pred, r = 3 * RES) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = m.x(t) + dx;
      const y = m.y(t) + dy;
      if (m.inBounds(x, y) && pred(m.index(x, y))) return true;
    }
    return false;
  };
  // Costa: agua del mar al lado
  const coast = findTile(game, (t) => near(t, (i) => !m.isLand(i) && !(m.river && m.river[i]), 2));
  assert.ok(coast >= 0);
  const ci = game.spawnInfo(human, coast);
  assert.ok(ci.cut.costa > 0, 'recorte por costa');
  assert.equal(ci.zone.length + ci.cut.costa + ci.cut.rio + ci.cut.ocupada + ci.cut.otra, ci.full, 'todas las casillas de la zona, contadas');
  // Ocupación: junto a una nación ya colocada
  const nation = game.players.find((p) => p && !p.isHuman && !p.weak && p.spawned);
  const busy = findTile(game, (t) => near(t, (i) => game.owner[i] === nation.id, 2));
  if (busy >= 0) {
    const bi = game.spawnInfo(human, busy);
    assert.ok(bi.cut.ocupada > 0, 'recorte por tierra ocupada');
    assert.ok(bi.rival && bi.rival.tiles < 10 * RES, 'la nación cercana sale como rival');
    assert.ok(describeSpawn(bi).warn, 'una salida recortada se avisa');
  }
  // Río (si el mapa tiene)
  if (m.river && m.river.some(Boolean)) {
    const riv = findTile(game, (t) => near(t, (i) => !m.isLand(i) && m.river[i], 2));
    if (riv >= 0) assert.ok(game.spawnInfo(human, riv).cut.rio > 0, 'recorte por río');
  }
  // Montaña: el terreno de la zona lo dice
  const hill = findTile(game, (t) => m.terrain[t] === 3);
  if (hill >= 0) assert.ok(game.spawnInfo(human, hill).terrain[2] > 0, 'montaña en la zona');
  // Agua o isla demasiado pequeña: no se puede empezar
  const water = m.size - 1 - [...m.terrain].reverse().findIndex((v) => v === 0);
  assert.equal(game.spawnInfo(human, water), null);
});

test('salida: la elegida se describe igual (tus casillas cuentan como libres) y el texto no tiene huecos', () => {
  const { game, human } = makeGame(1234);
  const rec = game.recommendSpawn(human);
  game.spawnPlayer(human, rec.tile);
  const mine = game.spawnInfo(human, rec.tile);
  assert.ok(mine, 'tu propia salida se puede describir');
  assert.equal(mine.zone.length, rec.info.zone.length);
  const d = describeSpawn(mine);
  for (const v of [d.zone, d.free, d.rival, d.line]) assert.ok(v && !/undefined|null|NaN/.test(v), v);
});
