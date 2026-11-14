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
  host._stopTicker(); // en el test avanzamos a mano

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
  host._stopTicker();
  intruder.emit('intent', { u: 'x.1', i: { type: 'action', tile: freeTile(game, 0.5), ratio: 1, playerId: 2 } });
  intruder.emit('intent', { u: 'x.2', i: { type: 'borrarTodo' } });
  assert.equal(host.queue.length, 0);
  host.stop();
});

test('cooperativo: dos jugadores comparten nación y las acciones de ambos llegan (sin pisarse)', () => {
  const net = fakeNetwork(0);
  const hostCh = net.channel('h');
  const guestCh = net.channel('g');
  // Una sola nación humana para los dos (id 1)
  const mk = () => {
    const map = generateMap(200 * RES, 120 * RES, 77);
    const game = new Game({ map, seed: 77, rules: { coop: true } });
    game.addPlayer('Ana y Bea', [255, 0, 0], true);
    game.addBots(4);
    game.start();
    return game;
  };
  const hostGame = mk();
  const guestGame = mk();
  const peerToPlayer = new Map([['h', 1], ['g', 1]]);
  const host = new NetSync(hostCh, hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, mySlot: 0 });
  const guest = new NetSync(guestCh, guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 1, peerToPlayer, mySlot: 1 });
  host._stopTicker();
  // Las dos primeras acciones de cada uno tendrían la misma clave sin el puesto
  host.localIntent({ type: 'share', share: 0.4 });
  guest.localIntent({ type: 'action', tile: freeTile(guestGame, 0.5), ratio: 0.2 });
  for (let i = 0; i < 5; i++) {
    host._hostStep();
    guest.update();
  }
  host._flush();
  for (let k = 0; k < 20 && guestGame.ticks < hostGame.ticks; k++) {
    guest.lastAdvance = -1e9;
    guest.update();
  }
  const p = hostGame.players[1];
  assert.equal(p.soldierShare, 0.4, 'llega la acción de la anfitriona');
  assert.ok(p.spawned, 'llega la del invitado (despliegue)');
  // Cada orden queda marcada con el puesto de quien la dio (para verla en el mapa)
  const marks = hostGame.effects.filter((e) => e.kind === 'order');
  assert.ok(marks.some((e) => e.by === 1), 'la marca de la orden del invitado');
  assert.equal(stateHash(guestGame), stateHash(hostGame));
  host.stop();
  guest.stop();
});

test('el anfitrión espera a que todos carguen antes del primer turno', () => {
  const net = fakeNetwork(0);
  const hostCh = net.channel('h');
  const guestCh = net.channel('g');
  const hostGame = makeGame(5);
  const guestGame = makeGame(5);
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  const host = new NetSync(hostCh, hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, myPeer: 'h' });
  host._stopTicker();
  host.last = performance.now() - 1000;
  host.update();
  assert.equal(hostGame.ticks, 0, 'sin el invitado cargado, no avanza');
  assert.match(host.status, /carguen/);
  // El invitado termina de cargar: lo anuncia al crear su NetSync
  const guest = new NetSync(guestCh, guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer, myPeer: 'g' });
  host.last = performance.now() - 1000;
  host.update();
  assert.ok(hostGame.ticks > 0, 'con todos cargados, la partida empieza');
  assert.equal(host.status, '');
  host.stop();
  guest.stop();
});

test('el invitado se entera si se desincroniza', () => {
  const net = fakeNetwork(0);
  const hostCh = net.channel('h');
  const guestCh = net.channel('g');
  const hostGame = makeGame(6);
  const guestGame = makeGame(6);
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  const host = new NetSync(hostCh, hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, myPeer: 'h' });
  const guest = new NetSync(guestCh, guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer, myPeer: 'g' });
  host._stopTicker();
  for (let i = 0; i < 120; i++) {
    host._hostStep();
    if (i === 50) guestGame.players[3].troops += 12345; // algo distinto solo en el invitado
    host._flush();
    guest.update();
  }
  assert.equal(guestGame.ticks, hostGame.ticks);
  assert.ok(guest.desynced, 'el invitado detecta que su estado no coincide con el del anfitrión');
  assert.match(guest.status, /desincronizado/);
  host.stop();
  guest.stop();
});

test('rondas: los mensajes de una ronda no afectan a la siguiente; el aviso de salida del anfitrión llega con su motivo', () => {
  const net = fakeNetwork(0);
  const hostCh = net.channel('h');
  const guestCh = net.channel('g');
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  // Ronda 1 (la que acaba) y ronda 2 (la revancha) a la vez en el mismo canal
  const old = new NetSync(hostCh, makeGame(5), { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, ronda: 1 });
  const hostGame = makeGame(6);
  const guestGame = makeGame(6);
  const host = new NetSync(hostCh, hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, ronda: 2 });
  const guest = new NetSync(guestCh, guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer, ronda: 2 });
  old._stopTicker();
  host._stopTicker();
  // La ronda 1 sigue mandando turnos (para los rezagados): la ronda 2 no los coge
  for (let i = 0; i < 6; i++) old._hostStep();
  old._flush();
  assert.equal(guest.turns.size, 0, 'turnos de la ronda anterior descartados');
  // Una acción de la ronda 2 no entra en la cola de la ronda 1
  guest.localIntent({ type: 'emoji', targetId: 1, emoji: '👍' });
  assert.equal(old.queue.length, 0);
  assert.equal(host.queue.length, 1);
  // Los turnos de la ronda 2 sí
  for (let i = 0; i < 4; i++) host._hostStep();
  host._flush();
  assert.ok(guest.turns.size > 0);
  // Salida explícita del anfitrión: el invitado lo sabe al momento y con su motivo, una vez
  const reasons = [];
  guest.onHostLeft = (r) => reasons.push(r);
  old.announceLeave('abandono'); // de la ronda 1: no cuenta
  assert.deepEqual(reasons, []);
  host.announceLeave('abandono');
  host.announceLeave('abandono');
  assert.deepEqual(reasons, ['abandono']);
  assert.equal(guest.hostGoneReason, 'abandono');
  old.stop();
  host.stop();
  guest.stop();
});
