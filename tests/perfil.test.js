// Tests del perfil: experiencia, niveles, logros, desbloqueos y fusión con la nube.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, PATTERNS, SYMBOLS, defaultProfile, hasAchievement, isUnlocked,
  levelInfo, mergeProfiles, normalizeProfile, recordGame,
} from '../src/profile.js';

// recordGame guarda en localStorage si existe; en Node no hace falta
globalThis.localStorage = undefined;

function result(over = {}) {
  return {
    won: false, alliedWin: false, mapSize: 'mediano', seconds: 600, maxShare: 0.1, kills: 0, built: 0,
    landings: 0, alliances: 0, betrayals: 0, maxGold: 0, maxCities: 0, online: false, alive: false,
    survivedSeconds: 600, rivals: 25, ...over,
  };
}

test('los niveles crecen con la experiencia', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(59).level, 1);
  assert.equal(levelInfo(60).level, 2);
  assert.equal(levelInfo(240).level, 3);
  const mid = levelInfo(150);
  assert.ok(mid.progress > 0 && mid.progress < 1);
});

test('una partida da experiencia, estadísticas, historial y logros', () => {
  const p = defaultProfile();
  const out = recordGame(p, result({ won: true, seconds: 500, kills: 6, built: 12, maxShare: 0.72, maxGold: 3000000 }));
  assert.ok(out.xp > 150);
  assert.equal(p.stats.partidas, 1);
  assert.equal(p.stats.victorias, 1);
  assert.equal(p.stats.mejorTiempo, 500);
  assert.equal(p.historial.length, 1);
  const ids = out.achievements.map((a) => a.id);
  for (const id of ['primera_partida', 'primera_victoria', 'relampago', 'verdugo', 'arquitecto', 'medio_mundo', 'tesoro']) {
    assert.ok(ids.includes(id), `falta el logro ${id}`);
  }
  // Un logro no se concede dos veces
  const again = recordGame(p, result({ won: true }));
  assert.equal(again.achievements.some((a) => a.id === 'primera_victoria'), false);
});

test('los ids de logro no chocan con propiedades del prototipo', () => {
  const p = defaultProfile();
  for (const a of ACHIEVEMENTS) assert.equal(hasAchievement(p, a.id), false, a.id);
  const torre = SYMBOLS.find((s) => s.id === 'torre');
  assert.equal(isUnlocked(p, torre), false, 'la torre no debe salir desbloqueada sin el logro');
  assert.equal(isUnlocked(normalizeProfile({ logros: { constructor: 1 } }), torre), false);
});

test('desbloqueos por logro y por nivel', () => {
  const p = defaultProfile();
  const rayas = PATTERNS.find((x) => x.id === 'rayas');
  const espiga = PATTERNS.find((x) => x.id === 'espiga');
  assert.equal(isUnlocked(p, rayas), false);
  p.logros.primera_victoria = Date.now();
  assert.equal(isUnlocked(p, rayas), true);
  assert.equal(isUnlocked(p, espiga), false);
  p.xp = 60 * 16; // nivel 5
  assert.equal(isUnlocked(p, espiga), true);
});

test('fusionar perfiles no pierde progreso', () => {
  const a = defaultProfile();
  const b = defaultProfile();
  a.xp = 500;
  a.stats.partidas = 4;
  a.stats.mejorTiempo = 900;
  a.logros.primera_partida = 1;
  a.actualizado = 10;
  b.xp = 300;
  b.stats.partidas = 7;
  b.stats.mejorTiempo = 600;
  b.logros.marino = 2;
  b.nombre = 'Desde el móvil';
  b.actualizado = 20;
  const m = mergeProfiles(a, b);
  assert.equal(m.xp, 500);
  assert.equal(m.stats.partidas, 7);
  assert.equal(m.stats.mejorTiempo, 600);
  assert.ok(hasAchievement(m, 'primera_partida') && hasAchievement(m, 'marino'));
  assert.equal(m.nombre, 'Desde el móvil', 'la identidad viene del perfil más reciente');
});

