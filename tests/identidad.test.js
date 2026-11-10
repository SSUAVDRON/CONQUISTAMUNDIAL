// Tests de la identidad firmada (ECDSA P-256) de las salas clasificatorias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimText, getIdentity, signClaim, verifiedRank } from '../src/identidad.js';

const store = new Map();
const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

test('el rango firmado para una sala se verifica; cambiado o de otra sala, no', async () => {
  const ident = await getIdentity(storage);
  assert.ok(ident && ident.pub.x && ident.id.length === 16);
  const signed = await signClaim(claimText('abcde', 1234.4, 1500), ident);
  const claim = { mmr: 1234, puntos: 1500, ...signed };
  const ok = await verifiedRank('abcde', claim);
  assert.deepEqual({ mmr: ok.mmr, puntos: ok.puntos }, { mmr: 1234, puntos: 1500 });
  assert.equal(ok.id, ident.id);
  assert.equal(await verifiedRank('zzzzz', claim), null, 'firma de otra sala');
  assert.equal(await verifiedRank('abcde', { ...claim, mmr: 2500 }), null, 'MMR cambiado');
  assert.equal(await verifiedRank('abcde', { ...claim, sig: 'xx' }), null, 'firma rota');
  assert.equal(await verifiedRank('abcde', null), null);
  // La misma identidad en este navegador
  assert.ok(store.has('trinchera.identidad'));
});
