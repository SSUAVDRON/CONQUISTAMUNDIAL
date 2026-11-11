// Perfiles de reglas (auditoría): Clásico (ritmo de FrontWars, sin puntos
// estratégicos ni tecnologías) y Trinchera (ritmo lento, el histórico).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { DEFAULT_RULES, RES, cleanRules, migrateRules } from '../src/config.js';
import { MECH, PROFILES, maxTroopsFor, profileOf, regenPerTick, rulesetId } from '../src/mecanicas.js';
import { defaultProfile, normalizeProfile } from '../src/profile.js';
import { checkStartPayload, roomRuleset } from '../src/multiplayer.js';

function play(rules) {
  const map = generateMap(220 * RES, 130 * RES, 9);
  const game = new Game({ map, seed: 9, rules });
  const h = game.addPlayer('Yo', [0, 0, 255], true);
  game.addPlayer('Otro', [255, 0, 0], false);
  game.start();
  game.spawnPlayer(h, game.findSpawnTile());
  game.spawnPlayer(game.players[2], game.findSpawnTile());
  while (game.phase === 'spawn') game.tick();
  game.bots.length = 0;
  return { game, h };
}

test('perfiles: un perfil guardado antiguo (reglas sin perfil) sigue en Trinchera; uno nuevo, en Clásico', () => {
  // Así guardaba el juego los ajustes antes de los perfiles (copia real de localStorage)
  const old = {
    v: 3, nombre: 'Viejo', color: '#2f7dff', xp: 1200, monedas: 300,
    ajustes: { bots: 70, mapa: 'mundo', dificultad: 'normal', reglas: { winShare: 0.7, startGold: 0, missiles: true, warships: true, colonies: null, troopMult: 1, goldMult: 1, priceMult: 1, truceMin: 0, timeLimitMin: 0, alliances: true, boats: true, factories: true, victory: 'capitales', coop: false, coopRoles: false, economy: 'fixed' } },
  };
  const loaded = normalizeProfile(old);
  assert.equal(loaded.ajustes.reglas.profile, 'trinchera', 'migrada antes de combinar con los valores por defecto');
  assert.equal(loaded.ajustes.reglas.victory, 'capitales');
  // Lo que hace el inicio al crear la partida: valores por defecto + ajustes guardados
  const rules = { ...DEFAULT_RULES, ...loaded.ajustes.reglas };
  const { game } = play(rules);
  assert.equal(game.profile.id, PROFILES.trinchera.id);
  assert.equal(game.rules.victory, 'capitales');
  assert.ok(game.points.length > 0, 'Trinchera conserva los puntos estratégicos');
  // Un jugador nuevo empieza en Clásico
  assert.equal(defaultProfile().ajustes.reglas.profile, 'clasico');
  assert.equal(normalizeProfile({ ajustes: { reglas: { profile: 'clasico' } } }).ajustes.reglas.profile, 'clasico');
  // Sin perfil válido, el histórico
  assert.equal(cleanRules({}).profile, 'trinchera');
  assert.equal(migrateRules({ victory: 'dominio' }).profile, 'trinchera');
  assert.equal(profileOf({ profile: 'raro' }).id, PROFILES.trinchera.id);
});

test('perfil Clásico: sin capitales (ni victoria por capitales ni botín), sin tecnologías, regeneración y oro base exactos', () => {
  assert.equal(cleanRules({ profile: 'clasico', victory: 'capitales' }).victory, 'dominio', 'la victoria por capitales sería inalcanzable');
  assert.equal(cleanRules({ profile: 'trinchera', victory: 'capitales' }).victory, 'capitales');
  const { game, h } = play({ profile: 'clasico' });
  assert.equal(game.profile.id, 'clasico-3');
  assert.equal(game.points.length, 0, 'sin puntos estratégicos: ni capitales ni su botín');
  assert.equal(h.capitalTile, -1);
  h.gold = 1e7;
  assert.equal(game.startResearch(h, 'agricultura'), false, 'sin tecnologías');
  assert.equal(game.setSpec(h, 'industria'), false, 'sin especialización');
  // Regeneración: la fórmula base, sin multiplicadores (ni ritmo ni bonos de capital)
  h.troops = 50000;
  assert.ok(Math.abs(h.growthPerTick() - regenPerTick(50000, h.maxTroops())) < 1e-9);
  assert.ok(Math.abs(h.maxTroops() - maxTroopsFor(h.tiles, 0)) < 1e-6);
  // Oro: 100 por turno exactos (1000/s), todo «base», sin bonos
  const g0 = h.gold;
  const i0 = { ...h.income };
  for (let i = 0; i < 10; i++) game.tick();
  assert.equal(h.gold - g0, 10 * MECH.baseGoldPerTickHuman);
  assert.equal(h.income.base - i0.base, 10 * MECH.baseGoldPerTickHuman);
  assert.equal(h.income.bonus - i0.bonus, 0);
});

test('multijugador: la sala no empieza si el anfitrión simula con otra versión de las reglas', () => {
  const settings = { mapSize: 'mundo', bots: 10, difficulty: 'normal', rules: { ...DEFAULT_RULES, profile: 'clasico' } };
  const good = { v: 1, seed: 42, ruleset: roomRuleset(settings.rules), settings, players: [{ peer: 'a', name: 'A', color: '#ff0000' }] };
  const ok = checkStartPayload(good);
  assert.ok(ok.ok);
  assert.equal(ok.payload.settings.rules.profile, 'clasico');
  assert.ok(ok.payload.ruleset.startsWith(rulesetId(settings.rules)));
  // Otro perfil, otra versión del motor o un cliente antiguo sin versión: no se simula
  assert.equal(checkStartPayload({ ...good, ruleset: roomRuleset({ ...settings.rules, profile: 'trinchera' }) }).reason, 'version');
  assert.equal(checkStartPayload({ ...good, ruleset: 'doc-0.9/clasico-1#xyz' }).reason, 'version');
  assert.equal(checkStartPayload({ ...good, ruleset: undefined }).reason, 'version');
  assert.equal(checkStartPayload({ ...good, seed: 'x' }).reason, 'datos');
});

test('diagnóstico (?diag=1): registra turnos, envíos, frentes y reembolsos con cifras internas y visibles', async () => {
  const { Diagnostico } = await import('../src/diagnostico.js');
  const { game, h } = play({ profile: 'clasico' });
  const diag = new Diagnostico(game, { build: 'test', mechVersion: MECH.version || 'doc', ruleset: rulesetId(game.rules) });
  game.launchAttack(h, 0, 4000);
  for (let i = 0; i < 5; i++) game.tick();
  game.retreat(h.attacks.get(0));
  for (let i = 0; i < 30; i++) game.tick();
  const data = diag.exportar(false);
  assert.equal(data.perfil, 'clasico-3');
  const kinds = new Set(data.eventos.map((e) => e.t));
  for (const k of ['turno', 'envio', 'frente', 'fin']) assert.ok(kinds.has(k), `hay eventos «${k}»`);
  const envio = data.eventos.find((e) => e.t === 'envio');
  assert.equal(envio.enviadas, 4000);
  assert.equal(envio.enviadas_vis, 400);
  const fin = data.eventos.find((e) => e.t === 'fin');
  assert.ok(fin.retirada && fin.reembolso > 0, 'la retirada de tierra libre devuelve lo que queda');
  const turno = data.eventos.find((e) => e.t === 'turno');
  assert.equal(turno.oroPasivo, MECH.baseGoldPerTickHuman);
  // Sin diagnóstico el motor no registra nada
  const other = play({ profile: 'clasico' });
  assert.equal(other.game.trace, null);
});
