// DEV06: salas de hasta 32 humanos. El inicio viaja en fragmentos dentro del
// presupuesto del transporte (3500 bytes UTF-8 con la envoltura), se
// reconstruye con duplicados, pérdidas y desorden, la última plaza se concede
// una sola vez, el aforo no baja de los admitidos y el reparto de órdenes por
// turno no deja que un solo cliente se quede con todo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RES } from '../src/config.js';
import { connectTransport } from '../src/net.js';
import { COUNTDOWN_MS, MAX_HUMANS, NetSync, Sala, StartAssembler, admitPeers, checkStartPayload, roomStatus, startFragments, wireBytes } from '../src/multiplayer.js';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';

const settings = (over = {}) => ({ bots: 60, mapSize: 'mundo', difficulty: 'normal', rules: { ...DEFAULT_RULES, colonies: 40 }, ...over });
const longName = (i) => `Ñandú Comandante ${i}`.slice(0, 18);
const me = (name) => ({ name, color: '#2f7dff', emblem: { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff', flag: 'es' }, pattern: 'liso', level: 999, title: 'Mariscal de campo eterno', frame: 'laurel', banner: 'noche', nameColor: 'oro' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, what = 'condición') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await wait(40);
  }
  assert.fail(`no se cumplió a tiempo: ${what}`);
}

function payload32() {
  return {
    v: 1,
    seed: 123456789,
    ronda: 2,
    rev: 7,
    ruleset: 'x#y',
    settings: settings(),
    count: 32,
    players: Array.from({ length: 32 }, (_, i) => ({ peer: `peer${String(i).padStart(2, '0')}abcdef`, ...me(longName(i)) })),
  };
}

test('32 plazas: el inicio cabe en fragmentos de 3500 bytes (UTF-8, con la envoltura) y se reconstruye igual', () => {
  const p = payload32();
  assert.ok(wireBytes('inicio', p) > 3500, 'entero no cabría');
  const frags = startFragments(p, { code: 'abcde' });
  assert.ok(frags.length >= 2);
  for (const f of frags) {
    assert.ok(wireBytes('inicio', f) <= 3500, `fragmento ${f.i}: ${wireBytes('inicio', f)} bytes`);
    assert.equal(f.n, frags.length);
    assert.equal(f.r, 2);
    assert.equal(f.rev, 7);
    assert.match(f.k, /^abcde\.2\.7\./);
  }
  // Desordenados y con duplicados idénticos
  const asm = new StartAssembler();
  const order = [...frags].reverse();
  let res;
  for (const f of [...order, ...order]) res = asm.add(JSON.parse(JSON.stringify(f)));
  assert.equal(res.estado, 'completo');
  assert.deepEqual(res.payload.players.map((x) => x.peer), p.players.map((x) => x.peer));
  assert.equal(res.payload.seed, p.seed);
  assert.deepEqual(res.payload.settings, p.settings);
  assert.equal(asm.conflicts, 0);
});

test('32 plazas: fragmentos perdidos se piden; un duplicado contradictorio se rechaza', () => {
  const frags = startFragments(payload32(), { code: 'abcde' });
  const asm = new StartAssembler();
  asm.add(frags[0]);
  assert.deepEqual(asm.missing(), frags.slice(1).map((f) => f.i), 'faltan los demás');
  // Otro «fragmento 0» con distinto contenido: no se acepta
  const evil = JSON.parse(JSON.stringify(frags[0]));
  evil.p[0].name = 'Impostor';
  assert.equal(asm.add(evil).estado, 'parcial');
  assert.equal(asm.conflicts, 1);
  let res;
  for (const f of frags.slice(1)) res = asm.add(f);
  assert.equal(res.estado, 'completo');
  assert.equal(res.payload.players[0].name, longName(0), 'se queda el primero');
  // Una lista con un jugador repetido no se acepta
  const dup = payload32();
  dup.players[5] = { ...dup.players[4] };
  const asm2 = new StartAssembler();
  let r2;
  for (const f of startFragments(dup, { code: 'abcde' })) r2 = asm2.add(f);
  assert.equal(r2.estado, 'completo');
  assert.equal(checkStartPayload({ ...r2.payload, ruleset: 'cualquiera' }).ok, false, 'dos veces el mismo jugador: no se arranca');
  assert.equal(checkStartPayload({ ...payload32(), count: 31 }).ok, false, 'el recuento no cuadra');
});

test('32 plazas: la última plaza se concede una sola vez; los admitidos (y quien reconecta) la conservan', () => {
  const P = (peer, desde, extra = {}) => ({ peer, presence: { jugador: me(peer), desde, version: 'v' }, ...extra });
  const host = { peer: 'h', presence: { jugador: me('Anfitriona'), anfitrion: true, desde: 0 } };
  // Sala de 3: el anfitrión y uno dentro; llegan dos a la vez a por la última plaza
  let admitted = admitPeers([host, P('a', 10)], { prev: [], seats: 3, hostPeer: 'h' });
  assert.deepEqual(admitted, ['h', 'a']);
  admitted = admitPeers([host, P('a', 10), P('c', 21), P('b', 20)], { prev: admitted, seats: 3, hostPeer: 'h' });
  assert.deepEqual(admitted, ['h', 'a', 'b'], 'la última plaza, al primero en llegar');
  // Llega alguien que dice haber llegado antes: no quita la plaza a nadie
  admitted = admitPeers([host, P('a', 10), P('c', 21), P('b', 20), P('z', 1)], { prev: admitted, seats: 3, hostPeer: 'h' });
  assert.deepEqual(admitted, ['h', 'a', 'b']);
  // «a» se está reconectando: conserva su plaza
  admitted = admitPeers([host, P('a', 10, { stale: true }), P('b', 20), P('c', 21)], { prev: admitted, seats: 3, hostPeer: 'h' });
  assert.deepEqual(admitted, ['h', 'a', 'b']);
  // El estado de la sala lo cuenta igual para todos
  const st = roomStatus([{ ...host, presence: { ...host.presence, admitidos: admitted, info: { plazas: 3 } } }, P('a', 10), P('b', 20), P('c', 21), P('z', 1)]);
  assert.deepEqual(st.players.map((p) => p.peer), ['h', 'a', 'b']);
  assert.deepEqual(st.waiting.map((p) => p.peer).sort(), ['c', 'z']);
});

test('32 plazas: con 32 emisores, un cliente que manda de más no se queda con los turnos y cada turno cabe en un mensaje', () => {
  const sent = [];
  const room = {
    emit(topic, data) {
      if (topic === 'turn') sent.push(wireBytes(topic, data));
      return Promise.resolve();
    },
    on: () => () => {},
    onPeers: () => () => {},
  };
  const map = generateMap(120 * RES, 80 * RES, 3);
  const game = new Game({ map, seed: 3 });
  const peerToPlayer = new Map();
  for (let i = 0; i < 32; i++) {
    game.addPlayer(`J${i}`, [i * 7, 100, 200], true);
    peerToPlayer.set(`p${i}`, i + 1);
  }
  game.start();
  const host = new NetSync(room, game, { isHost: true, hostPeer: 'p0', myPlayerId: 1, peerToPlayer, myPeer: 'p0' });
  host._stopTicker();
  host.waiting.clear();
  const msg = (peer, u) => ({ peer, data: { r: 1, u, i: { type: 'emoji', emoji: '🙂', targetId: 2 } } });
  // p1 manda 200 seguidas; los demás, una cada uno
  for (let k = 0; k < 200; k++) host._onIntent(msg('p1', `2.${k}`));
  for (let i = 2; i < 32; i++) host._onIntent(msg(`p${i}`, `${i + 1}.1`));
  assert.ok(host.queue.length < 200 + 30, 'la cola del que manda de más está acotada');
  const counted = new Map();
  host._hostStep();
  for (const it of host.history.get(game.ticks)) counted.set(it.u.split('.')[0], (counted.get(it.u.split('.')[0]) || 0) + 1);
  assert.ok((counted.get('2') || 0) <= 4, 'como mucho 4 del mismo emisor por turno');
  // En pocos turnos han pasado las de todos los demás
  for (let k = 0; k < 4; k++) host._hostStep();
  const applied = new Set();
  for (const intents of host.history.values()) for (const it of intents) applied.add(it.u);
  for (let i = 2; i < 32; i++) assert.ok(applied.has(`${i + 1}.1`), `la de p${i}`);
  host._flush();
  for (const b of sent) assert.ok(b <= 3500, `turno de ${b} bytes`);
  host.stop();
});

test(`32 plazas: una sala real con ${MAX_HUMANS} clientes empieza a la vez con la misma lista`, async () => {
  let n = 0;
  const browser = () => connectTransport({ prefer: 'local', peerId: `c${(++n).toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 7)}` });
  const th = await browser();
  const host = new Sala(th, { code: 'zz32a', isHost: true, me: me('Anfitriona'), settings: settings(), info: { nombre: 'Treinta y dos', plazas: 32 } });
  await host.open();
  const guests = [];
  for (let i = 1; i < 32; i++) {
    const t = await browser();
    const g = new Sala(t, { code: 'zz32a', isHost: false, me: me(longName(i)), settings: null });
    await g.open();
    guests.push({ t, g });
  }
  await until(() => host.status().total === 32 && host.admitted.length === 32, 15000, '32 dentro');
  // Aforo: no se puede bajar de los admitidos
  host.setInfo({ plazas: 8 });
  assert.equal(host.info.plazas, 32);
  for (const { g } of guests) {
    await until(() => g.status().rev != null, 6000, 'revisión');
    g.setReady(true);
  }
  await until(() => host.status().canStart, 15000, 'todos listos');
  const starts = [];
  host.onStart = (p) => starts.push(['h', p]);
  for (const { g } of guests) g.onStart = (p) => starts.push(['g', p]);
  assert.equal(host.beginCountdown(), null);
  await until(() => starts.length === 32, COUNTDOWN_MS + 12000, 'los 32 arrancan');
  const ids = starts[0][1].players.map((p) => p.peer);
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
  for (const [, p] of starts) {
    assert.deepEqual(p.players.map((x) => x.peer), ids);
    assert.equal(p.seed, starts[0][1].seed);
  }
  assert.ok(host.fragments.length >= 2, 'llegó en fragmentos');
  await until(() => host.acks.size === 31, 6000, 'acuses de recibo');
  await host.leave();
  th.close();
  for (const { g, t } of guests) {
    await g.leave();
    t.close();
  }
});

test('32 plazas: un fragmento perdido se pide y llega', async () => {
  // Transporte de un invitado que pierde la primera vez el fragmento 1
  let n = 0;
  const browser = () => connectTransport({ prefer: 'local', peerId: `d${(++n).toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 7)}` });
  const th = await browser();
  const host = new Sala(th, { code: 'zz32b', isHost: true, me: me('Anfitriona'), settings: settings(), info: { plazas: 32 } });
  await host.open();
  const guests = [];
  for (let i = 1; i < 20; i++) {
    const t = await browser();
    if (i === 1) {
      const on = t.join.bind(t);
      t.join = async (name) => {
        const room = await on(name);
        const orig = room.on.bind(room);
        let dropped = false;
        room.on = (topic, fn) => orig(topic, topic === 'inicio' ? (m) => (m.data && m.data.i === 1 && !dropped ? (dropped = true) : fn(m)) : fn);
        return room;
      };
    }
    const g = new Sala(t, { code: 'zz32b', isHost: false, me: me(longName(i)), settings: null });
    await g.open();
    guests.push({ t, g });
  }
  await until(() => host.status().total === 20, 15000, '20 dentro');
  for (const { g } of guests) {
    await until(() => g.status().rev != null, 6000, 'revisión');
    g.setReady(true);
  }
  await until(() => host.status().canStart, 15000, 'listos');
  let got = 0;
  guests[0].g.onStart = () => got++;
  let asked = 0;
  const origMissing = host._onMissing.bind(host);
  host._onMissing = (m) => {
    asked++;
    origMissing(m);
  };
  // Inicio sin repeticiones automáticas: solo vale la petición de lo que falta
  host.beginCountdown();
  await wait(COUNTDOWN_MS + 50);
  clearInterval(host._startTimer);
  await until(() => got === 1, 6000, 'el invitado completa el inicio');
  assert.ok(asked >= 1, 'pidió el fragmento que faltaba');
  await host.leave();
  th.close();
  for (const { g, t } of guests) {
    await g.leave();
    t.close();
  }
});

