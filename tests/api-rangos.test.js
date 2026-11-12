// Tests de la API de rangos en PHP (api/rangos.php) con `php -S` y SQLite.
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
const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = `http://127.0.0.1:${PORT}/api/rangos.php`;
let server;
let dir;

before(async () => {
  if (!hasPhp) return;
  dir = mkdtempSync(join(tmpdir(), 'rangos-'));
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT], { env: { ...process.env, TRINCHERA_DSN: `sqlite:${join(dir, 'r.db')}`, TRINCHERA_SAL: 'x', TRINCHERA_ESPERA_ID: '2' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${URL}?temporada=2026-6`);
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

const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const post = (body) => fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const fila = (o = {}) => ({ temporada: '2026-6', nombre: 'Aurelia', titulo: 'el Temible', color: '#2f7dff', emblema: { shape: 'escudo', symbol: 'estrella', bg: '#2f7dff', fg: '#ffffff' }, puntos: 900, partidas: 6, victorias: 2, colocado: true, ...o });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('crear y leer una fila; la tabla solo enseña a quien terminó la colocación', { skip: !hasPhp && 'sin PHP' }, async () => {
  const id = hex(32);
  const secreto = hex(64);
  const r = await post({ id, secreto, fila: fila({ nombre: 'Aurelia<script>' }) });
  assert.equal(r.status, 200, await r.clone().text());
  await post({ id: hex(32), secreto: hex(64), fila: fila({ nombre: 'Sin colocar', colocado: false, puntos: 0 }) });
  const g = await (await fetch(`${URL}?temporada=2026-6`)).json();
  assert.equal(g.filas.length, 1);
  assert.equal(g.filas[0].nombre, 'Aureliascript', 'sin < ni >');
  assert.equal(g.filas[0].puntos, 900);
  assert.equal(g.filas[0].emblema.symbol, 'estrella');
  assert.ok(!JSON.stringify(g).includes(secreto) && !JSON.stringify(g).includes(id), 'ni el secreto ni el id completo salen');
});

test('solo quien tiene el secreto cambia su fila, y el cambio tiene que ser plausible', { skip: !hasPhp && 'sin PHP' }, async () => {
  const id = hex(32);
  const secreto = hex(64);
  assert.equal((await post({ id, secreto, fila: fila({ puntos: 1000, partidas: 10 }) })).status, 200);
  await wait(2100); // una escritura cada 8 s por jugador (2 s en pruebas)
  assert.equal((await post({ id, secreto: hex(64), fila: fila({ puntos: 1020, partidas: 11 }) })).status, 403, 'otro secreto');
  await wait(2100);
  assert.equal((await post({ id, secreto, fila: fila({ puntos: 2000, partidas: 11 }) })).status, 422, 'mil PL en una partida');
  await wait(2100);
  assert.equal((await post({ id, secreto, fila: fila({ puntos: 1040, partidas: 11 }) })).status, 200);
});

test('límite de escrituras y datos no válidos', { skip: !hasPhp && 'sin PHP' }, async () => {
  const id = hex(32);
  const secreto = hex(64);
  assert.equal((await post({ id, secreto, fila: fila() })).status, 200);
  assert.equal((await post({ id, secreto, fila: fila() })).status, 429, 'dos seguidas');
  assert.equal((await post({ id: 'x', secreto, fila: fila() })).status, 400);
  assert.equal((await post({ id: hex(32), secreto, fila: fila({ temporada: '2026-9' }) })).status, 400);
  assert.equal((await post({ id: hex(32), secreto: hex(64), fila: fila({ puntos: 4999, partidas: 0 }) })).status, 422, 'rango imposible de entrada');
  assert.equal((await fetch(`${URL}?temporada=x`)).status, 400);
});

test('sin configurar nada: SQLite fuera de public_html (una para la raíz y otra para …/prueba/)', { skip: !hasPhp && 'sin PHP' }, async () => {
  const { mkdirSync, copyFileSync, existsSync } = await import('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'hosting-'));
  const web = join(home, 'public_html');
  for (const sub of ['api', 'prueba/api']) {
    mkdirSync(join(web, sub), { recursive: true });
    for (const f of ['rangos.php', 'comun.php']) copyFileSync(join(ROOT, 'api', f), join(web, sub, f));
  }
  const port = PORT + 1;
  const env = { ...process.env, TRINCHERA_ESPERA_ID: '2' };
  delete env.TRINCHERA_DSN;
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', web], { env, stdio: 'ignore' });
  try {
    let ok = null;
    for (let i = 0; i < 50 && !ok; i++) {
      try {
        ok = await fetch(`http://127.0.0.1:${port}/api/rangos.php?temporada=2026-6`);
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.deepEqual(await ok.json(), { filas: [] });
    const r = await fetch(`http://127.0.0.1:${port}/api/rangos.php`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: hex(32), secreto: hex(64), fila: fila() }) });
    assert.equal(r.status, 200);
    const g = await (await fetch(`http://127.0.0.1:${port}/api/rangos.php?temporada=2026-6`)).json();
    assert.equal(g.filas.length, 1);
    await fetch(`http://127.0.0.1:${port}/prueba/api/rangos.php?temporada=2026-6`);
    assert.ok(existsSync(join(home, 'trinchera-rangos.sqlite')), 'la de la raíz, fuera de public_html');
    assert.ok(existsSync(join(home, 'trinchera-rangos-prueba.sqlite')), 'la de prueba, aparte');
    assert.ok(existsSync(join(home, 'trinchera-rangos.sal')));
    assert.ok(!existsSync(join(web, 'trinchera-rangos.sqlite')), 'nada dentro de la web');
    const p = await (await fetch(`http://127.0.0.1:${port}/prueba/api/rangos.php?temporada=2026-6`)).json();
    assert.equal(p.filas.length, 0, 'prueba no ve las filas de la raíz');
  } finally {
    srv.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
