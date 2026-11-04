// Tests de los mapas reales (Natural Earth) y de los bots-país.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { REAL_MAPS } from '../src/config.js';

test('todos los mapas reales se cargan con tierra, agua y países', () => {
  for (const id of Object.keys(REAL_MAPS)) {
    const { map, countries } = loadRealMap(id);
    const share = map.landCount / map.size;
    assert.ok(share > 0.2 && share < 0.7, `${id}: proporción de tierra ${share}`);
    assert.ok(countries.length >= 15, `${id}: países ${countries.length}`);
    for (const c of countries) {
      assert.ok(map.isLand(c.tile), `${id}: ${c.name} empieza en el agua`);
      assert.ok(c.name.length > 1 && c.name.length <= 24);
    }
  }
});

test('el mapa de Europa tiene a sus países donde toca', () => {
  const { map, countries } = loadRealMap('europa');
  const at = (name) => {
    const c = countries.find((x) => x.name === name);
    assert.ok(c, `falta ${name}`);
    return { x: map.x(c.tile) / map.width, y: map.y(c.tile) / map.height };
  };
  const es = at('España');
  const fr = at('Francia');
  const fi = at('Finlandia');
  assert.ok(es.x < fr.x && es.y > fr.y, 'España queda al suroeste de Francia');
  assert.ok(fi.y < fr.y && fi.x > fr.x, 'Finlandia queda al noreste de Francia');
});

test('los bots de un mapa real son países y aparecen en su ubicación', () => {
  const { map, countries } = loadRealMap('sudamerica');
  const game = new Game({ map, seed: 3 });
  game.addBots(10, 'normal', countries);
  game.start();
  assert.equal(game.bots.length, 10);
  for (const bot of game.bots) {
    const p = bot.player;
    const c = countries.find((x) => x.name === p.name);
    assert.ok(c, `${p.name} debería ser un país`);
    assert.ok(p.spawned, `${p.name} debería haber aparecido`);
    const d = Math.hypot(map.x(p.spawnTile) - map.x(c.tile), map.y(p.spawnTile) - map.y(c.tile));
    assert.ok(d <= 15, `${p.name} aparece a ${d.toFixed(1)} casillas de su país`);
  }
  // Y la partida avanza con normalidad
  for (let i = 0; i < 600; i++) game.tick();
  assert.ok(game.bots.some((b) => b.player.tiles > 500));
});

test('pedir más bots que países se limita a los países disponibles', () => {
  const { map, countries } = loadRealMap('norteamerica');
  const game = new Game({ map, seed: 1 });
  game.addBots(60, 'normal', countries);
  assert.equal(game.bots.length, countries.length);
});
