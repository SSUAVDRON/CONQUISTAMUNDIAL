// Conexión online más estable: elegir servidor en paralelo sin perder el orden
// de preferencia, detectar conexiones «zombis» (abiertas pero mudas), no dar
// por ido a nadie mientras el corte es nuestro, y el invitado reproduce los
// turnos a ritmo constante y pide enseguida los que se pierden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RES, TICK_MS } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { MqttClient } from '../src/mqtt.js';
import { PeerChannel, STALE_MS, firstByPreference } from '../src/net.js';
import { NetSync, OFFLINE_NOTE } from '../src/multiplayer.js';
import { startBroker } from '../herramientas/broker-local.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await wait(25);
  }
  assert.fail(`no se cumplió a tiempo: ${what}`);
}

test('servidores en paralelo: gana el preferido aunque tarde más; si falla, el siguiente; los demás se cierran', async () => {
  const closed = [];
  const fake = (name, ms, ok = true) => () =>
    new Promise((res, rej) => setTimeout(() => (ok ? res({ name, close: () => closed.push(name) }) : rej(new Error('no'))), ms));
  let t0 = Date.now();
  let won = await firstByPreference([fake('a', 120), fake('b', 10), fake('c', 20)]);
  assert.equal(won.value.name, 'a', 'el primero de la lista, aunque responda el último');
  assert.equal(won.index, 0);
  assert.deepEqual(closed.sort(), ['b', 'c'], 'los que conectaron y no se usan se cierran');
  closed.length = 0;
  t0 = Date.now();
  won = await firstByPreference([fake('a', 150, false), fake('b', 40), fake('c', 10)]);
  assert.equal(won.value.name, 'b', 'si el preferido falla, el siguiente en orden');
  assert.ok(Date.now() - t0 < 400, 'sin esperar uno detrás de otro');
  assert.deepEqual(closed, ['c']);
  assert.equal(await firstByPreference([fake('a', 5, false), fake('b', 5, false)]), null, 'todos fallan');
  assert.equal(await firstByPreference([]), null);
});

test('MQTT: una conexión «zombi» se detecta sola (vigilante) y con check(), y se recupera', async () => {
  const broker = await startBroker(0);
  const a = await new MqttClient(broker.url, { keepAlive: 2 }).connect(3000);
  const b = await new MqttClient(broker.url, { keepAlive: 30 }).connect(3000);
  try {
    const got = [];
    const states = [];
    a.onState((on) => states.push(on));
    a.onMessage((topic, payload) => got.push(payload));
    a.subscribe('t/x');
    await wait(150);
    // La red se queda colgada: el socket sigue abierto pero no pasa nada
    broker.freeze();
    await until(() => states.includes(false), 6000, 'el vigilante nota el silencio');
    await until(() => a.isConnected && states.at(-1) === true, 4000, 'reconecta');
    // b también se había quedado colgado: con check() (al volver a la pestaña) se nota en 3 s
    const bStates = [];
    b.onState((on) => bStates.push([on, Date.now()]));
    const t0 = Date.now();
    b.check();
    await until(() => bStates.some(([on]) => !on), 4000, 'check() descubre la conexión muerta');
    assert.ok(bStates.find(([on]) => !on)[1] - t0 < 3800);
    await until(() => b.isConnected && bStates.at(-1)[0], 4000, 'b reconecta');
    // Tras reconectar, las suscripciones siguen: llega lo que se publica
    await wait(150);
    b.publish('t/x', 'hola');
    await until(() => got.includes('hola'), 2000, 'mensaje tras reconectar');
  } finally {
    a.close();
    b.close();
    await broker.close();
  }
});

test('presencia: mientras la conexión cortada es la nuestra, nadie se da por ido; al volver, margen para dar señales', () => {
  let connected = true;
  let onConn = null;
  const bus = {
    send() {},
    onMessage() {},
    connected: () => connected,
    onConnection(fn) {
      onConn = fn;
      return () => {};
    },
    close() {},
  };
  const ch = new PeerChannel(bus, 'yo', { timeout: 15000 });
  try {
    ch._recv({ t: 'p', peer: 'ana', presence: { n: 1 } });
    const left = [];
    ch.onPeers((c) => left.push(...c.left));
    // 20 s sin noticias de Ana… pero porque nos quedamos sin red
    ch.others.get('ana').lastSeen = Date.now() - 20000;
    connected = false;
    ch._expire();
    assert.ok(ch.others.has('ana'), 'sin conexión no se quita a nadie');
    // Vuelve la red: Ana tiene margen (sale como «reconectando», no fuera)
    connected = true;
    onConn(true);
    ch._expire();
    assert.ok(ch.others.has('ana'));
    assert.ok(ch._peer('ana').stale, 'se marca como reconectando hasta que dé señales');
    assert.equal(left.length, 0);
    // Si de verdad se ha ido, sale al agotar el margen
    ch.others.get('ana').lastSeen = Date.now() - 15001;
    ch._expire();
    assert.ok(!ch.others.has('ana'));
    assert.ok(STALE_MS < 15000);
  } finally {
    ch.leave();
  }
});

