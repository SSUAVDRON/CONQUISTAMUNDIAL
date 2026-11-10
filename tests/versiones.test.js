// index.html tiene que llevar las huellas de los módulos al día (si no, la
// CDN de la web podría mezclar módulos de versiones distintas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionedIndex } from '../herramientas/versionar.js';

test('index.html lleva el import map con la huella de cada módulo al día', async () => {
  const { html, out } = await versionedIndex();
  assert.ok(html.includes('<script type="importmap">'), 'falta el import map');
  assert.equal(html, out, 'index.html no está al día: node herramientas/versionar.js');
});
