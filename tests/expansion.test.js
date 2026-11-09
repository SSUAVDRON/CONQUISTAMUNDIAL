// Tests de la expansión por tierra libre: hacia el clic y según las tropas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { RES } from '../src/config.js';
import { MECH } from '../src/mecanicas.js';

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
  const gained = expand(game, a, focus, 5000);
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
  // Documento (05.1): cada casilla libre cuesta magnitud / 5 tropas (16 en llanura, más en altura)
  const plainLoss = MECH.terrain[1].mag / MECH.neutralLossDiv;
  assert.equal(plainLoss, 16);
  assert.ok(few <= 300 / plainLoss + 1, `${few} casillas con 300 tropas`);
  assert.ok(many <= 1500 / plainLoss + 1);
});

test('HUD (TR03): reserva y próximo envío salen del mismo turno y cuadran tras un ataque al 20 % con caída brusca', async () => {
  const { hudSnapshot, TROOP_SCALE } = await import('../src/format.js');
  const map = generateMap(220 * RES, 130 * RES, 5);
  const game = new Game({ map, seed: 5 });
  const h = game.addPlayer('Yo', [0, 0, 255], true);
  game.human = h;
  game.addPlayer('Otro', [255, 0, 0], false);
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  game.spawnPlayer(game.players[2], game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  const visible = (n) => Math.floor(n / TROOP_SCALE);
  let prev = hudSnapshot(h.troops, 0.2);
  for (let i = 0; i < 30; i++) {
    if (i === 3) game.queueIntent({ type: 'action', playerId: h.id, tile: [...map.landTiles].find((t) => game.owner[t] === 0 && game.hasLandBorder(h, 0, map.landBody[t])), ratio: 0.2 });
    game.tick();
    const s = hudSnapshot(h.troops, 0.2);
    // Mismo turno, misma fuente: el envío es el 20 % de la reserva que se ve
    assert.equal(s.envio, Math.floor(s.reserva * 0.2));
    assert.ok(Math.abs(visible(s.envio) - Math.floor(visible(s.reserva) * 0.2)) <= 1, `turno ${i}: ${visible(s.reserva)} → ${visible(s.envio)}`);
    if (i === 3) assert.ok(s.reserva < prev.reserva, 'la reserva cae de golpe al enviar');
    prev = s;
  }
});
