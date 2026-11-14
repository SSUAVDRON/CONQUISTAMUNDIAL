// DEV07: progresiones competitivas separadas. Contra la IA y en línea tienen
// cada una su rango (con modalidad, temporada, versión y el identificador de
// cada partida); el rango mixto de antes se conserva como histórico; un final
// se aplica una sola vez aunque llegue repetido o tras recargar; en línea, la
// pérdida del anfitrión anula la partida y queda anotado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, mergeProfiles } from '../src/profile.js';
import { RANKED_VERSION, alreadyApplied, applyAiResult, applyRoomResult, inPlacement, newRank, voidResult } from '../src/rangos.js';

/** Perfil de antes de separar las colas: un solo rango con partidas de las dos. */
function oldProfile() {
  const r = newRank();
  delete r.modalidad;
  delete r.version;
  delete r.aplicadas;
  Object.assign(r, { mmr: 1420, puntos: 1350, colocacion: 5, partidas: 7, victorias: 2, mejor: 1400 });
  r.historial = [
    { fecha: 3, puntos: 1350, delta: 12, tipo: 'ia', puesto: 3, de: 91 },
    { fecha: 2, puntos: 1338, delta: -8, tipo: 'sala', puesto: 2, de: 41, rivales: 1 },
    { fecha: 1, puntos: 1346, delta: 20, tipo: 'ia', puesto: 1, de: 91 },
  ];
  return { nombre: 'Vega', rango: r };
}

test('colas: un perfil de antes conserva su rango mixto como histórico y las colas empiezan sus colocaciones', () => {
  const p = normalizeProfile(oldProfile());
  assert.ok(p.rangoHistorico, 'histórico');
  assert.equal(p.rangoHistorico.puntos, 1350);
  assert.equal(p.rangoHistorico.partidas, 7);
  assert.equal(p.rangoHistorico.modalidad, 'mixta');
  assert.ok(p.rangoMigrado > 0, 'se avisa una vez');
  for (const [r, modalidad, tipo] of [[p.rango, 'ia', 'ia'], [p.rangoOnline, 'online', 'sala']]) {
    assert.equal(r.modalidad, modalidad);
    assert.equal(r.version, RANKED_VERSION);
    assert.ok(inPlacement(r), 'empieza con colocación');
    assert.equal(r.partidas, 0);
    assert.equal(r.mmr, 1420, 'con tu nivel de entonces como punto de partida');
    assert.ok(r.historial.length > 0 && r.historial.every((h) => h.tipo === tipo && h.previa), 'cada cola se lleva sus partidas');
  }
  // Volver a leerlo no lo migra otra vez
  const again = normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.equal(again.rangoHistorico.puntos, 1350);
  assert.equal(again.rangoMigrado, p.rangoMigrado);
  // Un perfil nuevo: sin histórico
  const fresh = normalizeProfile({ nombre: 'Nadie' });
  assert.equal(fresh.rangoHistorico, null);
  assert.equal(fresh.rangoOnline.modalidad, 'online');
});

test('colas: una partida contra la IA solo cambia la de la IA; una en línea, solo la de en línea', () => {
  const p = normalizeProfile({ nombre: 'Vega' });
  const online0 = JSON.stringify(p.rangoOnline);
  applyAiResult(p.rango, { place: 2, of: 91 }, { partida: 'ia.a' });
  assert.equal(p.rango.colocacion, 1);
  assert.equal(JSON.stringify(p.rangoOnline), online0);
  const ia0 = JSON.stringify(p.rango);
  applyRoomResult(p.rangoOnline, { place: 1, of: 41 }, [{ mmr: 1000, place: 3 }], { partida: 'abcde.1.77' });
  assert.equal(p.rangoOnline.colocacion, 1);
  assert.equal(JSON.stringify(p.rango), ia0);
  // Cada partida, con su identificador, su temporada y su versión
  const h = p.rangoOnline.historial[0];
  assert.equal(h.partida, 'abcde.1.77');
  assert.equal(h.temporada, p.rangoOnline.temporada);
  assert.equal(h.version, RANKED_VERSION);
});

test('colas: el mismo final se aplica una sola vez (repetido o tras recargar)', () => {
  const r = newRank(new Date(), 'ia');
  assert.ok(applyAiResult(r, { place: 5, of: 91 }, { partida: 'ia.x' }));
  const snap = JSON.stringify(r);
  assert.equal(applyAiResult(r, { place: 1, of: 91 }, { partida: 'ia.x' }), null, 'final repetido');
  assert.equal(JSON.stringify(r), snap);
  // Tras recargar: el perfil guardado recuerda que ya se resolvió
  const back = normalizeProfile({ rango: JSON.parse(snap), rangoOnline: newRank(new Date(), 'online') });
  assert.ok(alreadyApplied(back.rango, 'ia.x'));
  // Abandono de una partida nueva: sí cuenta (una vez)
  const out = applyAiResult(back.rango, null, { abandon: true, partida: 'ia.y' });
  assert.ok(out && out.mmrDelta < 0);
  assert.equal(applyAiResult(back.rango, null, { abandon: true, partida: 'ia.y' }), null);
});

test('colas: en línea, perder al anfitrión anula la partida (no cuenta, queda anotado, una vez)', () => {
  const r = newRank(new Date(), 'online');
  const before = JSON.stringify({ ...r, historial: [], aplicadas: [] });
  const out = voidResult(r, { partida: 'sala.2.9', motivo: 'Se perdió la conexión con el anfitrión' });
  assert.ok(out.void);
  assert.equal(r.partidas, 0);
  assert.equal(r.colocacion, 0);
  assert.equal(JSON.stringify({ ...r, historial: [], aplicadas: [] }), before);
  assert.equal(r.historial[0].anulada, true);
  assert.match(r.historial[0].motivo, /anfitrión/);
  assert.equal(voidResult(r, { partida: 'sala.2.9', motivo: 'otra vez' }), null);
  // Y después ya no se puede aplicar como resultado
  assert.equal(applyRoomResult(r, { place: 1, of: 41 }, [], { partida: 'sala.2.9' }), null);
});

test('colas: dos dispositivos se unen sin mezclar las colas ni repetir finales', () => {
  const a = normalizeProfile({ nombre: 'Vega' });
  const b = normalizeProfile(JSON.parse(JSON.stringify(a)));
  applyAiResult(a.rango, { place: 1, of: 91 }, { partida: 'ia.1' });
  applyRoomResult(b.rangoOnline, { place: 2, of: 41 }, [{ mmr: 1000, place: 1 }], { partida: 'sala.1' });
  const m = mergeProfiles(a, b);
  assert.equal(m.rango.colocacion, 1);
  assert.equal(m.rangoOnline.colocacion, 1);
  assert.ok(alreadyApplied(m.rango, 'ia.1'));
  assert.ok(alreadyApplied(m.rangoOnline, 'sala.1'));
});
