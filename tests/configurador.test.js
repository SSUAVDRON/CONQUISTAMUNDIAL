// DEV10: configurador común. Lo que cambia entre dos configuraciones (para el
// borrador del anfitrión y el aviso a los invitados), el resumen de plazas
// humanas, naciones de la IA y colonias, las parejas del cooperativo y las
// configuraciones de la IA y de las salas guardadas por separado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, colonyCount } from '../src/config.js';
import { coopSlots, normalizeConfig, seatsSummary, settingsDiff } from '../src/configurador.js';
import { normalizeProfile, rememberConfig } from '../src/profile.js';
import { configSummary } from '../src/repeticion.js';
import { Sala } from '../src/multiplayer.js';

const base = { bots: 20, mapSize: 'europa', difficulty: 'normal', rules: { ...DEFAULT_RULES } };

test('configurador: el cambio de varias reglas se resume en una lista legible; sin cambios, vacía', () => {
  assert.deepEqual(settingsDiff(base, { ...base, rules: { ...base.rules } }), []);
  const b = { ...base, bots: 40, mapSize: 'mundo', rules: { ...base.rules, victory: 'economia', missiles: false, coop: true } };
  const d = settingsDiff(base, b, (id) => ({ europa: 'Europa', mundo: 'Mundo' })[id]);
  assert.deepEqual(d, ['mapa: Europa → Mundo', 'naciones de la IA: 20 → 40', 'victoria: Dominación → Economía', 'sin misiles', 'cooperativo por parejas']);
  for (const t of d) assert.ok(!/undefined|null|NaN/.test(t), t);
});

test('configurador: el resumen distingue plazas humanas, naciones de la IA y colonias', () => {
  const land = 40000;
  assert.equal(seatsSummary({ seats: 4, humans: 2, bots: 30, rules: {}, landCount: land }), `4 plazas humanas · 30 naciones de la IA · ${colonyCount(land, 30)} colonias (auto)`);
  assert.equal(seatsSummary({ seats: 1, bots: 1, rules: { colonies: 1 } }), '1 plaza humana · 1 nación de la IA · 1 colonia');
  // Cooperativo: cuántas naciones llevan los humanos
  assert.match(seatsSummary({ seats: 6, humans: 5, bots: 10, rules: { coop: true, colonies: 0 } }), /3 naciones humanas por parejas/);
});

test('configurador: en el cooperativo impar, el último va en solitario', () => {
  assert.deepEqual(coopSlots(3, false), [null, null, null]);
  assert.deepEqual(coopSlots(5, true).map((x) => (x.solo ? 'solo' : x.pair)), [1, 1, 2, 2, 'solo']);
  assert.deepEqual(coopSlots(4, true).map((x) => x.solo), [false, false, false, false]);
});

test('configurador: IA y salas se guardan por separado; los datos antiguos se precargan en las dos', () => {
  // Perfil de antes: una sola configuración
  const old = normalizeProfile({ ajustes: { bots: 33, mapa: 'europa', dificultad: 'dificil', reglas: { profile: 'trinchera', victory: 'economia' } } });
  for (const k of ['ia', 'online']) {
    assert.equal(old.ajustes[k].bots, 33);
    assert.equal(old.ajustes[k].mapa, 'europa');
    assert.equal(old.ajustes[k].reglas.victory, 'economia');
  }
  // Confirmar la de la IA no toca la de las salas (y al revés)
  rememberConfig(old, 'ia', { bots: 90, mapa: 'mundo', dificultad: 'facil', reglas: { ...DEFAULT_RULES, profile: 'clasico' } });
  assert.equal(old.ajustes.online.bots, 33);
  assert.equal(old.ajustes.online.reglas.profile, 'trinchera');
  rememberConfig(old, 'online', { bots: 12, mapa: 'asia', dificultad: 'normal', reglas: { ...DEFAULT_RULES, coop: true } });
  assert.equal(old.ajustes.ia.bots, 90);
  assert.equal(old.ajustes.ia.reglas.coop, false);
  // Y sobreviven a guardar y volver a leer
  const again = normalizeProfile(JSON.parse(JSON.stringify(old)));
  assert.equal(again.ajustes.ia.mapa, 'mundo');
  assert.equal(again.ajustes.online.mapa, 'asia');
  assert.equal(normalizeConfig(null).mapa, 'mundo');
});

test('configurador: aplicar varios cambios del borrador de una vez da una sola revisión', async () => {
  const sent = [];
  const room = { presence: async () => {}, emit: () => {}, on: () => () => {}, peers: () => [], leave: () => {} };
  const sala = new Sala({ lobby: { presence: (x) => sent.push(x) } }, 'abcde', { name: 'Anfitrión' });
  sala.isHost = true;
  sala.room = room;
  sala.settings = { ...base };
  sala.rev = 1;
  sala._key = null;
  sala.setSettings({ ...base });
  const r0 = sala.rev;
  // Borrador con cinco cambios: se aplican juntos
  sala.setSettings({ ...base, bots: 50, mapSize: 'mundo', difficulty: 'dificil', rules: { ...base.rules, missiles: false, timeLimitMin: 30 } });
  assert.equal(sala.rev, r0 + 1);
  // El nombre o las plazas no cambian la revisión
  sala.setInfo({ nombre: 'Otra', plazas: 6 });
  assert.equal(sala.rev, r0 + 1);
});

test('configurador: el resumen de la última partida da la semilla de los mapas generados', () => {
  const c = { v: 1, modo: 'ia', mapa: 'mediano', naciones: 10, colonias: 5, dificultad: 'normal', reglas: { ...DEFAULT_RULES }, perfil: 'clasico', semilla: 1234, version: 'x' };
  assert.match(configSummary(c), /semilla 1234/);
  assert.doesNotMatch(configSummary({ ...c, mapa: 'europa' }), /semilla/);
});
