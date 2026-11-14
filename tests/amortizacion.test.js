// DEV09: información para elegir una inversión. La ficha del pueblo da una
// amortización orientativa con el mismo oro que paga el motor (y la obra
// aparte), la de la capital separa oro, banco y murallas, y al terminar una
// obra el aviso dice qué ha cambiado del ingreso y del techo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES, TICK_MS } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { buildingCard, minSec } from '../src/fichas.js';
import { casillaPara, terminarObras } from './ayuda.js';

function playing(seed = 31) {
  const map = generateMap(160 * RES, 100 * RES, seed);
  const game = new Game({ map, seed });
  const h = game.addPlayer('Tú', [40, 120, 255], true);
  game.human = h;
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  return { game, h };
}

test('amortización: el pueblo de 40k y +300/s se paga en ~133 s de funcionar, más su obra', () => {
  const { game, h } = playing();
  // El ejemplo de la auditoría: sin bonos, 40k ÷ 300/s
  const bonus = h.mods.gold;
  h.mods.gold = 0;
  const plain = buildingCard(game, h, 'village');
  assert.equal(plain.cost, 40000);
  assert.equal(Math.round(plain.goldPerSec), 300);
  assert.equal(Math.round(plain.payback.seconds), 133);
  assert.equal(minSec(plain.payback.seconds), '2 min 13 s');
  // Con los bonos efectivos (la capital da oro desde el nivel 0), algo menos
  h.mods.gold = bonus;
  const card = buildingCard(game, h, 'village');
  assert.ok(card.payback, 'tiene amortización');
  assert.equal(card.goldPerSec, 300 * (1 + bonus) * h.goldMult);
  assert.equal(card.payback.seconds, card.cost / card.goldPerSec);
  assert.equal(card.payback.withBuild, card.payback.seconds + (card.time * TICK_MS) / 1000);
  // El oro de la ficha es el que da el motor: un pueblo terminado sube el
  // oro pasivo exactamente eso
  const before = h.goldPerTick();
  h.gold = 1e6;
  assert.ok(game.build(h, 'village', casillaPara(game, h, 'village')));
  terminarObras(game);
  assert.equal(Math.round((h.goldPerTick() - before) * (1000 / TICK_MS)), Math.round(card.goldPerSec));
});

test('amortización: sin ingreso directo no hay cifra; la capital separa oro, banco y murallas', () => {
  const { game, h } = playing(32);
  for (const kind of ['fort', 'sam', 'silo']) assert.equal(buildingCard(game, h, kind).payback, undefined, kind);
  const cap = buildingCard(game, h, 'capUp');
  assert.deepEqual(cap.gives.slice(0, 3).map((g) => g.label), ['Oro pasivo', 'Banco de tropas', 'Murallas']);
  assert.ok(cap.payback && cap.payback.seconds > 0, 'la mejora de la capital se amortiza por su oro');
  assert.match(cap.payback.note, /banco y las murallas son aparte/);
});

test('obra terminada: el aviso dice qué cambia del oro y del techo, con las cifras del motor', () => {
  const { game, h } = playing(33);
  const events = [];
  game.onEvent = (e) => events.push(e.text);
  h.gold = 1e6;
  assert.ok(game.build(h, 'village', casillaPara(game, h, 'village')));
  terminarObras(game);
  const done = events.find((t) => /^Pueblo terminado/.test(t));
  assert.ok(done, events.join(' | '));
  assert.match(done, new RegExp(`\\+${Math.round(300 * (1 + h.mods.gold) * h.goldMult)}/s de oro`));
  assert.match(done, /de techo/);
  // La mejora de la capital: oro y banco
  events.length = 0;
  h.troops = h.maxTroops();
  assert.ok(game.build(h, 'capUp', -1), 'empieza la mejora');
  h.capital.work.end = game.ticks;
  game._updateSites();
  const cap = events.find((t) => /Capital a nivel 1/.test(t));
  assert.ok(cap, events.join(' | '));
  assert.match(cap, /\/s de oro/);
  assert.match(cap, /de banco/);
});
