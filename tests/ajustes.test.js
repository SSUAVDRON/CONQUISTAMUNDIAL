// Ajustes: preajustes de calidad, valores guardados que se corrigen solos,
// la migración de «Animaciones» y la resolución fija del mapa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GFX_KEYS, GFX_PRESETS, SECTIONS, SETTINGS_DEFAULTS, applyPreset, fixedDpr, normalizeSettingsExtra, presetOf, sectionKeys } from '../src/ajustes.js';
import { defaultProfile, normalizeProfile } from '../src/profile.js';

test('ajustes: por defecto, calidad «Equilibrada»; cada preajuste se reconoce y uno suelto la deja personalizada', () => {
  const a = defaultProfile().ajustes;
  assert.equal(presetOf(a), 'equilibrada');
  for (const id of Object.keys(GFX_PRESETS)) {
    applyPreset(a, id);
    assert.equal(presetOf(a), id);
    for (const k of GFX_KEYS) assert.equal(a[k], GFX_PRESETS[id].values[k]);
  }
  applyPreset(a, 'maxima');
  a.vineta = false;
  assert.equal(presetOf(a), 'personalizada');
  // Un preajuste no toca lo que no es gráfico
  a.volGeneral = 0.3;
  a.nombres = 'jugadores';
  applyPreset(a, 'bateria');
  assert.equal(a.volGeneral, 0.3);
  assert.equal(a.nombres, 'jugadores');
});

test('ajustes: valores guardados raros vuelven a los de por defecto; los buenos se quedan', () => {
  const a = normalizeSettingsExtra({ resolucion: 'ultra', fpsMax: 144, particulas: 'baja', nombres: 7, escalaUI: 3, volGeneral: 4, contadorFps: 'sí', temblor: false });
  assert.equal(a.resolucion, 'auto');
  assert.equal(a.fpsMax, 0);
  assert.equal(a.particulas, 'baja');
  assert.equal(a.nombres, 'todos');
  assert.equal(a.escalaUI, 1);
  assert.equal(a.volGeneral, 1);
  assert.equal(a.contadorFps, false);
  assert.equal(a.temblor, false);
});

test('ajustes: quien tenía quitadas las animaciones sigue sin las del mapa; un perfil nuevo las tiene', () => {
  const viejo = normalizeProfile({ ...defaultProfile(), ajustes: { animaciones: false } });
  assert.equal(viejo.ajustes.efectosMapa, false);
  assert.equal(viejo.ajustes.animaciones, false);
  const nuevo = normalizeProfile(defaultProfile());
  assert.equal(nuevo.ajustes.efectosMapa, true);
  // Guardado ya con la opción nueva: se respeta
  const elegido = normalizeProfile({ ...defaultProfile(), ajustes: { animaciones: false, efectosMapa: true } });
  assert.equal(elegido.ajustes.efectosMapa, true);
  for (const k of Object.keys(SETTINGS_DEFAULTS)) assert.ok(k in nuevo.ajustes, `falta ${k}`);
});

test('ajustes: resolución fija del mapa según la pantalla', () => {
  assert.equal(fixedDpr('auto', 2), null);
  assert.equal(fixedDpr('alta', 2), 2);
  assert.equal(fixedDpr('media', 2), 1.25);
  assert.equal(fixedDpr('baja', 2), 1);
  assert.equal(fixedDpr('alta', 1), 1);
  assert.ok(fixedDpr('media', 1) < 1 && fixedDpr('media', 1) >= 0.75);
  assert.equal(fixedDpr('baja', 1), 0.7);
});

test('ajustes: cada opción de la página tiene su valor por defecto en el perfil', () => {
  const d = defaultProfile().ajustes;
  for (const s of SECTIONS) {
    for (const k of sectionKeys(s.id)) assert.ok(k in d, `${s.id}: ${k} sin valor por defecto`);
    for (const it of s.items) {
      if (it.type !== 'seg') continue;
      assert.ok(it.options.some(([v]) => v === d[it.key]), `${it.key}: el valor por defecto no es una de sus opciones`);
    }
  }
});
