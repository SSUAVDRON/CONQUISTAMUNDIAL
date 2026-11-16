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

test('la etiqueta que carga main.js lleva la misma huella que su entrada del import map', async () => {
  const { out } = await versionedIndex();
  const fromMap = out.match(/"\.\/src\/main\.js": "(\.\/src\/main\.js\?v=[0-9a-f]+)"/);
  const tag = out.match(/<script type="module" src="([^"]+)"><\/script>/);
  assert.ok(fromMap && tag, 'falta main.js en el import map o su etiqueta');
  // Los archivos con huella se guardan 7 días sin preguntar (.htaccess): una
  // huella vieja haría correr un main.js antiguo con módulos nuevos
  assert.equal(tag[1], fromMap[1]);
});
