// Fichas de lo que da cada cosa (doc-1.7): cada edificio, mejora y bomba
// tiene su ficha con cifras de verdad, y los bonos activos se ven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { BUILDING_KINDS, RES } from '../src/config.js';
import { MECH } from '../src/mecanicas.js';
import { LUGARES } from '../src/lugares.js';
import { activeBonuses, buildingCard, shortEffect } from '../src/fichas.js';

function play() {
  const map = generateMap(220 * RES, 130 * RES, 9);
  const game = new Game({ map, seed: 9, rules: { profile: 'clasico' } });
  const h = game.addPlayer('Yo', [0, 0, 255], true);
  game.addColonies(3);
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  return { game, h };
}

const texts = (c) => [c.name, c.summary, c.have, c.how, ...c.gives.flatMap((g) => [g.label, g.value, g.note || '']), ...(c.next ? [c.next.title, ...c.next.rows.flatMap((r) => [r.label, r.from, r.to])] : [])];

test('fichas: todo lo de la barra tiene su ficha con qué da, cuánto cuesta y cómo se usa, sin cifras rotas', () => {
  const { game, h } = play();
  for (const kind of BUILDING_KINDS) {
    const c = buildingCard(game, h, kind);
    assert.ok(c.name && c.summary && c.how, `${kind}: nombre, resumen y uso`);
    assert.ok(c.gives.length >= 1, `${kind}: qué da`);
    assert.equal(c.cost, game.buildCost(h, kind));
    for (const t of texts(c)) assert.ok(!/NaN|undefined|Infinity/.test(String(t)), `${kind}: «${t}»`);
    assert.ok(shortEffect(game, h, kind).length > 0, `${kind}: línea corta`);
  }
});

test('fichas: las cifras son las de la partida (pueblo, ciudad) y la capital enseña su siguiente nivel', () => {
  const { game, h } = play();
  const v = buildingCard(game, h, 'village');
  assert.equal(v.gives[0].value, `+${Math.round(MECH.village.gold * h.goldMult * (1 + h.mods.gold) * 10)}/s`);
  const cap = buildingCard(game, h, 'capUp');
  assert.equal(cap.next.title, 'Nivel 0 → 1');
  assert.ok(cap.next.rows.some((r) => r.label === 'Banco de tropas'));
  h.capital.up = MECH.capital.maxLevel;
  const max = buildingCard(game, h, 'capUp');
  assert.ok(max.maxed && !max.next, 'al máximo, sin siguiente nivel');
  // Sin silo, la bomba avisa de que falta
  assert.ok(buildingCard(game, h, 'missile').haveWarn);
});

test('fichas: bonos activos de los lugares (con lo que les queda) y para siempre', () => {
  const { game, h } = play();
  assert.equal(activeBonuses(game, h).length, 0);
  h.buffs.push({ kind: 'granero', until: game.ticks + 300 });
  h.permMods = { gold: 0.04 };
  const list = activeBonuses(game, h);
  const buff = list.find((b) => b.id.startsWith('buff-granero'));
  assert.ok(buff && buff.left === 30 && buff.total === LUGARES.granero.ticks / 10);
  assert.ok(list.some((b) => b.id === 'perm-gold' && b.value === '+4 % oro'));
});
