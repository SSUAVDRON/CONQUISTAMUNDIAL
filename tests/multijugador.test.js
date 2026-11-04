// Tests del multijugador: lockstep con pérdida de mensajes, sin navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES, CONFIG } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { NetSync, stateHash } from '../src/multiplayer.js';
import { Rng } from '../src/rng.js';

/** Red de mentira: reparte mensajes entre canales y pierde una fracción. */
function fakeNetwork(dropRate, seed = 1) {
  const rng = new Rng(seed);
  const channels = [];
  function channel(peer) {
    const topics = new Map();
    const ch = {
      peer,
      emit(topic, data) {
        for (const other of channels) {
          if (other !== ch && rng.float() < dropRate) continue; // se pierde por el camino
          const fns = other.topics.get(topic);
          if (!fns) continue;
          const msg = { topic, data: JSON.parse(JSON.stringify(data)), peer, isMe: other === ch, sameTab: other === ch };
          for (const fn of [...fns]) fn(msg);
        }
        return Promise.resolve();
      },
      on(topic, fn) {
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(fn);
        return () => topics.get(topic).delete(fn);
      },
      onPeers() {
        return () => {};
      },
      topics,
    };
    channels.push(ch);
    return ch;
  }
  return { channel };
}

function makeGame(seed) {
  const map = generateMap(200 * RES, 120 * RES, seed);
  const game = new Game({ map, seed });
  game.addPlayer('Anfitriona', [255, 0, 0], true);
  game.addPlayer('Invitado', [0, 0, 255], true);
  game.addBots(6);
  game.start();
  return game;
}

function freeTile(game, frac) {
  const m = game.map;
  for (let k = Math.floor(m.landTiles.length * frac); k < m.landTiles.length; k += 17) {
    const t = m.landTiles[k];
    if (game.owner[t] === 0 && m.landBodySizes[m.landBody[t]] > 300) return t;
  }
  throw new Error('sin casilla libre');
}

test('lockstep: con un 30 % de mensajes perdidos ambas partidas terminan idénticas', () => {
  const seed = 1234;
  const net = fakeNetwork(0.3);
  const hostCh = net.channel('h');
  const guestCh = net.channel('g');
  const hostGame = makeGame(seed);
  const guestGame = makeGame(seed);
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  const host = new NetSync(hostCh, hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer });
  const guest = new NetSync(guestCh, guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer });
  clearInterval(host._timer); // en el test avanzamos a mano

  host.localIntent({ type: 'action', tile: freeTile(hostGame, 0.2), ratio: 0.2 });
  guest.localIntent({ type: 'action', tile: freeTile(guestGame, 0.8), ratio: 0.2 });

  const TICKS = 900;
  let tilesBefore = -1;
  for (let i = 0; i < TICKS; i++) {
    host._hostStep();
    if (i === CONFIG.spawnTicks + 5 && guestGame.ticks > CONFIG.spawnTicks) {
      // el invitado ataca tierra libre junto a su frontera
      const me = guestGame.players[2];
      const m = guestGame.map;
      const wild = [...me.border].flatMap((t) => [t - 1, t + 1, t - m.width, t + m.width]).find((n) => m.isLand(n) && guestGame.owner[n] === 0);
      assert.ok(wild !== undefined, 'debería haber tierra libre al lado');
      tilesBefore = me.tiles;
      guest.localIntent({ type: 'action', tile: wild, ratio: 0.5 });
    }
    // Simulamos el paso del tiempo: reintentos y peticiones de reenvío
    for (const entry of guest.outbox.values()) entry.sentAt = -1e9;
    guest.lastAdvance = -1e9;
    guest.lastResendAsk = -1e9;
    host.lastResend.clear();
    guest.update();
  }
  host._flush();
  // Ronda final de recuperación hasta alcanzar al anfitrión
  for (let k = 0; k < 200 && guestGame.ticks < hostGame.ticks; k++) {
    guest.lastAdvance = -1e9;
    guest.lastResendAsk = -1e9;
    host.lastResend.clear();
    guest.update();
  }

  assert.equal(guestGame.ticks, hostGame.ticks, 'el invitado alcanza al anfitrión');
  assert.equal(stateHash(guestGame), stateHash(hostGame), 'mismo estado en ambos');
  assert.ok(tilesBefore > 0, 'el invitado llegó a atacar');
  assert.ok(guestGame.players[2].maxTilesReached > tilesBefore + 50, 'la acción del invitado llegó pese a las pérdidas');
  assert.equal(guest.outbox.size, 0, 'todas las acciones del invitado confirmadas');
  host.stop();
  guest.stop();
});

test('el anfitrión ignora acciones que dicen ser de otro jugador', () => {
  const net = fakeNetwork(0);
  const hostCh = net.channel('h');
  const intruder = net.channel('x'); // no está en la partida
  const game = makeGame(9);
  const host = new NetSync(hostCh, game, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer: new Map([['h', 1], ['g', 2]]) });
  clearInterval(host._timer);
  intruder.emit('intent', { u: 'x.1', i: { type: 'action', tile: freeTile(game, 0.5), ratio: 1, playerId: 2 } });
  intruder.emit('intent', { u: 'x.2', i: { type: 'borrarTodo' } });
  assert.equal(host.queue.length, 0);
  host.stop();
});
