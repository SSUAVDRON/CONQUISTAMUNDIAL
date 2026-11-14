// Salas (diseño de salas): visibilidad, preparación ligada a la revisión de la
// configuración, bloqueos, cuenta atrás con cancelación, plazas y versiones.
// Cada «navegador» es un transporte con su propio identificador: entre
// pestañas (BroadcastChannel, en el mismo proceso) y por MQTT con el servidor
// de pruebas de herramientas/broker-local.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectTransport } from '../src/net.js';
import { COUNTDOWN_MS, Sala, gameplayKey, openRooms, roomStatus } from '../src/multiplayer.js';
import { DEFAULT_RULES } from '../src/config.js';
import { startBroker } from '../herramientas/broker-local.js';

const settings = (over = {}) => ({ bots: 10, mapSize: 'europa', difficulty: 'normal', rules: { ...DEFAULT_RULES }, ...over });
const me = (name) => ({ name, color: '#2f7dff', emblem: { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff' }, pattern: 'liso', level: 3 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condición') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await wait(40);
  }
  assert.fail(`no se cumplió a tiempo: ${what}`);
}

let n = 0;
/** Un «navegador» nuevo (entre pestañas, o MQTT si se da el servidor). */
async function browser(brokerUrl = null) {
  const peerId = `p${(++n).toString().padStart(3, '0')}${Math.random().toString(36).slice(2, 7)}`;
  return connectTransport(brokerUrl ? { brokerUrl, peerId } : { prefer: 'local', peerId });
}

async function room(code, { brokerUrl = null, info = {} } = {}) {
  const th = await browser(brokerUrl);
  const host = new Sala(th, { code, isHost: true, me: me('Alba'), settings: settings(), info: { nombre: 'Frente del Norte', plazas: 4, ...info } });
  await host.open();
  return { th, host };
}

async function guest(code, name, brokerUrl = null) {
  const t = await browser(brokerUrl);
  const g = new Sala(t, { code, isHost: false, me: me(name), settings: null });
  await g.open();
  return { t, g };
}

async function closeAll(...xs) {
  for (const x of xs) {
    if (x.host) await x.host.leave();
    if (x.g) await x.g.leave();
    (x.th || x.t)?.close();
  }
}

test('salas: «Solo con enlace» no sale en el vestíbulo y «Pública» sí; cambiar el nombre no quita la preparación', async () => {
  const a = await room('aaaa1');
  const watcher = await browser();
  await wait(400);
  assert.equal(openRooms(watcher).length, 0, 'la sala solo con enlace no se anuncia');
  a.host.setInfo({ visibilidad: 'publica' });
  await until(() => openRooms(watcher).some((r) => r.code === 'aaaa1'), 4000, 'anuncio de la sala pública');
  const ad = openRooms(watcher).find((r) => r.code === 'aaaa1');
  assert.equal(ad.nombre, 'Frente del Norte');
  assert.equal(ad.plazas, 4);
  assert.equal(ad.mapa, 'europa');
  const b = await guest('aaaa1', 'Vega');
  await until(() => a.host.status().total === 2, 4000, 'el invitado entra');
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'el invitado está listo');
  // Nombre y visibilidad no invalidan la preparación
  a.host.setInfo({ nombre: 'Otro nombre', visibilidad: 'enlace' });
  await wait(300);
  assert.ok(a.host.status().canStart, 'sigue listo tras cambiar nombre/visibilidad');
  await until(() => !openRooms(watcher).some((r) => r.code === 'aaaa1'), 4000, 'al volver a solo con enlace, sale del vestíbulo');
  await closeAll(a, b, { t: watcher });
});

test('salas: cambiar mapa o reglas obliga a confirmar de nuevo; el invitado no puede arrancar', async () => {
  const a = await room('bbbb2');
  const b = await guest('bbbb2', 'Vega');
  await until(() => b.g.status().host, 4000, 'el invitado ve al anfitrión');
  let st = a.host.status();
  assert.deepEqual(st.blockers.some((x) => x.startsWith('Falta Vega')), true, `motivo concreto: ${st.blockers}`);
  assert.equal(st.readyCount, 1, 'el anfitrión cuenta como preparado');
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'listo');
  // El anfitrión cambia el mapa: nueva revisión, el «listo» anterior ya no vale
  const rev = a.host.rev;
  a.host.setSettings(settings({ mapSize: 'mundo' }));
  assert.equal(a.host.rev, rev + 1);
  await until(() => !a.host.status().canStart, 4000, 'la preparación se invalida');
  assert.ok(a.host.status().blockers.some((x) => x.startsWith('Falta Vega')));
  // Las mismas reglas otra vez no suben la revisión
  a.host.setSettings(settings({ mapSize: 'mundo' }));
  assert.equal(a.host.rev, rev + 1);
  assert.notEqual(gameplayKey(settings()), gameplayKey(settings({ rules: { ...DEFAULT_RULES, profile: 'trinchera' } })));
  // El invitado no puede empezar ni editar
  assert.ok(b.g.beginCountdown(), 'el invitado no puede iniciar la cuenta atrás');
  assert.equal(b.g.start(), null, 'ni arrancar la partida');
  b.g.setSettings(settings({ bots: 0 }));
  await wait(200);
  assert.equal(a.host.status().host.presence.ajustes.bots, 10, 'ni cambiar las reglas');
  // Confirma de nuevo y ya se puede
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'confirmado de nuevo');
  await closeAll(a, b);
});

