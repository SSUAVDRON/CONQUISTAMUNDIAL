// Cliente de la cuenta (src/cuenta.js) con un servidor falso: entrar, unir el
// perfil, reintentar si otro dispositivo guardó a la vez y la fila de rangos compartida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account } from '../src/cuenta.js';
import { defaultProfile, normalizeProfile } from '../src/profile.js';
import { passwordStrength, timeAgo } from '../src/cuenta-ui.js';

globalThis.localStorage = undefined; // saveProfile no guarda en Node

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Servidor falso con un perfil guardado y su versión; `race` simula otro dispositivo que guarda justo antes. */
function fakeServer({ perfil = null, version = 0, race = null } = {}) {
  const srv = { perfil, version, calls: [] };
  srv.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    srv.calls.push(body.accion);
    const reply = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
    if (body.accion === 'entrar') return reply(200, { token: 'a'.repeat(64), cuenta: { email: 'x@y.es', nombre: 'X' } });
    if (body.accion === 'perfil_leer') return reply(200, { perfil: srv.perfil, version: srv.version });
    if (body.accion === 'perfil_guardar') {
      if (race) {
        srv.perfil = race(srv.perfil);
        srv.version++;
        race = null;
      }
      if (body.version !== srv.version) return reply(409, { error: 'cambió', perfil: srv.perfil, version: srv.version });
      srv.perfil = JSON.parse(JSON.stringify(body.perfil));
      srv.version++;
      return reply(200, { ok: true, version: srv.version });
    }
    return reply(400, { error: '?' });
  };
  return srv;
}

test('entrar une el progreso de este dispositivo con el de la cuenta (sin perder monedas)', async () => {
  const remote = normalizeProfile({ xp: 5000, monedas: 300, stats: { monedasGanadas: 300, monedasGastadas: 0 }, apiRango: { id: 'b'.repeat(32), secreto: 'c'.repeat(64) } });
  const srv = fakeServer({ perfil: remote, version: 3 });
  const storage = memoryStorage();
  const acc = new Account({ fetchFn: srv.fetch, storage });
  const local = normalizeProfile({ xp: 800, monedas: 50, stats: { monedasGanadas: 50, monedasGastadas: 0 } });
  local.ajustes.musica = false;
  await acc.signIn({ email: 'x@y.es', password: 'trinchera123' }, local);
  assert.ok(acc.signedIn);
  assert.equal(local.xp, 5000);
  assert.equal(local.monedas, 300, 'el máximo de lo ganado (300) menos lo gastado (0)');
  assert.equal(srv.version, 4);
  assert.equal(srv.perfil.xp, 5000);
  // La fila de rangos de la cuenta pasa a este dispositivo
  assert.equal(storage.getItem('trinchera.rango.id'), 'b'.repeat(32));
  // La sesión se recuerda
  assert.ok(new Account({ fetchFn: srv.fetch, storage }).signedIn);
});

test('si otro dispositivo guarda a la vez (409), se vuelve a unir y a guardar', async () => {
  const srv = fakeServer({ perfil: defaultProfile(), version: 1, race: (p) => ({ ...p, xp: 9999 }) });
  const acc = new Account({ fetchFn: srv.fetch, storage: memoryStorage() });
  const local = normalizeProfile({ xp: 100 });
  await acc.signIn({ email: 'x@y.es', password: 'trinchera123' }, local);
  assert.equal(local.xp, 9999, 'lo del otro dispositivo no se pierde');
  assert.equal(srv.perfil.xp, 9999);
  assert.ok(srv.calls.filter((c) => c === 'perfil_guardar').length >= 2);
  assert.equal(acc.state.error, '');
});

test('fuerza de la contraseña y «hace…»', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.ok(passwordStrength('corta').score <= 1);
  assert.ok(passwordStrength('Trinchera-2026!').score >= 3);
  const now = Date.now();
  assert.equal(timeAgo(now - 5000, now), 'hace un momento');
  assert.equal(timeAgo(now - 5 * 60000, now), 'hace 5 min');
  assert.equal(timeAgo(now - 3 * 3600000, now), 'hace 3 h');
});
