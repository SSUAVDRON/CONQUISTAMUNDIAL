// Tests del resumen de partida: grabación, momentos clave, fotos del mapa y puesto final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';
import { Grabador, MAX_SNAPS, SAMPLE_TICKS, WATER, compactCurve, momentOf, placement, placementScore, territorySeries } from '../src/resumen.js';

function partida(seed = 4) {
  const map = generateMap(200 * RES, 120 * RES, seed);
  const game = new Game({ map, seed, rules: { profile: 'clasico' } });
  const h = game.addPlayer('Yo', [255, 0, 0], true);
  game.addBots(6, 'normal', null);
  game.start();
  return { map, game, h };
}

test('graba cada 2 s desde que acaba el despliegue, sin tocar la partida', () => {
  const { game, h } = partida();
  const rec = new Grabador(game, h);
  const owners = () => Array.from(game.owner).join(',').length;
  for (let i = 0; i < CONFIG.spawnTicks + 200; i++) {
    game.tick();
    rec.update();
  }
  // 200 ticks de juego → una muestra cada 20 (más la primera)
  assert.ok(Math.abs(rec.samples.length - (200 / SAMPLE_TICKS + 1)) <= 1, `${rec.samples.length} muestras`);
  const s = rec.samples[rec.samples.length - 1];
  assert.ok(s.t > 15 && s.t <= 20.1, `tiempo de partida ${s.t}`);
  assert.equal(s.me[3], h.tiles);
  assert.ok(Object.keys(s.top).length <= 8 && Object.keys(s.top).length > 0);
  assert.ok(rec.names.has(h.id));
  // Las fotos: agua marcada aparte y dueños tal cual
  assert.ok(rec.snaps.length >= 3);
  const snap = rec.snaps[rec.snaps.length - 1].data;
  assert.equal(snap.length, rec.sw * rec.sh);
  assert.ok(snap.includes(WATER) && snap.includes(h.id));
  assert.ok(owners() > 0);
  // Series de la gráfica: tú (al final) y como mucho 6 más
  const series = territorySeries(rec);
  assert.ok(series[series.length - 1].me && series.length <= 7);
  // Curva compacta del historial: 30 enteros de 0 a 1000
  const curve = compactCurve(rec.samples);
  assert.equal(curve.length, 30);
  assert.ok(curve.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000));
});

test('la repetición no pasa de 150 fotos: descarta una de cada dos y se espacia', () => {
  const { game, h } = partida(6);
  const rec = new Grabador(game, h);
  while (game.phase === 'spawn') game.tick();
  const every = rec.snapEvery;
  for (let i = 0; i < MAX_SNAPS + 1; i++) rec._snap();
  assert.ok(rec.snaps.length <= MAX_SNAPS && rec.snaps.length > MAX_SNAPS / 2 - 2, `${rec.snaps.length} fotos`);
  assert.equal(rec.snapEvery, every * 2);
});

test('momentos clave: eliminaciones, alianzas, traiciones, bombas, derrota; no las respuestas a tus acciones', () => {
  const g = { ticks: 300 };
  const m = (evt) => momentOf({ tick: 300, kind: 'info', ...evt }, g, null);
  assert.equal(m({ text: '🏆 Has conquistado Francia: +5.000 de oro', loot: 5000, kind: 'good' }).icon, '🏆');
  assert.equal(m({ text: '🤝 Alianza firmada con Italia', sfx: 'alliance', kind: 'good' }).text, 'Alianza firmada con Italia');
  assert.equal(m({ text: '💔 Italia ha roto vuestra alianza', sfx: 'betray', kind: 'danger' }).tone, 'mal');
  assert.equal(m({ text: '🚀 ¡Rusia ha lanzado una bomba atómica contra ti!', kind: 'danger' }).icon, '🚀');
  assert.equal(m({ text: 'Has sido derrotado', kind: 'danger' }).icon, '💀');
  assert.equal(m({ text: 'Te falta oro', feedback: true }), null);
  assert.equal(m({ text: 'Obras: ciudad lista en 5 s' }), null);
  // Cada nación que te ataca sale una sola vez
  const { game, h } = partida(7);
  const rec = new Grabador(game, h);
  for (let i = 0; i < 3; i++) rec.onEvent({ tick: game.ticks, kind: 'danger', sfx: 'war', text: '⚔ Rusia te ataca con 1.000 tropas' });
  rec.onEvent({ tick: game.ticks, kind: 'danger', sfx: 'war', text: '⚔ China te ataca con 900 tropas' });
  assert.equal(rec.moments.length, 2);
});

test('puesto final: ganador primero, los vivos por territorio y los eliminados por cuánto aguantaron', () => {
  const P = (id, o) => ({ id, weak: false, alive: true, tiles: 0, ...o });
  const a = P(1, { tiles: 500 });
  const b = P(2, { tiles: 900 });
  const c = P(3, { alive: false, eliminatedTick: 900 });
  const d = P(4, { alive: false, eliminatedTick: 400 });
  const col = { id: 5, weak: true, alive: true, tiles: 9999 };
  const game = { players: [null, a, b, c, d, col], winner: null, winningAlliance: null };
  assert.deepEqual(placement(game, b), { place: 1, of: 4 }, 'las colonias no cuentan');
  assert.deepEqual(placement(game, a), { place: 2, of: 4 });
  assert.deepEqual(placement(game, c), { place: 3, of: 4 });
  assert.deepEqual(placement(game, d), { place: 4, of: 4 });
  // Victoria económica con menos tierra: el ganador va primero igualmente
  game.winner = a;
  assert.equal(placement(game, a).place, 1);
  assert.equal(placement(game, b).place, 2);
  assert.equal(placementScore({ place: 1, of: 91 }), 1);
  assert.equal(placementScore({ place: 91, of: 91 }), 0);
});
