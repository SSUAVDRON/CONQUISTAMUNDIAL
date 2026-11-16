// Banderas del emblema: el catálogo (países, comunidades autónomas, Euskal
// Herria, históricas y regiones) está entero en los atlas, los nombres van
// en español y la bandera elegida se guarda y viaja limpia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_INDEX } from '../src/banderas.js';
import { EXTRA_INDEX, FLAG_CATALOG } from '../src/banderas-extra.js';
import { FLAG_ID, cleanFlag } from '../src/config.js';
import { defaultProfile, normalizeProfile } from '../src/profile.js';

const GROUPS = new Set(['es', 'eus', 'his', 'reg', 'pais', 'org']);

test('banderas: cada una del catálogo tiene su sitio en un atlas, nombre y grupo; sin repetir', () => {
  const seen = new Set();
  for (const [id, name, group] of FLAG_CATALOG) {
    assert.ok(FLAG_ID.test(id), `${id}: identificador válido`);
    assert.ok(!seen.has(id), `${id} repetida`);
    seen.add(id);
    assert.ok(Object.hasOwn(FLAG_INDEX, id) || Object.hasOwn(EXTRA_INDEX, id), `${id} sin dibujo`);
    assert.ok(typeof name === 'string' && name.length > 1, `${id} sin nombre`);
    assert.ok(GROUPS.has(group), `${id}: grupo ${group}`);
  }
  // Todos los países de los mapas siguen en el catálogo
  for (const id of Object.keys(FLAG_INDEX)) assert.ok(seen.has(id), `${id} (de los mapas) no se puede elegir`);
  assert.ok(FLAG_CATALOG.filter(([, , g]) => g === 'pais').length > 230, 'casi todos los países del mundo');
});

test('banderas: las 17 comunidades y las 2 ciudades autónomas, Euskal Herria, la II República y regiones históricas', () => {
  const ids = new Set(FLAG_CATALOG.map(([id]) => id));
  const comunidades = ['es-an', 'es-ar', 'es-as', 'es-ib', 'es-cn', 'es-cb', 'es-cm', 'es-cl', 'es-ct', 'es-vc', 'es-ex', 'es-ga', 'es-md', 'es-mc', 'es-nc', 'es-pv', 'es-ri', 'es-ce', 'es-ml'];
  for (const id of comunidades) assert.ok(ids.has(id), `falta ${id}`);
  assert.equal(FLAG_CATALOG.filter(([, , g]) => g === 'es').length, 19);
  for (const id of ['eus', 'eus-bi', 'eus-gi', 'eus-zub', 'his-rep2', 'his-borg', 'his-cast', 'his-leon', 'his-nav', 'gb-sct', 'reg-bre']) assert.ok(ids.has(id), `falta ${id}`);
  const name = (id) => FLAG_CATALOG.find(([x]) => x === id)[1];
  assert.equal(name('es-ct'), 'Cataluña');
  assert.match(name('eus'), /Euskal Herria/);
  assert.equal(name('his-rep2'), 'II República Española');
  assert.equal(name('es'), 'España');
});

test('banderas: el identificador se limpia igual en el perfil y en la red', () => {
  for (const ok of ['es', 'es-ct', 'eus', 'eus-bi', 'his-rep2', 'gb-sct', 'reg-bre']) assert.equal(cleanFlag(ok), ok);
  for (const bad of ['', 'x', 'ES', 'es-', 'es_ct', 'his-república', '<b>', 'a'.repeat(20), 7, null]) assert.equal(cleanFlag(bad), '');
  const p = normalizeProfile({ ...defaultProfile(), emblema: { ...defaultProfile().emblema, flag: 'his-rep2' } });
  assert.equal(p.emblema.flag, 'his-rep2');
  const q = normalizeProfile({ ...defaultProfile(), emblema: { ...defaultProfile().emblema, flag: 'javascript:alert(1)' } });
  assert.equal(q.emblema.flag, '');
});
