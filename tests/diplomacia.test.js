// Tests de la fase 3: alianzas, traición, ayuda entre aliados y emojis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { CONFIG, RES } from '../src/config.js';

/** Dos naciones humanas pegadas (A y B) en la mayor masa de tierra, ya en juego. */
function twoNeighbors(seed = 11) {
  const map = generateMap(220 * RES, 130 * RES, seed);
  const game = new Game({ map, seed });
  const a = game.addPlayer('A', [255, 0, 0], true);
  const b = game.addPlayer('B', [0, 255, 0], false);
  game.start();
  const body = map.landBodySizes.indexOf(Math.max(...map.landBodySizes));
  const tiles = [...map.landTiles].filter((t) => map.landBody[t] === body && !map.coastal[t]);
  const ta = tiles[Math.floor(tiles.length / 2)];
  assert.ok(game.spawnPlayer(a, ta));
  const tb = tiles.find((t) => {
    const d2 = (map.x(t) - map.x(ta)) ** 2 + (map.y(t) - map.y(ta)) ** 2;
    return game.owner[t] === 0 && d2 > (9 * RES) ** 2 && d2 < (11 * RES) ** 2;
  });
  assert.ok(game.spawnPlayer(b, tb));
  while (game.phase === 'spawn') game.tick();
  for (let i = 0; i < 40 && !game.hasLandBorder(a, b.id); i++) {
    a.troops = 1e5;
    game.launchAttack(a, 0, 20000);
    for (let k = 0; k < 20; k++) game.tick();
  }
  assert.ok(game.hasLandBorder(a, b.id), 'A y B deberían ser vecinos');
  return { map, game, a, b };
}

test('proponer y aceptar forma una alianza que impide atacarse y para los ataques en curso', () => {
  const { game, a, b } = twoNeighbors();
  a.troops = 50000;
  assert.ok(game.launchAttack(a, b.id, 20000));
  const troopsAfterLaunch = a.troops;

  assert.ok(game.proposeAlliance(b, a));
  assert.ok(game.pendingRequest(b.id, a.id));
  game.respondAlliance(a, b, true);
  assert.ok(game.isAllied(a.id, b.id) && game.isAllied(b.id, a.id));
  assert.equal(a.attacks.has(b.id), false, 'el ataque en curso se detiene');
  assert.ok(a.troops > troopsAfterLaunch, 'y sus tropas vuelven');

  assert.equal(game.launchAttack(a, b.id, 1000), false, 'no se puede atacar a un aliado');
  const tilesB = b.tiles;
  const anyB = [...b.border][0];
  game.queueIntent({ type: 'action', playerId: a.id, tile: anyB, ratio: 0.5 });
  for (let i = 0; i < 30; i++) game.tick();
  assert.ok(b.tiles >= tilesB, 'el clic sobre un aliado no le quita casillas');
});

test('propuestas cruzadas se firman al momento; el rechazo impone una espera', () => {
  const { game, a, b } = twoNeighbors();
  assert.ok(game.proposeAlliance(a, b));
  assert.ok(game.proposeAlliance(b, a), 'proponer a quien ya te propuso firma la alianza');
  assert.ok(game.isAllied(a.id, b.id));

  game.breakAlliance(a, b);
  assert.ok(game.proposeAlliance(a, b));
  game.respondAlliance(b, a, false);
  assert.equal(game.isAllied(a.id, b.id), false);
  assert.equal(game.canPropose(a, b).ok, false, 'tras un rechazo hay que esperar');
  for (let i = 0; i < CONFIG.rejectCooldownTicks + 1; i++) game.tick();
  assert.equal(game.canPropose(a, b).ok, true);
});

test('una propuesta sin respuesta caduca', () => {
  const { game, a, b } = twoNeighbors();
  b.isHuman = true; // que nadie responda por él
  game.brains.delete(b.id);
  const req = { from: a.id, to: b.id };
  assert.ok(game.proposeAlliance(a, b));
  game.requests.find((r) => r.from === req.from && r.to === req.to).decideAt = Infinity;
  for (let i = 0; i < CONFIG.allianceRequestTicks + 2; i++) game.tick();
  assert.equal(game.pendingRequest(a.id, b.id), null);
  assert.equal(game.isAllied(a.id, b.id), false);
});

