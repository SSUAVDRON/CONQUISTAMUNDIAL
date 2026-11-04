// Tests de la expansión por tierra libre: hacia el clic y según las tropas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';

/** Una sola nación en mitad de la mayor masa de tierra, ya en juego. */
function solo(seed = 5) {
  const map = generateMap(240 * RES, 140 * RES, seed);
  const game = new Game({ map, seed, rules: { winShare: 0.9 } });
  const a = game.addPlayer('A', [255, 0, 0], true);
  game.addPlayer('B', [0, 0, 255], false); // un segundo jugador para que no gane al instante
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const land = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  // Una casilla con tierra libre de sobra a su derecha
  const ta = land.find((t) => [10, 25, 40, 55].every((d) => map.isLand(t + d * RES) && map.landBody[t + d * RES] === body) && map.x(t) < map.width / 2);
  assert.ok(ta !== undefined && game.spawnPlayer(a, ta));
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { map, game, a, ta };
}

/** Ataca tierra libre hacia `focus` con `troops` y devuelve las casillas ganadas. */
function expand(game, a, focus, troops) {
  const before = new Set([...game.map.landTiles].filter((t) => game.owner[t] === a.id));
  a.troops = troops + 10;
  game.queueIntent({ type: 'action', playerId: a.id, tile: focus, ratio: troops / a.troops });
  game.tick(); // la orden se aplica en el siguiente turno
  assert.ok(a.attacks.size > 0, 'el clic lanza la expansión');
  for (let i = 0; i < 600 && a.attacks.size; i++) game.tick();
  return [...game.map.landTiles].filter((t) => game.owner[t] === a.id && !before.has(t));
}

test('la expansión avanza hacia el punto del clic', () => {
  const { map, game, a, ta } = solo();
  const focus = ta + 50 * RES; // a la derecha
  const gained = expand(game, a, focus, 1500);
  assert.ok(gained.length > 50, `gana casillas: ${gained.length}`);
  const cx = gained.reduce((s, t) => s + map.x(t), 0) / gained.length;
  // Sesgo suave (crece en todas direcciones, algo más hacia el clic)
  assert.ok(cx > map.x(ta) + 2 * RES, `lo ganado queda hacia el clic (x media ${cx.toFixed(0)} frente a ${map.x(ta)})`);
});

test('con pocas tropas se expande poco y con muchas, mucho más', () => {
  const small = solo();
  const big = solo();
  const focus = small.ta + 40 * RES;
  const few = expand(small.game, small.a, focus, 300).length;
  const many = expand(big.game, big.a, focus, 1500).length;
  assert.ok(many > few * 3, `${few} casillas con 300 tropas frente a ${many} con 1500`);
  // Cada casilla libre cuesta tropas: lo conquistado va con lo enviado
  assert.ok(few <= 300 / CONFIG.wildTileCost + 1);
});