test('salas: cuenta atrás de 3 s y los dos reciben la misma configuración y semilla (una sola vez)', async () => {
  const a = await room('cccc3');
  const b = await guest('cccc3', 'Vega');
  await until(() => b.g.status().host, 4000, 'el invitado ve al anfitrión');
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'listo');
  const starts = { host: [], guest: [] };
  const counts = { host: [], guest: [] };
  a.host.onStart = (p) => starts.host.push(p);
  b.g.onStart = (p) => starts.guest.push(p);
  a.host.onCountdown = (ms, why) => counts.host.push([ms, why]);
  b.g.onCountdown = (ms, why) => counts.guest.push([ms, why]);
  assert.equal(a.host.beginCountdown(), null);
  assert.ok(a.host.beginCountdown(), 'una segunda orden no arranca otra cuenta atrás');
  await until(() => counts.guest.length > 0, 2000, 'el invitado ve la cuenta atrás');
  assert.ok(counts.guest[0][0] > 0 && counts.guest[0][0] <= COUNTDOWN_MS);
  await until(() => starts.host.length && starts.guest.length, COUNTDOWN_MS + 3000, 'arranque');
  await wait(1700); // las repeticiones del mensaje de inicio no arrancan dos veces
  assert.equal(starts.host.length, 1);
  assert.equal(starts.guest.length, 1);
  assert.equal(starts.host[0].seed, starts.guest[0].seed, 'misma semilla');
  assert.deepEqual(starts.host[0].settings, starts.guest[0].settings, 'misma configuración');
  assert.equal(starts.host[0].ruleset, starts.guest[0].ruleset, 'misma versión de reglas');
  assert.deepEqual(starts.guest[0].players.map((p) => p.name), ['Alba', 'Vega']);
  await closeAll(a, b);
});

test('salas: si alguien sale durante la cuenta atrás, todos vuelven al vestíbulo con el motivo', async () => {
  const a = await room('dddd4');
  const b = await guest('dddd4', 'Vega');
  const c = await guest('dddd4', 'Roca');
  await until(() => a.host.status().total === 3, 4000, 'tres jugadores');
  b.g.setReady(true);
  c.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'todos listos');
  const why = { host: null, guest: null };
  a.host.onCountdown = (ms, w) => ms === null && (why.host = w);
  b.g.onCountdown = (ms, w) => ms === null && (why.guest = w);
  let started = false;
  a.host.onStart = () => (started = true);
  assert.equal(a.host.beginCountdown(), null);
  await wait(500);
  await c.g.leave(); // Roca se va
  await until(() => why.host && why.guest, 3000, 'cancelación');
  assert.match(why.host, /Roca ha salido/);
  assert.match(why.guest, /Roca ha salido/);
  await wait(COUNTDOWN_MS);
  assert.equal(started, false, 'no arranca');
  assert.equal(a.host.countdown, null);
  c.t.close();
  await closeAll(a, b);
});

test('salas: sala llena, otra versión y mínimo de jugadores (estado puro)', async () => {
  // Plazas: el tercero de una sala de dos queda fuera
  const a = await room('eeee5', { info: { plazas: 2 } });
  const b = await guest('eeee5', 'Vega');
  await until(() => a.host.status().total === 2, 4000, 'dos jugadores');
  const t3 = await browser();
  const c = new Sala(t3, { code: 'eeee5', isHost: false, me: me('Roca'), settings: null });
  await c.open({ observer: true });
  await until(() => c.entryState().estado !== 'buscando', 4000, 'ficha de entrada');
  assert.equal(c.entryState().estado, 'llena');
  assert.equal(c.entryState().info.nombre, 'Frente del Norte');
  await c.leave();
  t3.close();
  await closeAll(a, b);
  // Estado puro: otra versión, reconectando, sin anfitrión, mínimo
  const P = (peer, presence, extra = {}) => ({ peer, presence, ...extra });
  const host = { jugador: me('Alba'), anfitrion: true, rev: 3, version: 'v1', info: { plazas: 4 }, desde: 1 };
  let st = roomStatus([P('h', host), P('g', { jugador: me('Vega'), listo: 3, version: 'v2', desde: 2 })]);
  assert.ok(st.blockers.some((x) => /Vega tiene otra versión/.test(x)));
  st = roomStatus([P('h', host), P('g', { jugador: me('Vega'), listo: 3, version: 'v1', desde: 2 }, { stale: true })]);
  assert.ok(st.blockers.some((x) => /Vega se está reconectando/.test(x)));
  st = roomStatus([P('h', host)]);
  assert.ok(st.blockers.includes('Hace falta al menos otro jugador'));
  st = roomStatus([P('g', { jugador: me('Vega'), listo: 1, version: 'v1', desde: 2 })]);
  assert.ok(st.blockers.includes('El anfitrión no está en la sala'));
  st = roomStatus([P('h', host), P('g', { jugador: me('Vega'), listo: 2, version: 'v1', desde: 2 })]);
  assert.ok(!st.canStart, 'un «listo» de una revisión anterior no vale');
});

