// Tests del cliente de la tabla de rangos con fetch simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ladder, apiIdentity, cleanRankRow, rankRow } from '../src/ladder.js';
import { defaultProfile } from '../src/profile.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const { status = 200, body = {} } = handler(url, opts) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('en la web lee la tabla de la API y sube tu fila con tu id y secreto', async () => {
  const states = [];
  const f = fakeFetch((url, o) => (o.method === 'POST' ? { body: { ok: true } } : { body: { filas: [{ id: 'abc', nombre: 'Rival<b>', color: 'rojo', puntos: 1300, partidas: 12, victorias: 4, emblema: { symbol: '../x' } }] } }));
  const L = new Ladder((s) => states.push(s), { fetchFn: f, base: 'https://ejemplo.es/' });
  await L.start(null, '2026-6', { web: true });
  assert.equal(f.calls[0].url, 'https://ejemplo.es/api/rangos.php?temporada=2026-6');
  const st = states[states.length - 1];
  assert.equal(st.available, true);
  assert.equal(st.rows[0].nombre, 'Rival<b>'.slice(0, 18));
  assert.equal(st.rows[0].color, '#888888', 'color no válido');
  assert.equal(st.rows[0].emblema.symbol, 'estrella', 'símbolo no válido');
  assert.equal(st.rows[0].temporada, '2026-6');
  const p = defaultProfile();
  p.nombre = 'Aurelia';
  p.rango.puntos = 900;
  p.rango.colocacion = 5;
  assert.equal(await L.push(p), true);
  const post = f.calls.find((c) => c.opts.method === 'POST');
  const body = JSON.parse(post.opts.body);
  assert.match(body.id, /^[0-9a-f]{32}$/);
  assert.match(body.secreto, /^[0-9a-f]{64}$/);
  assert.equal(body.fila.puntos, 900);
  assert.equal(body.fila.colocado, true);
  // El mismo navegador, la misma identidad
  assert.deepEqual(apiIdentity(), { id: body.id, secreto: body.secreto });
});

test('sin API en el servidor (404) se queda en local', async () => {
  const states = [];
  const L = new Ladder((s) => states.push(s), { fetchFn: fakeFetch(() => ({ status: 404 })) });
  await L.start(null, '2026-6', { web: true });
  assert.equal(L.mode, 'local');
  assert.equal(states[states.length - 1].available, false);
  assert.equal(await L.push(defaultProfile()), false);
});

test('fila pública: sin datos privados y con la colocación', () => {
  const p = defaultProfile();
  const row = rankRow(p);
  assert.equal(row.colocado, false);
  assert.ok(!('mmr' in row) && !('historial' in row));
  assert.equal(cleanRankRow('x', { puntos: 99999 }).puntos, 5000);
});
