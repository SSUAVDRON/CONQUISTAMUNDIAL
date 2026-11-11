// Toques con el dedo (src/toque.js): a dónde va la orden de un toque impreciso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { RES } from '../src/config.js';
import { attackableByLand, nearestTileOf, resolveTap } from '../src/toque.js';

/**
 * En una zona de interior: A en un bloque, B pegado a su derecha, C más a la
 * derecha separado por tierra libre (sin frontera con A) y D aliado de A abajo.
 */
function setup() {
  const map = generateMap(240 * RES, 140 * RES, 5);
  const game = new Game({ map, seed: 5, rules: { winShare: 0.9 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 0, 255], false);
  const c = game.addPlayer('C', [0, 200, 0], false);
  const d = game.addPlayer('D', [200, 200, 0], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const open = (t) => {
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -10; dx <= 30; dx++) {
        const x = map.x(t) + dx;
        const y = map.y(t) + dy;
        if (!map.inBounds(x, y)) return false;
        const u = map.index(x, y);
        if (!map.isLand(u) || map.landBody[u] !== body || map.coastal[u]) return false;
      }
    }
    return true;
  };
  const o = [...map.landTiles].find(open);
  assert.ok(o !== undefined, 'zona de interior');
  const ox = map.x(o);
  const oy = map.y(o);
  const at = (dx, dy) => map.index(ox + dx, oy + dy);
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 0; dx++) game.setOwner(at(dx, dy), a.id); // A: x ≤ 0
    for (let dx = 1; dx <= 6; dx++) game.setOwner(at(dx, dy), b.id); // B: 1..6
    for (let dx = 12; dx <= 18; dx++) game.setOwner(at(dx, dy), c.id); // C: 12..18 (tierra libre en medio)
  }
  for (let dy = 7; dy <= 10; dy++) for (let dx = -6; dx <= 0; dx++) game.setOwner(at(dx, dy), d.id); // D: debajo de A
  a.allies.add(d.id);
  d.allies.add(a.id);
  return { map, game, a, b, c, d, at };
}

test('un toque que ya cae en algo atacable por tierra se queda donde está', () => {
  const { game, a, b, at } = setup();
  assert.equal(resolveTap(game, a, at(3, 0), 5), at(3, 0));
  assert.equal(game.owner[at(3, 0)], b.id);
  // Tierra libre junto a A (por arriba): también vale tal cual
  assert.ok(attackableByLand(game, a, at(-3, -7)));
  assert.equal(resolveTap(game, a, at(-3, -7), 5), at(-3, -7));
});

test('tocando tu propio territorio junto a la frontera, va al vecino más cercano', () => {
  const { game, a, b, at } = setup();
  const t = resolveTap(game, a, at(-1, 2), 4);
  assert.equal(game.owner[t], b.id);
  assert.equal(t, at(1, 2), 'la casilla de B más cercana');
  // Sin tolerancia, nada que hacer: se queda en tu casilla (y la orden no hará nada)
  assert.equal(resolveTap(game, a, at(-1, 2), 0), at(-1, 2));
});

test('un país sin frontera contigo (barco): solo se desvía a un país con frontera muy cerca', () => {
  const { game, a, b, c, at } = setup();
  assert.ok(!attackableByLand(game, a, at(12, 0)), 'C no tiene frontera con A');
  // La tierra libre entre B y C sí se puede atacar (A toca tierra libre): se queda
  assert.equal(resolveTap(game, a, at(9, 0), 6), at(9, 0));
  // En el borde de C, con B a 6 casillas y medio radio de 7: va a B (el dedo se pasó)
  const t = resolveTap(game, a, at(12, 0), 14);
  assert.equal(game.owner[t], b.id);
  assert.equal(t, at(6, 0));
  // Con menos radio no llega a B, y nunca se desvía a la tierra libre de al lado: barco a C
  assert.equal(resolveTap(game, a, at(12, 0), 6), at(12, 0));
  assert.equal(resolveTap(game, a, at(15, 0), 6), at(15, 0));
  assert.equal(game.owner[at(15, 0)], c.id);
});

test('nunca apunta a un aliado ni a lo tuyo', () => {
  const { game, a, d, at } = setup();
  assert.ok(!attackableByLand(game, a, at(-3, 8)), 'D es aliado');
  const t = resolveTap(game, a, at(-3, 8), 6);
  assert.ok(game.owner[t] !== a.id && game.owner[t] !== d.id, `dueño ${game.owner[t]}`);
});

test('nearestTileOf: la casilla del país más cercana a un punto', () => {
  const { map, game, b, at } = setup();
  const t = nearestTileOf(game, b.id, map.x(at(-4, 0)) + 0.5, map.y(at(-4, 0)) + 0.5, 10);
  assert.equal(t, at(1, 0));
  assert.equal(nearestTileOf(game, b.id, map.x(at(-4, 0)), map.y(at(-4, 0)), 2), -1);
});
