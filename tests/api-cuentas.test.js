// Tests de la API de cuentas (api/cuentas.php) con `php -S` y SQLite.
// Si no hay PHP en la máquina, se saltan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasPhp = spawnSync('php', ['-r', 'echo extension_loaded("pdo_sqlite") ? 1 : 0;']).stdout?.toString() === '1';
const PORT = 19000 + Math.floor(Math.random() * 1000);
const URL = `http://127.0.0.1:${PORT}/api/cuentas.php`;
let server;
let dir;

before(async () => {
  if (!hasPhp) return;
  dir = mkdtempSync(join(tmpdir(), 'cuentas-'));
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT], { env: { ...process.env, TRINCHERA_DSN: `sqlite:${join(dir, 'c.db')}`, TRINCHERA_SAL: 'x' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(URL, { method: 'POST', body: '{"accion":"proveedores"}' });
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

const call = async (accion, data = {}) => {
  const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion, ...data }) });
  return { status: res.status, body: await res.json() };
};
let n = 0;
const correo = () => `prueba${Date.now()}${n++}@ejemplo.com`;
const skip = !hasPhp && 'sin PHP';

test('crear cuenta, entrar con la contraseña y salir', { skip }, async () => {
  const email = correo();
  const r = await call('registro', { email: `  ${email.toUpperCase()} `, password: 'trinchera123', nombre: 'Aurelia<b>' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.body.cuenta, { email, nombre: 'Aureliab' }, 'correo en minúsculas y nombre limpio');
  const yo = await call('yo', { token: r.body.token });
  assert.equal(yo.status, 200);
  assert.equal(yo.body.cuenta.email, email);
  // Otra sesión (otro dispositivo) con la misma contraseña
  const e = await call('entrar', { email, password: 'trinchera123' });
  assert.equal(e.status, 200);
  assert.notEqual(e.body.token, r.body.token);
  // Salir cierra solo esa sesión
  assert.equal((await call('salir', { token: r.body.token })).status, 200);
  assert.equal((await call('yo', { token: r.body.token })).status, 401);
  assert.equal((await call('yo', { token: e.body.token })).status, 200);
});

test('errores: correo repetido, contraseña corta o incorrecta, correo raro, token falso', { skip }, async () => {
  const email = correo();
  assert.equal((await call('registro', { email, password: 'corta' })).status, 400);
  assert.equal((await call('registro', { email: 'no-es-un-correo', password: 'trinchera123' })).body.campo, 'email');
  assert.equal((await call('registro', { email, password: 'trinchera123' })).status, 200);
  const dup = await call('registro', { email, password: 'otra-clave-1' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.campo, 'email');
  const mal = await call('entrar', { email, password: 'equivocada' });
  assert.equal(mal.status, 401);
  // El mismo mensaje si el correo no existe (no se puede saber quién tiene cuenta)
  const nadie = await call('entrar', { email: correo(), password: 'equivocada' });
  assert.equal(nadie.body.error, mal.body.error);
  assert.equal((await call('yo', { token: 'f'.repeat(64) })).status, 401);
  assert.equal((await call('yo', { token: 'x' })).status, 401);
  assert.equal((await call('desconocida')).status, 400);
  assert.deepEqual((await call('proveedores')).body, { proveedores: [] });
});

test('perfil con versiones: leer, guardar y conflicto si otro dispositivo guardó antes', { skip }, async () => {
  const email = correo();
  const { token } = (await call('registro', { email, password: 'trinchera123' })).body;
  const vacio = await call('perfil_leer', { token });
  assert.deepEqual([vacio.body.perfil, vacio.body.version], [null, 0]);
  const p1 = { nombre: 'Aurelia', xp: 120, monedas: 30, ajustes: { musica: false } };
  const g1 = await call('perfil_guardar', { token, perfil: p1, version: 0 });
  assert.equal(g1.status, 200, JSON.stringify(g1.body));
  assert.equal(g1.body.version, 1);
  // Otro dispositivo (otra sesión) lo lee igual
  const otro = (await call('entrar', { email, password: 'trinchera123' })).body.token;
  const leido = await call('perfil_leer', { token: otro });
  assert.deepEqual(leido.body.perfil, p1);
  assert.equal(leido.body.version, 1);
  assert.equal((await call('perfil_guardar', { token: otro, perfil: { ...p1, xp: 200 }, version: 1 })).body.version, 2);
  // El primero guarda con la versión vieja: 409 con la versión nueva para unirlas
  const choque = await call('perfil_guardar', { token, perfil: { ...p1, monedas: 50 }, version: 1 });
  assert.equal(choque.status, 409);
  assert.equal(choque.body.version, 2);
  assert.equal(choque.body.perfil.xp, 200);
  // Y sin sesión no se lee nada
  assert.equal((await call('perfil_leer', { token: 'a'.repeat(64) })).status, 401);
  // Perfil demasiado grande
  const grande = await call('perfil_guardar', { token, perfil: { relleno: 'x'.repeat(70000) }, version: 2 });
  assert.equal(grande.status, 413);
});



test('borrar la cuenta (con la contraseña): se van la sesión, el perfil y el correo queda libre', { skip }, async () => {
  const email = correo();
  const { token } = (await call('registro', { email, password: 'trinchera123' })).body;
  await call('perfil_guardar', { token, perfil: { xp: 1 }, version: 0 });
  assert.equal((await call('borrar_cuenta', { token, password: 'otra-cosa' })).status, 401);
  assert.equal((await call('borrar_cuenta', { token, password: 'trinchera123' })).status, 200);
  assert.equal((await call('yo', { token })).status, 401);
  assert.equal((await call('entrar', { email, password: 'trinchera123' })).status, 401);
});

test('límite de cuentas nuevas desde una misma conexión', { skip }, async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('registro', { email: correo(), password: 'trinchera123' })).status;
  assert.equal(last, 429);
});