test('romper una alianza marca como traidor y abarata conquistarle', () => {
  const { game, a, b } = twoNeighbors();
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  const t = [...a.border][0];
  const before = game.tileCost(t, a).cost;
  assert.ok(game.breakAlliance(a, b));
  assert.equal(game.isAllied(a.id, b.id), false);
  assert.ok(game.isTraitor(a));
  assert.equal(a.betrayals, 1);
  assert.ok(Math.abs(game.tileCost(t, a).cost - before * CONFIG.traitorDefenseMult) < 1e-6);
  for (let i = 0; i < CONFIG.traitorTicks + 1; i++) game.tick();
  assert.equal(game.isTraitor(a), false, 'la marca de traidor caduca');
});

test('solo se envían tropas y oro a aliados', () => {
  const { game, a, b } = twoNeighbors();
  a.troops = 10000;
  a.gold = 4000;
  assert.equal(game.donate(a, b, 'troops', 0.5), false);
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  const bt = b.troops;
  const bg = b.gold;
  assert.ok(game.donate(a, b, 'troops', 0.5));
  assert.ok(game.donate(a, b, 'gold', 0.25));
  assert.equal(a.troops, 5000);
  assert.equal(b.troops, bt + 5000);
  assert.equal(a.gold, 3000);
  assert.equal(b.gold, bg + 1000);
});

test('un barco que llega a un aliado no ataca y devuelve las tropas', () => {
  const { game, a, b } = twoNeighbors();
  const boat = { id: 1, owner: a.id, troops: 3000, path: Int32Array.of(0), pos: 0, progress: 0, dest: [...b.border][0], done: false };
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  a.boatCount = 1;
  const troops = a.troops;
  const tilesB = b.tiles;
  game._landBoat(boat, a);
  assert.equal(a.troops, troops + 3000);
  assert.equal(b.tiles, tilesB);
});

test('emojis con límite de frecuencia', () => {
  const { game, a, b } = twoNeighbors();
  assert.ok(game.sendEmoji(a, b.id, '🔥'));
  assert.equal(game.sendEmoji(a, b.id, '🔥'), false, 'demasiado seguido');
  assert.equal(game.sendEmoji(b, a.id, 'no-es-emoji'), false);
  for (let i = 0; i < CONFIG.emojiCooldownTicks; i++) game.tick();
  assert.ok(game.sendEmoji(a, b.id, '👍'));
});

test('si solo quedan aliados entre sí, gana la alianza', () => {
  const { game, a, b } = twoNeighbors();
  game.addPlayer('C', [0, 0, 255], false); // un tercero ya eliminado, para que no sea un duelo
  game.players[3].alive = false;
  game.proposeAlliance(a, b);
  game.proposeAlliance(b, a);
  game.tick();
  assert.equal(game.phase, 'ended');
  assert.deepEqual(new Set(game.winningAlliance), new Set([a, b]));
});

test('bots: hacen diplomacia y nunca se atacan entre aliados', () => {
  const map = generateMap(260 * RES, 150 * RES, 77);
  const game = new Game({ map, seed: 77 });
  game.addBots(14);
  game.start();
  let alliances = 0;
  for (let i = 0; i < 5000 && game.phase !== 'ended'; i++) {
    game.tick();
    for (const atk of game.attacks) {
      if (!atk.done && atk.targetId) assert.equal(game.isAllied(atk.attacker.id, atk.targetId), false, 'ataque entre aliados');
    }
    for (const p of game.players) {
      if (!p) continue;
      for (const id of p.allies) assert.ok(game.players[id].allies.has(p.id), 'alianza no recíproca');
      assert.ok(p.allies.size <= CONFIG.maxAllies);
    }
    alliances = Math.max(alliances, game.players.reduce((n, p) => n + (p ? p.allies.size : 0), 0));
  }
  assert.ok(alliances > 0, 'los bots deberían haber firmado alguna alianza');
});
