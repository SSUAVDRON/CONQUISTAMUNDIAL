// Emojis de partida: el catálogo (de serie, por nivel, por gestas y en la
// tienda), los que tienes según tu perfil, que la partida acepte todos los del
// catálogo y nada más, y que las reacciones de la IA no cambien la partida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_CHARS, EMOJI_ITEMS } from '../src/emojis.js';
import { ACHIEVEMENTS, buyItem, defaultProfile, isUnlocked, itemKey, ownedEmojis } from '../src/profile.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';

test('emojis: catálogo sin repetir, con su forma de conseguirse', () => {
  const ids = new Set();
  for (const it of EMOJI_ITEMS) {
    assert.ok(!ids.has(it.id), `${it.id} repetido`);
    ids.add(it.id);
    assert.equal(it.cat, 'emoji');
    assert.ok(it.e && it.name, `${it.id} sin emoji o sin nombre`);
    if (it.unlock && it.unlock.ach) assert.ok(ACHIEVEMENTS.some((a) => a.id === it.unlock.ach), `${it.id}: la gesta ${it.unlock.ach} no existe`);
  }
  assert.equal(EMOJI_CHARS.size, EMOJI_ITEMS.length, 'cada emoji, una vez');
  assert.equal(EMOJI_ITEMS.filter((x) => !x.unlock).length, 10, 'diez de serie');
  assert.ok(EMOJI_ITEMS.filter((x) => x.unlock && x.unlock.price).length >= 10, 'unos cuantos en la tienda');
});

test('emojis: los tuyos crecen con el nivel y con lo que compras', () => {
  const p = defaultProfile();
  const base = ownedEmojis(p).map((x) => x.id);
  assert.equal(base.length, 10);
  // Nivel 4: el saludo (2) y la chulería (4), aún no el susto (8)
  p.xp = 60 * 3 ** 2;
  const lvl = ownedEmojis(p).map((x) => x.id);
  assert.ok(lvl.includes('saludo') && lvl.includes('chulo') && !lvl.includes('susto'));
  // Comprar el dragón (300) con monedas
  const dragon = EMOJI_ITEMS.find((x) => x.id === 'dragon');
  p.monedas = 299;
  assert.equal(buyItem(p, dragon), false, 'sin monedas suficientes');
  p.monedas = 500;
  assert.ok(buyItem(p, dragon));
  assert.equal(p.monedas, 200);
  assert.ok(Object.hasOwn(p.comprados, itemKey(dragon)));
  assert.ok(isUnlocked(p, dragon));
  assert.ok(ownedEmojis(p).some((x) => x.e === '🐉'));
  assert.equal(buyItem(p, dragon), false, 'no se compra dos veces');
});

/** Una nación humana (A) y una de la IA (B), ya en juego. */
function partida(seed = 21) {
  const map = generateMap(200 * RES, 120 * RES, seed);
  const game = new Game({ map, seed });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 200, 0], false);
  game.addBots(4);
  game.start();
  for (let i = 0; i < 400 && game.phase !== 'playing'; i++) game.tick();
  return { game, a, b };
}

test('emojis: la partida acepta los del catálogo (también los comprados) y nada más', () => {
  const { game, a, b } = partida();
  assert.ok(game.sendEmoji(a, b.id, '🐉'), 'uno de la tienda');
  for (let i = 0; i < CONFIG.emojiCooldownTicks; i++) game.tick();
  assert.equal(game.sendEmoji(a, 0, '🦄'), false, 'uno que no está en el catálogo');
  assert.equal(game.sendEmoji(a, 0, '<b>'), false);
  assert.ok(game.sendEmoji(a, 0, '🏴‍☠️'), 'a todos, con varias partes');
  assert.equal(game.emojis.at(-1).to, 0);
});

test('emojis: las reacciones de la IA no gastan el azar y tienen su espera', () => {
  const g1 = partida(33);
  const g2 = partida(33);
  // La misma reacción en la misma partida sale igual (y no toca el azar)
  const r1 = g1.game._botEmote(g1.b, ['😠', '⚔️', '🔥'], g1.a.id, 1);
  const r2 = g2.game._botEmote(g2.b, ['😠', '⚔️', '🔥'], g2.a.id, 1);
  assert.equal(r1, true);
  assert.equal(r1, r2);
  assert.deepEqual(g1.game.emojis, g2.game.emojis);
  assert.equal(g1.game.rng.float(), partida(33).game.rng.float(), 'el azar sigue donde estaba');
  // Espera: otra enseguida no sale; tampoco de otra nación de la IA en el mismo instante
  assert.equal(g1.game._botEmote(g1.b, '😎', 0, 1), false);
  const otro = g1.game.players.find((p) => p && p.alive && !p.isHuman && !p.weak && p !== g1.b);
  assert.equal(g1.game._botEmote(otro, '😎', 0, 1), false, 'como mucho una cada 2 s entre todas');
  for (let i = 0; i < 30; i++) g1.game.tick();
  assert.ok(g1.game._botEmote(otro, '😎', 0, 1), 'pasados 2 s, otra nación sí');
  // Las personas no reaccionan solas
  assert.equal(g1.game._botEmote(g1.a, '😎', 0, 1), false);
});
