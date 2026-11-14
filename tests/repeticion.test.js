// DEV01: repetir una partida conserva su configuración (no las preferencias de ahora)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES } from '../src/config.js';
import { MECH_VERSION } from '../src/mecanicas.js';
import { configSnapshot, configSummary, replayPlan, validConfig } from '../src/repeticion.js';
import { defaultProfile, recordGame } from '../src/profile.js';

const clasica = () => configSnapshot({ mode: 'ia', mapSize: 'mundo', nations: 90, colonies: 299, difficulty: 'normal', rules: { ...DEFAULT_RULES, profile: 'clasico' }, seed: 123456 });

test('instantánea: copia completa de reglas, cantidades reales y versión', () => {
  const c = clasica();
  assert.ok(validConfig(c));
  assert.equal(c.naciones, 90);
  assert.equal(c.colonias, 299);
  assert.equal(c.perfil, 'clasico');
  assert.equal(c.reglas.colonies, 299, 'las colonias de verdad, no recalculadas');
  assert.equal(c.semilla, 123456);
  assert.equal(c.version, MECH_VERSION);
  assert.deepEqual(Object.keys(c.reglas).sort(), Object.keys(DEFAULT_RULES).sort());
  // Serializable sin perder nada
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
});

test('repetir 90 naciones Clásicas da 90 Clásicas aunque tus preferencias digan otra cosa', () => {
  const p = defaultProfile();
  p.ajustes.reglas = { ...DEFAULT_RULES, profile: 'trinchera' };
  p.ajustes.bots = 200;
  p.ajustes.dificultad = 'imposible';
  recordGame(p, { won: false, alive: false, kills: 0, built: 0, alliances: 0, maxShare: 0.01, seconds: 90, mapSize: 'mundo', rivals: 389, config: clasica() });
  const plan = replayPlan(p.historial[0]);
  assert.equal(plan.kind, 'jugar');
  assert.equal(plan.opts.bots, 90);
  assert.equal(plan.opts.mapSize, 'mundo');
  assert.equal(plan.opts.difficulty, 'normal');
  assert.equal(plan.opts.rules.profile, 'clasico');
  assert.equal(plan.opts.rules.colonies, 299);
  assert.equal(plan.opts.seed, '');
  assert.equal(plan.opts.seedNum, undefined, 'repetir configuración: semilla nueva');
  assert.equal(plan.versionChanged, false);
  // Mismo escenario: también la semilla
  assert.equal(replayPlan(p.historial[0], { scenario: true }).opts.seedNum, 123456);
});

test('ceros y economía sobreviven al guardado y a la repetición', () => {
  const p = defaultProfile();
  const c = configSnapshot({ mapSize: 'europa', nations: 0, colonies: 0, difficulty: 'dificil', rules: { ...DEFAULT_RULES, economy: 'workers', profile: 'trinchera' }, seed: 7 });
  recordGame(p, { won: true, alive: true, kills: 0, built: 0, alliances: 0, maxShare: 0.8, seconds: 300, mapSize: 'europa', rivals: 0, config: c });
  // Cambiar el objeto original después no cambia el historial (se copió)
  c.naciones = 50;
  c.reglas.economy = 'fixed';
  const back = JSON.parse(JSON.stringify(p.historial[0])); // como al guardar y cargar el perfil
  const plan = replayPlan(back);
  assert.equal(plan.opts.bots, 0);
  assert.equal(plan.opts.rules.colonies, 0);
  assert.equal(plan.opts.rules.economy, 'workers');
  assert.equal(plan.opts.difficulty, 'dificil');
});

test('registros antiguos: configurador con lo recuperable; online y tutorial aparte; aviso de versión', () => {
  assert.deepEqual(replayPlan({ mapa: 'europa', rivales: 389, resultado: 'derrota' }), { kind: 'revisar', prefill: { mapSize: 'europa' } });
  assert.deepEqual(replayPlan({ mapa: 'no-existe' }), { kind: 'revisar', prefill: { mapSize: null } });
  assert.equal(replayPlan({ mapa: 'mundo', online: true, config: clasica() }).kind, 'online');
  assert.equal(replayPlan({ mapa: 'mundo', config: { ...clasica(), modo: 'tutorial' } }).kind, 'tutorial');
  const vieja = replayPlan({ mapa: 'mundo', config: { ...clasica(), version: 'doc-1.2' } }, { scenario: true });
  assert.equal(vieja.kind, 'jugar');
  assert.equal(vieja.versionChanged, true);
  assert.equal(vieja.version, 'doc-1.2');
  assert.equal(replayPlan(null), null);
});

test('resumen de la configuración, con singular y plural', () => {
  const one = configSnapshot({ mapSize: 'mundo', nations: 1, colonies: 1, difficulty: 'normal', rules: DEFAULT_RULES, seed: 1 });
  assert.equal(configSummary(one, () => 'Clásico', () => 'Normal'), '1 nación · 1 colonia · Clásico · IA Normal');
  assert.equal(configSummary(clasica(), () => 'Clásico', () => 'Normal'), '90 naciones · 299 colonias · Clásico · IA Normal');
});
