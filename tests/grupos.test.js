// Barra de construcción en tres grupos: cada edificio está en uno y solo uno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, BUILDING_KINDS, BUILD_GROUPS } from '../src/config.js';

test('los grupos de edificios (Economía, Defensa, Ataque) cubren todos una sola vez', () => {
  assert.deepEqual(BUILD_GROUPS.map((g) => g.name), ['Economía', 'Defensa', 'Ataque']);
  const all = BUILD_GROUPS.flatMap((g) => g.kinds);
  assert.equal(new Set(all).size, all.length, 'sin repetidos');
  assert.deepEqual([...all].sort(), [...BUILDING_KINDS].sort());
  for (const g of BUILD_GROUPS) assert.ok(BUILDINGS[g.icon], `icono de ${g.name}`);
});
