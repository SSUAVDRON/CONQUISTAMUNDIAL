// Colores de las naciones: paleta amplia y reparto según las vecinas (dos
// naciones pegadas no salen casi iguales), sin azar y sin tocar la simulación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATION_PALETTE, assignNationColors, deltaE, rgbToLab, territoryRgb } from '../src/colors.js';
import { loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';

const seen = (c) => rgbToLab(territoryRgb(c));

test('colores: paleta de 108 colores distintos', () => {
  assert.equal(NATION_PALETTE.length, 108);
  const labs = NATION_PALETTE.map(seen);
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) assert.ok(deltaE(labs[i], labs[j]) > 2, `${i} y ${j} casi iguales`);
});

test('colores: en una rejilla de naciones, las vecinas se distinguen bien; sin azar; lejos del color del jugador', () => {
  const nations = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) nations.push({ id: nations.length + 1, x: x * 10, y: y * 10 });
  const fixed = [[47, 125, 255]];
  const a = assignNationColors(nations, fixed, 25);
  const b = assignNationColors(nations, fixed, 25);
  assert.deepEqual([...a], [...b], 'mismo resultado siempre');
  let worst = Infinity;
  for (const n of nations) {
    for (const m of nations) {
      if (m.id <= n.id || Math.hypot(n.x - m.x, n.y - m.y) > 10.5) continue;
      worst = Math.min(worst, deltaE(seen(a.get(n.id)), seen(a.get(m.id))));
    }
  }
  assert.ok(worst >= 25, `dos vecinas pegadas se parecen demasiado (ΔE ${worst.toFixed(1)})`);
  const mine = seen(fixed[0]);
  for (const c of a.values()) assert.ok(deltaE(seen(c), mine) >= 10, 'una nación casi del color del jugador');
});

test('colores: en Europa, las naciones toman colores de la paleta que se distinguen de sus vecinas, sin gastar azar', () => {
  const { map, countries } = loadRealMap('europa');
  const game = new Game({ map, seed: 11 });
  game.addPlayer('Tú', [47, 125, 255], true);
  game.addBots(40, 'normal', countries);
  // La asignación no tira del generador de la partida (todo lo demás sigue igual)
  let draws = 0;
  const next = game.rng._next;
  game.rng._next = () => (draws++, next());
  const nationColor = game._colorNations.bind(game);
  let during = -1;
  game._colorNations = () => {
    const before = draws;
    nationColor();
    during = draws - before;
  };
  game.start();
  assert.equal(during, 0, 'repartir colores no gasta azar');
  const bots = game.bots.map((b) => b.player).filter((p) => !p.weak && p.spawnTile >= 0);
  const palette = new Set(NATION_PALETTE.map((c) => c.join()));
  assert.ok(bots.every((p) => palette.has(p.color.join())), 'colores de la paleta');
  // Las parejas más cercanas (menos de la mitad de la separación media) se distinguen
  const spacing = Math.sqrt(map.landCount / bots.length);
  let pairs = 0;
  for (const p of bots) {
    for (const q of bots) {
      if (q.id <= p.id) continue;
      const d = Math.hypot(map.x(p.spawnTile) - map.x(q.spawnTile), map.y(p.spawnTile) - map.y(q.spawnTile));
      if (d > spacing * 0.5) continue;
      pairs++;
      assert.ok(deltaE(seen(p.color), seen(q.color)) >= 20, `${p.name} y ${q.name} casi del mismo color`);
    }
  }
  assert.ok(pairs > 0);
  // Y con la misma semilla, los mismos colores (multijugador)
  const again = new Game({ map: loadRealMap('europa').map, seed: 11 });
  again.addPlayer('Tú', [47, 125, 255], true);
  again.addBots(40, 'normal', countries);
  again.start();
  assert.deepEqual(again.players.map((p) => p && p.color), game.players.map((p) => p && p.color));
});