test('monedas: partidas, logros y retos diarios; la tienda las gasta', async () => {
  const { BANNERS, DAILY, DAILY_BONUS, buyItem, dailyFor, ensureDaily, itemKey } = await import('../src/profile.js');
  const p = defaultProfile();
  const out = recordGame(p, result({ won: true, kills: 3 }));
  assert.ok(out.coins > 0);
  assert.equal(p.monedas, out.coins);
  // Las monedas de los logros nuevos van incluidas
  const achCoins = out.achievements.reduce((s, a) => s + a.coins, 0);
  assert.ok(out.coins >= achCoins + 10);
  // Los retos del día son siempre los mismos ese día, tres y distintos
  const a = dailyFor('2026-11-05');
  assert.deepEqual(a, dailyFor('2026-11-05'));
  assert.equal(new Set(a).size, 3);
  for (const id of a) assert.ok(DAILY.some((d) => d.id === id));
  // Al cambiar de día, empiezan de cero
  const d1 = ensureDaily(p, '2026-11-05');
  d1.progreso[d1.retos[0]] = 1;
  assert.equal(ensureDaily(p, '2026-11-05'), d1);
  assert.deepEqual(ensureDaily(p, '2026-11-06').progreso, {});
  // Tienda: sin dinero no compra; con dinero, descuenta y desbloquea
  const galaxia = BANNERS.find((b) => b.id === 'galaxia');
  p.monedas = 10;
  assert.equal(isUnlocked(p, galaxia), false);
  assert.equal(buyItem(p, galaxia), false);
  p.monedas = galaxia.unlock.price + 5;
  assert.equal(buyItem(p, galaxia), true);
  assert.equal(p.monedas, 5);
  assert.ok(isUnlocked(p, galaxia));
  assert.ok(p.comprados[itemKey(galaxia)]);
  // No se compra dos veces ni se compra lo que no está a la venta
  assert.equal(buyItem(p, galaxia), false);
  assert.equal(buyItem(p, BANNERS.find((b) => b.id === 'real')), false);
  assert.ok(DAILY_BONUS > 0);
});

test('completar los tres retos del día da su premio y el bonus', async () => {
  const { DAILY, DAILY_BONUS, ensureDaily } = await import('../src/profile.js');
  const p = defaultProfile();
  const d = ensureDaily(p);
  // Deja cada reto a un paso de completarse y juega una partida que los cumple todos
  const big = result({
    won: true, kills: 20, built: 20, maxShare: 0.5, techs: 5, pointsTaken: 5, capitalsTaken: 2, pacts: 2,
    landings: 5, missiles: 3, alliances: 2, survivedSeconds: 1200, maxGold: 2000000,
  });
  for (const id of d.retos) d.progreso[id] = DAILY.find((x) => x.id === id).need - 1;
  const out = recordGame(p, big);
  assert.equal(out.daily.length, 3);
  assert.equal(out.dailyBonus, DAILY_BONUS);
  assert.equal(p.stats.retosDiarios, 3);
  // Otra partida el mismo día ya no repite premio
  const again = recordGame(p, big);
  assert.equal(again.daily.length, 0);
  assert.equal(again.dailyBonus, 0);
});

test('compras y bandera del emblema sobreviven a la fusión y a la limpieza', () => {
  const a = defaultProfile();
  a.comprados = { 'estandarte:galaxia': 1 };
  a.actualizado = 1;
  const b = defaultProfile();
  b.comprados = { 'marco:diamante': 2 };
  b.actualizado = 2;
  b.emblema.flag = 'es';
  const m = mergeProfiles(a, b);
  assert.ok(m.comprados['estandarte:galaxia'] && m.comprados['marco:diamante']);
  assert.equal(m.emblema.flag, 'es');
  assert.equal(normalizeProfile({ emblema: { flag: '<script>' } }).emblema.flag, '');
  assert.equal(normalizeProfile({ monedas: -50 }).monedas, 0);
});
