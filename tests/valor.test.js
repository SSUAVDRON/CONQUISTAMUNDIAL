// Clasificación de la partida por valor económico: el oro más lo que valen
// los edificios terminados (al precio de su escalera), los buques y las
// mejoras de la capital. Solo lee: no cambia la partida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { priceFor } from '../src/mecanicas.js';
import { buildNow, casillaPara, fundarCapitales } from './ayuda.js';

function playing(seed = 41) {
  const map = generateMap(160 * RES, 100 * RES, seed);
  const game = new Game({ map, seed });
  const h = game.addPlayer('Tú', [40, 120, 255], true);
  game.human = h;
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  fundarCapitales(game);
  return { game, h };
}

test('valor económico: oro + edificios terminados a precio de escalera', () => {
  const { game, h } = playing();
  h.gold = 5e6;
  assert.equal(game.economicValue(h), 5e6, 'sin edificios, solo el oro');
  const v1 = game.economicValue(h);
  const t = casillaPara(game, h, 'village');
  assert.ok(t >= 0 && buildNow(game, h, 'village', t));
  const paid = 5e6 - h.gold;
  // Lo que pagó por el pueblo vuelve como valor: el total no baja al construir
  assert.equal(Math.round(game.economicValue(h)), Math.round(h.gold + priceFor('village', {}) * game.rules.priceMult));
  assert.equal(Math.round(game.economicValue(h)), Math.round(v1 - paid + paid), 'construir no resta valor');
});

test('valor económico: no cambia la partida (solo lectura)', () => {
  const { game, h } = playing(43);
  h.gold = 1e6;
  const before = JSON.stringify([h.gold, h.tiles, game.ticks, game.rng.state ?? null]);
  for (let i = 0; i < 5; i++) game.economicValue(h);
  assert.equal(JSON.stringify([h.gold, h.tiles, game.ticks, game.rng.state ?? null]), before);
});
