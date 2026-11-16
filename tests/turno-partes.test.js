// Turno por partes (tickPart): repartir un turno entre fotogramas no cambia
// nada. La misma partida con turnos enteros y con turnos de un ataque cada
// vez (con lecturas de la interfaz entre medias) acaba exactamente igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';

function make(seed) {
  const map = generateMap(160 * RES, 100 * RES, seed);
  const game = new Game({ map, seed });
  const h = game.addPlayer('Tú', [40, 120, 255], true);
  game.human = h;
  game.addBots(8, 'normal');
  game.addColonies(6);
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  return { game, h };
}

function fingerprint(game) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < game.owner.length; i++) h = Math.imul(h ^ game.owner[i], 16777619);
  const players = game.players.filter(Boolean).map((p) => [p.id, p.alive, p.tiles, Math.round(p.troops * 1000), Math.round(p.gold * 1000)]);
  return JSON.stringify({ h: h >>> 0, ticks: game.ticks, phase: game.phase, attacks: game.attacks.length, players });
}

test('turno por partes: mismo resultado que el turno entero', () => {
  const TURNS = 420;
  const a = make(77);
  for (let i = 0; i < TURNS; i++) a.game.tick();

  const b = make(77);
  let parts = 0;
  let split = 0;
  for (let i = 0; i < TURNS; i++) {
    let n = 0;
    // deadline 0: un solo ataque por parte (lo más troceado posible)
    while (!b.game.tickPart(0)) {
      n++;
      assert.ok(b.game.midTick);
      // Lo que lee la interfaz entre partes no cambia la simulación
      b.game.neighborSummaryView(b.h);
      b.game.economicValue(b.h);
    }
    parts += n + 1;
    if (n) split++;
    assert.ok(!b.game.midTick);
  }
  assert.ok(split > 50, `hubo turnos troceados (${split}, ${parts} partes)`);
  assert.equal(fingerprint(b.game), fingerprint(a.game));
});

test('turno por partes: tick() termina el turno que quedó a medias', () => {
  const a = make(78);
  const b = make(78);
  for (let i = 0; i < 260; i++) {
    a.game.tick();
    b.game.tick();
  }
  // b empieza un turno por partes y lo acaba con tick(); a lo hace entero
  let guard = 0;
  while (!b.game.midTick && guard++ < 50) {
    if (b.game.tickPart(0)) a.game.tick();
  }
  assert.ok(b.game.midTick, 'hay un turno a medias');
  b.game.tick();
  a.game.tick();
  assert.ok(!b.game.midTick);
  assert.equal(fingerprint(b.game), fingerprint(a.game));
});
