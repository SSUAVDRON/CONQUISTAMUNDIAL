// DEV04: la previsión de una orden cuadra con el motor. La reserva prevista es
// lo que queda tras descontar el envío; el multiplicador de defensa que se
// enseña es el del combate; los ataques que recibes se suman aparte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { hudSnapshot } from '../src/format.js';
import { defenseText } from '../src/ui.js';

function setup(seed = 31) {
  const map = generateMap(200 * RES, 120 * RES, seed);
  const game = new Game({ map, seed });
  game.addPlayer('Tú', [40, 120, 255], true);
  game.addBots(5);
  game.start();
  while (game.phase !== 'playing') game.tick();
  for (let i = 0; i < 200; i++) game.tick();
  return game;
}

/** Una casilla de `owner` junto a la frontera de `p`. */
function borderTile(game, p, owner) {
  const m = game.map;
  for (const t of p.border) for (const n of [t - 1, t + 1, t - m.width, t + m.width]) if (n >= 0 && n < m.size && m.isLand(n) && game.owner[n] === owner) return n;
  return -1;
}

test('previsión: al 20, 50 y 100 % la reserva prevista es la que queda al ejecutar', () => {
  for (const ratio of [0.2, 0.5, 1]) {
    const game = setup();
    const h = game.human;
    h.troops += 0.73; // con decimales: la misma cuenta en el panel y en el motor
    const tile = borderTile(game, h, 0);
    assert.ok(tile >= 0, 'tierra libre al lado');
    const send = hudSnapshot(h.troops, ratio).envio;
    const pv = game.attackPreview(h, tile, send);
    assert.equal(pv.send, Math.floor(h.troops * ratio), 'el envío del panel = el del motor');
    game._handleAttackIntent(h, tile, ratio);
    assert.ok(Math.abs(h.troops - pv.reserve) < 1e-9, `reserva prevista ${pv.reserve} = real ${h.troops} (${ratio})`);
  }
});

test('previsión: el multiplicador de defensa mostrado es el del combate (murallas, afueras, puesto)', () => {
  const game = setup(7);
  const enemy = game.players.find((p) => p && p.alive && !p.isHuman && p.capital);
  assert.ok(enemy, 'una nación con capital');
  const cap = enemy.capital.tile;
  for (const t of [cap, cap + 4 * RES, cap + 9 * RES]) {
    if (t < 0 || t >= game.map.size || game.owner[t] !== enemy.id) continue;
    const d = game.defenseBreakdown(enemy, t);
    assert.equal(d.mult, game.defenseMult(enemy, t));
    const prod = d.parts.reduce((m, p) => m * p.mult, 1);
    assert.ok(Math.abs(prod - d.mult) < 1e-9, 'el producto de lo que se enseña es el multiplicador real');
  }
  const inner = game.defenseBreakdown(enemy, cap);
  assert.ok(inner.parts.some((p) => p.label === 'murallas de la capital'));
  assert.match(defenseText(inner), /murallas de la capital ×\d/);
});

test('previsión: los ataques que recibes se suman aparte y suben la exposición; la retirada los quita', () => {
  const game = setup(12);
  const h = game.human;
  const foes = game.players.filter((p) => p && p.alive && !p.isHuman).slice(0, 2);
  const tile = borderTile(game, h, 0);
  const before = game.attackPreview(h, tile, 0);
  assert.equal(before.incoming, 0);
  assert.equal(before.exposure, 'baja');
  // Dos ataques a la vez contra ti (simultáneos; aquí, sus ataques en curso)
  for (const f of foes) f.attacks.set(h.id, { troops: Math.floor(h.troops * 0.8), targetId: h.id });
  const during = game.attackPreview(h, tile, Math.floor(h.troops * 0.9));
  assert.equal(during.attackers, foes.length);
  assert.ok(during.incoming > 0);
  assert.equal(during.exposure, 'alta', 'si envías casi todo, tu reserva no les alcanza');
  // Si se retiran, la exposición baja
  for (const f of foes) f.attacks.get(h.id).troops = 0;
  assert.equal(game.attackPreview(h, tile, 0).incoming, 0);
});