test('salas por MQTT (servidor de pruebas): crear, entrar, listo y arranque con la misma semilla', async () => {
  const broker = await startBroker(0);
  try {
    const a = await room('ffff6', { brokerUrl: broker.url, info: { visibilidad: 'publica' } });
    assert.equal(a.th.kind, 'mqtt');
    const watcher = await browser(broker.url);
    await until(() => openRooms(watcher).some((r) => r.code === 'ffff6'), 5000, 'anuncio por MQTT');
    const b = await guest('ffff6', 'Vega', broker.url);
    await until(() => b.g.status().host && a.host.status().total === 2, 5000, 'entran por MQTT');
    b.g.setReady(true);
    await until(() => a.host.status().canStart, 5000, 'listo por MQTT');
    const seeds = [];
    a.host.onStart = (p) => seeds.push(p.seed);
    b.g.onStart = (p) => seeds.push(p.seed);
    assert.equal(a.host.beginCountdown(), null);
    await until(() => seeds.length === 2, COUNTDOWN_MS + 4000, 'arranque por MQTT');
    assert.equal(seeds[0], seeds[1]);
    await closeAll(a, b, { t: watcher });
  } finally {
    await broker.close();
  }
});

test('salas: nombres que se distinguen (sin nombre, «Recluta NNNN»; repetidos, «(2)») y en los motivos', async () => {
  const { roomName } = await import('../src/multiplayer.js');
  assert.equal(roomName('', '4821'), 'Recluta 4821');
  assert.equal(roomName('Mi nación', '4821'), 'Recluta 4821', 'el nombre por defecto no vale para distinguir');
  assert.equal(roomName('  Vega ', '4821'), 'Vega');
  const P = (peer, presence) => ({ peer, presence });
  const host = { jugador: me('Mi nación'), anfitrion: true, rev: 1, version: 'v1', info: { plazas: 4 }, desde: 1 };
  const st = roomStatus([P('h', host), P('a', { jugador: me('Mi nación'), listo: null, version: 'v1', desde: 2 }), P('b', { jugador: me('Mi nación'), listo: 1, version: 'v1', desde: 3 })]);
  assert.deepEqual(st.players.map((p) => p.name), ['Mi nación', 'Mi nación (2)', 'Mi nación (3)']);
  assert.ok(st.blockers.includes('Falta Mi nación (2)'), `motivo sin ambigüedad: ${st.blockers}`);
  const long = roomStatus([P('h', { ...host, jugador: me('Comandante Larguísimo') }), P('a', { jugador: me('Comandante Larguísimo'), listo: 1, version: 'v1', desde: 2 })]);
  assert.ok(long.players[1].name.endsWith(' (2)') && long.players[1].name.length <= 18);
});

test('salas: revancha en el mismo vestíbulo (mismo código, listo de nuevo, semilla nueva)', async () => {
  const a = await room('rrrr7');
  const b = await guest('rrrr7', 'Vega');
  await until(() => b.g.status().host, 4000, 'el invitado ve al anfitrión');
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'listo');
  const starts = { host: [], guest: [] };
  a.host.onStart = (p) => starts.host.push(p);
  b.g.onStart = (p) => starts.guest.push(p);
  assert.equal(a.host.beginCountdown(), null);
  await until(() => starts.host.length && starts.guest.length, COUNTDOWN_MS + 3000, 'ronda 1');
  assert.equal(starts.guest[0].ronda, 1);
  // Termina la ronda: el invitado aún no puede unirse; el anfitrión abre la revancha
  assert.equal(b.g.rematchOpen(), false);
  a.host.reopen();
  await until(() => b.g.rematchOpen(), 4000, 'el invitado ve la revancha abierta');
  assert.equal(a.host.code, 'rrrr7');
  await b.g.rejoin();
  // Hay que confirmar otra vez: la ronda 1 no deja a nadie listo
  await wait(300);
  assert.equal(a.host.status().canStart, false, 'listo invalidado');
  b.g.setReady(true);
  await until(() => a.host.status().canStart, 4000, 'listo para la revancha');
  assert.equal(a.host.beginCountdown(), null);
  await until(() => starts.host.length === 2 && starts.guest.length === 2, COUNTDOWN_MS + 3000, 'ronda 2');
  assert.equal(starts.guest[1].ronda, 2);
  assert.notEqual(starts.guest[1].seed, starts.guest[0].seed, 'semilla nueva');
  assert.deepEqual(starts.guest[1].settings, starts.guest[0].settings, 'mismo mapa y reglas');
  await wait(1700); // repeticiones del inicio de la ronda 2: una sola vez
  assert.equal(starts.guest.length, 2);
  await closeAll(a, b);
});
