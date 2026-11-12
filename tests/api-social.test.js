// Tests de la API social (api/social.php): amigos, invitaciones a sala y
// clanes, con `php -S` y SQLite. Si no hay PHP en la máquina, se saltan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasPhp = spawnSync('php', ['-r', 'echo extension_loaded("pdo_sqlite") ? 1 : 0;']).stdout?.toString() === '1';
const PORT = 20000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}/api/`;
let server;
let dir;

before(async () => {
  if (!hasPhp) return;
  dir = mkdtempSync(join(tmpdir(), 'social-'));
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT], { env: { ...process.env, TRINCHERA_DSN: `sqlite:${join(dir, 's.db')}`, TRINCHERA_SAL: 'x', TRINCHERA_REGISTROS_HORA: '500' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}cuentas.php`, { method: 'POST', body: '{"accion":"proveedores"}' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(() => {
  server?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const post = async (file, accion, data = {}) => {
  const res = await fetch(`${BASE}${file}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion, ...data }) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, text };
};
let n = 0;
/** Una cuenta nueva con su ficha pública: { token, s(accion, datos), yo } */
async function jugador(nombre, nivel = 5) {
  const email = `social${Date.now()}${n++}@ejemplo.com`;
  const r = await post('cuentas.php', 'registro', { email, password: 'trinchera123', nombre });
  assert.equal(r.status, 200, r.text);
  const token = r.body.token;
  const s = (accion, data = {}) => post('social.php', accion, { token, ...data });
  const f = await s('ficha_guardar', { ficha: { nombre, nivel, titulo: 'Conquistador', emblema: { shape: 'escudo', symbol: 'aguila', bg: '#112233', fg: '#ffffff' }, victorias: nivel * 2, partidas: nivel * 5, email: 'no-se-guarda@x.com', monedas: 999 } });
  assert.equal(f.status, 200, f.text);
  assert.match(f.body.codigo, /^[A-Z2-9]{8}$/);
  const yo = (await s('social')).body.yo;
  return { token, s, yo, email };
}
const skip = !hasPhp && 'sin PHP';

test('amigos: código, solicitud, aceptar, en línea y búsqueda (sin datos privados)', { skip }, async () => {
  const a = await jugador('Aurelia');
  const b = await jugador('Borgoña');
  const c = await jugador('Aurora');
  // B pide a A con su código (con guion y en minúsculas también vale)
  const code = a.yo.codigo;
  const r = await b.s('amigo_solicitar', { codigo: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` });
  assert.deepEqual(r.body, { ok: true, estado: 'enviada' });
  let sa = (await a.s('social')).body;
  assert.equal(sa.recibidas.length, 1);
  assert.equal(sa.recibidas[0].nombre, 'Borgoña');
  assert.equal((await b.s('social')).body.enviadas.length, 1);
  // A acepta: amigos los dos, en línea
  assert.equal((await a.s('amigo_responder', { id: sa.recibidas[0].id, aceptar: true })).status, 200);
  sa = (await a.s('social', { estado: 'sala' })).body;
  assert.equal(sa.amigos.length, 1);
  assert.equal(sa.amigos[0].ficha.titulo, 'Conquistador');
  assert.equal(sa.amigos[0].estado, 'menu', 'B en línea, en el menú');
  const sb = (await b.s('social')).body;
  assert.equal(sb.amigos[0].estado, 'sala', 'A, en una sala');
  // Nada privado en la ficha ni en las respuestas
  assert.ok(!JSON.stringify(sb).includes('@'), 'sin correos');
  assert.ok(!('monedas' in sb.amigos[0].ficha) && !('email' in sb.amigos[0].ficha));
  // Pedir otra vez: ya sois amigos
  assert.equal((await b.s('amigo_solicitar', { codigo: code })).body.estado, 'amigos');
  // Pedirse a la vez: amigos al momento
  assert.equal((await c.s('amigo_solicitar', { codigo: a.yo.codigo })).body.estado, 'enviada');
  assert.equal((await a.s('amigo_solicitar', { codigo: c.yo.codigo })).body.estado, 'amigos');
  // Errores claros
  assert.equal((await a.s('amigo_solicitar', { codigo: a.yo.codigo })).status, 400, 'tu propio código');
  assert.equal((await a.s('amigo_solicitar', { codigo: 'ZZZZ-ZZZZ' })).status, 404);
  assert.equal((await a.s('amigo_solicitar', { codigo: 'hola' })).status, 400);
  // Búsqueda por nombre (prefijo, sin distinguir mayúsculas) y por código
  const busq = (await b.s('buscar', { texto: 'au' })).body.jugadores;
  const nombres = busq.map((j) => j.nombre).sort();
  assert.deepEqual(nombres, ['Aurelia', 'Aurora']);
  assert.equal(busq.find((j) => j.nombre === 'Aurelia').relacion, 'amigos');
  assert.equal(busq.find((j) => j.nombre === 'Aurora').relacion, '');
  assert.equal((await b.s('buscar', { texto: c.yo.codigo })).body.jugadores[0].nombre, 'Aurora');
  assert.equal((await b.s('buscar', { texto: '%' })).body.jugadores.length, 0, 'los comodines no valen');
  // Quitar amigo
  assert.equal((await a.s('amigo_quitar', { id: c.yo.id })).status, 200);
  assert.equal((await c.s('social')).body.amigos.length, 0);
  // Sin sesión, nada
  assert.equal((await post('social.php', 'social', { token: 'f'.repeat(64) })).status, 401);
});

test('invitaciones: solo a amigos, a una sala, y caducan o se borran', { skip }, async () => {
  const a = await jugador('Castilla');
  const b = await jugador('Dalmacia');
  const c = await jugador('Etruria');
  await b.s('amigo_solicitar', { codigo: a.yo.codigo });
  await a.s('amigo_responder', { id: b.yo.id, aceptar: true });
  assert.equal((await a.s('invitar', { id: b.yo.id, sala: 'abc23', red: 'b=1' })).status, 200);
  assert.equal((await a.s('invitar', { id: c.yo.id, sala: 'abc23' })).status, 403, 'no es tu amigo');
  assert.equal((await a.s('invitar', { id: b.yo.id, sala: 'NO VALE' })).status, 400);
  const inv = (await b.s('social')).body.invitaciones;
  assert.equal(inv.length, 1);
  assert.equal(inv[0].sala, 'abc23');
  assert.equal(inv[0].red, 'b=1');
  assert.equal(inv[0].de.nombre, 'Castilla');
  // Invitar otra vez no la duplica
  await a.s('invitar', { id: b.yo.id, sala: 'xyz45' });
  assert.equal((await b.s('social')).body.invitaciones.length, 1);
  assert.equal((await b.s('invitacion_borrar', { id: (await b.s('social')).body.invitaciones[0].id })).status, 200);
  assert.equal((await b.s('social')).body.invitaciones.length, 0);
});

test('clanes: crear, etiqueta única, unirse (abierto o con solicitud), rangos, expulsar, salir y disolver', { skip }, async () => {
  const lider = await jugador('Fenicia', 20);
  const b = await jugador('Galia', 8);
  const c = await jugador('Hispania', 3);
  const d = await jugador('Iliria', 4);
  const uniq = String(Date.now()).slice(-3);
  const tag = `L${uniq}`;
  const cr = await lider.s('clan_crear', { nombre: `Legión ${uniq}`, tag: tag.toLowerCase(), descripcion: 'Los del norte <b>', insignia: { shape: 'circulo', symbol: 'corona', bg: '#aa2200', fg: '#ffd700' }, abierto: false });
  assert.equal(cr.status, 200, cr.text);
  assert.equal(cr.body.clan.tag, tag, 'en mayúsculas');
  assert.equal(cr.body.clan.descripcion, 'Los del norte b');
  assert.equal(cr.body.clan.miembros, 1);
  const id = cr.body.clan.id;
  // Etiqueta y nombre únicos; un clan a la vez
  assert.equal((await c.s('clan_crear', { nombre: 'Otro', tag })).body.campo, 'tag');
  assert.equal((await c.s('clan_crear', { nombre: `legión ${uniq}`, tag: `Q${uniq}` })).body.campo, 'nombre');
  assert.equal((await lider.s('clan_crear', { nombre: 'Segundo', tag: `S${uniq}` })).status, 409);
  assert.equal((await c.s('clan_crear', { nombre: 'ab', tag: 'XY' })).status, 400, 'nombre corto');
  // Cerrado: B pide entrar; el líder ve la solicitud y acepta
  assert.equal((await b.s('clan_unirse', { id })).body.estado, 'pedido');
  assert.deepEqual((await b.s('social')).body.pedidos, [id]);
  const ver = (await lider.s('clan_ver', { id })).body;
  assert.equal(ver.rol, 'lider');
  assert.equal(ver.solicitudes.length, 1);
  assert.equal((await b.s('clan_responder', { cuenta: b.yo.id, aceptar: true })).status, 403, 'un aspirante no acepta');
  assert.equal((await lider.s('clan_responder', { cuenta: b.yo.id, aceptar: true })).status, 200);
  let sb = (await b.s('social')).body;
  assert.equal(sb.clan.tag, tag);
  assert.equal(sb.clan.rol, 'miembro');
  // El clan se ve en la ficha de sus miembros (la chapa con la etiqueta)
  await b.s('amigo_solicitar', { codigo: c.yo.codigo });
  assert.equal((await c.s('social')).body.recibidas[0].clan.tag, tag);
  // Abierto: C entra directamente
  assert.equal((await lider.s('clan_editar', { descripcion: 'Abierto a todos', abierto: true, insignia: { shape: 'rombo', symbol: 'corona', bg: '#000000', fg: '#ffffff' } })).status, 200);
  assert.equal((await c.s('clan_unirse', { id })).body.estado, 'dentro');
  // Rangos: B oficial; un oficial no expulsa al líder ni a otro oficial, sí a un miembro
  assert.equal((await lider.s('clan_rol', { cuenta: b.yo.id, rol: 'oficial' })).status, 200);
  assert.equal((await b.s('clan_expulsar', { cuenta: lider.yo.id })).status, 403);
  assert.equal((await b.s('clan_rol', { cuenta: c.yo.id, rol: 'oficial' })).status, 403, 'solo el líder cambia rangos');
  assert.equal((await b.s('clan_expulsar', { cuenta: c.yo.id })).status, 200);
  assert.equal((await c.s('social')).body.clan, null);
  // Listado y búsqueda de clanes
  const lista = (await d.s('clanes', { texto: `legión ${uniq}`.slice(0, 6) })).body.clanes;
  const mio = lista.find((x) => x.id === id);
  assert.ok(mio && mio.miembros === 2 && mio.victorias === 40 + 16, 'suma las victorias de sus miembros');
  assert.ok((await d.s('clanes', { texto: tag.toLowerCase() })).body.clanes.some((x) => x.id === id), 'por etiqueta');
  // El líder se va: el oficial hereda el clan
  assert.equal((await lider.s('clan_salir')).status, 200);
  const vb = (await b.s('clan_ver', { id })).body;
  assert.equal(vb.rol, 'lider');
  assert.equal(vb.miembros.length, 1);
  // Pasar el liderazgo
  await d.s('clan_unirse', { id });
  assert.equal((await b.s('clan_rol', { cuenta: d.yo.id, rol: 'lider' })).status, 200);
  assert.equal((await d.s('clan_ver', { id })).body.rol, 'lider');
  assert.equal((await b.s('clan_ver', { id })).body.rol, 'oficial');
  // Se van todos: el clan se disuelve
  await b.s('clan_salir');
  await d.s('clan_salir');
  assert.equal((await d.s('clan_ver', { id })).status, 404);
});

test('borrar la cuenta borra también sus amistades y su clan', { skip }, async () => {
  const a = await jugador('Jutlandia');
  const b = await jugador('Kartvelia');
  await b.s('amigo_solicitar', { codigo: a.yo.codigo });
  await a.s('amigo_responder', { id: b.yo.id, aceptar: true });
  const tag = `K${String(Date.now()).slice(-3)}`;
  const id = (await a.s('clan_crear', { nombre: `Kartos ${tag}`, tag, abierto: true })).body.clan.id;
  await b.s('clan_unirse', { id });
  const del = await post('cuentas.php', 'borrar_cuenta', { token: a.token, password: 'trinchera123' });
  assert.equal(del.status, 200, del.text);
  const sb = (await b.s('social')).body;
  assert.equal(sb.amigos.length, 0, 'sin el amigo borrado');
  assert.equal(sb.clan.rol, 'lider', 'el clan pasa a quien queda');
});

test('la API interna no se sirve sola', { skip }, async () => {
  // Con php -S no hay .htaccess, pero las piezas internas no responden nada útil
  for (const f of ['sesion.php', 'social-comun.php']) {
    const r = await fetch(`${BASE}${f}`, { method: 'POST', body: '{}' });
    const t = await r.text();
    assert.ok(!t.includes('"amigos"') && !t.includes('"token"'), f);
  }
});