/** Red sin pérdidas que guarda los mensajes hasta que se llame a deliver(). */
function heldNetwork() {
  const channels = [];
  const queue = [];
  let online = true;
  function channel(peer) {
    const topics = new Map();
    const ch = {
      peer,
      topics,
      emit(topic, data) {
        queue.push({ from: ch, topic, data: JSON.parse(JSON.stringify(data)) });
        return Promise.resolve();
      },
      on(topic, fn) {
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(fn);
        return () => topics.get(topic).delete(fn);
      },
      onPeers: () => () => {},
      connected: () => online,
    };
    channels.push(ch);
    return ch;
  }
  /** Entrega lo pendiente; `drop(m)` decide qué se pierde. */
  function deliver(drop = () => false) {
    for (const m of queue.splice(0)) {
      if (drop(m)) continue;
      for (const other of channels) {
        if (other === m.from) continue;
        for (const fn of [...(other.topics.get(m.topic) || [])]) fn({ topic: m.topic, data: m.data, peer: m.from.peer, isMe: false });
      }
    }
  }
  return { channel, deliver, queue, setOnline: (v) => (online = v) };
}

function makeGame(seed) {
  const map = generateMap(160 * RES, 100 * RES, seed);
  const game = new Game({ map, seed });
  game.addPlayer('Anfitriona', [255, 0, 0], true);
  game.addPlayer('Invitado', [0, 0, 255], true);
  game.addBots(3);
  game.start();
  return game;
}

test('invitado suave: los turnos que llegan juntos se juegan de uno en uno cada 100 ms; si se acumulan, se recupera de golpe', () => {
  const net = heldNetwork();
  const hostGame = makeGame(31);
  const guestGame = makeGame(31);
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  let clock = 1000;
  const now = () => clock;
  const host = new NetSync(net.channel('h'), hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, myPeer: 'h', now });
  const guest = new NetSync(net.channel('g'), guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer, myPeer: 'g', smooth: true, now });
  host._stopTicker();
  try {
    net.deliver(); // «cargado»
    // Llega un mensaje con 2 turnos
    host._hostStep();
    host._hostStep();
    net.deliver();
    guest.update();
    assert.equal(guestGame.ticks, 1, 'el primero, enseguida');
    guest.update();
    assert.equal(guestGame.ticks, 1, 'el segundo espera su momento');
    clock += TICK_MS;
    guest.update();
    assert.equal(guestGame.ticks, 2, 'y llega 100 ms después');
    // Vaivén de la red: 6 turnos de golpe → se juegan algo más deprisa, sin saltos
    for (let i = 0; i < 6; i++) host._hostStep();
    net.deliver();
    let frames = 0;
    while (guestGame.ticks < hostGame.ticks && frames < 100) {
      clock += 16;
      guest.update();
      frames++;
    }
    assert.equal(guestGame.ticks, hostGame.ticks);
    assert.ok(frames * 16 >= 6 * TICK_MS * 0.75, `sin saltos (${frames * 16} ms para 6 turnos)`);
    // Pestaña en segundo plano o corte largo: 40 turnos esperando → de golpe, dejando un colchón
    for (let i = 0; i < 40; i++) host._hostStep();
    net.deliver();
    clock += 16;
    guest.update();
    assert.ok(hostGame.ticks - guestGame.ticks <= 2, `recupera de golpe (${hostGame.ticks - guestGame.ticks} por detrás)`);
  } finally {
    host.stop();
    guest.stop();
  }
});

test('invitado: si falta un turno pero llegan los siguientes, lo pide enseguida; sin conexión lo dice', () => {
  const net = heldNetwork();
  const hostGame = makeGame(32);
  const guestGame = makeGame(32);
  const peerToPlayer = new Map([['h', 1], ['g', 2]]);
  let clock = 1000;
  const now = () => clock;
  const host = new NetSync(net.channel('h'), hostGame, { isHost: true, hostPeer: 'h', myPlayerId: 1, peerToPlayer, myPeer: 'h', now });
  const guest = new NetSync(net.channel('g'), guestGame, { isHost: false, hostPeer: 'h', myPlayerId: 2, peerToPlayer, myPeer: 'g', smooth: true, now });
  host._stopTicker();
  try {
    net.deliver();
    host._hostStep();
    host._hostStep();
    host._flush();
    net.deliver((m) => m.topic === 'turn'); // se pierde el mensaje de los turnos 1-2
    host._hostStep();
    host._hostStep();
    host._flush();
    net.deliver();
    clock += 20; // mucho antes de los 700 ms de espera normales
    guest.update();
    assert.equal(guestGame.ticks, 0);
    const asks = net.queue.filter((m) => m.topic === 'resend');
    assert.equal(asks.length, 1, 'pide el hueco al momento');
    assert.equal(asks[0].data.from, 1);
    net.deliver(); // el anfitrión reenvía
    net.deliver();
    for (let i = 0; i < 20 && guestGame.ticks < hostGame.ticks; i++) {
      clock += TICK_MS;
      guest.update();
    }
    assert.equal(guestGame.ticks, hostGame.ticks, 'recupera el hueco');
    // Se corta nuestra conexión: el aviso lo dice (y el anfitrión, si es él)
    net.setOnline(false);
    clock += 5000;
    guest.update();
    assert.equal(guest.status, OFFLINE_NOTE);
    host.update();
    assert.equal(host.status, OFFLINE_NOTE);
    net.setOnline(true);
    host.update();
    assert.equal(host.status, '');
  } finally {
    host.stop();
    guest.stop();
  }
});
